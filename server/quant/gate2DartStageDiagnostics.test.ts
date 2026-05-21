// @responsibility Gate2 DART financials stage diagnostics regression tests.

import { describe, expect, it } from 'vitest';
import { DEFAULT_CONDITION_WEIGHTS, evaluateServerGate, type ServerGateResult } from '../quantFilter.js';
import type { KisInvestorFlow } from '../clients/kisClient.js';
import type { YahooQuoteExtended } from '../screener/stockScreener.js';

function gate2Quote(overrides: Partial<YahooQuoteExtended> = {}): YahooQuoteExtended {
  return {
    price: 100,
    currentPrice: 100,
    dayOpen: 98,
    prevClose: 98,
    changePercent: 1.5,
    rsi14: 30,
    rsi5dAgo: 30,
    return5d: 4,
    return20d: 10,
    ma5: 110,
    ma20: 100,
    ma60: 90,
    ma60TrendUp: true,
    weeklyRSI: 55,
    volume: 200_000,
    avgVolume: 100_000,
    high5d: 0,
    high20d: 200,
    high60d: 200,
    bbWidthCurrent: 1,
    bbWidth20dAvg: 1,
    atr: 1,
    atr20avg: 2,
    atr5d: 1,
    vol5dAvg: 1,
    vol20dAvg: 1,
    per: 10,
    macd: 0,
    macdSignal: 0,
    macdHistogram: -1,
    macd5dHistAgo: 0,
    dailyVolumeDrying: false,
    monthlyAboveEMA12: false,
    monthlyEMARising: false,
    weeklyAboveCloud: false,
    weeklyLaggingSpanUp: false,
    isHighRisk: false,
    ...overrides,
  } as YahooQuoteExtended;
}

function kisFlow(): KisInvestorFlow {
  return {
    foreignNetBuy: 10_000,
    institutionalNetBuy: 20_000,
    individualNetBuy: -30_000,
    source: 'KIS_API',
  } as KisInvestorFlow;
}

function evaluateGate2WithDartNull(stage?: Parameters<typeof evaluateServerGate>[6]): ServerGateResult {
  return evaluateServerGate(
    gate2Quote(),
    DEFAULT_CONDITION_WEIGHTS,
    5,
    null,
    kisFlow(),
    undefined,
    stage,
  );
}

function pickDecisionFields(result: ServerGateResult) {
  return {
    rawScore: result.rawScore,
    gateScore: result.gateScore,
    normalizedGateScore: result.normalizedGateScore,
    signalType: result.signalType,
    positionPct: result.positionPct,
  };
}

describe('Gate2 DART financials stage diagnostics', () => {
  it('labels discovery DART null as stage-not-fetched without provider issue', () => {
    const result = evaluateGate2WithDartNull('DISCOVERY_GATE');
    const gate2 = result.gateLayerSummary?.gate2;
    const dart = gate2?.externalDataCoverage?.dartFinancials;
    const compact = gate2?.consolidatedDiagnostic?.compactText ?? '';

    expect(dart).toMatchObject({
      status: 'STAGE_NOT_FETCHED',
      stageNotFetched: true,
      providerIssue: false,
      marketSignal: false,
    });
    expect(compact).toContain('DART=WAIT');
    expect(compact).not.toContain('DART_FINANCIALS_UNAVAILABLE');
    expect(gate2?.consolidatedDiagnostic?.marketSignal).toBe(false);
  });

  it('keeps entry recheck DART null as missing diagnostic only', () => {
    const result = evaluateGate2WithDartNull('ENTRY_RECHECK_GATE');
    const gate2 = result.gateLayerSummary?.gate2;
    const dart = gate2?.externalDataCoverage?.dartFinancials;
    const compact = gate2?.consolidatedDiagnostic?.compactText ?? '';

    expect(dart).toMatchObject({
      status: 'MISSING',
      providerIssue: true,
      marketSignal: false,
    });
    expect(compact).toContain('issue=DART_FINANCIALS_UNAVAILABLE');
    expect(compact).toContain('DART=MISSING');
    expect(gate2?.consolidatedDiagnostic?.marketSignal).toBe(false);
  });

  it('does not change scoring fields when only entry recheck stage is explicit', () => {
    expect(pickDecisionFields(evaluateGate2WithDartNull('ENTRY_RECHECK_GATE')))
      .toEqual(pickDecisionFields(evaluateGate2WithDartNull()));
  });
});
