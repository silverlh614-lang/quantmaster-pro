// @responsibility Verify regime-free allocation and quantity caps preserve explicit cash and capital limits.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyExposureBudgetCap, calculateEntryPositionSizing, calculateOrderQuantity } from './entrySizingPolicy.js';

afterEach(() => vi.unstubAllEnvs());
describe('entry budget arithmetic', () => {
  it.each([
    [1000000, 1000000, 0.1, 3000, 2, 33, 100000],
    [1000000, 90000, 0.5, 4000, 3, 7, 30000],
    [1000000, 11000, 0.5, 4000, 1, 2, 11000],
    [1000000, 11000, 0.5, 0, 1, 0, 0],
    [1000000, 11000, 0.5, 4000, 0, 0, 0],
  ])('preserves cash, allocation, slots and floor arithmetic', (totalAssets, orderableCash, positionPct, price, remainingSlots, quantity, effectiveBudget) => {
    expect(calculateOrderQuantity({ totalAssets, orderableCash, positionPct, price, remainingSlots })).toEqual({ quantity, effectiveBudget });
  });
  it.each([NaN, Infinity])('never creates quantity from invalid price %s', (price) => {
    expect(calculateOrderQuantity({ totalAssets: 100000, orderableCash: 100000, positionPct: 0.1, price, remainingSlots: 1 })).toEqual({ quantity: 0, effectiveBudget: 0 });
  });
  it.each(['R1_TURBO', 'R6_DEFENSE', undefined])('uses explicit allocation and slots regardless of historical regime %s', (regime) => {
    expect(calculateEntryPositionSizing({ totalEquity: 1000000, regime, positionSizePct: 12, maxPositions: 4, currentPositions: 3 }))
      .toMatchObject({ policy: { regime: 'FIXED_BUDGET', maxPositions: 4 }, positionAmount: 120000, remainingSlots: 1, kellyDisabled: true });
  });
});

const input = { rawQuantity: 100, shadowEntryPrice: 10000, accountEquity: 10000000,
  currentEquityExposureAmount: 7750000, currentCashAmount: 2250000, regime: 'R2_BULL', isAddOnBuy: false };
describe('requested quantity cap', () => {
  it.each(['false', 'true', undefined])('always enforces cash and configured capital limits despite retired switch %s', (value) => {
    vi.stubEnv('POSITION_SIZING_EXPOSURE_BUDGET_ENABLED', value);
    expect(applyExposureBudgetCap({ ...input, maxGrossExposurePct: 80 })).toMatchObject({ applied: true, finalQuantity: 25 });
    expect(applyExposureBudgetCap({ ...input, currentCashAmount: 19000 })).toMatchObject({ finalQuantity: 1 });
  });
  it('never multiplies requested quantity for bullish or defensive regime labels', () => {
    for (const regime of ['R1_TURBO', 'R2_BULL', 'R5_CAUTION', 'R6_DEFENSE']) {
      expect(applyExposureBudgetCap({ ...input, regime, isAddOnBuy: true, currentEquityExposureAmount: 0 })).toMatchObject({ finalQuantity: 100 });
    }
  });
  it('subtracts current holdings from the configured per-stock limit', () => {
    expect(applyExposureBudgetCap({ ...input, maxPositionAmount: 500000, currentPositionAmount: 375000 })).toMatchObject({ finalQuantity: 12 });
  });
  it.each([NaN, Infinity, -1])('does not use absent or invalid cash %s as spendable capital', (currentCashAmount) => {
    expect(applyExposureBudgetCap({ ...input, currentCashAmount })).toMatchObject({ applied: true, finalQuantity: 0, skipReason: 'INPUT_MISSING' });
  });
  it('does not allocate above the total account capital', () => {
    expect(applyExposureBudgetCap({ ...input, currentEquityExposureAmount: 11000000 })).toMatchObject({ finalQuantity: 0 });
  });
});
