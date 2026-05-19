import { describe, expect, it } from 'vitest';
import { normalizeLiquidityFloorForGate1 } from './gate1LiquidityFloor.js';

const verifiedCoverage = {
  source: 'KIS_OFFICIAL',
  confidence: 'VERIFIED',
};

describe('Gate1 liquidity floor diagnostic normalizer', () => {
  it('returns PASS when current and average liquidity clear the advisory floor', () => {
    const result = normalizeLiquidityFloorForGate1({
      quote: {
        currentPrice: 12000,
        volume: 1_000_000,
        avgVolume20d: 800_000,
        tradingValue: 12_000_000_000,
        avgTradingValue20d: 9_600_000_000,
      },
      quoteCoverage: verifiedCoverage,
    });

    expect(result).toMatchObject({
      status: 'PASS',
      volume: 1_000_000,
      avgVolume20d: 800_000,
      tradingValue: 12_000_000_000,
      avgTradingValue20d: 9_600_000_000,
      currentPrice: 12000,
      checks: {
        volumePass: true,
        tradingValuePass: true,
        avgVolumePass: true,
        avgTradingValuePass: true,
      },
      source: 'KIS_OFFICIAL',
      sourceStatus: 'VERIFIED',
      providerIssue: false,
      marketSignal: false,
      executionImpact: 'DIAGNOSTIC_ONLY',
    });
  });

  it('derives trading values from price and volume without throwing', () => {
    const result = normalizeLiquidityFloorForGate1({
      quote: {
        currentPrice: 10000,
        volume: 200_000,
        avgVolume20d: 100_000,
      },
      quoteCoverage: verifiedCoverage,
    });

    expect(result.tradingValue).toBe(2_000_000_000);
    expect(result.avgTradingValue20d).toBe(1_000_000_000);
    expect(result.status).toBe('PASS');
    expect(result.marketSignal).toBe(false);
  });

  it('marks consistently thin liquidity below the advisory floor', () => {
    const result = normalizeLiquidityFloorForGate1({
      quote: {
        currentPrice: 10000,
        volume: 10_000,
        avgVolume20d: 8_000,
      },
      quoteCoverage: verifiedCoverage,
    });

    expect(result.status).toBe('THIN');
    expect(result.reason).toBe('LIQUIDITY_BELOW_FLOOR');
    expect(result.checks).toMatchObject({
      volumePass: false,
      tradingValuePass: false,
      avgVolumePass: false,
      avgTradingValuePass: false,
    });
    expect(result.marketSignal).toBe(false);
  });

  it('separates one-off current liquidity spikes from stable average liquidity', () => {
    const result = normalizeLiquidityFloorForGate1({
      quote: {
        currentPrice: 10000,
        volume: 1_000_000,
        avgVolume20d: 10_000,
      },
      quoteCoverage: verifiedCoverage,
    });

    expect(result.status).toBe('SPIKE_ONLY');
    expect(result.reason).toBe('CURRENT_LIQUIDITY_SPIKE_BUT_AVERAGE_THIN');
    expect(result.marketSignal).toBe(false);
  });

  it('reports missing liquidity inputs as provider coverage, not market signal', () => {
    const result = normalizeLiquidityFloorForGate1({
      quote: null,
      quoteCoverage: null,
    });

    expect(result).toMatchObject({
      status: 'MISSING',
      sourceStatus: 'MISSING',
      reason: 'LIQUIDITY_INPUT_MISSING',
      providerIssue: true,
      marketSignal: false,
      executionImpact: 'DIAGNOSTIC_ONLY',
    });
  });
});
