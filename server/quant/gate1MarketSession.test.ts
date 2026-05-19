// @responsibility Gate1 market-session diagnostic-only normalizer regression tests.

import { describe, expect, it } from 'vitest';
import { DEFAULT_CONDITION_WEIGHTS, evaluateServerGate, type ServerGateResult } from '../quantFilter.js';
import type { YahooQuoteExtended } from '../screener/stockScreener.js';
import { normalizeMarketSessionForGate1 } from './gate1MarketSession.js';

function gate1Quote(overrides: Partial<YahooQuoteExtended> & Record<string, unknown> = {}): YahooQuoteExtended {
  return {
    price: 100,
    currentPrice: 100,
    changePercent: 0,
    rsi14: 30,
    rsi5dAgo: 30,
    return5d: 0,
    return20d: 0,
    ma5: 110,
    ma20: 100,
    ma60: 90,
    ma60TrendUp: true,
    weeklyRSI: 55,
    volume: 200_000,
    avgVolume: 1_000_000,
    avgVolume20d: 1_000_000,
    high5d: 0,
    high20d: 200,
    high60d: 200,
    dayHigh: 105,
    dayLow: 95,
    bbWidthCurrent: 1,
    bbWidth20dAvg: 1,
    atr: 1,
    atr20avg: 2,
    atr5d: 1,
    vol5dAvg: 1,
    vol20dAvg: 1,
    per: 999,
    macdHistogram: -1,
    macd5dHistAgo: 0,
    dailyVolumeDrying: false,
    monthlyAboveEMA12: false,
    monthlyEMARising: false,
    weeklyAboveCloud: false,
    weeklyLaggingSpanUp: false,
    tradingValue: 2_000_000_000,
    avgTradingValue20d: 1_000_000_000,
    market: 'KOSPI',
    stockType: 'COMMON',
    marketDivCode: 'J',
    symbol: '005930',
    priceProvider: 'KIS_PRICE',
    priceMetadata: {
      value: 100,
      asOf: '2026-05-19T10:15:00+09:00',
      source: 'KIS_REALTIME',
    },
    isHighRisk: false,
    engineMode: 'NORMAL',
    ...overrides,
  } as YahooQuoteExtended;
}

function pickCoreDecisionFields(result: ServerGateResult) {
  return {
    rawScore: result.rawScore,
    gateScore: result.gateScore,
    normalizedGateScore: result.normalizedGateScore,
    signalType: result.signalType,
    positionPct: result.positionPct,
    gate1Fired: result.gateLayerSummary?.gate1.fired,
    gate1ThresholdNotMet: result.gateLayerSummary?.gate1.thresholdNotMet,
    gate1Unavailable: result.gateLayerSummary?.gate1.unavailable,
  };
}

describe('Gate1 market session diagnostic normalizer', () => {
  it('classifies REGULAR as live-buy compatible while keeping shadow and case recording on', () => {
    const diagnostic = normalizeMarketSessionForGate1({
      now: '2026-05-19T10:15:00+09:00',
      engineMode: 'NORMAL',
    });

    expect(diagnostic).toMatchObject({
      session: 'REGULAR',
      engineMode: 'NORMAL',
      liveBuyAllowed: true,
      liveSellAllowed: true,
      shadowAllowed: true,
      observeAllowed: true,
      caseRecordingAllowed: true,
      sellOnlyWindow: { active: false, matchedWindow: null },
      providerIssue: false,
      marketSignal: false,
      executionImpact: 'DIAGNOSTIC_ONLY',
    });
  });

  it('classifies opening SELL_ONLY without blocking shadow learning', () => {
    const diagnostic = normalizeMarketSessionForGate1({
      now: '2026-05-19T09:10:00+09:00',
      engineMode: 'SELL_ONLY',
    });

    expect(diagnostic).toMatchObject({
      session: 'SELL_ONLY',
      engineMode: 'SELL_ONLY',
      liveBuyAllowed: false,
      liveSellAllowed: true,
      shadowAllowed: true,
      caseRecordingAllowed: true,
      reason: 'SELL_ONLY_WINDOW_OPENING_0900_0930',
      sellOnlyWindow: { active: true, matchedWindow: 'OPENING_0900_0930' },
      marketSignal: false,
      executionImpact: 'LIVE_BUY_BLOCKED_ONLY',
    });
  });

  it('classifies lunch SELL_ONLY without propagating live buy block to shadow', () => {
    const diagnostic = normalizeMarketSessionForGate1({
      now: '2026-05-19T12:30:00+09:00',
      engineMode: 'SELL_ONLY',
    });

    expect(diagnostic.session).toBe('SELL_ONLY');
    expect(diagnostic.sellOnlyWindow).toMatchObject({
      active: true,
      matchedWindow: 'LUNCH_1200_1259',
    });
    expect(diagnostic.liveBuyAllowed).toBe(false);
    expect(diagnostic.shadowAllowed).toBe(true);
    expect(diagnostic.marketSignal).toBe(false);
  });

  it('classifies closing SELL_ONLY without changing execution policy', () => {
    const diagnostic = normalizeMarketSessionForGate1({
      now: '2026-05-19T15:25:00+09:00',
      engineMode: 'SELL_ONLY',
    });

    expect(diagnostic).toMatchObject({
      session: 'SELL_ONLY',
      liveBuyAllowed: false,
      shadowAllowed: true,
      sellOnlyWindow: { active: true, matchedWindow: 'CLOSING_1520_1530' },
      executionImpact: 'LIVE_BUY_BLOCKED_ONLY',
      marketSignal: false,
    });
  });

  it('classifies closed market as observe/case-recording compatible', () => {
    const diagnostic = normalizeMarketSessionForGate1({
      now: '2026-05-19T18:30:00+09:00',
      engineMode: 'OBSERVE_ONLY',
    });

    expect(diagnostic).toMatchObject({
      session: 'CLOSED',
      engineMode: 'OBSERVE_ONLY',
      liveBuyAllowed: false,
      shadowAllowed: true,
      observeAllowed: true,
      caseRecordingAllowed: true,
      reason: 'MARKET_CLOSED',
      marketSignal: false,
    });
  });

  it('classifies KIS holiday as live-buy blocked but shadow observable', () => {
    const diagnostic = normalizeMarketSessionForGate1({
      now: '2026-05-19T10:15:00+09:00',
      engineMode: 'NORMAL',
      kisHolidayStatus: { isHoliday: true, status: 'VERIFIED' },
    });

    expect(diagnostic).toMatchObject({
      session: 'HOLIDAY',
      liveBuyAllowed: false,
      shadowAllowed: true,
      providerIssue: false,
      reason: 'KIS_HOLIDAY',
      source: 'KIS_HOLIDAY',
      sourceStatus: 'VERIFIED',
      marketSignal: false,
    });
  });

  it('keeps market-session diagnostics score-invariant', () => {
    const regular = evaluateServerGate(
      gate1Quote({ now: '2026-05-19T10:15:00+09:00', engineMode: 'NORMAL' }),
      DEFAULT_CONDITION_WEIGHTS,
      1,
      null,
      null,
    );
    const sellOnly = evaluateServerGate(
      gate1Quote({ now: '2026-05-19T09:10:00+09:00', engineMode: 'SELL_ONLY' }),
      DEFAULT_CONDITION_WEIGHTS,
      1,
      null,
      null,
    );

    expect(pickCoreDecisionFields(sellOnly)).toEqual(pickCoreDecisionFields(regular));
    expect(sellOnly.gateLayerSummary?.gate1.survival?.marketSessionCompatibility).toMatchObject({
      session: 'SELL_ONLY',
      liveBuyAllowed: false,
      shadowAllowed: true,
      caseRecordingAllowed: true,
      marketSignal: false,
    });
  });
});
