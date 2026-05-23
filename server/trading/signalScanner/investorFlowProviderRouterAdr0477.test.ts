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

  it('KIS_API selected candidate carries only sanitized semantic row with frgn/orgn aliases mapped', () => {
    const route = buildInvestorFlowProviderRouteResultAdr0477({
      code: '005930',
      kisInvestorRaw: {
        symbol: '005930',
        sourceDate: '2026-05-08',
        frgn_ntby_tr_pbmn: '1,234',
        orgn_ntby_tr_pbmn: '-2,000',
        indv_ntby_tr_pbmn: '766',
      },
      kisTriedForInvestorFlow: true,
    });

    expect(route.selectedProvider).toBe('KIS_API');
    expect(route.semanticRow?.provider).toBe('KIS_API');
    expect(route.semanticRow?.foreignNetBuy).toBe(1234);
    expect(route.semanticRow?.institutionalNetBuy).toBe(-2000);
    expect(route.semanticRow?.individualNetBuy).toBe(766);
    expect(route.semanticRow?.sourceFields.foreign).toBe('frgn_ntby_tr_pbmn');
    expect(route.semanticRow?.rawFieldKeys).toContain('frgn_ntby_tr_pbmn');
    expect(route.kisRawRowAvailableAtAdapter).toBe(true);
    expect(route.kisNormalizedRowAvailableAtRouter).toBe(true);
    expect(route.kisSelectedCandidateCarriesSemanticRow).toBe(true);
    expect(route.rawPayloadPersistenceAllowed).toBe(false);
    expect(JSON.stringify(route.semanticRow)).not.toContain('token');
  });

  it('normalizes investor-flow source keys for FreshData, health, and cache bridges', () => {
    expect(normalizeInvestorFlowSourceKey('NAVER')).toBe('NAVER_INVESTOR_TREND');
    expect(normalizeInvestorFlowSourceKey('NAVER_INVESTOR_TREND')).toBe('NAVER_INVESTOR_TREND');
    expect(normalizeInvestorFlowSourceKey('Semantic NetBuy')).toBe('SEMANTIC_NETBUY');
    expect(normalizeInvestorFlowSourceKey('semantic_netbuy')).toBe('SEMANTIC_NETBUY');
    expect(normalizeInvestorFlowSourceKey('KRX')).toBe('KRX_INVESTOR_FLOW');
    expect(normalizeInvestorFlowSourceKey('KIS')).toBe('KIS_API');
    expect(normalizeInvestorFlowSourceKey('SUPPLY_SNAPSHOT_CACHE')).toBe('CACHE');
  });


  it('keeps disabled KRX out of selectedProvider and Gate/live paths', () => {
    const prev = process.env.KIS_FIRST_REBUILD_MODE;
    process.env.KIS_FIRST_REBUILD_MODE = 'true';
    try {
      const route = buildInvestorFlowProviderRouteResultAdr0477({
        code: '005930',
        krxInvestorDiagnosticAdr0505: {
          status: 'DISABLED_BY_KIS_FIRST_MODE',
          provider: 'KRX',
          providerIssue: false,
          marketSignal: false,
          executionImpact: 'NONE',
          parserStatus: 'DISABLED_BY_KIS_FIRST_MODE',
          endpointIssueHint: 'NONE',
          endpoint: 'MDCSTAT02201',
          bld: 'dbms/MDC/STAT/standard/MDCSTAT02201',
          tradeDate: '20260508',
          previousTradingDateCandidate: '2026-05-08',
          routePurpose: 'MARKET_LEVEL',
          selectedBld: 'dbms/MDC/STAT/standard/MDCSTAT02201',
          diagnosticOnly: true,
          useForRouter: false,
          useForGate: false,
          useForLive: false,
          useForShadow: false,
          summary: 'status=DISABLED_BY_KIS_FIRST_MODE;providerIssue=false;marketSignal=false;executionImpact=NONE',
        },
      });

      expect(route.providerStatuses.KRX_INVESTOR_FLOW).toBe('DISABLED_BY_KIS_FIRST_MODE');
      expect(route.selectedProvider).not.toBe('KRX_INVESTOR_FLOW');
      expect(route.selectedProvider).toBe('NONE');
      expect(route.selectedForShadow).toBe(false);
      expect(route.usedForCurrentGate).toBe(false);
      expect(route.usedForLiveDecision).toBe(false);
      expect(route.executionImpact).toBe('NONE');
      expect(route.providerReasons.KRX_INVESTOR_FLOW).toContain('providerIssue=false');
      expect(route.providerReasons.KRX_INVESTOR_FLOW).toContain('marketSignal=false');
      expect(route.providerReasons.KRX_INVESTOR_FLOW).toContain('useForGate=false');
    } finally {
      if (prev === undefined) delete process.env.KIS_FIRST_REBUILD_MODE;
      else process.env.KIS_FIRST_REBUILD_MODE = prev;
    }
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
    expect(naverRoute.selectedProvider).toBe('NONE');
    expect(naverRoute.providerStatuses.NAVER).toBe('READY_FOR_SHADOW');
    expect(naverRoute.signal).toBe('UNKNOWN');
    expect(naverRoute.liveExecutionAllowed).toBe(false);
    expect(naverRoute.rawPayloadPersistenceAllowed).toBe(false);
    expect(naverRoute.providerReasons.NAVER_INVESTOR_TREND).toContain('selectedProviderCandidate=false');

    const semanticOnly = { ...report, snapshots: [report.snapshots[1]!] };
    const semanticRoute = buildInvestorFlowProviderRouteResultAdr0477({ code: '005930', naverCollectorWired: false, freshDataSupplyAdr0487: semanticOnly });
    expect(semanticRoute.selectedProvider).toBe('NONE');
    expect(semanticRoute.semanticInputStatus).toBe('READY_FOR_SHADOW');
    expect(semanticRoute.diagnostics.join(' ')).toContain('role=DERIVED');
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
    expect(route.rejectedProviders).toContain('NAVER_INVESTOR_TREND');
    expect(route.rejectedReasonByProvider?.NAVER_INVESTOR_TREND).toContain('PLACEHOLDER');
    expect(route.cacheFallbackReason).toContain('CACHE selected');
    expect(route.fallbackChain).toEqual(['KRX_SYMBOL_INVESTOR_FLOW', 'KRX_MARKET_INVESTOR_FLOW', 'KIS_API', 'FSS_PASSIVE_ACTIVE', 'NAVER_INVESTOR_TREND', 'CACHE', 'SEMANTIC_NETBUY']);
    expect(route.coverageAfter).toBe(1);
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

  it('bridges FreshData FSS stale diagnostic provider into router selection without live eligibility', () => {
    const route = buildInvestorFlowProviderRouteResultAdr0477({
      code: '005930',
      naverCollectorWired: false,
      freshDataSupplyAdr0487: {
        generatedAt: '2026-05-11T00:00:00.000Z',
        registrations: [],
        domainSummaries: [],
        overallStatus: 'STALE',
        topGaps: [],
        recommendedNextActions: [],
        executionImpact: 'NONE',
        liveExecutionAllowed: false,
        policyPromotionMode: 'SHADOW_ONLY',
        operatorApprovalRequired: true,
        diagnostics: [],
        snapshots: [{
          sourceId: 'FSS_PASSIVE_ACTIVE',
          domain: 'SUPPLY',
          provider: 'FSS',
          stage: 'OBSERVE',
          collectedAt: '2026-05-11T00:00:00.000Z',
          sourceDate: '2026-04-29',
          cacheState: 'FRESH',
          sourceState: 'STALE',
          cacheAgeMinutes: null,
          sourceAgeTradingDays: 7,
          coverageRatio: 0,
          normalized: false,
          status: 'STALE',
          confidence: 'LOW',
          isProviderIssue: true,
          isMarketSignal: false,
          executionImpact: 'NONE',
          liveExecutionAllowed: false,
          operatorApprovalRequired: true,
          sampleMaterialized: false,
          usableForRouter: false,
          usableForShadow: false,
          usableForLive: false,
          readinessKind: 'REGISTRY_READY',
          sourceOfTruth: 'FRESH_DATA_STATUS',
          diagnostics: ['FreshData aggregate provider=FSS confidence=STALE status=OBSERVING'],
        }],
      },
    });

    expect(route.selectedProvider).toBe('FSS_PASSIVE_ACTIVE');
    expect(route.status).toBe('STALE');
    expect(route.signal).toBe('UNKNOWN');
    expect(route.coverage.available).toBe(0);
    expect(route.routerUsableCoverage?.available).toBe(0);
    expect(route.diagnosticUsableCoverage?.available).toBeGreaterThanOrEqual(1);
    expect(route.selectedDiagnosticProvider).toBe('FSS_PASSIVE_ACTIVE');
    expect(route.selectedDiagnosticReason).toContain('FreshData aggregate diagnostic provider=FSS');
    expect(route.inputSources).toContain('FSS_PASSIVE_ACTIVE');
    expect(route.selectedForLive).toBe(false);
    expect(route.selectedForShadow).toBe(true);
    expect(route.liveExecutionAllowed).toBe(false);
    expect(route.executionImpact).toBe('NONE');
  });

  it('uses CACHE_HIT as diagnostic fallback even when no materialized cache row exists', () => {
    const route = buildInvestorFlowProviderRouteResultAdr0477({
      code: '005930',
      naverCollectorWired: false,
      supplySnapshotCacheLookupAdr0491: {
        status: 'CACHE_HIT',
        snapshot: null,
        cacheRaw: null,
        retained: 1,
        reason: 'SANITIZED_SNAPSHOT_CACHE_HIT',
        stale: false,
        executionImpact: 'NONE',
        liveExecutionAllowed: false,
        policyPromotionMode: 'SHADOW_ONLY',
        rawPayloadPersistenceAllowed: false,
      },
    });

    expect(route.selectedProvider).toBe('CACHE');
    expect(route.status).toBe('OBSERVING');
    expect(route.coverage.available).toBe(0);
    expect(route.routerUsableCoverage?.available).toBe(0);
    expect(route.diagnosticUsableCoverage?.available).toBe(1);
    expect(route.selectedDiagnosticProvider).toBe('CACHE');
    expect(route.inputSources).toContain('CACHE');
    expect(route.cacheFallbackUsed).toBe(true);
    expect(route.materializationDiagnostics?.CACHE?.sampleMaterialized).toBe(false);
    expect(route.selectedForLive).toBe(false);
    expect(route.selectedForShadow).toBe(true);
  });

  it('demotes CACHE_STALE_HIT to diagnostic fallback in KIS-first rebuild mode', () => {
    const previous = process.env.KIS_FIRST_REBUILD_MODE;
    process.env.KIS_FIRST_REBUILD_MODE = 'true';
    try {
      const route = buildInvestorFlowProviderRouteResultAdr0477({
        code: '005930',
        naverCollectorWired: false,
        krxInvestorDiagnosticAdr0505: {
          parserStatus: 'PROVIDER_EMPTY_RESPONSE',
          endpointIssueHint: 'ENDPOINT_PARAMETER_ERROR',
          endpoint: 'MDCSTAT02201',
          bld: 'dbms/MDC/STAT/standard/MDCSTAT02201',
          tradeDate: '20260508',
          previousTradingDateCandidate: '2026-05-08',
          contentType: 'empty',
          httpStatus: 400,
          responseKind: 'HTTP_ERROR',
          consecutiveFailures: 2,
          cooldownActive: true,
          cooldownRemainingMs: 60 * 60 * 1000,
          offHoursSuppressed: true,
          diagnosticOnly: true,
          useForRouter: false,
          useForGate: false,
          useForLive: false,
          useForShadow: true,
          rawTopLevelKeys: [],
          detectedCandidatePaths: [],
          selectedRowPath: null,
          selectedRowCount: 0,
          firstRowKeys: [],
          normalizedRows: 0,
          fieldMappings: {
            symbol: null,
            date: null,
            investorType: null,
            foreignNetBuy: null,
            institutionNetBuy: null,
            individualNetBuy: null,
            netBuyAmount: null,
            netBuyVolume: null,
          },
          summary: 'MDCSTAT02201;httpStatus=400;offHoursSuppressed=true;consecutiveFailures=2',
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

      expect(route.kisFirstMode).toBe(true);
      expect(route.selectedProvider).toBe('NONE');
      expect(route.fallbackProvider).toBe('CACHE');
      expect(route.fallbackStatus).toBe('CACHE_STALE_HIT');
      expect(route.fallbackDiagnosticOnly).toBe(true);
      expect(route.selectedReason).toBe('NO_FRESH_SEMANTIC_NETBUY');
      expect(route.providerStatuses.KRX_INVESTOR_FLOW).toBe('QUARANTINED');
      expect(route.krxSourceRepairDiagnostic?.offHoursSuppressed).toBe(true);
      expect(route.routerUsableCoverage?.available).toBe(0);
      expect(route.diagnosticUsableCoverage?.available).toBeGreaterThanOrEqual(1);
      expect(route.selectedForLive).toBe(false);
      expect(route.selectedForShadow).toBe(false);
      expect(route.executionImpact).toBe('NONE');
      expect(route.diagnostics.join(' ')).toContain('fallbackDiagnosticOnly=true');
      expect(formatInvestorFlowProviderRouterAdr0477(route)).toContain('usedForCurrentGate: false');
    } finally {
      if (previous === undefined) delete process.env.KIS_FIRST_REBUILD_MODE;
      else process.env.KIS_FIRST_REBUILD_MODE = previous;
    }
  });

  it('still allows CACHE_HIT as a KIS-first diagnostic selected provider', () => {
    const previous = process.env.KIS_FIRST_REBUILD_MODE;
    process.env.KIS_FIRST_REBUILD_MODE = 'true';
    try {
      const route = buildInvestorFlowProviderRouteResultAdr0477({
        code: '005930',
        naverCollectorWired: false,
        supplySnapshotCacheLookupAdr0491: {
          status: 'CACHE_HIT',
          snapshot: null,
          cacheRaw: { code: '005930', sourceDate: '2026-05-11', foreignNetBuy: 100, institutionNetBuy: 100, status: 'CACHE_HIT' },
          retained: 1,
          reason: 'SANITIZED_SNAPSHOT_CACHE_HIT',
          stale: false,
          executionImpact: 'NONE',
          liveExecutionAllowed: false,
          policyPromotionMode: 'SHADOW_ONLY',
          rawPayloadPersistenceAllowed: false,
        },
      });

      expect(route.selectedProvider).toBe('CACHE');
      expect(route.providerStatuses.CACHE).toBe('CACHE_HIT');
      expect(route.fallbackDiagnosticOnly).toBe(false);
      expect(route.selectedForLive).toBe(false);
      expect(route.executionImpact).toBe('NONE');
    } finally {
      if (previous === undefined) delete process.env.KIS_FIRST_REBUILD_MODE;
      else process.env.KIS_FIRST_REBUILD_MODE = previous;
    }
  });

  it('keeps CACHE shadow fallback selected while decomposing KRX empty response diagnostics', () => {
    const route = buildInvestorFlowProviderRouteResultAdr0477({
      code: '005930',
      naverCollectorWired: true,
      krxInvestorDiagnosticAdr0505: {
        parserStatus: 'PROVIDER_EMPTY_RESPONSE',
        endpointIssueHint: 'ENDPOINT_PARAMETER_ERROR',
        endpoint: 'MDCSTAT02203',
        bld: 'dbms/MDC/STAT/standard/MDCSTAT02203',
        tradeDate: '20260508',
        previousTradingDateCandidate: '2026-05-08',
        contentType: 'json',
        httpStatus: 200,
        responseKind: 'EMPTY',
        rawTopLevelKeys: ['output'],
        detectedCandidatePaths: ['output:len=0'],
        selectedRowPath: 'output',
        selectedRowCount: 0,
        firstRowKeys: [],
        normalizedRows: 0,
        fieldMappings: {
          symbol: null,
          date: null,
          investorType: null,
          foreignNetBuy: null,
          institutionNetBuy: null,
          individualNetBuy: null,
          netBuyAmount: null,
          netBuyVolume: null,
        },
        summary: 'MDCSTAT02203;contentType=json;responseKind=EMPTY;normalizedRows=0',
      },
      supplySnapshotCacheLookupAdr0491: {
        status: 'CACHE_HIT',
        snapshot: null,
        cacheRaw: {
          code: '005930',
          sourceDate: '2026-05-08',
          foreignNetBuy: 100,
          institutionNetBuy: 200,
          status: 'CACHE_HIT',
        },
        retained: 1,
        reason: 'SANITIZED_SNAPSHOT_CACHE_HIT',
        stale: false,
        executionImpact: 'NONE',
        liveExecutionAllowed: false,
        policyPromotionMode: 'SHADOW_ONLY',
        rawPayloadPersistenceAllowed: false,
      },
    });

    expect(route.selectedProvider).toBe('CACHE');
    expect(route.status).toBe('CACHE_HIT');
    expect(route.providerStatuses.KRX_INVESTOR_FLOW).toBe('PROVIDER_EMPTY_RESPONSE');
    expect(route.providerReasons.KRX_INVESTOR_FLOW).toContain('krxEmptyRecovery=PARAMETER_MISMATCH');
    expect(route.providerReasons.KRX_INVESTOR_FLOW).toContain('recoveryAction=RETRY_KRX_PAYLOAD_VARIANTS_IN_OBSERVE_MODE');
    expect(route.providerReasons.KRX_INVESTOR_FLOW).toContain('safeToFallback=true');
    expect(route.providerReasons.KRX_INVESTOR_FLOW).toContain('previousTradingDateCandidate=2026-05-08');
    expect(route.providerReasons.KRX_INVESTOR_FLOW).toContain('contentType=json');
    expect(route.providerReasons.KRX_INVESTOR_FLOW).toContain('responseKeySummary=output:len=0');
    expect(route.providerReasons.KRX_INVESTOR_FLOW).toContain('marketSignal=false');
    expect(route.providerReasons.KRX_INVESTOR_FLOW).toContain('[PROVIDER_HEALTH_SEPARATED_FROM_MARKET_SIGNAL]');
    expect(route.krxSourceRepairDiagnostic?.parserStatus).toBe('PROVIDER_EMPTY_RESPONSE');
    expect(route.cacheFallbackUsed).toBe(true);
    expect(route.liveExecutionAllowed).toBe(false);
    expect(route.executionImpact).toBe('NONE');
    expect(formatInvestorFlowProviderRouterAdr0477(route)).toContain('krxSourceRepair');
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

    expect(positive.signal).toBe('UNKNOWN');
    expect(positive.selectedProvider).toBe('NONE');
    expect(positive.providerReasons.NAVER_INVESTOR_TREND).toContain('selectedProviderCandidate=false');
    expect(positive.liveExecutionAllowed).toBe(false);
    expect(negative.signal).toBe('UNKNOWN');
    expect(staleNegative.signal).toBe('UNKNOWN');
  });

  it('keeps ADR-0481 NAVER investor trend collector diagnostic-only while cache can route', () => {
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

    expect(route.selectedProvider).toBe('CACHE');
    expect(route.providerTried).toEqual(['KRX_SYMBOL_INVESTOR_FLOW', 'KRX_MARKET_INVESTOR_FLOW', 'KIS_API', 'FSS_PASSIVE_ACTIVE', 'NAVER_INVESTOR_TREND', 'CACHE', 'SEMANTIC_NETBUY']);
    expect(route.coverage.available).toBeGreaterThanOrEqual(1);
    expect(route.materializationDiagnostics?.NAVER_INVESTOR_TREND?.sampleMaterialized).toBe(true);
    expect(route.materializationDiagnostics?.NAVER_INVESTOR_TREND?.usableForRouter).toBe(true);
    expect(route.providerReasons.NAVER_INVESTOR_TREND).toContain('selectedProviderCandidate=false');
    expect(route.liveExecutionAllowed).toBe(false);
    expect(route.executionImpact).toBe('NONE');
  });

  it('keeps SemanticNetBuy normalized samples derived shadow-only without source-of-truth selection', () => {
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

    expect(route.selectedProvider).toBe('NONE');
    expect(route.providerStatuses.SEMANTIC_NETBUY).toBe('VERIFIED');
    expect(route.semanticNetBuy).toBeNull();
    expect(route.diagnostics.join(' ')).toContain('selectedProvider remains real-source-only');
    expect(route.signal).toBe('UNKNOWN');
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
    expect(unavailableRoute.rejectedReasonByProvider?.SEMANTIC_NETBUY).toContain('NO_INPUT_SAMPLE');
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
    expect(route.cacheFallbackReason).toContain('CACHE selected');
    expect(formatInvestorFlowProviderRouterAdr0477(route)).toContain('rejectedReasonByProvider');
    expect(route.signal).toBe('UNKNOWN');
    expect(route.liveExecutionAllowed).toBe(false);
  });

  it('recovers selectedProvider from CACHE_HIT valid sanitized rows when NAVER and Semantic are missing', () => {
    const route = buildInvestorFlowProviderRouteResultAdr0477({
      code: '005930',
      naverCollectorWired: true,
      semanticNetBuyNormalizationAdr0482: buildSemanticNetBuyNormalizationReportAdr0482({ code: '005930', inputs: [] }),
      supplySnapshotCacheLookupAdr0491: {
        status: 'CACHE_HIT',
        snapshot: null,
        cacheRaw: {
          code: '005930',
          sourceDate: '2026-05-08',
          foreignNetBuy: 100,
          institutionNetBuy: 200,
          programNetBuy: 10,
          status: 'CACHE_HIT',
        },
        retained: 1,
        reason: 'SANITIZED_SNAPSHOT_CACHE_HIT',
        stale: false,
        executionImpact: 'NONE',
        liveExecutionAllowed: false,
        policyPromotionMode: 'SHADOW_ONLY',
        rawPayloadPersistenceAllowed: false,
      },
      kisTriedForInvestorFlow: true,
      nonTradingDay: true,
    });

    expect(route.selectedProvider).toBe('CACHE');
    expect(route.status).toBe('CACHE_HIT');
    expect(route.coverage.available).toBeGreaterThanOrEqual(1);
    expect(route.materializationDiagnostics?.CACHE).toMatchObject({
      sampleMaterialized: true,
      usableForRouter: true,
      materializedCount: 1,
      placeholderDetected: false,
      blockedReason: 'NONE',
    });
    expect(route.rejectedProviders).not.toContain('CACHE');
    expect(route.noMaterializedCandidateReason).toBeNull();
    expect(route.liveExecutionAllowed).toBe(false);
    expect(route.executionImpact).toBe('NONE');
  });

  it('materializes CACHE_HIT from sanitized snapshot when cacheRaw is missing', () => {
    const route = buildInvestorFlowProviderRouteResultAdr0477({
      code: '005930',
      naverCollectorWired: false,
      supplySnapshotCacheLookupAdr0491: {
        status: 'CACHE_HIT',
        snapshot: {
          scanId: 'scan-cache-hit',
          recordedAt: '2026-05-11T00:00:00.000Z',
          tradingDate: '2026-05-08',
          domains: ['SUPPLY'],
          supplyStatus: 'CACHE_HIT',
          sectorStatus: 'EMPTY',
          programStatus: 'EMPTY',
          providerIssue: false,
          marketSignal: false,
          sampleCounts: { supply: 1, sector: 0, program: 0 },
          latestInvestorFlowSample: {
            symbol: '005930',
            provider: 'CACHE',
            dataDate: '2026-05-08',
            foreignNetBuy: 123,
            institutionNetBuy: 456,
            retailNetBuy: -579,
            confidence: 'VERIFIED',
            status: 'FRESH',
            isProviderIssue: false,
            isMarketSignal: false,
          },
          adr0496SupplyCoverage: null,
          executionImpact: 'NONE',
          liveExecutionAllowed: false,
          policyPromotionMode: 'SHADOW_ONLY',
          operatorApprovalRequired: true,
          rawProviderPayloadPersisted: false,
          diagnostics: [],
        },
        cacheRaw: null,
        retained: 120,
        reason: 'SANITIZED_SNAPSHOT_CACHE_HIT',
        stale: false,
        executionImpact: 'NONE',
        liveExecutionAllowed: false,
        policyPromotionMode: 'SHADOW_ONLY',
        rawPayloadPersistenceAllowed: false,
      },
      nonTradingDay: true,
    });

    expect(route.selectedProvider).toBe('CACHE');
    expect(route.status).toBe('CACHE_HIT');
    expect(route.coverage.available).toBeGreaterThanOrEqual(1);
    expect(route.materializationDiagnostics?.CACHE).toMatchObject({
      sampleMaterialized: true,
      materializedCount: 1,
      placeholderDetected: false,
      usableForRouter: true,
      blockedReason: 'NONE',
    });
    expect(route.rejectedReasonByProvider?.CACHE).toBeUndefined();
    expect(route.executionImpact).toBe('NONE');
    expect(route.liveExecutionAllowed).toBe(false);
  });

  it('ranks multi-source materialized candidates KRX, KIS, FSS, NAVER, CACHE, then SEMANTIC', () => {
    const cacheLookup = {
      status: 'CACHE_HIT' as const,
      snapshot: null,
      cacheRaw: { code: '005930', sourceDate: '2026-05-08', foreignNetBuy: 1, institutionNetBuy: 1, status: 'CACHE_HIT' },
      retained: 1,
      reason: 'SANITIZED_SNAPSHOT_CACHE_HIT',
      stale: false,
      executionImpact: 'NONE' as const,
      liveExecutionAllowed: false as const,
      policyPromotionMode: 'SHADOW_ONLY' as const,
      rawPayloadPersistenceAllowed: false as const,
    };

    const krx = buildInvestorFlowProviderRouteResultAdr0477({
      code: '005930',
      naverCollectorWired: true,
      previousTradingDayKrxRaw: { code: '005930', sourceDate: '2026-05-08', foreignNetBuy: 10, institutionalNetBuy: 20, status: 'STALE' },
      supplySnapshotCacheLookupAdr0491: cacheLookup,
      nonTradingDay: true,
    });
    expect(krx.selectedProvider).toBe('KRX_INVESTOR_FLOW');
    expect(krx.materializationDiagnostics?.KRX_INVESTOR_FLOW?.usableForRouter).toBe(true);
    expect(krx.coverage.available).toBeGreaterThanOrEqual(2);
    expect(krx.cacheFallbackUsed).toBe(false);
    expect(krx.diagnostics.join(' ')).toContain('sourceOfTruth=KRX');

    const kis = buildInvestorFlowProviderRouteResultAdr0477({
      code: '005930',
      kisInvestorRaw: { code: '005930', sourceDate: '2026-05-08', foreignNetBuy: 30, institutionalNetBuy: 40 },
      previousTradingDayKrxRaw: { code: '005930', sourceDate: '2026-05-08', foreignNetBuy: 10, institutionalNetBuy: 20, status: 'STALE' },
      supplySnapshotCacheLookupAdr0491: cacheLookup,
      kisTriedForInvestorFlow: true,
    });
    expect(kis.selectedProvider).toBe('KRX_INVESTOR_FLOW');
    expect(kis.providerStatuses.KIS_API).toBe('VERIFIED');
    expect(kis.providerReasons.KIS_API).toContain('route separated');

    const fss = buildInvestorFlowProviderRouteResultAdr0477({
      code: '005930',
      naverCollectorWired: true,
      fssPassiveActiveRaw: { code: '005930', sourceDate: '2026-05-01', foreignNetBuy: 5, institutionNetBuy: 6, status: 'STALE' },
      fssSourceAgeTradingDays: 7,
    });
    expect(fss.selectedProvider).toBe('FSS_PASSIVE_ACTIVE');
    expect(fss.status).toBe('STALE');
    expect(fss.materializationDiagnostics?.FSS_PASSIVE_ACTIVE?.usableForRouter).toBe(true);
  });

  it('selects KRX_SYMBOL_INVESTOR_FLOW when KRX diagnostics identify a symbol-level materialized row', () => {
    const route = buildInvestorFlowProviderRouteResultAdr0477({
      code: '005930',
      previousTradingDayKrxRaw: { code: '005930', sourceDate: '2026-05-08', foreignNetBuy: 10, institutionalNetBuy: 20, status: 'VERIFIED' },
      krxInvestorDiagnosticAdr0505: {
        parserStatus: 'OK',
        endpointIssueHint: 'NONE',
        endpoint: 'MDCSTAT02401',
        bld: 'dbms/MDC/STAT/standard/MDCSTAT02401',
        tradeDate: '20260508',
        previousTradingDateCandidate: '2026-05-08',
        selectedKrxFlowMode: 'OTP_CSV',
        routePurpose: 'SYMBOL_LEVEL',
        selectedBld: 'dbms/MDC/STAT/standard/MDCSTAT02401',
        shortCodeToIsuCdResolved: true,
        isuCd: 'KR7005930003',
        inqVal: '2',
        selectedVariant: 'OTP_CSV:MDCSTAT02401:SYMBOL_INVESTOR_FLOW:ALL:strtDd/endDd:isuCd=resolved:inqVal=2:symbol',
        csvDownloaded: true,
        csvRowCount: 3,
        csvHeaderDetected: true,
        csvNoDataReason: null,
        contentType: 'csv',
        responseKind: 'CSV',
        selectedRowCount: 3,
        normalizedRows: 1,
        summary: 'MDCSTAT02401;routePurpose=SYMBOL_LEVEL;selectedKrxFlowMode=OTP_CSV;csvRowCount=3',
      },
    });

    expect(route.selectedProvider).toBe('KRX_SYMBOL_INVESTOR_FLOW');
    expect(route.materializationDiagnostics?.KRX_SYMBOL_INVESTOR_FLOW?.usableForRouter).toBe(true);
    expect(route.krxSourceRepairDiagnostic?.routePurpose).toBe('SYMBOL_LEVEL');
    expect(route.krxSourceRepairDiagnostic?.isuCd).toBe('KR7005930003');
    expect(route.diagnostics.join(' ')).toContain('sourceOfTruth=KRX');
    expect(route.liveExecutionAllowed).toBe(false);
    expect(route.executionImpact).toBe('NONE');
  });

  it('keeps KRX source-of-truth ahead of NAVER and falls back to KIS when KRX has no row', () => {
    const krxWithNaverEmpty = buildInvestorFlowProviderRouteResultAdr0477({
      code: '005930',
      naverCollectorWired: true,
      naverRaw: null,
      previousTradingDayKrxRaw: { code: '005930', sourceDate: '2026-05-08', foreignNetBuy: 10, institutionalNetBuy: 20, status: 'VERIFIED' },
      nonTradingDay: true,
    });
    expect(krxWithNaverEmpty.selectedProvider).toBe('KRX_INVESTOR_FLOW');
    expect(krxWithNaverEmpty.providerStatuses.NAVER_INVESTOR_TREND).not.toBe('VERIFIED');
    expect(krxWithNaverEmpty.diagnostics.join(' ')).toContain('sourceOfTruth=KRX');
    expect(krxWithNaverEmpty.coverage.available).toBeGreaterThan(0);
    expect(krxWithNaverEmpty.liveExecutionAllowed).toBe(false);
    expect(krxWithNaverEmpty.executionImpact).toBe('NONE');

    const kisFallback = buildInvestorFlowProviderRouteResultAdr0477({
      code: '005930',
      naverCollectorWired: true,
      naverRaw: null,
      kisInvestorRaw: { code: '005930', sourceDate: '2026-05-08', foreignNetBuy: 30, institutionalNetBuy: 40 },
      kisTriedForInvestorFlow: true,
    });
    expect(kisFallback.selectedProvider).toBe('KIS_API');
    expect(kisFallback.providerStatuses.KIS_API).toBe('VERIFIED');
    expect(kisFallback.executionImpact).toBe('NONE');
    expect(kisFallback.liveExecutionAllowed).toBe(false);
    expect(kisFallback.selectedForShadow).toBe(true);
    expect(kisFallback.signal).toBe('BULLISH');
  });

  it('allows selectedProvider NONE only when every source has no materialized candidate', () => {
    const route = buildInvestorFlowProviderRouteResultAdr0477({
      code: '005930',
      naverCollectorWired: true,
      semanticNetBuyNormalizationAdr0482: buildSemanticNetBuyNormalizationReportAdr0482({ code: '005930', inputs: [] }),
      cacheRaw: null,
      kisTriedForInvestorFlow: true,
      nonTradingDay: true,
    });

    expect(route.selectedProvider).toBe('NONE');
    expect(route.coverage.available).toBe(0);
    expect(route.noMaterializedCandidateReason).toContain('NO_INPUT_SAMPLE');
    expect(route.rejectedReasonByProvider).toBeTruthy();
    expect(route.liveExecutionAllowed).toBe(false);
  });

  it('keeps NAVER diagnostic-only, prefers CACHE over SemanticNetBuy, and keeps SemanticNetBuy derived', () => {
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
    expect(naverFresh.selectedProvider).toBe('CACHE');
    expect(naverFresh.cacheFallbackUsed).toBe(true);
    expect(naverFresh.providerReasons.NAVER_INVESTOR_TREND).toContain('selectedProviderCandidate=false');

    const semanticFresh = buildInvestorFlowProviderRouteResultAdr0477({
      code: '005930',
      naverCollectorWired: true,
      semanticNetBuyNormalizationAdr0482: buildSemanticNetBuyNormalizationReportAdr0482({
        code: '005930',
        inputs: [{ code: '005930', provider: 'NAVER', sourceDate: '2026-05-11', rawForeignNetBuy: 10, rawInstitutionNetBuy: 20, unit: 'KRW' }],
      }),
      cacheRaw: { foreignNetBuy: 1, institutionNetBuy: 1, sourceDate: '2026-05-04', status: 'STALE' },
    });
    expect(semanticFresh.selectedProvider).toBe('CACHE');
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
    expect(naverStale.selectedProvider).toBe('NONE');
    expect(naverStale.providerStatuses.NAVER_INVESTOR_TREND).toBe('STALE');
    expect(naverStale.signal).toBe('UNKNOWN');

    const semanticStale = buildInvestorFlowProviderRouteResultAdr0477({
      code: '005930',
      naverCollectorWired: true,
      semanticNetBuyNormalizationAdr0482: buildSemanticNetBuyNormalizationReportAdr0482({
        code: '005930',
        inputs: [{ code: '005930', provider: 'CACHE', sourceDate: '2026-05-04', rawForeignNetBuy: 1, rawInstitutionNetBuy: 1, unit: 'KRW', status: 'STALE', sourceAgeTradingDays: 4 }],
      }),
    });
    expect(semanticStale.selectedProvider).toBe('NONE');
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
    expect(scanDiagnosticsSource()).toContain('Legacy diagnostic lane compact summary');
    expect(scanDiagnosticsSource()).toContain('usedForCurrentGate=false');
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

describe('Patch-KIS-INVESTOR-FLOW-SEMANTIC-ROW-CARRY-004', () => {
  it('carries selectedCandidate.rawRow actual investor row and records numeric string keys without order imports', () => {
    const route = buildInvestorFlowProviderRouteResultAdr0477({
      code: '005930',
      kisInvestorRaw: {
        selectedCandidate: {
          rawRow: { frgn_ntby_tr_pbmn: '1,000', orgn_ntby_tr_pbmn: '2,000', accountNo: 'SHOULD_NOT_PERSIST' },
        },
      },
      kisTriedForInvestorFlow: true,
    });

    expect(route.selectedProvider).toBe('KIS_API');
    expect(route.sanitizedInvestorFlowRows?.length).toBeGreaterThan(0);
    expect(route.selectedActualRowPath).toBe('input.selectedCandidate.rawRow');
    expect(route.selectedActualNumericStringFieldKeys).toContain('frgn_ntby_tr_pbmn');
    expect(route.actualInvestorFlowRows?.length).toBeGreaterThan(0);
    expect(route.actualInvestorFlowRowCount).toBeGreaterThan(0);
    expect(route.actualInvestorFlowCarried).toBe(true);
    expect(route.actualInvestorFlowFieldKeys).toContain('orgn_ntby_tr_pbmn');
    expect(route.actualInvestorFlowNumericKeys).toContain('frgn_ntby_tr_pbmn');
    expect(route.selectedCandidate?.actualInvestorFlowRows).toHaveLength(1);
    expect(route.selectedCandidate?.actualInvestorFlowRowCount).toBe(1);
    expect(route.selectedCandidate?.actualInvestorFlowFieldKeys).toContain('frgn_ntby_tr_pbmn');
    expect(route.selectedCandidate?.actualInvestorFlowNumericStringKeys).toContain('orgn_ntby_tr_pbmn');
    expect(route.diagnostics.join('\n')).toContain('selectedCandidateCarriesActualRow=true');
    expect(route.diagnostics.join('\n')).toContain('selectedCandidateActualRowDropReason=SELECTED_CANDIDATE_CARRIES_ACTUAL_ROW');
    expect(JSON.stringify(route.sanitizedInvestorFlowRows)).not.toContain('accountNo');
    expect(routerSource()).not.toMatch(/placeKisMarketBuyOrder|placeKisSellOrder|placeKisStopLossOrder|placeKisTakeProfitOrder|cancelKisOrder/);
  });





  it('carries actual, normalized, and semantic investor rows from KIS adapter through router and selected candidate', () => {
    const route = buildInvestorFlowProviderRouteResultAdr0477({
      code: '005930',
      kisInvestorRaw: {
        symbol: '005930',
        sourceDate: '2026-05-13',
        frgn_ntby_tr_pbmn: '-19,034',
        orgn_ntby_tr_pbmn: '2,500',
        indv_ntby_tr_pbmn: '16,534',
      },
      kisTriedForInvestorFlow: true,
    });

    expect(route.selectedProvider).toBe('KIS_API');
    expect(route.actualInvestorRow).toMatchObject({ frgn_ntby_tr_pbmn: '-19,034' });
    expect(route.normalizedInvestorRow).toMatchObject({ foreignNetBuy: -19034, institutionNetBuy: 2500, individualNetBuy: 16534 });
    expect(route.semanticInvestorRow).toMatchObject({ foreignNetBuy: -19034, institutionalNetBuy: 2500, individualNetBuy: 16534 });
    expect(route.actualRowAvailable).toBe(true);
    expect(route.normalizedRowAvailable).toBe(true);
    expect(route.semanticRowAvailable).toBe(true);
    expect(route.rowCarryPath).toBe('ADAPTER_TO_ROUTER');
    expect(route.selectedCandidate?.actualInvestorRow).toMatchObject({ frgn_ntby_tr_pbmn: '-19,034' });
    expect(route.selectedCandidate?.normalizedInvestorRow).toMatchObject({ foreignNetBuy: -19034 });
    expect(route.selectedCandidate?.semanticInvestorRow).toMatchObject({ institutionalNetBuy: 2500 });
    expect(route.diagnostics.join('\n')).toContain('[SUPPLY_ROUTER_ROW_CARRIED]');
    expect(route.diagnostics.join('\n')).toContain('routerCarriesActualRow=true');
    expect(route.diagnostics.join('\n')).toContain('[SELECTED_CANDIDATE_SUPPLY_ROW_ATTACHED]');
    expect(route.diagnostics.join('\n')).toContain('[SUPPLY_SEMANTIC_FIELD_MAPPED]');
  });


  it('unwraps KIS adapter ActualInvestorFlowRowCarrier from selected candidate without raw payload persistence', () => {
    const route = buildInvestorFlowProviderRouteResultAdr0477({
      code: '005930',
      kisInvestorRaw: {
        actualInvestorFlowRowCarrier: {
          provider: 'KIS_API',
          requestSymbol: '005930',
          normalizedSymbol: '005930',
          providerScope: 'SYMBOL_LEVEL',
          actualRows: [{ frgn_ntby_qty: '11', orgn_ntby_qty: '22', appsecret: 'DROP' }],
          rowSourcePath: 'KIS_INVESTOR_TRADE_BY_STOCK_DAILY.output2[0]',
          rawFieldKeys: ['frgn_ntby_qty', 'orgn_ntby_qty'],
          numericStringFieldKeys: ['frgn_ntby_qty', 'orgn_ntby_qty'],
          numberFieldKeys: [],
          placeholderFieldKeys: [],
          carriedAt: '2026-05-13T00:00:00.000Z',
        },
      },
      kisTriedForInvestorFlow: true,
    });

    expect(route.actualInvestorFlowRows).toHaveLength(1);
    expect(route.actualInvestorFlowRowSourcePath).toBe('input.actualInvestorFlowRowCarrier.actualRows');
    expect(route.semanticRowBreakPoint).toBe('ACTUAL_ROW_CARRIED_WITH_FIELDS');
    expect(JSON.stringify(route.actualInvestorFlowRows)).not.toContain('appsecret');
  });

  it('records normalizedRow path and unwraps nested investorFlowSemanticRow.rawRow while ignoring wrapper metadata only', () => {
    const normalized = buildInvestorFlowProviderRouteResultAdr0477({
      code: '005930',
      kisInvestorRaw: { selectedCandidate: { normalizedRow: { foreignNetBuy: 10, institutionalNetBuy: 20 } } },
      kisTriedForInvestorFlow: true,
    });
    expect(normalized.selectedActualRowPath).toBe('input.selectedCandidate.normalizedRow');
    expect(normalized.selectedActualNumericFieldKeys).toContain('foreignNetBuy');

    const nested = buildInvestorFlowProviderRouteResultAdr0477({
      code: '005930',
      kisInvestorRaw: { selectedCandidate: { investorFlowSemanticRow: { rawRow: { frgn_ntby_tr_pbmn: '3', orgn_ntby_tr_pbmn: '4' } } } },
      kisTriedForInvestorFlow: true,
    });
    expect(nested.selectedActualRowPath).toBe('input.selectedCandidate.investorFlowSemanticRow.rawRow');

    const wrapperOnly = buildInvestorFlowProviderRouteResultAdr0477({
      code: '005930',
      kisInvestorRaw: { selectedCandidate: { materializedCount: 1, normalizedCount: 1, rowCount: 1, providerScope: 'SYMBOL_LEVEL', executionImpact: 'NONE', scoreUsage: 'SHADOW_ONLY' } },
      kisTriedForInvestorFlow: true,
    });
    expect(wrapperOnly.sanitizedInvestorFlowRows).toHaveLength(0);
    expect(wrapperOnly.selectedActualRowPath).toBeNull();
  });
});

describe('ADR-0477 supply actual row carry — adapterRowsForwardedAcrossProviders (사용자 명시 #5/#6)', () => {
  // 사용자 명시 #6 단절 진단: adapterCarriesActualRow=47/47 인데 routerCarriesActualRow=0/47 인 케이스 —
  // KIS adapter 가 actual row 를 보유했지만 selectedProvider 가 KIS_API 가 아닌 경우 router 가 carry.
  const krxStaleCacheLookup = {
    status: 'CACHE_HIT' as const,
    snapshot: null,
    cacheRaw: { code: '005930', sourceDate: '2026-05-08', foreignNetBuy: 1, institutionNetBuy: 1, status: 'CACHE_HIT' },
    retained: 1,
    reason: 'SANITIZED_SNAPSHOT_CACHE_HIT',
    stale: false,
    executionImpact: 'NONE' as const,
    liveExecutionAllowed: false as const,
    policyPromotionMode: 'SHADOW_ONLY' as const,
    rawPayloadPersistenceAllowed: false as const,
  };

  it('forwards KIS adapter actual row when selectedProvider !== KIS_API (was routerCarriesActualRow=0)', () => {
    const route = buildInvestorFlowProviderRouteResultAdr0477({
      code: '005930',
      kisInvestorRaw: {
        symbol: '005930',
        sourceDate: '2026-05-08',
        frgn_ntby_tr_pbmn: '1,234',
        orgn_ntby_tr_pbmn: '-2,000',
        indv_ntby_tr_pbmn: '766',
      },
      previousTradingDayKrxRaw: { code: '005930', sourceDate: '2026-05-08', foreignNetBuy: 10, institutionalNetBuy: 20, status: 'STALE' },
      supplySnapshotCacheLookupAdr0491: krxStaleCacheLookup,
      kisTriedForInvestorFlow: true,
    });

    // selectedProvider 는 CORE 결정 그대로 (KIS_API 가 아님) — 사용자 명시 #9 KRX/KIS CORE 무영향.
    expect(route.selectedProvider).not.toBe('KIS_API');
    // adapter 는 actual row 를 보유 (sanitizedInvestorFlowRows.length > 0).
    expect(route.sanitizedInvestorFlowRows?.length ?? 0).toBeGreaterThan(0);
    // ADR-0477 carry fix — router 가 adapter row 를 forward.
    expect(route.adapterRowsForwardedAcrossProviders).toBe(true);
    expect(route.actualInvestorFlowCarried).toBe(true);
    expect(route.rowCarryPath).toBe('ADAPTER_TO_ROUTER');
    expect(route.actualInvestorRow).not.toBeNull();
    expect(route.actualRowAvailable).toBe(true);
    // diagnostic 단절 라인 — adapterCarriesActualRow=true && routerCarriesActualRow=true.
    expect(route.diagnostics.join(' ')).toContain('adapterCarriesActualRow=true');
    expect(route.diagnostics.join(' ')).toContain('routerCarriesActualRow=true');
    expect(route.diagnostics.join(' ')).toContain('adapterRowsForwardedAcrossProviders=true');
    // bySymbol payload 도 동일 carry.
    const bySymbol = route.bySymbol?.['005930'];
    expect(bySymbol?.adapterRowsForwardedAcrossProviders).toBe(true);
    expect(bySymbol?.actualInvestorFlowCarried).toBe(true);
    expect(bySymbol?.rowCarryPath).toBe('ADAPTER_TO_ROUTER');
    // 안전 invariant — executionImpact / liveExecutionAllowed 보존.
    expect(route.executionImpact).toBe('NONE');
    expect(route.liveExecutionAllowed).toBe(false);
    expect(bySymbol?.executionImpact).toBe('NONE');
    expect(bySymbol?.liveExecutionAllowed).toBe(false);
    expect(bySymbol?.scoreUsage).toBe('SHADOW_ONLY');
  });

  it('does not flag adapterRowsForwardedAcrossProviders when KIS_API itself is selected (regression)', () => {
    const route = buildInvestorFlowProviderRouteResultAdr0477({
      code: '005930',
      kisInvestorRaw: {
        symbol: '005930',
        sourceDate: '2026-05-08',
        frgn_ntby_tr_pbmn: '1,234',
        orgn_ntby_tr_pbmn: '-2,000',
        indv_ntby_tr_pbmn: '766',
      },
      kisTriedForInvestorFlow: true,
    });
    expect(route.selectedProvider).toBe('KIS_API');
    expect(route.sanitizedInvestorFlowRows?.length ?? 0).toBeGreaterThan(0);
    // KIS_API selected — forward across providers 아님 (자기 자신이 selected provider).
    expect(route.adapterRowsForwardedAcrossProviders).toBe(false);
    expect(route.rowCarryPath).toBe('ADAPTER_TO_ROUTER');
    expect(route.bySymbol?.['005930']?.adapterRowsForwardedAcrossProviders).toBe(false);
    expect(route.diagnostics.join(' ')).toContain('adapterRowsForwardedAcrossProviders=false');
  });

  it('keeps adapterRowsForwardedAcrossProviders false when no KIS adapter row exists', () => {
    const route = buildInvestorFlowProviderRouteResultAdr0477({
      code: '005930',
      naverCollectorWired: true,
      previousTradingDayKrxRaw: { code: '005930', sourceDate: '2026-05-08', foreignNetBuy: 10, institutionalNetBuy: 20, status: 'VERIFIED' },
      nonTradingDay: true,
    });
    expect(route.selectedProvider).not.toBe('KIS_API');
    expect(route.sanitizedInvestorFlowRows?.length ?? 0).toBe(0);
    expect(route.adapterRowsForwardedAcrossProviders).toBe(false);
    expect(route.bySymbol?.['005930']?.adapterRowsForwardedAcrossProviders).toBe(false);
    expect(route.diagnostics.join(' ')).toContain('adapterRowsForwardedAcrossProviders=false');
  });
});
