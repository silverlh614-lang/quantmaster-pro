import { describe, expect, it } from 'vitest';
import { deriveRegimePhase, normalizeRegimeContext } from './regimeContext.js';

describe('Regime-specific Shadow context', () => {
  it('maps R1/R6 effective regimes to dedicated learning phases', () => {
    expect(deriveRegimePhase({ effectiveRegime: 'R1_TURBO' })).toBe('R1_RECOVERY');
    expect(deriveRegimePhase({ effectiveRegime: 'R6_DEFENSE' })).toBe('R6_DEFENSE');
  });

  it('keeps SELL_ONLY and HARD_BLOCK as separate learning-bank states', () => {
    expect(deriveRegimePhase({ engineMode: 'SELL_ONLY', effectiveRegime: 'R3_EARLY' })).toBe('SELL_ONLY');
    expect(deriveRegimePhase({ hardBlockActive: true })).toBe('HARD_BLOCK');
  });

  it('normalizes market-closed and freshness metadata without execution impact', () => {
    const ctx = normalizeRegimeContext({
      rawRegime: 'R3_EARLY',
      effectiveRegime: 'R3_EARLY',
      marketSession: 'NON_TRADING_DAY',
      sourceFreshness: 'STALE',
    });

    expect(ctx.regimePhase).toBe('MARKET_CLOSED');
    expect(ctx.rawRegime).toBe('R3_EARLY');
    expect(ctx.effectiveRegime).toBe('R3_EARLY');
    expect(ctx.regimeConfidence).toBe('STALE');
  });
});
