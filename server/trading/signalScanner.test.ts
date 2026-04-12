import { describe, expect, it } from 'vitest';
import { calculateOrderQuantity, evaluateEntryRevalidation } from './signalScanner.js';

describe('calculateOrderQuantity', () => {
  it('limits by orderable cash and remaining slots', () => {
    const result = calculateOrderQuantity({
      totalAssets: 10_000_000,
      orderableCash: 2_000_000,
      positionPct: 0.2,
      price: 100_000,
      remainingSlots: 2,
    });

    expect(result.effectiveBudget).toBe(1_000_000);
    expect(result.quantity).toBe(10);
  });
});

describe('evaluateEntryRevalidation', () => {
  it('rejects overextended breakout and weak volume', () => {
    const result = evaluateEntryRevalidation({
      currentPrice: 10_600,
      entryPrice: 10_000,
      quoteGateScore: 5.2,
      quoteSignalType: 'NORMAL',
      dayOpen: 10_300,
      prevClose: 10_000,
      volume: 500_000,
      avgVolume: 1_200_000,
    });

    expect(result.ok).toBe(false);
    expect(result.reasons).toContain('돌파 이탈 과열 (+6.0%)');
    expect(result.reasons).toContain('거래량 급감 (0.42x)');
  });

  it('passes when all pre-entry checks are healthy', () => {
    const result = evaluateEntryRevalidation({
      currentPrice: 10_050,
      entryPrice: 10_000,
      quoteGateScore: 6.5,
      quoteSignalType: 'STRONG',
      dayOpen: 10_020,
      prevClose: 10_000,
      volume: 2_000_000,
      avgVolume: 2_200_000,
    });

    expect(result.ok).toBe(true);
    expect(result.reasons).toHaveLength(0);
  });
});
