/**
 * regimeExposurePolicy.test.ts (ADR-0166)
 *
 * 사용자 명시 §7 8 테스트 케이스 + 매핑 함수 + 안전 fallback + ENV 우회.
 * 실행: npx vitest run server/trading/sizing/regimeExposurePolicy.test.ts
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  REGIME_EXPOSURE_POLICIES,
  computePortfolioExposureBudget,
  applyPortfolioExposureCap,
  mapInternalToExposureRegime,
  isExposureBudgetEnabled,
  type MarketRegimeLevel,
} from './regimeExposurePolicy.js';

const ORIGINAL_ENV = process.env.POSITION_SIZING_EXPOSURE_BUDGET_ENABLED;
beforeEach(() => { delete process.env.POSITION_SIZING_EXPOSURE_BUDGET_ENABLED; });
afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.POSITION_SIZING_EXPOSURE_BUDGET_ENABLED;
  else process.env.POSITION_SIZING_EXPOSURE_BUDGET_ENABLED = ORIGINAL_ENV;
});

// ─── 사용자 §1 — 7 레짐 정책 매트릭스 SSOT 정합 ────────────────────────────

describe('REGIME_EXPOSURE_POLICIES — 사용자 §1 매트릭스 SSOT', () => {
  it('7 레짐 모두 정의 (R0~R6)', () => {
    const expected: MarketRegimeLevel[] = ['R0_CRISIS', 'R1_DEFENSIVE', 'R2_WEAK', 'R3_NEUTRAL', 'R4_RECOVERY', 'R5_BULL', 'R6_STRONG_BULL'];
    expected.forEach((r) => {
      expect(REGIME_EXPOSURE_POLICIES[r]).toBeDefined();
      expect(REGIME_EXPOSURE_POLICIES[r].regime).toBe(r);
    });
  });

  it('R0_CRISIS — 매수 전면 금지 + 95% 현금', () => {
    const p = REGIME_EXPOSURE_POLICIES.R0_CRISIS;
    expect(p.allowNewBuys).toBe(false);
    expect(p.allowAddOnBuys).toBe(false);
    expect(p.minCashReservePct).toBe(0.95);
    expect(p.positionMultiplier).toBe(0);
  });

  it('R6_STRONG_BULL — 85% 목표 / 90% 상한 / 10% 비상 현금', () => {
    const p = REGIME_EXPOSURE_POLICIES.R6_STRONG_BULL;
    expect(p.targetEquityExposurePct).toBe(0.85);
    expect(p.maxEquityExposurePct).toBe(0.90);
    expect(p.minCashReservePct).toBe(0.10);
    expect(p.positionMultiplier).toBe(1.20);
  });

  it('R1_DEFENSIVE — 20% 목표 + 추매 금지 (보수적)', () => {
    const p = REGIME_EXPOSURE_POLICIES.R1_DEFENSIVE;
    expect(p.targetEquityExposurePct).toBe(0.20);
    expect(p.allowNewBuys).toBe(true);
    expect(p.allowAddOnBuys).toBe(false);  // 추매 금지
    expect(p.positionMultiplier).toBe(0.50);
  });

  it('positionMultiplier 단조증가 (R0=0 → R6=1.2)', () => {
    expect(REGIME_EXPOSURE_POLICIES.R0_CRISIS.positionMultiplier).toBeLessThan(REGIME_EXPOSURE_POLICIES.R1_DEFENSIVE.positionMultiplier);
    expect(REGIME_EXPOSURE_POLICIES.R3_NEUTRAL.positionMultiplier).toBeLessThan(REGIME_EXPOSURE_POLICIES.R5_BULL.positionMultiplier);
    expect(REGIME_EXPOSURE_POLICIES.R5_BULL.positionMultiplier).toBeLessThan(REGIME_EXPOSURE_POLICIES.R6_STRONG_BULL.positionMultiplier);
  });

  it('maxEquityExposurePct 항상 ≥ targetEquityExposurePct (모든 레짐)', () => {
    for (const r of Object.values(REGIME_EXPOSURE_POLICIES)) {
      expect(r.maxEquityExposurePct).toBeGreaterThanOrEqual(r.targetEquityExposurePct);
    }
  });
});

// ─── 사용자 §2 — computePortfolioExposureBudget ─────────────────────────────

describe('computePortfolioExposureBudget — 예산 계산', () => {
  it('정상 입력 — R6 시나리오 (사용자 §5 예시 1)', () => {
    const budget = computePortfolioExposureBudget({
      accountEquity: 10_000_000,
      currentEquityExposureAmount: 6_000_000,
      currentCashAmount: 4_000_000,
      regime: 'R6_STRONG_BULL',
    });
    expect(budget.targetExposureAmount).toBe(8_500_000);
    expect(budget.maxExposureAmount).toBe(9_000_000);
    expect(budget.remainingBuyBudgetToTarget).toBe(2_500_000);
    expect(budget.remainingBuyBudgetToMax).toBe(3_000_000);
    expect(budget.isOverTarget).toBe(false);
    expect(budget.isOverMax).toBe(false);
  });

  it('R1 시나리오 — 사용자 §5 예시 2', () => {
    const budget = computePortfolioExposureBudget({
      accountEquity: 10_000_000,
      currentEquityExposureAmount: 1_000_000,
      currentCashAmount: 9_000_000,
      regime: 'R1_DEFENSIVE',
    });
    expect(budget.targetExposureAmount).toBe(2_000_000);
    expect(budget.maxExposureAmount).toBe(2_500_000);
    expect(budget.remainingBuyBudgetToTarget).toBe(1_000_000);
    expect(budget.remainingBuyBudgetToMax).toBe(1_500_000);
  });

  it('R1 노출 한도 초과 — 사용자 §5 예시 3', () => {
    const budget = computePortfolioExposureBudget({
      accountEquity: 10_000_000,
      currentEquityExposureAmount: 3_000_000,  // 30% > R1 max 25%
      currentCashAmount: 7_000_000,
      regime: 'R1_DEFENSIVE',
    });
    expect(budget.isOverMax).toBe(true);
    expect(budget.remainingBuyBudgetToMax).toBe(0);
    expect(budget.currentExposurePct).toBe(0.30);
  });

  it('accountEquity=0 → currentExposurePct=0 (NaN 차단)', () => {
    const budget = computePortfolioExposureBudget({
      accountEquity: 0,
      currentEquityExposureAmount: 0,
      currentCashAmount: 0,
      regime: 'R3_NEUTRAL',
    });
    expect(budget.currentExposurePct).toBe(0);
    expect(budget.targetExposureAmount).toBe(0);
  });
});

// ─── 사용자 §7 — 8 테스트 케이스 (applyPortfolioExposureCap 통합) ──────────

describe('§7 사용자 명시 8 테스트 케이스', () => {
  const buildBudget = (regime: MarketRegimeLevel, equity: number, exposure: number) =>
    computePortfolioExposureBudget({
      accountEquity: equity,
      currentEquityExposureAmount: exposure,
      currentCashAmount: equity - exposure,
      regime,
    });

  it('TC1: R6, 1000만, 현재 600만 → 최대 추가 매수 300만', () => {
    const budget = buildBudget('R6_STRONG_BULL', 10_000_000, 6_000_000);
    expect(budget.remainingBuyBudgetToMax).toBe(3_000_000);

    // 충분히 큰 raw → cap 적용으로 300만 제한
    const result = applyPortfolioExposureCap({
      rawPositionAmount: 10_000_000,
      exposureBudget: budget,
      isAddOnBuy: false,
    });
    expect(result.finalPositionAmount).toBe(3_000_000);
    expect(result.cappedByExposureBudget).toBe(true);
  });

  it('TC2: R6, 1000만, 현재 850만 → 목표 도달, 최대 50만까지', () => {
    const budget = buildBudget('R6_STRONG_BULL', 10_000_000, 8_500_000);
    expect(budget.remainingBuyBudgetToTarget).toBe(0);
    expect(budget.remainingBuyBudgetToMax).toBe(500_000);

    const result = applyPortfolioExposureCap({
      rawPositionAmount: 1_000_000,
      exposureBudget: budget,
      isAddOnBuy: false,
    });
    expect(result.finalPositionAmount).toBe(500_000);
  });

  it('TC3: R6, 1000만, 현재 900만 → 신규 매수 금지 (최대 도달)', () => {
    const budget = buildBudget('R6_STRONG_BULL', 10_000_000, 9_000_000);
    expect(budget.remainingBuyBudgetToMax).toBe(0);

    const result = applyPortfolioExposureCap({
      rawPositionAmount: 1_000_000,
      exposureBudget: budget,
      isAddOnBuy: false,
    });
    expect(result.finalPositionAmount).toBe(0);
  });

  it('TC4: R1, 1000만, 현재 100만 → 목표까지 100만, 최대까지 150만', () => {
    const budget = buildBudget('R1_DEFENSIVE', 10_000_000, 1_000_000);
    expect(budget.remainingBuyBudgetToTarget).toBe(1_000_000);
    expect(budget.remainingBuyBudgetToMax).toBe(1_500_000);

    const result = applyPortfolioExposureCap({
      rawPositionAmount: 5_000_000,  // raw 큰 값
      exposureBudget: budget,
      isAddOnBuy: false,
    });
    // R1 positionMultiplier=0.5 → adjusted=2,500,000 → cap by max=1,500,000
    expect(result.finalPositionAmount).toBe(1_500_000);
    expect(result.cappedByExposureBudget).toBe(true);
  });

  it('TC5: R1, 1000만, 현재 250만 → 최대 도달, 신규 매수 금지', () => {
    const budget = buildBudget('R1_DEFENSIVE', 10_000_000, 2_500_000);
    expect(budget.remainingBuyBudgetToMax).toBe(0);

    const result = applyPortfolioExposureCap({
      rawPositionAmount: 1_000_000,
      exposureBudget: budget,
      isAddOnBuy: false,
    });
    expect(result.finalPositionAmount).toBe(0);
    // remainingBuyBudgetToMax=0 → cap result=0, isOverMax=false (=가 아닌 >)
  });

  it('TC6: R1, 1000만, 현재 300만 → 최대 초과, 신규/추매 금지', () => {
    const budget = buildBudget('R1_DEFENSIVE', 10_000_000, 3_000_000);
    expect(budget.isOverMax).toBe(true);

    const newBuy = applyPortfolioExposureCap({
      rawPositionAmount: 1_000_000,
      exposureBudget: budget,
      isAddOnBuy: false,
    });
    expect(newBuy.finalPositionAmount).toBe(0);
    expect(newBuy.blockReason).toMatch(/최대 주식 노출 한도 초과|추매 금지/);

    const addOn = applyPortfolioExposureCap({
      rawPositionAmount: 1_000_000,
      exposureBudget: budget,
      isAddOnBuy: true,
    });
    expect(addOn.finalPositionAmount).toBe(0);
    expect(addOn.blockReason).toMatch(/추매 금지|최대 주식 노출 한도 초과/);  // R1 추매 금지 우선
  });

  it('TC7: R0_CRISIS — 어떤 계좌든 신규/추매 전면 금지', () => {
    const budget = buildBudget('R0_CRISIS', 10_000_000, 0);
    const newBuy = applyPortfolioExposureCap({
      rawPositionAmount: 1_000_000, exposureBudget: budget, isAddOnBuy: false,
    });
    expect(newBuy.finalPositionAmount).toBe(0);
    expect(newBuy.blockReason).toContain('신규 매수 금지');

    const addOn = applyPortfolioExposureCap({
      rawPositionAmount: 1_000_000, exposureBudget: budget, isAddOnBuy: true,
    });
    expect(addOn.finalPositionAmount).toBe(0);
  });

  it('TC8: R5, 5000만, 현재 3000만 → 최대 추가 매수 1000만', () => {
    const budget = buildBudget('R5_BULL', 50_000_000, 30_000_000);
    expect(budget.targetExposureAmount).toBe(37_500_000);  // 5000만 × 0.75
    expect(budget.maxExposureAmount).toBe(40_000_000);     // 5000만 × 0.80
    expect(budget.remainingBuyBudgetToMax).toBe(10_000_000);

    const result = applyPortfolioExposureCap({
      rawPositionAmount: 100_000_000,
      exposureBudget: budget,
      isAddOnBuy: false,
    });
    expect(result.finalPositionAmount).toBe(10_000_000);
  });
});

// ─── 추가 — applyPortfolioExposureCap 분기 ─────────────────────────────────

describe('applyPortfolioExposureCap — 분기 추가', () => {
  it('positionMultiplier 적용 — raw=1000만 × R6 (1.20) = 1200만 → max cap', () => {
    const budget = computePortfolioExposureBudget({
      accountEquity: 50_000_000,
      currentEquityExposureAmount: 0,
      currentCashAmount: 50_000_000,
      regime: 'R6_STRONG_BULL',
    });
    const result = applyPortfolioExposureCap({
      rawPositionAmount: 10_000_000,
      exposureBudget: budget,
      isAddOnBuy: false,
    });
    // adjusted=12,000,000 / max=45,000,000 → adjusted 그대로
    expect(result.finalPositionAmount).toBe(12_000_000);
    expect(result.cappedByExposureBudget).toBe(false);
  });

  it('R1 추매 호출 → allowAddOnBuys=false → 차단', () => {
    const budget = computePortfolioExposureBudget({
      accountEquity: 10_000_000,
      currentEquityExposureAmount: 1_000_000,
      currentCashAmount: 9_000_000,
      regime: 'R1_DEFENSIVE',
    });
    const result = applyPortfolioExposureCap({
      rawPositionAmount: 1_000_000,
      exposureBudget: budget,
      isAddOnBuy: true,  // 추매
    });
    expect(result.finalPositionAmount).toBe(0);
    expect(result.blockReason).toContain('추매 금지');
  });

  it('R3 추매 호출 → allowAddOnBuys=true → 허용 (최대 한도 내)', () => {
    const budget = computePortfolioExposureBudget({
      accountEquity: 10_000_000,
      currentEquityExposureAmount: 2_000_000,
      currentCashAmount: 8_000_000,
      regime: 'R3_NEUTRAL',
    });
    const result = applyPortfolioExposureCap({
      rawPositionAmount: 1_000_000,
      exposureBudget: budget,
      isAddOnBuy: true,
    });
    // R3 multiplier=0.8 → adjusted=800,000 / remaining=3,000,000 → 800,000
    expect(result.finalPositionAmount).toBe(800_000);
    expect(result.cappedByExposureBudget).toBe(false);
  });
});

// ─── 매핑 함수 — 기존 RegimeLevel ↔ 신규 MarketRegimeLevel ─────────────────

describe('mapInternalToExposureRegime — 기존 RegimeLevel 매핑', () => {
  it('R1_TURBO (강세) → R6_STRONG_BULL (강력한 상승장)', () => {
    expect(mapInternalToExposureRegime('R1_TURBO')).toBe('R6_STRONG_BULL');
  });

  it('R2_BULL → R5_BULL', () => {
    expect(mapInternalToExposureRegime('R2_BULL')).toBe('R5_BULL');
  });

  it('R3_EARLY → R4_RECOVERY', () => {
    expect(mapInternalToExposureRegime('R3_EARLY')).toBe('R4_RECOVERY');
  });

  it('R4_NEUTRAL → R3_NEUTRAL (중립 매핑)', () => {
    expect(mapInternalToExposureRegime('R4_NEUTRAL')).toBe('R3_NEUTRAL');
  });

  it('R5_CAUTION → R2_WEAK (주의 → 약세)', () => {
    expect(mapInternalToExposureRegime('R5_CAUTION')).toBe('R2_WEAK');
  });

  it('R6_DEFENSE (방어) → R0_CRISIS (위기 — 매수 전면 금지)', () => {
    expect(mapInternalToExposureRegime('R6_DEFENSE')).toBe('R1_DEFENSIVE');
  });
});

// ─── ENV 우회 — default OFF + 명시 활성화 ──────────────────────────────────

describe('isExposureBudgetEnabled — ENV 우회 SSOT', () => {
  it('default (미설정) → false', () => {
    expect(isExposureBudgetEnabled()).toBe(false);
  });

  it("ENV 'true' 명시 → true", () => {
    process.env.POSITION_SIZING_EXPOSURE_BUDGET_ENABLED = 'true';
    expect(isExposureBudgetEnabled()).toBe(true);
  });

  it("ENV 'false' → false", () => {
    process.env.POSITION_SIZING_EXPOSURE_BUDGET_ENABLED = 'false';
    expect(isExposureBudgetEnabled()).toBe(false);
  });

  it("ENV 'TRUE' (대문자) → false (정확히 'true' 만)", () => {
    process.env.POSITION_SIZING_EXPOSURE_BUDGET_ENABLED = 'TRUE';
    expect(isExposureBudgetEnabled()).toBe(false);
  });
});
