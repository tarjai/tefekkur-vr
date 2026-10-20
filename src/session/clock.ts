// Seans saati: gerçek zamandan (XR kare zamanı, ms) seans zamanını türetir.
// timeScale (`?speed=N`) ve duraklatma destekli; animasyon ve ses bu saate bağlıdır.
import { MAX_FRAME_DELTA_MS, SPEED_MAX, SPEED_MIN, SPEED_PARAM } from '../config';

/** Normal hız: gerçek zaman = seans zamanı. */
const NORMAL_SPEED = 1;

export interface SessionClock {
  /** Gerçek süre → seans süresi çarpanı. */
  readonly timeScale: number;
  readonly paused: boolean;
  readonly started: boolean;
  /** Saati sıfırdan, çalışır durumda başlatır; `nowMs` gerçek zaman damgası. */
  start(nowMs: number): void;
  /** Her karede çağrılır; güncel seans zamanını (ms) döndürür. start() öncesi 0. */
  tick(nowMs: number): number;
  /** Saati dondurur (ses ve animasyonlar da donar). */
  pause(): void;
  resume(): void;
  /** Son tick'teki seans zamanı, ms. */
  now(): number;
  /** Son tick'te ilerleyen seans süresi (duraklatmada 0), ms. */
  readonly lastDeltaMs: number;
  /** Son tick'teki kırpılmış gerçek süre (duraklatmada da akar; gerçek zamanlı UI geçişleri için), ms. */
  readonly lastRealDeltaMs: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Sonlu ve pozitifse [SPEED_MIN, SPEED_MAX] aralığına kırpar, değilse normal hız. */
function sanitizeScale(value: number): number {
  return Number.isFinite(value) && value > 0 ? clamp(value, SPEED_MIN, SPEED_MAX) : NORMAL_SPEED;
}

/** `location.search` metninden `?speed=N` okur; geçersiz ya da yoksa 1. */
export function parseTimeScale(search: string): number {
  const raw = new URLSearchParams(search).get(SPEED_PARAM);
  if (raw === null || raw.trim() === '') return NORMAL_SPEED;
  return sanitizeScale(Number(raw));
}

export function createClock(timeScale: number = NORMAL_SPEED): SessionClock {
  const scale = sanitizeScale(timeScale);
  let started = false;
  let paused = false;
  let lastNow = 0;
  let elapsed = 0;
  let lastDelta = 0;
  let lastRealDelta = 0;

  return {
    get timeScale() {
      return scale;
    },
    get paused() {
      return paused;
    },
    get started() {
      return started;
    },
    get lastDeltaMs() {
      return lastDelta;
    },
    get lastRealDeltaMs() {
      return lastRealDelta;
    },
    start(nowMs) {
      started = true;
      paused = false;
      lastNow = nowMs;
      elapsed = 0;
      lastDelta = 0;
      lastRealDelta = 0;
    },
    tick(nowMs) {
      if (!started) return 0;
      const raw = nowMs - lastNow;
      // Geri giden ya da uzun sıçrayan zaman (gözlük çıkarıldı, sekme arkada) kırpılır.
      const real = Number.isFinite(raw) ? clamp(raw, 0, MAX_FRAME_DELTA_MS) : 0;
      if (Number.isFinite(nowMs)) lastNow = nowMs;
      lastRealDelta = real;
      lastDelta = paused ? 0 : real * scale;
      elapsed += lastDelta;
      return elapsed;
    },
    pause() {
      paused = true;
    },
    resume() {
      paused = false;
    },
    now() {
      return elapsed;
    },
  };
}
