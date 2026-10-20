// Deste üretiminin saf mantığı: model talimatı, kullanıcı içeriği, çıktı doğrulama ve rapor.
// Ağ, dosya sistemi ve SDK'ya dokunmaz; `scripts/build-deck.ts` kullanır, birim testleri buradadır.
import {
  DECK_ERROR_MAX_ISSUES,
  DECK_MAX_PROMPTS,
  DECK_MIN_PROMPTS,
  DECK_RAW_PREVIEW_CHARS,
  DECK_TYPE_TARGETS,
  DECK_TYPE_TOLERANCE,
  HOLD_SECONDS,
  LOCALE,
  PROMPT_MAX_CHARS,
  PROMPT_MAX_LINES,
} from '../../src/config';
import { DeckSchema, PROMPT_TYPES, charLength, lineCount, type Deck, type PromptType } from '../../src/deck/schema';

export interface NoteInput {
  /** Notun dosya adı (prompt'lardaki `sourceNote` değeri). */
  file: string;
  content: string;
}

export interface RejectedPrompt {
  id: string;
  text: string;
  /** NFC karakter sayısı. */
  length: number;
  reason: string;
}

export interface ProcessOptions {
  /** Hedef dil; destenin `locale` alanı her zaman bu olur. */
  locale: string;
  /** Verilirse modelin id'sini ezer (yoksa modelin id'si slug'a çevrilir). */
  id?: string;
  /** Verilirse modelin başlığını ezer. */
  title?: string;
  /** Tek not varsa: tüm prompt'ların `sourceNote` değeri bu olur. */
  sourceNote?: string;
  /** Girdi notlarının dosya adları; bilinmeyen `sourceNote` için uyarı verilir. */
  notes?: string[];
}

export interface ProcessResult {
  /** Şemayı geçen deste; geçmezse null. */
  deck: Deck | null;
  /** Uzunluk / satır sınırını aştığı için çıkarılan prompt'lar (kırpılmaz). */
  rejected: RejectedPrompt[];
  /** Şema hataları (deck null ise dolu). */
  errors: string[];
  /** Deste geçerli olsa da dikkat edilmesi gerekenler. */
  warnings: string[];
}

export type ParseResult = { ok: true; value: unknown } | { ok: false; error: string; preview: string };

type TargetType = keyof typeof DECK_TYPE_TARGETS;
const TARGET_TYPES = Object.keys(DECK_TYPE_TARGETS) as TargetType[];
const PERCENT = 100;
const ANCHOR_TYPE: PromptType = 'anchor';
/** Prompt id'leri: p01, p02 … (hane sayısı en fazla prompt sayısından). */
const PROMPT_ID_DIGITS = String(DECK_MAX_PROMPTS).length;
const PROMPT_ID_PATTERN = /^p\d+$/;

/** Sınırlar kısıtsız JSON şemasında yok: gerçek kısıtları zod (DeckSchema) uygular. */
export const DECK_OUTPUT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'title', 'locale', 'anchor', 'prompts', 'closing'],
  properties: {
    id: { type: 'string', description: 'Lowercase ASCII slug: a-z, 0-9 and hyphens.' },
    title: { type: 'string', description: 'Short human-readable deck title.' },
    locale: { type: 'string', description: 'BCP 47 language code of all texts.' },
    anchor: { type: 'string', description: 'Core concept of the notes: one word or a very short phrase.' },
    prompts: {
      type: 'array',
      description: 'Prompts in associative-drift order.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'type', 'text', 'sourceNote'],
        properties: {
          id: { type: 'string', description: 'p01, p02, … in order.' },
          type: { type: 'string', enum: [...PROMPT_TYPES] },
          text: { type: 'string' },
          sourceNote: { type: 'string', description: 'File name of the note this prompt came from.' },
        },
      },
    },
    closing: { type: 'string', description: 'Short end-of-session question.' },
  },
} as const;

// ---------- Yardımcılar ----------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Tüm metinler: satır sonu \n, NFC, baş/son boşluk kırpılmış. */
function normalizeText(s: string): string {
  return s.replace(/\r\n?/g, '\n').normalize('NFC').trim();
}

function normalizeDeep(value: unknown): unknown {
  if (typeof value === 'string') return normalizeText(value);
  if (Array.isArray(value)) return value.map(normalizeDeep);
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = normalizeDeep(v);
    return out;
  }
  return value;
}

function percent(ratio: number): number {
  return Math.round(ratio * PERCENT);
}

/** Hedeflerin dışında kalan, tipi serbest oran. */
function freeRatio(): number {
  return Math.max(0, 1 - TARGET_TYPES.reduce((sum, t) => sum + DECK_TYPE_TARGETS[t], 0));
}

function languageName(locale: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(locale) ?? locale;
  } catch {
    return locale;
  }
}

function promptId(n: number): string {
  return `p${String(n).padStart(PROMPT_ID_DIGITS, '0')}`;
}

function quote(s: string): string {
  return `"${s.replace(/\n/g, '\\n')}"`;
}

/** Türkçe harfleri ASCII'ye çevirip deste id'si üretir: "Zaman Üzerine" → "zaman-uzerine". */
const TR_ASCII: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' };

export function slugifyId(text: string): string {
  return text
    .normalize('NFC')
    .toLocaleLowerCase(LOCALE)
    .replace(/[çğıöşüâîû]/g, (ch) => TR_ASCII[ch] ?? ch)
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ---------- Model talimatı ----------

export function buildSystemPrompt(locale: string): string {
  const lang = languageName(locale);
  const exampleCount = Math.round((DECK_MIN_PROMPTS + DECK_MAX_PROMPTS) / 2);
  const targetList = TARGET_TYPES.map((t) => `${t} ≈${percent(DECK_TYPE_TARGETS[t])}%`).join(', ');
  const exampleCounts = TARGET_TYPES.map((t) => `${Math.round(DECK_TYPE_TARGETS[t] * exampleCount)} ${t}`).join(', ');
  const isTurkish = locale.toLocaleLowerCase(LOCALE).split('-')[0] === 'tr';
  const closingExample = isTurkish ? '"Ne kaldı?"' : `the ${lang} equivalent of "What remains?"`;

  const sections = [
    `You build a contemplation deck for "Tefekkür", a personal VR tool for digesting one's own thoughts. ` +
      `The user sits still in VR for 30–60 minutes. Short texts (prompts) drift from far away to reading distance, ` +
      `stay there (anchor ${HOLD_SECONDS.anchor} s, question/koan/quote ${HOLD_SECONDS.question} s, sensory ${HOLD_SECONDS.sensory} s), ` +
      `then recede. The aim is to stay with ONE topic — the user's own notes — without distraction or boredom.\n\n` +
      `Read the user's notes and return one deck as JSON.`,

    `## Content rules\n` +
      `1. Anchor: extract the core concept of the notes — one word or a very short phrase — and put it in \`anchor\`. ` +
      `It is the centre the session keeps returning to.\n` +
      `2. Associative order (çağrışımsal sürüklenme / associative drift): order \`prompts\` so that each one is connected to the one ` +
      `before it — through an image, a word, a tension or a consequence — but is never a repetition or a paraphrase of it. ` +
      `The sequence wanders like a train of thought, moving away from the anchor and back; it is not a list grouped by type.\n` +
      `3. Questions address the user directly (second person singular) and contain no explanation, no hint and no answer. ` +
      `One question per prompt.\n` +
      `4. Turn the CONCRETE ideas, examples, images and claims in the notes into prompts. Never write generic motivational ` +
      `or self-help sentences that could fit any topic.\n` +
      `5. Quotes: only real, verifiable quotations from public-domain sources (long-dead authors, ancient texts, folk proverbs), ` +
      `with a brief attribution such as "… — Heraclitus" inside the text. Never invent a quote or an attribution; ` +
      `if you are not certain of both the wording and the source, write another type instead.\n` +
      `6. Write every text in ${lang} (locale "${locale}"), even if the notes are in another language.`,

    `## Prompt types\n` +
      `- anchor: exactly ONE prompt of this type, first in the list (${promptId(1)}); its text is exactly the \`anchor\` value. ` +
      `The app repeats it by itself, so do not add more.\n` +
      `- question: a direct, open question to the user (rule 3).\n` +
      `- koan: a short paradox or puzzling statement that resists a quick answer.\n` +
      `- quote: see rule 5.\n` +
      `- sensory: a brief invitation to notice the body, the breath or the senses right now, tied to the theme. ` +
      `It is shown for only ${HOLD_SECONDS.sensory} seconds, so keep it very short.\n\n` +
      `Distribution: ${targetList}; the remaining ≈${percent(freeRatio())}% is your choice among those four types. ` +
      `For ${exampleCount} prompts that is about ${exampleCounts}, plus the single anchor prompt. ` +
      `Mix the types along the sequence; the drift matters more than grouping.`,

    `## Format (strict: violations are rejected, never shortened for you)\n` +
      `- ${DECK_MIN_PROMPTS}–${DECK_MAX_PROMPTS} prompts in total, including the anchor prompt.\n` +
      `- \`text\`: at most ${PROMPT_MAX_CHARS} characters, counting spaces and punctuation, and at most ${PROMPT_MAX_LINES} lines. ` +
      `Prefer one line without line breaks (the app wraps). Aim well under the limit; if an idea does not fit, rewrite it shorter — ` +
      `never cut a sentence off.\n` +
      `- \`anchor\` and \`closing\` obey the same ${PROMPT_MAX_CHARS}-character limit.\n` +
      `- \`id\`: ${promptId(1)}, ${promptId(2)}, ${promptId(3)} … in order, unique.\n` +
      `- \`sourceNote\`: the exact file name of the note the prompt came from, as given in the input.\n` +
      `- \`closing\`: one short question for the end of the session about what stayed with the user (e.g. ${closingExample}).\n` +
      `- Deck \`id\`: lowercase ASCII slug of the topic (a-z, 0-9, hyphens); \`title\`: short title in ${lang}; \`locale\`: "${locale}".\n` +
      `- Output ONLY the JSON object: no prose, no Markdown, no code fences.`,
  ];

  if (isTurkish) {
    sections.push(
      `## Turkish orthography\n` +
        `- Use the Turkish letters everywhere: ç ğ ı İ ö ş ü and Ç Ğ I İ Ö Ş Ü. Never replace them with ASCII look-alikes ` +
        `(c for ç, g for ğ, s for ş, o for ö, u for ü).\n` +
        `- Keep dotted and dotless i distinct: ı ↔ I and i ↔ İ (e.g. "İçinde", "Işık").\n` +
        `- Write the question particle separately and in vowel harmony (mı, mi, mu, mü); questions end with "?".\n` +
        `- Address the user as "sen". Use natural, contemporary Turkish, not translationese; â, î, û only where standard.`,
    );
  }

  return sections.join('\n\n');
}

// ---------- Kullanıcı içeriği ----------

export function buildUserContent(notes: NoteInput[]): string {
  const blocks = notes.map((n) => {
    const file = normalizeText(n.file).replace(/"/g, "'");
    const body = n.content.replace(/^﻿/, '').replace(/\r\n?/g, '\n').normalize('NFC').trim();
    return `<note file="${file}">\n${body}\n</note>`;
  });
  const count = notes.length;
  return `Here ${count === 1 ? 'is my note' : `are my ${count} notes`}. Build the deck from ${count === 1 ? 'it' : 'them'}.\n\n${blocks.join('\n\n')}`;
}

// ---------- Model çıktısı ----------

/** Metin bloklarını JSON olarak ayrıştırır; başarısızsa önizlemeli hata döner. */
export function parseModelText(text: string): ParseResult {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    const preview = [...text].slice(0, DECK_RAW_PREVIEW_CHARS).join('');
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Model çıktısı geçerli JSON değil: ${reason}`, preview };
  }
}

/** Sınırı aşan prompt'u reddetme nedeni; uygunsa null. */
function rejectionReason(text: string): string | null {
  const length = charLength(text);
  const lines = lineCount(text);
  const reasons: string[] = [];
  if (length > PROMPT_MAX_CHARS) reasons.push(`${length} karakter (sınır ${PROMPT_MAX_CHARS})`);
  if (lines > PROMPT_MAX_LINES) reasons.push(`${lines} satır (sınır ${PROMPT_MAX_LINES})`);
  return reasons.length > 0 ? reasons.join(', ') : null;
}

function formatIssuePath(path: readonly PropertyKey[], candidate: Record<string, unknown>): string {
  if (path.length === 0) return 'deste';
  let out = '';
  let node: unknown = candidate;
  for (const key of path) {
    if (typeof key === 'number') {
      out += `[${key}]`;
      node = Array.isArray(node) ? node[key] : undefined;
      if (isRecord(node) && typeof node.id === 'string') out += ` (${node.id})`;
    } else {
      out += out ? `.${String(key)}` : String(key);
      node = isRecord(node) ? node[String(key)] : undefined;
    }
  }
  if (typeof node === 'string' && charLength(node) > PROMPT_MAX_CHARS) out += ` [${charLength(node)} karakter]`;
  return out;
}

function computeWarnings(deck: Deck, opts: ProcessOptions): string[] {
  const warnings: string[] = [];
  const collator = new Intl.Collator(opts.locale, { sensitivity: 'variant' });
  const loose = new Intl.Collator(opts.locale, { sensitivity: 'base' });

  if (deck.locale !== LOCALE) {
    warnings.push(`Deste dili (${deck.locale}) uygulama diliyle (config LOCALE = ${LOCALE}) eşleşmiyor.`);
  }

  const anchors = deck.prompts.filter((p) => p.type === ANCHOR_TYPE);
  if (anchors.length === 0) {
    warnings.push(`'anchor' tipinde prompt yok; uygulama deck.anchor metninden sentezler.`);
  } else if (anchors.length > 1) {
    warnings.push(
      `${anchors.length} adet 'anchor' tipinde prompt var (${anchors.map((p) => p.id).join(', ')}); ` +
        'uygulama yalnız ilkini kullanır, diğerleri gösterilmez.',
    );
  }
  const first = anchors[0];
  if (first && collator.compare(first.text, deck.anchor) !== 0) {
    warnings.push(
      `anchor prompt metni ${quote(first.text)} (${first.id}) deck.anchor ${quote(deck.anchor)} ile aynı değil; ` +
        'seansta prompt metni gösterilir.',
    );
  }

  const total = deck.prompts.length;
  const counts = typeDistribution(deck);
  for (const t of TARGET_TYPES) {
    const ratio = counts[t] / total;
    if (Math.abs(ratio - DECK_TYPE_TARGETS[t]) > DECK_TYPE_TOLERANCE) {
      warnings.push(
        `${t} oranı %${percent(ratio)} (${counts[t]}/${total}); hedef %${percent(DECK_TYPE_TARGETS[t])} ` +
          `(tolerans ±%${percent(DECK_TYPE_TOLERANCE)}).`,
      );
    }
  }

  for (let i = 0; i < total; i++) {
    for (let j = i + 1; j < total; j++) {
      const a = deck.prompts[i];
      const b = deck.prompts[j];
      if (a && b && a.type !== ANCHOR_TYPE && loose.compare(a.text, b.text) === 0) {
        warnings.push(`Tekrarlanan metin: ${a.id} ve ${b.id} ${quote(a.text)}.`);
      }
    }
  }

  const badIds = deck.prompts.filter((p) => !PROMPT_ID_PATTERN.test(p.id)).map((p) => p.id);
  if (badIds.length > 0) warnings.push(`Beklenen biçimde (${promptId(1)}, ${promptId(2)} …) olmayan id'ler: ${badIds.join(', ')}.`);

  if (opts.notes && !opts.sourceNote) {
    const known = new Set(opts.notes);
    const unknown = [...new Set(deck.prompts.map((p) => p.sourceNote).filter((s): s is string => !!s && !known.has(s)))];
    if (unknown.length > 0) warnings.push(`Girdi notları arasında olmayan sourceNote değerleri: ${unknown.join(', ')}.`);
  }

  return warnings;
}

/**
 * Model çıktısını desteye çevirir: metinleri NFC + trim yapar, sınırı aşan prompt'ları reddedip çıkarır
 * (kırpmaz), id/başlık/dil ezmelerini uygular, DeckSchema ile doğrular ve uyarıları hesaplar.
 */
export function processModelOutput(raw: unknown, opts: ProcessOptions): ProcessResult {
  const normalized = normalizeDeep(raw);
  if (!isRecord(normalized)) {
    return { deck: null, rejected: [], errors: ['Model çıktısı bir JSON nesnesi değil.'], warnings: [] };
  }

  const candidate: Record<string, unknown> = { ...normalized };
  const rejected: RejectedPrompt[] = [];

  if (Array.isArray(candidate.prompts)) {
    const kept: unknown[] = [];
    candidate.prompts.forEach((item, index) => {
      if (isRecord(item) && typeof item.text === 'string') {
        const reason = rejectionReason(item.text);
        if (reason) {
          const id = typeof item.id === 'string' && item.id ? item.id : `#${index + 1}`;
          rejected.push({ id, text: item.text, length: charLength(item.text), reason });
          return;
        }
        if (opts.sourceNote) {
          kept.push({ ...item, sourceNote: opts.sourceNote });
          return;
        }
        if (item.sourceNote === '') {
          // İsteğe bağlı alan: boş değer şemayı boşuna düşürmesin.
          const { sourceNote: _empty, ...rest } = item;
          kept.push(rest);
          return;
        }
      }
      kept.push(item);
    });
    candidate.prompts = kept;
  }

  if (opts.id !== undefined) candidate.id = opts.id;
  else if (typeof candidate.id === 'string') candidate.id = slugifyId(candidate.id);
  if (opts.title !== undefined) candidate.title = normalizeText(opts.title);
  candidate.locale = opts.locale;

  const parsed = DeckSchema.safeParse(candidate);
  if (!parsed.success) {
    const errors = parsed.error.issues.map((issue) => `${formatIssuePath(issue.path, candidate)}: ${issue.message}`);
    return { deck: null, rejected, errors, warnings: [] };
  }
  return { deck: parsed.data, rejected, errors: [], warnings: computeWarnings(parsed.data, opts) };
}

export function typeDistribution(deck: Deck): Record<PromptType, number> {
  const counts = Object.fromEntries(PROMPT_TYPES.map((t) => [t, 0])) as Record<PromptType, number>;
  for (const p of deck.prompts) counts[p.type] += 1;
  return counts;
}

// ---------- Yeniden deneme ve rapor ----------

/** Şemayı geçmeyen çıktı için modele gönderilen düzeltme mesajı (konuşmanın devamı). */
export function buildRetryMessage(result: ProcessResult): string {
  const parts = [
    'Your previous JSON could not be used. Return the COMPLETE corrected deck again as a single JSON object, ' +
      'following every rule of the system prompt.',
  ];
  if (result.errors.length > 0) {
    parts.push(`Validation errors:\n${result.errors.map((e) => `- ${e}`).join('\n')}`);
  }
  if (result.rejected.length > 0) {
    parts.push(
      `These prompts were REJECTED because they exceed ${PROMPT_MAX_CHARS} characters or ${PROMPT_MAX_LINES} lines ` +
        `(they were removed, which also lowers the prompt count). Rewrite each one shorter, keeping its idea and its place ` +
        `in the sequence:\n` +
        result.rejected.map((r) => `- ${r.id} (${r.length} characters): ${quote(r.text)}`).join('\n'),
    );
  }
  parts.push(
    `Reminder: ${DECK_MIN_PROMPTS}–${DECK_MAX_PROMPTS} prompts, each text at most ${PROMPT_MAX_CHARS} characters ` +
      `(anchor and closing too), exactly one 'anchor' prompt whose text equals \`anchor\`. Output only the JSON.`,
  );
  return parts.join('\n\n');
}

/** Konsolda gösterilecek hata listesi; fazlası "+N" olarak özetlenir. */
export function formatIssueList(errors: readonly string[], max: number = DECK_ERROR_MAX_ISSUES): string[] {
  const shown = errors.slice(0, max).map((e) => `  - ${e}`);
  if (errors.length > max) shown.push(`  … +${errors.length - max} hata daha`);
  return shown;
}

/** Reddedilen prompt'ların yüksek sesli raporu (id, uzunluk, neden, metin). */
export function formatRejected(rejected: readonly RejectedPrompt[]): string {
  if (rejected.length === 0) return '';
  const lines = rejected.map((r) => `  - ${r.id} — ${r.reason}: ${quote(r.text)}`);
  return [`REDDEDİLEN PROMPT'LAR (${rejected.length}) — kırpılmadı, desteden çıkarıldı:`, ...lines].join('\n');
}

/** İnsan okuyacağı özet: tip dağılımı / hedef, reddedilenler, uyarılar, hatalar. */
export function formatReport(result: ProcessResult): string {
  const out: string[] = [];
  const { deck } = result;

  if (deck) {
    const total = deck.prompts.length;
    const counts = typeDistribution(deck);
    const free = 'serbest';
    const nameW = Math.max(...PROMPT_TYPES.map((t) => t.length), free.length);
    const countW = String(DECK_MAX_PROMPTS).length;
    const pctW = `%${PERCENT}`.length;
    const row = (name: string, count: string, pct: string, target: string) =>
      `  ${name.padEnd(nameW)}  ${count.padStart(countW)}  ${pct.padStart(pctW)}  / ${target}`;
    out.push(`Deste: ${deck.title} (id: ${deck.id}, dil: ${deck.locale}) — ${total} prompt`);
    out.push(`Çekirdek (anchor): ${quote(deck.anchor)}`);
    out.push(`Kapanış: ${quote(deck.closing)}`);
    out.push('Tip dağılımı (adet, oran / hedef):');
    out.push(row(ANCHOR_TYPE, String(counts.anchor), '', 'hedef 1'));
    for (const t of TARGET_TYPES) {
      out.push(row(t, String(counts[t]), `%${percent(counts[t] / total)}`, `hedef %${percent(DECK_TYPE_TARGETS[t])}`));
    }
    out.push(row(free, '', '', `hedef kalan %${percent(freeRatio())}`));
  }

  const rejected = formatRejected(result.rejected);
  if (rejected) out.push(rejected);

  if (result.warnings.length > 0) {
    out.push(`Uyarılar (${result.warnings.length}):`, ...result.warnings.map((w) => `  - ${w}`));
  }
  if (result.errors.length > 0) {
    out.push(`Şema hataları (${result.errors.length}):`, ...formatIssueList(result.errors));
  }
  return out.join('\n');
}
