// @responsibility Gate2 external financial projection safety tests.

import { describe, expect, it } from 'vitest';
import {
  buildGate2ExternalProjection,
  buildMissingGate2FinancialSnapshot,
  refreshGate2ExternalData,
} from './gate2ExternalDataProvider.js';

describe('Gate2ExternalDataProvider', () => {
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
    expect(result.records.every(record => record.shadowObservablePreserved && record.counterfactualAllowed)).toBe(true);
  });
});
