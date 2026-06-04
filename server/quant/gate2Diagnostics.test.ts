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
import { normalizeDartFinancials, type QmpDartFinancials } from '../clients/dartFinancialNormalizer.js';
import {
  normalizeBenchmarkReturnForGate2,
  selectBenchmarkForSymbol,
  type BenchmarkMarket,
  type QmpBenchmarkReturn,
} from '../clients/benchmarkReturnNormalizer.js';
import {
  normalizeSectorThemeCycleForGate2,
  type QmpSectorThemeCycle,
} from '../clients/sectorThemeLeaderCycleNormalizer.js';
import {
  KIS_OFFICIAL_INVESTOR_FLOW_ENDPOINTS,
  KIS_OFFICIAL_PROGRAM_TRADE_ENDPOINTS,
} from '../clients/kisClient/kisOfficialEndpointRegistry.js';
import { normalizeKisInvestorFlow, type QmpInvestorFlow } from '../clients/kisClient/kisOfficialInvestorFlowMapper.js';
import { normalizeKisProgramFlow, type QmpProgramFlow } from '../clients/kisClient/kisOfficialProgramFlowMapper.js';
import {
  formatGate2BenchmarkCompactDiagnostic,
  formatGate2CompactDiagnostic,
  formatGate2DartFinancialsCompactDiagnostic,
  formatGate2KisInvestorFlowCompactDiagnostic,
  formatGate2LeaderCycleCompactDiagnostic,
  formatGate2ProgramTradeCompactDiagnostic,
  formatGate2SectorCycleCompactDiagnostic,
  type Gate2EvaluationStage,
} from './gate2Diagnostics.js';

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
  kisFlow?: KisInvestorFlow | QmpInvestorFlow | null;
  dartFin?: DartFinancials | QmpDartFinancials | null;
  kospi20dReturn?: number | null;
  kosdaq20dReturn?: number | null;
  market?: BenchmarkMarket | string | null;
  benchmarkReturn?: QmpBenchmarkReturn | null;
  programTrade?: {
    marketProgram?: QmpProgramFlow | null;
    stockProgram?: QmpProgramFlow | null;
  } | null;
  sectorThemeCycle?: QmpSectorThemeCycle | Record<string, unknown> | null;
  sectorEnergyResult?: unknown;
  stockMaster?: unknown;
  evaluationStage?: Gate2EvaluationStage | null;
} = {}): ServerGateResult {
  return evaluateServerGate(
    input.quote ?? gate2Quote(),
    DEFAULT_CONDITION_WEIGHTS,
    input.kospi20dReturn,
    (input.dartFin === undefined ? dartFin() : input.dartFin) as never,
    (input.kisFlow === undefined ? kisFlow() : input.kisFlow) as never,
    undefined,
    input.evaluationStage,
    {
      kosdaq20dReturn: input.kosdaq20dReturn,
      market: input.market,
      benchmarkReturn: input.benchmarkReturn,
      programTrade: input.programTrade,
      sectorThemeCycle: input.sectorThemeCycle,
      sectorEnergyResult: input.sectorEnergyResult,
      stockMaster: input.stockMaster,
    },
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
  it('exposes official KIS investor-flow endpoint registry', () => {
    expect(KIS_OFFICIAL_INVESTOR_FLOW_ENDPOINTS.INQUIRE_INVESTOR).toMatchObject({
      key: 'INQUIRE_INVESTOR',
      path: '/uapi/domestic-stock/v1/quotations/inquire-investor',
      trId: 'FHKST01010900',
      requiredParams: ['FID_COND_MRKT_DIV_CODE', 'FID_INPUT_ISCD'],
      dataDomain: 'DOMESTIC_STOCK_INVESTOR_FLOW',
      source: 'KIS_OFFICIAL_OPEN_TRADING_API',
    });
    expect(KIS_OFFICIAL_INVESTOR_FLOW_ENDPOINTS.INVESTOR_TRADE_BY_STOCK_DAILY).toMatchObject({
      key: 'INVESTOR_TRADE_BY_STOCK_DAILY',
      path: '/uapi/domestic-stock/v1/quotations/investor-trade-by-stock-daily',
      trId: 'FHPTJ04160001',
      requiredParams: [
        'FID_COND_MRKT_DIV_CODE',
        'FID_INPUT_ISCD',
        'FID_INPUT_DATE_1',
        'FID_ORG_ADJ_PRC',
        'FID_ETC_CLS_CODE',
      ],
      dataDomain: 'DOMESTIC_STOCK_INVESTOR_FLOW_DAILY',
    });
  });

  it('exposes official KIS program-trade endpoint registry', () => {
    expect(KIS_OFFICIAL_PROGRAM_TRADE_ENDPOINTS.COMP_PROGRAM_TRADE_TODAY).toMatchObject({
      key: 'COMP_PROGRAM_TRADE_TODAY',
      path: '/uapi/domestic-stock/v1/quotations/comp-program-trade-today',
      trId: 'FHPPG04600101',
      requiredParams: ['FID_COND_MRKT_DIV_CODE'],
      dataDomain: 'MARKET_PROGRAM_TRADE',
      scope: 'MARKET',
      source: 'KIS_OFFICIAL_OPEN_TRADING_API',
    });
    expect(KIS_OFFICIAL_PROGRAM_TRADE_ENDPOINTS.PROGRAM_TRADE_BY_STOCK_DAILY).toMatchObject({
      key: 'PROGRAM_TRADE_BY_STOCK_DAILY',
      path: '/uapi/domestic-stock/v1/quotations/program-trade-by-stock-daily',
      trId: 'FHPPG04650201',
      requiredParams: ['FID_COND_MRKT_DIV_CODE', 'FID_INPUT_ISCD', 'FID_INPUT_DATE_1'],
      dataDomain: 'STOCK_PROGRAM_TRADE',
      scope: 'STOCK',
      source: 'KIS_OFFICIAL_OPEN_TRADING_API',
    });
  });

  it('normalizes KIS official investor-flow raw output without creating market signal', () => {
    const normalized = normalizeKisInvestorFlow({
      symbol: '005930',
      endpointKey: 'INQUIRE_INVESTOR',
      raw: {
        rt_cd: '0',
        output: [{
          stck_bsop_date: '20260519',
          frgn_ntby_qty: '1200000000',
          orgn_ntby_qty: '800000000',
          prsn_ntby_qty: '-2000000000',
        }],
      },
      fetchedAt: '2026-05-19T09:31:00+09:00',
    });

    expect(normalized).toMatchObject({
      symbol: '005930',
      tradeDate: '2026-05-19',
      foreignNetBuy: 1_200_000_000,
      institutionalNetBuy: 800_000_000,
      individualNetBuy: -2_000_000_000,
      source: 'KIS_OFFICIAL',
      endpointKey: 'INQUIRE_INVESTOR',
      endpoint: '/uapi/domestic-stock/v1/quotations/inquire-investor',
      trId: 'FHKST01010900',
      providerStatus: 'OK_WITH_DATA',
      dataConfidence: 'VERIFIED',
      providerIssue: false,
      marketSignal: false,
      executionImpact: 'DIAGNOSTIC_ONLY',
    });
    expect(normalized.rawFieldCoverage).toMatchObject({
      requiredFields: ['foreignNetBuy', 'institutionalNetBuy'],
      presentFields: ['foreignNetBuy', 'institutionalNetBuy'],
      missingFields: [],
      allRequiredFieldsPresent: true,
    });
  });

  it('normalizes DART financial raw output without creating market signal', () => {
    const normalized = normalizeDartFinancials({
      symbol: '005930',
      corpCode: '00126380',
      reportDate: '2026-05-19',
      fiscalYear: '2025',
      quarter: 'ANNUAL',
      raw: {
        revenue: '1000000000000',
        operatingIncome: '123000000000',
        netIncome: '100000000000',
        operatingCashFlow: '140000000000',
        interestExpense: '14642857143',
        totalEquity: '537634408602',
        totalAssets: '2000000000000',
      },
      previousYearComparable: {
        revenue: '900000000000',
        operatingIncome: '90000000000',
      },
    });

    expect(normalized).toMatchObject({
      symbol: '005930',
      corpCode: '00126380',
      reportDate: '2026-05-19',
      revenue: 1_000_000_000_000,
      operatingIncome: 123_000_000_000,
      netIncome: 100_000_000_000,
      operatingCashFlow: 140_000_000_000,
      source: 'DART',
      providerStatus: 'OK_WITH_DATA',
      dataConfidence: 'VERIFIED',
      providerIssue: false,
      marketSignal: false,
      executionImpact: 'DIAGNOSTIC_ONLY',
    });
    expect(normalized.ocfRatio).toBeCloseTo(1.4, 5);
    expect(normalized.roe).toBeCloseTo(0.186, 3);
    expect(normalized.opm).toBeCloseTo(0.123, 5);
    expect(normalized.interestCoverageRatio).toBeCloseTo(8.4, 2);
    expect(normalized.marginAcceleration).toBeCloseTo((123 / 90 - 1) - (1000 / 900 - 1), 5);
    expect(normalized.rawFieldCoverage).toMatchObject({
      requiredFields: ['operatingCashFlow', 'netIncome'],
      presentFields: ['operatingCashFlow', 'netIncome'],
      missingFields: [],
      allRequiredFieldsPresent: true,
    });
  });

  it('reports all Gate2 declared inputs and external data as available', () => {
    const result = evaluateGate2({ kospi20dReturn: 5 });
    const gate2 = result.gateLayerSummary!.gate2;

    expect(gate2.sourceCoverage).toMatchObject({
      conditionCount: 5,
      quoteInputCount: 9,
      kisInputCount: 2,
      dartInputCount: 1,
      benchmarkInputCount: 1,
      requiredExternalData: ['BENCHMARK_20D_RETURN', 'KIS_INVESTOR_FLOW', 'DART_FINANCIALS'],
      missingInputs: [],
      missingExternalData: [],
      allDeclaredInputsAvailable: true,
      allExternalDataAvailable: true,
      marketSignal: false,
      diagnosticOnly: true,
    });
    expect(gate2.externalDataCoverage).toMatchObject({
      kisInvestorFlow: { status: 'VERIFIED', available: true, providerIssue: false, marketSignal: false, executionImpact: 'DIAGNOSTIC_ONLY' },
      dartFinancials: { status: 'VERIFIED', available: true, providerIssue: false, marketSignal: false, executionImpact: 'DIAGNOSTIC_ONLY' },
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

  it('links normalized DART financial metadata into externalDataCoverage', () => {
    const normalized = normalizeDartFinancials({
      symbol: '005930',
      raw: {
        revenue: '1000000000000',
        operatingIncome: '123000000000',
        netIncome: '100000000000',
        operatingCashFlow: '140000000000',
        interestExpense: '14642857143',
        totalEquity: '537634408602',
      },
    });
    const normal = evaluateGate2({ kospi20dReturn: 5, dartFin: dartFin({ ocfRatio: 1.4 }) });
    const result = evaluateGate2({ kospi20dReturn: 5, dartFin: normalized });
    const gate2 = result.gateLayerSummary!.gate2;

    expect(pickCoreDecisionFields(result)).toEqual(pickCoreDecisionFields(normal));
    expect(gate2.externalDataCoverage?.dartFinancials).toMatchObject({
      provider: 'DART',
      providerStatus: 'OK_WITH_DATA',
      dataConfidence: 'VERIFIED',
      status: 'VERIFIED',
      fields: {
        operatingCashFlow: true,
        netIncome: true,
        ocfRatio: true,
        roe: true,
        opm: true,
        interestCoverageRatio: true,
      },
      missingFields: [],
      providerIssue: false,
      marketSignal: false,
      executionImpact: 'DIAGNOSTIC_ONLY',
    });
    expect(gate2.externalDataCoverage?.dartFinancials.ocfRatio).toBeCloseTo(1.4, 5);
    expect(gate2.wiring?.find(item => item.key === 'earnings_quality')).toMatchObject({
      inputs: ['ctx.dartFin.ocfRatio'],
      dartInputs: ['ctx.dartFin.ocfRatio'],
      missingInputs: [],
      requiredExternalData: ['DART_FINANCIALS'],
      missingExternalData: [],
      dataPath: 'DART',
      providerIssue: false,
      marketSignal: false,
      diagnosticOnly: true,
    });
  });

  it('treats DART OK_EMPTY as empty valid diagnostic rather than bearish fundamentals', () => {
    const normalized = normalizeDartFinancials({
      symbol: '005930',
      raw: { status: '000', list: [] },
    });
    const result = evaluateGate2({ kospi20dReturn: 5, dartFin: normalized });

    expect(result.gateLayerSummary?.gate2.externalDataCoverage?.dartFinancials).toMatchObject({
      providerStatus: 'OK_EMPTY',
      dataConfidence: 'EMPTY_VALID',
      status: 'EMPTY_VALID',
      available: false,
      providerIssue: false,
      marketSignal: false,
    });
    expect(result.gateLayerSummary?.gate2.wiring?.find(item => item.key === 'earnings_quality')).toMatchObject({
      missingExternalData: ['DART_FINANCIALS'],
      marketSignal: false,
    });
  });

  it('reports DART FIELD_MISSING raw coverage without converting it to market signal', () => {
    const normalized = normalizeDartFinancials({
      symbol: '005930',
      raw: { netIncome: '100000000000' },
    });
    const result = evaluateGate2({ kospi20dReturn: 5, dartFin: normalized });
    const dart = result.gateLayerSummary?.gate2.externalDataCoverage?.dartFinancials;

    expect(normalized.providerStatus).toBe('FIELD_MISSING');
    expect(normalized.ocfRatio).toBeNull();
    // 분류 정정(BASELINE-LOCK-001 후속): FIELD_MISSING(OCF 누락)은 데이터 완전성 문제 → PARTIAL(연결 정상),
    // provider transport 장애가 아니므로 providerIssue=false. (이전엔 DEGRADED+providerIssue=true 오분류)
    expect(normalized.providerIssue).toBe(false);
    expect(dart).toMatchObject({
      status: 'PARTIAL',
      missingFields: ['operatingCashFlow'],
      providerIssue: false,
      marketSignal: false,
    });
    expect(dart?.rawFieldCoverage.missingFields).toContain('operatingCashFlow');
  });

  it('reports DART PARSE_ERROR without throwing or creating market signal', () => {
    const normalized = normalizeDartFinancials({
      symbol: '005930',
      raw: { operatingCashFlow: 'abc', netIncome: 'N/A' },
    });
    const result = evaluateGate2({ kospi20dReturn: 5, dartFin: normalized });

    expect(normalized.providerStatus).toBe('PARSE_ERROR');
    expect(result.gateLayerSummary?.gate2.externalDataCoverage?.dartFinancials).toMatchObject({
      status: 'DEGRADED',
      providerIssue: true,
      marketSignal: false,
    });
  });

  it('keeps DART interest coverage null when interest expense is zero', () => {
    const normalized = normalizeDartFinancials({
      symbol: '005930',
      raw: {
        operatingIncome: '100000000000',
        interestExpense: '0',
        operatingCashFlow: '140000000000',
        netIncome: '100000000000',
      },
    });

    expect(normalized.interestCoverageRatio).toBeNull();
    expect(normalized.marketSignal).toBe(false);
  });

  it('keeps DART stage-not-fetched separate from provider degradation', () => {
    const result = evaluateGate2({ kospi20dReturn: 5, dartFin: null, evaluationStage: 'DISCOVERY_GATE' });
    const dart = result.gateLayerSummary?.gate2.externalDataCoverage?.dartFinancials;

    expect(dart).toMatchObject({
      required: true,
      available: false,
      status: 'STAGE_NOT_FETCHED',
      stageNotFetched: true,
      providerIssue: false,
      marketSignal: false,
    });
  });

  it('separates missing benchmark from relative strength threshold results', () => {
    const result = evaluateGate2({ kospi20dReturn: undefined });
    const gate2 = result.gateLayerSummary!.gate2;

    expect(gate2.sourceCoverage?.missingExternalData).toContain('BENCHMARK_20D_RETURN');
    expect(gate2.externalDataCoverage?.benchmark).toMatchObject({
      required: true,
      available: false,
      status: 'MISSING',
      providerIssue: true,
      marketSignal: false,
    });
    expect(gate2.wiring?.find(item => item.key === 'relative_strength')).toMatchObject({
      benchmarkInputs: ['ctx.kospi20dReturn'],
      missingExternalData: ['BENCHMARK_20D_RETURN'],
      dataPath: 'QUOTE_BENCHMARK',
      marketSignal: false,
    });
  });

  it('selects and normalizes KOSPI benchmark return diagnostics', () => {
    const result = evaluateGate2({
      quote: gate2Quote({ symbol: '005930', return20d: 0.124 } as QuotePatch),
      kospi20dReturn: 0.031,
      market: 'KOSPI',
    });
    const benchmark = result.gateLayerSummary?.gate2.externalDataCoverage?.benchmark;

    expect(selectBenchmarkForSymbol({ symbol: '005930', market: 'KOSPI' })).toMatchObject({
      benchmarkKey: 'KOSPI',
      reason: 'MARKET_KOSPI_DEFAULT_BENCHMARK',
    });
    expect(benchmark).toMatchObject({
      status: 'VERIFIED',
      available: true,
      market: 'KOSPI',
      benchmarkKey: 'KOSPI',
      fields: {
        stockReturn20d: true,
        benchmarkReturn20d: true,
        relativeReturn20d: true,
        kospi20dReturn: true,
      },
      providerIssue: false,
      marketSignal: false,
      executionImpact: 'DIAGNOSTIC_ONLY',
    });
    expect(benchmark?.values.stockReturn20d).toBe(0.124);
    expect(benchmark?.values.benchmarkReturn20d).toBe(0.031);
    expect(benchmark?.values.relativeReturn20d).toBeCloseTo(0.093, 6);
    expect(result.gateLayerSummary?.gate2.wiring?.find(item => item.key === 'relative_strength')?.missingInputs).toEqual([]);
  });

  it('normalizes KOSDAQ benchmark return diagnostics without changing the current KOSPI formula', () => {
    const result = evaluateGate2({
      quote: gate2Quote({ symbol: '035720', return20d: 0.182 } as QuotePatch),
      kospi20dReturn: 0.031,
      kosdaq20dReturn: 0.047,
      market: 'KOSDAQ',
    });
    const benchmark = result.gateLayerSummary?.gate2.externalDataCoverage?.benchmark;

    expect(benchmark).toMatchObject({
      status: 'VERIFIED',
      market: 'KOSDAQ',
      benchmarkKey: 'KOSDAQ',
      providerIssue: false,
      marketSignal: false,
    });
    expect(benchmark?.values.stockReturn20d).toBe(0.182);
    expect(benchmark?.values.benchmarkReturn20d).toBe(0.047);
    expect(benchmark?.values.relativeReturn20d).toBeCloseTo(0.135, 6);
    expect(benchmark?.notes).toContain('CURRENT_GATE2_FORMULA_STILL_USES_CTX_KOSPI20D_RETURN');
  });

  it('keeps benchmark missing as data coverage rather than weak relative strength', () => {
    const result = evaluateGate2({
      quote: gate2Quote({ symbol: '005930', return20d: 0.12 } as QuotePatch),
      kospi20dReturn: null,
      kosdaq20dReturn: null,
      market: 'KOSPI',
    });
    const benchmark = result.gateLayerSummary?.gate2.externalDataCoverage?.benchmark;

    expect(benchmark).toMatchObject({
      status: 'MISSING',
      available: false,
      missingFields: ['benchmarkReturn20d'],
      values: {
        stockReturn20d: 0.12,
        benchmarkReturn20d: null,
        relativeReturn20d: null,
      },
      providerIssue: true,
      marketSignal: false,
    });
  });

  it('keeps stock return missing separate from benchmark provider state', () => {
    const result = evaluateGate2({
      quote: gate2Quote({ symbol: '005930', return20d: undefined } as QuotePatch),
      kospi20dReturn: 0.03,
      market: 'KOSPI',
    });
    const benchmark = result.gateLayerSummary?.gate2.externalDataCoverage?.benchmark;

    expect(benchmark?.missingFields).toContain('stockReturn20d');
    expect(benchmark).toMatchObject({
      values: {
        stockReturn20d: null,
        benchmarkReturn20d: 0.03,
        relativeReturn20d: null,
      },
      marketSignal: false,
    });
  });

  it('warns when KOSDAQ benchmark falls back to the current KOSPI formula input', () => {
    const normal = evaluateGate2({
      quote: gate2Quote({ symbol: '035720', return20d: 0.18 } as QuotePatch),
      kospi20dReturn: 0.03,
      market: 'KOSDAQ',
    });
    const result = evaluateGate2({
      quote: gate2Quote({ symbol: '035720', return20d: 0.18 } as QuotePatch),
      kospi20dReturn: 0.03,
      kosdaq20dReturn: null,
      market: 'KOSDAQ',
    });
    const benchmark = result.gateLayerSummary?.gate2.externalDataCoverage?.benchmark;

    expect(pickCoreDecisionFields(result)).toEqual(pickCoreDecisionFields(normal));
    expect(benchmark?.notes).toContain('KOSDAQ_BENCHMARK_MISSING_KOSPI_FALLBACK_DIAGNOSTIC_ONLY');
    expect(benchmark?.notes).toContain('SYMBOL_MARKET_KOSDAQ_BUT_CURRENT_FORMULA_USES_KOSPI_BENCHMARK_FALLBACK');
    expect(benchmark).toMatchObject({
      market: 'KOSDAQ',
      benchmarkKey: 'KOSDAQ',
      values: {
        benchmarkReturn20d: 0.03,
      },
      marketSignal: false,
    });
  });

  it('keeps benchmark stage-not-fetched separate from provider degradation', () => {
    const result = evaluateGate2({
      quote: gate2Quote({ symbol: '005930', return20d: 0.12 } as QuotePatch),
      kospi20dReturn: null,
      market: 'KOSPI',
      evaluationStage: 'DISCOVERY_GATE',
    });
    const benchmark = result.gateLayerSummary?.gate2.externalDataCoverage?.benchmark;

    expect(benchmark).toMatchObject({
      required: true,
      available: false,
      status: 'STAGE_NOT_FETCHED',
      stageNotFetched: true,
      providerIssue: false,
      marketSignal: false,
    });
  });

  it('normalizes benchmark raw values without replacing null with zero', () => {
    const normalized = normalizeBenchmarkReturnForGate2({
      symbol: '005930',
      market: 'KOSPI',
      stockReturn20d: null,
      kospi20dReturn: 0,
    });

    expect(normalized.stockReturn).toBeNull();
    expect(normalized.benchmarkReturn).toBe(0);
    expect(normalized.relativeReturn).toBeNull();
    expect(normalized.marketSignal).toBe(false);
  });

  it('normalizes KIS stock-level program flow into Gate2 passive-flow diagnostics', () => {
    const stockProgram = normalizeKisProgramFlow({
      symbol: '5930',
      endpointKey: 'PROGRAM_TRADE_BY_STOCK_DAILY',
      raw: {
        output: [{
          stck_bsop_date: '20260519',
          whol_smtn_ntby_tr_pbmn: '420000000',
          whol_smtn_ntby_qty: '12000',
        }],
      },
    });
    const normal = evaluateGate2({ kospi20dReturn: 5 });
    const result = evaluateGate2({ kospi20dReturn: 5, programTrade: { stockProgram } });
    const program = result.gateLayerSummary?.gate2.externalDataCoverage?.programTrade;

    expect(pickCoreDecisionFields(result)).toEqual(pickCoreDecisionFields(normal));
    expect(stockProgram).toMatchObject({
      symbol: '005930',
      scope: 'STOCK',
      programNetBuyAmount: 420_000_000,
      providerStatus: 'OK_WITH_DATA',
      dataConfidence: 'VERIFIED',
      marketSignal: false,
    });
    expect(program?.stockProgram).toMatchObject({
      available: true,
      endpointKey: 'PROGRAM_TRADE_BY_STOCK_DAILY',
      endpoint: '/uapi/domestic-stock/v1/quotations/program-trade-by-stock-daily',
      trId: 'FHPPG04650201',
      status: 'VERIFIED',
      scope: 'STOCK',
      fields: { programNetBuyAmount: true, programNetBuyVolume: true },
      values: { programNetBuyAmount: 420_000_000, programNetBuyVolume: 12_000 },
      providerIssue: false,
      marketSignal: false,
    });
    expect(program).toMatchObject({
      required: false,
      available: true,
      provider: 'KIS_OFFICIAL',
      scopeSeparationValid: true,
      marketSignal: false,
      executionImpact: 'DIAGNOSTIC_ONLY',
    });
    expect(program?.notes).toContain('STOCK_PROGRAM_TRADE_AVAILABLE_FOR_SYMBOL');
  });

  it('keeps market-level program trade as context-only when stock program is not fetched', () => {
    const marketProgram = normalizeKisProgramFlow({
      endpointKey: 'COMP_PROGRAM_TRADE_TODAY',
      raw: {
        output: [{
          whol_smtn_ntby_tr_pbmn: '1000000000',
          arbt_smtn_ntby_tr_pbmn: '400000000',
          nabt_smtn_ntby_tr_pbmn: '600000000',
        }],
      },
    });
    const result = evaluateGate2({
      kospi20dReturn: 5,
      evaluationStage: 'DISCOVERY_GATE',
      programTrade: { marketProgram, stockProgram: null },
    });
    const program = result.gateLayerSummary?.gate2.externalDataCoverage?.programTrade;

    expect(program?.marketProgram).toMatchObject({
      available: true,
      status: 'VERIFIED',
      scope: 'MARKET',
      fields: {
        programNetBuyAmount: true,
        arbitrageNetBuyAmount: true,
        nonArbitrageNetBuyAmount: true,
      },
      values: {
        programNetBuyAmount: 1_000_000_000,
        arbitrageNetBuyAmount: 400_000_000,
        nonArbitrageNetBuyAmount: 600_000_000,
      },
      providerIssue: false,
      marketSignal: false,
    });
    expect(program?.stockProgram).toMatchObject({
      available: false,
      status: 'STAGE_NOT_FETCHED',
      stageNotFetched: true,
      providerIssue: false,
      marketSignal: false,
    });
    expect(program?.scopeSeparationValid).toBe(true);
    expect(program?.notes).toContain('MARKET_PROGRAM_TRADE_IS_CONTEXT_ONLY_NOT_STOCK_SIGNAL');
    expect(program?.notes).toContain('MARKET_PROGRAM_ONLY_STOCK_PROGRAM_NOT_FETCHED');
  });

  it('treats KIS program OK_EMPTY as empty valid rather than bearish flow', () => {
    const stockProgram = normalizeKisProgramFlow({
      symbol: '005930',
      endpointKey: 'PROGRAM_TRADE_BY_STOCK_DAILY',
      raw: { rt_cd: '0', output: [] },
    });
    const result = evaluateGate2({ kospi20dReturn: 5, programTrade: { stockProgram } });
    const program = result.gateLayerSummary?.gate2.externalDataCoverage?.programTrade;

    expect(stockProgram.providerStatus).toBe('OK_EMPTY');
    expect(program?.stockProgram).toMatchObject({
      status: 'EMPTY_VALID',
      available: false,
      providerIssue: false,
      marketSignal: false,
    });
    expect(program?.notes).toContain('PROGRAM_TRADE_EMPTY_VALID_NOT_BEARISH');
  });

  it('detects program flow scope mismatch without changing Gate2 scores', () => {
    const marketProgram = normalizeKisProgramFlow({
      endpointKey: 'COMP_PROGRAM_TRADE_TODAY',
      raw: { output: [{ whol_smtn_ntby_tr_pbmn: '1000000000' }] },
    });
    const normal = evaluateGate2({ kospi20dReturn: 5 });
    const result = evaluateGate2({
      kospi20dReturn: 5,
      programTrade: { stockProgram: marketProgram },
    });
    const program = result.gateLayerSummary?.gate2.externalDataCoverage?.programTrade;

    expect(pickCoreDecisionFields(result)).toEqual(pickCoreDecisionFields(normal));
    expect(program?.scopeSeparationValid).toBe(false);
    expect(program?.stockProgram).toMatchObject({
      status: 'DEGRADED',
      available: false,
      providerIssue: true,
      marketSignal: false,
    });
    expect(program?.notes).toContain('SCOPE_MISMATCH_MARKET_DATA_USED_AS_STOCK_FLOW');
  });

  it('keeps KIS program provider degradation separate from marketSignal', () => {
    const stockProgram = normalizeKisProgramFlow({
      symbol: '005930',
      endpointKey: 'PROGRAM_TRADE_BY_STOCK_DAILY',
      raw: { httpStatus: 500 },
    });
    const result = evaluateGate2({ kospi20dReturn: 5, programTrade: { stockProgram } });
    const program = result.gateLayerSummary?.gate2.externalDataCoverage?.programTrade;

    expect(stockProgram.providerStatus).toBe('HTTP_ERROR');
    expect(program?.stockProgram).toMatchObject({
      status: 'DEGRADED',
      providerIssue: true,
      marketSignal: false,
    });
    expect(program?.marketSignal).toBe(false);
  });

  it('keeps program trade stage-not-fetched separate from provider degradation', () => {
    const result = evaluateGate2({ kospi20dReturn: 5, evaluationStage: 'DISCOVERY_GATE', programTrade: null });
    const program = result.gateLayerSummary?.gate2.externalDataCoverage?.programTrade;

    expect(program?.marketProgram).toMatchObject({
      status: 'STAGE_NOT_FETCHED',
      stageNotFetched: true,
      providerIssue: false,
      marketSignal: false,
    });
    expect(program?.stockProgram).toMatchObject({
      status: 'STAGE_NOT_FETCHED',
      stageNotFetched: true,
      providerIssue: false,
      marketSignal: false,
    });
  });

  it('normalizes Gate2 sector/theme/leader-cycle diagnostics without changing scores', () => {
    const quote = gate2Quote({ symbol: '035720', return20d: 0.182, return60d: 0.41 } as QuotePatch);
    const normal = evaluateGate2({ quote, kospi20dReturn: 0.031, kosdaq20dReturn: 0.047, market: 'KOSDAQ' });
    const result = evaluateGate2({
      quote,
      kospi20dReturn: 0.031,
      kosdaq20dReturn: 0.047,
      market: 'KOSDAQ',
      sectorThemeCycle: {
        sector: 'Internet Platform',
        industry: 'Software',
        themeTags: ['AI', 'Platform'],
        sectorReturn20d: 0.11,
        sectorReturn60d: 0.28,
        benchmarkReturn60d: 0.08,
        isCurrentLeadingSector: true,
        isPreviousCycleLeader: false,
        newsFrequency30d: 7,
        source: 'KRX_SECTOR_INDEX',
      },
    });
    const external = result.gateLayerSummary?.gate2.externalDataCoverage;

    expect(pickCoreDecisionFields(result)).toEqual(pickCoreDecisionFields(normal));
    expect(external?.sectorCycle).toMatchObject({
      required: false,
      available: true,
      provider: 'KRX_SECTOR_INDEX',
      status: 'VERIFIED',
      sector: 'Internet Platform',
      industry: 'Software',
      themeTags: ['AI', 'Platform'],
      market: 'KOSDAQ',
      fields: {
        sector: true,
        themeTags: true,
        sectorReturn20d: true,
        benchmarkReturn20d: true,
        sectorRelativeReturn20d: true,
        stockVsSectorReturn20d: true,
      },
      providerIssue: false,
      marketSignal: false,
      executionImpact: 'DIAGNOSTIC_ONLY',
      diagnosticOnly: true,
    });
    expect(external?.sectorCycle.values.sectorRelativeReturn20d).toBeCloseTo(0.063, 6);
    expect(external?.sectorCycle.values.stockVsSectorReturn20d).toBeCloseTo(0.072, 6);
    expect(external?.leaderCycle).toMatchObject({
      required: false,
      available: true,
      status: 'VERIFIED',
      leaderCyclePhase: 'MID_LEADER',
      isCurrentLeadingSector: true,
      isSectorLeader: true,
      isNewLeaderCandidate: true,
      attentionPhase: 'GROWING',
      providerIssue: false,
      marketSignal: false,
      executionImpact: 'DIAGNOSTIC_ONLY',
      diagnosticOnly: true,
    });
  });

  it('keeps missing sector/theme data as coverage issue rather than bearish signal', () => {
    const result = evaluateGate2({
      quote: gate2Quote({ symbol: '005930', return20d: 0.12 } as QuotePatch),
      kospi20dReturn: 0.03,
      market: 'KOSPI',
      sectorThemeCycle: null,
    });
    const external = result.gateLayerSummary?.gate2.externalDataCoverage;

    expect(external?.sectorCycle).toMatchObject({
      status: 'MISSING',
      available: false,
      providerIssue: true,
      marketSignal: false,
    });
    expect(external?.sectorCycle.missingFields).toContain('sector');
    expect(external?.leaderCycle).toMatchObject({
      status: 'MISSING',
      leaderCyclePhase: 'UNKNOWN',
      providerIssue: true,
      marketSignal: false,
    });
  });

  it('ADR-0568: SECTOR_ENERGY_GATE2_WIRING_ENABLED gates sectorEnergyResult into the sector axis', () => {
    // ADR-0571: 후보 sectorThemeCycle.sector 는 canonical KRX 섹터명으로 합성되며,
    // sectorEnergyResult.scores[].name(=CANONICAL_SECTORS, 한글) 과 일치해야 매칭된다.
    const quote = gate2Quote({ symbol: '000660', return20d: 0.18, sector: '반도체' } as QuotePatch);
    const sectorEnergyResult = {
      scores: [
        { name: '반도체', sectorReturn20d: 0.12 },
        { name: '바이오/헬스케어', sectorReturn20d: -0.03 },
      ],
      leadingSectors: [{ name: '반도체' }],
    };
    const prev = process.env.SECTOR_ENERGY_GATE2_WIRING_ENABLED;
    try {
      // OFF(default): sectorEnergyResult 무시 → 섹터 수익률/리더십 부재.
      process.env.SECTOR_ENERGY_GATE2_WIRING_ENABLED = 'false';
      const off = evaluateGate2({ quote, kospi20dReturn: 0.03, market: 'KOSPI', sectorEnergyResult });
      const offSector = off.gateLayerSummary?.gate2.externalDataCoverage?.sectorCycle;
      expect(offSector?.values.sectorReturn20d).toBeNull();
      expect(offSector?.values.sectorRank20d).toBeNull();
      expect(off.gateLayerSummary?.gate2.externalDataCoverage?.leaderCycle.isCurrentLeadingSector ?? null).toBeNull();

      // OFF 는 sectorEnergyResult 미전달과 byte-identical 이어야 한다(소비 지점 gate 증명).
      const offNoSer = evaluateGate2({ quote, kospi20dReturn: 0.03, market: 'KOSPI' });
      expect(offSector).toEqual(offNoSer.gateLayerSummary?.gate2.externalDataCoverage?.sectorCycle);

      // ON: sectorEnergyResult 가 SECTOR_LEADERSHIP 축으로 흐른다.
      process.env.SECTOR_ENERGY_GATE2_WIRING_ENABLED = 'true';
      const on = evaluateGate2({ quote, kospi20dReturn: 0.03, market: 'KOSPI', sectorEnergyResult });
      const onSector = on.gateLayerSummary?.gate2.externalDataCoverage?.sectorCycle;
      expect(onSector?.values.sectorReturn20d).toBeCloseTo(0.12, 6);
      expect(onSector?.values.sectorRank20d).toBe(1);
      expect(on.gateLayerSummary?.gate2.externalDataCoverage?.leaderCycle.isCurrentLeadingSector).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.SECTOR_ENERGY_GATE2_WIRING_ENABLED;
      else process.env.SECTOR_ENERGY_GATE2_WIRING_ENABLED = prev;
    }
  });

  it('classifies crowded leader-cycle diagnostics without using news frequency as a score signal', () => {
    const normalized = normalizeSectorThemeCycleForGate2({
      symbol: '005930',
      market: 'KOSPI',
      quote: gate2Quote({ symbol: '005930', return20d: 0.18 } as QuotePatch),
      sectorThemeCycle: {
        sector: 'Semiconductor',
        sectorReturn20d: 0.1,
        benchmarkReturn20d: 0.03,
        isCurrentLeadingSector: true,
        isSectorLeader: true,
        newsFrequency30d: 35,
      },
    });

    expect(normalized.attentionPhase).toBe('OVERHYPED');
    expect(normalized.leaderCyclePhase).toBe('LATE_CROWDED');
    expect(normalized.marketSignal).toBe(false);
    expect(normalized.executionImpact).toBe('DIAGNOSTIC_ONLY');
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

  it('links normalized KIS official flow metadata into externalDataCoverage', () => {
    const normalized = normalizeKisInvestorFlow({
      symbol: '005930',
      endpointKey: 'INVESTOR_TRADE_BY_STOCK_DAILY',
      raw: {
        output2: [{
          stck_bsop_date: '20260519',
          frgn_ntby_qty: '1200000000',
          orgn_ntby_qty: '800000000',
          prsn_ntby_qty: '-2000000000',
        }],
      },
    });
    const normal = evaluateGate2({ kospi20dReturn: 5, kisFlow: kisFlow({ foreignNetBuy: 1_200_000_000, institutionalNetBuy: 800_000_000, individualNetBuy: -2_000_000_000 }) });
    const result = evaluateGate2({ kospi20dReturn: 5, kisFlow: normalized });
    const gate2 = result.gateLayerSummary!.gate2;

    expect(pickCoreDecisionFields(result)).toEqual(pickCoreDecisionFields(normal));
    expect(gate2.externalDataCoverage?.kisInvestorFlow).toMatchObject({
      provider: 'KIS_OFFICIAL',
      endpointKey: 'INVESTOR_TRADE_BY_STOCK_DAILY',
      endpoint: '/uapi/domestic-stock/v1/quotations/investor-trade-by-stock-daily',
      trId: 'FHPTJ04160001',
      providerStatus: 'OK_WITH_DATA',
      dataConfidence: 'VERIFIED',
      status: 'VERIFIED',
      fields: { foreignNetBuy: true, institutionalNetBuy: true, individualNetBuy: true },
      foreignNetBuy: 1_200_000_000,
      institutionalNetBuy: 800_000_000,
      individualNetBuy: -2_000_000_000,
      missingFields: [],
      providerIssue: false,
      marketSignal: false,
      executionImpact: 'DIAGNOSTIC_ONLY',
    });
    expect(gate2.wiring?.find(item => item.key === 'supply_confluence')).toMatchObject({
      kisInputs: ['ctx.kisFlow.institutionalNetBuy', 'ctx.kisFlow.foreignNetBuy'],
      missingInputs: [],
      requiredExternalData: ['KIS_INVESTOR_FLOW'],
      missingExternalData: [],
      dataPath: 'KIS',
      providerIssue: false,
      marketSignal: false,
      diagnosticOnly: true,
    });
  });

  it('treats KIS OK_EMPTY as empty valid diagnostic rather than bearish flow', () => {
    const normalized = normalizeKisInvestorFlow({
      symbol: '005930',
      endpointKey: 'INQUIRE_INVESTOR',
      raw: { rt_cd: '0', output: [] },
    });
    const result = evaluateGate2({ kospi20dReturn: 5, kisFlow: normalized });

    expect(result.gateLayerSummary?.gate2.externalDataCoverage?.kisInvestorFlow).toMatchObject({
      providerStatus: 'OK_EMPTY',
      dataConfidence: 'EMPTY_VALID',
      status: 'EMPTY_VALID',
      available: false,
      providerIssue: false,
      marketSignal: false,
    });
    expect(result.gateLayerSummary?.gate2.wiring?.find(item => item.key === 'supply_confluence')).toMatchObject({
      missingExternalData: ['KIS_INVESTOR_FLOW'],
      marketSignal: false,
    });
  });

  it('reports KIS FIELD_MISSING raw coverage without converting it to market signal', () => {
    const normalized = normalizeKisInvestorFlow({
      symbol: '005930',
      endpointKey: 'INQUIRE_INVESTOR',
      raw: {
        output: [{
          orgn_ntby_qty: '800000000',
          prsn_ntby_qty: '-800000000',
        }],
      },
    });
    const result = evaluateGate2({ kospi20dReturn: 5, kisFlow: normalized });
    const kis = result.gateLayerSummary?.gate2.externalDataCoverage?.kisInvestorFlow;

    expect(normalized.providerStatus).toBe('FIELD_MISSING');
    expect(kis).toMatchObject({
      status: 'DEGRADED',
      missingFields: ['foreignNetBuy'],
      providerIssue: true,
      marketSignal: false,
    });
    expect(kis?.rawFieldCoverage.missingFields).toContain('foreignNetBuy');
  });

  it('keeps stage-not-fetched separate from KIS provider degradation', () => {
    const result = evaluateGate2({ kospi20dReturn: 5, kisFlow: null, evaluationStage: 'DISCOVERY_GATE' });
    const kis = result.gateLayerSummary?.gate2.externalDataCoverage?.kisInvestorFlow;

    expect(kis).toMatchObject({
      required: true,
      available: false,
      status: 'STAGE_NOT_FETCHED',
      stageNotFetched: true,
      providerIssue: false,
      marketSignal: false,
    });
  });

  it('reports KIS official drift without auto-replacing runtime endpoint', () => {
    const normalized = normalizeKisInvestorFlow({
      symbol: '005930',
      endpointKey: 'INQUIRE_INVESTOR',
      actualPath: '/uapi/domestic-stock/v1/quotations/inquire-investor',
      actualTrId: 'FHKST01010300',
      raw: {
        output: [{
          frgn_ntby_qty: '1',
          orgn_ntby_qty: '2',
        }],
      },
    });
    const result = evaluateGate2({ kospi20dReturn: 5, kisFlow: normalized });

    expect(result.gateLayerSummary?.gate2.externalDataCoverage?.kisInvestorFlow.driftDiagnostics).toEqual([{
      type: 'KIS_OFFICIAL_DRIFT_DETECTED',
      api: 'INQUIRE_INVESTOR',
      expectedPath: '/uapi/domestic-stock/v1/quotations/inquire-investor',
      actualPath: '/uapi/domestic-stock/v1/quotations/inquire-investor',
      expectedTrId: 'FHKST01010900',
      actualTrId: 'FHKST01010300',
      action: 'DO_NOT_AUTO_REPLACE_REQUIRE_REVIEW',
    }]);
  });

  it('reports KIS official program trade drift without auto-replacing runtime endpoint', () => {
    const stockProgram = normalizeKisProgramFlow({
      symbol: '005930',
      endpointKey: 'PROGRAM_TRADE_BY_STOCK_DAILY',
      actualPath: '/uapi/domestic-stock/v1/quotations/program-trade-by-stock-daily',
      actualTrId: 'FHPPG04650000',
      raw: {
        output: [{ whol_smtn_ntby_tr_pbmn: '420000000' }],
      },
    });
    const result = evaluateGate2({ kospi20dReturn: 5, programTrade: { stockProgram } });

    expect(result.gateLayerSummary?.gate2.externalDataCoverage?.programTrade.stockProgram.driftDiagnostics).toEqual([{
      type: 'KIS_OFFICIAL_DRIFT_DETECTED',
      api: 'PROGRAM_TRADE_BY_STOCK_DAILY',
      expectedPath: '/uapi/domestic-stock/v1/quotations/program-trade-by-stock-daily',
      actualPath: '/uapi/domestic-stock/v1/quotations/program-trade-by-stock-daily',
      expectedTrId: 'FHPPG04650201',
      actualTrId: 'FHPPG04650000',
      action: 'DO_NOT_AUTO_REPLACE_REQUIRE_REVIEW',
    }]);
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

  it('formats Gate2 KIS investor-flow compact diagnostic', () => {
    const result = evaluateGate2({
      kospi20dReturn: 5,
      kisFlow: normalizeKisInvestorFlow({
        symbol: '005930',
        endpointKey: 'INQUIRE_INVESTOR',
        raw: { output: [{ frgn_ntby_qty: '1200000000', orgn_ntby_qty: '800000000' }] },
      }),
    });
    const text = formatGate2KisInvestorFlowCompactDiagnostic(result.gateLayerSummary?.gate2.externalDataCoverage);

    expect(text).toContain('Gate2 KIS Flow: VERIFIED');
    expect(text).toContain('apiPath=/uapi/domestic-stock/v1/quotations/inquire-investor');
    expect(text).toContain('trId=FHKST01010900');
    expect(text).toContain('foreign=+1200000000');
    expect(text).toContain('marketSignal=false');
  });

  it('formats Gate2 DART compact diagnostic', () => {
    const result = evaluateGate2({
      kospi20dReturn: 5,
      dartFin: normalizeDartFinancials({
        symbol: '005930',
        raw: {
          operatingCashFlow: '140000000000',
          netIncome: '100000000000',
          operatingIncome: '84000000000',
          interestExpense: '10000000000',
          // followup①(§C): roe/opm 파생을 위한 revenue/totalEquity 추가 — 전체 필드 가용 →
          // 라인 status 가 VERIFIED 로 정확히 분류되도록 fixture 를 완전 채움(부분 데이터였던
          // 기존 fixture 는 §C 도입 후 정확히 PARTIAL 로 분류됨).
          revenue: '200000000000',
          totalEquity: '500000000000',
        },
      }),
    });
    const text = formatGate2DartFinancialsCompactDiagnostic(result.gateLayerSummary?.gate2.externalDataCoverage);

    expect(text).toContain('Gate2 DART: VERIFIED');
    expect(text).toContain('OCF/NI=1.40');
    expect(text).toContain('ICR=8.40x');
    expect(text).toContain('marketSignal=false');
  });

  it('formats Gate2 benchmark compact diagnostic', () => {
    const result = evaluateGate2({
      quote: gate2Quote({ symbol: '035720', return20d: 0.182 } as QuotePatch),
      kospi20dReturn: 0.031,
      kosdaq20dReturn: 0.047,
      market: 'KOSDAQ',
    });
    const text = formatGate2BenchmarkCompactDiagnostic(result.gateLayerSummary?.gate2.externalDataCoverage);

    expect(text).toContain('Gate2 Benchmark: VERIFIED');
    expect(text).toContain('market=KOSDAQ');
    expect(text).toContain('benchmark=KOSDAQ');
    expect(text).toContain('RS=+13.50%');
    expect(text).toContain('marketSignal=false');
  });

  it('formats Gate2 program trade compact diagnostic', () => {
    const result = evaluateGate2({
      kospi20dReturn: 5,
      programTrade: {
        stockProgram: normalizeKisProgramFlow({
          symbol: '005930',
          endpointKey: 'PROGRAM_TRADE_BY_STOCK_DAILY',
          raw: { output: [{ whol_smtn_ntby_tr_pbmn: '420000000' }] },
        }),
      },
    });
    const text = formatGate2ProgramTradeCompactDiagnostic(result.gateLayerSummary?.gate2.externalDataCoverage);

    expect(text).toContain('Gate2 Program: VERIFIED');
    expect(text).toContain('stockProgram=+420000000');
    expect(text).toContain('scope=OK');
    expect(text).toContain('marketSignal=false');
  });

  it('formats Gate2 sector and leader-cycle compact diagnostics', () => {
    const result = evaluateGate2({
      quote: gate2Quote({ symbol: '035720', return20d: 0.18 } as QuotePatch),
      kospi20dReturn: 0.03,
      kosdaq20dReturn: 0.05,
      market: 'KOSDAQ',
      sectorThemeCycle: {
        sector: 'Internet Platform',
        themeTags: ['AI'],
        sectorReturn20d: 0.1,
        isCurrentLeadingSector: true,
        isSectorLeader: true,
        newsCrowdingScore: 0.5,
      },
    });
    const sectorText = formatGate2SectorCycleCompactDiagnostic(result.gateLayerSummary?.gate2.externalDataCoverage);
    const leaderText = formatGate2LeaderCycleCompactDiagnostic(result.gateLayerSummary?.gate2.externalDataCoverage);

    expect(sectorText).toContain('Gate2 Sector Cycle: VERIFIED');
    expect(sectorText).toContain('sector=Internet Platform');
    expect(sectorText).toContain('marketSignal=false');
    expect(leaderText).toContain('Gate2 Leader Cycle: VERIFIED');
    expect(leaderText).toContain('phase=MID_LEADER');
    expect(leaderText).toContain('attention=GROWING');
    expect(leaderText).toContain('marketSignal=false');
  });
});
