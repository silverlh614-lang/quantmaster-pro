import { describe, expect, it } from 'vitest';
import { getFXAdjustmentFactor, getRateCycleAdjustment } from './quant/fxRateCycleEngine';
import type { FXRegime, RateCycle } from '../types/macro';

// ─── getFXAdjustmentFactor ───────────────────────────────────────────────────

describe('getFXAdjustmentFactor — FX 레짐별 조정 팩터', () => {
  it('NEUTRAL 레짐: 수출 비중과 무관하게 항상 0 반환', () => {
    expect(getFXAdjustmentFactor('NEUTRAL', 0)).toBe(0);
    expect(getFXAdjustmentFactor('NEUTRAL', 50)).toBe(0);
    expect(getFXAdjustmentFactor('NEUTRAL', 100)).toBe(0);
  });

  it('DOLLAR_STRONG + 수출주(100%): 최대 +3점 (수출 유리)', () => {
    const factor = getFXAdjustmentFactor('DOLLAR_STRONG', 100);
    expect(factor).toBe(3);
  });

  it('DOLLAR_STRONG + 내수주(0%): 최소 -3점 (내수 불리)', () => {
    const factor = getFXAdjustmentFactor('DOLLAR_STRONG', 0);
    expect(factor).toBe(-3);
  });

  it('DOLLAR_WEAK + 수출주(100%): -3점 (수출 불리)', () => {
    const factor = getFXAdjustmentFactor('DOLLAR_WEAK', 100);
    expect(factor).toBe(-3);
  });

  it('DOLLAR_WEAK + 내수주(0%): +3점 (내수 유리)', () => {
    const factor = getFXAdjustmentFactor('DOLLAR_WEAK', 0);
    expect(factor).toBe(3);
  });

  it('수출 50% (중립): 어떤 레짐이든 0 반환', () => {
    expect(getFXAdjustmentFactor('DOLLAR_STRONG', 50)).toBe(0);
    expect(getFXAdjustmentFactor('DOLLAR_WEAK', 50)).toBe(0);
  });

  it('수출 비중 75%: DOLLAR_STRONG → +1.5점', () => {
    // bias = (75 - 25) / 100 = 0.5, direction = +1, result = 0.5 × 1 × 3 = 1.5
    const factor = getFXAdjustmentFactor('DOLLAR_STRONG', 75);
    expect(factor).toBeCloseTo(1.5, 2);
  });

  it('수출 비중 25%: DOLLAR_STRONG → -1.5점', () => {
    // bias = (25 - 75) / 100 = -0.5, direction = +1, result = -0.5 × 1 × 3 = -1.5
    const factor = getFXAdjustmentFactor('DOLLAR_STRONG', 25);
    expect(factor).toBeCloseTo(-1.5, 2);
  });

  it('DOLLAR_STRONG 과 DOLLAR_WEAK은 같은 수출 비중에서 대칭(부호 반전)', () => {
    const exportRatio = 70;
    const strong = getFXAdjustmentFactor('DOLLAR_STRONG', exportRatio);
    const weak   = getFXAdjustmentFactor('DOLLAR_WEAK',   exportRatio);
    expect(strong).toBeCloseTo(-weak, 5);
  });

  it('반환값은 소수점 2자리까지만 표현 (parseFloat 정밀도)', () => {
    const factor = getFXAdjustmentFactor('DOLLAR_STRONG', 33);
    // bias = (33-67)/100 = -0.34, × 3 = -1.02
    expect(Number.isFinite(factor)).toBe(true);
    expect(String(factor).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(2);
  });
});

// ─── getRateCycleAdjustment ──────────────────────────────────────────────────

describe('getRateCycleAdjustment — 금리 사이클별 Gate 파라미터', () => {
  it('TIGHTENING: ICR 최소 점수 7 (강화), 성장성 부스트 1.0 (유지)', () => {
    const adj = getRateCycleAdjustment('TIGHTENING');
    expect(adj.gate1IcrMinScore).toBe(7);
    expect(adj.gate2GrowthWeightBoost).toBe(1.0);
  });

  it('EASING: ICR 최소 점수 5 (기본), 성장성 부스트 1.2 (상향)', () => {
    const adj = getRateCycleAdjustment('EASING');
    expect(adj.gate1IcrMinScore).toBe(5);
    expect(adj.gate2GrowthWeightBoost).toBe(1.2);
  });

  it('PAUSE: ICR 최소 점수 5 (기본), 성장성 부스트 1.0 (유지)', () => {
    const adj = getRateCycleAdjustment('PAUSE');
    expect(adj.gate1IcrMinScore).toBe(5);
    expect(adj.gate2GrowthWeightBoost).toBe(1.0);
  });

  it('TIGHTENING은 EASING보다 ICR 요건이 더 엄격', () => {
    const tight = getRateCycleAdjustment('TIGHTENING');
    const easy  = getRateCycleAdjustment('EASING');
    expect(tight.gate1IcrMinScore).toBeGreaterThan(easy.gate1IcrMinScore);
  });

  it('EASING은 TIGHTENING보다 성장성 가중치 부스트가 더 높음', () => {
    const tight = getRateCycleAdjustment('TIGHTENING');
    const easy  = getRateCycleAdjustment('EASING');
    expect(easy.gate2GrowthWeightBoost).toBeGreaterThan(tight.gate2GrowthWeightBoost);
  });

  it('모든 사이클에서 반환 객체가 두 필드를 가짐', () => {
    const cycles: RateCycle[] = ['TIGHTENING', 'EASING', 'PAUSE'];
    for (const c of cycles) {
      const adj = getRateCycleAdjustment(c);
      expect(adj.gate1IcrMinScore).toBeDefined();
      expect(adj.gate2GrowthWeightBoost).toBeDefined();
    }
  });
});
