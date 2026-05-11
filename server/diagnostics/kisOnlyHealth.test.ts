import { describe, expect, it, vi } from 'vitest';
import {
  buildKisOnlyHealthReport,
  classifyKisRawParserStatus,
  formatKisOnlyHealthReport,
  type KisOnlyHealthFetchers,
} from './kisOnlyHealth.js';
import type { KisRawSupplyDiagnostic } from '../clients/kisClient/supplyDiagnostics.js';

function raw(zeroReason: KisRawSupplyDiagnostic['zeroReason'], ok = true, parsed: Record<string, number | null> = {}): KisRawSupplyDiagnostic {
  return {
    kind: 'INVESTOR_FLOW',
    code: '005930',
    ok,
    trId: 'T',
    path: '/kis-only-test',
    rootKeys: ['rt_cd', 'output'],
    outputPath: 'output',
    outputKeys: Object.keys(parsed),
    parsed,
    zeroReason,
    sample: {},
    rootSample: {},
  };
}

const baseFetchers = (): KisOnlyHealthFetchers => ({
  fetchCurrentPrice: vi.fn(async () => 70000),
  fetchPrevClose: vi.fn(async () => ({ stockCode: '005930', prevClose: 69000, tradingDate: '2026-05-11', fetchedAt: '2026-05-11T00:00:00.000Z' })),
  fetchDailyChart: vi.fn(async () => [{ date: '20260511', open: 1, high: 1, low: 1, close: 1, volume: 1 }]),
  fetchMarketSupply: vi.fn(async () => ({ foreignNetBuy: 10, institutionNetBuy: 20, individualNetBuy: -30 })),
  fetchInvestorFlow: vi.fn(async () => ({ foreignNetBuy: 100, institutionalNetBuy: 200, individualNetBuy: -300, source: 'KIS_API' as const })),
  fetchInvestorFlowDaily: vi.fn(async () => null),
  fetchForeignInstitutionTotal: vi.fn(async () => ({ foreignNetBuy: 100, institutionalNetBuy: 200, source: 'KIS_API' as const, fetchedAt: '2026-05-11T00:00:00.000Z' })),
  fetchStockProgramTrade: vi.fn(async () => ({ stockCode: '005930', programNetBuyQty: 1, programNetBuyAmount: 2, programBuyRatio: 3, source: 'KIS_API' as const, fetchedAt: '2026-05-11T00:00:00.000Z' })),
  fetchMarketProgramTrade: vi.fn(async () => ({ programNetBuyQty: 1, programNetBuyAmount: 2, programArbitrageNetBuy: 3, programNonArbitrageNetBuy: 4, programSellAmount: 5, programBuyAmount: 6, source: 'KIS_API' as const, fetchedAt: '2026-05-11T00:00:00.000Z' })),
  fetchShortSelling: vi.fn(async () => ({ stockCode: '005930', shortSaleQty: 1, shortSaleAmount: 2, shortSaleRatio: 0.1, shortSaleIncreaseRate: 1, trend: 'INCREASING' as const, source: 'KIS_API' as const, fetchedAt: '2026-05-11T00:00:00.000Z' })),
  fetchLoanTransaction: vi.fn(async () => ({ stockCode: '005930', loanBalanceQty: 0, loanBalanceAmount: 0, loanIncreaseRate: 0, trend: 'FLAT' as const, source: 'KIS_API' as const, fetchedAt: '2026-05-11T00:00:00.000Z' })),
  fetchCreditBalance: vi.fn(async () => ({ stockCode: '005930', creditBalanceQty: 0, creditBalanceAmount: 0, creditIncreaseRate: 0, trend: 'FLAT' as const, source: 'KIS_API' as const, fetchedAt: '2026-05-11T00:00:00.000Z' })),
  diagnoseInvestorFlowRaw: vi.fn(async () => raw('NON_ZERO', true, { foreignNetBuy: 100 })),
  diagnoseStockProgramRaw: vi.fn(async () => raw('NON_ZERO', true, { programNetBuyAmount: 2 })),
  diagnoseMarketProgramRaw: vi.fn(async () => raw('NON_ZERO', true, { programNetBuyAmount: 2 })),
  buildSectorBasket: vi.fn(async () => ({ basketRows: 12, validPriceCount: 48 })),
});

describe('kisOnlyHealth', () => {
  it('classifies raw parser outcomes without collapsing field mismatch into DATA_UNAVAILABLE', () => {
    expect(classifyKisRawParserStatus(raw('FIELD_MISSING'))).toBe('HTTP_OK_FIELD_MISMATCH');
    expect(classifyKisRawParserStatus(raw('OUTPUT_EMPTY'))).toBe('HTTP_OK_BUT_EMPTY');
    expect(classifyKisRawParserStatus(raw('SESSION_UNAVAILABLE'))).toBe('SESSION_UNAVAILABLE');
    expect(classifyKisRawParserStatus(raw('PARAM_ERROR'))).toBe('PARAM_ERROR');
    expect(classifyKisRawParserStatus(raw('NON_ZERO', true, { foreignNetBuy: 1 }))).toBe('HTTP_OK_MATERIALIZED');
  });

  it('materializes a KIS-only vertical health report from KIS fetchers only', async () => {
    const fetchers = baseFetchers();
    const report = await buildKisOnlyHealthReport({ targetCodes: ['005930'], now: new Date('2026-05-11T00:00:00.000Z'), fetchers });

    expect(report.mode).toBe('KIS_ONLY_REBUILD');
    expect(report.price.status).toBe('OK');
    expect(report.investorFlow.status).toBe('OK');
    expect(report.investorFlow.materializedCount).toBe(1);
    expect(report.program.stockProgram.status).toBe('OK');
    expect(report.program.marketProgram.status).toBe('OK');
    expect(report.shortCredit.loan).toBe('FLAT');
    expect(report.shortCredit.credit).toBe('FLAT');
    expect(report.executionImpact).toBe('NONE');
    expect(report.liveExecutionAllowed).toBe(false);
    expect(formatKisOnlyHealthReport(report)).toContain('Legacy Providers: disabled for current decision');
  });

  it('does not convert marketSupply into symbol investorFlow when symbol fields mismatch', async () => {
    const fetchers = baseFetchers();
    fetchers.fetchInvestorFlow = vi.fn(async () => null);
    fetchers.fetchInvestorFlowDaily = vi.fn(async () => null);
    fetchers.diagnoseInvestorFlowRaw = vi.fn(async () => raw('FIELD_MISSING'));

    const report = await buildKisOnlyHealthReport({ targetCodes: ['005930'], fetchers });

    expect(report.investorFlow.status).toBe('FIELD_MISMATCH');
    expect(report.investorFlow.materializedCount).toBe(0);
    expect(report.investorFlow.sampleRows.some((row) => row.sourceKind === 'KIS_MARKET_SUPPLY_DIAGNOSTIC_ONLY')).toBe(true);
    expect(report.investorFlow.sampleRows.find((row) => row.sourceKind === 'KIS_MARKET_SUPPLY_DIAGNOSTIC_ONLY')?.blockedReason)
      .toBe('marketSupply cannot become symbol investorFlow');
  });
});

describe('kisOnlyHealth endpoint-level trace', () => {
  it('does not increment fieldMismatch when output rows are absent and records endpoint reasons', async () => {
    const old = process.env.KIS_ONLY_TRACE;
    process.env.KIS_ONLY_TRACE = 'true';
    const fetchers = baseFetchers();
    fetchers.fetchInvestorFlow = vi.fn(async () => null);
    fetchers.fetchInvestorFlowDaily = vi.fn(async () => null);
    fetchers.diagnoseInvestorFlowRaw = vi.fn(async () => raw('OUTPUT_EMPTY', true, {}));
    fetchers.diagnoseInvestorEndpointTraces = vi.fn(async (code) => [
      { stockCode: code, sourceKind: 'INVESTOR_TRADE_BY_STOCK_DAILY', trId: 'T1', apiPath: '/daily', params: {}, httpCalled: true, rtCd: '0', msgCd: 'MCA00000', msg1: 'OK', outputPath: 'output', rowCount: 0, targetFound: false, outputKeys: [], parsedFields: [], materialized: false, blockedReason: 'HTTP_OK_BUT_EMPTY' },
      { stockCode: code, sourceKind: 'FOREIGN_INSTITUTION_TOTAL', trId: 'T2', apiPath: '/top', params: {}, httpCalled: true, rtCd: '0', msgCd: 'MCA00000', msg1: 'OK', outputPath: 'output', rowCount: 30, targetFound: false, outputKeys: ['mksc_shrn_iscd'], parsedFields: [], materialized: false, blockedReason: 'NOT_IN_TOP_LIST' },
    ]);

    const report = await buildKisOnlyHealthReport({ targetCodes: ['005930'], now: new Date('2026-05-11T00:30:00.000Z'), fetchers });

    expect(report.investorFlow.fieldMismatchCount).toBe(0);
    expect(report.investorFlow.reasonSummary?.INVESTOR_TRADE_BY_STOCK_DAILY.HTTP_OK_BUT_EMPTY).toBe(1);
    expect(report.investorFlow.reasonSummary?.FOREIGN_INSTITUTION_TOTAL.NOT_IN_TOP_LIST).toBe(1);
    expect(report.providerIssue).toBe(false);
    expect(report.executionImpact).toBe('NONE');
    process.env.KIS_ONLY_TRACE = old;
  });

  it('marks off-session program empties as session unavailable/expected empty without provider issue', async () => {
    const old = process.env.KIS_ONLY_TRACE;
    process.env.KIS_ONLY_TRACE = 'true';
    const fetchers = baseFetchers();
    fetchers.fetchStockProgramTrade = vi.fn(async () => null);
    fetchers.diagnoseStockProgramRaw = vi.fn(async () => raw('OUTPUT_EMPTY', true, {}));

    const report = await buildKisOnlyHealthReport({ targetCodes: ['005930'], now: new Date('2026-05-10T23:00:00.000Z'), fetchers });

    expect(['SESSION_UNAVAILABLE', 'EXPECTED_EMPTY_OFF_SESSION']).toContain(report.program.stockProgram.status);
    expect(report.program.stockProgram.currentSession).toBe('PRE_OPEN');
    expect(report.program.stockProgram.providerIssue).toBe(false);
    expect(report.providerIssue).toBe(false);
    process.env.KIS_ONLY_TRACE = old;
  });

  it('uses programMaterializer as market program parser source', async () => {
    const report = await buildKisOnlyHealthReport({ targetCodes: ['005930'], fetchers: baseFetchers() });
    expect(report.program.marketProgram.parserSource).toBe('programMaterializer');
  });

  it('tries short previous trading day, T-2, and T-3 before confirming missing', async () => {
    const old = process.env.KIS_ONLY_TRACE;
    process.env.KIS_ONLY_TRACE = 'true';
    const fetchers = baseFetchers();
    fetchers.fetchShortSelling = vi.fn(async () => null);
    fetchers.diagnoseShortDateTraces = vi.fn(async (_code, dates) => dates.map((date) => ({ stockCode: '005930', sourceKind: 'SHORT', trId: 'S', apiPath: '/short', params: {}, httpCalled: true, outputPath: 'output', rowCount: 0, targetFound: false, outputKeys: [], parsedFields: [], materialized: false, blockedReason: 'HTTP_OK_BUT_EMPTY', tradingDate: date })));

    const report = await buildKisOnlyHealthReport({ targetCodes: ['005930'], now: new Date('2026-05-11T00:00:00.000Z'), fetchers });

    expect(report.shortCredit.shortTrace?.triedDates).toEqual(['2026-05-08', '2026-05-07', '2026-05-06']);
    expect(report.shortCredit.short).toBe('MISSING_CONFIRMED');
    process.env.KIS_ONLY_TRACE = old;
  });
});
