// @responsibility Gate2 external financial projection safety tests.

import { afterEach, describe, expect, it } from 'vitest';
import {
  buildGate2ExternalProjection,
  buildMissingGate2FinancialSnapshot,
  classifyGate2CorpCodeMissingForDiagnostics,
  fetchGate2PerValuation,
  getGate2DartFinancialsForEvaluation,
  projectionToQmpDartFinancials,
  refreshGate2ExternalData,
} from './gate2ExternalDataProvider.js';
import { getGate2ExternalCacheRecord, upsertGate2ExternalCacheRecords } from './gate2ExternalCache.js';
import type { Gate2DartEvaluationFinancials } from './gate2ExternalDataProvider/types.js';
import { setKisClientOverrides } from '../../clients/kisClient/overrides.js';

describe('Gate2ExternalDataProvider', () => {
  afterEach(() => {
    setKisClientOverrides({});
    delete process.env.KIS_APP_KEY;
    delete process.env.KIS_APP_SECRET;
    delete process.env.KIS_FINANCE_PRIMARY_ENABLED;
    delete process.env.DART_API_KEY;
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

  it('classifies EPS non-positive as a valuation fail rather than provider missing', () => {
    const projection = buildGate2ExternalProjection({
      symbol: '005930',
      per: null,
      perSource: 'KIS',
      perReason: 'EPS_NON_POSITIVE',
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
      status: 'FAIL',
      value: null,
      source: 'KIS',
      reason: 'EPS_NON_POSITIVE',
      executionImpact: 'NONE',
    });
    expect(projection.unavailableCount).toBe(0);
    expect(projection.highConvictionImpact).toBe('BLOCK_STRONG_BUY_UPGRADE');
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

  it('splits negative EPS from provider-missing PER in refresh quality buckets', async () => {
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
      perFetcher: async (symbol) => symbol === '005930'
        ? {
          attempted: true,
          per: null,
          eps: -100,
          currentPrice: 60000,
          listedShares: 1000,
          source: 'KIS',
          reason: 'EPS_NON_POSITIVE',
          raw: { eps: '-100', stck_prpr: '60000' },
          dartEpsComputed: false,
          perComputedFromPriceAndEps: false,
          perCacheHit: false,
        }
        : {
          attempted: true,
          per: null,
          eps: null,
          currentPrice: 60000,
          listedShares: 1000,
          source: 'KIS',
          reason: 'KIS_PER_OUTPUT_MISSING',
          raw: {},
          dartEpsComputed: false,
          perComputedFromPriceAndEps: false,
          perCacheHit: false,
        },
      now: new Date('2026-05-24T00:00:00.000Z'),
    });

    expect(result.verifiedCount).toBe(2);
    expect(result.counters.kisPerUnavailable).toBe(2);
    expect(result.counters.perFailDueToNegativeEps).toBe(1);
    expect(result.counters.perUnavailableDueToNegativeEps).toBe(1);
    expect(result.counters.perUnavailableDueToProviderMissing).toBe(1);
    expect(result.counters.unavailableDueToPER).toBe(1);
    expect(result.unavailableCountActionable).toBe(1);
    expect(result.strongBuyBlockedDetails).toBe('PER_PROVIDER_MISSING_1');
    expect(result.externalDataBlockedDetails).toBe('PER_PROVIDER_MISSING_1');
    expect(result.fundamentalQualityFailDetails).toBe('EPS_NON_POSITIVE_1');
    expect(result.qualityFailDetails).toBe('EPS_NON_POSITIVE_1');
    expect(result.records.find(record => record.symbol === '005930')?.conditionResults.per.status).toBe('FAIL');
    expect(result.records.find(record => record.symbol === '000660')?.conditionResults.per.status).toBe('UNAVAILABLE');
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

  it('classifies known ETF symbols without corpCode as DART not applicable', () => {
    const classified = classifyGate2CorpCodeMissingForDiagnostics({
      symbol: '069500',
      status: 'NOT_FOUND',
    });

    expect(classified).toMatchObject({
      instrumentType: 'KIS_METADATA/ETF_OR_INDEX_PRODUCT',
      reason: 'DART_NOT_APPLICABLE',
      executionImpact: 'NONE',
    });
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

  // ADR-0532 Phase 2 — PER recovery: KIS PER decoupled from DART in the gate2 read path.
  it('carries injected KIS PER in valuation.per even when DART financials are absent', () => {
    const projection = buildGate2ExternalProjection({
      symbol: '005930',
      dartFin: null,
      per: 12.5,
      perSource: 'KIS',
      perReason: 'PER_ACCEPTABLE',
    });
    expect(projection.valuation.per.per).toBe(12.5);
    expect(projection.conditionResults.per.source).toBe('KIS');
    expect(projection.executionImpact).toBe('NONE');
  });

  it('KIS_FINANCE_PRIMARY_ENABLED=true injects KIS PER into cache projection even when DART is null', async () => {
    process.env.KIS_APP_KEY = 'test-app-key';
    process.env.KIS_APP_SECRET = 'test-app-secret';
    process.env.KIS_FINANCE_PRIMARY_ENABLED = 'true';
    // DART_API_KEY unset → getDartFinancials returns null (no network).
    setKisClientOverrides({
      realDataKisGet: async () => ({ output: { stck_prpr: '60000', per: '12.5', eps: '4800', lstn_stcn: '1000000' } }),
    });

    await getGate2DartFinancialsForEvaluation('334455');

    const record = getGate2ExternalCacheRecord('334455');
    expect(record?.projection?.valuation?.per?.per).toBe(12.5);
    expect(record?.projection?.conditionResults?.per?.source).toBe('KIS');
    expect(record?.projection?.executionImpact).toBe('NONE');
  });

  it('ADR-0532 Phase 3: KIS financials become primary (roe/opm/per) when flag on + DART null', async () => {
    process.env.KIS_APP_KEY = 'test-app-key';
    process.env.KIS_APP_SECRET = 'test-app-secret';
    process.env.KIS_FINANCE_PRIMARY_ENABLED = 'true';
    // DART_API_KEY unset → DART null. KIS finance + PER served via overrides (by trId).
    setKisClientOverrides({
      realDataKisGet: async (trId: string) => {
        if (trId === 'FHKST66430300') return { output: [{ stac_yymm: '202412', roe_val: '18.0', lblt_rate: '40', eps: '5000', bps: '40000' }] };
        if (trId === 'FHKST66430200') return { output: [{ sale_account: '1000', op_prfi: '200', thtr_ntin: '150' }] };
        if (trId === 'FHKST01010100') return { output: { per: '12.0', stck_prpr: '60000', eps: '5000' } };
        return {};
      },
    });

    const fin = await getGate2DartFinancialsForEvaluation('334466');
    expect(fin?.roe).toBeCloseTo(18); // KIS roe_val primary

    const record = getGate2ExternalCacheRecord('334466');
    expect(record?.projection?.profitability?.roe).toBeCloseTo(18);
    expect(record?.projection?.profitability?.opm).toBeCloseTo(20); // 200/1000*100 from KIS income-statement
    expect(record?.projection?.conditionResults?.roe?.status).toBe('PASS');
    expect(record?.projection?.conditionResults?.opm?.status).toBe('PASS');
    expect(record?.projection?.valuation?.per?.per).toBe(12); // PER from KIS inquire-price
    // KIS 미가용 — DART null → ICR unavailable (DART 잔존 책임)
    expect(record?.projection?.conditionResults?.icr?.status).toBe('UNAVAILABLE');
    expect(record?.projection?.executionImpact).toBe('NONE');
  });

  // ADR-0532 Phase 3 cache-hit gap: 배포 후에도 perStatus=UNAVAILABLE source=NONE 이 관측된 원인.
  // flag-on 인데 PER 미보유(legacy DART-only) projection 이 cache-hit 으로 서빙되어 KIS-primary 를 우회.
  it('Phase 3 cache-hit gap: flag-on bypasses PER-less (legacy DART-only) cache → re-caches via KIS-primary', async () => {
    process.env.KIS_APP_KEY = 'test-app-key';
    process.env.KIS_APP_SECRET = 'test-app-secret';
    process.env.KIS_FINANCE_PRIMARY_ENABLED = 'true';
    // Seed a legacy DART-only projection: VERIFIED confidence, ROE/OPM present, but NO PER (valuation.per.per null).
    const legacy = buildGate2ExternalProjection({
      symbol: '551100',
      dartFin: {
        symbol: '551100', roe: -58.22, opm: -83.04, revenue: 1000, netIncome: -100,
        dataConfidence: 'VERIFIED', source: 'DART',
      } as unknown as Gate2DartEvaluationFinancials,
    });
    expect(legacy.financialSnapshot.confidence).toBe('VERIFIED');
    expect(legacy.valuation.per.per).toBeNull(); // legacy lacks PER → would have been cache-hit before the fix
    upsertGate2ExternalCacheRecords([{ symbol: '551100', projection: legacy, updatedAt: legacy.asOf }]);

    setKisClientOverrides({
      realDataKisGet: async (trId: string) => {
        if (trId === 'FHKST66430300') return { output: [{ stac_yymm: '202412', roe_val: '18.0', lblt_rate: '40' }] };
        if (trId === 'FHKST66430200') return { output: [{ sale_account: '1000', op_prfi: '200', thtr_ntin: '150' }] };
        if (trId === 'FHKST01010100') return { output: { per: '12.0', stck_prpr: '60000', eps: '5000' } };
        return {};
      },
    });

    const fin = await getGate2DartFinancialsForEvaluation('551100');
    expect(fin?.roe).toBeCloseTo(18); // KIS-primary roe, NOT stale legacy DART -58.22

    const record = getGate2ExternalCacheRecord('551100');
    expect(record?.projection?.valuation?.per?.per).toBe(12); // re-cached WITH KIS PER (self-correcting migration)
    expect(record?.projection?.profitability?.roe).toBeCloseTo(18);
  });

  // ADR-0532 진단 self-heal: PER 는 보유하지만 dartLineHealth.kisFinance(진단필드 추가 전 구 projection)
  // 가 없는 캐시는 신뢰하지 않고 1회 재산출 → re-cache 시 kisFinance 채워짐(이후 정상 cache-hit).
  it('kisFinance self-heal: flag-on recomputes cache lacking dartLineHealth.kisFinance (구 진단 캐시)', async () => {
    process.env.KIS_APP_KEY = 'test-app-key';
    process.env.KIS_APP_SECRET = 'test-app-secret';
    process.env.KIS_FINANCE_PRIMARY_ENABLED = 'true';
    const stale = buildGate2ExternalProjection({
      symbol: '553300',
      dartFin: { symbol: '553300', roe: 9, opm: 8, revenue: 1000, netIncome: 80, dataConfidence: 'VERIFIED', source: 'DART' } as unknown as Gate2DartEvaluationFinancials,
      per: 10, perSource: 'KIS', perReason: 'PER_ACCEPTABLE',
    });
    expect(stale.valuation.per.per).toBe(10);
    // 진단 추가 전 코드처럼 kisFinance 제거 (구 projection 시뮬레이션).
    delete (stale.dartLineHealth as { kisFinance?: unknown }).kisFinance;
    upsertGate2ExternalCacheRecords([{ symbol: '553300', projection: stale, updatedAt: stale.asOf }]);

    let kisCalled = false;
    setKisClientOverrides({
      realDataKisGet: async (trId: string) => {
        kisCalled = true;
        if (trId === 'FHKST66430300') return { output: [{ roe_val: '20', lblt_rate: '45' }] };
        if (trId === 'FHKST66430200') return { output: [{ sale_account: '1000', op_prfi: '200', thtr_ntin: '150' }] };
        if (trId === 'FHKST66430600') return { output: [{ crnt_rate: '180' }] };
        if (trId === 'FHKST01010100') return { output: { per: '10', stck_prpr: '50000', eps: '5000' } };
        return {};
      },
    });

    await getGate2DartFinancialsForEvaluation('553300');
    expect(kisCalled).toBe(true); // 구 진단 캐시 → 재산출(KIS 호출)
    const record = getGate2ExternalCacheRecord('553300');
    expect(record?.projection?.dartLineHealth?.kisFinance).toBeTruthy(); // re-cache 시 kisFinance 채워짐
    expect(record?.projection?.dartLineHealth?.kisFinance?.kisMergeApplied).toBe(true); // KIS crnt_rate→currentRatio 반영
  });

  // flag-on + PER 보유 캐시(KIS-primary 산출분)는 정상 cache-hit (재산출 없음 → KIS 미호출).
  it('Phase 3 cache-hit gap: flag-on serves cache-hit when cached projection already has PER (no KIS re-fetch)', async () => {
    process.env.KIS_APP_KEY = 'test-app-key';
    process.env.KIS_APP_SECRET = 'test-app-secret';
    process.env.KIS_FINANCE_PRIMARY_ENABLED = 'true';
    const withPer = buildGate2ExternalProjection({
      symbol: '552200',
      dartFin: { symbol: '552200', roe: 15, opm: 12, revenue: 2000, netIncome: 300, dataConfidence: 'VERIFIED', source: 'DART' } as unknown as Gate2DartEvaluationFinancials,
      per: 11,
      perSource: 'KIS',
      perReason: 'PER_ACCEPTABLE',
    });
    expect(withPer.valuation.per.per).toBe(11);
    upsertGate2ExternalCacheRecords([{ symbol: '552200', projection: withPer, updatedAt: withPer.asOf }]);

    let kisCalled = false;
    setKisClientOverrides({ realDataKisGet: async () => { kisCalled = true; return { output: {} }; } });

    const fin = await getGate2DartFinancialsForEvaluation('552200');
    expect(fin?.roe).toBeCloseTo(15); // served from cache
    expect(kisCalled).toBe(false); // cache-hit, no re-fetch
  });

  // flag-off 는 PER 미보유 캐시도 항상 cache-hit (byte-equivalent, KIS 미호출).
  it('Phase 3 cache-hit gap: flag-off serves PER-less cache-hit unchanged (byte-equivalent, no KIS call)', async () => {
    process.env.KIS_APP_KEY = 'test-app-key';
    process.env.KIS_APP_SECRET = 'test-app-secret';
    // KIS_FINANCE_PRIMARY_ENABLED unset (off).
    const legacy = buildGate2ExternalProjection({
      symbol: '553300',
      dartFin: { symbol: '553300', roe: 9, opm: 7, revenue: 500, netIncome: 40, dataConfidence: 'VERIFIED', source: 'DART' } as unknown as Gate2DartEvaluationFinancials,
    });
    expect(legacy.valuation.per.per).toBeNull();
    upsertGate2ExternalCacheRecords([{ symbol: '553300', projection: legacy, updatedAt: legacy.asOf }]);

    let kisCalled = false;
    setKisClientOverrides({ realDataKisGet: async () => { kisCalled = true; return { output: {} }; } });

    const fin = await getGate2DartFinancialsForEvaluation('553300');
    expect(fin?.roe).toBeCloseTo(9); // served from cache unchanged
    expect(kisCalled).toBe(false); // flag-off → no KIS fetch
  });

  it('flag OFF: DART-null returns null and does NOT call KIS PER (byte-equivalent)', async () => {
    process.env.KIS_APP_KEY = 'test-app-key';
    process.env.KIS_APP_SECRET = 'test-app-secret';
    // KIS_FINANCE_PRIMARY_ENABLED unset (off). DART_API_KEY unset → dartFin null.
    let kisCalled = false;
    setKisClientOverrides({
      realDataKisGet: async () => {
        kisCalled = true;
        return { output: {} };
      },
    });

    const fin = await getGate2DartFinancialsForEvaluation('667788');

    expect(fin).toBeNull();
    expect(kisCalled).toBe(false);
  });
});

// Gate2 PER dedup (정본 데이터 SSOT, patch, byte-equivalent): 정본 snapshot quote 재사용이 동일 FHKST01010100
// 재호출 결과와 deep-equal 임을 단언하고, flag OFF / quote 부재 시 재호출 fallback(회귀 0) 을 검증한다.
describe('Gate2 PER snapshot dedup (정본 데이터 SSOT, patch)', () => {
  const PER_OUTPUT = {
    output: {
      stck_prpr: '60000',
      per: '12.5',
      eps: '4800',
      lstn_stcn: '1000000',
    },
  };

  afterEach(() => {
    setKisClientOverrides({});
    delete process.env.KIS_APP_KEY;
    delete process.env.KIS_APP_SECRET;
    delete process.env.USE_UNIFIED_SOURCE_SNAPSHOT;
  });

  it('reuses canonical snapshot quote without re-calling FHKST01010100 (byte-equivalent)', async () => {
    process.env.KIS_APP_KEY = 'test-app-key';
    process.env.KIS_APP_SECRET = 'test-app-secret';
    process.env.USE_UNIFIED_SOURCE_SNAPSHOT = 'true';

    // 1) 기존 재호출 경로 결과 (output = PER_OUTPUT).
    let calls = 0;
    setKisClientOverrides({
      realDataKisGet: async () => {
        calls += 1;
        return PER_OUTPUT;
      },
    });
    const viaRefetch = await fetchGate2PerValuation({ symbol: '005930' });
    expect(calls).toBe(1);

    // 2) 정본 snapshot quote 재사용 경로 — realDataKisGet 가 호출되면 안 된다.
    let reuseCalls = 0;
    setKisClientOverrides({
      realDataKisGet: async () => {
        reuseCalls += 1;
        return PER_OUTPUT;
      },
    });
    const viaSnapshot = await fetchGate2PerValuation({
      symbol: '005930',
      snapshotQuote: { per: 12.5, eps: 4800, listedShares: 1000000, currentPrice: 60000 },
    });
    expect(reuseCalls).toBe(0); // 재호출 skip — 중복 호출 제거 단언.

    // 3) byte-equivalent — 결정 필드(raw 디버그 echo 제외) deep-equal.
    const { raw: rawA, ...decisionRefetch } = viaRefetch;
    const { raw: rawB, ...decisionSnapshot } = viaSnapshot;
    void rawA; void rawB;
    expect(decisionSnapshot).toEqual(decisionRefetch);
    expect(viaSnapshot).toMatchObject({
      attempted: true,
      per: 12.5,
      eps: 4800,
      currentPrice: 60000,
      listedShares: 1000000,
      source: 'KIS',
      reason: 'PER_ACCEPTABLE',
    });
  });

  it('falls back to re-call when flag OFF even if snapshotQuote present (regression 0)', async () => {
    process.env.KIS_APP_KEY = 'test-app-key';
    process.env.KIS_APP_SECRET = 'test-app-secret';
    // USE_UNIFIED_SOURCE_SNAPSHOT unset → flag OFF.
    let calls = 0;
    setKisClientOverrides({
      realDataKisGet: async () => {
        calls += 1;
        return PER_OUTPUT;
      },
    });
    const result = await fetchGate2PerValuation({
      symbol: '005930',
      snapshotQuote: { per: 12.5, eps: 4800, listedShares: 1000000, currentPrice: 60000 },
    });
    expect(calls).toBe(1); // flag OFF → 기존 재호출 경로 유지.
    expect(result).toMatchObject({ per: 12.5, source: 'KIS', reason: 'PER_ACCEPTABLE' });
  });

  it('falls back to re-call when snapshotQuote has no valuation fields (flag ON)', async () => {
    process.env.KIS_APP_KEY = 'test-app-key';
    process.env.KIS_APP_SECRET = 'test-app-secret';
    process.env.USE_UNIFIED_SOURCE_SNAPSHOT = 'true';
    let calls = 0;
    setKisClientOverrides({
      realDataKisGet: async () => {
        calls += 1;
        return PER_OUTPUT;
      },
    });
    const result = await fetchGate2PerValuation({
      symbol: '005930',
      snapshotQuote: { per: null, eps: null, listedShares: null, currentPrice: null },
    });
    expect(calls).toBe(1); // valuation 부재 → 재호출 fallback.
    expect(result).toMatchObject({ per: 12.5, source: 'KIS' });
  });

  it('computes PER from snapshot price+eps identical to re-call when direct PER absent', async () => {
    process.env.KIS_APP_KEY = 'test-app-key';
    process.env.KIS_APP_SECRET = 'test-app-secret';
    process.env.USE_UNIFIED_SOURCE_SNAPSHOT = 'true';
    const noPerOutput = { output: { stck_prpr: '60000', eps: '3000' } };

    setKisClientOverrides({ realDataKisGet: async () => noPerOutput });
    const viaRefetch = await fetchGate2PerValuation({ symbol: '005930' });

    setKisClientOverrides({
      realDataKisGet: async () => {
        throw new Error('should not be called');
      },
    });
    const viaSnapshot = await fetchGate2PerValuation({
      symbol: '005930',
      snapshotQuote: { per: null, eps: 3000, currentPrice: 60000 },
    });

    const { raw: rawA, ...decisionRefetch } = viaRefetch;
    const { raw: rawB, ...decisionSnapshot } = viaSnapshot;
    void rawA; void rawB;
    expect(decisionSnapshot).toEqual(decisionRefetch);
    expect(viaSnapshot).toMatchObject({
      per: 20,
      source: 'KIS',
      reason: 'PER_COMPUTED_FROM_KIS_PRICE_EPS',
      perComputedFromPriceAndEps: true,
    });
  });

  it('round-trips KIS debtRatio/currentRatio through projection cache (ADR-0532 확장)', () => {
    // KIS-primary 머지 record (debtRatio/currentRatio 는 KIS lblt_rate/crnt_rate)
    const merged: Gate2DartEvaluationFinancials = {
      symbol: '005930',
      corpCode: null,
      reportDate: null,
      fiscalYear: '202412',
      quarter: 'ANNUAL',
      revenue: 1000,
      operatingIncome: 150,
      netIncome: 100,
      operatingCashFlow: null, // OCF 는 DART 잔여(여기선 미가용)
      interestExpense: null,
      totalEquity: null,
      totalAssets: null,
      ocfRatio: null,
      roe: 12.5,
      opm: 15,
      debtRatio: 45.6,
      currentRatio: 210.5,
      opmYoYDelta: null,
      revenueYoYGrowth: 10,
      operatingIncomeYoYGrowth: 18,
      marginAcceleration: 8,
      interestCoverageRatio: null,
      source: 'UNKNOWN',
      providerStatus: 'OK_WITH_DATA',
      dataConfidence: 'VERIFIED',
      providerIssue: false,
      marketSignal: false,
      executionImpact: 'DIAGNOSTIC_ONLY',
    };
    const projection = buildGate2ExternalProjection({ symbol: '005930', dartFin: merged, per: 12, asOf: '2026-06-01T00:00:00.000Z' });
    // KIS debtRatio/currentRatio 가 projection.metrics 에 반영
    expect(projection.metrics.debtRatio).toBe(45.6);
    expect(projection.metrics.currentRatio).toBe(210.5);
    // 캐시 round-trip(projectionToQmpDartFinancials)이 KIS 필드를 유실하지 않음 (직전엔 누락)
    const roundTripped = projectionToQmpDartFinancials(projection);
    expect(roundTripped.debtRatio).toBe(45.6);
    expect(roundTripped.currentRatio).toBe(210.5);
    expect(roundTripped.roe).toBe(12.5);
    expect(roundTripped.opm).toBe(15);
    // OCF/ICR 은 DART 잔여 — 미가용 시 null 유지
    expect(roundTripped.operatingCashFlow).toBeNull();
    expect(roundTripped.interestCoverageRatio).toBeNull();
    expect(roundTripped.executionImpact).toBe('DIAGNOSTIC_ONLY');
  });
});
