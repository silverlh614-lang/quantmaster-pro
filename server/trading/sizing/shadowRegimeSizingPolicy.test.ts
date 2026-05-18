// @responsibility Shadow regime sizing policy regression tests.
import { describe, expect, it } from 'vitest';
import {
  calculateShadowRegimeSizing,
  resolveShadowRegimeSizingLevel,
} from './shadowRegimeSizingPolicy.js';

describe('shadow regime sizing policy', () => {
  it('caps R6 shadow budget by 10 percent position cap and 30 percent total exposure cap', () => {
    const result = calculateShadowRegimeSizing({
      regimeLevel: 'R6_DEFENSE',
      liveSizingEngineBudget: 12_000_000,
      totalShadowEquity: 100_000_000,
      currentShadowExposure: 0,
      availableVirtualCash: 100_000_000,
      openShadowSymbolCount: 0,
    });

    expect(result.allowed).toBe(true);
    expect(result.policy.maxSymbols).toBe(3);
    expect(result.policy.maxPositionPct).toBe(0.10);
    expect(result.policy.totalExposureCap).toBe(0.30);
    expect(result.finalShadowBudget).toBe(10_000_000);
    expect(result.finalShadowBudget).toBeGreaterThan(100_000);
    expect(result.sizingSource).toBe('LIVE_SIZING_MIRROR');
    expect(result.liveOrderSent).toBe(false);
    expect(result.executionImpact).toBe('NONE');
  });

  it('caps R6 shadow exposure by remaining regime exposure budget', () => {
    const result = calculateShadowRegimeSizing({
      regimeLevel: 'R6_DEFENSE',
      liveSizingEngineBudget: 10_000_000,
      totalShadowEquity: 100_000_000,
      currentShadowExposure: 25_000_000,
      availableVirtualCash: 100_000_000,
      openShadowSymbolCount: 2,
    });

    expect(result.allowed).toBe(true);
    expect(result.remainingRegimeExposureBudget).toBe(5_000_000);
    expect(result.finalShadowBudget).toBe(5_000_000);
  });

  it('blocks new R6 shadow entries when maxSymbols is already reached', () => {
    const result = calculateShadowRegimeSizing({
      regimeLevel: 'R6_DEFENSE',
      liveSizingEngineBudget: 10_000_000,
      totalShadowEquity: 100_000_000,
      currentShadowExposure: 20_000_000,
      availableVirtualCash: 100_000_000,
      openShadowSymbolCount: 3,
    });

    expect(result.allowed).toBe(false);
    expect(result.blockReason).toBe('REGIME_SHADOW_SLOT_BLOCKED');
    expect(result.finalShadowBudget).toBe(0);
  });

  it('keeps R3, R2, and R1 maxSymbols and total exposure caps distinct', () => {
    expect(calculateShadowRegimeSizing({
      regimeLevel: 'R3_NEUTRAL',
      liveSizingEngineBudget: 100_000_000,
      totalShadowEquity: 100_000_000,
      currentShadowExposure: 0,
      availableVirtualCash: 100_000_000,
      openShadowSymbolCount: 5,
    }).policy).toMatchObject({ maxSymbols: 6, totalExposureCap: 0.60 });

    expect(calculateShadowRegimeSizing({
      regimeLevel: 'R2_RISK_ON',
      liveSizingEngineBudget: 100_000_000,
      totalShadowEquity: 100_000_000,
      currentShadowExposure: 0,
      availableVirtualCash: 100_000_000,
      openShadowSymbolCount: 7,
    }).policy).toMatchObject({ maxSymbols: 8, totalExposureCap: 0.80 });

    expect(calculateShadowRegimeSizing({
      regimeLevel: 'R1_AGGRESSIVE',
      liveSizingEngineBudget: 100_000_000,
      totalShadowEquity: 100_000_000,
      currentShadowExposure: 0,
      availableVirtualCash: 100_000_000,
      openShadowSymbolCount: 9,
    }).policy).toMatchObject({ maxSymbols: 10, totalExposureCap: 1.00 });
  });

  it('maps recovery watch to R5 sizing and R6 confirmation wait to R6 sizing', () => {
    expect(resolveShadowRegimeSizingLevel({ regime: 'R6_RECOVERY_WATCH' })).toBe('R5_RECOVERY_WATCH');
    expect(resolveShadowRegimeSizingLevel({ regime: 'R6_CONFIRMATION_WAIT' })).toBe('R6_DEFENSE');
    expect(resolveShadowRegimeSizingLevel({ effectiveRegime: 'R2_BULL' })).toBe('R2_RISK_ON');
    expect(resolveShadowRegimeSizingLevel({ effectiveRegime: 'R1_TURBO' })).toBe('R1_AGGRESSIVE');
  });
});
