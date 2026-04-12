import { describe, expect, it } from 'vitest';
import { addBusinessDaysFromKstDate, evaluateTrancheRevalidation } from './trancheExecutor.js';

describe('addBusinessDaysFromKstDate', () => {
  it('skips weekends when calculating tranche dates', () => {
    // 2026-04-10: Friday
    const result = addBusinessDaysFromKstDate('2026-04-10', 3, new Set<string>());
    expect(result).toBe('2026-04-15');
  });

  it('skips configured KRX closed days as non-business days', () => {
    const result = addBusinessDaysFromKstDate(
      '2026-04-13',
      3,
      new Set<string>(['2026-04-14']) // Tue closed
    );
    expect(result).toBe('2026-04-17');
  });
});

describe('evaluateTrancheRevalidation', () => {
  it('rejects tranche when cascade/add-buy-block state is active', () => {
    const result = evaluateTrancheRevalidation({
      currentPrice: 10_200,
      entryPrice: 10_000,
      stopLoss: 9_400,
      currentRegime: 'R3_PULLBACK',
      entryRegime: 'R2_BULL',
      cascadeStep: 1,
      addBuyBlocked: true,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('Cascade 단계 진입');
  });

  it('rejects tranche when regime has deteriorated from entry', () => {
    const result = evaluateTrancheRevalidation({
      currentPrice: 10_300,
      entryPrice: 10_000,
      stopLoss: 9_300,
      currentRegime: 'R4_NEUTRAL',
      entryRegime: 'R2_BULL',
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('진입 레짐');
  });

  it('passes when tranche conditions are healthy', () => {
    const result = evaluateTrancheRevalidation({
      currentPrice: 10_300,
      entryPrice: 10_000,
      stopLoss: 9_200,
      currentRegime: 'R2_BULL',
      entryRegime: 'R2_BULL',
      cascadeStep: 0,
      addBuyBlocked: false,
    });

    expect(result.ok).toBe(true);
    expect(result.reason).toBeUndefined();
  });
});
