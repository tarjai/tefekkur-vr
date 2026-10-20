import { describe, expect, it } from 'vitest';
import { STORAGE_KEY_SESSIONS } from '../config';
import {
  createSessionRecorder,
  loadSessions,
  saveSession,
  sessionsToMarkdown,
  type KeyValueStore,
} from './sessionLog';

function memoryStore(initial: Record<string, string> = {}): KeyValueStore & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

function sampleRecorder() {
  return createSessionRecorder({
    deckId: 'zaman',
    deckTitle: 'Zaman',
    closingQuestion: 'Ne kaldı?',
    durationMs: 45 * 60_000,
    date: new Date('2026-10-20T18:30:00Z'),
  });
}

describe('sessionLog', () => {
  it('gösterilen ve duraklatılan prompt id’lerini sırayla ve tekil tutar', () => {
    const rec = sampleRecorder();
    rec.promptShown('p01');
    rec.promptShown('p02');
    rec.promptShown('p01');
    rec.paused(null);
    rec.paused('p02');
    rec.paused('p02');
    const record = rec.finish(1234.6, true);
    expect(record.shownPromptIds).toEqual(['p01', 'p02']);
    expect(record.pausedPromptIds).toEqual(['p02']);
    expect(record.elapsedMs).toBe(1235);
    expect(record.completed).toBe(true);
  });

  it('localStorage anahtarı contemplation.sessions altında ekler ve günceller', () => {
    const store = memoryStore();
    const record = sampleRecorder().finish(60_000, false);
    expect(saveSession(record, store)).toBe(true);
    record.closingAnswer = 'Bekleyişin kendisi.';
    expect(saveSession(record, store)).toBe(true);
    const loaded = loadSessions(store);
    expect(Object.keys(store.data)).toEqual([STORAGE_KEY_SESSIONS]);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.closingAnswer).toBe('Bekleyişin kendisi.');
  });

  it('bozuk veriyi ve depolama yokluğunu tolere eder', () => {
    expect(loadSessions(memoryStore({ [STORAGE_KEY_SESSIONS]: '{bozuk' }))).toEqual([]);
    expect(loadSessions(memoryStore({ [STORAGE_KEY_SESSIONS]: '[{"id":1}]' }))).toEqual([]);
    expect(loadSessions(null)).toEqual([]);
    expect(saveSession(sampleRecorder().record, null)).toBe(false);
  });

  it('Markdown dışa aktarımı Türkçe başlıklar, prompt metinleri ve alıntılanmış cevap içerir', () => {
    const rec = sampleRecorder();
    rec.promptShown('p01');
    rec.paused('p01');
    const record = rec.finish(45 * 60_000, true);
    record.closingAnswer = 'Çocukluğun yazları.\nIşık.';
    const md = sessionsToMarkdown([record], {
      promptText: (deckId, id) => (deckId === 'zaman' && id === 'p01' ? 'Şu an ne kadar uzun?' : undefined),
    });
    expect(md).toContain('# Tefekkür Seansları');
    expect(md).toContain('Zaman (`zaman`)');
    expect(md).toContain('1. `p01` Şu an ne kadar uzun?');
    expect(md).toContain('- `p01` Şu an ne kadar uzun?');
    expect(md).toContain('> Çocukluğun yazları.\n> Işık.');
    expect(md).toContain('45 dk');
    expect(md).toContain('Ne kaldı?');
  });
});
