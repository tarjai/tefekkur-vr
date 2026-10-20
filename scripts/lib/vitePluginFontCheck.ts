// Vite eklentisi: dev ve build başında fontta zorunlu gliflerin varlığını denetler; eksik varsa build durur.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Plugin } from 'vite';
import { missingGlyphs } from './fontGlyphs.ts';

export const FONT_GLYPH_CHECK_PLUGIN_NAME = 'tefekkur-font-glyph-check';

export interface FontGlyphCheckOptions {
  /** Vite köküne (yoksa cwd'ye) göreli font yolu. */
  fontFile: string;
  /** Fontta bulunması zorunlu karakterler. */
  required: string;
}

/** Eksik glifi okunur biçimde yazar: `ğ (U+011F)`. */
function describeChar(ch: string): string {
  const cp = ch.codePointAt(0) ?? 0;
  return `${ch} (U+${cp.toString(16).toLocaleUpperCase('tr').padStart(4, '0')})`;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Denetimi yapar; sorun yoksa null, varsa hata metni döndürür. */
export async function checkFontGlyphs(fontPath: string, required: string): Promise<string | null> {
  let font: Uint8Array;
  try {
    font = await readFile(fontPath);
  } catch (err) {
    return `Font dosyası okunamadı: ${fontPath} (${errorMessage(err)})`;
  }

  let missing: string[];
  try {
    missing = missingGlyphs(font, required);
  } catch (err) {
    return `Font çözümlenemedi: ${fontPath} — ${errorMessage(err)}`;
  }

  if (missing.length === 0) return null;
  return (
    `Fontta ${missing.length} zorunlu glif eksik (${fontPath}): ${missing.map(describeChar).join(', ')}. ` +
    'Türkçe karakterleri (Latin Extended-A) tam kapsayan bir font kullan.'
  );
}

export function fontGlyphCheck(options: FontGlyphCheckOptions): Plugin {
  let root = process.cwd();
  return {
    name: FONT_GLYPH_CHECK_PLUGIN_NAME,
    configResolved(config) {
      root = config.root;
    },
    async buildStart() {
      const problem = await checkFontGlyphs(path.resolve(root, options.fontFile), options.required);
      if (problem) this.error(problem);
    },
  };
}
