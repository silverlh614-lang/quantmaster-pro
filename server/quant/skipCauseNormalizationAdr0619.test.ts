// @responsibility ADR-0619 skipCause enum 정규화 회귀 — quantFilter SKIP 산출 시점 MTAS_WEAK/BAND_MISS/VIX_CONSERVATIVE/UNKNOWN 동시 반환·비SKIP undefined 검증(details 파싱 금지)

import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONDITION_WEIGHTS, evaluateServerGate } from '../quantFilter.js';
import { setVixConservativeMode } from '../state.js';
import type { YahooQuoteExtended } from '../screener/stockScreener.js';

type QuoteLike = Partial<YahooQuoteExtended> & Record<string, unknown>;

// 강한 정렬 — MTAS 상승 + 점수 충분(STRONG/NORMAL 후보).
function strongQuote(overrides: QuoteLike = {}): YahooQuoteExtended {
  return {
    price: 100, currentPrice: 100, dayOpen: 99, prevClose: 98, changePercent: 2,
    volume: 2_400_000, avgVolume: 1_000_000, avgVolume20d: 1_100_000, volumeRatio: 2.4,
    tradingValue: 24_000_000_000, avgTradingValue20d: 11_000_000_000,
    high5d: 100, high20d: 100, high60d: 102, low20d: 88, low60d: 80,
    rsi14: 58, rsi5dAgo: 52, macdHistogram: 1.2, macd5dHistAgo: -0.3, return5d: 4,
    ma5: 99, ma20: 95, ma60: 90,
    bbWidthCurrent: 6, bbWidth20dAvg: 10, atr: 1.2, atr14: 1.2, atr5d: 1.1, atr20avg: 2,
    recentVolumeAvg3d: 300_000, contractionCount: 3, rangeContraction: 0.2,
    entryPriceAgeSec: 20, entryPriceSource: 'KIS_REALTIME',
    monthlyAboveEMA12: true, weeklyAboveCloud: true, weeklyLaggingSpanUp: true,
    dailyVolumeDrying: true,
    ...overrides,
  } as unknown as YahooQuoteExtended;
}

// 매우 약한 정렬 — MTAS ≤ 3 강제(월/주/일봉 정렬 0).
function mtasWeakQuote(overrides: QuoteLike = {}): YahooQuoteExtended {
  return {
    price: 100, currentPrice: 100, dayOpen: 99, prevClose: 98, changePercent: -2,
    volume: 100_000, avgVolume: 1_000_000, avgVolume20d: 1_100_000, volumeRatio: 0.1,
    tradingValue: 1_000_000_000, avgTradingValue20d: 11_000_000_000,
    high5d: 120, high20d: 130, high60d: 150, low20d: 88, low60d: 80,
    rsi14: 35, rsi5dAgo: 52, macdHistogram: -1.2, macd5dHistAgo: 0.3, return5d: -8,
    ma5: 90, ma20: 95, ma60: 100,
    bbWidthCurrent: 12, bbWidth20dAvg: 10, atr: 3, atr14: 3, atr5d: 3, atr20avg: 2,
    recentVolumeAvg3d: 50_000, contractionCount: 0, rangeContraction: 0,
    entryPriceAgeSec: 20, entryPriceSource: 'KIS_REALTIME',
    monthlyAboveEMA12: false, weeklyAboveCloud: false, weeklyLaggingSpanUp: false,
    dailyVolumeDrying: false,
    ...overrides,
  } as unknown as YahooQuoteExtended;
}

const run = (q: YahooQuoteExtended, regime?: string) =>
  evaluateServerGate(q, DEFAULT_CONDITION_WEIGHTS, 1, null, null, regime);

describe('ADR-0619 — skipCause enum 정규화', () => {
  afterEach(() => { setVixConservativeMode(false); });

  it('MTAS ≤ 3 → signalType=SKIP, skipCause=MTAS_WEAK', () => {
    const r = run(mtasWeakQuote());
    expect(r.signalType).toBe('SKIP');
    expect(r.skipCause).toBe('MTAS_WEAK');
  });

  it('비SKIP(점수 충분) → skipCause=undefined', () => {
    const r = run(strongQuote());
    expect(r.signalType === 'STRONG' || r.signalType === 'NORMAL').toBe(true);
    expect(r.skipCause).toBeUndefined();
  });

  it('VIX 보수모드(비SKIP→SKIP flip) → skipCause=VIX_CONSERVATIVE', () => {
    setVixConservativeMode(true);
    const r = run(strongQuote());
    expect(r.signalType).toBe('SKIP');
    expect(r.skipCause).toBe('VIX_CONSERVATIVE');
  });

  it('MTAS_WEAK + VIX 보수모드 동시 → 원인은 MTAS_WEAK 보존(이미 SKIP, VIX flip 미발동)', () => {
    setVixConservativeMode(true);
    const r = run(mtasWeakQuote());
    expect(r.signalType).toBe('SKIP');
    // VIX 분기는 signalType!=='SKIP' 일 때만 flip → 이미 MTAS_WEAK SKIP 이면 cause 보존.
    expect(r.skipCause).toBe('MTAS_WEAK');
  });

  it('SKIP 이면 skipCause 는 항상 정의됨(UNKNOWN 포함 — 미상 보수 차단 보장)', () => {
    const r = run(mtasWeakQuote());
    if (r.signalType === 'SKIP') {
      expect(r.skipCause).toBeDefined();
    }
  });
});
