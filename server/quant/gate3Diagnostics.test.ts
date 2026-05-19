import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONDITION_WEIGHTS,
  evaluateServerGate,
  type ServerGateResult,
} from '../quantFilter.js';
import type { YahooQuoteExtended } from '../screener/stockScreener.js';
import { normalizeGate3PriceStructure, normalizeGate3VolumeTiming } from './gate3Diagnostics.js';

type QuoteLike = Partial<YahooQuoteExtended> & Record<string, unknown>;

function quote(overrides: QuoteLike = {}): YahooQuoteExtended {
  return {
    price: 10_000,
    currentPrice: 10_000,
    dayOpen: 9_900,
    prevClose: 9_800,
    changePercent: 2.5,
    rsi14: 58,
    rsi5dAgo: 52,
    return5d: 4,
    return20d: 12,
    ma5: 118,
    ma20: 112,
    ma60: 104,
    volume: 2_400_000,
    avgVolume: 1_000_000,
    avgVolume20d: 1_100_000,
    volumeRatio: 2.4,
    tradingValue: 24_000_000_000,
    avgTradingValue20d: 11_000_000_000,
    high5d: 119,
    high20d: 119,
    high60d: 119,
    low20d: 100,
    low60d: 90,
    bbWidthCurrent: 6,
    bbWidth20dAvg: 10,
    atr: 1.2,
    atr14: 1.2,
    atr5d: 1.1,
    atr20avg: 2,
    recentVolumeAvg3d: 300_000,
    contractionCount: 3,
    rangeContraction: 0.2,
    macdHistogram: 1.2,
    macd5dHistAgo: -0.3,
    dailyVolumeDrying: true,
    vol5dAvg: 1,
    vol20dAvg: 1,
    per: 12,
    weeklyRSI: 55,
    ma60TrendUp: true,
    macd: 0,
    macdSignal: 0,
    monthlyAboveEMA12: false,
    monthlyEMARising: false,
    weeklyAboveCloud: false,
    weeklyLaggingSpanUp: false,
    isHighRisk: false,
    ...overrides,
  } as unknown as YahooQuoteExtended;
}

function run(q: YahooQuoteExtended): ServerGateResult {
  return evaluateServerGate(q, DEFAULT_CONDITION_WEIGHTS, 1, null, null);
}

describe('Gate3 diagnostics wiring', () => {
  it('price structure: turtle breakout pass/high20d', () => {
    const ps = normalizeGate3PriceStructure({
      quote: quote({ currentPrice: 10_500, high20d: 10_000, high60d: 12_000, low20d: 8_500 }) as any,
    });
    expect(ps.turtle.status).toBe('PASS');
    expect([20, 60]).toContain(ps.turtle.period);
    expect(ps.breakout.breakoutType).toBe('HIGH_20D');
    expect(ps.breakout.breakoutGapPct).toBeCloseTo(0.05, 6);
    expect(ps.status).toBe('VERIFIED');
    expect(ps.marketSignal).toBe(false);
  });

  it('price structure: high20d missing is MISSING not FAIL', () => {
    const ps = normalizeGate3PriceStructure({ quote: quote({ high20d: undefined, high60d: undefined }) as any });
    expect(ps.turtle.status).toBe('MISSING');
    expect(ps.missingFields).toContain('high20d');
    expect(ps.turtle.status).not.toBe('FAIL');
    expect(ps.marketSignal).toBe(false);
  });

  it('price structure: fallback to price', () => {
    const ps = normalizeGate3PriceStructure({ quote: quote({ currentPrice: undefined, price: 9999 }) as any });
    expect(ps.currentPrice).toBe(9999);
    expect(ps.priceFieldUsed).toBe('price');
    expect(ps.notes).toContain('PRICE_FALLBACK_USED');
  });

  it('price structure: all price fields missing', () => {
    const ps = normalizeGate3PriceStructure({ quote: quote({ currentPrice: undefined, price: undefined, close: undefined }) as any });
    expect(ps.currentPrice).toBeNull();
    expect(ps.breakout.status).toBe('MISSING');
    expect(ps.marketSignal).toBe(false);
  });

  it('price structure: pullback drawdown calc', () => {
    const ps = normalizeGate3PriceStructure({ quote: quote({ currentPrice: 9000, high60d: 10000 }) as any });
    expect(ps.pullback.drawdownFromHigh60dPct).toBeCloseTo(-0.1, 6);
    expect(ps.pullback.available).toBe(true);
    expect(ps.marketSignal).toBe(false);
  });

  it('price structure: range 20d calc', () => {
    const ps = normalizeGate3PriceStructure({ quote: quote({ high20d: 10_000, low20d: 8_000 }) as any });
    expect(ps.rangeStructure.range20dPct).toBeCloseTo(0.25, 6);
    expect(ps.rangeStructure.available).toBe(true);
  });

  it('price structure: extended chase advisory only', () => {
    const ps = normalizeGate3PriceStructure({ quote: quote({ currentPrice: 10_950, high20d: 10_000 }) as any });
    expect(ps.breakout.breakoutGapPct).toBeCloseTo(0.095, 6);
    expect(ps.notes).toContain('BREAKOUT_EXTENDED_CHASE_RISK');
  });

  it('normal breakout volume inputs are verified', () => {
    const gate3 = run(quote()).gateLayerSummary!.gate3 as any;
    const vt = gate3.externalDataCoverage.volumeTiming;

    expect(vt.values.volumeRatio).toBeCloseTo(2.4, 5);
    expect(vt.values.tradingValueRatio).toBeCloseTo(24_000_000_000 / 11_000_000_000, 5);
    expect(vt.marketSignal).toBe(false);
  });

  it('trading value fallback', () => {
    const vt = normalizeGate3VolumeTiming({
      quote: quote({
        volume: 200_000,
        avgVolume: undefined,
        avgVolume20d: 100_000,
        tradingValue: undefined,
        avgTradingValue20d: undefined,
        currentPrice: 10_000,
      }) as unknown as Record<string, unknown>,
    });

    expect(vt.tradingValue).toBe(2_000_000_000);
    expect(vt.avgTradingValue20d).toBe(1_000_000_000);
    expect(vt.notes).toContain('FALLBACK_TRADING_VALUE_FROM_VOLUME_PRICE');
  });

  it('avgVolume missing is missing/degraded not weak', () => {
    const vt = normalizeGate3VolumeTiming({
      quote: quote({ avgVolume: undefined, avgVolume20d: undefined }) as unknown as Record<string, unknown>,
    });

    expect(vt.volumeRatio).toBeNull();
    expect(['MISSING', 'DEGRADED', 'CALCULATION_MISSING']).toContain(vt.status);
    expect(vt.missingFields).toContain('avgVolume');
    expect(vt.marketSignal).toBe(false);
  });

  it('dry-up pass and missing split', () => {
    const pass = normalizeGate3VolumeTiming({
      quote: quote({ recentVolumeAvg3d: 300_000, avgVolume20d: 1_000_000 }) as unknown as Record<string, unknown>,
    });
    expect(pass.dryUp.dryUpRatio).toBeCloseTo(0.3, 5);
    expect(['PASS', 'FAIL']).toContain(pass.dryUp.status);

    const missing = normalizeGate3VolumeTiming({
      quote: quote({ recentVolumeAvg3d: undefined }) as unknown as Record<string, unknown>,
    });
    expect(missing.dryUp.status).toBe('MISSING');
    expect(missing.dryUp.reason).toContain('INPUT_MISSING');
  });

  it('vcp missing => calc missing and no bearish signal promotion', () => {
    const miss = run(quote({ bbWidthCurrent: undefined, atr14: undefined, contractionCount: undefined }));
    const vt = (miss.gateLayerSummary!.gate3 as any).externalDataCoverage.volumeTiming;

    expect(['MISSING', 'UNKNOWN']).toContain(vt.vcp.status);
    expect(vt.calculationIssue).toBe(true);
    expect(vt.marketSignal).toBe(false);
  });

  it('intraday missing -> daily granularity', () => {
    const vt = normalizeGate3VolumeTiming({
      quote: quote() as unknown as Record<string, unknown>,
      intraday: null,
    });

    expect(vt.dataGranularity).toBe('DAILY');
    expect(vt.notes).toContain('INTRADAY_NOT_FETCHED');
    expect(vt.marketSignal).toBe(false);
  });

  it('diagnostic-only invariance for score fields', () => {
    const before = run(quote());
    const after = run(quote());
    expect(after.rawScore).toBe(before.rawScore);
    expect(after.gateScore).toBe(before.gateScore);
    expect(after.normalizedGateScore).toBe(before.normalizedGateScore);
    expect(after.signalType).toBe(before.signalType);
    expect(after.positionPct).toBe(before.positionPct);
  });
});
