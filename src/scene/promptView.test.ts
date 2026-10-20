import { describe, expect, it } from 'vitest';
import {
  APPROACH_S,
  HOLD_SECONDS,
  PROMPT_BREATH_SCALE,
  PROMPT_MAX_LINES,
  PROMPT_READ_DISTANCE_M,
  PROMPT_START_DISTANCE_M,
  RETREAT_S,
  TEXT_LINE_HEIGHT,
} from '../config';
import type { ScheduledPrompt } from '../session/types';
import {
  PROMPT_FONT_SIZE_M,
  PROMPT_MIN_FONT_SIZE_M,
  displayText,
  easeInOut,
  estimateLineCount,
  fontSizeForAngle,
  promptPose,
  shrinkFontSize,
} from './promptView';

const SHOW = 10_000;
const ARRIVE = SHOW + APPROACH_S * 1000;
const HIDE = ARRIVE + HOLD_SECONDS.question * 1000;
const GONE = HIDE + RETREAT_S * 1000;

const prompt: ScheduledPrompt = {
  key: 'p01#1',
  promptId: 'p01',
  role: 'prompt',
  type: 'question',
  text: 'Şu an neyi erteliyorsun?',
  phase: 'deepening',
  showMs: SHOW,
  arriveMs: ARRIVE,
  hideMs: HIDE,
  goneMs: GONE,
};

const START = PROMPT_START_DISTANCE_M;
const READ = PROMPT_READ_DISTANCE_M;
const MID_DISTANCE = (START + READ) / 2;

describe('easeInOut', () => {
  it('uç noktalar ve orta nokta', () => {
    expect(easeInOut(0)).toBeCloseTo(0, 12);
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 12);
    expect(easeInOut(1)).toBeCloseTo(1, 12);
  });

  it('sıkıştırılmış', () => {
    expect(easeInOut(-1)).toBeCloseTo(0, 12);
    expect(easeInOut(2)).toBeCloseTo(1, 12);
  });

  it('monoton artan', () => {
    let prev = easeInOut(0);
    for (let x = 0.01; x <= 1.0001; x += 0.01) {
      const y = easeInOut(x);
      expect(y).toBeGreaterThanOrEqual(prev);
      prev = y;
    }
  });
});

describe('fontSizeForAngle', () => {
  it('2 m, 1.5° ≈ 0.05236 m', () => {
    expect(fontSizeForAngle(2, 1.5)).toBeCloseTo(0.05236, 5);
  });

  it('prompt yazı boyutu minimum açısal boyutun altında değil', () => {
    expect(PROMPT_FONT_SIZE_M).toBeGreaterThanOrEqual(PROMPT_MIN_FONT_SIZE_M);
  });
});

describe('satır sığdırma', () => {
  it('blok yüksekliğinden satır sayısı', () => {
    const fs = PROMPT_FONT_SIZE_M;
    for (const n of [1, 2, 3]) {
      expect(estimateLineCount(n * fs * TEXT_LINE_HEIGHT, fs)).toBe(n);
    }
  });

  it('2 satır veya altı küçültülmez', () => {
    expect(shrinkFontSize(PROMPT_FONT_SIZE_M, PROMPT_MAX_LINES, PROMPT_MIN_FONT_SIZE_M)).toBe(PROMPT_FONT_SIZE_M);
  });

  it('taşan metin küçülür ama minimumun altına inmez', () => {
    const shrunk = shrinkFontSize(PROMPT_FONT_SIZE_M, PROMPT_MAX_LINES + 1, PROMPT_MIN_FONT_SIZE_M);
    expect(shrunk).toBeLessThan(PROMPT_FONT_SIZE_M);
    expect(shrunk).toBeGreaterThanOrEqual(PROMPT_MIN_FONT_SIZE_M);
    expect(shrinkFontSize(PROMPT_FONT_SIZE_M, 50, PROMPT_MIN_FONT_SIZE_M)).toBe(PROMPT_MIN_FONT_SIZE_M);
  });
});

describe('promptPose', () => {
  it('showMs öncesi ve goneMs sonrası görünmez', () => {
    expect(promptPose(prompt, 0, 0.5).visible).toBe(false);
    expect(promptPose(prompt, SHOW - 1, 0.5).visible).toBe(false);
    expect(promptPose(prompt, GONE, 0.5).visible).toBe(false);
    expect(promptPose(prompt, GONE + 1000, 0.5).visible).toBe(false);
  });

  it('yaklaşma: 12 m / opaklık 0 → orta → 2 m / opaklık 1', () => {
    const atShow = promptPose(prompt, SHOW, 0.5);
    expect(atShow.visible).toBe(true);
    expect(atShow.distanceM).toBeCloseTo(START, 9);
    expect(atShow.opacity).toBeCloseTo(0, 9);
    expect(atShow.scale).toBe(1);

    const mid = promptPose(prompt, (SHOW + ARRIVE) / 2, 0.5);
    expect(mid.distanceM).toBeCloseTo(MID_DISTANCE, 9);
    expect(mid.opacity).toBeCloseTo(0.5, 9);
    expect(mid.scale).toBe(1);
  });

  it('arriveMs çevresinde süreklilik', () => {
    for (const breath of [0, 1]) {
      const before = promptPose(prompt, ARRIVE - 1, breath);
      const at = promptPose(prompt, ARRIVE, breath);
      expect(at.distanceM).toBeCloseTo(READ, 9);
      expect(at.opacity).toBe(1);
      expect(at.scale).toBeCloseTo(1, 9);
      expect(before.distanceM).toBeCloseTo(at.distanceM, 4);
      expect(before.opacity).toBeCloseTo(at.opacity, 4);
      expect(before.scale).toBeCloseTo(at.scale, 4);
    }
  });

  it('bekleme: okuma mesafesi, opaklık 1, ölçek ±%2 içinde', () => {
    for (let t = ARRIVE; t < HIDE; t += 250) {
      for (const breath of [0, 0.25, 0.5, 0.75, 1]) {
        const pose = promptPose(prompt, t, breath);
        expect(pose.distanceM).toBe(READ);
        expect(pose.opacity).toBe(1);
        expect(pose.scale).toBeGreaterThanOrEqual(1 - PROMPT_BREATH_SCALE - 1e-12);
        expect(pose.scale).toBeLessThanOrEqual(1 + PROMPT_BREATH_SCALE + 1e-12);
      }
    }
    const mid = (ARRIVE + HIDE) / 2;
    expect(promptPose(prompt, mid, 1).scale).toBeCloseTo(1 + PROMPT_BREATH_SCALE, 9);
    expect(promptPose(prompt, mid, 0).scale).toBeCloseTo(1 - PROMPT_BREATH_SCALE, 9);
    expect(promptPose(prompt, mid, 0.5).scale).toBeCloseTo(1, 9);
  });

  it('hideMs çevresinde süreklilik', () => {
    for (const breath of [0, 1]) {
      const before = promptPose(prompt, HIDE - 1, breath);
      const at = promptPose(prompt, HIDE, breath);
      expect(at.distanceM).toBeCloseTo(READ, 9);
      expect(at.opacity).toBeCloseTo(1, 9);
      expect(at.scale).toBe(1);
      expect(before.distanceM).toBeCloseTo(at.distanceM, 4);
      expect(before.opacity).toBeCloseTo(at.opacity, 4);
      expect(before.scale).toBeCloseTo(at.scale, 4);
    }
  });

  it('geri çekilme: 2 m → orta → 12 m, opaklık 1 → 0', () => {
    const mid = promptPose(prompt, (HIDE + GONE) / 2, 0.5);
    expect(mid.distanceM).toBeCloseTo(MID_DISTANCE, 9);
    expect(mid.opacity).toBeCloseTo(0.5, 9);
    expect(mid.scale).toBe(1);

    const end = promptPose(prompt, GONE - 1, 0.5);
    expect(end.visible).toBe(true);
    expect(end.distanceM).toBeCloseTo(START, 4);
    expect(end.opacity).toBeCloseTo(0, 4);
  });

  it('opaklık yaklaşırken artar, geri çekilirken azalır', () => {
    let prev = -1;
    for (let t = SHOW; t < ARRIVE; t += 500) {
      const o = promptPose(prompt, t, 0.5).opacity;
      expect(o).toBeGreaterThanOrEqual(prev);
      prev = o;
    }
    prev = 2;
    for (let t = HIDE; t < GONE; t += 500) {
      const o = promptPose(prompt, t, 0.5).opacity;
      expect(o).toBeLessThanOrEqual(prev);
      prev = o;
    }
  });
});

describe('displayText', () => {
  it('atfı kendi satırına alır', () => {
    expect(displayText('Aynı nehre iki kez girilmez. — Herakleitos')).toBe('Aynı nehre iki kez girilmez.\n— Herakleitos');
  });

  it('atıfsız metne dokunmaz, harf dönüşümü yapmaz', () => {
    expect(displayText('İçindeki saat kaçı gösteriyor?')).toBe('İçindeki saat kaçı gösteriyor?');
    expect(displayText('—Zaman')).toBe('—Zaman');
  });

  it('yalnız son tireyi atıf sayar', () => {
    expect(displayText('Bir — iki — Ad')).toBe('Bir — iki\n— Ad');
  });
});
