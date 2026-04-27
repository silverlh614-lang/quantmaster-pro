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
    expect(computePositionRiskWeight(2 * DEFAULT_HALF_LIFE_DAYS)).toBeCloseTo(0.25, 5);
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
  it('R1_TURBO 는 ADR-0073 단축된 half-life 로 빠르게 감쇠', () => {
    const now = new Date('2026-04-08T00:00:00Z');
    const entry = '2026-04-01T00:00:00Z';
    const snap = halfLifeSnapshot({
      entryKelly: 0.4, entryIso: entry, regime: 'R1_TURBO', now,
    });
    expect(snap.halfLifeDays).toBe(REGIME_HALF_LIFE_DAYS.R1_TURBO);
    expect(snap.timeDecayWeight).toBeLessThan(1);
    // 5영업일 경과 → weight = 2^(-5 / R1_TURBO_HALFLIFE)
    expect(snap.timeDecayWeight).toBeCloseTo(Math.pow(2, -5 / REGIME_HALF_LIFE_DAYS.R1_TURBO), 2);
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

// ── ADR-0073: 레짐별 half-life 단축 (자본 회전율 +25%) ────────────────────
describe('ADR-0073 REGIME_HALF_LIFE_DAYS 단축', () => {
  it('6 레짐 모두 단축된 값 적용', () => {
    expect(REGIME_HALF_LIFE_DAYS.R1_TURBO).toBe(5);
    expect(REGIME_HALF_LIFE_DAYS.R2_BULL).toBe(8);
    expect(REGIME_HALF_LIFE_DAYS.R3_EARLY).toBe(10); // 사용자 직접 요청
    expect(REGIME_HALF_LIFE_DAYS.R4_NEUTRAL).toBe(8);
    expect(REGIME_HALF_LIFE_DAYS.R5_CAUTION).toBe(6);
    expect(REGIME_HALF_LIFE_DAYS.R6_DEFENSE).toBe(4);
  });

  it('DEFAULT_HALF_LIFE_DAYS = 8 (10에서 단축)', () => {
    expect(DEFAULT_HALF_LIFE_DAYS).toBe(8);
  });

  it('레짐 단조성: TURBO ≤ CAUTION ≤ R2/R4 ≤ R3_EARLY (방어/가속/정상/회복 순서 보존)', () => {
    expect(REGIME_HALF_LIFE_DAYS.R6_DEFENSE).toBeLessThan(REGIME_HALF_LIFE_DAYS.R1_TURBO);
    expect(REGIME_HALF_LIFE_DAYS.R1_TURBO).toBeLessThan(REGIME_HALF_LIFE_DAYS.R5_CAUTION);
    expect(REGIME_HALF_LIFE_DAYS.R5_CAUTION).toBeLessThan(REGIME_HALF_LIFE_DAYS.R2_BULL);
    expect(REGIME_HALF_LIFE_DAYS.R2_BULL).toBeLessThanOrEqual(REGIME_HALF_LIFE_DAYS.R3_EARLY);
  });

  it('R3_EARLY = 10 (사용자 직접 요청 — 거래일 기준 충분)', () => {
    expect(REGIME_HALF_LIFE_DAYS.R3_EARLY).toBe(10);
  });

  it('평균 half-life 6.83 영업일 (-21% 단축)', () => {
    const values = [
      REGIME_HALF_LIFE_DAYS.R1_TURBO,
      REGIME_HALF_LIFE_DAYS.R2_BULL,
      REGIME_HALF_LIFE_DAYS.R3_EARLY,
      REGIME_HALF_LIFE_DAYS.R4_NEUTRAL,
      REGIME_HALF_LIFE_DAYS.R5_CAUTION,
      REGIME_HALF_LIFE_DAYS.R6_DEFENSE,
    ];
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    expect(avg).toBeCloseTo(6.83, 1);
  });

  it('레짐 미상 fallback 도 DEFAULT_HALF_LIFE_DAYS 적용', () => {
    const halfLife = REGIME_HALF_LIFE_DAYS['UNKNOWN_REGIME'] ?? DEFAULT_HALF_LIFE_DAYS;
    expect(halfLife).toBe(8);
  });
});
