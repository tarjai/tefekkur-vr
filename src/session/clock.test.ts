// Seans saati testleri: başlatma, delta kırpma, timeScale, duraklatma, ?speed= ayrıştırma.
import { describe, expect, it } from 'vitest';
import { MAX_FRAME_DELTA_MS, SPEED_MAX, SPEED_MIN, SPEED_PARAM } from '../config';
import { createClock, parseTimeScale } from './clock';

const T0 = 5000;
const FRAME_MS = 16;

describe('createClock', () => {
  it('start() öncesi tick 0 döndürür ve ilerlemez', () => {
    const clock = createClock();
    expect(clock.started).toBe(false);
    expect(clock.tick(T0)).toBe(0);
    expect(clock.tick(T0 + 1000)).toBe(0);
    expect(clock.now()).toBe(0);
    expect(clock.lastDeltaMs).toBe(0);
  });

  it('gerçek süre kadar ilerler', () => {
    const clock = createClock();
    clock.start(T0);
    expect(clock.started).toBe(true);
    expect(clock.now()).toBe(0);
    expect(clock.tick(T0 + FRAME_MS)).toBe(FRAME_MS);
    expect(clock.tick(T0 + 2 * FRAME_MS)).toBe(2 * FRAME_MS);
    expect(clock.lastDeltaMs).toBe(FRAME_MS);
    expect(clock.lastRealDeltaMs).toBe(FRAME_MS);
    expect(clock.now()).toBe(2 * FRAME_MS);
  });

  it('uzun sıçrama MAX_FRAME_DELTA_MS ile, geri giden zaman 0 ile kırpılır', () => {
    const clock = createClock();
    clock.start(T0);
    expect(clock.tick(T0 + 60_000)).toBe(MAX_FRAME_DELTA_MS);
    expect(clock.lastRealDeltaMs).toBe(MAX_FRAME_DELTA_MS);
    const before = clock.now();
    expect(clock.tick(T0)).toBe(before);
    expect(clock.lastDeltaMs).toBe(0);
    expect(clock.lastRealDeltaMs).toBe(0);
    // Geri gidişten sonra yeni referans noktasından devam eder.
    expect(clock.tick(T0 + FRAME_MS)).toBe(before + FRAME_MS);
  });

  it('timeScale seans süresini çarpar, gerçek delta değişmez', () => {
    const scale = 30;
    const clock = createClock(scale);
    expect(clock.timeScale).toBe(scale);
    clock.start(T0);
    expect(clock.tick(T0 + 100)).toBe(100 * scale);
    expect(clock.lastDeltaMs).toBe(100 * scale);
    expect(clock.lastRealDeltaMs).toBe(100);
    // Kırpma gerçek süreye uygulanır.
    clock.tick(T0 + 100 + 10_000);
    expect(clock.lastDeltaMs).toBe(MAX_FRAME_DELTA_MS * scale);
  });

  it('geçersiz timeScale 1 olur, aşırı değerler kırpılır', () => {
    expect(createClock(0).timeScale).toBe(1);
    expect(createClock(-4).timeScale).toBe(1);
    expect(createClock(Number.NaN).timeScale).toBe(1);
    expect(createClock(Number.POSITIVE_INFINITY).timeScale).toBe(1);
    expect(createClock(SPEED_MAX * 10).timeScale).toBe(SPEED_MAX);
    expect(createClock(SPEED_MIN / 10).timeScale).toBe(SPEED_MIN);
  });

  it('duraklatma saati dondurur; gerçek delta akmaya devam eder', () => {
    const clock = createClock();
    clock.start(T0);
    clock.tick(T0 + 100);
    clock.pause();
    expect(clock.paused).toBe(true);
    expect(clock.tick(T0 + 200)).toBe(100);
    expect(clock.lastDeltaMs).toBe(0);
    expect(clock.lastRealDeltaMs).toBe(100);
    expect(clock.tick(T0 + 5000)).toBe(100);
    expect(clock.now()).toBe(100);
    clock.resume();
    expect(clock.paused).toBe(false);
    // Devamda duraklama süresi sıçraması yok: yalnızca son kareden bu yana geçen süre.
    expect(clock.tick(T0 + 5000 + FRAME_MS)).toBe(100 + FRAME_MS);
  });

  it('start() saati sıfırlar ve çalışır duruma getirir', () => {
    const clock = createClock();
    clock.start(T0);
    clock.tick(T0 + 200);
    clock.pause();
    clock.start(T0 + 1000);
    expect(clock.paused).toBe(false);
    expect(clock.now()).toBe(0);
    expect(clock.tick(T0 + 1000 + FRAME_MS)).toBe(FRAME_MS);
  });
});

describe('parseTimeScale', () => {
  const q = (value: string) => `?${SPEED_PARAM}=${value}`;

  it('geçerli değerleri okur', () => {
    expect(parseTimeScale(q('30'))).toBe(30);
    expect(parseTimeScale(q('2.5'))).toBe(2.5);
    expect(parseTimeScale(`?emu&${SPEED_PARAM}=4`)).toBe(4);
    expect(parseTimeScale(`${SPEED_PARAM}=8`)).toBe(8);
  });

  it('aralık dışını kırpar', () => {
    expect(parseTimeScale(q(String(SPEED_MAX * 100)))).toBe(SPEED_MAX);
    expect(parseTimeScale(q(String(SPEED_MIN / 100)))).toBe(SPEED_MIN);
  });

  it('yok, boş ya da geçersizse 1', () => {
    for (const search of ['', '?', '?emu', `?${SPEED_PARAM}`, q(''), q('abc'), q('0'), q('-3'), q('Infinity'), q('NaN')]) {
      expect(parseTimeScale(search)).toBe(1);
    }
  });
});
