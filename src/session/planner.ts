// Desteden zaman çizelgesi üretir: (deck, durationMs, seed) => Timeline.
// Saf fonksiyon: DOM, Three.js, Web Audio, Date, Math.random kullanmaz. Tüm zamanlar tam sayı ms.
import type { Deck } from '../deck/schema';
import {
  ALIGN_TO_BREATH,
  ANCHOR_REPEAT_EVERY,
  APPROACH_S,
  BREATH_PERIOD_S,
  DEEPENING_VISIBLE_MAX_RATIO,
  HOLD_SECONDS,
  MIN_EDGE_SILENCE_S,
  PHASE_ORDER,
  PHASE_RATIOS,
  RETREAT_S,
  SILENCE_FACTOR_MAX,
  SILENCE_FACTOR_MIN,
} from '../config';
import { createRng, hashString } from './rng';
import { CLOSING_ID, EVENT_ORDER, SYNTHETIC_ANCHOR_ID } from './types';
import type {
  PhaseName,
  PhaseSpan,
  PromptRole,
  ScheduledPrompt,
  ScheduledType,
  Timeline,
  TimelineEvent,
} from './types';

const MS_PER_S = 1000;
const APPROACH_MS = Math.round(APPROACH_S * MS_PER_S);
const RETREAT_MS = Math.round(RETREAT_S * MS_PER_S);
const BREATH_MS = Math.round(BREATH_PERIOD_S * MS_PER_S);
const EDGE_MS = Math.round(MIN_EDGE_SILENCE_S * MS_PER_S);
/** Bekleme dışında sahnede geçen süre: yaklaşma + geri çekilme. */
const TRANSIT_MS = APPROACH_MS + RETREAT_MS;

/** Çizelgeye girecek bir görünümün zamansız hali. */
interface Item {
  promptId: string;
  role: PromptRole;
  type: ScheduledType;
  text: string;
}

/** Tipin tam bekleme süresi, ms (tek kez yuvarlanır). */
function holdMs(type: ScheduledType): number {
  return Math.round(HOLD_SECONDS[type] * MS_PER_S);
}

/** Mesh'in sahnede kaldığı toplam süre (tam bekleme ile), ms. */
function visibleMs(item: Item): number {
  return TRANSIT_MS + holdMs(item.type);
}

function sum(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

/** Mutlak seans zamanı ızgarasında bir sonraki nefes döngüsü başı. */
function ceilToBreath(t: number): number {
  return Math.ceil(t / BREATH_MS) * BREATH_MS;
}

function schedule(item: Item, phase: PhaseName, index: number, showMs: number, hold: number): ScheduledPrompt {
  const arriveMs = showMs + APPROACH_MS;
  const hideMs = arriveMs + hold;
  return {
    key: `${phase}:${index}:${item.promptId}`,
    promptId: item.promptId,
    role: item.role,
    type: item.type,
    text: item.text,
    phase,
    showMs,
    arriveMs,
    hideMs,
    goneMs: hideMs + RETREAT_MS,
  };
}

// ---------- Fazlar ----------

/** Kümülatif oranlarla faz aralıkları; ilki 0'da başlar, sonuncusu tam durationMs'te biter. */
function planPhases(durationMs: number): PhaseSpan[] {
  let cumulative = 0;
  let startMs = 0;
  return PHASE_ORDER.map((name, i) => {
    cumulative += PHASE_RATIOS[name];
    const endMs = i === PHASE_ORDER.length - 1 ? durationMs : Math.round(cumulative * durationMs);
    const span: PhaseSpan = { name, startMs, endMs };
    startMs = endMs;
    return span;
  });
}

function phaseNamed(phases: readonly PhaseSpan[], name: PhaseName): PhaseSpan {
  const span = phases.find((p) => p.name === name);
  if (!span) throw new Error(`planner: faz bulunamadı: ${name}`);
  return span;
}

// ---------- Deste → öğeler ----------

/** Destedeki ilk anchor tipli prompt; yoksa deck.anchor'dan sentezlenir. */
function anchorItem(deck: Deck): Item {
  const found = deck.prompts.find((p) => p.type === 'anchor');
  return found
    ? { promptId: found.id, role: 'anchor', type: 'anchor', text: found.text }
    : { promptId: SYNTHETIC_ANCHOR_ID, role: 'anchor', type: 'anchor', text: deck.anchor };
}

/** anchor dışı prompt'lar, deste (çağrışım) sırasıyla; aynı id ikinci kez alınmaz. */
function contentItems(deck: Deck): Item[] {
  const seen = new Set<string>();
  const items: Item[] = [];
  for (const p of deck.prompts) {
    if (p.type === 'anchor' || seen.has(p.id)) continue;
    seen.add(p.id);
    items.push({ promptId: p.id, role: 'prompt', type: p.type, text: p.text });
  }
  return items;
}

function closingItem(deck: Deck): Item {
  return { promptId: CLOSING_ID, role: 'closing', type: 'closing', text: deck.closing };
}

/** deepening aday dizisi: içerik sırası, her ANCHOR_REPEAT_EVERY içerikten sonra bir anchor. */
function deepeningCandidates(content: readonly Item[], anchor: Item): Item[] {
  const out: Item[] = [];
  content.forEach((item, i) => {
    out.push(item);
    if ((i + 1) % ANCHOR_REPEAT_EVERY === 0) out.push(anchor);
  });
  return out;
}

// ---------- seed ----------

/** Tek anchor, fazın ortasında. Sığmazsa bekleme kısalır; yaklaşma + geri çekilme bile sığmazsa atlanır. */
function planSeed(span: PhaseSpan, anchor: Item): ScheduledPrompt[] {
  const length = span.endMs - span.startMs;
  const hold = Math.min(holdMs(anchor.type), length - 2 * EDGE_MS - TRANSIT_MS);
  if (hold < 0) return [];
  const visible = TRANSIT_MS + hold;
  const centered = span.startMs + Math.floor((length - visible) / 2);
  return [schedule(anchor, span.name, 0, snapSeed(centered, visible, span), hold)];
}

/** En yakın nefes başına, olmazsa diğer komşuya hizalar; kenar sessizliği korunmazsa hizalamaz. */
function snapSeed(showMs: number, visible: number, span: PhaseSpan): number {
  if (!ALIGN_TO_BREATH) return showMs;
  const nearest = Math.round(showMs / BREATH_MS) * BREATH_MS;
  const other = nearest >= showMs ? nearest - BREATH_MS : nearest + BREATH_MS;
  const fits = (s: number) => s - span.startMs >= EDGE_MS && span.endMs - (s + visible) >= EDGE_MS;
  for (const candidate of [nearest, other]) {
    if (fits(candidate)) return candidate;
  }
  return showMs;
}

// ---------- deepening ----------

/**
 * Sessizlik ağırlıkları kesmeden önce sabit sırayla çekilir (lead, sonra her aday).
 * En uzun önek seçilir: görünür toplam ≤ %40·L ve görünür + ağırlıklar ≤ L.
 * Kalan süre ağırlıklarla orantılı dağıtılır (k ≥ 1: kısa destede sessizlikler uzar, prompt tekrarlanmaz).
 */
function planDeepening(span: PhaseSpan, candidates: readonly Item[], rng: () => number): ScheduledPrompt[] {
  const length = span.endMs - span.startMs;
  const factor = () => SILENCE_FACTOR_MIN + rng() * (SILENCE_FACTOR_MAX - SILENCE_FACTOR_MIN);
  // Önceki prompt seed'deki anchor'dı.
  const leadWeight = factor() * holdMs('anchor');
  const weights = candidates.map((item) => factor() * holdMs(item.type));

  const visibleCap = DEEPENING_VISIBLE_MAX_RATIO * length;
  let count = 0;
  let visibleSum = 0;
  let weightSum = leadWeight;
  while (count < candidates.length) {
    const nextVisible = visibleSum + visibleMs(candidates[count]);
    const nextWeight = weightSum + weights[count];
    if (nextVisible > visibleCap || nextVisible + nextWeight > length) break;
    visibleSum = nextVisible;
    weightSum = nextWeight;
    count++;
  }
  if (count === 0) return [];

  // Nefese hizalama her öğeye en fazla bir döngü ekler; yer yoksa hizalanmaz.
  let reserve = ALIGN_TO_BREATH ? count * BREATH_MS : 0;
  if (visibleSum + reserve + weightSum > length) reserve = 0;
  const aligning = reserve > 0;
  const stretch = (length - visibleSum - reserve) / weightSum;

  const out: ScheduledPrompt[] = [];
  let t = span.startMs;
  let previousWeight = leadWeight;
  for (let i = 0; i < count; i++) {
    t += stretch * previousWeight;
    // Yukarı yuvarlama: sessizlik hiçbir zaman k·w'nin altına inmez.
    const showMs = aligning ? ceilToBreath(t) : Math.ceil(t);
    const item = candidates[i];
    const prompt = schedule(item, span.name, i, showMs, holdMs(item.type));
    out.push(prompt);
    t = prompt.goneMs;
    previousWeight = weights[i];
  }
  return out;
}

// ---------- return ----------

/** anchor sonra closing; sığmazsa yalnız closing; o da sığmazsa hiçbir şey. */
function planReturn(span: PhaseSpan, anchor: Item, closing: Item): ScheduledPrompt[] {
  return fitEvenly(span, [anchor, closing]) ?? fitEvenly(span, [closing]) ?? [];
}

/**
 * Öğeleri items.length + 1 sessizlik yuvasıyla (her biri ≥ MIN_EDGE) yerleştirir.
 * Tam beklemeler sığmazsa hepsi aynı f ∈ [0, 1] oranıyla kısalır; f = 0 bile sığmazsa null.
 * Artan süre yuvalara eşit dağıtılır; yer varsa öğe başına bir nefes döngüsü ayırıp hizalar.
 */
function fitEvenly(span: PhaseSpan, items: readonly Item[]): ScheduledPrompt[] | null {
  const length = span.endMs - span.startMs;
  const slots = items.length + 1;
  const silenceMin = slots * EDGE_MS;
  const fixed = items.length * TRANSIT_MS + silenceMin;
  if (length < fixed) return null;

  const fullHolds = items.map((item) => holdMs(item.type));
  const holdTotal = sum(fullHolds);
  const scale = holdTotal > 0 ? Math.min(1, (length - fixed) / holdTotal) : 1;
  // Kısaltılan beklemeler aşağı yuvarlanır: toplam hiçbir zaman fazı aşmaz.
  const holds = scale >= 1 ? fullHolds : fullHolds.map((h) => Math.floor(h * scale));
  const visibleSum = items.length * TRANSIT_MS + sum(holds);

  let reserve = ALIGN_TO_BREATH ? items.length * BREATH_MS : 0;
  if (visibleSum + silenceMin + reserve > length) reserve = 0;
  const aligning = reserve > 0;
  const slot = EDGE_MS + Math.floor((length - visibleSum - silenceMin - reserve) / slots);

  let t = span.startMs;
  return items.map((item, index) => {
    t += slot;
    const showMs = aligning ? ceilToBreath(t) : t;
    const prompt = schedule(item, span.name, index, showMs, holds[index]);
    t = prompt.goneMs;
    return prompt;
  });
}

// ---------- Olaylar ----------

/** atMs artan; eşitlikte EVENT_ORDER, sonra ekleme sırası (Array.sort kararlı). */
function buildEvents(phases: readonly PhaseSpan[], prompts: readonly ScheduledPrompt[], durationMs: number): TimelineEvent[] {
  const events: TimelineEvent[] = phases.map((phase): TimelineEvent => ({
    kind: 'phaseStart',
    atMs: phase.startMs,
    phase,
  }));
  for (const prompt of prompts) {
    events.push(
      { kind: 'promptShow', atMs: prompt.showMs, prompt },
      { kind: 'bell', atMs: prompt.showMs, prompt },
      { kind: 'promptHide', atMs: prompt.hideMs, prompt },
    );
  }
  events.push({ kind: 'sessionEnd', atMs: durationMs });
  return events.sort((a, b) => a.atMs - b.atMs || EVENT_ORDER[a.kind] - EVENT_ORDER[b.kind]);
}

// ---------- Dış API ----------

/** Aynı deste + süre → aynı tohum: `${deckId}|${durationMs}` metninin FNV-1a özeti. */
export function seedFor(deckId: string, durationMs: number): number {
  return hashString(`${deckId}|${durationMs}`);
}

export function planSession(deck: Deck, durationMs: number, seed: number): Timeline {
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0) {
    throw new RangeError(`planner: durationMs pozitif tam sayı olmalı (${durationMs})`);
  }
  const phases = planPhases(durationMs);
  const anchor = anchorItem(deck);
  const rng = createRng(seed);

  const prompts = [
    ...planSeed(phaseNamed(phases, 'seed'), anchor),
    ...planDeepening(phaseNamed(phases, 'deepening'), deepeningCandidates(contentItems(deck), anchor), rng),
    ...planReturn(phaseNamed(phases, 'return'), anchor, closingItem(deck)),
  ].sort((a, b) => a.showMs - b.showMs);

  return {
    deckId: deck.id,
    durationMs,
    seed,
    phases,
    prompts,
    events: buildEvents(phases, prompts, durationMs),
  };
}
