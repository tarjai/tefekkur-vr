// loader testleri: örnek deste, şema retleri ve okunur mesajlar, dil uyarısı, hata özeti, liste kurma.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DECK_ERROR_MAX_ISSUES,
  DECK_MAX_PROMPTS,
  DECK_MIN_PROMPTS,
  DECK_TYPE_TARGETS,
  DECK_TYPE_TOLERANCE,
  LOCALE,
  PROMPT_MAX_CHARS,
  PROMPT_MAX_LINES,
} from '../config';
import { DeckSchema, PROMPT_TYPES, charLength, type Deck, type PromptType } from './schema';
import { collectDecks, formatSchemaError, loadDecks, validateDeck, type DeckValidation } from './loader';

const DECKS_DIR = path.resolve('decks');
const EXAMPLE_FILE = 'example.json';
const exampleRaw: unknown = JSON.parse(readFileSync(path.join(DECKS_DIR, EXAMPLE_FILE), 'utf8'));
const collator = new Intl.Collator(LOCALE);

const pid = (i: number) => `p${String(i + 1).padStart(2, '0')}`;

/** Şemadan geçen en küçük deste: 1 anchor + (DECK_MIN_PROMPTS - 1) soru. */
function validDeck(overrides: Partial<Deck> = {}): Deck {
  const prompts: Deck['prompts'] = [{ id: pid(0), type: 'anchor', text: 'Zaman' }];
  for (let i = 1; i < DECK_MIN_PROMPTS; i++) prompts.push({ id: pid(i), type: 'question', text: `${i}. soru: şu an ne duyuyorsun?` });
  return { id: 'deneme', title: 'Deneme', locale: LOCALE, anchor: 'Zaman', prompts, closing: 'Ne kaldı?', ...overrides };
}

function withPromptText(index: number, text: string): Deck {
  const deck = validDeck();
  deck.prompts[index] = { ...deck.prompts[index], text };
  return deck;
}

function expectRejected(result: DeckValidation): string {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('beklenmedik geçerli sonuç');
  expect(result.error.message.length).toBeGreaterThan(0);
  return result.error.message;
}

function expectAccepted(result: DeckValidation): { deck: Deck; localeMismatch: boolean } {
  if (!result.ok) throw new Error(`beklenmedik ret: ${result.error.message}`);
  return result;
}

describe('decks/example.json', () => {
  const { deck, localeMismatch } = expectAccepted(validateDeck(exampleRaw, EXAMPLE_FILE));

  it('şemadan geçer, dili uygulama diliyle aynı', () => {
    expect(localeMismatch).toBe(false);
    expect(deck.id).toBe('ornek-zaman');
    expect(deck.locale).toBe(LOCALE);
    expect(deck.prompts.length).toBeGreaterThanOrEqual(DECK_MIN_PROMPTS);
    expect(deck.prompts.length).toBeLessThanOrEqual(DECK_MAX_PROMPTS);
  });

  it("id'ler p01.. sırasıyla, tek anchor ilk sırada ve metni deck.anchor", () => {
    deck.prompts.forEach((p, i) => expect(p.id).toBe(pid(i)));
    const anchors = deck.prompts.filter((p) => p.type === 'anchor');
    expect(anchors).toHaveLength(1);
    expect(deck.prompts[0].type).toBe('anchor');
    expect(deck.prompts[0].text).toBe(deck.anchor);
  });

  it('tip dağılımı hedefe toleransla uyar', () => {
    const counts = Object.fromEntries(PROMPT_TYPES.map((t) => [t, 0])) as Record<PromptType, number>;
    for (const p of deck.prompts) counts[p.type] += 1;
    const total = deck.prompts.length;
    for (const [type, target] of Object.entries(DECK_TYPE_TARGETS)) {
      expect(Math.abs(counts[type as PromptType] / total - target)).toBeLessThanOrEqual(DECK_TYPE_TOLERANCE);
    }
  });

  it('metinler sınırda, NFC, tekrarsız; sorular soru işaretiyle biter; alıntılar atıflı', () => {
    const texts = [deck.anchor, deck.closing, ...deck.prompts.map((p) => p.text)];
    for (const text of texts) {
      expect(charLength(text)).toBeLessThanOrEqual(PROMPT_MAX_CHARS);
      expect(text.split('\n').length).toBeLessThanOrEqual(PROMPT_MAX_LINES);
      expect(text).toBe(text.normalize('NFC'));
    }
    expect(new Set(deck.prompts.map((p) => p.text)).size).toBe(deck.prompts.length);
    for (const p of deck.prompts) {
      expect(p.sourceNote).toBe('zaman.md');
      if (p.type === 'question') expect(p.text.endsWith('?')).toBe(true);
      if (p.type === 'quote') expect(p.text).toMatch(/ — \S/u);
    }
  });
});

describe('validateDeck — retler', () => {
  it(`${PROMPT_MAX_CHARS} karakter charLength ile sayılır (ayrışık "ş" tek karakter)`, () => {
    const decomposed = 'ş'.repeat(PROMPT_MAX_CHARS);
    expect(decomposed.length).toBe(2 * PROMPT_MAX_CHARS);
    expectAccepted(validateDeck(withPromptText(3, decomposed), 'ayrisik.json'));
  });

  it(`${PROMPT_MAX_CHARS} karakteri aşan prompt reddedilir, yol ve sınır mesajda`, () => {
    const tooLong = 'ğ'.repeat(PROMPT_MAX_CHARS + 1);
    const message = expectRejected(validateDeck(withPromptText(3, tooLong), 'uzun.json'));
    expect(message).toContain('prompts[3].text');
    expect(message).toContain(String(PROMPT_MAX_CHARS));
  });

  it(`${PROMPT_MAX_LINES + 1} satırlı prompt reddedilir`, () => {
    const message = expectRejected(validateDeck(withPromptText(5, 'bir\niki\nüç'), 'satir.json'));
    expect(message).toContain('prompts[5].text');
    expect(message).toContain(`${PROMPT_MAX_LINES} satır`);
  });

  it(`${DECK_MIN_PROMPTS} prompt'tan az deste reddedilir`, () => {
    const deck = validDeck();
    deck.prompts = deck.prompts.slice(0, DECK_MIN_PROMPTS - 1);
    const message = expectRejected(validateDeck(deck, 'kisa.json'));
    expect(message).toContain('prompts');
    expect(message).toContain(String(DECK_MIN_PROMPTS));
  });

  it("tekrarlanan prompt id'si reddedilir", () => {
    const deck = validDeck();
    deck.prompts[2] = { ...deck.prompts[2], id: deck.prompts[1].id };
    expect(expectRejected(validateDeck(deck, 'tekrar.json'))).toContain('benzersiz');
  });

  it("geçersiz deste id'si reddedilir", () => {
    const message = expectRejected(validateDeck(validDeck({ id: 'Zaman Destesi' }), 'id.json'));
    expect(message.startsWith('id: ')).toBe(true);
  });

  it('nesne olmayan girdi ve eksik alan okunur mesajla reddedilir; dosya adı korunur', () => {
    for (const raw of [null, [], 'deste', 42]) {
      const result = validateDeck(raw, 'bozuk.json');
      expectRejected(result);
      if (!result.ok) expect(result.error.file).toBe('bozuk.json');
    }
    const withoutClosing: Record<string, unknown> = { ...validDeck() };
    delete withoutClosing.closing;
    expect(expectRejected(validateDeck(withoutClosing, 'eksik.json'))).toMatch(/^closing: /);
  });

  it('metinler kırpılarak döner (şema trim)', () => {
    const { deck } = expectAccepted(validateDeck(withPromptText(1, '  Şimdi ne duyuyorsun?  '), 'bosluk.json'));
    expect(deck.prompts[1].text).toBe('Şimdi ne duyuyorsun?');
  });
});

describe('validateDeck — dil', () => {
  it('farklı dil reddedilmez, işaretlenir', () => {
    expect(expectAccepted(validateDeck(validDeck({ locale: 'en' }), 'en.json')).localeMismatch).toBe(true);
  });

  it('aynı dilin bölge / harf varyantı uyuşmazlık sayılmaz', () => {
    for (const locale of [LOCALE, `${LOCALE}-TR`, LOCALE.toLocaleUpperCase(LOCALE)]) {
      expect(expectAccepted(validateDeck(validDeck({ locale }), 'tr.json')).localeMismatch).toBe(false);
    }
  });
});

describe('formatSchemaError', () => {
  it(`en fazla ${DECK_ERROR_MAX_ISSUES} madde gösterir, kalanı +N`, () => {
    const extra = 4;
    const deck = validDeck();
    const tooLong = 'ş'.repeat(PROMPT_MAX_CHARS + 1);
    for (let i = 1; i <= DECK_ERROR_MAX_ISSUES + extra; i++) deck.prompts[i] = { ...deck.prompts[i], text: tooLong };
    const parsed = DeckSchema.safeParse(deck);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues).toHaveLength(DECK_ERROR_MAX_ISSUES + extra);
    const message = formatSchemaError(parsed.error);
    expect(message.split('; ')).toHaveLength(DECK_ERROR_MAX_ISSUES);
    expect(message.endsWith(`+${extra}`)).toBe(true);
    expect(message).toContain('prompts[1].text: ');
    expect(message).not.toContain(`prompts[${DECK_ERROR_MAX_ISSUES + 1}].text`);
  });

  it('sınırdaysa +N eklenmez', () => {
    const deck = validDeck();
    deck.prompts[1] = { ...deck.prompts[1], text: 'ı'.repeat(PROMPT_MAX_CHARS + 1) };
    const parsed = DeckSchema.safeParse(deck);
    if (parsed.success) throw new Error('beklenmedik geçerli sonuç');
    expect(formatSchemaError(parsed.error)).not.toMatch(/\+\d+$/);
  });
});

describe('collectDecks', () => {
  it('başlığa göre Türkçe sıralar (c < ç, ı < i)', () => {
    const titles = ['Zaman', 'İnsan', 'Çay', 'Işık', 'Ceviz'];
    const modules = Object.fromEntries(
      titles.map((title, i) => [`/decks/d${i}.json`, validDeck({ id: `d${i}`, title })]),
    );
    const { decks, errors } = collectDecks(modules);
    expect(errors).toEqual([]);
    expect(decks.map((d) => d.deck.title)).toEqual(['Ceviz', 'Çay', 'Işık', 'İnsan', 'Zaman']);
    expect(decks.map((d) => d.file)).toEqual(['d4.json', 'd2.json', 'd3.json', 'd1.json', 'd0.json']);
  });

  it('geçersiz dosya hataya düşer, geçerliler yüklenir; dil uyarısı taşınır', () => {
    const { decks, errors } = collectDecks({
      '/decks/iyi.json': validDeck({ id: 'iyi' }),
      '/decks/ingilizce.json': validDeck({ id: 'ingilizce', locale: 'en' }),
      '/decks/bozuk.json': { id: 'bozuk' },
    });
    expect(decks.map((d) => [d.file, d.localeMismatch])).toEqual(
      expect.arrayContaining([
        ['iyi.json', false],
        ['ingilizce.json', true],
      ]),
    );
    expect(errors.map((e) => e.file)).toEqual(['bozuk.json']);
  });

  it("aynı id: adı <id>.json olan kalır, diğeri hata olur", () => {
    const { decks, errors } = collectDecks({
      '/decks/example.json': validDeck({ id: 'zaman', title: 'Örnek' }),
      '/decks/zaman.json': validDeck({ id: 'zaman', title: 'Benim' }),
    });
    expect(decks.map((d) => [d.file, d.deck.title])).toEqual([['zaman.json', 'Benim']]);
    expect(errors).toHaveLength(1);
    expect(errors[0].file).toBe('example.json');
    expect(errors[0].message).toContain('zaman.json');
  });

  it('aynı id ve kanonik ad yoksa dosya adına göre ilki kalır', () => {
    const { decks, errors } = collectDecks({
      '/decks/b.json': validDeck({ id: 'ortak' }),
      '/decks/a.json': validDeck({ id: 'ortak' }),
    });
    expect(decks.map((d) => d.file)).toEqual(['a.json']);
    expect(errors.map((e) => e.file)).toEqual(['b.json']);
  });
});

describe('loadDecks', () => {
  it("decks/ içindeki her JSON ya yüklenir ya hataya düşer; id'ler benzersiz, liste sıralı", () => {
    const files = readdirSync(DECKS_DIR).filter((f) => f.endsWith('.json'));
    const { decks, errors } = loadDecks();
    expect([...decks.map((d) => d.file), ...errors.map((e) => e.file)].sort()).toEqual([...files].sort());
    expect(new Set(decks.map((d) => d.deck.id)).size).toBe(decks.length);
    const titles = decks.map((d) => d.deck.title);
    expect(titles).toEqual([...titles].sort(collator.compare));
  });
});
