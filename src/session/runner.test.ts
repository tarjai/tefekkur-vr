// runner testleri: sıralı yayın, zaman sıçraması, abonelikten çıkma, hata yalıtımı, currentPrompt, finished.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LOCALE, SESSION_DURATIONS_MIN } from '../config';
import type { Deck } from '../deck/schema';
import { planSession } from './planner';
import { createRunner } from './runner';
import { EVENT_ORDER } from './types';
import type { PhaseName, PhaseSpan, ScheduledPrompt, Timeline, TimelineEvent, TimelineEventKind } from './types';

const ALL_KINDS = Object.keys(EVENT_ORDER) as TimelineEventKind[];

function span(name: PhaseName, startMs: number, endMs: number): PhaseSpan {
  return { name, startMs, endMs };
}

function prompt(key: string, phase: PhaseName, showMs: number): ScheduledPrompt {
  return {
    key,
    promptId: key,
    role: 'prompt',
    type: 'question',
    text: key,
    phase,
    showMs,
    arriveMs: showMs + 10,
    hideMs: showMs + 40,
    goneMs: showMs + 50,
  };
}

/** Elle kurulmuş küçük çizelge: 5 faz × 100 ms, iki prompt. */
function makeTimeline(): Timeline {
  const phases = [
    span('arrival', 0, 100),
    span('seed', 100, 200),
    span('deepening', 200, 300),
    span('plateau', 300, 400),
    span('return', 400, 500),
  ];
  const p1 = prompt('p1', 'seed', 120);
  const p2 = prompt('p2', 'return', 420);
  const events: TimelineEvent[] = [
    { kind: 'phaseStart', atMs: 0, phase: phases[0] },
    { kind: 'phaseStart', atMs: 100, phase: phases[1] },
    { kind: 'promptShow', atMs: 120, prompt: p1 },
    { kind: 'bell', atMs: 120, prompt: p1 },
    { kind: 'promptHide', atMs: 160, prompt: p1 },
    { kind: 'phaseStart', atMs: 200, phase: phases[2] },
    { kind: 'phaseStart', atMs: 300, phase: phases[3] },
    { kind: 'phaseStart', atMs: 400, phase: phases[4] },
    { kind: 'promptShow', atMs: 420, prompt: p2 },
    { kind: 'bell', atMs: 420, prompt: p2 },
    { kind: 'promptHide', atMs: 460, prompt: p2 },
    { kind: 'sessionEnd', atMs: 500 },
  ];
  return { deckId: 'test', durationMs: 500, seed: 1, phases, prompts: [p1, p2], events };
}

function recordAll(runner: ReturnType<typeof createRunner>): TimelineEvent[] {
  const seen: TimelineEvent[] = [];
  for (const kind of ALL_KINDS) runner.on(kind, (event) => seen.push(event));
  return seen;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createRunner', () => {
  it('olayları zaman ilerledikçe sırayla ve bir kez yayar', () => {
    const tl = makeTimeline();
    const runner = createRunner(tl);
    const seen = recordAll(runner);
    for (let t = 0; t <= 600; t += 7) runner.update(t);
    expect(seen).toEqual(tl.events);
  });

  it('atMs <= t olanları yayar; aynı t tekrar bir şey yaymaz', () => {
    const tl = makeTimeline();
    const runner = createRunner(tl);
    const seen = recordAll(runner);
    runner.update(119);
    expect(seen.map((e) => e.kind)).toEqual(['phaseStart', 'phaseStart']);
    runner.update(120);
    expect(seen.map((e) => e.kind)).toEqual(['phaseStart', 'phaseStart', 'promptShow', 'bell']);
    runner.update(120);
    expect(seen).toHaveLength(4);
    // Geri giden zaman yeniden yayın yapmaz.
    runner.update(0);
    expect(seen).toHaveLength(4);
  });

  it('büyük sıçrama tek çağrıda tüm olayları sırayla yayar', () => {
    const tl = makeTimeline();
    const runner = createRunner(tl);
    const seen = recordAll(runner);
    runner.update(10_000);
    expect(seen).toEqual(tl.events);
    expect(runner.finished).toBe(true);
  });

  it('türe göre süzülür ve handler doğru tipte olayı alır', () => {
    const runner = createRunner(makeTimeline());
    const shown: string[] = [];
    const phases: PhaseName[] = [];
    runner.on('promptShow', (event) => shown.push(event.prompt.key));
    runner.on('phaseStart', (event) => phases.push(event.phase.name));
    runner.update(500);
    expect(shown).toEqual(['p1', 'p2']);
    expect(phases).toEqual(['arrival', 'seed', 'deepening', 'plateau', 'return']);
  });

  it('abonelikten çıkınca handler çağrılmaz', () => {
    const runner = createRunner(makeTimeline());
    const bells: number[] = [];
    const off = runner.on('bell', (event) => bells.push(event.atMs));
    runner.update(200);
    off();
    off();
    runner.update(500);
    expect(bells).toEqual([120]);
  });

  it('aynı fonksiyonun iki aboneliği bağımsızdır', () => {
    const runner = createRunner(makeTimeline());
    const handler = vi.fn();
    const offA = runner.on('promptShow', handler);
    runner.on('promptShow', handler);
    runner.update(200);
    expect(handler).toHaveBeenCalledTimes(2);
    offA();
    runner.update(500);
    expect(handler).toHaveBeenCalledTimes(3);
  });

  it('hata fırlatan handler diğer handler ve olayları durdurmaz', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const tl = makeTimeline();
    const runner = createRunner(tl);
    runner.on('promptShow', () => {
      throw new Error('bozuk dinleyici');
    });
    const after: string[] = [];
    runner.on('promptShow', (event) => after.push(event.prompt.key));
    const seen = recordAll(runner);
    runner.update(10_000);
    expect(after).toEqual(['p1', 'p2']);
    expect(seen).toEqual(tl.events);
    expect(errorSpy).toHaveBeenCalledTimes(2);
    expect(runner.finished).toBe(true);
  });

  it('yayın sırasında abonelikten çıkma ve iç içe update sırayı bozmaz', () => {
    const tl = makeTimeline();
    const runner = createRunner(tl);
    const seen = recordAll(runner);
    const off = runner.on('phaseStart', () => {
      off();
      runner.update(10_000);
    });
    runner.update(0);
    expect(seen).toEqual(tl.events);
  });

  it('currentPrompt: showMs <= t < goneMs', () => {
    const runner = createRunner(makeTimeline());
    expect(runner.currentPrompt(0)).toBeNull();
    expect(runner.currentPrompt(119)).toBeNull();
    expect(runner.currentPrompt(120)?.key).toBe('p1');
    expect(runner.currentPrompt(169)?.key).toBe('p1');
    expect(runner.currentPrompt(170)).toBeNull();
    expect(runner.currentPrompt(300)).toBeNull();
    expect(runner.currentPrompt(420)?.key).toBe('p2');
    expect(runner.currentPrompt(469)?.key).toBe('p2');
    expect(runner.currentPrompt(470)).toBeNull();
    expect(runner.currentPrompt(10_000)).toBeNull();
  });

  it('phaseAt: [startMs, endMs) aralığı, dışında null', () => {
    const runner = createRunner(makeTimeline());
    expect(runner.phaseAt(-1)).toBeNull();
    expect(runner.phaseAt(0)?.name).toBe('arrival');
    expect(runner.phaseAt(99)?.name).toBe('arrival');
    expect(runner.phaseAt(100)?.name).toBe('seed');
    expect(runner.phaseAt(350)?.name).toBe('plateau');
    expect(runner.phaseAt(499)?.name).toBe('return');
    expect(runner.phaseAt(500)).toBeNull();
  });

  it('finished yalnızca sessionEnd yayılınca true; dinleyici içinden de görülür', () => {
    const runner = createRunner(makeTimeline());
    let seenInHandler = false;
    runner.on('sessionEnd', () => {
      seenInHandler = runner.finished;
    });
    expect(runner.finished).toBe(false);
    runner.update(499);
    expect(runner.finished).toBe(false);
    runner.update(500);
    expect(runner.finished).toBe(true);
    expect(seenInHandler).toBe(true);
  });
});

describe('createRunner + planSession', () => {
  const deck: Deck = {
    id: 'entegrasyon',
    title: 'Entegrasyon',
    locale: LOCALE,
    anchor: 'Sessizlik',
    prompts: [
      { id: 'a1', type: 'anchor', text: 'Sessizlik' },
      { id: 'p1', type: 'question', text: 'Ne duyuyorsun?' },
      { id: 'p2', type: 'sensory', text: 'Nefesin serinliği' },
      { id: 'p3', type: 'koan', text: 'Sesin sesi nerede?' },
    ],
    closing: 'Ne kaldı?',
  };

  it('gerçek çizelgeyi kare kare oynatınca tüm olaylar sırayla gelir; currentPrompt tutarlı', () => {
    const durationMs = SESSION_DURATIONS_MIN[0] * 60_000;
    const tl = planSession(deck, durationMs, 7);
    const runner = createRunner(tl);
    const seen = recordAll(runner);
    let shownNow: string | null = null;
    runner.on('promptShow', (event) => {
      shownNow = event.prompt.key;
    });
    const step = 1000;
    for (let t = 0; t <= durationMs; t += step) {
      runner.update(t);
      const current = runner.currentPrompt(t);
      if (current) expect(current.key).toBe(shownNow);
    }
    expect(seen).toEqual(tl.events);
    expect(runner.finished).toBe(true);
  });
});
