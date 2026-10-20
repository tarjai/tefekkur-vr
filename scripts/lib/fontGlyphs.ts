// Bağımlılıksız, en küçük sfnt okuyucu: TrueType / CFF OpenType fontun 'cmap' tablosundan kod noktalarını çıkarır.
// Build sırasında Türkçe glif kontrolü için (scripts/lib/vitePluginFontCheck.ts).
// Aşağıdaki sayılar uygulama ayarı değil, OpenType dosya biçiminin sabitleridir.

/** Dosya imzaları (ilk 4 bayt, big-endian). */
const SIG_TRUETYPE = 0x00010000;
const SIG_TRUE = 0x74727565; // 'true' (Apple TrueType)
const SIG_OTTO = 0x4f54544f; // 'OTTO' (CFF OpenType)
const SIG_WOFF = 0x774f4646; // 'wOFF'
const SIG_WOFF2 = 0x774f4632; // 'wOF2'
const SIG_TTC = 0x74746366; // 'ttcf'
const TAG_CMAP = 0x636d6170; // 'cmap'

/** Tablo dizini: 12 baytlık başlık + tablo başına 16 baytlık kayıt. */
const OFFSET_TABLE_SIZE = 12;
const TABLE_RECORD_SIZE = 16;
/** cmap: 4 baytlık başlık + alt tablo başına 8 baytlık kodlama kaydı. */
const CMAP_HEADER_SIZE = 4;
const ENCODING_RECORD_SIZE = 8;
const FORMAT12_HEADER_SIZE = 16;
const FORMAT12_GROUP_SIZE = 12;
const FORMAT4_HEADER_SIZE = 14;

const PLATFORM_UNICODE = 0;
const PLATFORM_WINDOWS = 3;
const ENCODING_WIN_BMP = 1;
const ENCODING_WIN_FULL = 10;

/** Glif 0 = .notdef (eksik glif). */
const NOTDEF_GLYPH = 0;
const UINT16_MASK = 0xffff;
/** Format 4'te son segmentin zorunlu bitiş işareti; gerçek karakter değil. */
const FORMAT4_SENTINEL = 0xffff;
const MAX_CODE_POINT = 0x10ffff;

interface SubtableRef {
  platformId: number;
  encodingId: number;
  /** Dosya başından mutlak konum. */
  offset: number;
  format: number;
}

/** Sınır denetimli big-endian okuyucu. */
class ByteReader {
  private readonly view: DataView;

  constructor(bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get length(): number {
    return this.view.byteLength;
  }

  u16(offset: number): number {
    this.check(offset, 2);
    return this.view.getUint16(offset);
  }

  u32(offset: number): number {
    this.check(offset, 4);
    return this.view.getUint32(offset);
  }

  check(offset: number, size: number): void {
    if (offset < 0 || offset + size > this.view.byteLength) {
      throw new Error(`Font dosyası bozuk ya da eksik: ${offset}. bayttan ${size} bayt okunamadı.`);
    }
  }
}

function signatureHex(signature: number): string {
  return `0x${signature.toString(16).padStart(8, '0')}`;
}

/** İmzayı denetler; desteklenmeyen kapsayıcılar için açık hata verir. */
function assertSupportedSignature(signature: number): void {
  switch (signature) {
    case SIG_TRUETYPE:
    case SIG_TRUE:
    case SIG_OTTO:
      return;
    case SIG_WOFF:
      throw new Error('WOFF (sıkıştırılmış) font desteklenmiyor; glif kontrolü için TTF ya da OTF kullan.');
    case SIG_WOFF2:
      throw new Error('WOFF2 (sıkıştırılmış) font desteklenmiyor; glif kontrolü için TTF ya da OTF kullan.');
    case SIG_TTC:
      throw new Error('TrueType Collection (TTC) desteklenmiyor; tek bir TTF ya da OTF dosyası kullan.');
    default:
      throw new Error(`Tanınmayan font biçimi (imza ${signatureHex(signature)}); TTF ya da OTF bekleniyordu.`);
  }
}

/** Tablo dizininde 'cmap' tablosunun mutlak konumunu bulur. */
function findCmapOffset(r: ByteReader): number {
  const numTables = r.u16(4);
  for (let i = 0; i < numTables; i++) {
    const record = OFFSET_TABLE_SIZE + i * TABLE_RECORD_SIZE;
    if (r.u32(record) !== TAG_CMAP) continue;
    const offset = r.u32(record + 8);
    const length = r.u32(record + 12);
    r.check(offset, length);
    return offset;
  }
  throw new Error("Fontta 'cmap' tablosu yok; karakter eşlemesi okunamadı.");
}

function listSubtables(r: ByteReader, cmapOffset: number): SubtableRef[] {
  const count = r.u16(cmapOffset + 2);
  const out: SubtableRef[] = [];
  for (let i = 0; i < count; i++) {
    const record = cmapOffset + CMAP_HEADER_SIZE + i * ENCODING_RECORD_SIZE;
    const offset = cmapOffset + r.u32(record + 4);
    out.push({ platformId: r.u16(record), encodingId: r.u16(record + 2), offset, format: r.u16(offset) });
  }
  return out;
}

/** Tercih sırası (küçük önce): (3,10) f12 → (3,1) f4 → platform 0 f12 → platform 0 f4. Desteklenmiyorsa null. */
function subtableRank(s: SubtableRef): number | null {
  if (s.platformId === PLATFORM_WINDOWS && s.encodingId === ENCODING_WIN_FULL && s.format === 12) return 0;
  if (s.platformId === PLATFORM_WINDOWS && s.encodingId === ENCODING_WIN_BMP && s.format === 4) return 1;
  if (s.platformId === PLATFORM_UNICODE && s.format === 12) return 2;
  if (s.platformId === PLATFORM_UNICODE && s.format === 4) return 3;
  return null;
}

function pickSubtable(subtables: SubtableRef[]): SubtableRef {
  let best: SubtableRef | null = null;
  let bestRank = Infinity;
  for (const s of subtables) {
    const rank = subtableRank(s);
    if (rank !== null && rank < bestRank) {
      best = s;
      bestRank = rank;
    }
  }
  if (!best) {
    const found = subtables.map((s) => `(${s.platformId},${s.encodingId}) f${s.format}`).join(', ') || 'hiç yok';
    throw new Error(`Fontta desteklenen bir Unicode cmap alt tablosu yok (format 4 / 12). Bulunanlar: ${found}.`);
  }
  return best;
}

/** Format 4: BMP segment eşlemesi. */
function readFormat4(r: ByteReader, offset: number, out: Set<number>): void {
  const segCountX2 = r.u16(offset + 6);
  const segCount = segCountX2 / 2;
  const endBase = offset + FORMAT4_HEADER_SIZE;
  const startBase = endBase + segCountX2 + 2; // reservedPad
  const deltaBase = startBase + segCountX2;
  const rangeBase = deltaBase + segCountX2;

  for (let i = 0; i < segCount; i++) {
    const end = r.u16(endBase + i * 2);
    const start = r.u16(startBase + i * 2);
    const delta = r.u16(deltaBase + i * 2);
    const rangeOffsetPos = rangeBase + i * 2;
    const rangeOffset = r.u16(rangeOffsetPos);
    for (let c = start; c <= end; c++) {
      if (c === FORMAT4_SENTINEL) continue;
      let glyph: number;
      if (rangeOffset === 0) {
        glyph = (c + delta) & UINT16_MASK;
      } else {
        // idRangeOffset kendi konumuna göredir.
        glyph = r.u16(rangeOffsetPos + rangeOffset + (c - start) * 2);
        if (glyph !== NOTDEF_GLYPH) glyph = (glyph + delta) & UINT16_MASK;
      }
      if (glyph !== NOTDEF_GLYPH) out.add(c);
    }
  }
}

/** Format 12: ardışık kod noktası grupları (tüm Unicode). */
function readFormat12(r: ByteReader, offset: number, out: Set<number>): void {
  const numGroups = r.u32(offset + 12);
  r.check(offset + FORMAT12_HEADER_SIZE, numGroups * FORMAT12_GROUP_SIZE);
  for (let g = 0; g < numGroups; g++) {
    const base = offset + FORMAT12_HEADER_SIZE + g * FORMAT12_GROUP_SIZE;
    const start = r.u32(base);
    const end = Math.min(r.u32(base + 4), MAX_CODE_POINT);
    const startGlyph = r.u32(base + 8);
    for (let c = start; c <= end; c++) {
      if (startGlyph + (c - start) !== NOTDEF_GLYPH) out.add(c);
    }
  }
}

/** Fontun eşlediği (glif 0 olmayan) tüm Unicode kod noktaları. WOFF/WOFF2/TTC ya da cmap yoksa hata fırlatır. */
export function readCmapCodepoints(font: Uint8Array): Set<number> {
  const r = new ByteReader(font);
  if (r.length < OFFSET_TABLE_SIZE) {
    throw new Error(`Font dosyası çok kısa (${r.length} bayt); geçerli bir TTF/OTF değil.`);
  }
  assertSupportedSignature(r.u32(0));

  const subtable = pickSubtable(listSubtables(r, findCmapOffset(r)));
  const out = new Set<number>();
  if (subtable.format === 12) readFormat12(r, subtable.offset, out);
  else readFormat4(r, subtable.offset, out);
  return out;
}

/** `chars` içindeki (kod noktası bazında, tekrarsız, sırası korunmuş) fontta glifi olmayan karakterler. */
export function missingGlyphs(font: Uint8Array, chars: string): string[] {
  const codepoints = readCmapCodepoints(font);
  const seen = new Set<string>();
  const missing: string[] = [];
  for (const ch of chars) {
    if (seen.has(ch)) continue;
    seen.add(ch);
    const cp = ch.codePointAt(0);
    if (cp !== undefined && !codepoints.has(cp)) missing.push(ch);
  }
  return missing;
}
