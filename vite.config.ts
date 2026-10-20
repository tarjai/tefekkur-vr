import { defineConfig } from 'vitest/config';
import { fontGlyphCheck } from './scripts/lib/vitePluginFontCheck.ts';
import { FONT_PATH, REQUIRED_GLYPHS } from './src/config.ts';

/** three.js tek başına ~700 kB; uyarı eşiği buna göre. */
const CHUNK_SIZE_WARNING_KB = 1000;

export default defineConfig({
  // Göreli taban: GitHub Pages alt dizini dahil her statik hostta çalışır.
  base: './',
  plugins: [fontGlyphCheck({ fontFile: `public/${FONT_PATH}`, required: REQUIRED_GLYPHS })],
  server: { port: 5173, strictPort: true },
  build: { target: 'es2022', chunkSizeWarningLimit: CHUNK_SIZE_WARNING_KB },
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    environment: 'node',
    // Kalıcı modül önbelleği dosya içeriğine bakar; decks/'e yeni deste eklenince
    // loader'daki import.meta.glob sonucunu bayat bırakır. Test takımı zaten ~1 sn.
    fsModuleCache: false,
  },
});
