// @responsibility Gate2 external financial projection safety tests.

import { afterEach, describe, expect, it } from 'vitest';
import {
  buildGate2ExternalProjection,
  buildMissingGate2FinancialSnapshot,
  classifyGate2CorpCodeMissingForDiagnostics,
  fetchGate2PerValuation,
  refreshGate2ExternalData,
} from './gate2ExternalDataProvider.js';
import { setKisClientOverrides } from '../../clients/kisClient/overrides.js';

describe('Gate2ExternalDataProvider', () => {
  afterEach(() => {
    setKisClientOverrides({});
    delete process.env.KIS_APP_KEY;
    delete process.env.KIS_APP_SECRET;
  });

  it('projects DART missing as unavailable without execution impact', () => {
    const projection = buildGate2ExternalProjection({
      symbol: '005930',
      financialSnapshot: buildMissingGate2FinancialSnapshot('005930', 'DART_FINANCIALS_MISSING', '2026-05-24T00:00:00.000Z'),
      asOf: '2026-05-24T00:00:00.000Z',
    });

    expect(projection.financialSnapshot).toMatchObject({
      source: 'NONE',
      confidence: 'MISSING',
      providerIssue: true,
      marketSignal: false,
      executionImpact: 'NONE',
    });
    expect(projection.conditionResults.earnings_quality.status).toBe('UNAVAILABLE');
    expect(projection.conditionResults.per.status).toBe('UNAVAILABLE');
    expect(projection.highConvictionImpact).toBe('BLOCK_STRONG_BUY_UPGRADE');
    expect(projection.entryHardBlockImpact).toBe('NO');
    expect(projection.shadowObservablePreserved).toBe(true);
    expect(projection.counterfactualAllowed).toBe(true);
    expect(projection.executionImpact).toBe('NONE');
  });

  it('keeps profitability available when DART exists but PER is missing', () => {
    const projection = buildGate2ExternalProjection({
      symbol: '005930',
      dartFin: {
        symbol: '005930',
        corpCode: '00126380',
        reportDate: '2025-12-31',
        fiscalYear: '2025',
        quarter: 'ANNUAL',
        revenue: 1000,
        operatingIncome: 120,
        netIncome: 100,
        operatingCashFlow: 140,
        interestExpense: 20,
        totalEquity: 500,
        totalAssets: 900,
        ocfRatio: 1.4,
        roe: 0.2,
        opm: 0.12,
        opmYoYDelta: 0.02,
        revenueYoYGrowth: null,
        operatingIncomeYoYGrowth: null,
        marginAcceleration: 0.03,
        interestCoverageRatio: 6,
        source: 'DART',
        providerStatus: 'OK_WITH_DATA',
        dataConfidence: 'VERIFIED',
        providerIssue: false,
        marketSignal: false,
        executionImpact: 'DIAGNOSTIC_ONLY',
      },
      asOf: '2026-05-24T00:00:00.000Z',
    });

    expect(projection.financialSnapshot.confidence).toBe('VERIFIED');
    expect(projection.conditionResults.earnings_quality.status).toBe('PASS');
    expect(projection.conditionResults.roe.status).toBe('PASS');
    expect(projection.conditionResults.opm.status).toBe('PASS');
    expect(projection.conditionResults.icr.status).toBe('PASS');
    expect(projection.conditionResults.per.status).toBe('UNAVAILABLE');
    expect(projection.highConvictionImpact).toBe('BLOCK_STRONG_BUY_UPGRADE');
    expect(projection.executionImpact).toBe('NONE');
  });

  it('allows high conviction impact to clear only when all projected conditions are usable', () => {
    const projection = buildGate2ExternalProjection({
      symbol: '005930',
      per: 12,
      dartFin: {
        symbol: '005930',
        reportDate: '2025-12-31',
        fiscalYear: '2025',
        quarter: 'ANNUAL',
        revenue: 1000,
        operatingIncome: 120,
        netIncome: 100,
        operatingCashFlow: 140,
        interestExpense: 20,
        totalEquity: 500,
        totalAssets: 900,
        ocfRatio: 1.4,
        roe: 0.2,
        opm: 0.12,
        opmYoYDelta: 0.02,
        revenueYoYGrowth: null,
        operatingIncomeYoYGrowth: null,
        marginAcceleration: 0.03,
        interestCoverageRatio: 6,
        source: 'DART',
        providerStatus: 'OK_WITH_DATA',
        dataConfidence: 'VERIFIED',
        providerIssue: false,
        marketSignal: false,
        executionImpact: 'DIAGNOSTIC_ONLY',
      },
    });

    expect(projection.conditionResults.per.status).toBe('PASS');
    expect(projection.conditionResults.earnings_quality.status).toBe('PASS');
    expect(projection.highConvictionImpact).toBe('NONE');
    expect(projection.entryHardBlockImpact).toBe('NO');
  });

  it('classifies PER zero as unavailable instead of too high', () => {
    const projection = buildGate2ExternalProjection({
      symbol: '005930',
      per: 0,
      dartFin: {
        symbol: '005930',
        reportDate: '2025-12-31',
        fiscalYear: '2025',
        quarter: 'ANNUAL',
        revenue: 1000,
        operatingIncome: 120,
        netIncome: 100,
        operatingCashFlow: 140,
        interestExpense: 20,
        totalEquity: 500,
        totalAssets: 900,
        ocfRatio: 1.4,
        roe: 0.2,
        opm: 0.12,
        opmYoYDelta: 0.02,
        revenueYoYGrowth: null,
        operatingIncomeYoYGrowth: null,
        marginAcceleration: 0.03,
        interestCoverageRatio: 6,
        source: 'DART',
        providerStatus: 'OK_WITH_DATA',
        dataConfidence: 'VERIFIED',
        providerIssue: false,
        marketSignal: false,
        executionImpact: 'DIAGNOSTIC_ONLY',
      },
    });

    expect(projection.conditionResults.per).toMatchObject({
      status: 'UNAVAILABLE',
      value: null,
      source: 'KIS',
      reason: 'PER_NON_POSITIVE_OR_UNAVAILABLE',
      executionImpact: 'NONE',
    });
    expect(projection.valuation.per.per).toBe(0);
  });

  it('refreshes without throwing when DART data is missing', async () => {
    const result = await refreshGate2ExternalData({
      symbols: ['005930', '000660'],
      fetcher: async () => null,
      now: new Date('2026-05-24T00:00:00.000Z'),
    });

    expect(result).toMatchObject({
      refreshedCount: 2,
      verifiedCount: 0,
      missingCount: 2,
      strongBuyBlockedReason: 'DART_FINANCIALS_MISSING',
      executionImpact: 'NONE',
    });
    expect(result.rootCause).toBe('DART_CORP_CODE_CACHE_NOT_LOADED');
    expect(result.counters.corpCodeMissing).toBe(2);
    expect(result.counters.fiscalPeriodMissing).toBe(2);
    expect(result.counters.kisPerUnavailable).toBe(0);
    expect(result.counters.unavailableDueToCorpCodeMissing).toBe(10);
    expect(result.traces).toHaveLength(2);
    expect(result.providerHealth.executionImpact).toBe('NONE');
    expect(result.records.every(record => record.shadowObservablePreserved && record.counterfactualAllowed)).toBe(true);
  });

  it('projects injected PER valuation into refresh counters without live execution impact', async () => {
    const result = await refreshGate2ExternalData({
      symbols: ['005930', '000660'],
      fetcher: async (symbol) => ({
        symbol,
        corpCode: symbol === '005930' ? '00126380' : '00164779',
        reportDate: '2025-12-31',
        fiscalYear: '2025',
        quarter: 'ANNUAL',
        revenue: 1000,
        operatingIncome: 120,
        netIncome: 100,
        operatingCashFlow: 140,
        interestExpense: 20,
        totalEquity: 500,
        totalAssets: 900,
        ocfRatio: 1.4,
        roe: 0.2,
        opm: 0.12,
        opmYoYDelta: 0.02,
        revenueYoYGrowth: null,
        operatingIncomeYoYGrowth: null,
        marginAcceleration: 0.03,
        interestCoverageRatio: 6,
        source: 'DART',
        providerStatus: 'OK_WITH_DATA',
        dataConfidence: 'VERIFIED',
        providerIssue: false,
        marketSignal: false,
        executionImpact: 'DIAGNOSTIC_ONLY',
      }),
      perFetcher: async (symbol) => ({
        attempted: true,
        per: symbol === '005930' ? 12 : 18,
        eps: 5000,
        currentPrice: 60000,
        listedShares: 1000,
        source: 'KIS',
        reason: 'PER_ACCEPTABLE',
        raw: { per: '12.00', eps: '5000', stck_prpr: '60000' },
        dartEpsComputed: false,
        perComputedFromPriceAndEps: false,
        perCacheHit: false,
      }),
      now: new Date('2026-05-24T00:00:00.000Z'),
    });

    expect(result.verifiedCount).toBe(2);
    expect(result.unavailableCount).toBe(0);
    expect(result.strongBuyBlockedReason).toBe('NONE');
    expect(result.strongBuyBlockedDetails).toBe('NONE');
    expect(result.counters.kisPerAttempted).toBe(2);
    expect(result.counters.kisPerAvailable).toBe(2);
    expect(result.counters.kisPerUnavailable).toBe(0);
    expect(result.records.every(record => record.conditionResults.per.status === 'PASS')).toBe(true);
    expect(result.executionImpact).toBe('NONE');
  });

  it('classifies non-equity corpCode misses as DART not applicable', () => {
    const classified = classifyGate2CorpCodeMissingForDiagnostics({
      symbol: '123456',
      status: 'NOT_FOUND',
      instrumentType: 'KOSPI/ETF/테스트ETF',
      nonEquity: true,
    });

    expect(classified).toMatchObject({
      reason: 'DART_NOT_APPLICABLE',
      executionImpact: 'NONE',
    });
    expect(classified.instrumentType).toContain('ETF');
  });

  it('reads KIS inquire-price PER fields through the shared real-data client path', async () => {
    process.env.KIS_APP_KEY = 'test-app-key';
    process.env.KIS_APP_SECRET = 'test-app-secret';
    setKisClientOverrides({
      realDataKisGet: async () => ({
        output: {
          stck_prpr: '60000',
          per: '12.5',
          eps: '4800',
          lstn_stcn: '1000000',
        },
      }),
    });

    const result = await fetchGate2PerValuation({ symbol: '005930' });

    expect(result).toMatchObject({
      attempted: true,
      per: 12.5,
      eps: 4800,
      currentPrice: 60000,
      listedShares: 1000000,
      source: 'KIS',
      reason: 'PER_ACCEPTABLE',
    });
  });
});
