// Giriş noktası: 2D arayüzü bağlar, XR oturumunu başlatır ve modülleri birbirine bağlar.
// Modüller birbirini doğrudan çağırmaz: runner olay yayar; sahne, ses ve günlük burada abone olur.
import * as THREE from 'three';
import {
  CAMERA_FAR_M,
  CAMERA_FOV_DEG,
  CAMERA_NEAR_M,
  COLORS,
  DEFAULT_DURATION_MIN,
  EMULATOR_PARAM,
  FALLBACK_EYE_HEIGHT_M,
  FONT_PATH,
  FONT_PRELOAD_BASE_CHARS,
  MAX_FRAME_DELTA_MS,
  MAX_PIXEL_RATIO_2D,
  PREVIEW_EYE_HEIGHT_M,
  PROMPT_START_DISTANCE_M,
  XR_FOVEATION,
  XR_OPTIONAL_FEATURES,
  XR_TARGET_FRAME_RATE,
} from './config';
import { STRINGS } from './strings';
import { loadDecks, type LoadedDeck } from './deck/loader';
import type { Deck } from './deck/schema';
import { createClock, parseTimeScale, type SessionClock } from './session/clock';
import { planSession, seedFor } from './session/planner';
import { createRunner, type Runner } from './session/runner';
import { SYNTHETIC_ANCHOR_ID, type Timeline } from './session/types';
import { createStage, promptPosition, type Stage } from './scene/stage';
import { breathAt } from './scene/breath';
import { createEnvironment } from './scene/environment';
import { createPromptView, preloadPromptFont } from './scene/promptView';
import { createPauseOverlay } from './scene/pauseOverlay';
import { createAudioEngine } from './audio/engine';
import { createDrone, type Drone } from './audio/drone';
import { createBell, type Bell } from './audio/bell';
import { sessionLevelAt } from './audio/envelope';
import { bindPauseInput } from './input/pause';
import {
  createSessionRecorder,
  downloadText,
  loadSessions,
  saveSession,
  sessionsToMarkdown,
  type SessionRecorder,
} from './log/sessionLog';
import { createScreens } from './ui/screens';

// ---------- URL parametreleri ----------
const params = new URLSearchParams(location.search);
const timeScale = parseTimeScale(location.search);
const emulatorRequested = params.has(EMULATOR_PARAM);

/** `?emu`: headset olmadan denemek için Meta'nın Quest 3 emülatörü (IWER). Yalnız istenirse yüklenir. */
async function installEmulator(): Promise<void> {
  const { XRDevice, metaQuest3 } = await import('iwer');
  const device = new XRDevice(metaQuest3);
  device.installRuntime({ forceInstall: true });
  (window as unknown as { xrDevice?: unknown }).xrDevice = device;
}
if (emulatorRequested) {
  try {
    await installEmulator();
  } catch (error) {
    console.error('IWER yüklenemedi:', error);
  }
}

// ---------- Renderer, sahne, kamera ----------
// troika fontu bir Web Worker içinde indirir; göreli adres orada çözülemez, mutlak adres verilir.
const fontUrl = new URL(FONT_PATH, document.baseURI).href;

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO_2D));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(COLORS.background2d);
renderer.xr.enabled = true;
document.getElementById('scene-root')?.append(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(CAMERA_FOV_DEG, 1, CAMERA_NEAR_M, CAMERA_FAR_M);
scene.add(camera);
resetPreviewCamera();

const environment = createEnvironment(scene);
const promptView = createPromptView(scene, fontUrl);
const pauseOverlay = createPauseOverlay(scene, camera, fontUrl);
const audio = createAudioEngine();
let drone: Drone | null = null;
let bell: Bell | null = null;

function resetPreviewCamera(): void {
  // XR oturumu kamerayı kendi pozuna ve projeksiyonuna çeker; 2D önizlemeye dönerken sıfırla.
  camera.position.set(0, PREVIEW_EYE_HEIGHT_M, 0);
  camera.quaternion.identity();
  camera.scale.set(1, 1, 1);
  camera.fov = CAMERA_FOV_DEG;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}

window.addEventListener('resize', () => {
  if (renderer.xr.isPresenting) return;
  renderer.setSize(window.innerWidth, window.innerHeight);
  resetPreviewCamera();
});

// ---------- Desteler ----------
const { decks, errors } = loadDecks();
const deckById = new Map<string, Deck>(decks.map((d) => [d.deck.id, d.deck]));

function fontCharacters(list: readonly LoadedDeck[]): string {
  const chars = new Set<string>();
  const add = (text: string) => {
    for (const ch of text) chars.add(ch);
  };
  add(FONT_PRELOAD_BASE_CHARS);
  add(STRINGS.paused + STRINGS.pausedHint);
  for (const { deck } of list) {
    add(deck.anchor + deck.closing);
    for (const prompt of deck.prompts) add(prompt.text);
  }
  return [...chars].join('');
}
preloadPromptFont(fontUrl, fontCharacters(decks));

// ---------- 2D ekranlar ----------
const screens = createScreens(decks, errors, DEFAULT_DURATION_MIN, {
  onEnter: (loaded, minutes) => void startSession(loaded, minutes),
  onExport: exportSessions,
});
screens.setSessionsCount(loadSessions().length);
screens.setDevFlags([
  ...(emulatorRequested ? [STRINGS.emulatorActive] : []),
  ...(timeScale !== 1 ? [STRINGS.speedActive(timeScale)] : []),
]);
screens.showStart();
void checkXrSupport();

async function checkXrSupport(): Promise<void> {
  screens.setXrAvailability('checking');
  let supported = false;
  try {
    supported = (await navigator.xr?.isSessionSupported('immersive-vr')) ?? false;
  } catch {
    supported = false;
  }
  screens.setXrAvailability(supported ? 'supported' : 'unsupported');
}

function localIsoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function promptTextFor(deckId: string, promptId: string): string | undefined {
  const deck = deckById.get(deckId);
  if (!deck) return undefined;
  if (promptId === SYNTHETIC_ANCHOR_ID) return deck.anchor;
  return deck.prompts.find((p) => p.id === promptId)?.text;
}

function exportSessions(): void {
  const records = loadSessions();
  if (records.length === 0) return;
  const markdown = sessionsToMarkdown(records, { promptText: promptTextFor });
  downloadText(STRINGS.exportFileName(localIsoDate(new Date())), markdown);
}

// ---------- Seans ----------
interface ActiveSession {
  readonly xr: XRSession;
  readonly loaded: LoadedDeck;
  readonly timeline: Timeline;
  readonly runner: Runner;
  readonly clock: SessionClock;
  readonly recorder: SessionRecorder;
  readonly referenceSpaceType: XRReferenceSpaceType;
  stage: Stage | null;
  readonly cleanups: Array<() => void>;
}

let active: ActiveSession | null = null;
let busyStarting = false;
const bellPosition = new THREE.Vector3();

async function pickReferenceSpace(xr: XRSession): Promise<XRReferenceSpaceType> {
  try {
    await xr.requestReferenceSpace('local-floor');
    return 'local-floor';
  } catch {
    return 'local';
  }
}

function requestTargetFrameRate(xr: XRSession): void {
  const rates = xr.supportedFrameRates ? Array.from(xr.supportedFrameRates) : [];
  if (rates.includes(XR_TARGET_FRAME_RATE)) {
    xr.updateTargetFrameRate?.(XR_TARGET_FRAME_RATE).catch(() => {
      // Desteklenmezse varsayılan yenileme hızında kalınır.
    });
  }
}

async function startSession(loaded: LoadedDeck, durationMin: number): Promise<void> {
  if (active || busyStarting || !navigator.xr) return;
  busyStarting = true;
  screens.setBusy(true);
  // İkisi de kullanıcı jesti içinde başlatılır: XR oturumu ve tek AudioContext.
  const sessionRequest = navigator.xr.requestSession('immersive-vr', {
    optionalFeatures: [...XR_OPTIONAL_FEATURES],
  });
  const audioUnlock = audio.unlock();
  let xr: XRSession | null = null;
  try {
    xr = await sessionRequest;
    await audioUnlock;
    drone ??= createDrone(audio);
    bell ??= createBell(audio);

    const referenceSpaceType = await pickReferenceSpace(xr);
    renderer.xr.setReferenceSpaceType(referenceSpaceType);
    renderer.xr.setFoveation(XR_FOVEATION);
    await renderer.xr.setSession(xr);
    requestTargetFrameRate(xr);

    const durationMs = durationMin * 60_000;
    const timeline = planSession(loaded.deck, durationMs, seedFor(loaded.deck.id, durationMs));
    const runner = createRunner(timeline);
    const recorder = createSessionRecorder({
      deckId: loaded.deck.id,
      deckTitle: loaded.deck.title,
      closingQuestion: loaded.deck.closing,
      durationMs,
      date: new Date(),
    });
    const session: ActiveSession = {
      xr,
      loaded,
      timeline,
      runner,
      clock: createClock(timeScale),
      recorder,
      referenceSpaceType,
      stage: null,
      cleanups: [],
    };
    const sessionXr = xr;
    session.cleanups.push(
      bindPauseInput(xr, togglePause),
      runner.on('phaseStart', (event) => {
        environment.onPhaseStart(event.phase);
        drone?.setPlateau(event.phase.name === 'plateau');
      }),
      runner.on('promptShow', (event) => {
        promptView.show(event.prompt);
        if (event.prompt.role !== 'closing') recorder.promptShown(event.prompt.promptId);
      }),
      runner.on('bell', () => {
        if (!session.stage) return;
        const p = promptPosition(session.stage, PROMPT_START_DISTANCE_M, bellPosition);
        bell?.ring([p.x, p.y, p.z]);
      }),
      runner.on('sessionEnd', () => {
        sessionXr.end().catch(() => {
          // Oturum zaten kapanıyorsa yapılacak bir şey yok.
        });
      }),
    );
    xr.addEventListener('end', () => finishSession(session), { once: true });
    active = session;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    screens.showError(STRINGS.xrStartFailed(message));
    if (xr && !active) xr.end().catch(() => {});
  } finally {
    busyStarting = false;
    screens.setBusy(false);
  }
}

function togglePause(): void {
  const s = active;
  if (!s || !s.clock.started) return;
  if (s.clock.paused) {
    s.clock.resume();
    void audio.resume();
    pauseOverlay.setPaused(false);
  } else {
    s.clock.pause();
    audio.pause();
    pauseOverlay.setPaused(true);
    const current = s.runner.currentPrompt(s.clock.now());
    s.recorder.paused(current && current.role !== 'closing' ? current.promptId : null);
  }
}

function finishSession(s: ActiveSession): void {
  if (active !== s) return;
  active = null;
  for (const cleanup of s.cleanups) cleanup();
  promptView.clear();
  pauseOverlay.setPaused(false);
  environment.reset();
  drone?.stop();
  void audio.stop();
  resetPreviewCamera();

  if (!s.clock.started) {
    screens.showStart();
    return;
  }
  const record = s.recorder.finish(s.clock.now(), s.runner.finished);
  if (!saveSession(record)) screens.toast(STRINGS.storageUnavailable);
  screens.setSessionsCount(loadSessions().length);
  screens.showClosing({
    question: s.loaded.deck.closing,
    early: !s.runner.finished,
    onDone(answer) {
      if (answer) {
        record.closingAnswer = answer;
        screens.toast(saveSession(record) ? STRINGS.saved : STRINGS.storageUnavailable);
      }
      screens.showStart();
    },
  });
}

// ---------- Ana döngü ----------
const listenerQuat = new THREE.Quaternion();
const listenerForward = new THREE.Vector3();
const listenerUp = new THREE.Vector3();

function updateListener(transform: XRRigidTransform): void {
  const { position: p, orientation: o } = transform;
  listenerQuat.set(o.x, o.y, o.z, o.w);
  listenerForward.set(0, 0, -1).applyQuaternion(listenerQuat);
  listenerUp.set(0, 1, 0).applyQuaternion(listenerQuat);
  audio.setListenerPose(
    [p.x, p.y, p.z],
    [listenerForward.x, listenerForward.y, listenerForward.z],
    [listenerUp.x, listenerUp.y, listenerUp.z],
  );
}

function tickSession(s: ActiveSession, time: number, frame: XRFrame): void {
  const referenceSpace = renderer.xr.getReferenceSpace();
  const pose = referenceSpace ? frame.getViewerPose(referenceSpace) : undefined;

  if (!s.stage) {
    // Sahne çerçevesi, takip başladığı ilk karede bakış yönüne göre bir kez sabitlenir.
    if (!pose) return;
    const { position: p, orientation: o } = pose.transform;
    const eye = new THREE.Vector3(p.x, p.y, p.z);
    const head = new THREE.Quaternion(o.x, o.y, o.z, o.w);
    const floorY = s.referenceSpaceType === 'local-floor' ? 0 : eye.y - FALLBACK_EYE_HEIGHT_M;
    s.stage = createStage(eye, head, floorY);
    environment.setStage(s.stage);
    promptView.setStage(s.stage);
    pauseOverlay.setStage(s.stage);
    s.clock.start(time);
    audio.start();
    drone?.start();
  }

  const t = s.clock.tick(time);
  s.runner.update(t);
  const breath = breathAt(t);
  environment.update(t, breath, s.clock.lastDeltaMs);
  promptView.update(t, breath);
  pauseOverlay.update(s.clock.lastRealDeltaMs);
  audio.setSessionLevel(sessionLevelAt(t, s.timeline.phases));
  if (pose) updateListener(pose.transform);
}

let lastFrameTime: number | null = null;

function tickPreview(time: number): void {
  // 2D ekranın arkasında aynı boşluk, gerçek zamanla nefes alır.
  const realDelta = lastFrameTime === null ? 0 : Math.min(Math.max(time - lastFrameTime, 0), MAX_FRAME_DELTA_MS);
  environment.update(time, breathAt(time), realDelta);
  pauseOverlay.update(realDelta);
}

renderer.setAnimationLoop((time, frame) => {
  if (active && frame) tickSession(active, time, frame);
  else tickPreview(time);
  lastFrameTime = time;
  renderer.render(scene, camera);
});

// Konsoldan inceleme için (geliştirme).
(window as unknown as { tefekkur?: unknown }).tefekkur = {
  scene,
  renderer,
  togglePause,
  get session() {
    return active;
  },
};
