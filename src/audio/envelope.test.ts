import { describe, expect, it } from 'vitest';
import { PHASE_ORDER, PHASE_RATIOS } from '../config';
import type { PhaseName, PhaseSpan } from '../session/types';
import { sessionLevelAt } from './envelope';

const MINUTE_MS = 60_000;
const DURATION_MS = 45 * MINUTE_MS;

/** Config oranlarıyla ardışık faz aralıkları (planner'ın ürettiği biçimde). */
function buildPhases(durationMs: number): PhaseSpan[] {
  const spans: PhaseSpan[] = [];
  let startMs = 0;
  PHASE_ORDER.forEach((name, i) => {
    const endMs = i === PHASE_ORDER.length - 1 ? durationMs : startMs + PHASE_RATIOS[name] * durationMs;
    spans.push({ name, startMs, endMs });
    startMs = endMs;
  });
  return spans;
}

const phases = buildPhases(DURATION_MS);

function span(name: PhaseName): PhaseSpan {
  const found = phases.find((p) => p.name === name);
  if (!found) throw new Error(`faz yok: ${name}`);
  return found;
}

/** [startMs, endMs] aralığında eşit aralıklı örnekler. */
function samples(startMs: number, endMs: number, count = 400): number[] {
  return Array.from({ length: count + 1 }, (_, i) => startMs + ((endMs - startMs) * i) / count);
}

describe('sessionLevelAt', () => {
  it('seans başlamadan önce ve geçersiz zamanda 0', () => {
    expect(sessionLevelAt(-1, phases)).toBe(0);
    expect(sessionLevelAt(-MINUTE_MS, phases)).toBe(0);
    expect(sessionLevelAt(Number.NaN, phases)).toBe(0);
    expect(sessionLevelAt(Number.NEGATIVE_INFINITY, phases)).toBe(0);
  });

  it('arrival: 0 → 1, ortada 0.5', () => {
    const a = span('arrival');
    expect(sessionLevelAt(a.startMs, phases)).toBe(0);
    expect(sessionLevelAt((a.startMs + a.endMs) / 2, phases)).toBeCloseTo(0.5, 10);
    expect(sessionLevelAt(a.endMs, phases)).toBe(1);
  });

  it('arrival boyunca monoton artan', () => {
    const a = span('arrival');
    const values = samples(a.startMs, a.endMs).map((t) => sessionLevelAt(t, phases));
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThan(values[i - 1]!);
    }
  });

  it('seed, deepening, plateau boyunca 1', () => {
    for (const name of ['seed', 'deepening', 'plateau'] as const) {
      const s = span(name);
      for (const t of samples(s.startMs, s.endMs - 1, 50)) {
        expect(sessionLevelAt(t, phases)).toBe(1);
      }
    }
  });

  it('return: 1 → 0, ortada 0.5, sonda ve sonrasında 0', () => {
    const r = span('return');
    expect(sessionLevelAt(r.startMs, phases)).toBe(1);
    expect(sessionLevelAt((r.startMs + r.endMs) / 2, phases)).toBeCloseTo(0.5, 10);
    expect(sessionLevelAt(r.endMs - 1, phases)).toBeLessThan(1e-6);
    expect(sessionLevelAt(r.endMs, phases)).toBe(0);
    expect(sessionLevelAt(DURATION_MS + MINUTE_MS, phases)).toBe(0);
    expect(sessionLevelAt(Number.POSITIVE_INFINITY, phases)).toBe(0);
  });

  it('return boyunca monoton azalan', () => {
    const r = span('return');
    const values = samples(r.startMs, r.endMs - 1).map((t) => sessionLevelAt(t, phases));
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeLessThan(values[i - 1]!);
    }
  });

  it('faz sınırlarında sürekli', () => {
    const epsilonMs = 1;
    const tolerance = 1e-5;
    for (const s of phases) {
      const boundary = s.startMs;
      const before = sessionLevelAt(boundary - epsilonMs, phases);
      const at = sessionLevelAt(boundary, phases);
      const after = sessionLevelAt(boundary + epsilonMs, phases);
      expect(Math.abs(at - before)).toBeLessThan(tolerance);
      expect(Math.abs(after - at)).toBeLessThan(tolerance);
    }
    const end = sessionLevelAt(DURATION_MS - epsilonMs, phases);
    expect(end).toBeLessThan(tolerance);
  });

  it('her zaman 0..1 aralığında', () => {
    for (const t of samples(-MINUTE_MS, DURATION_MS + MINUTE_MS, 2000)) {
      const v = sessionLevelAt(t, phases);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('farklı sürelerde aynı biçim', () => {
    for (const minutes of [30, 60]) {
      const ps = buildPhases(minutes * MINUTE_MS);
      const a = ps[0]!;
      const r = ps[ps.length - 1]!;
      expect(sessionLevelAt((a.startMs + a.endMs) / 2, ps)).toBeCloseTo(0.5, 10);
      expect(sessionLevelAt((r.startMs + r.endMs) / 2, ps)).toBeCloseTo(0.5, 10);
      expect(sessionLevelAt(r.endMs, ps)).toBe(0);
    }
  });

  describe('eksik fazlar', () => {
    it('faz listesi boşsa seans içinde 1, öncesinde 0', () => {
      expect(sessionLevelAt(0, [])).toBe(1);
      expect(sessionLevelAt(DURATION_MS, [])).toBe(1);
      expect(sessionLevelAt(-1, [])).toBe(0);
    });

    it('arrival yoksa baştan 1', () => {
      const withoutArrival = phases.filter((p) => p.name !== 'arrival');
      expect(sessionLevelAt(0, withoutArrival)).toBe(1);
      expect(sessionLevelAt(span('seed').startMs, withoutArrival)).toBe(1);
    });

    it('return yoksa sona kadar 1, sonda 0', () => {
      const withoutReturn = phases.filter((p) => p.name !== 'return');
      const lastEnd = span('plateau').endMs;
      expect(sessionLevelAt(lastEnd - 1, withoutReturn)).toBe(1);
      expect(sessionLevelAt(lastEnd, withoutReturn)).toBe(0);
    });

    it('süresi 0 olan faz sorun çıkarmaz', () => {
      const zero: PhaseSpan[] = [
        { name: 'arrival', startMs: 0, endMs: 0 },
        { name: 'seed', startMs: 0, endMs: 1000 },
        { name: 'return', startMs: 1000, endMs: 1000 },
      ];
      expect(sessionLevelAt(0, zero)).toBe(1);
      expect(sessionLevelAt(999, zero)).toBe(1);
      expect(sessionLevelAt(1000, zero)).toBe(0);
    });
  });
});
