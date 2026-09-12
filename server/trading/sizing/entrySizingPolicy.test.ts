// @responsibility Verify migrated entry budget calculations.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyExposureBudgetCap, calculateOrderQuantity } from './entrySizingPolicy.js';

afterEach(() => vi.unstubAllEnvs());
describe('active entry budget arithmetic', () => {
  it.each([
    [1000000, 1000000, 0.1, 3000, 2, 33, 100000],
    [1000000, 90000, 0.5, 4000, 3, 7, 30000],
    [1000000, 11000, 0.5, 4000, 1, 2, 11000],
    [1000000, 11000, 0.5, 0, 1, 0, 0],
    [1000000, 11000, 0.5, 4000, 0, 0, 0],
  ])('preserves cash, allocation, slots and floor arithmetic', (totalAssets, orderableCash, positionPct, price, remainingSlots, quantity, effectiveBudget) => {
    expect(calculateOrderQuantity({ totalAssets, orderableCash, positionPct, price, remainingSlots })).toEqual({ quantity, effectiveBudget });
  });

  it('preserves exposure flag fallback, remaining budget cap, and add-on veto', () => {
    const input = { rawQuantity: 100, shadowEntryPrice: 10000, accountEquity: 10000000,
      currentEquityExposureAmount: 7750000, currentCashAmount: 2250000, regime: 'R2_BULL' as const, isAddOnBuy: false };
    vi.stubEnv('POSITION_SIZING_EXPOSURE_BUDGET_ENABLED', 'false');
    expect(applyExposureBudgetCap(input)).toMatchObject({ applied: false, finalQuantity: 100 });
    vi.stubEnv('POSITION_SIZING_EXPOSURE_BUDGET_ENABLED', 'true');
    expect(applyExposureBudgetCap(input)).toMatchObject({ applied: true, finalQuantity: 25 });
    expect(applyExposureBudgetCap({ ...input, currentEquityExposureAmount: 0 })).toMatchObject({ finalQuantity: 110 });
    expect(applyExposureBudgetCap({ ...input, regime: 'R5_CAUTION', currentEquityExposureAmount: 0, isAddOnBuy: true })).toMatchObject({ finalQuantity: 0 });
  });
});
