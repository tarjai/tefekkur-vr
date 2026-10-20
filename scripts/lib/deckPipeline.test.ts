import { describe, expect, it } from 'vitest';
import {
  DECK_ERROR_MAX_ISSUES,
  DECK_MAX_PROMPTS,
  DECK_MIN_PROMPTS,
  DECK_RAW_PREVIEW_CHARS,
  DECK_TYPE_TARGETS,
  LOCALE,
  PROMPT_MAX_CHARS,
} from '../../src/config';
import { PROMPT_TYPES, charLength, type PromptType } from '../../src/deck/schema';
import {
  DECK_OUTPUT_JSON_SCHEMA,
  buildRetryMessage,
  buildSystemPrompt,
  buildUserContent,
  formatIssueList,
  formatReport,
  parseModelText,
  processModelOutput,
  slugifyId,
  typeDistribution,
} from './deckPipeline';

// ---------- Fixture üreticileri ----------

interface RawPrompt {
  id: string;
  type: PromptType;
  text: string;
  sourceNote?: string;
}

interface RawDeck {
  id: string;
  title: string;
  locale: string;
  anchor: string;
  prompts: RawPrompt[];
  closing: string;
}

const ANCHOR = 'Zaman';
const NOTE = 'zaman.md';
const pid = (n: number) => `p${String(n).padStart(2, '0')}`;

/** Hedef dağılıma yakın tip dizisi: ilk eleman anchor, kalan serbest pay question'a gider. */
function typeSequence(count: number): PromptType[] {
  const types: PromptType[] = ['anchor'];
  for (const [t, ratio] of Object.entries(DECK_TYPE_TARGETS) as [PromptType, number][]) {
    for (let i = 0; i < Math.round(ratio * count); i++) types.push(t);
  }
  while (types.length < count) types.push('question');
  return types.slice(0, count);
}

const TEXTS: Record<PromptType, (i: number) => string> = {
  anchor: () => ANCHOR,
  question: (i) => `Bugün ${i}. kez neyi ertelediğini fark ettin mi?`,
  koan: (i) => `Akmayan nehir ${i}: suyu nerede bekler?`,
  quote: (i) => `Aynı nehirde iki kez yıkanılmaz (${i}). — Herakleitos`,
  sensory: (i) => `Nefesini say: ${i}, ağır ağır.`,
};

function makeDeck(count = 50): RawDeck {
  const prompts = typeSequence(count).map((type, idx) => ({
    id: pid(idx + 1),
    type,
    text: TEXTS[type](idx + 1),
    sourceNote: NOTE,
  }));
  return { id: 'zaman', title: 'Zaman Üzerine', locale: 'tr', anchor: ANCHOR, prompts, closing: 'Ne kaldı?' };
}

/** Tam 70 karakter, boşlukla bitmez (trim sonrası da 70). */
const LONG_70 = 'Saatin tik takları arasında kalan boşlukta sen kimsin'.padEnd(70, '…');

const opts = { locale: 'tr' };

// ---------- processModelOutput ----------

describe('processModelOutput', () => {
  it('geçerli fixture uyarısız geçer', () => {
    const raw = makeDeck();
    const r = processModelOutput(raw, opts);
    expect(r.errors).toEqual([]);
    expect(r.rejected).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.deck).not.toBeNull();
    expect(r.deck?.prompts).toHaveLength(raw.prompts.length);
    expect(r.deck?.locale).toBe(LOCALE);
  });

  it('70 karakterlik iki prompt reddedilir, raporlanır; kalan ≥ 40 ise deste geçerli', () => {
    const raw = makeDeck(50);
    raw.prompts[5]!.text = LONG_70;
    raw.prompts[12]!.text = LONG_70.replace('S', 'Ş');
    const r = processModelOutput(raw, opts);
    expect(charLength(LONG_70)).toBe(70);
    expect(r.rejected).toHaveLength(2);
    expect(r.rejected.map((x) => x.id)).toEqual([pid(6), pid(13)]);
    for (const x of r.rejected) {
      expect(x.length).toBe(70);
      expect(x.reason).toContain(`sınır ${PROMPT_MAX_CHARS}`);
    }
    expect(r.rejected[0]!.text).toBe(LONG_70); // kırpılmadı
    expect(r.deck).not.toBeNull();
    expect(r.deck!.prompts).toHaveLength(48);
    expect(r.deck!.prompts.some((p) => p.id === pid(6))).toBe(false);
    expect(formatReport(r)).toContain(pid(6));
  });

  it('ikiden fazla satırlı prompt da reddedilir', () => {
    const raw = makeDeck(50);
    raw.prompts[3]!.text = 'bir\niki\nüç';
    const r = processModelOutput(raw, opts);
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected[0]!.reason).toMatch(/3 satır/);
    expect(r.deck).not.toBeNull();
  });

  it('reddedilenler yüzünden sayı 40 altına inerse deste geçersiz', () => {
    const raw = makeDeck(DECK_MIN_PROMPTS + 1);
    raw.prompts[2]!.text = LONG_70;
    raw.prompts[3]!.text = LONG_70;
    const r = processModelOutput(raw, opts);
    expect(r.deck).toBeNull();
    expect(r.rejected).toHaveLength(2);
    expect(r.errors.join('\n')).toContain(`En az ${DECK_MIN_PROMPTS}`);
  });

  it('çok az prompt → hata', () => {
    const r = processModelOutput(makeDeck(30), opts);
    expect(r.deck).toBeNull();
    expect(r.errors.some((e) => e.startsWith('prompts') && e.includes(`En az ${DECK_MIN_PROMPTS}`))).toBe(true);
  });

  it('çok fazla prompt → hata', () => {
    const r = processModelOutput(makeDeck(DECK_MAX_PROMPTS + 1), opts);
    expect(r.deck).toBeNull();
    expect(r.errors.join('\n')).toContain(`En fazla ${DECK_MAX_PROMPTS}`);
  });

  it('NFD girdi NFC olur; NFD kod noktası sayısı sınırı aşsa da reddedilmez', () => {
    const nfc = 'Şüphe mi, öğüt mü? Işığın içinde düşün, çığlığı duy şimdi.';
    expect(charLength(nfc)).toBeLessThanOrEqual(PROMPT_MAX_CHARS);
    const nfd = nfc.normalize('NFD');
    expect([...nfd].length).toBeGreaterThan(PROMPT_MAX_CHARS);
    const raw = makeDeck();
    raw.prompts[4]!.text = nfd;
    raw.title = 'Zaman Üzerine'.normalize('NFD');
    const r = processModelOutput(raw, opts);
    expect(r.rejected).toEqual([]);
    expect(r.deck!.prompts[4]!.text).toBe(nfc);
    expect(r.deck!.prompts[4]!.text).not.toBe(nfd);
    expect(r.deck!.title).toBe('Zaman Üzerine');
  });

  it('metinler kırpılır, CRLF \\n olur', () => {
    const raw = makeDeck();
    raw.prompts[1]!.text = '  Neyi bekliyorsun?\r\nVe neden?  ';
    raw.closing = '  Ne kaldı?  ';
    const r = processModelOutput(raw, opts);
    expect(r.deck!.prompts[1]!.text).toBe('Neyi bekliyorsun?\nVe neden?');
    expect(r.deck!.closing).toBe('Ne kaldı?');
  });

  it('anchor uyuşmazlığı uyarı verir', () => {
    const raw = makeDeck();
    raw.anchor = 'Süre';
    const r = processModelOutput(raw, opts);
    expect(r.deck).not.toBeNull();
    expect(r.warnings.some((w) => w.includes('anchor prompt metni') && w.includes('Süre'))).toBe(true);
  });

  it('anchor tipi sayısı 1 değilse uyarı verir', () => {
    const none = makeDeck();
    none.prompts[0]!.type = 'question';
    none.prompts[0]!.text = 'Zaman sende nerede ağırlaşıyor?';
    expect(processModelOutput(none, opts).warnings.join('\n')).toContain("'anchor' tipinde prompt yok");

    const two = makeDeck();
    two.prompts[1]!.type = 'anchor';
    two.prompts[1]!.text = ANCHOR;
    expect(processModelOutput(two, opts).warnings.join('\n')).toMatch(/2 adet 'anchor'/);
  });

  it('dağılım hedeften saparsa uyarı verir', () => {
    const raw = makeDeck(50);
    raw.prompts.forEach((p, i) => {
      if (i > 0) {
        p.type = 'question';
        p.text = TEXTS.question(i + 1);
      }
    });
    const r = processModelOutput(raw, opts);
    expect(r.deck).not.toBeNull();
    for (const t of Object.keys(DECK_TYPE_TARGETS)) {
      expect(r.warnings.some((w) => w.startsWith(`${t} oranı`))).toBe(true);
    }
  });

  it('dil config LOCALE ile eşleşmezse uyarı verir; locale her zaman istenen dil olur', () => {
    const raw = makeDeck();
    raw.locale = 'de';
    const r = processModelOutput(raw, { locale: 'en' });
    expect(r.deck!.locale).toBe('en');
    expect(r.warnings.some((w) => w.includes('(en)') && w.includes(LOCALE))).toBe(true);
  });

  it('tekrarlanan metin ve bozuk id biçimi uyarı verir', () => {
    const raw = makeDeck();
    raw.prompts[2]!.text = raw.prompts[1]!.text.toLocaleUpperCase('tr');
    raw.prompts[3]!.id = 'soru-4';
    const r = processModelOutput(raw, opts);
    expect(r.warnings.some((w) => w.startsWith('Tekrarlanan metin') && w.includes(pid(2)))).toBe(true);
    expect(r.warnings.some((w) => w.includes('soru-4'))).toBe(true);
  });

  it('id / title ezmeleri uygulanır; ezme yoksa model id slug olur', () => {
    const r = processModelOutput(makeDeck(), { locale: 'tr', id: 'yeni-deste', title: '  Yeni Başlık ' });
    expect(r.deck!.id).toBe('yeni-deste');
    expect(r.deck!.title).toBe('Yeni Başlık');

    const raw = makeDeck();
    raw.id = 'Zaman Üzerine: Işık';
    expect(processModelOutput(raw, opts).deck!.id).toBe('zaman-uzerine-isik');
  });

  it('geçersiz id ezmesi şema hatası verir', () => {
    const r = processModelOutput(makeDeck(), { locale: 'tr', id: 'Büyük Harf' });
    expect(r.deck).toBeNull();
    expect(r.errors.some((e) => e.startsWith('id:'))).toBe(true);
  });

  it('sourceNote verilirse tüm prompt\'lara yazılır; bilinmeyen sourceNote uyarı verir', () => {
    const raw = makeDeck();
    raw.prompts[3]!.sourceNote = 'baska.md';
    const forced = processModelOutput(raw, { locale: 'tr', sourceNote: 'zaman.md' });
    expect(forced.deck!.prompts.every((p) => p.sourceNote === 'zaman.md')).toBe(true);

    const multi = processModelOutput(raw, { locale: 'tr', notes: ['zaman.md', 'sure.md'] });
    expect(multi.warnings.some((w) => w.includes('baska.md'))).toBe(true);
  });

  it('boş sourceNote çıkarılır, şemayı düşürmez', () => {
    const raw = makeDeck();
    raw.prompts[0]!.sourceNote = '   ';
    const r = processModelOutput(raw, opts);
    expect(r.deck).not.toBeNull();
    expect('sourceNote' in r.deck!.prompts[0]!).toBe(false);
  });

  it('nesne olmayan çıktı ve yapısal hatalar', () => {
    expect(processModelOutput([1, 2], opts).errors).toEqual(['Model çıktısı bir JSON nesnesi değil.']);
    const raw = makeDeck() as unknown as { prompts: Record<string, unknown>[] };
    raw.prompts[7] = { id: 'p08', type: 'şiir', text: 'x' };
    const r = processModelOutput(raw, opts);
    expect(r.deck).toBeNull();
    expect(r.errors.some((e) => e.startsWith('prompts[7] (p08).type'))).toBe(true);
  });

  it('çok uzun anchor / closing şema hatasıdır ve uzunluğu gösterilir', () => {
    const raw = makeDeck();
    raw.closing = LONG_70;
    const r = processModelOutput(raw, opts);
    expect(r.deck).toBeNull();
    expect(r.errors.some((e) => e.startsWith('closing [70 karakter]'))).toBe(true);
  });
});

// ---------- Diğer yardımcılar ----------

describe('typeDistribution', () => {
  it('her tipi sayar, olmayanlar 0', () => {
    const r = processModelOutput(makeDeck(50), opts);
    const d = typeDistribution(r.deck!);
    expect(Object.keys(d).sort()).toEqual([...PROMPT_TYPES].sort());
    expect(d.anchor).toBe(1);
    expect(Object.values(d).reduce((a, b) => a + b, 0)).toBe(50);
    expect(d.koan).toBe(Math.round(DECK_TYPE_TARGETS.koan * 50));
  });
});

describe('buildRetryMessage', () => {
  it('reddedilen prompt\'ları ve hataları listeler', () => {
    const raw = makeDeck(DECK_MIN_PROMPTS);
    raw.prompts[2]!.text = LONG_70;
    const r = processModelOutput(raw, opts);
    expect(r.deck).toBeNull();
    const msg = buildRetryMessage(r);
    expect(msg).toContain(pid(3));
    expect(msg).toContain('70 characters');
    expect(msg).toContain(LONG_70);
    expect(msg).toContain(`En az ${DECK_MIN_PROMPTS}`);
    expect(msg).toMatch(/COMPLETE/);
    expect(msg).toMatch(/only the JSON/);
  });
});

describe('buildSystemPrompt', () => {
  const tr = buildSystemPrompt('tr');

  it('zorunlu kuralların hepsini anar', () => {
    expect(tr).toMatch(/core concept/);
    expect(tr).toContain('`anchor`');
    expect(tr).toMatch(/çağrışım/);
    expect(tr).toMatch(/associative/i);
    expect(tr).toMatch(/never a repetition/);
    expect(tr).toMatch(/no explanation, no hint and no answer/);
    expect(tr).toMatch(/CONCRETE ideas/);
    expect(tr).toMatch(/generic motivational/);
    expect(tr).toMatch(/Output ONLY the JSON/);
    expect(tr).toContain(`at most ${PROMPT_MAX_CHARS} characters`);
    expect(tr).toContain(`${DECK_MIN_PROMPTS}–${DECK_MAX_PROMPTS} prompts`);
    expect(tr).toContain('p01');
    expect(tr).toContain('sourceNote');
    expect(tr).toContain('closing');
    expect(tr).toMatch(/public-domain/);
    expect(tr).toMatch(/Never invent a quote/);
    expect(tr).toMatch(/exactly ONE prompt of this type/);
    for (const [t, ratio] of Object.entries(DECK_TYPE_TARGETS)) expect(tr).toContain(`${t} ≈${Math.round(ratio * 100)}%`);
  });

  it('tr: Türkçe ve imla rehberi; diğer dillerde yok', () => {
    expect(tr).toContain('Turkish');
    expect(tr).toContain('ç ğ ı İ ö ş ü');
    expect(tr).toContain('"Ne kaldı?"');
    const en = buildSystemPrompt('en');
    expect(en).toContain('Write every text in English (locale "en")');
    expect(en).not.toContain('Turkish orthography');
  });
});

describe('buildUserContent', () => {
  it('dosya adlarını ve içeriği NFC olarak içerir, BOM ve CRLF temizlenir', () => {
    const c = buildUserContent([
      { file: 'zaman.md', content: '﻿# Zaman\r\nŞimdi'.normalize('NFD') },
      { file: 'sure.md', content: 'Süre' },
    ]);
    expect(c).toContain('<note file="zaman.md">\n# Zaman\nŞimdi\n</note>');
    expect(c).toContain('<note file="sure.md">');
    expect(c).toContain('my 2 notes');
    expect(c).not.toContain('﻿');
    expect(c).toBe(c.normalize('NFC'));
  });
});

describe('parseModelText', () => {
  it('geçerli JSON', () => {
    expect(parseModelText('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
  });

  it('geçersiz JSON önizlemeyle döner', () => {
    const text = `Elbette! ${'x'.repeat(DECK_RAW_PREVIEW_CHARS * 2)}`;
    const r = parseModelText(text);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/geçerli JSON değil/);
      expect([...r.preview]).toHaveLength(DECK_RAW_PREVIEW_CHARS);
    }
  });
});

describe('DECK_OUTPUT_JSON_SCHEMA', () => {
  function objects(node: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
    if (Array.isArray(node)) node.forEach((n) => objects(n, out));
    else if (node && typeof node === 'object') {
      const rec = node as Record<string, unknown>;
      if (rec.type === 'object') out.push(rec);
      Object.values(rec).forEach((v) => objects(v, out));
    }
    return out;
  }

  it('her nesne düzeyinde additionalProperties: false ve tüm alanlar required', () => {
    const objs = objects(DECK_OUTPUT_JSON_SCHEMA);
    expect(objs).toHaveLength(2);
    for (const o of objs) {
      expect(o.additionalProperties).toBe(false);
      expect([...(o.required as string[])].sort()).toEqual(Object.keys(o.properties as object).sort());
    }
  });

  it('tip enum PROMPT_TYPES ile aynı; sınır anahtar kelimesi yok', () => {
    expect(DECK_OUTPUT_JSON_SCHEMA.properties.prompts.items.properties.type.enum).toEqual([...PROMPT_TYPES]);
    expect(JSON.stringify(DECK_OUTPUT_JSON_SCHEMA)).not.toMatch(/minItems|maxItems|minLength|maxLength|pattern/);
  });
});

describe('slugifyId / formatIssueList / formatReport', () => {
  it('Türkçe harfler ASCII olur', () => {
    expect(slugifyId('Işık ve Gölge — İçe Bakış')).toBe('isik-ve-golge-ice-bakis');
    expect(slugifyId('  ÇĞÖŞÜ âîû  ')).toBe('cgosu-aiu');
  });

  it('hata listesi +N ile özetlenir', () => {
    const errors = Array.from({ length: DECK_ERROR_MAX_ISSUES + 3 }, (_, i) => `hata ${i}`);
    const lines = formatIssueList(errors);
    expect(lines).toHaveLength(DECK_ERROR_MAX_ISSUES + 1);
    expect(lines.at(-1)).toContain('+3');
  });

  it('rapor tip dağılımını hedeflerle gösterir', () => {
    const report = formatReport(processModelOutput(makeDeck(50), opts));
    expect(report).toContain('50 prompt');
    expect(report).toMatch(/question\s+\d+\s+%\d+\s+\/ hedef %35/);
    expect(report).toContain('hedef 1');
  });
});
