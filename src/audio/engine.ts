// Tek AudioContext, ses grafiği ve tüm fade'ler. "VR'a Gir" tıklamasında unlock() ile kurulur.
// Grafik: droneBus → pauseGain, fxBus → pauseGain, pauseGain → master → destination.
import {
  AUDIO_LEVEL_TIME_CONSTANT_S,
  AUDIO_MASTER_GAIN,
  AUDIO_MIN_RAMP_S,
  AUDIO_PAUSE_FADE_S,
  AUDIO_STOP_TAIL_S,
} from '../config';

export type Vec3 = readonly [number, number, number];

export interface AudioEngine {
  /** unlock() çağrılana kadar null. */
  readonly ctx: AudioContext | null;
  /** Seans zarfı burada uygulanır (drone). unlock() öncesi erişim hata fırlatır. */
  readonly droneBus: GainNode;
  /** Çanlar. unlock() öncesi erişim hata fırlatır. */
  readonly fxBus: GainNode;
  /** Tıklama işleyicisinde çağrılır: ilk çağrı bağlamı + grafiği kurar, sonrakiler bağlamı sürdürür. */
  unlock(): Promise<void>;
  /** Seans başlar: pauseGain → 1 (≥ AUDIO_MIN_RAMP_S), droneBus 0'dan başlar. */
  start(): void;
  /** 0..1, her kare; setTargetAtTime ile yumuşatılır (değişim ≥ AUDIO_MIN_RAMP_S'de oturur). */
  setSessionLevel(level: number): void;
  /** Her kare XR kamerasından: dinleyici konumu ve yönelimi. */
  setListenerPose(position: Vec3, forward: Vec3, up: Vec3): void;
  /** Ses AUDIO_PAUSE_FADE_S'de kısılır, sonra bağlam askıya alınır (LFO ve sönümler donar). */
  pause(): void;
  /** Bekleyen askıya almayı iptal eder, bağlamı sürdürür, sesi ≥ AUDIO_MIN_RAMP_S'de açar. */
  resume(): Promise<void>;
  /** Seans sonu: ≥ AUDIO_MIN_RAMP_S'de kıs, sonra askıya al; bağlam sonraki seans için kalır. */
  stop(): Promise<void>;
}

interface Graph {
  readonly ctx: AudioContext;
  readonly master: GainNode;
  readonly pauseGain: GainNode;
  readonly droneBus: GainNode;
  readonly fxBus: GainNode;
}

type Mode = 'idle' | 'running' | 'paused' | 'stopped';

const MS_PER_S = 1000;
const PAUSE_FADE_S = Math.max(AUDIO_PAUSE_FADE_S, AUDIO_MIN_RAMP_S);

/**
 * Parametreyi `time` anındaki değerinde sabitler; ardından gelen rampa sıçramadan oradan başlar.
 * cancelAndHoldAtTime (atomik) varsa onu, yoksa cancelScheduledValues kullanır; her iki durumda
 * başlangıç değeri setValueAtTime ile açıkça yazılır (aksi halde rampa önceki olaydan başlar).
 */
export function holdParam(param: AudioParam, time: number): void {
  const current = param.value;
  if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(time);
  else param.cancelScheduledValues(time);
  param.setValueAtTime(current, time);
}

/** Şu anki değerden `target`a `durationS` saniyelik doğrusal rampa (sıçramasız). */
export function rampParam(param: AudioParam, target: number, startTime: number, durationS: number): void {
  holdParam(param, startTime);
  param.linearRampToValueAtTime(target, startTime + durationS);
}

function buildGraph(): Graph {
  const ctx = new AudioContext();
  const master = new GainNode(ctx, { gain: AUDIO_MASTER_GAIN });
  master.connect(ctx.destination);
  // start() gelene kadar sessiz.
  const pauseGain = new GainNode(ctx, { gain: 0 });
  pauseGain.connect(master);
  const droneBus = new GainNode(ctx, { gain: 0 });
  droneBus.connect(pauseGain);
  const fxBus = new GainNode(ctx, { gain: 1 });
  fxBus.connect(pauseGain);
  return { ctx, master, pauseGain, droneBus, fxBus };
}

function isFiniteVec(v: Vec3): boolean {
  return Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2]);
}

function clampLevel(level: number): number {
  return Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0;
}

export function createAudioEngine(): AudioEngine {
  let graph: Graph | null = null;
  let mode: Mode = 'idle';
  let lastLevel = 0;
  /** Bekleyen askıya alma: iptal edilince ya da tamamlanınca `settle` çağrılır. */
  let pendingSuspend: { timer: ReturnType<typeof setTimeout>; settle: () => void } | null = null;

  function requireGraph(): Graph {
    if (!graph) throw new Error('AudioEngine: unlock() çağrılmadan ses grafiği kullanılamaz.');
    return graph;
  }

  function cancelSuspend(): void {
    if (!pendingSuspend) return;
    clearTimeout(pendingSuspend.timer);
    const { settle } = pendingSuspend;
    pendingSuspend = null;
    settle();
  }

  /** Fade bitince (gerçek zaman, +pay) bağlamı askıya alır; bu arada mod değişirse vazgeçer. */
  function suspendAfter(g: Graph, delayS: number, expected: Mode): Promise<void> {
    cancelSuspend();
    return new Promise<void>((resolve) => {
      const timer = setTimeout(
        () => {
          pendingSuspend = null;
          if (mode !== expected || g.ctx.state !== 'running') {
            resolve();
            return;
          }
          g.ctx.suspend().then(
            () => resolve(),
            () => resolve(),
          );
        },
        (delayS + AUDIO_STOP_TAIL_S) * MS_PER_S,
      );
      pendingSuspend = { timer, settle: resolve };
    });
  }

  function resumeContext(g: Graph): Promise<void> {
    return g.ctx.state === 'suspended' ? g.ctx.resume() : Promise.resolve();
  }

  return {
    get ctx() {
      return graph ? graph.ctx : null;
    },

    get droneBus() {
      return requireGraph().droneBus;
    },

    get fxBus() {
      return requireGraph().fxBus;
    },

    unlock() {
      // Bağlam kullanıcı jesti içinde, ilk await'ten önce senkron kurulur.
      if (!graph) graph = buildGraph();
      cancelSuspend();
      return resumeContext(graph);
    },

    start() {
      if (!graph) return;
      cancelSuspend();
      mode = 'running';
      void resumeContext(graph);
      const now = graph.ctx.currentTime;
      // pauseGain henüz 0 iken (ilk açılış / stop sonrası) zarf 0'dan başlar.
      graph.droneBus.gain.cancelScheduledValues(now);
      graph.droneBus.gain.setValueAtTime(0, now);
      lastLevel = 0;
      rampParam(graph.pauseGain.gain, 1, now, AUDIO_MIN_RAMP_S);
    },

    setSessionLevel(level) {
      if (!graph) return;
      const target = clampLevel(level);
      if (target === lastLevel) return;
      lastLevel = target;
      // Ardışık setTargetAtTime olayları bir öncekinin o anki değerinden devam eder; sıçrama olmaz.
      graph.droneBus.gain.setTargetAtTime(target, graph.ctx.currentTime, AUDIO_LEVEL_TIME_CONSTANT_S);
    },

    setListenerPose(position, forward, up) {
      if (!graph || !isFiniteVec(position) || !isFiniteVec(forward) || !isFiniteVec(up)) return;
      const listener = graph.ctx.listener;
      // Firefox'ta AudioParam alanları yok; eski setPosition/setOrientation kullanılır.
      const positionX = listener.positionX as AudioParam | undefined;
      if (positionX === undefined) {
        listener.setPosition(position[0], position[1], position[2]);
        listener.setOrientation(forward[0], forward[1], forward[2], up[0], up[1], up[2]);
        return;
      }
      const t = graph.ctx.currentTime;
      positionX.setValueAtTime(position[0], t);
      listener.positionY.setValueAtTime(position[1], t);
      listener.positionZ.setValueAtTime(position[2], t);
      listener.forwardX.setValueAtTime(forward[0], t);
      listener.forwardY.setValueAtTime(forward[1], t);
      listener.forwardZ.setValueAtTime(forward[2], t);
      listener.upX.setValueAtTime(up[0], t);
      listener.upY.setValueAtTime(up[1], t);
      listener.upZ.setValueAtTime(up[2], t);
    },

    pause() {
      if (!graph || mode !== 'running') return;
      mode = 'paused';
      rampParam(graph.pauseGain.gain, 0, graph.ctx.currentTime, PAUSE_FADE_S);
      void suspendAfter(graph, PAUSE_FADE_S, 'paused');
    },

    resume() {
      if (!graph || mode !== 'paused') return Promise.resolve();
      mode = 'running';
      cancelSuspend();
      // Askıdaysa currentTime donmuştur; rampa sürdürmeden sonra bu andan itibaren işler.
      rampParam(graph.pauseGain.gain, 1, graph.ctx.currentTime, AUDIO_MIN_RAMP_S);
      return resumeContext(graph);
    },

    stop() {
      if (!graph || mode === 'stopped') return Promise.resolve();
      mode = 'stopped';
      cancelSuspend();
      // Duraklatmada zaten askıya alındıysa ses 0'da; yapılacak bir şey yok.
      if (graph.ctx.state !== 'running') return Promise.resolve();
      rampParam(graph.pauseGain.gain, 0, graph.ctx.currentTime, AUDIO_MIN_RAMP_S);
      return suspendAfter(graph, AUDIO_MIN_RAMP_S, 'stopped');
    },
  };
}
