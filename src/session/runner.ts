// Çizelgeyi seans zamanına göre oynatır ve olay yayar. Sahne, ses ve günlük on() ile dinler;
// runner onlara dokunmaz.
import type {
  PhaseSpan,
  ScheduledPrompt,
  Timeline,
  TimelineEvent,
  TimelineEventKind,
  TimelineEventOf,
} from './types';

export interface Runner {
  /** Olay türüne abone olur; dönen fonksiyon aboneliği kaldırır. */
  on<K extends TimelineEventKind>(kind: K, handler: (event: TimelineEventOf<K>) => void): () => void;
  /** atMs <= sessionTimeMs olan, henüz yayılmamış tüm olayları çizelge sırasıyla yayar. */
  update(sessionTimeMs: number): void;
  /** showMs <= t < goneMs olan prompt (sahnedeki mesh), yoksa null. */
  currentPrompt(sessionTimeMs: number): ScheduledPrompt | null;
  /** startMs <= t < endMs olan faz, yoksa null. */
  phaseAt(sessionTimeMs: number): PhaseSpan | null;
  /** sessionEnd yayıldıktan sonra true. */
  readonly finished: boolean;
}

type AnyHandler = (event: TimelineEvent) => void;

export function createRunner(timeline: Timeline): Runner {
  const { events, prompts, phases } = timeline;
  const handlers = new Map<TimelineEventKind, Set<AnyHandler>>();
  let cursor = 0;
  let target = -Infinity;
  let draining = false;
  let finished = false;

  function dispatch(event: TimelineEvent): void {
    const set = handlers.get(event.kind);
    if (!set) return;
    // Kopya üzerinde döner: dinleyici yayın sırasında abonelikten çıkabilir.
    for (const handler of [...set]) {
      try {
        handler(event);
      } catch (error) {
        console.error(`[runner] ${event.kind} dinleyicisi hata verdi`, error);
      }
    }
  }

  /** prompts showMs'e göre sıralı ve çakışmasız: son başlamış prompt'u ikili aramayla bulur. */
  function currentPrompt(sessionTimeMs: number): ScheduledPrompt | null {
    let lo = 0;
    let hi = prompts.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (prompts[mid].showMs <= sessionTimeMs) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (found < 0) return null;
    const prompt = prompts[found];
    return sessionTimeMs < prompt.goneMs ? prompt : null;
  }

  return {
    get finished() {
      return finished;
    },
    on(kind, handler) {
      const set = handlers.get(kind) ?? new Set<AnyHandler>();
      handlers.set(kind, set);
      // Her abonelik ayrı sarmalayıcı: aynı fonksiyon iki kez abone olursa ikisi de bağımsız çalışır.
      const call = handler as AnyHandler;
      const entry: AnyHandler = (event) => call(event);
      set.add(entry);
      return () => {
        set.delete(entry);
      };
    },
    update(sessionTimeMs) {
      target = Math.max(target, sessionTimeMs);
      // Dinleyici içinden çağrılırsa yalnızca hedefi ilerletir; sıra bozulmaz.
      if (draining) return;
      draining = true;
      try {
        while (cursor < events.length && events[cursor].atMs <= target) {
          const event = events[cursor++];
          if (event.kind === 'sessionEnd') finished = true;
          dispatch(event);
        }
      } finally {
        draining = false;
      }
    },
    currentPrompt,
    phaseAt(sessionTimeMs) {
      return phases.find((p) => p.startMs <= sessionTimeMs && sessionTimeMs < p.endMs) ?? null;
    },
  };
}
