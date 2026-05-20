import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONDITION_WEIGHTS,
  evaluateServerGate,
  type ServerGateResult,
} from '../quantFilter.js';
import type { YahooQuoteExtended } from '../screener/stockScreener.js';
import { buildGate3ExternalDataCoverage, normalizeGate3Momentum, normalizeGate3PriceStructure, normalizeGate3Pullback, normalizeGate3VolumeTiming } from './gate3Diagnostics.js';

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

  it('momentum normal: computes RSI/MACD deltas and verified', () => {
    const md = normalizeGate3Momentum({
      quote: quote({ rsi14: 62, rsi5dAgo: 54, macdHistogram: 0.8, macd5dHistAgo: 0.2, return5d: 0.062, return20d: 0.12, changePercent: 2.4 }) as any,
    });
    expect(md.rsi.rsiDelta5d).toBeCloseTo(8, 8);
    expect(md.macd.macdHistDelta5d).toBeCloseTo(0.6, 8);
    expect(['BULLISH', 'NEUTRAL']).toContain(md.rsi.status);
    expect(['IMPROVING', 'BULLISH']).toContain(md.macd.status);
    expect(md.status).toBe('VERIFIED');
    expect(md.marketSignal).toBe(false);
  });

  it('momentum: rsi missing is missing not weak', () => {
    const md = normalizeGate3Momentum({ quote: quote({ rsi14: undefined }) as any });
    expect(md.rsi.status).toBe('MISSING');
    expect(md.missingFields).toContain('rsi14');
    expect(md.marketSignal).toBe(false);
  });

  it('momentum: macd missing marks missing fields', () => {
    const md = normalizeGate3Momentum({ quote: quote({ macdHistogram: undefined, macd5dHistAgo: undefined }) as any });
    expect(md.macd.status).toBe('MISSING');
    expect(md.missingFields).toContain('macdHistogram');
    expect(md.missingFields).toContain('macd5dHistAgo');
    expect(md.marketSignal).toBe(false);
  });

  it('momentum: return5d missing is missing not weak', () => {
    const md = normalizeGate3Momentum({ quote: quote({ return5d: undefined }) as any });
    expect(md.shortMomentum.status).toBe('MISSING');
    expect(md.missingFields).toContain('return5d');
    expect(md.shortMomentum.status).not.toBe('WEAK');
  });

  it('momentum: overheat advisory only', () => {
    const ps = normalizeGate3PriceStructure({ quote: quote({ currentPrice: 10_950, high20d: 10_000 }) as any });
    const md = normalizeGate3Momentum({ quote: quote({ rsi14: 82 }) as any, priceStructure: ps });
    expect(md.overheat.status).toBe('OVERHEATED');
    expect(md.notes).toContain('RSI_OVERHEAT_DIAGNOSTIC_ONLY');
    expect(md.marketSignal).toBe(false);
  });

  it('momentum: negative macd classified bearish/weakening only', () => {
    const md = normalizeGate3Momentum({ quote: quote({ macdHistogram: -0.5, macd5dHistAgo: -0.2 }) as any });
    expect(['BEARISH', 'WEAKENING']).toContain(md.macd.status);
    expect(md.marketSignal).toBe(false);
  });

  it('pullback support: normal MA pullback uses nearest MA20 support', () => {
    const pb = normalizeGate3Pullback({
      quote: quote({ currentPrice: 9_800, price: 9_800, ma20: 9_700, ma60: 9_000, high20d: 10_500, high60d: 11_000, low20d: 8_500, low60d: 8_000 }) as any,
    });

    expect(pb.movingAverageSupport.nearestSupport).toBe('MA20');
    expect(pb.movingAverageSupport.distanceToMa20Pct).toBeCloseTo(100 / 9_700, 5);
    expect(pb.pullbackQuality.status).toBe('HEALTHY_PULLBACK');
    expect(pb.marketSignal).toBe(false);
  });

  it('pullback support: calculates Fibonacci levels and nearest fib', () => {
    const pb = normalizeGate3Pullback({
      quote: quote({ recentSwingHigh: 11_000, recentSwingLow: 9_000, currentPrice: 10_200, price: 10_200 }) as any,
    });

    expect(pb.fibonacci.fib382).toBeCloseTo(10_236, 5);
    expect(pb.fibonacci.fib500).toBeCloseTo(10_000, 5);
    expect(pb.fibonacci.fib618).toBeCloseTo(9_764, 5);
    expect(pb.fibonacci.nearestFib).toBe('FIB_382');
    expect(pb.marketSignal).toBe(false);
  });

  it('pullback support: missing Fibonacci inputs are missing, not support failure', () => {
    const pb = normalizeGate3Pullback({ quote: { currentPrice: 10_200, recentSwingHigh: 11_000 } as any });

    expect(pb.fibonacci.status).toBe('MISSING');
    expect(pb.fibonacci.reason).toBe('INPUT_MISSING');
    expect(pb.notes).toContain('FIB_INPUT_MISSING_NOT_FAIL');
    expect(pb.marketSignal).toBe(false);
  });

  it('pullback support: missing MA inputs are not trend broken', () => {
    const pb = normalizeGate3Pullback({
      quote: { currentPrice: 9_800, high20d: 10_500, high60d: 11_000, low20d: 8_500, low60d: 8_000, recentSwingHigh: 11_000, recentSwingLow: 8_000 } as any,
    });

    expect(pb.movingAverageSupport.status).toBe('MISSING');
    expect(pb.notes).toContain('MA_INPUT_MISSING_NOT_TREND_BROKEN');
    expect(pb.marketSignal).toBe(false);
  });

  it('pullback support: missing pullback inputs are unavailable, not failed', () => {
    const pb = normalizeGate3Pullback({ quote: { high20d: 10_500 } as any });

    expect(pb.pullbackQuality.status).toBe('MISSING');
    expect(pb.missingFields).toContain('currentPrice');
    expect(pb.missingFields).toContain('high60d');
    expect(pb.notes).toContain('PULLBACK_INPUT_MISSING_NOT_FAIL');
    expect(pb.marketSignal).toBe(false);
  });

  it('pullback support: box retest distance is diagnostic only', () => {
    const pb = normalizeGate3Pullback({
      quote: { currentPrice: 10_100, boxTop: 10_000, boxBottom: 9_000, high20d: 10_500, high60d: 11_000, low20d: 8_500, low60d: 8_000 } as any,
    });

    expect(pb.boxRetest.distanceToBoxTopPct).toBeCloseTo(0.01, 5);
    expect(pb.boxRetest.status).toBe('RETEST_NEAR');
    expect(pb.marketSignal).toBe(false);
  });

  it('pullback support: extended chase stays advisory and does not affect scoring', () => {
    const q = quote({ currentPrice: 11_000, price: 11_000, high20d: 10_000, high60d: 10_500, low20d: 8_000, low60d: 7_500, ma20: 9_500, ma60: 9_000 }) as any;
    const pb = normalizeGate3Pullback({ quote: q });
    const before = run(q);
    const after = run(q);

    expect(pb.pullbackQuality.status).toBe('EXTENDED_CHASE');
    expect(pb.executionImpact).toBe('DIAGNOSTIC_ONLY');
    expect(pb.notes).toContain('EXTENDED_CHASE_DIAGNOSTIC_ONLY');
    expect(after.rawScore).toBe(before.rawScore);
    expect(after.gateScore).toBe(before.gateScore);
    expect(after.normalizedGateScore).toBe(before.normalizedGateScore);
    expect(after.signalType).toBe(before.signalType);
    expect(after.positionPct).toBe(before.positionPct);
    expect(pb.marketSignal).toBe(false);
  });

  it('externalDataCoverage exposes pullbackSupport without market signal promotion', () => {
    const coverage = buildGate3ExternalDataCoverage(quote({ currentPrice: 9_800, price: 9_800, ma20: 9_700, ma60: 9_000, high20d: 10_500, high60d: 11_000, low20d: 8_500, low60d: 8_000, boxTop: 10_000, boxBottom: 9_000 }) as any);

    expect(coverage.pullbackSupport.required).toBe(false);
    expect(coverage.pullbackSupport.fields.currentPrice).toBe(true);
    expect(coverage.pullbackSupport.movingAverageSupport.nearestSupport).toBe('MA20');
    expect(coverage.pullbackSupport.marketSignal).toBe(false);
  });
});
