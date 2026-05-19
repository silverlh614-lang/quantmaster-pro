// @responsibility Gate2 wiring diagnostics regression tests.

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONDITION_WEIGHTS,
  evaluateServerGate,
  type ServerGateResult,
} from '../quantFilter.js';
import type { YahooQuoteExtended } from '../screener/stockScreener.js';
import type { KisInvestorFlow } from '../clients/kisClient.js';
import type { DartFinancials } from '../clients/dartFinancialClient.js';
import { formatGate2CompactDiagnostic } from './gate2Diagnostics.js';

type QuotePatch = Partial<YahooQuoteExtended> & Record<string, unknown>;

function gate2Quote(overrides: QuotePatch = {}): YahooQuoteExtended {
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

function kisFlow(overrides: Partial<KisInvestorFlow> & Record<string, unknown> = {}): KisInvestorFlow {
  return {
    foreignNetBuy: 10_000,
    institutionalNetBuy: 20_000,
    individualNetBuy: -30_000,
    source: 'KIS_API',
    ...overrides,
  } as KisInvestorFlow;
}

function dartFin(overrides: Partial<DartFinancials> = {}): DartFinancials {
  return {
    roe: 12,
    opm: 9,
    debtRatio: 80,
    ocfRatio: 6,
    year: '2025',
    source: 'DART_API',
    ...overrides,
  };
}

function evaluateGate2(input: {
  quote?: YahooQuoteExtended;
  kisFlow?: KisInvestorFlow | null;
  dartFin?: DartFinancials | null;
  kospi20dReturn?: number;
} = {}): ServerGateResult {
  return evaluateServerGate(
    input.quote ?? gate2Quote(),
    DEFAULT_CONDITION_WEIGHTS,
    input.kospi20dReturn,
    input.dartFin === undefined ? dartFin() : input.dartFin,
    input.kisFlow === undefined ? kisFlow() : input.kisFlow,
  );
}

function pickCoreDecisionFields(result: ServerGateResult) {
  return {
    rawScore: result.rawScore,
    gateScore: result.gateScore,
    normalizedGateScore: result.normalizedGateScore,
    signalType: result.signalType,
    positionPct: result.positionPct,
    gate2Fired: result.gateLayerSummary?.gate2.fired,
    gate2ThresholdNotMet: result.gateLayerSummary?.gate2.thresholdNotMet,
    gate2Unavailable: result.gateLayerSummary?.gate2.unavailable,
  };
}

describe('Gate2 wiring diagnostics', () => {
  it('reports all Gate2 declared inputs and external data as available', () => {
    const result = evaluateGate2({ kospi20dReturn: 5 });
    const gate2 = result.gateLayerSummary!.gate2;

    expect(gate2.sourceCoverage).toMatchObject({
      conditionCount: 5,
      quoteInputCount: 9,
      kisInputCount: 2,
      dartInputCount: 1,
      benchmarkInputCount: 1,
      requiredExternalData: ['BENCHMARK_KOSPI_20D_RETURN', 'KIS_INVESTOR_FLOW', 'DART_FINANCIALS'],
      missingInputs: [],
      missingExternalData: [],
      allDeclaredInputsAvailable: true,
      allExternalDataAvailable: true,
      marketSignal: false,
      diagnosticOnly: true,
    });
    expect(gate2.externalDataCoverage).toMatchObject({
      kisInvestorFlow: { status: 'VERIFIED', available: true, providerIssue: false, marketSignal: false },
      dartFinancials: { status: 'VERIFIED', available: true, providerIssue: false, marketSignal: false },
      benchmark: { status: 'VERIFIED', available: true, providerIssue: false, marketSignal: false },
    });
    expect(gate2.wiring?.find(item => item.key === 'relative_strength')).toMatchObject({
      inputs: ['quote.return20d', 'ctx.kospi20dReturn'],
      quoteInputs: ['quote.return20d'],
      benchmarkInputs: ['ctx.kospi20dReturn'],
      dataPath: 'QUOTE_BENCHMARK',
      marketSignal: false,
      diagnosticOnly: true,
    });
  });

  it('separates KIS investor flow missing from market signal', () => {
    const result = evaluateGate2({ kospi20dReturn: 5, kisFlow: null });
    const gate2 = result.gateLayerSummary!.gate2;

    expect(gate2.sourceCoverage).toMatchObject({
      allDeclaredInputsAvailable: false,
      allExternalDataAvailable: false,
      marketSignal: false,
      diagnosticOnly: true,
    });
    expect(gate2.sourceCoverage?.missingExternalData).toContain('KIS_INVESTOR_FLOW');
    expect(gate2.externalDataCoverage?.kisInvestorFlow).toMatchObject({
      required: true,
      available: false,
      status: 'MISSING',
      providerIssue: true,
      marketSignal: false,
    });
    expect(gate2.wiring?.find(item => item.key === 'supply_confluence')).toMatchObject({
      status: 'DATA_UNAVAILABLE',
      missingExternalData: ['KIS_INVESTOR_FLOW'],
      providerIssue: true,
      marketSignal: false,
    });
  });

  it('separates DART missing from market signal', () => {
    const result = evaluateGate2({ kospi20dReturn: 5, dartFin: null });
    const gate2 = result.gateLayerSummary!.gate2;

    expect(gate2.sourceCoverage?.missingExternalData).toContain('DART_FINANCIALS');
    expect(gate2.externalDataCoverage?.dartFinancials).toMatchObject({
      required: true,
      available: false,
      status: 'MISSING',
      providerIssue: true,
      marketSignal: false,
    });
    expect(gate2.wiring?.find(item => item.key === 'earnings_quality')).toMatchObject({
      status: 'DATA_UNAVAILABLE',
      dartInputs: ['ctx.dartFin.ocfRatio'],
      missingExternalData: ['DART_FINANCIALS'],
      marketSignal: false,
    });
  });

  it('separates missing benchmark from relative strength threshold results', () => {
    const result = evaluateGate2({ kospi20dReturn: undefined });
    const gate2 = result.gateLayerSummary!.gate2;

    expect(gate2.sourceCoverage?.missingExternalData).toContain('BENCHMARK_KOSPI_20D_RETURN');
    expect(gate2.externalDataCoverage?.benchmark).toMatchObject({
      required: true,
      available: false,
      status: 'MISSING',
      providerIssue: true,
      marketSignal: false,
    });
    expect(gate2.wiring?.find(item => item.key === 'relative_strength')).toMatchObject({
      benchmarkInputs: ['ctx.kospi20dReturn'],
      missingExternalData: ['BENCHMARK_KOSPI_20D_RETURN'],
      dataPath: 'QUOTE_BENCHMARK',
      marketSignal: false,
    });
  });

  it('reports quote PER missing in Gate2 wiring without throwing', () => {
    const quote = gate2Quote() as QuotePatch;
    delete quote.per;
    const result = evaluateGate2({ quote: quote as YahooQuoteExtended, kospi20dReturn: 5 });
    const gate2 = result.gateLayerSummary!.gate2;

    expect(gate2.sourceCoverage).toMatchObject({
      allDeclaredInputsAvailable: false,
      marketSignal: false,
      diagnosticOnly: true,
    });
    expect(gate2.sourceCoverage?.missingInputs).toContain('quote.per');
    expect(gate2.wiring?.find(item => item.key === 'per')).toMatchObject({
      inputs: ['quote.per'],
      quoteInputs: ['quote.per'],
      missingInputs: ['quote.per'],
      dataPath: 'QUOTE_ONLY',
      marketSignal: false,
    });
  });

  it('keeps providerIssue separated from marketSignal and score semantics', () => {
    const normal = evaluateGate2({ kospi20dReturn: 5 });
    const degraded = evaluateGate2({
      kospi20dReturn: 5,
      kisFlow: kisFlow({ providerStatus: 'HTTP_ERROR' }),
    });

    expect(pickCoreDecisionFields(degraded)).toEqual(pickCoreDecisionFields(normal));
    expect(degraded.gateLayerSummary?.gate2.externalDataCoverage?.kisInvestorFlow).toMatchObject({
      status: 'DEGRADED',
      providerIssue: true,
      marketSignal: false,
    });
  });

  it('formats Gate2 scan diagnostics without changing execution policy', () => {
    const result = evaluateGate2({ kospi20dReturn: 5, kisFlow: null });
    const text = formatGate2CompactDiagnostic({
      sourceCoverage: result.gateLayerSummary?.gate2.sourceCoverage as never,
      externalDataCoverage: result.gateLayerSummary?.gate2.externalDataCoverage,
    });

    expect(text).toContain('Gate2: DEGRADED');
    expect(text).toContain('KIS=MISSING');
    expect(text).toContain('marketSignal=false');
  });
});
