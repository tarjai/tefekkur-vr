// Deste formatının tek doğruluk kaynağı. Hem uygulama hem `scripts/build-deck.ts` bu şemayı kullanır.
import { z } from 'zod';
import { DECK_MAX_PROMPTS, DECK_MIN_PROMPTS, PROMPT_MAX_CHARS, PROMPT_MAX_LINES } from '../config';

export const PROMPT_TYPES = ['anchor', 'question', 'koan', 'quote', 'sensory'] as const;
export type PromptType = (typeof PROMPT_TYPES)[number];

/** Karakter sayısı: NFC'ye normalize edilmiş metnin kod noktası sayısı (birleşik `ş` tek karakter sayılır). */
export function charLength(text: string): number {
  return [...text.normalize('NFC')].length;
}

export function lineCount(text: string): number {
  return text.split('\n').length;
}

const promptText = z
  .string()
  .trim()
  .min(1, 'Metin boş olamaz.')
  .refine((s) => charLength(s) <= PROMPT_MAX_CHARS, {
    message: `En fazla ${PROMPT_MAX_CHARS} karakter olmalı.`,
  })
  .refine((s) => lineCount(s) <= PROMPT_MAX_LINES, {
    message: `En fazla ${PROMPT_MAX_LINES} satır olmalı.`,
  });

export const PromptTypeSchema = z.enum(PROMPT_TYPES);

export const PromptSchema = z.object({
  id: z.string().min(1),
  type: PromptTypeSchema,
  text: promptText,
  sourceNote: z.string().min(1).optional(),
});

export const DeckSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'id küçük harf, rakam ve tire içermeli.'),
  title: z.string().trim().min(1),
  locale: z.string().min(2),
  anchor: promptText,
  prompts: z
    .array(PromptSchema)
    .min(DECK_MIN_PROMPTS, `En az ${DECK_MIN_PROMPTS} prompt olmalı.`)
    .max(DECK_MAX_PROMPTS, `En fazla ${DECK_MAX_PROMPTS} prompt olmalı.`)
    .refine((ps) => new Set(ps.map((p) => p.id)).size === ps.length, {
      message: "Prompt id'leri benzersiz olmalı.",
    }),
  closing: promptText,
});

export type Prompt = z.infer<typeof PromptSchema>;
export type Deck = z.infer<typeof DeckSchema>;
