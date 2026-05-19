// @responsibility Gate2 diagnostic-only consolidated regression fixtures and snapshots.

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONDITION_WEIGHTS,
  evaluateServerGate,
  type GateLayerSummary,
  type ServerGateResult,
} from '../quantFilter.js';
import {
  normalizeBenchmarkReturnForGate2,
  type BenchmarkMarket,
  type QmpBenchmarkReturn,
} from '../clients/benchmarkReturnNormalizer.js';
import { normalizeDartFinancials, type QmpDartFinancials } from '../clients/dartFinancialNormalizer.js';
import { normalizeKisInvestorFlow, type QmpInvestorFlow } from '../clients/kisClient/kisOfficialInvestorFlowMapper.js';
import { normalizeKisProgramFlow, type QmpProgramFlow } from '../clients/kisClient/kisOfficialProgramFlowMapper.js';
import type { YahooQuoteExtended } from '../screener/stockScreener.js';
import type { Gate2ConsolidatedDiagnostic, Gate2EvaluationStage } from './gate2Diagnostics.js';

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
    return5d: 0.05,
    return20d: 0.12,
    ma5: 110,
    ma20: 100,
    ma60: 90,
    ma60TrendUp: true,
    weeklyRSI: 55,
    volume: 500_000,
    avgVolume: 300_000,
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
    symbol: '005930',
    market: 'KOSPI',
    ...overrides,
  } as YahooQuoteExtended;
}

function bullishKisFlow(): QmpInvestorFlow {
  return normalizeKisInvestorFlow({
    symbol: '005930',
    endpointKey: 'INQUIRE_INVESTOR',
    raw: {
      output: [{
        stck_bsop_date: '20260519',
        frgn_ntby_qty: '1200000000',
        orgn_ntby_qty: '800000000',
        prsn_ntby_qty: '-2000000000',
      }],
    },
    fetchedAt: '2026-05-19T09:31:00+09:00',
  });
}

function bullishDartFin(overrides: Partial<QmpDartFinancials> = {}): QmpDartFinancials {
  return {
    ...normalizeDartFinancials({
      symbol: '005930',
      reportDate: '2026-05-19',
      raw: {
        revenue: '1000000000000',
        operatingIncome: '123000000000',
        netIncome: '100000000000',
        operatingCashFlow: '140000000000',
        interestExpense: '14642857143',
        totalEquity: '537634408602',
      },
    }),
    ...overrides,
  };
}

function positiveStockProgram(): QmpProgramFlow {
  return normalizeKisProgramFlow({
    symbol: '005930',
    endpointKey: 'PROGRAM_TRADE_BY_STOCK_DAILY',
    raw: {
      output: [{
        stck_bsop_date: '20260519',
        whol_smtn_ntby_tr_pbmn: '420000000',
        whol_smtn_ntby_qty: '12000',
      }],
    },
    fetchedAt: '2026-05-19T09:31:00+09:00',
  });
}

function marketProgram(): QmpProgramFlow {
  return normalizeKisProgramFlow({
    endpointKey: 'COMP_PROGRAM_TRADE_TODAY',
    raw: {
      output: [{ whol_smtn_ntby_tr_pbmn: '1000000000' }],
    },
  });
}

function lowRiskFlow() {
  return {
    provider: 'QMP_CACHE',
    status: 'VERIFIED',
    interpretation: {
      shortPressure: 'LOW',
      loanPressure: 'LOW',
      creditOverheat: 'LOW',
      overallRisk: 'LOW',
    },
  };
}

function highRiskFlow() {
  return {
    provider: 'QMP_CACHE',
    status: 'VERIFIED',
    interpretation: {
      shortPressure: 'HIGH',
      loanPressure: 'LOW',
      creditOverheat: 'HIGH',
      overallRisk: 'HIGH',
    },
    shortSaleIncreaseRate: 31,
    creditBalanceRatio: 9,
  };
}

function leaderSector(overrides: Record<string, unknown> = {}) {
  return {
    sector: 'Semiconductor',
    industry: 'Memory',
    themeTags: ['AI', 'HBM'],
    sectorReturn20d: 0.08,
    benchmarkReturn20d: 0.03,
    isCurrentLeadingSector: true,
    isSectorLeader: true,
    isPreviousCycleLeader: false,
    leaderCyclePhase: 'MID_LEADER',
    newsFrequency30d: 8,
    newsCrowdingScore: 0.45,
    source: 'KRX_SECTOR_INDEX',
    ...overrides,
  };
}

function evaluateGate2(input: {
  quote?: YahooQuoteExtended;
  kisFlow?: QmpInvestorFlow | null;
  dartFin?: QmpDartFinancials | null;
  kospi20dReturn?: number | null;
  kosdaq20dReturn?: number | null;
  market?: BenchmarkMarket | string | null;
  benchmarkReturn?: QmpBenchmarkReturn | null;
  programTrade?: { marketProgram?: QmpProgramFlow | null; stockProgram?: QmpProgramFlow | null } | null;
  riskFlow?: unknown;
  sectorThemeCycle?: Record<string, unknown> | null;
  evaluationStage?: Gate2EvaluationStage | null;
} = {}): ServerGateResult {
  return evaluateServerGate(
    input.quote ?? gate2Quote(),
    DEFAULT_CONDITION_WEIGHTS,
    input.kospi20dReturn,
    (input.dartFin === undefined ? bullishDartFin() : input.dartFin) as never,
    (input.kisFlow === undefined ? bullishKisFlow() : input.kisFlow) as never,
    undefined,
    input.evaluationStage,
    {
      kosdaq20dReturn: input.kosdaq20dReturn,
      market: input.market,
      benchmarkReturn: input.benchmarkReturn,
      programTrade: input.programTrade,
      riskFlow: input.riskFlow,
      sectorThemeCycle: input.sectorThemeCycle,
    },
  );
}

function gate2AllVerifiedBullishFixture(): ServerGateResult {
  return evaluateGate2({
    evaluationStage: 'ENTRY_RECHECK_GATE',
    kospi20dReturn: 0.03,
    programTrade: { stockProgram: positiveStockProgram() },
    riskFlow: lowRiskFlow(),
    sectorThemeCycle: leaderSector(),
  });
}

function gate2DiscoveryStageNotFetchedFixture(): ServerGateResult {
  return evaluateGate2({
    quote: gate2Quote({ return20d: 0.12 }),
    evaluationStage: 'DISCOVERY_GATE',
    kisFlow: null,
    dartFin: null,
    kospi20dReturn: null,
    kosdaq20dReturn: null,
    programTrade: null,
    riskFlow: null,
    sectorThemeCycle: null,
  });
}

function gate2KisMissingFixture(): ServerGateResult {
  return evaluateGate2({
    evaluationStage: 'ENTRY_RECHECK_GATE',
    kisFlow: null,
    kospi20dReturn: 0.03,
    programTrade: { stockProgram: positiveStockProgram() },
    riskFlow: lowRiskFlow(),
    sectorThemeCycle: leaderSector(),
  });
}

function gate2DartMissingFixture(): ServerGateResult {
  return evaluateGate2({
    evaluationStage: 'ENTRY_RECHECK_GATE',
    dartFin: null,
    kospi20dReturn: 0.03,
    programTrade: { stockProgram: positiveStockProgram() },
    riskFlow: lowRiskFlow(),
    sectorThemeCycle: leaderSector(),
  });
}

function gate2BenchmarkMissingFixture(): ServerGateResult {
  return evaluateGate2({
    evaluationStage: 'ENTRY_RECHECK_GATE',
    kospi20dReturn: null,
    kosdaq20dReturn: null,
    programTrade: { stockProgram: positiveStockProgram() },
    riskFlow: lowRiskFlow(),
    sectorThemeCycle: leaderSector(),
  });
}

function gate2KosdaqFallbackWarningFixture(): ServerGateResult {
  return evaluateGate2({
    quote: gate2Quote({ symbol: '035720', market: 'KOSDAQ', return20d: 0.18 } as QuotePatch),
    evaluationStage: 'ENTRY_RECHECK_GATE',
    market: 'KOSDAQ',
    kospi20dReturn: 0.03,
    kosdaq20dReturn: null,
    programTrade: { stockProgram: positiveStockProgram() },
    riskFlow: lowRiskFlow(),
    sectorThemeCycle: leaderSector({ sector: 'Internet Platform', market: 'KOSDAQ' }),
  });
}

function gate2ProgramScopeMismatchFixture(): ServerGateResult {
  return evaluateGate2({
    evaluationStage: 'ENTRY_RECHECK_GATE',
    kospi20dReturn: 0.03,
    programTrade: { stockProgram: marketProgram() },
    riskFlow: lowRiskFlow(),
    sectorThemeCycle: leaderSector(),
  });
}

function gate2RiskHighDiagnosticOnlyFixture(): ServerGateResult {
  return evaluateGate2({
    evaluationStage: 'ENTRY_RECHECK_GATE',
    kospi20dReturn: 0.03,
    programTrade: { stockProgram: positiveStockProgram() },
    riskFlow: highRiskFlow(),
    sectorThemeCycle: leaderSector(),
  });
}

function gate2SectorCrowdedDiagnosticOnlyFixture(): ServerGateResult {
  return evaluateGate2({
    evaluationStage: 'ENTRY_RECHECK_GATE',
    kospi20dReturn: 0.03,
    programTrade: { stockProgram: positiveStockProgram() },
    riskFlow: lowRiskFlow(),
    sectorThemeCycle: leaderSector({
      leaderCyclePhase: 'LATE_CROWDED',
      newsCrowdingScore: 0.82,
      newsFrequency30d: 28,
    }),
  });
}

function gate2SignalConflictFixture(): ServerGateResult {
  return evaluateGate2({
    quote: gate2Quote({ return20d: -0.02 } as QuotePatch),
    evaluationStage: 'ENTRY_RECHECK_GATE',
    kospi20dReturn: 0.08,
    programTrade: { stockProgram: positiveStockProgram() },
    riskFlow: lowRiskFlow(),
    sectorThemeCycle: leaderSector(),
  });
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

function sanitizeGate2DiagnosticForSnapshot(gate2: GateLayerSummary['gate2']) {
  const external = gate2.externalDataCoverage!;
  const consolidated = gate2.consolidatedDiagnostic! as Gate2ConsolidatedDiagnostic;
  return {
    sourceCoverage: gate2.sourceCoverage,
    externalDataCoverage: {
      kisInvestorFlow: {
        status: external.kisInvestorFlow.status,
        fields: external.kisInvestorFlow.fields,
        missingFields: external.kisInvestorFlow.missingFields,
        providerIssue: external.kisInvestorFlow.providerIssue,
        marketSignal: external.kisInvestorFlow.marketSignal,
      },
      dartFinancials: {
        status: external.dartFinancials.status,
        fields: external.dartFinancials.fields,
        missingFields: external.dartFinancials.missingFields,
        providerIssue: external.dartFinancials.providerIssue,
        marketSignal: external.dartFinancials.marketSignal,
      },
      benchmark: {
        status: external.benchmark.status,
        benchmarkKey: external.benchmark.benchmarkKey,
        values: external.benchmark.values,
        missingFields: external.benchmark.missingFields,
        notes: external.benchmark.notes,
        providerIssue: external.benchmark.providerIssue,
        marketSignal: external.benchmark.marketSignal,
      },
      programTrade: {
        stockStatus: external.programTrade.stockProgram.status,
        marketStatus: external.programTrade.marketProgram.status,
        scopeSeparationValid: external.programTrade.scopeSeparationValid,
        notes: external.programTrade.notes,
        marketSignal: external.programTrade.marketSignal,
      },
      riskFlow: {
        status: external.riskFlow.status,
        interpretation: external.riskFlow.interpretation,
        providerIssue: external.riskFlow.providerIssue,
        marketSignal: external.riskFlow.marketSignal,
      },
      sectorCycle: {
        status: external.sectorCycle.status,
        leaderCyclePhase: external.leaderCycle.leaderCyclePhase,
        attentionPhase: external.leaderCycle.attentionPhase,
        providerIssue: external.sectorCycle.providerIssue,
        marketSignal: external.sectorCycle.marketSignal,
      },
    },
    consolidatedDiagnostic: {
      health: consolidated.health,
      primaryIssue: consolidated.primaryIssue,
      operatorAction: consolidated.operatorAction,
      dataReadiness: consolidated.dataReadiness,
      signalAlignment: consolidated.signalAlignment,
      conflictFlags: consolidated.conflictFlags,
      missingCriticalData: consolidated.missingCriticalData,
      providerIssues: consolidated.providerIssues,
      marketSignal: consolidated.marketSignal,
      providerIssue: consolidated.providerIssue,
      compactText: consolidated.compactText,
    },
  };
}

function expectNoMarketSignalTrue(value: unknown): void {
  expect(JSON.stringify(value)).not.toContain('"marketSignal":true');
}

describe('Gate2 consolidated diagnostic regression fixtures', () => {
  it('locks all verified bullish alignment without changing core decisions', () => {
    const result = gate2AllVerifiedBullishFixture();
    const gate2 = result.gateLayerSummary!.gate2;

    expect(gate2.sourceCoverage).toMatchObject({
      allDeclaredInputsAvailable: true,
      allExternalDataAvailable: true,
    });
    expect(gate2.externalDataCoverage).toMatchObject({
      kisInvestorFlow: { status: 'VERIFIED' },
      dartFinancials: { status: 'VERIFIED' },
      benchmark: { status: 'VERIFIED' },
    });
    expect(gate2.consolidatedDiagnostic).toMatchObject({
      health: 'OK',
      primaryIssue: null,
      operatorAction: 'NONE',
      signalAlignment: {
        supply: 'BULLISH',
        financials: 'BULLISH',
        relativeStrength: 'BULLISH',
      },
      marketSignal: false,
    });
    const diagnostic = gate2.consolidatedDiagnostic as Gate2ConsolidatedDiagnostic;
    expect(diagnostic.compactText).toContain('Gate2: OK');
    expect(diagnostic.sections.kis).toEqual(expect.arrayContaining(['alignment=BULLISH', 'marketSignal=false']));
    expect(diagnostic.telegramText.split('\n').length).toBeLessThanOrEqual(10);
    expectNoMarketSignalTrue(gate2);
  });

  it('separates discovery stage-not-fetched from provider degradation', () => {
    const result = gate2DiscoveryStageNotFetchedFixture();
    const gate2 = result.gateLayerSummary!.gate2;

    expect(gate2.externalDataCoverage).toMatchObject({
      kisInvestorFlow: { status: 'STAGE_NOT_FETCHED', providerIssue: false },
      dartFinancials: { status: 'STAGE_NOT_FETCHED', providerIssue: false },
      benchmark: { status: 'STAGE_NOT_FETCHED', providerIssue: false },
    });
    expect(gate2.consolidatedDiagnostic).toMatchObject({
      health: 'STAGE_NOT_FETCHED',
      primaryIssue: 'DISCOVERY_STAGE_EXTERNAL_DATA_NOT_FETCHED',
      operatorAction: 'WAIT_FOR_ENTRY_RECHECK',
      marketSignal: false,
      providerIssue: false,
    });
  });

  it('reports KIS missing without converting supply to bearish', () => {
    const result = gate2KisMissingFixture();
    const gate2 = result.gateLayerSummary!.gate2;

    expect(gate2.externalDataCoverage?.kisInvestorFlow.status).toBe('MISSING');
    expect(gate2.wiring?.find(item => item.key === 'supply_confluence')).toMatchObject({
      missingExternalData: ['KIS_INVESTOR_FLOW'],
      marketSignal: false,
    });
    expect(gate2.consolidatedDiagnostic).toMatchObject({
      health: 'DEGRADED',
      primaryIssue: 'KIS_INVESTOR_FLOW_UNAVAILABLE',
      operatorAction: 'CHECK_KIS_INVESTOR_FLOW',
      signalAlignment: { supply: 'UNAVAILABLE' },
      marketSignal: false,
    });
  });

  it('reports DART missing without converting financials to bearish', () => {
    const result = gate2DartMissingFixture();
    const gate2 = result.gateLayerSummary!.gate2;

    expect(gate2.externalDataCoverage?.dartFinancials.status).toBe('MISSING');
    expect(gate2.wiring?.find(item => item.key === 'earnings_quality')).toMatchObject({
      missingExternalData: ['DART_FINANCIALS'],
      marketSignal: false,
    });
    expect(gate2.consolidatedDiagnostic).toMatchObject({
      health: 'DATA_INCOMPLETE',
      primaryIssue: 'DART_FINANCIALS_UNAVAILABLE',
      operatorAction: 'CHECK_DART_FINANCIALS',
      signalAlignment: { financials: 'UNAVAILABLE' },
      marketSignal: false,
    });
  });

  it('reports benchmark missing without converting relative strength to bearish', () => {
    const result = gate2BenchmarkMissingFixture();
    const gate2 = result.gateLayerSummary!.gate2;

    expect(gate2.externalDataCoverage?.benchmark.status).toBe('MISSING');
    expect(gate2.wiring?.find(item => item.key === 'relative_strength')).toMatchObject({
      missingExternalData: ['BENCHMARK_20D_RETURN'],
      marketSignal: false,
    });
    expect(gate2.consolidatedDiagnostic).toMatchObject({
      health: 'DATA_INCOMPLETE',
      primaryIssue: 'BENCHMARK_UNAVAILABLE',
      operatorAction: 'CHECK_BENCHMARK_PROVIDER',
      signalAlignment: { relativeStrength: 'UNAVAILABLE' },
      marketSignal: false,
    });
  });

  it('preserves KOSDAQ fallback warning as diagnostic-only', () => {
    const normal = evaluateGate2({
      quote: gate2Quote({ symbol: '035720', market: 'KOSDAQ', return20d: 0.18 } as QuotePatch),
      market: 'KOSDAQ',
      kospi20dReturn: 0.03,
      programTrade: { stockProgram: positiveStockProgram() },
      riskFlow: lowRiskFlow(),
      sectorThemeCycle: leaderSector({ sector: 'Internet Platform', market: 'KOSDAQ' }),
    });
    const result = gate2KosdaqFallbackWarningFixture();
    const benchmark = result.gateLayerSummary?.gate2.externalDataCoverage?.benchmark;

    expect(pickCoreDecisionFields(result)).toEqual(pickCoreDecisionFields(normal));
    expect(benchmark?.notes).toEqual(expect.arrayContaining([
      'KOSDAQ_BENCHMARK_MISSING_KOSPI_FALLBACK_DIAGNOSTIC_ONLY',
      'SYMBOL_MARKET_KOSDAQ_BUT_CURRENT_FORMULA_USES_KOSPI_BENCHMARK_FALLBACK',
    ]));
    expect(benchmark?.marketSignal).toBe(false);
  });

  it('reports program scope mismatch without changing score semantics', () => {
    const normal = gate2AllVerifiedBullishFixture();
    const result = gate2ProgramScopeMismatchFixture();
    const gate2 = result.gateLayerSummary!.gate2;

    expect(pickCoreDecisionFields(result)).toEqual(pickCoreDecisionFields(normal));
    expect(gate2.externalDataCoverage?.programTrade.scopeSeparationValid).toBe(false);
    expect(gate2.consolidatedDiagnostic).toMatchObject({
      health: 'DEGRADED',
      primaryIssue: 'PROGRAM_FLOW_SCOPE_MISMATCH',
      operatorAction: 'CHECK_PROGRAM_FLOW_SCOPE',
      marketSignal: false,
    });
  });

  it('keeps high riskFlow diagnostic-only without hard blocking', () => {
    const normal = gate2AllVerifiedBullishFixture();
    const result = gate2RiskHighDiagnosticOnlyFixture();
    const gate2 = result.gateLayerSummary!.gate2;

    expect(pickCoreDecisionFields(result)).toEqual(pickCoreDecisionFields(normal));
    expect(gate2.consolidatedDiagnostic).toMatchObject({
      health: 'WARN',
      primaryIssue: 'RISK_FLOW_WARNING',
      operatorAction: 'CHECK_RISK_FLOW_PROVIDER',
      signalAlignment: { riskFlow: 'RISK_HIGH' },
      marketSignal: false,
    });
  });

  it('keeps sector crowded diagnostic-only without score deduction', () => {
    const normal = gate2AllVerifiedBullishFixture();
    const result = gate2SectorCrowdedDiagnosticOnlyFixture();
    const gate2 = result.gateLayerSummary!.gate2;

    expect(pickCoreDecisionFields(result)).toEqual(pickCoreDecisionFields(normal));
    expect(gate2.consolidatedDiagnostic).toMatchObject({
      health: 'WARN',
      primaryIssue: 'SECTOR_CYCLE_WARNING',
      operatorAction: 'CHECK_SECTOR_MAP',
      signalAlignment: { sectorCycle: 'CROWDED' },
      marketSignal: false,
    });
  });

  it('reports signal conflict without changing the current decision policy', () => {
    const result = gate2SignalConflictFixture();
    const gate2 = result.gateLayerSummary!.gate2;

    expect(gate2.consolidatedDiagnostic).toMatchObject({
      health: 'CONFLICT',
      operatorAction: 'REVIEW_SIGNAL_CONFLICT',
      signalAlignment: {
        supply: 'BULLISH',
        financials: 'BULLISH',
        relativeStrength: 'BEARISH',
      },
      marketSignal: false,
    });
    const diagnostic = gate2.consolidatedDiagnostic as Gate2ConsolidatedDiagnostic;
    expect(diagnostic.conflictFlags).toContain('RS_CONFLICT');
  });

  it('does not replace null benchmark and financial values with zero', () => {
    const benchmark = normalizeBenchmarkReturnForGate2({
      symbol: '005930',
      market: 'KOSPI',
      stockReturn20d: null,
      kospi20dReturn: 0,
    });
    const emptyDart = normalizeDartFinancials({
      symbol: '005930',
      raw: { netIncome: '0', operatingCashFlow: null },
    });

    expect(benchmark.stockReturn).toBeNull();
    expect(benchmark.benchmarkReturn).toBe(0);
    expect(benchmark.relativeReturn).toBeNull();
    expect(emptyDart.ocfRatio).toBeNull();
  });

  it('snapshots sanitized Gate2 diagnostic fixture core fields', () => {
    const snapshots = {
      allVerifiedBullish: sanitizeGate2DiagnosticForSnapshot(gate2AllVerifiedBullishFixture().gateLayerSummary!.gate2),
      discoveryStageNotFetched: sanitizeGate2DiagnosticForSnapshot(gate2DiscoveryStageNotFetchedFixture().gateLayerSummary!.gate2),
      kisMissing: sanitizeGate2DiagnosticForSnapshot(gate2KisMissingFixture().gateLayerSummary!.gate2),
      benchmarkMissing: sanitizeGate2DiagnosticForSnapshot(gate2BenchmarkMissingFixture().gateLayerSummary!.gate2),
      programScopeMismatch: sanitizeGate2DiagnosticForSnapshot(gate2ProgramScopeMismatchFixture().gateLayerSummary!.gate2),
      riskHigh: sanitizeGate2DiagnosticForSnapshot(gate2RiskHighDiagnosticOnlyFixture().gateLayerSummary!.gate2),
      sectorCrowded: sanitizeGate2DiagnosticForSnapshot(gate2SectorCrowdedDiagnosticOnlyFixture().gateLayerSummary!.gate2),
    };

    expect(snapshots).toMatchSnapshot();
  });
});
