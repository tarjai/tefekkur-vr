// Seed'li sözde rastgele sayı üreteci ve kararlı metin özeti. Saf: Math.random / Date yok.

// mulberry32 algoritma sabitleri (ayar değil).
const MULBERRY_INCREMENT = 0x6d2b79f5;
const UINT32_RANGE = 0x100000000;

/** mulberry32: aynı tohum → aynı dizi; her çağrı [0, 1) aralığında sayı döndürür. */
export function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + MULBERRY_INCREMENT) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / UINT32_RANGE;
  };
}

// FNV-1a 32 bit sabitleri (ayar değil).
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const BYTE_MASK = 0xff;
const BYTE_BITS = 8;

/** FNV-1a (32 bit), metnin UTF-16LE baytları üzerinden: aynı metin → aynı işaretsiz 32 bit sayı. */
export function hashString(text: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    hash ^= unit & BYTE_MASK;
    hash = Math.imul(hash, FNV_PRIME);
    hash ^= unit >>> BYTE_BITS;
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}
