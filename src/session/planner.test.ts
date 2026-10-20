// planner birim testleri: olay sırası, %40 kısıtı, faz oranları, sessizlikler, kesme ve determinizm.
import { describe, expect, it } from 'vitest';
import {
  ALIGN_TO_BREATH,
  ANCHOR_REPEAT_EVERY,
  APPROACH_S,
  BREATH_PERIOD_S,
  DEEPENING_VISIBLE_MAX_RATIO,
  HOLD_SECONDS,
  LOCALE,
  MIN_EDGE_SILENCE_S,
  PHASE_ORDER,
  PHASE_RATIOS,
  RETREAT_S,
  SESSION_DURATIONS_MIN,
  SILENCE_FACTOR_MAX,
  SILENCE_FACTOR_MIN,
} from '../config';
import { DeckSchema, type Deck, type PromptType } from '../deck/schema';
import { planSession, seedFor } from './planner';
import { CLOSING_ID, EVENT_ORDER, SYNTHETIC_ANCHOR_ID } from './types';
import type { PhaseName, PhaseSpan, ScheduledPrompt, Timeline } from './types';

const MS_PER_S = 1000;
const MS_PER_MIN = 60 * MS_PER_S;
const APPROACH_MS = APPROACH_S * MS_PER_S;
const RETREAT_MS = RETREAT_S * MS_PER_S;
const BREATH_MS = BREATH_PERIOD_S * MS_PER_S;
const EDGE_MS = MIN_EDGE_SILENCE_S * MS_PER_S;
const DURATIONS_MS = SESSION_DURATIONS_MIN.map((m) => m * MS_PER_MIN);
const SEED = 12345;

/** Tip dağılımı hedefe yakın, karışık içerik deseni. */
const CONTENT_PATTERN: readonly Exclude<PromptType, 'anchor'>[] = [
  'question', 'sensory', 'koan', 'question', 'quote',
  'sensory', 'question', 'koan', 'quote', 'question',
  'sensory', 'question', 'koan', 'quote', 'sensory',
  'question', 'koan', 'question', 'sensory', 'quote',
];

function makeDeck(id: string, contentCount: number, anchorAt: number | null): Deck {
  const prompts: Deck['prompts'] = [];
  for (let i = 0; i < contentCount; i++) {
    prompts.push({
      id: `p${String(i + 1).padStart(2, '0')}`,
      type: CONTENT_PATTERN[i % CONTENT_PATTERN.length],
      text: `${i + 1}. düşünce: şu an ne görüyorsun?`,
    });
  }
  if (anchorAt !== null) prompts.splice(anchorAt, 0, { id: 'a00', type: 'anchor', text: 'Zaman' });
  return { id, title: 'Deneme', locale: LOCALE, anchor: 'Zaman', prompts, closing: 'Ne kaldı?' };
}

/** Gerçekçi 48 prompt'luk deste (47 içerik + 1 anchor), şemadan geçer. */
const DECK_48 = DeckSchema.parse(makeDeck('deste-48', 47, 0));
/** 80 prompt'luk deste (79 içerik + 1 anchor, anchor ortada). */
const DECK_80 = DeckSchema.parse(makeDeck('deste-80', 79, 7));
/** Şemayı atlayan minik deste: yalnızca 3 içerik prompt'u + 1 anchor. */
const DECK_TINY = makeDeck('minik', 3, 1);

const DECKS = { 'deste-48': DECK_48, 'deste-80': DECK_80, minik: DECK_TINY } as const;

function phaseOf(tl: Timeline, name: PhaseName): PhaseSpan {
  const span = tl.phases.find((p) => p.name === name);
  if (!span) throw new Error(`faz yok: ${name}`);
  return span;
}

function inPhase(tl: Timeline, name: PhaseName): ScheduledPrompt[] {
  return tl.prompts.filter((p) => p.phase === name);
}

function holdOf(p: ScheduledPrompt): number {
  return p.hideMs - p.arriveMs;
}

function contentIds(deck: Deck): string[] {
  return deck.prompts.filter((p) => p.type !== 'anchor').map((p) => p.id);
}

/** Her süre ve destede geçerli olması gereken genel değişmezler. */
function expectGeneralInvariants(tl: Timeline): void {
  // Olaylar: atMs artan, eşitlikte EVENT_ORDER.
  for (let i = 1; i < tl.events.length; i++) {
    const a = tl.events[i - 1];
    const b = tl.events[i];
    expect(a.atMs).toBeLessThanOrEqual(b.atMs);
    if (a.atMs === b.atMs) expect(EVENT_ORDER[a.kind]).toBeLessThanOrEqual(EVENT_ORDER[b.kind]);
  }
  // sessionEnd tek ve en sonda.
  const last = tl.events[tl.events.length - 1];
  expect(last).toEqual({ kind: 'sessionEnd', atMs: tl.durationMs });
  expect(tl.events.filter((e) => e.kind === 'sessionEnd')).toHaveLength(1);

  // Fazlar bitişik, 0'dan durationMs'e.
  expect(tl.phases.map((p) => p.name)).toEqual([...PHASE_ORDER]);
  expect(tl.phases[0].startMs).toBe(0);
  expect(tl.phases[tl.phases.length - 1].endMs).toBe(tl.durationMs);
  for (let i = 1; i < tl.phases.length; i++) expect(tl.phases[i].startMs).toBe(tl.phases[i - 1].endMs);

  // Prompt'lar: tam sayı zamanlar, tutarlı yaşam döngüsü, benzersiz anahtar.
  expect(new Set(tl.prompts.map((p) => p.key)).size).toBe(tl.prompts.length);
  for (const p of tl.prompts) {
    for (const t of [p.showMs, p.arriveMs, p.hideMs, p.goneMs]) expect(Number.isInteger(t)).toBe(true);
    expect(p.arriveMs - p.showMs).toBe(APPROACH_MS);
    expect(p.goneMs - p.hideMs).toBe(RETREAT_MS);
    expect(holdOf(p)).toBeGreaterThanOrEqual(0);
    expect(p.key.startsWith(`${p.phase}:`)).toBe(true);
    // Fazın içinde.
    const span = phaseOf(tl, p.phase);
    expect(p.showMs).toBeGreaterThanOrEqual(span.startMs);
    expect(p.goneMs).toBeLessThanOrEqual(span.endMs);
  }
  // Çakışma yok (aynı anda en fazla 1 mesh) ve showMs'e göre sıralı.
  for (let i = 1; i < tl.prompts.length; i++) {
    expect(tl.prompts[i].showMs).toBeGreaterThan(tl.prompts[i - 1].goneMs);
  }
  // arrival ve plateau'da prompt yok.
  expect(inPhase(tl, 'arrival')).toHaveLength(0);
  expect(inPhase(tl, 'plateau')).toHaveLength(0);

  // %40 kısıtı.
  const deep = phaseOf(tl, 'deepening');
  const visible = inPhase(tl, 'deepening').reduce((s, p) => s + (p.goneMs - p.showMs), 0);
  expect(visible).toBeLessThanOrEqual(DEEPENING_VISIBLE_MAX_RATIO * (deep.endMs - deep.startMs));

  // deepening'de sessizlik ≥ 1.2 × önceki prompt'un beklemesi (seed anchor'ından geçiş dahil).
  const seedAndDeep = [...inPhase(tl, 'seed'), ...inPhase(tl, 'deepening')];
  for (let i = 1; i < seedAndDeep.length; i++) {
    const prev = seedAndDeep[i - 1];
    if (seedAndDeep[i].phase !== 'deepening') continue;
    expect(seedAndDeep[i].showMs - prev.goneMs).toBeGreaterThanOrEqual(SILENCE_FACTOR_MIN * holdOf(prev));
  }

  // Her promptShow'dan hemen sonra aynı anda aynı prompt için bell; show/hide sayıları eşit.
  tl.events.forEach((e, i) => {
    if (e.kind !== 'promptShow') return;
    const next = tl.events[i + 1];
    expect(next.kind).toBe('bell');
    expect(next.atMs).toBe(e.atMs);
    if (next.kind === 'bell') expect(next.prompt.key).toBe(e.prompt.key);
  });
  expect(tl.events.filter((e) => e.kind === 'promptShow')).toHaveLength(tl.prompts.length);
  expect(tl.events.filter((e) => e.kind === 'bell')).toHaveLength(tl.prompts.length);
  expect(tl.events.filter((e) => e.kind === 'promptHide')).toHaveLength(tl.prompts.length);
  for (const e of tl.events) {
    if (e.kind === 'promptHide') expect(e.atMs).toBe(e.prompt.hideMs);
    if (e.kind === 'promptShow' || e.kind === 'bell') expect(e.atMs).toBe(e.prompt.showMs);
  }
}

/** 30/45/60 dk seanslarda ek olarak geçerli olan yapı kuralları. */
function expectFullSessionStructure(tl: Timeline, deck: Deck): void {
  const anchorId = deck.prompts.find((p) => p.type === 'anchor')?.id ?? SYNTHETIC_ANCHOR_ID;

  // seed: tam olarak bir anchor, tam beklemeyle, kenarlarda en az MIN_EDGE sessizlik.
  const seed = inPhase(tl, 'seed');
  expect(seed).toHaveLength(1);
  expect(seed[0]).toMatchObject({ role: 'anchor', type: 'anchor', promptId: anchorId });
  expect(holdOf(seed[0])).toBe(HOLD_SECONDS.anchor * MS_PER_S);
  const seedSpan = phaseOf(tl, 'seed');
  expect(seed[0].showMs - seedSpan.startMs).toBeGreaterThanOrEqual(EDGE_MS);
  expect(seedSpan.endMs - seed[0].goneMs).toBeGreaterThanOrEqual(EDGE_MS);
  // Ortalanmış: hizalama en fazla bir nefes döngüsü kaydırır → kenar farkı ≤ 2 döngü (+1 ms yuvarlama).
  const lead = seed[0].showMs - seedSpan.startMs;
  const tail = seedSpan.endMs - seed[0].goneMs;
  expect(Math.abs(lead - tail)).toBeLessThanOrEqual(2 * BREATH_MS + 1);
  if (ALIGN_TO_BREATH) expect(seed[0].showMs % BREATH_MS).toBe(0);

  // return: anchor sonra closing; closing seansın son prompt'u; kenarlar ≥ MIN_EDGE.
  const ret = inPhase(tl, 'return');
  expect(ret.map((p) => p.role)).toEqual(['anchor', 'closing']);
  expect(ret[0]).toMatchObject({ type: 'anchor', promptId: anchorId });
  expect(ret[1]).toMatchObject({ type: 'closing', promptId: CLOSING_ID, text: deck.closing });
  expect(tl.prompts[tl.prompts.length - 1]).toBe(ret[1]);
  const retSpan = phaseOf(tl, 'return');
  expect(ret[0].showMs - retSpan.startMs).toBeGreaterThanOrEqual(EDGE_MS);
  expect(ret[1].showMs - ret[0].goneMs).toBeGreaterThanOrEqual(EDGE_MS);
  expect(retSpan.endMs - ret[1].goneMs).toBeGreaterThanOrEqual(EDGE_MS);

  // deepening: içerik destenin öneki, tekrarsız; her 5 içerikten sonra anchor.
  const deep = inPhase(tl, 'deepening');
  expect(deep.length).toBeGreaterThan(0);
  const shownContent = deep.filter((p) => p.role === 'prompt').map((p) => p.promptId);
  expect(new Set(shownContent).size).toBe(shownContent.length);
  expect(shownContent).toEqual(contentIds(deck).slice(0, shownContent.length));
  let sinceAnchor = 0;
  for (const p of deep) {
    if (p.role === 'anchor') {
      expect(p.promptId).toBe(anchorId);
      expect(sinceAnchor).toBe(ANCHOR_REPEAT_EVERY);
      sinceAnchor = 0;
    } else {
      expect(p.role).toBe('prompt');
      expect(sinceAnchor).toBeLessThan(ANCHOR_REPEAT_EVERY);
      sinceAnchor++;
    }
    // deepening'de beklemeler kısaltılmaz.
    expect(holdOf(p)).toBe(HOLD_SECONDS[p.type] * MS_PER_S);
  }
  // Önek sonunda 5 içerik tamamlandıysa ve yer varsa sıradaki anchor'dır; sayım tutarlı.
  const expectedAnchors = Math.floor(shownContent.length / ANCHOR_REPEAT_EVERY);
  const anchors = deep.filter((p) => p.role === 'anchor').length;
  expect(anchors === expectedAnchors || anchors === expectedAnchors - 1).toBe(true);
}

describe('planSession — fazlar ve olay sırası', () => {
  it.each(DURATIONS_MS)('5 phaseStart doğru oranlarla, sessionEnd en sonda (%d ms)', (durationMs) => {
    const tl = planSession(DECK_48, durationMs, SEED);
    const starts = tl.events.filter((e) => e.kind === 'phaseStart');
    expect(starts.map((e) => (e.kind === 'phaseStart' ? e.phase.name : null))).toEqual([...PHASE_ORDER]);
    let cumulative = 0;
    PHASE_ORDER.forEach((name, i) => {
      const span = tl.phases[i];
      expect(span.name).toBe(name);
      expect(Math.abs(span.startMs - cumulative * durationMs)).toBeLessThanOrEqual(1);
      expect(starts[i].atMs).toBe(span.startMs);
      cumulative += PHASE_RATIOS[name];
      expect(Math.abs(span.endMs - Math.min(cumulative, 1) * durationMs)).toBeLessThanOrEqual(1);
    });
    expect(tl.events[tl.events.length - 1]).toEqual({ kind: 'sessionEnd', atMs: durationMs });
    expectGeneralInvariants(tl);
  });

  it('eşit zamanlı olaylarda EVENT_ORDER, sonra ekleme sırası', () => {
    // 1 ms'lik seansta fazların çoğu sıfır uzunlukta: aynı anda phaseStart'lar ve sessionEnd.
    const tl = planSession(DECK_TINY, 1, SEED);
    expect(tl.prompts).toHaveLength(0);
    expect(tl.events.map((e) => [e.kind, e.atMs, e.kind === 'phaseStart' ? e.phase.name : ''])).toEqual([
      ['phaseStart', 0, 'arrival'],
      ['phaseStart', 0, 'seed'],
      ['phaseStart', 0, 'deepening'],
      ['phaseStart', 1, 'plateau'],
      ['phaseStart', 1, 'return'],
      ['sessionEnd', 1, ''],
    ]);
  });

  it('promptShow ve bell aynı anda: show önce, bell hemen ardından', () => {
    const tl = planSession(DECK_48, DURATIONS_MS[0], SEED);
    const firstShow = tl.events.findIndex((e) => e.kind === 'promptShow');
    expect(firstShow).toBeGreaterThan(0);
    expect(tl.events[firstShow + 1].kind).toBe('bell');
    expect(EVENT_ORDER.promptShow).toBeLessThan(EVENT_ORDER.bell);
  });

  it('geçersiz süre reddedilir', () => {
    expect(() => planSession(DECK_48, 0, SEED)).toThrow(RangeError);
    expect(() => planSession(DECK_48, -5, SEED)).toThrow(RangeError);
    expect(() => planSession(DECK_48, 1.5, SEED)).toThrow(RangeError);
    expect(() => planSession(DECK_48, Number.NaN, SEED)).toThrow(RangeError);
  });
});

describe.each(Object.entries(DECKS))('planSession — %s destesi', (_name, deck) => {
  it.each(DURATIONS_MS)('değişmezler ve yapı kuralları (%d ms)', (durationMs) => {
    const tl = planSession(deck, durationMs, seedFor(deck.id, durationMs));
    expect(tl.deckId).toBe(deck.id);
    expect(tl.durationMs).toBe(durationMs);
    expectGeneralInvariants(tl);
    expectFullSessionStructure(tl, deck);
  });

  it.each(DURATIONS_MS)('nefese hizalı deepening başlangıçları (%d ms)', (durationMs) => {
    // Gerçekçi destelerde %40 kısıtı bağlayıcı olduğu için hizalama payı her zaman sığar.
    const tl = planSession(deck, durationMs, SEED);
    const deep = inPhase(tl, 'deepening');
    for (const p of deep) expect(p.showMs % BREATH_MS === 0).toBe(ALIGN_TO_BREATH);
  });
});

describe('planSession — kesme ve uzatma', () => {
  it.each(DURATIONS_MS)('uzun deste sondan kesilir (%d ms)', (durationMs) => {
    for (const deck of [DECK_48, DECK_80]) {
      const tl = planSession(deck, durationMs, SEED);
      const shown = inPhase(tl, 'deepening').filter((p) => p.role === 'prompt').map((p) => p.promptId);
      const all = contentIds(deck);
      expect(shown.length).toBeGreaterThan(0);
      expect(shown.length).toBeLessThan(all.length);
      expect(shown).toEqual(all.slice(0, shown.length));
    }
  });

  it('daha uzun seans daha çok prompt gösterir', () => {
    const counts = DURATIONS_MS.map((d) => inPhase(planSession(DECK_80, d, SEED), 'deepening').length);
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThan(counts[i - 1]);
  });

  it.each(DURATIONS_MS)('minik deste: 3 içerik de gösterilir, sessizlikler uzatılır (%d ms)', (durationMs) => {
    const tl = planSession(DECK_TINY, durationMs, SEED);
    const deep = inPhase(tl, 'deepening');
    expect(deep.map((p) => p.promptId)).toEqual(contentIds(DECK_TINY));
    for (let i = 1; i < deep.length; i++) {
      expect(deep[i].showMs - deep[i - 1].goneMs).toBeGreaterThan(SILENCE_FACTOR_MAX * holdOf(deep[i - 1]));
    }
    // Son prompt'tan faz sonuna kadar da uzun sessizlik kalır.
    const span = phaseOf(tl, 'deepening');
    const lastDeep = deep[deep.length - 1];
    expect(span.endMs - lastDeep.goneMs).toBeGreaterThan(SILENCE_FACTOR_MAX * holdOf(lastDeep));
  });

  it('5 içerikli destede deepening sonunda anchor tekrar edebilir ama içerik tekrarlanmaz', () => {
    const deck = makeDeck('bes', 5, null);
    const tl = planSession(deck, DURATIONS_MS[2], SEED);
    const deep = inPhase(tl, 'deepening');
    expect(deep.map((p) => p.promptId)).toEqual([...contentIds(deck), SYNTHETIC_ANCHOR_ID]);
    expectGeneralInvariants(tl);
  });
});

describe('planSession — sentez anchor ve kısa seanslar', () => {
  it('anchor tipli prompt yoksa deck.anchor sentezlenir', () => {
    const deck = makeDeck('anchorsuz', 47, null);
    const tl = planSession(deck, DURATIONS_MS[1], SEED);
    const anchors = tl.prompts.filter((p) => p.role === 'anchor');
    expect(anchors.length).toBeGreaterThanOrEqual(3);
    for (const a of anchors) expect(a).toMatchObject({ promptId: SYNTHETIC_ANCHOR_ID, type: 'anchor', text: deck.anchor });
    expectFullSessionStructure(tl, deck);
  });

  it('destedeki anchor prompt\'unun id ve metni kullanılır, içerik sırasına girmez', () => {
    const tl = planSession(DECK_80, DURATIONS_MS[0], SEED);
    const anchors = tl.prompts.filter((p) => p.role === 'anchor');
    for (const a of anchors) expect(a).toMatchObject({ promptId: 'a00', text: 'Zaman' });
    expect(tl.prompts.filter((p) => p.role === 'prompt').some((p) => p.promptId === 'a00')).toBe(false);
  });

  it('30 dk return: beklemeler orantılı kısalır, kenar sessizlikleri korunur', () => {
    const tl = planSession(DECK_48, DURATIONS_MS[0], SEED);
    const [anchor, closing] = inPhase(tl, 'return');
    expect(holdOf(anchor)).toBeLessThan(HOLD_SECONDS.anchor * MS_PER_S);
    expect(holdOf(closing)).toBeLessThan(HOLD_SECONDS.closing * MS_PER_S);
    const ratioA = holdOf(anchor) / (HOLD_SECONDS.anchor * MS_PER_S);
    const ratioC = holdOf(closing) / (HOLD_SECONDS.closing * MS_PER_S);
    expect(Math.abs(ratioA - ratioC)).toBeLessThan(0.001);
  });

  it.each([45, 60])('%d dk return: tam beklemeler', (minutes) => {
    const tl = planSession(DECK_48, minutes * MS_PER_MIN, SEED);
    const [anchor, closing] = inPhase(tl, 'return');
    expect(holdOf(anchor)).toBe(HOLD_SECONDS.anchor * MS_PER_S);
    expect(holdOf(closing)).toBe(HOLD_SECONDS.closing * MS_PER_S);
  });

  it('10 dk: seed anchor kısalır, return\'de yalnız closing kalır', () => {
    const tl = planSession(DECK_48, 10 * MS_PER_MIN, SEED);
    expectGeneralInvariants(tl);
    const seed = inPhase(tl, 'seed');
    expect(seed).toHaveLength(1);
    expect(holdOf(seed[0])).toBeLessThan(HOLD_SECONDS.anchor * MS_PER_S);
    expect(inPhase(tl, 'return').map((p) => p.role)).toEqual(['closing']);
    expect(tl.prompts[tl.prompts.length - 1].role).toBe('closing');
  });

  it.each([1, 2, 3, 5, 7, 15, 20, 90])('%d dk: genel değişmezler korunur', (minutes) => {
    for (const deck of Object.values(DECKS)) {
      expectGeneralInvariants(planSession(deck, minutes * MS_PER_MIN, SEED));
    }
  });

  it('5 dk: return ve seed sığmaz, hiçbir şey planlanmaz', () => {
    const tl = planSession(DECK_48, 5 * MS_PER_MIN, SEED);
    expect(inPhase(tl, 'seed')).toHaveLength(0);
    expect(inPhase(tl, 'return')).toHaveLength(0);
  });
});

describe('planSession — determinizm', () => {
  it.each(DURATIONS_MS)('aynı girdi → aynı çizelge (%d ms)', (durationMs) => {
    const seed = seedFor(DECK_48.id, durationMs);
    expect(planSession(DECK_48, durationMs, seed)).toEqual(planSession(DECK_48, durationMs, seed));
  });

  it.each(DURATIONS_MS)('farklı tohum → farklı zamanlar (%d ms)', (durationMs) => {
    const times = (seed: number) => inPhase(planSession(DECK_80, durationMs, seed), 'deepening').map((p) => p.showMs);
    expect(times(1)).not.toEqual(times(2));
  });

  it('girdi destesi değiştirilmez', () => {
    const copy = structuredClone(DECK_48);
    planSession(DECK_48, DURATIONS_MS[1], SEED);
    expect(DECK_48).toEqual(copy);
  });
});

describe('seedFor', () => {
  it('kararlı, 32 bit işaretsiz', () => {
    const a = seedFor('zaman', 45 * MS_PER_MIN);
    expect(seedFor('zaman', 45 * MS_PER_MIN)).toBe(a);
    expect(Number.isInteger(a)).toBe(true);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(2 ** 32);
  });

  it('deste ya da süre değişince değişir', () => {
    const base = seedFor('zaman', 45 * MS_PER_MIN);
    expect(seedFor('zaman', 30 * MS_PER_MIN)).not.toBe(base);
    expect(seedFor('mekan', 45 * MS_PER_MIN)).not.toBe(base);
    expect(seedFor('çiğdem', 45 * MS_PER_MIN)).not.toBe(seedFor('cigdem', 45 * MS_PER_MIN));
  });
});
