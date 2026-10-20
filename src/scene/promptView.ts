// Tek prompt'un görsel yaşam döngüsü: derinlikten yaklaşır, okuma noktasında nefesle bekler, geri çekilir.
// Sahnede aynı anda en fazla 1 prompt mesh'i; kaldırılanın geometri, materyal ve troika nesnesi serbest bırakılır.
import * as THREE from 'three';
import { Text, preloadFont } from 'troika-three-text';
import {
  COLORS,
  PROMPT_BREATH_BLEND_S,
  PROMPT_BREATH_SCALE,
  PROMPT_MAX_LINES,
  PROMPT_READ_DISTANCE_M,
  PROMPT_RENDER_ORDER,
  PROMPT_SHRINK_MARGIN,
  PROMPT_START_DISTANCE_M,
  TEXT_ANGULAR_SIZE_DEG,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_WIDTH_EM,
  TEXT_MIN_ANGULAR_SIZE_DEG,
} from '../config';
import type { ScheduledPrompt } from '../session/types';
import { createPreviewStage } from './environment';
import { promptPosition, type Stage } from './stage';

export interface PromptPose {
  visible: boolean;
  distanceM: number;
  opacity: number;
  scale: number;
}

export interface PromptView {
  setStage(stage: Stage): void;
  show(prompt: ScheduledPrompt): void;
  update(sessionTimeMs: number, breath: number): void;
  clear(): void;
  readonly currentKey: string | null;
  dispose(): void;
}

const BREATH_BLEND_MS = PROMPT_BREATH_BLEND_S * 1000;

// ---------- Saf matematik (troika'ya dokunmaz, test edilir) ----------

/** [0,1] üzerinde yumuşak ease-in-out (sinüs); girdi sıkıştırılır. f(0)=0, f(0.5)=0.5, f(1)=1. */
export function easeInOut(x: number): number {
  return 0.5 - 0.5 * Math.cos(Math.PI * THREE.MathUtils.clamp(x, 0, 1));
}

/** `distanceM` uzaklıkta `angleDeg` açısal boyut veren yükseklik: 2·d·tan(θ/2). */
export function fontSizeForAngle(distanceM: number, angleDeg: number): number {
  return 2 * distanceM * Math.tan(THREE.MathUtils.degToRad(angleDeg) / 2);
}

/** Okuma mesafesinde kuralın izin verdiği en küçük yazı boyutu (TEXT_MIN_ANGULAR_SIZE_DEG). */
export const PROMPT_MIN_FONT_SIZE_M = fontSizeForAngle(PROMPT_READ_DISTANCE_M, TEXT_MIN_ANGULAR_SIZE_DEG);
/** Prompt yazı boyutu; minimum açısal boyutun altına inmez. */
export const PROMPT_FONT_SIZE_M = Math.max(
  fontSizeForAngle(PROMPT_READ_DISTANCE_M, TEXT_ANGULAR_SIZE_DEG),
  PROMPT_MIN_FONT_SIZE_M,
);

/** Alıntının sonundaki atıf: "metin — Ad". troika tireden sonra da satır kırabildiği için tire satır sonunda kalabilir. */
const ATTRIBUTION_RE = /^(.*\S)\s+—\s+(\S.*)$/u;

/** Görüntülenecek metin: atıf varsa kendi satırına alınır ("metin\n— Ad"); yoksa olduğu gibi. Harf dönüşümü yok. */
export function displayText(text: string): string {
  const match = ATTRIBUTION_RE.exec(text);
  return match ? `${match[1]}\n— ${match[2]}` : text;
}

/** Yerleşim bloğunun yüksekliğinden satır sayısı tahmini. */
export function estimateLineCount(blockHeight: number, fontSize: number): number {
  return Math.round(blockHeight / (fontSize * TEXT_LINE_HEIGHT));
}

/** PROMPT_MAX_LINES'ı aşan metin için küçültülmüş yazı boyutu (satır genişliği sabit kalır); `minFontSize` altına inmez. */
export function shrinkFontSize(fontSize: number, lineCount: number, minFontSize: number): number {
  if (lineCount <= PROMPT_MAX_LINES) return fontSize;
  return Math.max(minFontSize, (fontSize * PROMPT_MAX_LINES * PROMPT_SHRINK_MARGIN) / lineCount);
}

function progress(t: number, startMs: number, endMs: number): number {
  return endMs > startMs ? THREE.MathUtils.clamp((t - startMs) / (endMs - startMs), 0, 1) : 1;
}

/**
 * Saf: prompt'un seans zamanındaki pozu.
 * showMs öncesi ve goneMs sonrası görünmez; yaklaşma 12 → 2 m (opaklık 0 → 1), bekleme 2 m
 * (nefes ölçeği ±%2, varışta ve ayrılışta PROMPT_BREATH_BLEND_S içinde yumuşakça devreye girer),
 * geri çekilme 2 → 12 m (opaklık 1 → 0).
 */
export function promptPose(prompt: ScheduledPrompt, sessionTimeMs: number, breath: number): PromptPose {
  const t = sessionTimeMs;
  if (t < prompt.showMs || t >= prompt.goneMs) {
    return { visible: false, distanceM: PROMPT_START_DISTANCE_M, opacity: 0, scale: 1 };
  }
  if (t < prompt.arriveMs) {
    const p = easeInOut(progress(t, prompt.showMs, prompt.arriveMs));
    return {
      visible: true,
      distanceM: THREE.MathUtils.lerp(PROMPT_START_DISTANCE_M, PROMPT_READ_DISTANCE_M, p),
      opacity: p,
      scale: 1,
    };
  }
  if (t < prompt.hideMs) {
    const edgeMs = Math.min(t - prompt.arriveMs, prompt.hideMs - t);
    const w = BREATH_BLEND_MS > 0 ? THREE.MathUtils.clamp(edgeMs / BREATH_BLEND_MS, 0, 1) : 1;
    return {
      visible: true,
      distanceM: PROMPT_READ_DISTANCE_M,
      opacity: 1,
      scale: 1 + PROMPT_BREATH_SCALE * (2 * breath - 1) * w,
    };
  }
  const q = easeInOut(progress(t, prompt.hideMs, prompt.goneMs));
  return {
    visible: true,
    distanceM: THREE.MathUtils.lerp(PROMPT_READ_DISTANCE_M, PROMPT_START_DISTANCE_M, q),
    opacity: 1 - q,
    scale: 1,
  };
}

// ---------- Görünüm ----------

interface ActivePrompt {
  readonly prompt: ScheduledPrompt;
  readonly text: Text;
  /** troika'nın türettiği materyalin tabanı; dispose edilince türetilen de serbest kalır. */
  readonly material: THREE.MeshBasicMaterial;
}

/** troika `preloadFont` sarmalayıcısı: fontu ve glifleri seans başlamadan hazırlar. URL mutlak olmalı (Worker). */
export function preloadPromptFont(fontUrl: string, characters: string, onReady?: () => void): void {
  // troika geri çağrıyı koşulsuz çağırır; verilmezse boş fonksiyon.
  preloadFont({ font: fontUrl, characters }, onReady ?? (() => {}));
}

/** `fontUrl` mutlak olmalı: troika fontu Web Worker içinde indirir, göreli URL orada bozulur. */
export function createPromptView(scene: THREE.Scene, fontUrl: string): PromptView {
  let stage: Stage = createPreviewStage();
  let active: ActivePrompt | null = null;

  function disposeActive(): void {
    if (!active) return;
    scene.remove(active.text);
    active.text.dispose();
    active.material.dispose();
    active = null;
  }

  function lineCountOf(entry: ActivePrompt, fontSize: number): number | null {
    const info = entry.text.textRenderInfo;
    if (!info) return null;
    return estimateLineCount(info.blockBounds[3] - info.blockBounds[1], fontSize);
  }

  function warnTooManyLines(entry: ActivePrompt, lines: number): void {
    console.warn(`Prompt "${entry.prompt.key}" ${PROMPT_MAX_LINES} satıra sığmadı (${lines} satır).`);
  }

  // En fazla 2 satır: taşarsa yazı boyutu minimum açısal boyuta doğru küçültülür, bir kez yeniden dizilir.
  function fitLines(entry: ActivePrompt): void {
    if (active !== entry) return; // bu arada kaldırıldı
    const lines = lineCountOf(entry, PROMPT_FONT_SIZE_M);
    if (lines === null || lines <= PROMPT_MAX_LINES) return;
    const smaller = shrinkFontSize(PROMPT_FONT_SIZE_M, lines, PROMPT_MIN_FONT_SIZE_M);
    if (smaller >= PROMPT_FONT_SIZE_M) {
      warnTooManyLines(entry, lines);
      return;
    }
    entry.text.fontSize = smaller; // maxWidth metre olarak sabit → satıra daha çok karakter sığar
    entry.text.sync(() => {
      if (active !== entry) return;
      const after = lineCountOf(entry, smaller);
      if (after !== null && after > PROMPT_MAX_LINES) warnTooManyLines(entry, after);
    });
  }

  function show(prompt: ScheduledPrompt): void {
    if (active?.prompt.key === prompt.key) return; // aynı prompt zaten sahnede
    disposeActive();

    const material = new THREE.MeshBasicMaterial({
      color: COLORS.text,
      transparent: true,
      depthWrite: false,
      fog: true,
      side: THREE.DoubleSide,
    });
    const text = new Text();
    text.text = displayText(prompt.text); // büyük/küçük harf dönüşümü yok
    text.font = fontUrl;
    text.fontSize = PROMPT_FONT_SIZE_M;
    text.maxWidth = PROMPT_FONT_SIZE_M * TEXT_MAX_WIDTH_EM;
    text.lineHeight = TEXT_LINE_HEIGHT;
    text.textAlign = 'center';
    text.anchorX = 'center';
    text.anchorY = 'middle';
    text.color = COLORS.text;
    text.material = material;
    text.fillOpacity = 0; // opaklık uniform ile değişir, yeniden dizme gerekmez
    text.renderOrder = PROMPT_RENDER_ORDER;
    text.visible = false; // ilk update'e kadar
    promptPosition(stage, PROMPT_START_DISTANCE_M, text.position);
    text.quaternion.copy(stage.promptQuaternion);
    scene.add(text);

    const entry: ActivePrompt = { prompt, text, material };
    active = entry;
    // Dizme Worker'da sürer; bu sırada prompt 12 m'de ve neredeyse saydam olduğundan gecikme görünmez.
    text.sync(() => fitLines(entry));
  }

  function update(sessionTimeMs: number, breath: number): void {
    if (!active) return;
    const { prompt, text } = active;
    if (sessionTimeMs >= prompt.goneMs) {
      disposeActive();
      return;
    }
    const pose = promptPose(prompt, sessionTimeMs, breath);
    text.visible = pose.visible && pose.opacity > 0;
    if (!text.visible) return;
    promptPosition(stage, pose.distanceM, text.position);
    text.quaternion.copy(stage.promptQuaternion); // göze dönük, seans boyunca sabit
    text.scale.setScalar(pose.scale);
    text.fillOpacity = pose.opacity;
  }

  function setStage(next: Stage): void {
    stage = next;
    if (active) active.text.quaternion.copy(stage.promptQuaternion);
  }

  return {
    setStage,
    show,
    update,
    clear: disposeActive,
    get currentKey(): string | null {
      return active ? active.prompt.key : null;
    },
    dispose: disposeActive,
  };
}
