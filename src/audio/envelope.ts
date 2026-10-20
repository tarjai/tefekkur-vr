// Drone'un seans boyu ses zarfı (0..1): arrival'da fade-in, return'de fade-out. Saf; Web Audio'ya dokunmaz.
import type { PhaseSpan } from '../session/types';

/** 0..1 aralığında yumuşak geçiş (uçlarda eğim 0 → fazlar arasında kırılma yok). */
function smoothstep(u: number): number {
  const x = Math.min(1, Math.max(0, u));
  return x * x * (3 - 2 * x);
}

/** Faz içindeki ilerleme 0..1; süresi 0 olan faz tamamlanmış sayılır. */
function progress(timeMs: number, span: PhaseSpan): number {
  const length = span.endMs - span.startMs;
  return length > 0 ? (timeMs - span.startMs) / length : 1;
}

/**
 * Seans zamanındaki drone seviyesi. Başlangıçtan önce 0; arrival boyunca 0→1;
 * seed/deepening/plateau 1; return boyunca 1→0; seans sonunda ve sonrasında 0.
 * Faz listesi boşsa ya da arrival/return yoksa seans içinde 1 döner.
 */
export function sessionLevelAt(sessionTimeMs: number, phases: readonly PhaseSpan[]): number {
  if (!Number.isFinite(sessionTimeMs) || sessionTimeMs < 0) return 0;
  if (phases.length === 0) return 1;

  let endMs = -Infinity;
  let arrival: PhaseSpan | undefined;
  let ret: PhaseSpan | undefined;
  for (const span of phases) {
    endMs = Math.max(endMs, span.endMs);
    if (span.name === 'arrival') arrival = span;
    else if (span.name === 'return') ret = span;
  }
  if (sessionTimeMs >= endMs) return 0;

  if (arrival && sessionTimeMs < arrival.endMs) return smoothstep(progress(sessionTimeMs, arrival));
  if (ret && sessionTimeMs >= ret.startMs) return 1 - smoothstep(progress(sessionTimeMs, ret));
  return 1;
}
