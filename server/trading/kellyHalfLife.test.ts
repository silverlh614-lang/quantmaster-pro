import { describe, it, expect } from 'vitest';
import {
  computePositionRiskWeight, effectiveKellyAfter, businessDaysSince,
  halfLifeSnapshot, DEFAULT_HALF_LIFE_DAYS, REGIME_HALF_LIFE_DAYS,
} from './kellyHalfLife.js';

describe('computePositionRiskWeight', () => {
  it('t=0 → 1', () => {
    expect(computePositionRiskWeight(0)).toBe(1);
  });
  it('t = halfLife → 0.5', () => {
    expect(computePositionRiskWeight(DEFAULT_HALF_LIFE_DAYS)).toBeCloseTo(0.5, 5);
  });
  it('t = 2 × halfLife → 0.25', () => {
    expect(computePositionRiskWeight(20)).toBeCloseTo(0.25, 5);
  });
  it('음수 일수는 1 로 보정 (진입 전)', () => {
    expect(computePositionRiskWeight(-3)).toBe(1);
  });
});

describe('effectiveKellyAfter', () => {
  it('0.5 Kelly, halfLife=10일, t=10일 → 0.25', () => {
    expect(effectiveKellyAfter(0.5, 10, 10)).toBeCloseTo(0.25, 5);
  });
});

describe('businessDaysSince', () => {
  it('주말 보정 — 7 캘린더 일 → ≈ 5 영업일', () => {
    const entry = '2026-04-01T00:00:00Z';
    const now = new Date('2026-04-08T00:00:00Z'); // +7 calendar
    const d = businessDaysSince(entry, now);
    expect(d).toBeCloseTo(5, 0);
  });
});

describe('halfLifeSnapshot', () => {
  it('R1_TURBO 는 7일 half-life 로 빠르게 감쇠', () => {
    const now = new Date('2026-04-08T00:00:00Z');
    const entry = '2026-04-01T00:00:00Z';
    const snap = halfLifeSnapshot({
      entryKelly: 0.4, entryIso: entry, regime: 'R1_TURBO', now,
    });
    expect(snap.halfLifeDays).toBe(REGIME_HALF_LIFE_DAYS.R1_TURBO);
    expect(snap.timeDecayWeight).toBeLessThan(1);
    // 5영업일 경과, half=7 → weight = 2^(-5/7) ≈ 0.611
    expect(snap.timeDecayWeight).toBeCloseTo(Math.pow(2, -5/7), 2);
  });
  it('trimCandidate: weight < 0.5 일 때 true', () => {
    const now = new Date('2026-05-01T00:00:00Z');
    const entry = '2026-04-01T00:00:00Z'; // 30 calendar ≈ 21.4 business days
    const snap = halfLifeSnapshot({
      entryKelly: 0.4, entryIso: entry, regime: 'R2_BULL', now,
    });
    expect(snap.trimCandidate).toBe(true);
  });
});
