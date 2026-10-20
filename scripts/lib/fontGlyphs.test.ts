import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FONT_PATH, REQUIRED_GLYPHS } from '../../src/config';
import { missingGlyphs, readCmapCodepoints } from './fontGlyphs';
import { checkFontGlyphs } from './vitePluginFontCheck';

const FONT_FILE = path.resolve('public', FONT_PATH);
const realFont = new Uint8Array(readFileSync(FONT_FILE));

// ---------- Sentetik sfnt üreticileri ----------
const TRUETYPE = 0x00010000;
const OTTO = 0x4f54544f;

type Bytes = number[] | Uint8Array;

const u16 = (n: number): number[] => [(n >>> 8) & 0xff, n & 0xff];
const u32 = (n: number): number[] => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const tag = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));

function concat(...parts: Bytes[]): Uint8Array {
  const out: number[] = [];
  for (const p of parts) out.push(...p);
  return new Uint8Array(out);
}

function buildSfnt(signature: number, tables: [string, Uint8Array][]): Uint8Array {
  let offset = 12 + 16 * tables.length;
  const records: number[] = [];
  for (const [name, data] of tables) {
    records.push(...tag(name), ...u32(0), ...u32(offset), ...u32(data.length));
    offset += data.length;
  }
  return concat(u32(signature), u16(tables.length), u16(0), u16(0), u16(0), records, ...tables.map(([, d]) => d));
}

function buildCmap(subtables: { platform: number; encoding: number; data: Uint8Array }[]): Uint8Array {
  let offset = 4 + 8 * subtables.length;
  const records: number[] = [];
  for (const s of subtables) {
    records.push(...u16(s.platform), ...u16(s.encoding), ...u32(offset));
    offset += s.data.length;
  }
  return concat(u16(0), u16(subtables.length), records, ...subtables.map((s) => s.data));
}

function format12(groups: [start: number, end: number, startGlyph: number][]): Uint8Array {
  const body = groups.flatMap(([s, e, g]) => [...u32(s), ...u32(e), ...u32(g)]);
  return concat(u16(12), u16(0), u32(16 + body.length), u32(0), u32(groups.length), body);
}

/** Format 4; `glyphs` verilirse segment glyphIdArray (idRangeOffset ≠ 0) kullanır. 0xFFFF bitiş segmenti eklenir. */
function format4(segments: { start: number; end: number; delta?: number; glyphs?: number[] }[]): Uint8Array {
  const segs = [...segments, { start: 0xffff, end: 0xffff, delta: 1 }];
  const n = segs.length;
  const glyphArray: number[] = [];
  const rangeOffsets = segs.map((s, i) => {
    if (!('glyphs' in s) || !s.glyphs) return 0;
    const pos = glyphArray.length;
    glyphArray.push(...s.glyphs);
    return 2 * (n - i) + 2 * pos;
  });
  const body = concat(
    segs.flatMap((s) => u16(s.end)),
    u16(0),
    segs.flatMap((s) => u16(s.start)),
    segs.flatMap((s) => u16((s.delta ?? 0) & 0xffff)),
    rangeOffsets.flatMap((r) => u16(r)),
    glyphArray.flatMap((g) => u16(g)),
  );
  return concat(u16(4), u16(14 + body.length), u16(0), u16(n * 2), u16(0), u16(0), u16(0), body);
}

/** Gerçek fonttan (3,1) format 4 alt tablosunu ham bayt olarak çıkarır. */
function extractFormat4(font: Uint8Array): Uint8Array {
  const v = new DataView(font.buffer, font.byteOffset, font.byteLength);
  const numTables = v.getUint16(4);
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + 16 * i;
    if (String.fromCharCode(...font.subarray(rec, rec + 4)) !== 'cmap') continue;
    const cmap = v.getUint32(rec + 8);
    for (let j = 0; j < v.getUint16(cmap + 2); j++) {
      const er = cmap + 4 + 8 * j;
      const sub = cmap + v.getUint32(er + 4);
      if (v.getUint16(er) === 3 && v.getUint16(er + 2) === 1 && v.getUint16(sub) === 4) {
        return font.slice(sub, sub + v.getUint16(sub + 2));
      }
    }
  }
  throw new Error('test fontunda (3,1) format 4 yok');
}

const cp = (s: string): number => s.codePointAt(0) ?? -1;

describe('readCmapCodepoints — gerçek font', () => {
  const codepoints = readCmapCodepoints(realFont);

  it('zorunlu Türkçe gliflerin hepsi var', () => {
    expect(missingGlyphs(realFont, REQUIRED_GLYPHS)).toEqual([]);
  });

  it('ASCII harfleri ve rakamlar var', () => {
    const ascii = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    expect(missingGlyphs(realFont, ascii)).toEqual([]);
    expect(codepoints.has(cp('A'))).toBe(true);
  });

  it('emoji (U+1F600) eksik', () => {
    expect(codepoints.has(0x1f600)).toBe(false);
    expect(missingGlyphs(realFont, 'ş😀')).toEqual(['😀']);
  });

  it('format 4 alt tablosu, BMP içinde format 12 ile aynı kümeyi verir', () => {
    const synthetic = buildSfnt(TRUETYPE, [['cmap', buildCmap([{ platform: 3, encoding: 1, data: extractFormat4(realFont) }])]]);
    const bmp = [...codepoints].filter((c) => c <= 0xffff).sort((a, b) => a - b);
    expect([...readCmapCodepoints(synthetic)].sort((a, b) => a - b)).toEqual(bmp);
  });

  it('byteOffset sıfır olmayan görünümlerde de çalışır', () => {
    const padded = new Uint8Array(realFont.length + 7);
    padded.set(realFont, 7);
    expect(readCmapCodepoints(padded.subarray(7)).size).toBe(codepoints.size);
  });
});

describe('readCmapCodepoints — sentetik fontlar', () => {
  it('CFF (OTTO) + format 12; glif 0 eşlenen kod noktası sayılmaz', () => {
    const font = buildSfnt(OTTO, [
      ['head', new Uint8Array(8)],
      ['cmap', buildCmap([{ platform: 3, encoding: 10, data: format12([[0x41, 0x43, 0], [0x1f600, 0x1f601, 7]]) }])],
    ]);
    expect([...readCmapCodepoints(font)].sort((a, b) => a - b)).toEqual([0x42, 0x43, 0x1f600, 0x1f601]);
  });

  it("format 4: idDelta ve idRangeOffset yolları, 0xFFFF sayılmaz", () => {
    const data = format4([
      { start: 0x41, end: 0x42, delta: -0x40 }, // A→1, B→2
      { start: 0x011e, end: 0x0120, glyphs: [5, 0, 6] }, // Ğ→5, ğ→(0: eksik), Ġ→6
    ]);
    const font = buildSfnt(TRUETYPE, [['cmap', buildCmap([{ platform: 3, encoding: 1, data }])]]);
    expect([...readCmapCodepoints(font)].sort((a, b) => a - b)).toEqual([0x41, 0x42, 0x011e, 0x0120]);
  });

  it('(3,10) format 12, platform 0 alt tablosuna tercih edilir', () => {
    const font = buildSfnt(TRUETYPE, [
      [
        'cmap',
        buildCmap([
          { platform: 0, encoding: 3, data: format4([{ start: 0x41, end: 0x41, delta: 1 }]) },
          { platform: 3, encoding: 10, data: format12([[0x42, 0x42, 3]]) },
        ]),
      ],
    ]);
    expect([...readCmapCodepoints(font)]).toEqual([0x42]);
  });

  it('yalnız platform 0 varsa onu kullanır', () => {
    const font = buildSfnt(TRUETYPE, [
      ['cmap', buildCmap([{ platform: 0, encoding: 3, data: format4([{ start: 0x41, end: 0x41, delta: 1 }]) }])],
    ]);
    expect([...readCmapCodepoints(font)]).toEqual([0x41]);
  });
});

describe('readCmapCodepoints — hatalar', () => {
  const padded = (sig: string) => concat(tag(sig), new Uint8Array(32));

  it('WOFF / WOFF2 / TTC için açık hata', () => {
    expect(() => readCmapCodepoints(padded('wOFF'))).toThrow(/WOFF/);
    expect(() => readCmapCodepoints(padded('wOF2'))).toThrow(/WOFF2/);
    expect(() => readCmapCodepoints(padded('ttcf'))).toThrow(/TTC/);
  });

  it('tanınmayan imza ve kısa dosya', () => {
    expect(() => readCmapCodepoints(padded('GIF8'))).toThrow(/Tanınmayan font biçimi/);
    expect(() => readCmapCodepoints(new Uint8Array(4))).toThrow(/çok kısa/);
  });

  it('cmap tablosu yoksa', () => {
    expect(() => readCmapCodepoints(buildSfnt(TRUETYPE, [['head', new Uint8Array(8)]]))).toThrow(/'cmap' tablosu yok/);
  });

  it('desteklenmeyen alt tablo biçimi', () => {
    const font = buildSfnt(TRUETYPE, [['cmap', buildCmap([{ platform: 1, encoding: 0, data: concat(u16(0), u16(262)) }])]]);
    expect(() => readCmapCodepoints(font)).toThrow(/desteklenen bir Unicode cmap/);
  });

  it('kesik dosya sınır dışı okumada hata verir', () => {
    const truncated = buildSfnt(TRUETYPE, [['cmap', buildCmap([{ platform: 3, encoding: 10, data: format12([[0x41, 0x41, 1]]) }])]]);
    expect(() => readCmapCodepoints(truncated.subarray(0, truncated.length - 6))).toThrow(/bozuk ya da eksik/);
  });
});

describe('missingGlyphs', () => {
  it('kod noktası bazında, tekrarsız ve sırayı koruyarak döner', () => {
    expect(missingGlyphs(realFont, '😀ğ🙂😀ş')).toEqual(['😀', '🙂']);
  });
});

describe('checkFontGlyphs (Vite eklentisinin denetimi)', () => {
  it('eksik yoksa null', async () => {
    expect(await checkFontGlyphs(FONT_FILE, REQUIRED_GLYPHS)).toBeNull();
  });

  it('eksik glifleri listeler', async () => {
    const problem = await checkFontGlyphs(FONT_FILE, 'ç😀');
    expect(problem).toMatch(/1 zorunlu glif eksik/);
    expect(problem).toContain('U+1F600');
  });

  it('okunamayan dosyada hata metni döner', async () => {
    expect(await checkFontGlyphs(path.resolve('public/fonts/yok.ttf'), 'a')).toMatch(/Font dosyası okunamadı/);
  });
});
