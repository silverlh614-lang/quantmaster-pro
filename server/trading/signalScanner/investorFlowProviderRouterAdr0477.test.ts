// @responsibility ADR-0477 investor-flow provider router wiring tests.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildOperatorActionQueueAdr0480 } from './operatorActionRouterAdr0480.js';
import {
  buildInvestorFlowProviderCapabilities,
  buildInvestorFlowProviderRouteResultAdr0477,
  formatInvestorFlowProviderRouterAdr0477,
  normalizeInvestorFlowSourceKey,
  normalizeSemanticNetBuySampleAdr0477,
} from './investorFlowProviderRouterAdr0477.js';
import { buildSemanticNetBuyNormalizationReportAdr0482 } from './semanticNetBuyNormalizerAdr0482.js';
import { buildNaverInvestorTrendCollectorResultAdr0481 } from './naverInvestorTrendCollectorAdr0481.js';
import {
  buildGate1DryRunObservationRows,
} from './gate1DryRunObservationLedgerAdr0476.js';
import {
  buildSupplyProviderWarmupReport,
  formatSupplyProviderWarmupCompactLine,
} from '../../supply/investorFlowProviderHealth.js';

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const routerSource = () => read('./investorFlowProviderRouterAdr0477.ts');
const scanDiagnosticsSource = () => read('./scanDiagnostics.ts');
const entryFilterSource = () => read('./entryFilterDecomposition.ts');
const penaltyDedupSource = () => read('./gate1PenaltyDeduplication.ts');
const observationLedgerSource = () => read('./gate1DryRunObservationLedgerAdr0476.ts');

function notWiredRoute() {
  return buildInvestorFlowProviderRouteResultAdr0477({
    code: '005930',
    naverCollectorWired: false,
    cacheRaw: null,
    kisTriedForInvestorFlow: true,
    marketProgramStatus: 'ACCEPTED_EMPTY',
    fssSourceAgeTradingDays: 5,
  });
}

describe('ADR-0477 Investor Flow Provider Router Wiring', () => {


  it('normalizes investor-flow source keys for FreshData, health, and cache bridges', () => {
    expect(normalizeInvestorFlowSourceKey('NAVER')).toBe('NAVER_INVESTOR_TREND');
    expect(normalizeInvestorFlowSourceKey('NAVER_INVESTOR_TREND')).toBe('NAVER_INVESTOR_TREND');
    expect(normalizeInvestorFlowSourceKey('Semantic NetBuy')).toBe('SEMANTIC_NETBUY');
    expect(normalizeInvestorFlowSourceKey('semantic_netbuy')).toBe('SEMANTIC_NETBUY');
    expect(normalizeInvestorFlowSourceKey('KRX')).toBe('KRX_INVESTOR_FLOW');
    expect(normalizeInvestorFlowSourceKey('KIS')).toBe('KIS_API');
  });

  it('bridges ADR-0487 FreshData READY_FOR_SHADOW NAVER and Semantic samples into router selection', () => {
    const baseSnapshot = {
      domain: 'SUPPLY' as const,
      provider: 'NAVER' as const,
      stage: 'SHADOW_ONLY' as const,
      collectedAt: '2026-05-11T00:00:00.000Z',
      sourceDate: '2026-05-11',
      cacheState: 'FRESH' as const,
      sourceState: 'FRESH' as const,
      cacheAgeMinutes: 1,
      sourceAgeTradingDays: 0,
      coverageRatio: 1,
      normalized: true,
      status: 'READY_FOR_SHADOW' as const,
      confidence: 'LOW' as const,
      isProviderIssue: false,
      isMarketSignal: false as const,
      executionImpact: 'NONE' as const,
      liveExecutionAllowed: false as const,
      operatorApprovalRequired: true as const,
      sampleMaterialized: true,
      usableForRouter: true,
      usableForShadow: true,
      usableForLive: false as const,
      readinessKind: 'MATERIALIZED_SAMPLE' as const,
      sourceOfTruth: 'ROUTER_INPUT' as const,
      diagnostics: [],
    };
    const report = {
      generatedAt: '2026-05-11T00:00:00.000Z',
      registrations: [],
      snapshots: [
        { ...baseSnapshot, sourceId: 'NAVER_INVESTOR_TREND' },
        { ...baseSnapshot, sourceId: 'SEMANTIC_NETBUY', provider: 'INTERNAL' as const },
      ],
      domainSummaries: [],
      overallStatus: 'PARTIAL' as const,
      topGaps: [],
      recommendedNextActions: [],
      executionImpact: 'NONE' as const,
      liveExecutionAllowed: false as const,
      policyPromotionMode: 'SHADOW_ONLY' as const,
      operatorApprovalRequired: true as const,
      diagnostics: [],
    };

    const naverRoute = buildInvestorFlowProviderRouteResultAdr0477({ code: '005930', naverCollectorWired: false, freshDataSupplyAdr0487: report });
    expect(naverRoute.selectedProvider).toBe('NAVER_INVESTOR_TREND');
    expect(naverRoute.providerStatuses.NAVER).toBe('READY_FOR_SHADOW');
    expect(naverRoute.signal).toBe('UNKNOWN');
    expect(naverRoute.liveExecutionAllowed).toBe(false);
    expect(naverRoute.rawPayloadPersistenceAllowed).toBe(false);

    const semanticOnly = { ...report, snapshots: [report.snapshots[1]!] };
    const semanticRoute = buildInvestorFlowProviderRouteResultAdr0477({ code: '005930', naverCollectorWired: false, freshDataSupplyAdr0487: semanticOnly });
    expect(semanticRoute.selectedProvider).toBe('SEMANTIC_NETBUY');
    expect(semanticRoute.coverage.available).toBeGreaterThanOrEqual(1);
  });

  it('does not select REGISTRY_READY FreshData placeholders while CACHE_STALE_HIT is available', () => {
    const route = buildInvestorFlowProviderRouteResultAdr0477({
      code: '005930',
      naverCollectorWired: false,
      freshDataSupplyAdr0487: {
        generatedAt: '2026-05-11T00:00:00.000Z',
        registrations: [],
        domainSummaries: [],
        overallStatus: 'PARTIAL',
        topGaps: [],
        recommendedNextActions: [],
        executionImpact: 'NONE',
        liveExecutionAllowed: false,
        policyPromotionMode: 'SHADOW_ONLY',
        operatorApprovalRequired: true,
        diagnostics: [],
        snapshots: [{
          sourceId: 'NAVER_INVESTOR_TREND',
          domain: 'SUPPLY',
          provider: 'NAVER',
          stage: 'SHADOW_ONLY',
          collectedAt: '2026-05-11T00:00:00.000Z',
          sourceDate: null,
          cacheState: 'UNKNOWN',
          sourceState: 'DATA_UNAVAILABLE',
          cacheAgeMinutes: null,
          sourceAgeTradingDays: null,
          coverageRatio: 0,
          normalized: false,
          status: 'OBSERVING',
          confidence: 'NONE',
          isProviderIssue: false,
          isMarketSignal: false,
          executionImpact: 'NONE',
          liveExecutionAllowed: false,
          operatorApprovalRequired: true,
          sampleMaterialized: false,
          usableForRouter: false,
          usableForShadow: false,
          usableForLive: false,
          readinessKind: 'REGISTRY_READY',
          sourceOfTruth: 'REGISTRY',
          diagnostics: ['registry ready only'],
        }],
      },
      supplySnapshotCacheLookupAdr0491: {
        status: 'CACHE_STALE_HIT',
        snapshot: null,
        cacheRaw: { code: '005930', sourceDate: '2026-05-08', foreignNetBuy: 100, institutionNetBuy: 100, status: 'STALE' },
        retained: 1,
        reason: 'STALE_SANITIZED_SNAPSHOT_HIT_OBSERVE_ONLY',
        stale: true,
        executionImpact: 'NONE',
        liveExecutionAllowed: false,
        policyPromotionMode: 'SHADOW_ONLY',
        rawPayloadPersistenceAllowed: false,
      },
    });

    expect(route.selectedProvider).toBe('CACHE');
    expect(route.providerStatuses.NAVER_INVESTOR_TREND).toBe('REGISTRY_READY_NOT_MATERIALIZED');
    expect(route.naverSampleStatus).toBe('REGISTRY_READY_NOT_MATERIALIZED');
    expect(route.naverReadinessKind).toBe('REGISTRY_READY');
    expect(route.selectedReason).toContain('CACHE_STALE_HIT');
    expect(route.selectedReason).toContain('readinessKind=REGISTRY_READY');
    expect(route.liveExecutionAllowed).toBe(false);
  });

  it('does not select FreshData samples that are not normalized', () => {
    const route = buildInvestorFlowProviderRouteResultAdr0477({
      code: '005930',
      naverCollectorWired: false,
      freshDataSupplyAdr0487: {
        generatedAt: '2026-05-11T00:00:00.000Z', registrations: [], domainSummaries: [], overallStatus: 'PARTIAL', topGaps: [], recommendedNextActions: [], executionImpact: 'NONE', liveExecutionAllowed: false, policyPromotionMode: 'SHADOW_ONLY', operatorApprovalRequired: true, diagnostics: [],
        snapshots: [{ sourceId: 'NAVER_INVESTOR_TREND', domain: 'SUPPLY', provider: 'NAVER', stage: 'SHADOW_ONLY', collectedAt: '2026-05-11T00:00:00.000Z', sourceDate: '2026-05-11', cacheState: 'FRESH', sourceState: 'FRESH', cacheAgeMinutes: 1, sourceAgeTradingDays: 0, coverageRatio: 1, normalized: false, status: 'READY_FOR_SHADOW', confidence: 'LOW', isProviderIssue: false, isMarketSignal: false, executionImpact: 'NONE', liveExecutionAllowed: false, operatorApprovalRequired: true, diagnostics: [] }],
      },
    });
    expect(route.selectedProvider).toBe('NONE');
    expect(route.signal).toBe('UNKNOWN');
  });

  it('NAVER NOT_WIRED, KIS PROVIDER_MISMATCH, and CACHE_EMPTY stay UNKNOWN with executionImpact NONE', () => {
    const route = notWiredRoute();

    expect(route.providerStatuses.NAVER).toBe('NOT_WIRED');
    expect(route.providerStatuses.KIS).toBe('PROVIDER_MISMATCH');
    expect(route.providerStatuses.CACHE).toBe('CACHE_EMPTY');
    expect(route.providerStatuses.MARKET_PROGRAM).toBe('ACCEPTED_EMPTY');
    expect(route.signal).toBe('UNKNOWN');
    expect(route.signal).not.toBe('BEARISH');
    expect(route.coverage.providerMismatch).toBe(1);
    expect(route.coverage.notWired).toBe(1);
    expect(route.coverage.acceptedEmpty).toBe(1);
    expect(route.executionImpact).toBe('NONE');
    expect(route.liveExecutionAllowed).toBe(false);
    expect(route.policyPromotionMode).toBe('SHADOW_ONLY');
    expect(route.operatorApprovalRequired).toBe(true);
  });

  it('provider capability registry does not force KIS into semantic investor_flow', () => {
    const capabilities = buildInvestorFlowProviderCapabilities({ naverCollectorWired: false });
    const kis = capabilities.find((item) => item.provider === 'KIS');
    const naver = capabilities.find((item) => item.provider === 'NAVER');
    const cache = capabilities.find((item) => item.provider === 'CACHE');

    expect(kis?.supportsInvestorFlow).toBe(false);
    expect(kis?.isSemanticNetBuyProvider).toBe(false);
    expect(naver?.supportsInvestorFlow).toBe(false);
    expect(cache?.supportsInvestorFlow).toBe(true);
  });

  it('STALE sources block positive source contribution but do not create bearish signal', () => {
    const route = buildInvestorFlowProviderRouteResultAdr0477({
      code: '005930',
      naverCollectorWired: true,
      naverRaw: { foreignNetBuy: 100, institutionNetBuy: 100, sourceDate: '2026-05-01' },
      sourceAgeTradingDays: 5,
    });

    expect(route.providerStatuses.NAVER).toBe('STALE');
    expect(route.status).toBe('STALE');
    expect(route.signal).toBe('UNKNOWN');
    expect(route.signal).not.toBe('BEARISH');
  });

  it('verified semantic net-buy can be BULLISH or BEARISH only with verified confidence', () => {
    const positive = buildInvestorFlowProviderRouteResultAdr0477({
      code: '005930',
      naverCollectorWired: true,
      naverRaw: { foreignNetBuy: 100, institutionNetBuy: 50, sourceDate: '2026-05-08' },
      sourceAgeTradingDays: 0,
    });
    const negative = buildInvestorFlowProviderRouteResultAdr0477({
      code: '000660',
      naverCollectorWired: true,
      naverRaw: { foreignNetBuy: -100, institutionNetBuy: -50, sourceDate: '2026-05-08' },
      sourceAgeTradingDays: 0,
    });
    const staleNegative = buildInvestorFlowProviderRouteResultAdr0477({
      code: '035420',
      naverCollectorWired: true,
      naverRaw: { foreignNetBuy: -100, institutionNetBuy: -50, sourceDate: '2026-05-01' },
      sourceAgeTradingDays: 5,
    });

    expect(positive.signal).toBe('BULLISH');
    expect(positive.selectedProvider).toBe('NAVER_INVESTOR_TREND');
    expect(positive.liveExecutionAllowed).toBe(false);
    expect(negative.signal).toBe('BEARISH');
    expect(staleNegative.signal).toBe('UNKNOWN');
  });



  it('routes ADR-0481 NAVER investor trend collector samples before cache while staying SHADOW_ONLY', () => {
    const collector = buildNaverInvestorTrendCollectorResultAdr0481({
      code: '005930',
      requestedDays: 5,
      sourceAgeTradingDays: 0,
      rawPoints: [{ date: '2026-05-08', foreignNetBuy: 1000, institutionNetBuy: 2000, individualNetBuy: -3000 }],
    });
    const route = buildInvestorFlowProviderRouteResultAdr0477({
      code: '005930',
      naverCollectorResultAdr0481: collector,
      cacheRaw: { foreignNetBuy: -1, institutionNetBuy: -1, sourceDate: '2026-05-07' },
      cacheAgeTradingDays: 1,
    });

    expect(route.selectedProvider).toBe('NAVER_INVESTOR_TREND');
    expect(route.providerTried).toEqual(['NAVER', 'SEMANTIC_NETBUY', 'CACHE']);
    expect(route.coverage.available).toBeGreaterThanOrEqual(1);
    expect(route.liveExecutionAllowed).toBe(false);
    expect(route.executionImpact).toBe('NONE');
  });

  it('routes SemanticNetBuy normalized samples as selectedProvider=SEMANTIC_NETBUY and keeps NONE confidence shadow-only', () => {
    const report = buildSemanticNetBuyNormalizationReportAdr0482({
      code: '005930',
      generatedAt: '2026-05-11T00:00:00.000Z',
      inputs: [{
        code: '005930',
        provider: 'KRX',
        sourceDate: '2026-05-08',
        rawForeignNetBuy: 100,
        rawInstitutionNetBuy: 50,
        unit: 'KRW',
        sourceAgeTradingDays: 1,
      }],
    });
    const route = buildInvestorFlowProviderRouteResultAdr0477({
      code: '005930',
      naverCollectorWired: false,
      semanticNetBuyNormalizationAdr0482: report,
    });

    expect(route.selectedProvider).toBe('SEMANTIC_NETBUY');
    expect(route.providerStatuses.SEMANTIC_NETBUY).toBe('VERIFIED');
    expect(route.semanticNetBuy?.source).toBe('KRX_INVESTOR_FLOW');
    expect(route.signal).toBe('BULLISH');
    expect(route.liveExecutionAllowed).toBe(false);

    const unavailable = buildSemanticNetBuyNormalizationReportAdr0482({ code: '000660', inputs: [] });
    const unavailableRoute = buildInvestorFlowProviderRouteResultAdr0477({
      code: '000660',
      naverCollectorWired: false,
      semanticNetBuyNormalizationAdr0482: unavailable,
    });
    expect(unavailableRoute.selectedProvider).toBe('NONE');
    expect(unavailableRoute.signal).toBe('UNKNOWN');
    expect(unavailableRoute.diagnostics.join(' ')).toContain('INPUT_SAMPLE_UNAVAILABLE');
    expect(unavailableRoute.liveExecutionAllowed).toBe(false);
  });

  it('uses stale cache snapshot samples as OBSERVE diagnostics without live promotion', () => {
    const route = buildInvestorFlowProviderRouteResultAdr0477({
      code: '005930',
      naverCollectorWired: false,
      cacheRaw: { foreignNetBuy: 100, institutionNetBuy: 100, sourceDate: '2026-05-08', status: 'STALE' },
      cacheAgeTradingDays: 4,
    });

    expect(route.selectedProvider).toBe('CACHE');
    expect(route.providerStatuses.CACHE).toBe('STALE');
    expect(route.freshness.cacheState).toBe('STALE');
    expect(route.signal).toBe('UNKNOWN');
    expect(route.liveExecutionAllowed).toBe(false);
  });

  it('prefers fresh NAVER, fresh SemanticNetBuy, stale NAVER, stale SemanticNetBuy, then CACHE fallback', () => {
    const naverFresh = buildInvestorFlowProviderRouteResultAdr0477({
      code: '005930',
      naverCollectorResultAdr0481: buildNaverInvestorTrendCollectorResultAdr0481({
        code: '005930',
        rawPoints: [{ date: '2026-05-11', foreignNetBuy: 10, institutionNetBuy: 20 }],
      }),
      semanticNetBuyNormalizationAdr0482: buildSemanticNetBuyNormalizationReportAdr0482({
        code: '005930',
        inputs: [{ code: '005930', provider: 'CACHE', sourceDate: '2026-05-04', rawForeignNetBuy: 1, rawInstitutionNetBuy: 1, unit: 'KRW', status: 'STALE', sourceAgeTradingDays: 4 }],
      }),
      cacheRaw: { foreignNetBuy: 1, institutionNetBuy: 1, sourceDate: '2026-05-04', status: 'STALE' },
    });
    expect(naverFresh.selectedProvider).toBe('NAVER_INVESTOR_TREND');
    expect(naverFresh.cacheFallbackUsed).toBe(false);

    const semanticFresh = buildInvestorFlowProviderRouteResultAdr0477({
      code: '005930',
      naverCollectorWired: true,
      semanticNetBuyNormalizationAdr0482: buildSemanticNetBuyNormalizationReportAdr0482({
        code: '005930',
        inputs: [{ code: '005930', provider: 'NAVER', sourceDate: '2026-05-11', rawForeignNetBuy: 10, rawInstitutionNetBuy: 20, unit: 'KRW' }],
      }),
      cacheRaw: { foreignNetBuy: 1, institutionNetBuy: 1, sourceDate: '2026-05-04', status: 'STALE' },
    });
    expect(semanticFresh.selectedProvider).toBe('SEMANTIC_NETBUY');
    expect(semanticFresh.liveExecutionAllowed).toBe(false);

    const naverStale = buildInvestorFlowProviderRouteResultAdr0477({
      code: '005930',
      naverCollectorResultAdr0481: buildNaverInvestorTrendCollectorResultAdr0481({
        code: '005930',
        nonTradingDay: true,
        rawPoints: [{ date: '2026-05-08', foreignNetBuy: 10, institutionNetBuy: 20 }],
      }),
      semanticNetBuyNormalizationAdr0482: buildSemanticNetBuyNormalizationReportAdr0482({
        code: '005930',
        inputs: [{ code: '005930', provider: 'CACHE', sourceDate: '2026-05-04', rawForeignNetBuy: 1, rawInstitutionNetBuy: 1, unit: 'KRW', status: 'STALE', sourceAgeTradingDays: 4 }],
      }),
    });
    expect(naverStale.selectedProvider).toBe('NAVER_INVESTOR_TREND');
    expect(naverStale.status).toBe('STALE');
    expect(naverStale.signal).toBe('UNKNOWN');

    const semanticStale = buildInvestorFlowProviderRouteResultAdr0477({
      code: '005930',
      naverCollectorWired: true,
      semanticNetBuyNormalizationAdr0482: buildSemanticNetBuyNormalizationReportAdr0482({
        code: '005930',
        inputs: [{ code: '005930', provider: 'CACHE', sourceDate: '2026-05-04', rawForeignNetBuy: 1, rawInstitutionNetBuy: 1, unit: 'KRW', status: 'STALE', sourceAgeTradingDays: 4 }],
      }),
    });
    expect(semanticStale.selectedProvider).toBe('SEMANTIC_NETBUY');
    expect(semanticStale.semanticInputStatus).toBe('STALE');

    const cacheOnly = buildInvestorFlowProviderRouteResultAdr0477({
      code: '005930',
      naverCollectorWired: false,
      cacheRaw: { foreignNetBuy: 1, institutionNetBuy: 1, sourceDate: '2026-05-04', status: 'STALE' },
      cacheAgeTradingDays: 4,
    });
    expect(cacheOnly.selectedProvider).toBe('CACHE');
    expect(cacheOnly.cacheFallbackUsed).toBe(true);
  });

  it('semantic normalizer excludes ACCEPTED_EMPTY from score and does not persist raw payloads', () => {
    const sample = normalizeSemanticNetBuySampleAdr0477(
      { status: 'ACCEPTED_EMPTY', foreignNetBuy: 0, institutionNetBuy: 0 },
      'KIS',
      { code: '005930' },
    );

    expect(sample.status).toBe('ACCEPTED_EMPTY');
    expect(sample.signal).toBe('UNKNOWN');
    expect(formatInvestorFlowProviderRouterAdr0477(notWiredRoute())).toContain('rawPayloadPersistenceAllowed: false');
    expect(routerSource()).not.toContain('JSON.stringify(raw');
  });

  it('ADR-0477 route result is included in ADR-0473 warmup report', () => {
    const route = notWiredRoute();
    const warmup = buildSupplyProviderWarmupReport({
      investorFlowRouter: {
        status: route.status,
        selectedProvider: route.selectedProvider,
        providerTried: route.providerTried,
        signal: route.signal,
        coverage: {
          available: route.coverage.available,
          total: route.coverage.total,
        },
        executionImpact: 'NONE',
        liveExecutionAllowed: false,
      },
    });
    const formatted = formatSupplyProviderWarmupCompactLine(warmup);

    expect(warmup.investorFlowRouter?.status).toBe('DATA_UNAVAILABLE');
    expect(formatted).toContain('ADR-0477 Router');
    expect(formatted).toContain('signal=UNKNOWN');
  });

  it('ADR-0477 fields are available to ADR-0465 SupplyProviderHealthTrace and ADR-0466 unknown treatment', () => {
    const entrySource = entryFilterSource();
    const route = notWiredRoute();

    expect(entrySource).toContain('investorFlowRouterStatus');
    expect(entrySource).toContain('selectedInvestorFlowProvider');
    expect(entrySource).toContain('semanticNetBuySignal');
    expect(route.signal).toBe('UNKNOWN');
    expect(route.diagnostics.join(' ')).toContain('provider issue');
  });

  it('ADR-0469 can keep provider unknown grouped away from verified bearish supply', () => {
    const source = penaltyDedupSource();

    expect(source).toContain('SUPPLY_PROVIDER_UNKNOWN');
    expect(source).toContain('providerIssue');
    expect(source).toContain('marketSignal');
    expect(source).toContain('SUPPLY_UNKNOWN');
  });

  it('ADR-0476 ledger records sanitized ADR-0477 observation row with executionImpact NONE', () => {
    const route = notWiredRoute();
    const rows = buildGate1DryRunObservationRows({
      forDate: '2026-05-09',
      investorFlowProviderRouter: route,
      sellOnly: true,
      providerIssue: true,
      marketSignal: false,
    });
    const row = rows.find((item) => item.source === 'ADR_0477_INVESTOR_FLOW_PROVIDER_ROUTER');

    expect(row).toBeDefined();
    expect(row?.observationType).toBe('INVESTOR_FLOW_PROVIDER_ROUTER_ADR0477');
    expect(row?.selectedProvider).toBe('NONE');
    expect(row?.routeSignal).toBe('UNKNOWN');
    expect(row?.providerMismatchCount).toBe(1);
    expect(row?.notWiredCount).toBe(1);
    expect(row?.executionImpact).toBe('NONE');
    expect(row?.liveExecutionAllowed).toBe(false);
    expect(row?.policyPromotionMode).toBe('SHADOW_ONLY');
  });

  it('/scan_blockers formatter includes ADR-0477 compact section without raw Telegram HTML', () => {
    const route = notWiredRoute();
    const formatted = formatInvestorFlowProviderRouterAdr0477(route) ?? '';

    expect(formatted).toContain('Investor Flow Provider Router (ADR-0477)');
    expect(formatted).toContain('수급 악화가 아니라 수급 데이터 라우팅/커버리지 문제입니다.');
    expect(formatted).toContain('UNKNOWN/provider issue는 bearish로 변환되지 않습니다.');
    expect(formatted).not.toContain('<b>');
    expect(scanDiagnosticsSource()).toContain('formatInvestorFlowProviderRouterAdr0477');
    expect(scanDiagnosticsSource()).toContain('[ADR-0477] InvestorFlowProviderRouter build failed');
  });





  it('selects ADR-0491 sanitized cache lookup hits and keeps key mismatches diagnostic', () => {
    const route = buildInvestorFlowProviderRouteResultAdr0477({
      code: '005930',
      naverCollectorWired: false,
      supplySnapshotCacheLookupAdr0491: {
        status: 'CACHE_STALE_HIT',
        snapshot: null,
        cacheRaw: { code: '005930', sourceDate: '2026-05-08', foreignNetBuy: 100, institutionNetBuy: 100, status: 'STALE' },
        retained: 3,
        reason: 'STALE_SANITIZED_SNAPSHOT_HIT_OBSERVE_ONLY',
        stale: true,
        executionImpact: 'NONE',
        liveExecutionAllowed: false,
        policyPromotionMode: 'SHADOW_ONLY',
        rawPayloadPersistenceAllowed: false,
      },
    });
    expect(route.selectedProvider).toBe('CACHE');
    expect(route.providerStatuses.CACHE).toBe('CACHE_STALE_HIT');
    expect(route.signal).toBe('UNKNOWN');
    expect(route.liveExecutionAllowed).toBe(false);
    expect(route.diagnostics.join(' ')).toContain('cacheLookupResult=CACHE_STALE_HIT');

    const mismatch = buildInvestorFlowProviderRouteResultAdr0477({
      code: '005930',
      naverCollectorWired: false,
      supplySnapshotCacheLookupAdr0491: {
        status: 'CACHE_KEY_MISMATCH',
        snapshot: null,
        cacheRaw: null,
        retained: 3,
        reason: 'SOURCE_ALIAS_MISMATCH',
        stale: false,
        debug: {
          lookupKey: 'route=investor_flow|domain=SUPPLY|code=005930|source=NAVER_INVESTOR_TREND|dates=2026-05-11',
          triedKeys: ['domain=SUPPLY|code=005930|source=NAVER_INVESTOR_TREND|tradingDate=2026-05-11|normalized=true'],
          retainedSummary: {
            total: 3,
            byDomain: { SUPPLY: 2, SECTOR: 1 },
            bySource: { KRX_INVESTOR_FLOW: 2, NAVER_INVESTOR_TREND: 1 },
            byProvider: { KRX: 2, NAVER: 1 },
            normalized: { true: 2, false: 1, missing: 0 },
            byTradingDate: { '2026-05-04': 2, '2026-05-11': 1 },
            sampleKeys: ['domain=SUPPLY source=KRX_INVESTOR_FLOW provider=KRX code=005930 tradingDate=2026-05-04 normalized=true'],
          },
          routerLookup: {
            requestedCode: '005930',
            normalizedCode: '005930',
            route: 'investor_flow',
            domainCandidates: ['SUPPLY'],
            sourceCandidates: ['NAVER_INVESTOR_TREND'],
            providerCandidates: ['NAVER', 'CACHE'],
            tradingDateCandidates: ['2026-05-11', '2026-05-08'],
            requireNormalized: true,
            allowStale: true,
            rawPayloadPersistenceAllowed: false,
            liveExecutionAllowed: false,
          },
          mismatchHints: ['SOURCE_ALIAS_MISMATCH'],
          closestMatches: [{ code: '005930', symbol: '005930', source: 'KRX_INVESTOR_FLOW', provider: 'KRX', tradingDate: '2026-05-04', sourceDate: '2026-05-04', normalized: true, reason: 'SOURCE_ALIAS_MISMATCH' }],
        },
        executionImpact: 'NONE',
        liveExecutionAllowed: false,
        policyPromotionMode: 'SHADOW_ONLY',
        rawPayloadPersistenceAllowed: false,
      },
    });
    expect(mismatch.selectedProvider).toBe('NONE');
    expect(mismatch.providerStatuses.CACHE).toBe('CACHE_KEY_MISMATCH');
    expect(mismatch.diagnostics.join(' ')).toContain('cacheLookupResult=CACHE_KEY_MISMATCH');
    expect(mismatch.providerReasons.CACHE).toContain('mismatchHints=SOURCE_ALIAS_MISMATCH');
    expect(mismatch.diagnostics.join(' ')).toContain('retainedSummary=total=3');
    expect(mismatch.diagnostics.join(' ')).toContain('routerLookup=requestedCode=005930');
    expect(mismatch.diagnostics.join(' ')).toContain('closestMatches=1.code=005930');
    expect(mismatch.diagnostics.join(' ')).toContain('rawPayloadPersistenceAllowed=false');
    expect(mismatch.diagnostics.join(' ')).toContain('liveExecutionAllowed=false');
  });

  it('Supply Health formatter does not show READY_FOR_SHADOW registry providers as NOT_WIRED', () => {
    const route = buildInvestorFlowProviderRouteResultAdr0477({
      code: '005930',
      naverCollectorWired: false,
      freshDataSupplyAdr0487: {
        generatedAt: '2026-05-11T00:00:00.000Z', registrations: [], domainSummaries: [], overallStatus: 'PARTIAL', topGaps: [], recommendedNextActions: [], executionImpact: 'NONE', liveExecutionAllowed: false, policyPromotionMode: 'SHADOW_ONLY', operatorApprovalRequired: true, diagnostics: [],
        snapshots: [
          { sourceId: 'NAVER_INVESTOR_TREND', domain: 'SUPPLY', provider: 'NAVER', stage: 'SHADOW_ONLY', collectedAt: '2026-05-11T00:00:00.000Z', sourceDate: '2026-05-11', cacheState: 'FRESH', sourceState: 'FRESH', cacheAgeMinutes: 1, sourceAgeTradingDays: 0, coverageRatio: 1, normalized: true, status: 'READY_FOR_SHADOW', confidence: 'LOW', isProviderIssue: false, isMarketSignal: false, executionImpact: 'NONE', liveExecutionAllowed: false, operatorApprovalRequired: true, diagnostics: [] },
          { sourceId: 'SEMANTIC_NETBUY', domain: 'SUPPLY', provider: 'INTERNAL', stage: 'SHADOW_ONLY', collectedAt: '2026-05-11T00:00:00.000Z', sourceDate: '2026-05-11', cacheState: 'FRESH', sourceState: 'FRESH', cacheAgeMinutes: 1, sourceAgeTradingDays: 0, coverageRatio: 1, normalized: true, status: 'READY_FOR_SHADOW', confidence: 'LOW', isProviderIssue: false, isMarketSignal: false, executionImpact: 'NONE', liveExecutionAllowed: false, operatorApprovalRequired: true, diagnostics: [] },
        ],
      },
    });
    const warmup = buildSupplyProviderWarmupReport({
      investorFlowRouter: { status: route.status, selectedProvider: route.selectedProvider, providerTried: route.providerTried, providerStatuses: route.providerStatuses, signal: route.signal, coverage: route.coverage, executionImpact: 'NONE', liveExecutionAllowed: false },
    });
    const formatted = formatSupplyProviderWarmupCompactLine(warmup);

    expect(formatted).toContain('NAVER: READY_FOR_SHADOW / NORMALIZED_SAMPLE');
    expect(formatted).toContain('Semantic NetBuy: READY_FOR_SHADOW / NORMALIZED_SAMPLE');
    expect(formatted).not.toContain('NAVER: NOT_WIRED');
  });

  it('static guardrails keep live execution, thresholds, Kelly, and external IO unchanged', () => {
    const changedSources = [
      routerSource(),
      scanDiagnosticsSource(),
      observationLedgerSource(),
    ].join('\n');

    expect(changedSources).not.toMatch(/placeKisMarketBuyOrder|placeKisSellOrder|placeKisStopLossOrder|placeKisTakeProfitOrder|cancelKisOrder/);
    expect(changedSources).not.toMatch(/fetch\(|axios/);
    expect(changedSources).not.toMatch(/setGateThreshold|GATE_RELAX|STRONG_BUY_OVERRIDE/);
    expect(changedSources).not.toMatch(/requiredScore\s*[:=]\s*6[05]/);
    expect(changedSources).not.toContain("liveExecutionAllowed: true");
    expect(changedSources).not.toContain("executionImpact: 'HARD_BLOCK'");
  });

  it('Runtime Pipeline Audit can count ADR-0477 evidence without changing rollout status', () => {
    const route = notWiredRoute();
    const rows = buildGate1DryRunObservationRows({
      forDate: '2026-05-09',
      investorFlowProviderRouter: route,
    });

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((row) => row.source === 'ADR_0477_INVESTOR_FLOW_PROVIDER_ROUTER')).toBe(true);
    expect(observationLedgerSource()).toContain('ADR_0477_INVESTOR_FLOW_PROVIDER_ROUTER');
  });

  it('ADR documentation exists and states SHADOW_ONLY promotion guard', () => {
    const doc = read('../../../docs/adr/0477-investor-flow-provider-router-wiring.md');
    const index = read('../../../docs/adr/INDEX.md');

    expect(doc).toContain('Status: Accepted / Shadow-only dry-run');
    expect(doc).toContain('Provider issue remains separated from market signal');
    expect(doc).toContain('UNKNOWN remains UNKNOWN');
    expect(index).toContain('| 0477 | investor-flow-provider-router-wiring.');
    expect(index).toContain('다음 발급');
  });
});

describe('ADR-0477 investor flow provider router evidence for ADR-0480', () => {
  it('selectedProvider=NONE remains diagnostic action guidance only', () => {
    const report = buildOperatorActionQueueAdr0480({ sources: [{ adr: '0477', sectionId: 'investor_flow_router', code: 'selectedProvider', diagnosticKey: 'selectedProvider', diagnosticValue: 'selectedProvider=NONE', severity: 'DATA_UNAVAILABLE' }] });
    expect(report.allActions[0].rootCause).toBe('INVESTOR_FLOW_PROVIDER_UNWIRED');
    expect(report.allActions[0].executionImpact).toBe('NONE');
    expect(report.allActions[0].liveExecutionAllowed).toBe(false);
  });
});
