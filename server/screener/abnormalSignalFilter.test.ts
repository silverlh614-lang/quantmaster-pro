import { describe, expect, it } from 'vitest';
import { resolveScreenerConfig } from './quantScreenerConfig.js';
import { evaluateAbnormalSignalFilter } from './abnormalSignalFilter.js';
import { evaluateQuantFirstFilter } from './quantFirstFilter.js';
import { QuantScreenerReason, type ScreenerUniverseItem } from './quantScreenerTypes.js';

function quantPassed(overrides: Partial<ScreenerUniverseItem> = {}) {
  const item: ScreenerUniverseItem = {
    symbol: '000002',
    name: '신호테스트',
    market: 'KOSDAQ',
    marketCapKrw: { value: 200_000_000_000, confidence: 'VERIFIED' },
    avgTradingValue20dKrw: { value: 2_000_000_000, confidence: 'VERIFIED' },
    latestClose: { value: 9_600, confidence: 'VERIFIED' },
    per: { value: 12, confidence: 'VERIFIED' },
    isManaged: { value: false, confidence: 'VERIFIED' },
    isTradingHalt: { value: false, confidence: 'VERIFIED' },
    volume: { value: 300, confidence: 'VERIFIED' },
    avgVolume20d: { value: 100, confidence: 'VERIFIED' },
    high52w: { value: 10_000, confidence: 'VERIFIED' },
    ma20: { value: 9_000, confidence: 'VERIFIED' },
    relativeStrengthPct: { value: 5, confidence: 'VERIFIED' },
    institutionForeignNetBuy3d: { value: true, confidence: 'VERIFIED' },
    volatilityContraction: { value: false, confidence: 'VERIFIED' },
    ...overrides,
  };
  return evaluateQuantFirstFilter(item, resolveScreenerConfig());
}

describe('evaluateAbnormalSignalFilter', () => {
  it('passes volume spike condition', () => {
    const result = evaluateAbnormalSignalFilter(quantPassed(), resolveScreenerConfig());
    expect(result.passedAbnormalSignalFilter).toBe(true);
    expect(result.reasons).toContain(QuantScreenerReason.PassVolumeSpike);
  });

  it('passes near 52 week high condition', () => {
    const result = evaluateAbnormalSignalFilter(quantPassed(), resolveScreenerConfig());
    expect(result.passedAbnormalSignalFilter).toBe(true);
    expect(result.reasons).toContain(QuantScreenerReason.PassNear52wHigh);
  });

  it('separates missing provider issue from strong market signal', () => {
    const result = evaluateAbnormalSignalFilter(quantPassed({ avgVolume20d: { value: undefined, confidence: 'MISSING' } }), resolveScreenerConfig());
    expect(result.providerIssue).toBe(true);
    expect(result.signalState).toBe('MIXED');
    expect(result.marketSignal).toBe(false);
  });
});
