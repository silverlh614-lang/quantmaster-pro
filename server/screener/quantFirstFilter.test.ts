import { describe, expect, it } from 'vitest';
import { resolveScreenerConfig } from './quantScreenerConfig.js';
import { evaluateQuantFirstFilter } from './quantFirstFilter.js';
import { QuantScreenerReason, type ScreenerUniverseItem } from './quantScreenerTypes.js';

function baseItem(overrides: Partial<ScreenerUniverseItem> = {}): ScreenerUniverseItem {
  return {
    symbol: '000001',
    name: '테스트',
    market: 'KOSPI',
    marketCapKrw: { value: 200_000_000_000, confidence: 'VERIFIED' },
    avgTradingValue20dKrw: { value: 2_000_000_000, confidence: 'VERIFIED' },
    latestClose: { value: 10_000, confidence: 'VERIFIED' },
    per: { value: 10, confidence: 'VERIFIED' },
    isManaged: { value: false, confidence: 'VERIFIED' },
    isTradingHalt: { value: false, confidence: 'VERIFIED' },
    ...overrides,
  };
}

describe('evaluateQuantFirstFilter', () => {
  it('rejects stocks below minimum market cap', () => {
    const result = evaluateQuantFirstFilter(baseItem({ marketCapKrw: { value: 99_000_000_000, confidence: 'VERIFIED' } }), resolveScreenerConfig());
    expect(result.passedQuantFilter).toBe(false);
    expect(result.reasons).toContain(QuantScreenerReason.RejectMarketCapTooSmall);
  });

  it('rejects stocks below average trading value threshold', () => {
    const result = evaluateQuantFirstFilter(baseItem({ avgTradingValue20dKrw: { value: 900_000_000, confidence: 'VERIFIED' } }), resolveScreenerConfig());
    expect(result.passedQuantFilter).toBe(false);
    expect(result.reasons).toContain(QuantScreenerReason.RejectAvgTradingValueTooLow);
  });

  it('rejects missing latest close as provider issue', () => {
    const result = evaluateQuantFirstFilter(baseItem({ latestClose: { value: undefined, confidence: 'MISSING' } }), resolveScreenerConfig());
    expect(result.passedQuantFilter).toBe(false);
    expect(result.reasons).toContain(QuantScreenerReason.RejectPriceDataMissing);
    expect(result.providerIssue).toBe(true);
    expect(result.dataConfidence.missing).toBeGreaterThan(0);
  });
});
