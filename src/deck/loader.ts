// Deste yükleyici: decks/*.json build'e statik girer; her dosya şemayla doğrulanır.
// Geçersiz dosya uygulamayı durdurmaz, hata listesine düşer. Saf kısımlar (validateDeck, collectDecks) test edilir.
import type { ZodError } from 'zod';
import { tr as zodTurkish } from 'zod/locales';
import { DECK_ERROR_MAX_ISSUES, LOCALE } from '../config';
import { STRINGS } from '../strings';
import { DeckSchema, type Deck } from './schema';

export interface LoadedDeck {
  deck: Deck;
  /** Dosya adı (ör. "example.json"). */
  file: string;
  /** Deste dili uygulama diliyle eşleşmiyor: reddedilmez, uyarı gösterilir. */
  localeMismatch: boolean;
}

export interface DeckLoadError {
  file: string;
  message: string;
}

export type DeckValidation =
  | { ok: true; deck: Deck; localeMismatch: boolean }
  | { ok: false; error: DeckLoadError };

export interface DeckList {
  /** Başlığa göre (Türkçe sıralama) dizili. */
  decks: LoadedDeck[];
  /** Dosya adına göre dizili. */
  errors: DeckLoadError[];
}

/** Vite build sırasında gömülür (eager); anahtar "/decks/<ad>.json", değer ayrıştırılmış JSON. */
const DECK_MODULES = import.meta.glob<unknown>('/decks/*.json', { eager: true, import: 'default' });

const collator = new Intl.Collator(LOCALE);
/** zod'un yerleşik mesajları (tip hatası vb.) Türkçe; şemadaki özel mesajlar önceliklidir. */
const turkishErrors = zodTurkish().localeError;

/** Dil etiketinin ana dil kodu ("tr-TR" → "tr"); büyük/küçük harf ve bölge farkı uyarı sebebi değildir. */
function languageOf(tag: string): string {
  try {
    return new Intl.Locale(tag.replace(/_/g, '-')).language;
  } catch {
    return tag;
  }
}

function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** zod yolu → "prompts[3].text"; kök hatasında boş. */
function formatPath(path: readonly PropertyKey[]): string {
  let out = '';
  for (const key of path) {
    if (typeof key === 'number') out += `[${key}]`;
    else out += out ? `.${String(key)}` : String(key);
  }
  return out;
}

/** Kısa hata özeti: "yol: mesaj; …", en fazla DECK_ERROR_MAX_ISSUES madde, fazlası "+N". */
export function formatSchemaError(error: ZodError): string {
  const items = error.issues.map((issue) => {
    const path = formatPath(issue.path);
    // Şema mesajları noktayla biter, zod'unkiler bitmez; "; " ile birleşirken tek biçim.
    const message = issue.message.replace(/\.$/, '');
    return path ? `${path}: ${message}` : message;
  });
  const shown = items.slice(0, DECK_ERROR_MAX_ISSUES).join('; ');
  const hidden = items.length - DECK_ERROR_MAX_ISSUES;
  return hidden > 0 ? `${shown} … +${hidden}` : shown;
}

/** Saf: ham JSON'u şemayla doğrular. Dil uyuşmazlığı reddedilmez, işaretlenir. */
export function validateDeck(raw: unknown, file: string): DeckValidation {
  const parsed = DeckSchema.safeParse(raw, { error: turkishErrors });
  if (!parsed.success) return { ok: false, error: { file, message: formatSchemaError(parsed.error) } };
  const deck = parsed.data;
  return { ok: true, deck, localeMismatch: languageOf(deck.locale) !== languageOf(LOCALE) };
}

/**
 * Saf: glob modüllerinden deste listesi. Aynı id'li destelerden biri kalır (adı `<id>.json` olan,
 * yoksa dosya adına göre ilki); diğerleri hata olur. Böylece kullanıcının `decks/zaman.json`'u örneği ezer.
 */
export function collectDecks(modules: Readonly<Record<string, unknown>>): DeckList {
  const errors: DeckLoadError[] = [];
  const byId = new Map<string, LoadedDeck[]>();
  const paths = Object.keys(modules).sort(collator.compare);
  for (const path of paths) {
    const file = fileName(path);
    const result = validateDeck(modules[path], file);
    if (!result.ok) {
      errors.push(result.error);
      continue;
    }
    const loaded: LoadedDeck = { deck: result.deck, file, localeMismatch: result.localeMismatch };
    const group = byId.get(result.deck.id);
    if (group) group.push(loaded);
    else byId.set(result.deck.id, [loaded]);
  }

  const decks: LoadedDeck[] = [];
  for (const [id, group] of byId) {
    const kept = group.find((d) => d.file === `${id}.json`) ?? group[0];
    decks.push(kept);
    for (const other of group) {
      if (other !== kept) errors.push({ file: other.file, message: STRINGS.deckDuplicateId(id, kept.file) });
    }
  }

  decks.sort((a, b) => collator.compare(a.deck.title, b.deck.title) || collator.compare(a.deck.id, b.deck.id));
  errors.sort((a, b) => collator.compare(a.file, b.file));
  return { decks, errors };
}

/** Build'e gömülü tüm desteleri yükler; dil uyuşmazlığını konsola uyarı olarak yazar. */
export function loadDecks(): DeckList {
  const list = collectDecks(DECK_MODULES);
  for (const { deck, file, localeMismatch } of list.decks) {
    if (localeMismatch) console.warn(`${file}: ${STRINGS.localeMismatch(deck.locale, LOCALE)}`);
  }
  return list;
}
