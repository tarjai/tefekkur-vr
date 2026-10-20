// Seans günlüğü: gösterilen ve duraklatılan prompt'lar, kapanış cevabı. localStorage'da tutulur,
// tek Markdown dosyası olarak dışa aktarılır.
import { z } from 'zod';
import { LOCALE, STORAGE_KEY_SESSIONS } from '../config';
import { STRINGS } from '../strings';

const SessionRecordSchema = z.object({
  id: z.string(),
  date: z.string(),
  deckId: z.string(),
  deckTitle: z.string(),
  closingQuestion: z.string(),
  durationMs: z.number(),
  elapsedMs: z.number(),
  completed: z.boolean(),
  shownPromptIds: z.array(z.string()),
  pausedPromptIds: z.array(z.string()),
  closingAnswer: z.string(),
});

export type SessionRecord = z.infer<typeof SessionRecordSchema>;

/** localStorage'ın kullanılan alt kümesi (testte bellek içi sahte ile değiştirilir). */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Gizli pencere / engelli depolamada erişim hata fırlatabilir; o durumda null. */
export function browserStore(): KeyValueStore | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export interface SessionRecorder {
  readonly record: SessionRecord;
  promptShown(promptId: string): void;
  paused(promptId: string | null): void;
  finish(elapsedMs: number, completed: boolean): SessionRecord;
}

export function createSessionRecorder(init: {
  deckId: string;
  deckTitle: string;
  closingQuestion: string;
  durationMs: number;
  date: Date;
}): SessionRecorder {
  const record: SessionRecord = {
    id: `${init.date.getTime().toString(36)}-${init.deckId}`,
    date: init.date.toISOString(),
    deckId: init.deckId,
    deckTitle: init.deckTitle,
    closingQuestion: init.closingQuestion,
    durationMs: init.durationMs,
    elapsedMs: 0,
    completed: false,
    shownPromptIds: [],
    pausedPromptIds: [],
    closingAnswer: '',
  };
  const addUnique = (list: string[], id: string) => {
    if (!list.includes(id)) list.push(id);
  };
  return {
    record,
    promptShown: (id) => addUnique(record.shownPromptIds, id),
    paused: (id) => {
      if (id) addUnique(record.pausedPromptIds, id);
    },
    finish(elapsedMs, completed) {
      record.elapsedMs = Math.round(elapsedMs);
      record.completed = completed;
      return record;
    },
  };
}

export function loadSessions(store: KeyValueStore | null = browserStore()): SessionRecord[] {
  if (!store) return [];
  try {
    const parsed: unknown = JSON.parse(store.getItem(STORAGE_KEY_SESSIONS) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      const result = SessionRecordSchema.safeParse(item);
      return result.success ? [result.data] : [];
    });
  } catch {
    return [];
  }
}

/** Kaydı id'ye göre ekler ya da günceller. Depolama yoksa / yazılamazsa false. */
export function saveSession(record: SessionRecord, store: KeyValueStore | null = browserStore()): boolean {
  if (!store) return false;
  try {
    const sessions = loadSessions(store).filter((s) => s.id !== record.id);
    sessions.push(record);
    sessions.sort((a, b) => a.date.localeCompare(b.date));
    store.setItem(STORAGE_KEY_SESSIONS, JSON.stringify(sessions));
    return true;
  } catch {
    return false;
  }
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds === 0 ? STRINGS.minutes(minutes) : `${STRINGS.minutes(minutes)} ${seconds} sn`;
}

function quoteBlock(text: string): string {
  return text
    .trim()
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

export interface MarkdownOptions {
  /** Prompt id'sini metne çevirir (deste yüklüyse); bulunamazsa yalnız id yazılır. */
  promptText?: (deckId: string, promptId: string) => string | undefined;
}

export function sessionsToMarkdown(records: readonly SessionRecord[], options: MarkdownOptions = {}): string {
  const dateFormat = new Intl.DateTimeFormat(LOCALE, { dateStyle: 'full', timeStyle: 'short' });
  const promptLine = (deckId: string, id: string) => {
    const text = options.promptText?.(deckId, id);
    return text ? `\`${id}\` ${text.replace(/\n/g, ' ')}` : `\`${id}\``;
  };
  const list = (deckId: string, ids: readonly string[], ordered: boolean) =>
    ids.length === 0
      ? STRINGS.exportNone
      : ids.map((id, i) => `${ordered ? `${i + 1}.` : '-'} ${promptLine(deckId, id)}`).join('\n');

  const sections = records.map((r) => {
    const lines = [
      `## ${dateFormat.format(new Date(r.date))} — ${r.deckTitle}`,
      '',
      `- **${STRINGS.exportDeck}:** ${r.deckTitle} (\`${r.deckId}\`)`,
      `- **${STRINGS.exportDuration}:** ${formatDuration(r.durationMs)}`,
      `- **${STRINGS.exportElapsed}:** ${formatDuration(r.elapsedMs)}`,
      `- **${STRINGS.exportCompleted}:** ${r.completed ? STRINGS.yes : STRINGS.no}`,
      '',
      `### ${STRINGS.exportShown}`,
      '',
      list(r.deckId, r.shownPromptIds, true),
      '',
      `### ${STRINGS.exportPaused}`,
      '',
      list(r.deckId, r.pausedPromptIds, false),
      '',
      `### ${STRINGS.exportClosing}`,
      '',
      r.closingQuestion,
      '',
      `### ${STRINGS.exportAnswer}`,
      '',
      r.closingAnswer.trim() ? quoteBlock(r.closingAnswer) : STRINGS.exportNone,
    ];
    return lines.join('\n');
  });

  return [`# ${STRINGS.exportTitle}`, '', ...sections.flatMap((s) => [s, ''])].join('\n');
}

/** Metni dosya olarak indirir (tarayıcı). */
export function downloadText(fileName: string, text: string, mime = 'text/markdown;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
