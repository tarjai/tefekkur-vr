// Seans motorunun ortak tipleri: planner üretir, runner oynatır, sahne/ses/günlük dinler.
import type { PromptType } from '../deck/schema';
import type { PHASE_ORDER } from '../config';

export type PhaseName = (typeof PHASE_ORDER)[number];

/** Seans zamanı (ms, seans başından itibaren) ile faz aralığı: [startMs, endMs). */
export interface PhaseSpan {
  name: PhaseName;
  startMs: number;
  endMs: number;
}

export type PromptRole = 'anchor' | 'prompt' | 'closing';
export type ScheduledType = PromptType | 'closing';

/** Destede `anchor` tipinde prompt yoksa sentezlenen anchor'ın id'si. */
export const SYNTHETIC_ANCHOR_ID = 'anchor';
/** Seans sonu sorusunun (deck.closing) id'si. */
export const CLOSING_ID = 'closing';

/**
 * Çizelgedeki tek bir prompt görünümü. Tüm zamanlar seans zamanı (ms):
 * showMs: yaklaşma başlar (12 m, opaklık 0) → arriveMs: okuma mesafesine varır →
 * hideMs: geri çekilme başlar → goneMs: tamamen kaybolur (mesh serbest bırakılır).
 */
export interface ScheduledPrompt {
  /** Çizelgede benzersiz anahtar (anchor tekrarlarında da farklı). */
  key: string;
  /** Destedeki prompt id'si; sentez anchor için SYNTHETIC_ANCHOR_ID, kapanış için CLOSING_ID. */
  promptId: string;
  role: PromptRole;
  type: ScheduledType;
  text: string;
  phase: PhaseName;
  showMs: number;
  arriveMs: number;
  hideMs: number;
  goneMs: number;
}

export type TimelineEvent =
  | { kind: 'phaseStart'; atMs: number; phase: PhaseSpan }
  | { kind: 'promptShow'; atMs: number; prompt: ScheduledPrompt }
  | { kind: 'bell'; atMs: number; prompt: ScheduledPrompt }
  | { kind: 'promptHide'; atMs: number; prompt: ScheduledPrompt }
  | { kind: 'sessionEnd'; atMs: number };

export type TimelineEventKind = TimelineEvent['kind'];
export type TimelineEventOf<K extends TimelineEventKind> = Extract<TimelineEvent, { kind: K }>;

/** Aynı zaman damgasındaki olayların sırası (küçük önce). */
export const EVENT_ORDER: Record<TimelineEventKind, number> = {
  phaseStart: 0,
  promptHide: 1,
  promptShow: 2,
  bell: 3,
  sessionEnd: 4,
};

export interface Timeline {
  deckId: string;
  durationMs: number;
  seed: number;
  phases: PhaseSpan[];
  /** Gösterim sırasına göre (showMs artan). */
  prompts: ScheduledPrompt[];
  /** atMs artan, eşitlikte EVENT_ORDER'a göre sıralı; son olay sessionEnd. */
  events: TimelineEvent[];
}
