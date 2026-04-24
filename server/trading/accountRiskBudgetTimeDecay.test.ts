/**
 * @responsibility ADR-0008 accountRiskBudget 시간감쇠 wiring 회귀 테스트.
 *
 * computeRiskAdjustedSize 의 timeDecayInput 옵션이 신규 진입 등가성을 유지하면서
 * 보유 중 재평가 경로에서만 decayedKelly 를 적용하는지 검증.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  computeRiskAdjustedSize,
  type AccountRiskBudgetSnapshot,
} from './accountRiskBudget.js';
import { DEFAULT_HALF_LIFE_DAYS } from './kellyHalfLife.js';

function mkBudget(overrides: Partial<AccountRiskBudgetSnapshot> = {}): AccountRiskBudgetSnapshot {
  return {
    dailyLossLimitPct: 4,
    dailyLossPct: 0,
    dailyLossRemainingPct: 4,
    maxConcurrentRiskPct: 6,
    openRiskPct: 0,
    concurrentRiskRemainingPct: 6,
    maxPerTradeRiskPct: 1.5,
    maxSectorWeightPct: 30,
    canEnterNew: true,
    blockedReasons: [],
    ...overrides,
  };
}

const TOTAL_ASSETS = 100_000_000;

const BASE_INPUT = {
  entryPrice: 10_000,
  stopLoss: 9_500,
  signalGrade: 'STRONG_BUY' as const,
  kellyMultiplier: 0.4,
  confidenceModifier: 1.0,
  totalAssets: TOTAL_ASSETS,
};

describe('ADR-0008 — accountRiskBudget 시간감쇠 wiring', () => {
  afterEach(() => {
    delete process.env.KELLY_TIME_DECAY_ENABLED;
  });

  it('timeDecayInput 없음 → effectiveKelly === staticKelly (신규 진입 등가성)', () => {
    const r = computeRiskAdjustedSize({
      ...BASE_INPUT,
      budget: mkBudget(),
    });
    expect(r.effectiveKelly).toBe(r.staticKelly);
    expect(r.effectiveKelly).toBeGreaterThan(0);
  });

  it('daysHeld=0 → weight=1 → effectiveKelly === staticKelly', () => {
    const r = computeRiskAdjustedSize({
      ...BASE_INPUT,
      budget: mkBudget(),
      timeDecayInput: { daysHeld: 0, halfLifeDays: DEFAULT_HALF_LIFE_DAYS },
    });
    expect(r.effectiveKelly).toBe(r.staticKelly);
  });

  it('daysHeld=halfLifeDays → weight≈0.5 → effectiveKelly ≈ staticKelly × 0.5', () => {
    const baseline = computeRiskAdjustedSize({
      ...BASE_INPUT,
      budget: mkBudget(),
    });
    const decayed = computeRiskAdjustedSize({
      ...BASE_INPUT,
      budget: mkBudget(),
      timeDecayInput: { daysHeld: 10, halfLifeDays: 10 },
    });
    expect(decayed.effectiveKelly).toBeCloseTo(decayed.staticKelly * 0.5, 5);
    // 시간감쇠로 Kelly 예산이 절반으로 줄면 총 권장 자본도 감소해야 함 (capitalByKelly 가 활성일 때)
    expect(decayed.recommendedBudgetKrw).toBeLessThanOrEqual(baseline.recommendedBudgetKrw);
  });

  it('daysHeld=2×halfLifeDays → weight≈0.25', () => {
    const r = computeRiskAdjustedSize({
      ...BASE_INPUT,
      budget: mkBudget(),
      timeDecayInput: { daysHeld: 20, halfLifeDays: 10 },
    });
    expect(r.effectiveKelly).toBeCloseTo(r.staticKelly * 0.25, 5);
  });

  it('KELLY_TIME_DECAY_ENABLED=false → 단락: timeDecayInput 있어도 staticKelly 반환', () => {
    process.env.KELLY_TIME_DECAY_ENABLED = 'false';
    const r = computeRiskAdjustedSize({
      ...BASE_INPUT,
      budget: mkBudget(),
      timeDecayInput: { daysHeld: 30, halfLifeDays: 10 },
    });
    expect(r.effectiveKelly).toBe(r.staticKelly);
  });

  it('halfLifeDays ≤ 0 → computePositionRiskWeight 가드로 weight=1', () => {
    const r = computeRiskAdjustedSize({
      ...BASE_INPUT,
      budget: mkBudget(),
      timeDecayInput: { daysHeld: 10, halfLifeDays: 0 },
    });
    expect(r.effectiveKelly).toBe(r.staticKelly);
  });

  it('계좌 게이트 차단 상태에서도 staticKelly/effectiveKelly 둘 다 0 으로 일관성 유지', () => {
    const r = computeRiskAdjustedSize({
      ...BASE_INPUT,
      budget: mkBudget({ canEnterNew: false, blockedReasons: ['daily loss limit'] }),
      timeDecayInput: { daysHeld: 10, halfLifeDays: 10 },
    });
    expect(r.effectiveKelly).toBe(0);
    expect(r.staticKelly).toBe(0);
    expect(r.recommendedBudgetKrw).toBe(0);
  });
});
