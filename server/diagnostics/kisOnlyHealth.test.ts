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
