// @responsibility KIS official supply pack aggregation and EnemyChecklist policy tests.
import { describe, expect, it, vi } from 'vitest';
import {
  evaluateKisSupplyEnemyChecklist,
  fetchKisOfficialSupplyPack,
  type KisOfficialSupplyPackFetchers,
} from './kisOfficialSupplyPack.js';

function fetchers(overrides: KisOfficialSupplyPackFetchers = {}): KisOfficialSupplyPackFetchers {
  return {
    fetchCurrentPrice: vi.fn(async () => null),
    fetchPrevClose: vi.fn(async () => null),
    fetchStockName: vi.fn(async () => null),
    fetchInvestorFlow: vi.fn(async () => null),
    fetchInvestorFlowDaily: vi.fn(async () => null),
    fetchInvestorFlowEstimate: vi.fn(async () => null),
    fetchForeignInstitutionTotal: vi.fn(async () => null),
    fetchShortSelling: vi.fn(async () => null),
    fetchLoanTransaction: vi.fn(async () => null),
    fetchCreditBalance: vi.fn(async () => null),
    fetchStockProgramTrade: vi.fn(async () => null),
    fetchMarketProgramTrade: vi.fn(async () => null),
    fetchMarketSupply: vi.fn(async () => null),
    fetchInvestorDailyByMarket: vi.fn(async () => null),
    fetchInvestorTimeByMarket: vi.fn(async () => null),
    ...overrides,
  };
}

describe('fetchKisOfficialSupplyPack', () => {
  it('aggregates price, investor flow, program, short, loan, credit as official source without live impact', async () => {
    const pack = await fetchKisOfficialSupplyPack('5930', new Date('2026-05-11T01:00:00.000Z'), fetchers({
      fetchCurrentPrice: vi.fn(async () => 70000),
      fetchPrevClose: vi.fn(async () => ({ stockCode: '005930', prevClose: 69000, tradingDate: '2026-05-08', fetchedAt: '2026-05-11T00:59:00.000Z' })),
      fetchStockName: vi.fn(async () => '삼성전자'),
      fetchInvestorFlowDaily: vi.fn(async () => ({
        stockCode: '005930',
        tradingDate: '2026-05-08',
        foreignNetBuy: 10,
        institutionalNetBuy: 20,
        individualNetBuy: -30,
        source: 'KIS_API' as const,
        fetchedAt: '2026-05-11T00:59:00.000Z',
      })),
      fetchShortSelling: vi.fn(async () => ({
        stockCode: '005930',
        shortSaleAmount: 130,
        shortSaleIncreaseRate: 31,
        trend: 'INCREASING' as const,
        source: 'KIS_API' as const,
        fetchedAt: '2026-05-11T00:59:00.000Z',
      })),
      fetchLoanTransaction: vi.fn(async () => ({
        stockCode: '005930',
        loanBalanceQty: 140,
        loanIncreaseRate: 41,
        trend: 'INCREASING' as const,
        source: 'KIS_API' as const,
        fetchedAt: '2026-05-11T00:59:00.000Z',
      })),
      fetchCreditBalance: vi.fn(async () => ({
        stockCode: '005930',
        creditBalanceQty: 150,
        creditIncreaseRate: 51,
        trend: 'INCREASING' as const,
        source: 'KIS_API' as const,
        fetchedAt: '2026-05-11T00:59:00.000Z',
      })),
      fetchStockProgramTrade: vi.fn(async () => ({
        stockCode: '005930',
        programNetBuyQty: 100,
        programNetBuyAmount: 1_000_000,
        programBuyRatio: null,
        source: 'KIS_API' as const,
        fetchedAt: '2026-05-11T00:59:00.000Z',
      })),
    }));

    expect(pack.stockCode).toBe('005930');
    expect(pack.officialSource).toBe(true);
    expect(pack.price).toMatchObject({ currentPrice: 70000, confidence: 'VERIFIED', useScope: 'WEIGHTED' });
    expect(pack.investorFlowDaily).toMatchObject({ hasRealFields: true, confidence: 'VERIFIED', useScope: 'WEIGHTED' });
    expect(pack.shortSelling?.shortSaleIncreaseRate).toBe(31);
    expect(pack.loanTransaction?.loanIncreaseRate).toBe(41);
    expect(pack.creditBalance?.creditIncreaseRate).toBe(51);
    expect(pack.providerIssue).toBe(false);
    expect(pack.marketSignal).toBe(false);
    expect(pack.liveExecutionAllowed).toBe(false);
    expect(pack.executionImpact).toBe('NONE');
    expect(pack.diagnostics.join(' ')).toContain('rawPayloadPersistenceAllowed=false');
    expect(pack.learningTags).toEqual(expect.arrayContaining([
      'CASE_KIS_PRICE_PRIMARY',
      'CASE_KIS_INVESTOR_FLOW_VERIFIED',
      'CASE_KIS_SHORT_SELLING_RISK',
      'CASE_KIS_LOAN_BALANCE_RISK',
      'CASE_KIS_CREDIT_BALANCE_RISK',
    ]));
  });

  it('missing investor fields remain DATA_UNAVAILABLE and are not bearish', async () => {
    const pack = await fetchKisOfficialSupplyPack('005930', new Date('2026-05-11T01:00:00.000Z'), fetchers());

    expect(pack.investorFlowDaily).toMatchObject({
      hasRealFields: false,
      confidence: 'MISSING',
      useScope: 'DIAGNOSTIC_ONLY',
    });
    expect(pack.providerIssue).toBe(true);
    expect(pack.marketSignal).toBe(false);
    expect(pack.diagnostics.join(' ')).toContain('investorFlowDaily=DATA_UNAVAILABLE');
    expect(pack.learningTags).toContain('CASE_KIS_INVESTOR_FLOW_MISSING_FIELDS');
  });
});

describe('evaluateKisSupplyEnemyChecklist', () => {
  it('two risk signals forbid StrongBuy but do not force new-buy block', () => {
    const decision = evaluateKisSupplyEnemyChecklist({
      stockCode: '005930',
      provider: 'KIS_API',
      officialSource: true,
      fetchedAt: '2026-05-11T01:00:00.000Z',
      shortSelling: { shortSaleIncreaseRate: 35, trend: 'INCREASING', confidence: 'VERIFIED', useScope: 'ADVISORY' },
      loanTransaction: { loanIncreaseRate: 40, trend: 'INCREASING', confidence: 'VERIFIED', useScope: 'ADVISORY' },
      providerIssue: false,
      marketSignal: false,
      liveExecutionAllowed: false,
      executionImpact: 'NONE',
      diagnostics: [],
      learningTags: [],
    });

    expect(decision.warningCount).toBe(2);
    expect(decision.strongBuyAllowed).toBe(false);
    expect(decision.newBuyAllowed).toBe(true);
    expect(decision.shadowOnly).toBe(false);
  });

  it('three risk signals recommend Shadow only', () => {
    const decision = evaluateKisSupplyEnemyChecklist({
      stockCode: '005930',
      provider: 'KIS_API',
      officialSource: true,
      fetchedAt: '2026-05-11T01:00:00.000Z',
      shortSelling: { shortSaleIncreaseRate: 35, confidence: 'VERIFIED', useScope: 'ADVISORY' },
      loanTransaction: { loanIncreaseRate: 40, confidence: 'VERIFIED', useScope: 'ADVISORY' },
      creditBalance: { creditIncreaseRate: 50, confidence: 'VERIFIED', useScope: 'ADVISORY' },
      providerIssue: false,
      marketSignal: false,
      liveExecutionAllowed: false,
      executionImpact: 'NONE',
      diagnostics: [],
      learningTags: [],
    });

    expect(decision.warningCount).toBe(3);
    expect(decision.newBuyAllowed).toBe(false);
    expect(decision.shadowOnly).toBe(true);
  });
});
