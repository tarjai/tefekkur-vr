import { describe, expect, it } from 'vitest';
import { BREATH_PERIOD_S, MOOD_TRANSITION_S } from '../config';
import { breathAt } from './breath';
import { moodAt } from './environment';

const PERIOD_MS = BREATH_PERIOD_S * 1000;

describe('breathAt', () => {
  it('t = 0 → 0 (nefes verilmiş)', () => {
    expect(breathAt(0)).toBeCloseTo(0, 10);
  });

  it('çeyrek periyot → 0.5', () => {
    expect(breathAt(PERIOD_MS / 4)).toBeCloseTo(0.5, 10);
    expect(breathAt((3 * PERIOD_MS) / 4)).toBeCloseTo(0.5, 10);
  });

  it('yarım periyot → 1 (nefes alınmış)', () => {
    expect(breathAt(PERIOD_MS / 2)).toBeCloseTo(1, 10);
  });

  it('tam periyot → 0 ve periyodik', () => {
    expect(breathAt(PERIOD_MS)).toBeCloseTo(0, 10);
    expect(breathAt(1234 + 3 * PERIOD_MS)).toBeCloseTo(breathAt(1234), 9);
  });

  it('her zaman 0..1 aralığında', () => {
    for (let t = 0; t <= 3 * PERIOD_MS; t += 37) {
      const b = breathAt(t);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(1);
    }
  });
});

describe('moodAt (ortam havası)', () => {
  const MOOD_MS = MOOD_TRANSITION_S * 1000;
  const PLATEAU = 100_000;
  const RETURN = 200_000;

  it('faz kaydı yoksa nötr', () => {
    expect(moodAt(500_000, null, null)).toEqual({ darkness: 0, brightness: 0 });
  });

  it('plateau başından itibaren koyulaşır', () => {
    expect(moodAt(PLATEAU, PLATEAU, null).darkness).toBe(0);
    expect(moodAt(PLATEAU + MOOD_MS / 2, PLATEAU, null).darkness).toBeCloseTo(0.5, 10);
    expect(moodAt(PLATEAU + MOOD_MS, PLATEAU, null).darkness).toBe(1);
    expect(moodAt(PLATEAU + MOOD_MS, PLATEAU, null).brightness).toBe(0);
  });

  it('return başından itibaren koyuluk kalkar, aydınlık gelir', () => {
    const start = moodAt(RETURN, PLATEAU, RETURN);
    expect(start).toEqual({ darkness: 1, brightness: 0 });
    const mid = moodAt(RETURN + MOOD_MS / 2, PLATEAU, RETURN);
    expect(mid.darkness).toBeCloseTo(0.5, 10);
    expect(mid.brightness).toBeCloseTo(0.5, 10);
    expect(moodAt(RETURN + MOOD_MS, PLATEAU, RETURN)).toEqual({ darkness: 0, brightness: 1 });
  });
});
