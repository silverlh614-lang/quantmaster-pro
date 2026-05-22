/**
 * @responsibility ADR-0477 investor flow route builder.
 */

import type { NaverInvestorTrendCollectorResult } from '../naverInvestorTrendCollectorAdr0481.js';
import type { SemanticNetBuyNormalizationReportAdr0482, SemanticNetBuyProvider, SemanticNetBuySampleAdr0482, SemanticNetBuyStatus } from '../semanticNetBuyNormalizerAdr0482.js';
import type { FreshDataSupplyReportAdr0487, FreshDataSnapshotAdr0487 } from '../freshDataSupplyLayerAdr0487.js';
import type { SupplySnapshotCacheLookupAdr0491 } from '../supplySnapshotStoreReplayAdr0491.js';
import { normalizeInvestorFlowSnapshotKeyAdr0491, normalizeInvestorFlowSourceKeyAdr0491 as normalizeInvestorFlowSourceKeySharedAdr0491 } from '../investorFlowSnapshotKeyNormalizerAdr0491.js';
import {
  buildInvestorSampleDiagnosticsAdr0502,
  formatInvestorSampleDiagnosticsAdr0502,
  type InvestorSampleDiagnosticsAdr0502,
  type InvestorSampleProviderNameAdr0502,
} from '../investorSampleMaterializationAdr0502.js';
import { buildSanitizedInvestorFlowSemanticRow, hasActualInvestorNumericRow, normalizeNumberLikeInvestorFlowValue, unwrapInvestorFlowRows, type SanitizedInvestorFlowSemanticRow } from '../../../supply/investorFlowSemanticAvailability.js';
import type {
  InvestorFlowFlatRowForGateAdr0513,
  ActualInvestorFlowCarryAdr0477,
  ActualInvestorFlowDropReasonAdr0477,
  InvestorFlowMaterializedCandidateAdr0503,
  InvestorFlowMaterializedSourceKindAdr0503,
  InvestorFlowProviderId,
  InvestorFlowProviderRouteBySymbolPayloadAdr0477,
  InvestorFlowProviderRouteResult,
  InvestorFlowProviderRouterInput,
  InvestorFlowProviderStatus,
  InvestorRowMaterializationClass,
  SemanticNetBuySample,
} from './types.js';
import {
  ROUTER_POLICY,
  finiteNumber,
  mapSemanticNetBuyStatusAdr0482ToAdr0477,
  normalizeCodeAdr0477,
  normalizeSemanticNetBuySampleAdr0477,
  providerIdFromMaterializationAdr0477,
  selectedActualRowDiagnosticsAdr0477,
} from './primitives.js';
import {
  cacheState,
  cacheLookupStatusAdr0477,
  compactClosestMatchesAdr0477,
  compactRetainedSummaryAdr0477,
  compactRouterLookupAdr0477,
  coverageFromStatuses,
  findFreshDataSnapshotAdr0477,
  findFreshDataSnapshotBySourceIdAdr0477,
  formatKrxRepairDiagnosticAdr0477,
  freshDataSnapshotMaterializedAdr0477,
  freshDataSnapshotSampleAdr0477,
  freshDataSnapshotUsableForRouterAdr0477,
  isKisFirstRebuildModeAdr0477,
  isKrxQuarantineDiagnosticAdr0477,
  isOptionalKrxInvestorDetailUnavailableAdr0477,
  krxDiagnosticStatusAdr0477,
  krxOptionalDetailExcludedReasonAdr0477,
  materializationFromSemanticSampleAdr0477,
  sampleFromCacheLookupAdr0491,
  sourceState,
  statusFromFreshDataSnapshot,
} from './freshDataAdapters.js';
import {
  buildInvestorFlowFlatRowForGate,
  buildInvestorFlowMultiSourceMaterialization,
  normalizedInvestorRowFromSemanticAdr0477,
  supplyNumericKeysAdr0477,
  supplyRowKeysAdr0477,
  type InvestorFlowDiagnosticUsableCandidateAdr0504,
} from './materialization.js';
import {
  mapNaverAdr0481StatusToAdr0477,
  providerFromSemanticAdr0482,
  sampleFromSemanticAdr0482,
  semanticNetBuyDiagnosticCandidate,
  semanticNetBuyFreshCandidate,
} from './semanticAdapters.js';

export function buildInvestorFlowProviderRouteResultAdr0477(
  input: InvestorFlowProviderRouterInput,
): InvestorFlowProviderRouteResult {
  const collectedAt = input.collectedAt ?? new Date().toISOString();
  const kisFirstMode = isKisFirstRebuildModeAdr0477();
  const providerTried: InvestorFlowProviderId[] = ['KRX_SYMBOL_INVESTOR_FLOW', 'KRX_MARKET_INVESTOR_FLOW', 'KIS_API', 'FSS_PASSIVE_ACTIVE', 'NAVER_INVESTOR_TREND', 'CACHE', 'SEMANTIC_NETBUY'];
  const providerStatuses: Record<string, InvestorFlowProviderStatus> = {};
  const providerReasons: Record<string, string> = {};
  const diagnostics: string[] = [];
  let selectedProvider: InvestorFlowProviderId = 'NONE';
  let selectedReason: string | null = null;
  let semanticNetBuy: SemanticNetBuySample | null = null;
  let routeStatus: InvestorFlowProviderStatus = input.nonTradingDay === true ? 'NON_TRADING_DAY' : 'DATA_UNAVAILABLE';
  let pendingSemanticFresh: SemanticNetBuySampleAdr0482 | null = null;
  let pendingSemanticDiagnostic: SemanticNetBuySampleAdr0482 | null = null;
  let pendingNaverStale: SemanticNetBuySample | null = null;
  const materializationDiagnostics: Partial<Record<InvestorSampleProviderNameAdr0502, InvestorSampleDiagnosticsAdr0502>> = {};
  const samplesByProvider: Partial<Record<InvestorFlowProviderId, SemanticNetBuySample>> = {};
  const actualRowCarryByProvider: Partial<Record<InvestorFlowProviderId, ActualInvestorFlowCarryAdr0477>> = {};
  const semanticRowsByProvider: Partial<Record<InvestorFlowProviderId, SanitizedInvestorFlowSemanticRow>> = {};
  let kisRawRowAvailableAtAdapter = false;
  let kisNormalizedRowAvailableAtRouter = false;
  let selectedActualRowPath: string | null = null;
  let sanitizedInvestorFlowRows: Array<Record<string, unknown>> = [];
  let kisNormalizedDiagnosticInvestorRow: Record<string, unknown> | null = null;
  let kisSemanticDiagnosticInvestorRow: Record<string, unknown> | null = null;
  let investorRowMaterializationClass: InvestorRowMaterializationClass = 'MISSING';
  let selectedActualRowFieldKeys: string[] = [];
  let selectedActualNumericFieldKeys: string[] = [];
  let selectedActualNumericStringFieldKeys: string[] = [];
  let selectedActualPlaceholderFieldKeys: string[] = [];
  let selectedActualWrapperOnly = false;
  const selectShadow = (provider: InvestorFlowProviderId, sample: SemanticNetBuySample, reason: string): void => {
    if (provider === 'NAVER_INVESTOR_TREND') {
      samplesByProvider.NAVER_INVESTOR_TREND = sample;
      providerReasons.NAVER_INVESTOR_TREND = `${reason}; selectedProviderCandidate=false; diagnosticOnly=true; reason=NAVER_SECONDARY_NOT_ROUTER_SELECTABLE; executionImpact=NONE`;
      diagnostics.push(providerReasons.NAVER_INVESTOR_TREND);
      return;
    }
    if (semanticNetBuy) return;
    selectedProvider = provider;
    selectedReason = reason;
    semanticNetBuy = sample;
    samplesByProvider[provider] = sample;
    routeStatus = sample.status;
    providerReasons[provider] = reason;
    diagnostics.push(reason);
  };

  if (input.nonTradingDay === true) {
    providerStatuses.KRX = 'NON_TRADING_DAY';
    diagnostics.push('NON_TRADING_DAY is data unavailable, not bearish.');
  }

  const naverFreshDataSnapshot = findFreshDataSnapshotAdr0477(input.freshDataSupplyAdr0487, 'NAVER_INVESTOR_TREND');
  const freshNaver = freshDataSnapshotSampleAdr0477(input.freshDataSupplyAdr0487, 'NAVER_INVESTOR_TREND', input.code, collectedAt);
  if (freshNaver) {
    materializationDiagnostics.NAVER_INVESTOR_TREND = materializationFromSemanticSampleAdr0477('NAVER_INVESTOR_TREND', freshNaver, 'NORMALIZED_PROVIDER');
    samplesByProvider.NAVER_INVESTOR_TREND = freshNaver;
    providerStatuses.NAVER = freshNaver.status;
    providerStatuses.NAVER_INVESTOR_TREND = freshNaver.status;
    providerReasons.NAVER_INVESTOR_TREND = 'FreshData registry bridge READY_FOR_SHADOW normalized NAVER_INVESTOR_TREND sample; role=SECONDARY sourceOfTruth=KRX when KRX is available.';
    selectShadow('NAVER_INVESTOR_TREND', freshNaver, providerReasons.NAVER_INVESTOR_TREND);
  } else if (naverFreshDataSnapshot) {
    const sampleMaterialized = freshDataSnapshotMaterializedAdr0477(naverFreshDataSnapshot);
    const usableForRouter = freshDataSnapshotUsableForRouterAdr0477(naverFreshDataSnapshot);
    providerStatuses.NAVER = sampleMaterialized ? statusFromFreshDataSnapshot(naverFreshDataSnapshot) : 'REGISTRY_READY_NOT_MATERIALIZED';
    providerStatuses.NAVER_INVESTOR_TREND = providerStatuses.NAVER;
    providerReasons.NAVER_INVESTOR_TREND = `FreshData NAVER readinessKind=${naverFreshDataSnapshot.readinessKind ?? 'REGISTRY_READY'} sampleMaterialized=${String(sampleMaterialized)} usableForRouter=${String(usableForRouter)}; not router-selectable.`;
    materializationDiagnostics.NAVER_INVESTOR_TREND = buildInvestorSampleDiagnosticsAdr0502({
      providerName: 'NAVER_INVESTOR_TREND',
      rawFetched: sampleMaterialized,
      rawCount: sampleMaterialized ? 1 : 0,
      normalizedCount: naverFreshDataSnapshot.normalized ? 1 : 0,
      materializedCount: sampleMaterialized ? 1 : 0,
      symbolCoverage: naverFreshDataSnapshot.coverageRatio,
      dateCoverage: naverFreshDataSnapshot.sourceDate,
      fieldCoverage: naverFreshDataSnapshot.normalized ? 1 : 0,
      placeholderDetected: !sampleMaterialized,
      inputSourceKind: sampleMaterialized ? 'NORMALIZED_PROVIDER' : 'PLACEHOLDER',
      blockedReason: sampleMaterialized ? 'NOT_ROUTER_USABLE' : 'PLACEHOLDER_ONLY',
      confidenceLevel: naverFreshDataSnapshot.confidence === 'HIGH' ? 'VERIFIED' : naverFreshDataSnapshot.confidence === 'MEDIUM' ? 'PARTIAL' : naverFreshDataSnapshot.confidence === 'LOW' ? 'LOW' : 'MISSING',
    });
    diagnostics.push(providerReasons.NAVER_INVESTOR_TREND);
  }

  const semanticFreshDataSnapshot = findFreshDataSnapshotAdr0477(input.freshDataSupplyAdr0487, 'SEMANTIC_NETBUY');
  const freshSemantic = freshDataSnapshotSampleAdr0477(input.freshDataSupplyAdr0487, 'SEMANTIC_NETBUY', input.code, collectedAt);
  if (freshSemantic) {
    materializationDiagnostics.SEMANTIC_NETBUY = materializationFromSemanticSampleAdr0477('SEMANTIC_NETBUY', freshSemantic, 'NORMALIZED_PROVIDER');
    samplesByProvider.SEMANTIC_NETBUY = freshSemantic;
    providerStatuses.SEMANTIC_NETBUY = freshSemantic.status;
    providerReasons.SEMANTIC_NETBUY = 'FreshData registry bridge READY_FOR_SHADOW normalized SEMANTIC_NETBUY sample; role=DERIVED usableForShadow=true usableForLive=false and not selectable as source-of-truth.';
    diagnostics.push(providerReasons.SEMANTIC_NETBUY);
  } else if (semanticFreshDataSnapshot) {
    const sampleMaterialized = freshDataSnapshotMaterializedAdr0477(semanticFreshDataSnapshot);
    const usableForRouter = freshDataSnapshotUsableForRouterAdr0477(semanticFreshDataSnapshot);
    providerStatuses.SEMANTIC_NETBUY = sampleMaterialized ? statusFromFreshDataSnapshot(semanticFreshDataSnapshot) : 'NO_INPUT_SAMPLE';
    providerReasons.SEMANTIC_NETBUY = `FreshData SemanticNetBuy readinessKind=${semanticFreshDataSnapshot.readinessKind ?? 'REGISTRY_READY'} sampleMaterialized=${String(sampleMaterialized)} usableForRouter=${String(usableForRouter)}; not router-selectable.`;
    materializationDiagnostics.SEMANTIC_NETBUY = buildInvestorSampleDiagnosticsAdr0502({
      providerName: 'SEMANTIC_NETBUY',
      rawFetched: sampleMaterialized,
      rawCount: sampleMaterialized ? 1 : 0,
      normalizedCount: semanticFreshDataSnapshot.normalized ? 1 : 0,
      materializedCount: sampleMaterialized ? 1 : 0,
      symbolCoverage: semanticFreshDataSnapshot.coverageRatio,
      dateCoverage: semanticFreshDataSnapshot.sourceDate,
      fieldCoverage: semanticFreshDataSnapshot.normalized ? 1 : 0,
      placeholderDetected: !sampleMaterialized,
      inputSourceKind: sampleMaterialized ? 'SEMANTIC_DERIVED' : 'PLACEHOLDER',
      blockedReason: sampleMaterialized ? 'NO_REAL_INPUT_SOURCE' : 'NO_INPUT_SAMPLE',
      confidenceLevel: semanticFreshDataSnapshot.confidence === 'HIGH' ? 'VERIFIED' : semanticFreshDataSnapshot.confidence === 'MEDIUM' ? 'PARTIAL' : semanticFreshDataSnapshot.confidence === 'LOW' ? 'LOW' : 'MISSING',
    });
    diagnostics.push(providerReasons.SEMANTIC_NETBUY);
  }

  if (input.semanticNetBuyNormalizationAdr0482) {
    materializationDiagnostics.SEMANTIC_NETBUY = input.semanticNetBuyNormalizationAdr0482.materializationDiagnostics;
    providerStatuses.SEMANTIC_NETBUY = mapSemanticNetBuyStatusAdr0482ToAdr0477(input.semanticNetBuyNormalizationAdr0482.status);
    for (const sample of input.semanticNetBuyNormalizationAdr0482.samples) {
      providerStatuses[providerFromSemanticAdr0482(sample.provider)] = mapSemanticNetBuyStatusAdr0482ToAdr0477(sample.status);
    }
    pendingSemanticFresh = semanticNetBuyFreshCandidate(input.semanticNetBuyNormalizationAdr0482);
    pendingSemanticDiagnostic = semanticNetBuyDiagnosticCandidate(input.semanticNetBuyNormalizationAdr0482);
    const semanticCandidate = pendingSemanticFresh ?? pendingSemanticDiagnostic;
    if (semanticCandidate) samplesByProvider.SEMANTIC_NETBUY = sampleFromSemanticAdr0482(semanticCandidate);
    if (!pendingSemanticFresh && !pendingSemanticDiagnostic) {
      routeStatus = mapSemanticNetBuyStatusAdr0482ToAdr0477(input.semanticNetBuyNormalizationAdr0482.status);
      diagnostics.push(`ADR-0482 semantic net-buy report has no selectable sample; reason=${input.semanticNetBuyNormalizationAdr0482.diagnostics.join('; ') || 'INPUT_SAMPLE_UNAVAILABLE'}. UNKNOWN is not bearish.`);
    }
  } else if (!freshSemantic) {
    providerStatuses.SEMANTIC_NETBUY = 'DATA_UNAVAILABLE';
    providerReasons.SEMANTIC_NETBUY = 'ADR-0482 normalizer input not supplied and no FreshData registry bridge sample.';
    diagnostics.push('ADR-0482 semantic net-buy normalizer input not supplied; reason=INPUT_SAMPLE_UNAVAILABLE.');
  }

  if (input.naverCollectorWired === true || input.naverCollectorResultAdr0481) {
    const adr0481 = input.naverCollectorResultAdr0481;
    if (adr0481?.materializationDiagnostics) {
      materializationDiagnostics.NAVER_INVESTOR_TREND = adr0481.materializationDiagnostics;
    }
    const naverRaw = adr0481?.semanticNetBuyCandidate ? {
      code: input.code,
      sourceDate: adr0481.semanticNetBuyCandidate.sourceDate,
      foreignNetBuy: adr0481.semanticNetBuyCandidate.foreignNetBuy,
      institutionNetBuy: adr0481.semanticNetBuyCandidate.institutionNetBuy,
      programNetBuy: adr0481.semanticNetBuyCandidate.programNetBuy,
      status: adr0481.semanticNetBuyCandidate.status === 'VERIFIED' ? 'VERIFIED' : adr0481.semanticNetBuyCandidate.status,
    } : input.naverRaw;
    const naverSample = normalizeSemanticNetBuySampleAdr0477(naverRaw, 'NAVER_INVESTOR_TREND', {
      code: input.code,
      collectedAt,
      sourceAgeTradingDays: adr0481?.freshness.sourceAgeTradingDays ?? input.sourceAgeTradingDays,
      fallbackStatus: naverRaw ? undefined : adr0481 ? mapNaverAdr0481StatusToAdr0477(adr0481.status) : 'DATA_UNAVAILABLE',
    });
    if (!materializationDiagnostics.NAVER_INVESTOR_TREND) {
      materializationDiagnostics.NAVER_INVESTOR_TREND = materializationFromSemanticSampleAdr0477('NAVER_INVESTOR_TREND', naverSample, 'RAW_PROVIDER');
    }
    if (materializationDiagnostics.NAVER_INVESTOR_TREND?.sampleMaterialized) samplesByProvider.NAVER_INVESTOR_TREND = naverSample;
    const collectorStatus = adr0481 ? mapNaverAdr0481StatusToAdr0477(adr0481.status) : naverSample.status;
    if (adr0481?.semanticNetBuyCandidate || !providerStatuses.NAVER_INVESTOR_TREND) {
      providerStatuses.NAVER = collectorStatus;
      providerStatuses.NAVER_INVESTOR_TREND = collectorStatus;
    }
    if ((naverSample.status === 'VERIFIED' || naverSample.status === 'PARTIAL') && !semanticNetBuy) {
      selectShadow('NAVER_INVESTOR_TREND', naverSample, 'ADR-0481 NAVER investor trend collector selected for SHADOW_ONLY as SECONDARY/DISPLAY_DERIVED fallback; KRX remains sourceOfTruth when available.');
    } else if (naverSample.status === 'STALE' || naverSample.status === 'DEGRADED') {
      pendingNaverStale = naverSample;
      routeStatus = naverSample.status;
      diagnostics.push('NAVER source is stale/degraded; positive source blocked, not bearish.');
    }
  } else if (!freshNaver) {
    providerStatuses.NAVER = 'NOT_WIRED';
    providerReasons.NAVER = 'NAVER collector implementation not wired and no FreshData registry bridge sample.';
    diagnostics.push('NAVER investor trend collector NOT_WIRED; provider issue only.');
  }

  if (!semanticNetBuy && pendingSemanticFresh) {
    const sample = sampleFromSemanticAdr0482(pendingSemanticFresh);
    samplesByProvider.SEMANTIC_NETBUY = sample;
    routeStatus = sample.status;
    diagnostics.push('ADR-0482 semantic net-buy fresh sample retained for SHADOW_ONLY DERIVED diagnostics; selectedProvider remains real-source-only.');
  }

  if (!semanticNetBuy && pendingNaverStale) {
    samplesByProvider.NAVER_INVESTOR_TREND = pendingNaverStale;
    selectShadow('NAVER_INVESTOR_TREND', pendingNaverStale, 'ADR-0481 NAVER previousTradingDate/off-hours sample selected as STALE SHADOW_ONLY diagnostic.');
  }

  if (!semanticNetBuy && pendingSemanticDiagnostic) {
    const sample = sampleFromSemanticAdr0482(pendingSemanticDiagnostic);
    samplesByProvider.SEMANTIC_NETBUY = sample;
    routeStatus = sample.status;
    diagnostics.push('ADR-0482 semantic net-buy diagnostic sample retained for OBSERVE/SHADOW_ONLY DERIVED diagnostics; selectedProvider remains real-source-only.');
  }

  const cacheLookup = input.supplySnapshotCacheLookupAdr0491;
  const cacheLookupSample = sampleFromCacheLookupAdr0491(cacheLookup, input.code, collectedAt);
  if (cacheLookup) {
    providerStatuses.CACHE = cacheLookupStatusAdr0477(cacheLookup.status);
    const mismatchHints = cacheLookup.debug?.mismatchHints?.join(',') || 'NONE';
    const dateCandidates = cacheLookup.debug?.routerLookup?.tradingDateCandidates?.join(',') ?? 'NONE';
    providerReasons.CACHE = `ADR-0491 cacheLookupResult=${cacheLookup.status} reason=${cacheLookup.reason} mismatchHints=${mismatchHints} dateCandidates=${dateCandidates}`;
    const normalizedCacheKey = normalizeInvestorFlowSnapshotKeyAdr0491({ code: input.code, route: 'investor_flow', domain: 'SUPPLY' });
    diagnostics.push(`cacheLookupResult=${cacheLookup.status}; cacheLookupKey=${cacheLookup.debug?.lookupKey ?? normalizedCacheKey.lookupKey}; triedKeys=${cacheLookup.debug?.triedKeys?.join(',') ?? 'NONE'}; retained=${cacheLookup.retained}; sourceKeyNormalized=${normalizedCacheKey.sourceCandidates.join(',')}; dateCandidates=${dateCandidates}; mismatchHints=${mismatchHints}; rawPayloadPersistenceAllowed=false; liveExecutionAllowed=false`);
    diagnostics.push(`retainedSummary=${compactRetainedSummaryAdr0477(cacheLookup.debug?.retainedSummary)}`);
    diagnostics.push(`routerLookup=${compactRouterLookupAdr0477(cacheLookup.debug?.routerLookup)}`);
    diagnostics.push(`closestMatches=${compactClosestMatchesAdr0477(cacheLookup.debug?.closestMatches)}`);
  }
  if (!semanticNetBuy) {
    const cacheRaw = cacheLookupSample ? null : input.cacheRaw ?? input.previousTradingDayCacheRaw;
    const cacheSample = cacheLookupSample ?? normalizeSemanticNetBuySampleAdr0477(cacheRaw, 'CACHE', {
      code: input.code,
      collectedAt,
      sourceAgeTradingDays: input.cacheAgeTradingDays,
      fallbackStatus: cacheRaw ? undefined : 'CACHE_EMPTY',
    });
    materializationDiagnostics.CACHE = materializationFromSemanticSampleAdr0477(
      'CACHE',
      cacheSample.status === 'CACHE_EMPTY' || cacheSample.status === 'DATA_UNAVAILABLE' ? null : cacheSample,
      'CACHE_FALLBACK',
      cacheSample.status === 'CACHE_EMPTY' ? 'NO_INPUT_SAMPLE' : undefined,
    );
    if (materializationDiagnostics.CACHE?.sampleMaterialized) samplesByProvider.CACHE = cacheSample;
    if (!cacheLookup || cacheLookupSample) providerStatuses.CACHE = cacheLookupSample && cacheLookup ? cacheLookupStatusAdr0477(cacheLookup.status) : cacheSample.status;
    if (cacheSample.status === 'VERIFIED' || cacheSample.status === 'PARTIAL' || cacheSample.status === 'STALE' || cacheSample.status === 'CACHE_HIT' || cacheSample.status === 'CACHE_STALE_HIT') {
      const staleCacheBlockedByKisFirst = kisFirstMode && (cacheSample.status === 'STALE' || cacheSample.status === 'CACHE_STALE_HIT');
      const naverNotMaterialized = naverFreshDataSnapshot && !freshDataSnapshotMaterializedAdr0477(naverFreshDataSnapshot)
        ? ` because NAVER readinessKind=${naverFreshDataSnapshot.readinessKind ?? 'REGISTRY_READY'} usableForRouter=${String(freshDataSnapshotUsableForRouterAdr0477(naverFreshDataSnapshot))}`
        : '';
      if (staleCacheBlockedByKisFirst) {
        diagnostics.push(`KIS_FIRST_REBUILD_MODE=true; CACHE_STALE_HIT is fallbackDiagnosticOnly and cannot be selectedProvider. fallbackProvider=CACHE; fallbackStatus=${cacheSample.status}; marketSignal=false.`);
      } else {
        selectShadow('CACHE', cacheSample, cacheLookup ? `ADR-0491 sanitized snapshot cache selected: ${cacheLookup.status}${naverNotMaterialized}.` : `CACHE fallback used${naverNotMaterialized}; fallback only, not primary truth.`);
      }
    }
  } else if (!providerStatuses.CACHE) {
    providerStatuses.CACHE = input.cacheRaw ? 'PARTIAL' : 'CACHE_EMPTY';
  }

  const krxDisabledDiagnostic = input.krxInvestorDiagnosticAdr0505?.parserStatus === 'DISABLED_BY_KIS_FIRST_MODE';
  const krxRaw = krxDisabledDiagnostic ? null : input.krxInvestorRaw ?? input.previousTradingDayKrxRaw ?? null;
  if (krxRaw) {
    const krxProvider: InvestorFlowProviderId = input.krxInvestorDiagnosticAdr0505?.routePurpose === 'SYMBOL_LEVEL'
      ? 'KRX_SYMBOL_INVESTOR_FLOW'
      : input.krxInvestorDiagnosticAdr0505?.routePurpose === 'MARKET_LEVEL'
        ? 'KRX_MARKET_INVESTOR_FLOW'
        : 'KRX_INVESTOR_FLOW';
    const krxMaterializationProvider: InvestorSampleProviderNameAdr0502 = krxProvider === 'KRX_MARKET_INVESTOR_FLOW'
      ? 'KRX_MARKET_INVESTOR_FLOW'
      : krxProvider === 'KRX_SYMBOL_INVESTOR_FLOW'
        ? 'KRX_SYMBOL_INVESTOR_FLOW'
        : 'KRX_INVESTOR_FLOW';
    const krxSample = normalizeSemanticNetBuySampleAdr0477(krxRaw, krxProvider, {
      code: input.code,
      collectedAt,
      sourceAgeTradingDays: input.sourceAgeTradingDays ?? (input.nonTradingDay === true ? 1 : 0),
      fallbackStatus: input.nonTradingDay === true ? 'STALE' : undefined,
    });
    materializationDiagnostics[krxMaterializationProvider] = materializationFromSemanticSampleAdr0477(krxMaterializationProvider, krxSample, 'RAW_PROVIDER');
    if (materializationDiagnostics[krxMaterializationProvider]?.sampleMaterialized) samplesByProvider[krxProvider] = krxSample;
    providerStatuses[krxProvider] = krxSample.status;
    providerStatuses.KRX_INVESTOR_FLOW = krxSample.status;
    providerStatuses.KRX = krxSample.status;
    providerReasons[krxProvider] = input.previousTradingDayKrxRaw
      ? `${krxProvider} previousTradingDate materialized investor-flow row selected as SHADOW_ONLY diagnostic candidate.`
      : `${krxProvider} materialized investor-flow row selected as SHADOW_ONLY diagnostic candidate.`;
    providerReasons.KRX_INVESTOR_FLOW = providerReasons[krxProvider];
  } else if (input.krxInvestorDiagnosticAdr0505) {
    const optionalDetailUnavailable = isOptionalKrxInvestorDetailUnavailableAdr0477(input.krxInvestorDiagnosticAdr0505);
    const krxQuarantined = kisFirstMode && isKrxQuarantineDiagnosticAdr0477(input.krxInvestorDiagnosticAdr0505);
    const krxStatus = optionalDetailUnavailable
      ? 'DATA_UNAVAILABLE'
      : krxQuarantined ? 'QUARANTINED' : krxDiagnosticStatusAdr0477(input.krxInvestorDiagnosticAdr0505.parserStatus);
    const krxReason = formatKrxRepairDiagnosticAdr0477(input.krxInvestorDiagnosticAdr0505);
    const krxDiagnosticProvider: InvestorFlowProviderId = input.krxInvestorDiagnosticAdr0505.routePurpose === 'SYMBOL_LEVEL'
      ? 'KRX_SYMBOL_INVESTOR_FLOW'
      : input.krxInvestorDiagnosticAdr0505.routePurpose === 'MARKET_LEVEL'
        ? 'KRX_MARKET_INVESTOR_FLOW'
        : 'KRX_INVESTOR_FLOW';
    providerStatuses[krxDiagnosticProvider] = krxStatus;
    providerStatuses.KRX_INVESTOR_FLOW = krxStatus;
    providerStatuses.KRX = krxStatus;
    providerReasons[krxDiagnosticProvider] = krxStatus === 'DISABLED_BY_KIS_FIRST_MODE'
      ? `${krxReason}; status=DISABLED_BY_KIS_FIRST_MODE; provider=KRX; providerIssue=false; marketSignal=false; useForRouter=false; useForGate=false; useForLive=false; useForShadow=false; executionImpact=NONE`
      : optionalDetailUnavailable
        ? `${krxReason}; selectedProviderCandidate=false; routedStatus=OPTIONAL_KRX_DETAIL_UNAVAILABLE; reason=${krxOptionalDetailExcludedReasonAdr0477(input.krxInvestorDiagnosticAdr0505)}; useForRouter=false; useForGate=false; useForLive=false; useForShadow=false; diagnosticOnly=true; providerIssue=false; marketSignal=false; executionImpact=NONE`
        : krxQuarantined
        ? `${krxReason}; QUARANTINED retryAfterMs=${input.krxInvestorDiagnosticAdr0505.cooldownRemainingMs ?? 60 * 60 * 1000}; useForGate=false; useForRouter=false; useForLive=false; useForShadow=true; diagnosticOnly=true; executionImpact=NONE`
        : krxReason;
    providerReasons.KRX_INVESTOR_FLOW = providerReasons[krxDiagnosticProvider];
    providerReasons.KRX = providerReasons[krxDiagnosticProvider];
    diagnostics.push(providerReasons[krxDiagnosticProvider]);
    if (optionalDetailUnavailable) {
      diagnostics.push(`[KRX_OPTIONAL_DETAIL_EXCLUDED] endpoint=${input.krxInvestorDiagnosticAdr0505.endpoint ?? input.krxInvestorDiagnosticAdr0505.selectedBld ?? 'UNKNOWN'} reason=${krxOptionalDetailExcludedReasonAdr0477(input.krxInvestorDiagnosticAdr0505)} useForRouter=false executionImpact=NONE`);
    }
  }

  if (input.kisInvestorRaw) {
    const actualRowDiagnostic = selectedActualRowDiagnosticsAdr0477(input.kisInvestorRaw);
    sanitizedInvestorFlowRows = actualRowDiagnostic.rows;
    selectedActualRowPath = actualRowDiagnostic.selectedPath;
    selectedActualRowFieldKeys = actualRowDiagnostic.fieldKeys;
    selectedActualNumericFieldKeys = actualRowDiagnostic.numericFieldKeys;
    selectedActualNumericStringFieldKeys = actualRowDiagnostic.numericStringFieldKeys;
    selectedActualPlaceholderFieldKeys = actualRowDiagnostic.placeholderFieldKeys;
    selectedActualWrapperOnly = actualRowDiagnostic.wrapperOnly;
    const actualFlowForSemantic = sanitizedInvestorFlowRows.length > 0 ? sanitizedInvestorFlowRows : input.kisInvestorRaw;
    const kisSemanticRow = buildSanitizedInvestorFlowSemanticRow({
      flow: actualFlowForSemantic,
      symbol: input.code,
      provider: 'KIS_API',
      providerScope: 'SYMBOL_LEVEL',
    });
    kisRawRowAvailableAtAdapter = kisSemanticRow.rawFieldKeys.length > 0 || sanitizedInvestorFlowRows.length > 0;
    kisNormalizedRowAvailableAtRouter = kisSemanticRow.normalizedFieldKeys.length > 0 || kisSemanticRow.foreignNetBuy !== null || kisSemanticRow.institutionalNetBuy !== null || kisSemanticRow.individualNetBuy !== null;
    semanticRowsByProvider.KIS_API = kisSemanticRow;
    const kisActualInvestorRow = sanitizedInvestorFlowRows[0] ?? (input.kisInvestorRaw as Record<string, unknown>);
    const kisNormalizedInvestorRow = normalizedInvestorRowFromSemanticAdr0477(kisSemanticRow);
    const semanticRowAsDiagnostic = kisSemanticRow as unknown as Record<string, unknown>;
    kisNormalizedDiagnosticInvestorRow = hasActualInvestorNumericRow(kisNormalizedInvestorRow) ? kisNormalizedInvestorRow : null;
    kisSemanticDiagnosticInvestorRow = hasActualInvestorNumericRow(semanticRowAsDiagnostic) ? semanticRowAsDiagnostic : null;
    const selectedActualPathIsNormalized = /normalized/i.test(selectedActualRowPath ?? '');
    const hasExplicitNormalizedObject = input.kisInvestorRaw != null && typeof input.kisInvestorRaw === 'object' && !Array.isArray(input.kisInvestorRaw) && Object.prototype.hasOwnProperty.call(input.kisInvestorRaw, 'normalizedRow');
    investorRowMaterializationClass = (selectedActualWrapperOnly || actualRowDiagnostic.wrapperOnly) && sanitizedInvestorFlowRows.length === 0 && !kisNormalizedDiagnosticInvestorRow && !kisSemanticDiagnosticInvestorRow && !hasExplicitNormalizedObject
      ? 'WRAPPER_ONLY'
      : sanitizedInvestorFlowRows.some((row) => hasActualInvestorNumericRow(row))
        ? (selectedActualPathIsNormalized ? 'NORMALIZED_NUMERIC_ROW' : 'ACTUAL_NUMERIC_ROW')
        : kisNormalizedDiagnosticInvestorRow
        ? 'NORMALIZED_NUMERIC_ROW'
        : kisSemanticDiagnosticInvestorRow
          ? 'NORMALIZED_NUMERIC_ROW'
          : kisNormalizedInvestorRow
            ? 'NORMALIZED_METADATA_ONLY'
            : kisNormalizedRowAvailableAtRouter
              ? 'SEMANTIC_METADATA_ONLY'
              : selectedActualWrapperOnly || actualRowDiagnostic.wrapperOnly
                ? 'WRAPPER_ONLY'
                : 'MISSING';
    kisRawRowAvailableAtAdapter = investorRowMaterializationClass === 'ACTUAL_NUMERIC_ROW' || investorRowMaterializationClass === 'NORMALIZED_NUMERIC_ROW';
    const kisSample = normalizeSemanticNetBuySampleAdr0477((sanitizedInvestorFlowRows[0] ?? kisNormalizedDiagnosticInvestorRow ?? kisSemanticDiagnosticInvestorRow ?? input.kisInvestorRaw) as Record<string, unknown>, 'KIS_API', {
      code: input.code,
      collectedAt,
      sourceAgeTradingDays: input.sourceAgeTradingDays,
    });
    materializationDiagnostics.KIS_INVESTOR = materializationFromSemanticSampleAdr0477('KIS_INVESTOR', kisSample, 'RAW_PROVIDER');
    const kisDiagnosticActualRows = sanitizedInvestorFlowRows.length > 0
      ? sanitizedInvestorFlowRows
      : (kisNormalizedDiagnosticInvestorRow ?? kisSemanticDiagnosticInvestorRow)
        ? [kisNormalizedDiagnosticInvestorRow ?? kisSemanticDiagnosticInvestorRow as Record<string, unknown>]
        : [];
    const kisDiagnosticFieldKeys = kisDiagnosticActualRows.length > 0 ? Array.from(new Set(kisDiagnosticActualRows.flatMap((row) => Object.keys(row)))) : selectedActualRowFieldKeys;
    const kisDiagnosticNumericKeys = kisDiagnosticActualRows.length > 0 ? Array.from(new Set(kisDiagnosticActualRows.flatMap((row) => supplyNumericKeysAdr0477(row)))) : Array.from(new Set([...selectedActualNumericFieldKeys, ...selectedActualNumericStringFieldKeys]));
    actualRowCarryByProvider.KIS_API = {
      actualInvestorFlowRows: kisDiagnosticActualRows,
      actualInvestorFlowRowCount: kisDiagnosticActualRows.length,
      actualInvestorFlowRowSourcePath: selectedActualRowPath ?? (kisDiagnosticActualRows.length > 0 ? 'input.normalizedInvestorRow' : null),
      actualInvestorFlowFieldKeys: kisDiagnosticFieldKeys,
      actualInvestorFlowNumericKeys: kisDiagnosticNumericKeys,
      actualInvestorFlowNumericStringKeys: selectedActualNumericStringFieldKeys,
      actualInvestorFlowCarried: kisDiagnosticActualRows.length > 0,
      actualInvestorRow: kisActualInvestorRow,
      normalizedInvestorRow: kisNormalizedInvestorRow,
      semanticInvestorRow: kisSemanticRow,
      supplySemanticRow: kisSemanticRow,
      actualRowAvailable: Boolean(kisActualInvestorRow),
      diagnosticActualInvestorRow: kisNormalizedDiagnosticInvestorRow ?? kisSemanticDiagnosticInvestorRow ?? (hasActualInvestorNumericRow(kisActualInvestorRow) ? kisActualInvestorRow : null),
      actualInvestorRowProvider: (kisNormalizedDiagnosticInvestorRow || kisSemanticDiagnosticInvestorRow || hasActualInvestorNumericRow(kisActualInvestorRow)) ? 'KIS_API' : null,
      actualInvestorRowUseScope: 'DIAGNOSTIC_ONLY',
      investorRowMaterializationClass,
      diagnosticActualInvestorRowFromNormalized: Boolean(kisNormalizedDiagnosticInvestorRow ?? kisSemanticDiagnosticInvestorRow),
      normalizedRowAvailable: Boolean(kisNormalizedInvestorRow),
      semanticRowAvailable: kisNormalizedRowAvailableAtRouter,
      rowCarryPath: 'ADAPTER_TO_ROUTER',
    };
    diagnostics.push(`[SUPPLY_ROUTER_ROW_CARRIED] symbol=${input.code} actualRowAvailable=${Boolean(kisActualInvestorRow)} semanticRowAvailable=${kisNormalizedRowAvailableAtRouter} materializationClass=${investorRowMaterializationClass} normalizedPromoted=${Boolean(kisNormalizedDiagnosticInvestorRow ?? kisSemanticDiagnosticInvestorRow)} fieldKeys=${supplyRowKeysAdr0477(kisActualInvestorRow).slice(0, 16).join(',') || 'NONE'} numericKeys=${supplyNumericKeysAdr0477(kisActualInvestorRow).slice(0, 16).join(',') || 'NONE'} rowCarryPath=ADAPTER_TO_ROUTER`);
    diagnostics.push(`[SUPPLY_SEMANTIC_FIELD_MAPPED] symbol=${input.code} foreignField=${kisSemanticRow.sourceFields.foreign ?? 'none'} institutionField=${kisSemanticRow.sourceFields.institutional ?? 'none'} individualField=${kisSemanticRow.sourceFields.individual ?? 'none'} foreignNetBuy=${kisSemanticRow.foreignNetBuy ?? 'null'} institutionNetBuy=${kisSemanticRow.institutionalNetBuy ?? 'null'} individualNetBuy=${kisSemanticRow.individualNetBuy ?? 'null'}`);
    if (materializationDiagnostics.KIS_INVESTOR.sampleMaterialized) samplesByProvider.KIS_API = kisSample;
    providerStatuses.KIS_API = kisSample.status;
    providerStatuses.KIS = kisSample.status;
    providerReasons.KIS_API = 'KIS symbol-level investor-flow row materialized; route separated from program trading.';
  }

  if (input.fssPassiveActiveRaw) {
    const fssSample = normalizeSemanticNetBuySampleAdr0477(input.fssPassiveActiveRaw, 'FSS_PASSIVE_ACTIVE', {
      code: input.code,
      collectedAt,
      sourceAgeTradingDays: input.fssSourceAgeTradingDays ?? 5,
      fallbackStatus: 'STALE',
    });
    materializationDiagnostics.FSS_PASSIVE_ACTIVE = materializationFromSemanticSampleAdr0477('FSS_PASSIVE_ACTIVE', fssSample, 'RAW_PROVIDER');
    if (materializationDiagnostics.FSS_PASSIVE_ACTIVE.sampleMaterialized) samplesByProvider.FSS_PASSIVE_ACTIVE = fssSample;
    providerStatuses.FSS_PASSIVE_ACTIVE = fssSample.status;
    providerStatuses.FSS = fssSample.status;
    providerReasons.FSS_PASSIVE_ACTIVE = 'FSS stale but materialized passive/active row allowed as SHADOW_ONLY diagnostic fallback.';
  }

  if (input.kisTriedForInvestorFlow === true) {
    providerTried.push('KIS');
    if (!providerStatuses.KIS && !providerStatuses.KIS_API) {
      providerStatuses.KIS = 'PROVIDER_MISMATCH';
      providerReasons.KIS_API = 'ROUTE_MISMATCH: KIS program route is not semantic investor_flow unless symbol-level investor fields are present.';
    }
    diagnostics.push('KIS investor-flow mismatch decomposed: ROUTE_MISMATCH/SYMBOL_MISMATCH/FIELD_MISMATCH/SESSION_MISMATCH/EMPTY_OUTPUT.');
  }
  if (input.marketProgramStatus === 'ACCEPTED_EMPTY') {
    providerTried.push('KRX');
    providerStatuses.MARKET_PROGRAM = 'ACCEPTED_EMPTY';
    diagnostics.push('ACCEPTED_EMPTY market/program data excluded from scoring, not bearish.');
  }
  if ((input.fssSourceAgeTradingDays ?? 0) >= 4) {
    providerTried.push('FSS');
    providerStatuses.FSS = providerStatuses.FSS ?? 'STALE';
    diagnostics.push(`FSS source stale ${input.fssSourceAgeTradingDays} trading days; diagnostic only.`);
  }

  const multiSourceMaterialization = buildInvestorFlowMultiSourceMaterialization(materializationDiagnostics, samplesByProvider, actualRowCarryByProvider);
  const optionalKrxDetailUnavailable = input.krxInvestorDiagnosticAdr0505
    ? isOptionalKrxInvestorDetailUnavailableAdr0477(input.krxInvestorDiagnosticAdr0505)
    : false;
  const hasRouterUsableKrxRawCandidate = multiSourceMaterialization.rankedCandidates.some((candidate) =>
    (candidate.provider === 'KRX_INVESTOR_FLOW' || candidate.provider === 'KRX_SYMBOL_INVESTOR_FLOW' || candidate.provider === 'KRX_MARKET_INVESTOR_FLOW') &&
    candidate.sampleMaterialized &&
    candidate.usableForRouter,
  );
  const kisMaterialization = materializationDiagnostics.KIS_INVESTOR;
  const kisSampleForSelection = samplesByProvider.KIS_API;
  const naverStatusForShortCircuit = providerStatuses.NAVER_INVESTOR_TREND;
  const naverNotUsable =
    naverStatusForShortCircuit === 'STALE' ||
    naverStatusForShortCircuit === 'NOT_WIRED' ||
    naverStatusForShortCircuit === 'DATA_UNAVAILABLE' ||
    naverStatusForShortCircuit === 'EMPTY' ||
    naverStatusForShortCircuit === undefined;
  const kisVerifiedShortCircuitAvailable =
    kisSampleForSelection?.status === 'VERIFIED' &&
    kisMaterialization?.confidenceLevel === 'VERIFIED' &&
    (kisMaterialization.materializedCount ?? 0) > 0 &&
    kisMaterialization.sampleMaterialized === true &&
    !hasRouterUsableKrxRawCandidate &&
    (optionalKrxDetailUnavailable || naverNotUsable);
  if (kisVerifiedShortCircuitAvailable && naverNotUsable) {
    const naverStatus = naverStatusForShortCircuit ?? 'NOT_AVAILABLE';
    const naverExclusion = `fallbackProvider=NAVER_INVESTOR_TREND excludedReason=NAVER_${naverStatus}_WHILE_KIS_VERIFIED selectedProvider=KIS_API executionImpact=NONE`;
    providerReasons.NAVER_INVESTOR_TREND = providerReasons.NAVER_INVESTOR_TREND
      ? `${providerReasons.NAVER_INVESTOR_TREND}; ${naverExclusion}`
      : naverExclusion;
    diagnostics.push(`[ADR-0477] ${naverExclusion}`);
  }
  const krxAutoDisabled = providerStatuses.KRX_INVESTOR_FLOW === 'DISABLED_BY_KIS_FIRST_MODE' || providerStatuses.KRX === 'DISABLED_BY_KIS_FIRST_MODE';
  const isBlockedAutoKrxCandidate = (provider: InvestorFlowProviderId): boolean => (kisFirstMode || krxAutoDisabled) && (provider === 'KRX_INVESTOR_FLOW' || provider === 'KRX_SYMBOL_INVESTOR_FLOW' || provider === 'KRX_MARKET_INVESTOR_FLOW');
  const isRouterSelectableMaterializedCandidate = (candidate: { provider: InvestorFlowProviderId; freshness?: string } | null | undefined): candidate is { provider: InvestorFlowProviderId; freshness?: string } =>
    candidate != null &&
    candidate.provider !== 'NAVER_INVESTOR_TREND' &&
    !isBlockedAutoKrxCandidate(candidate.provider) &&
    !(candidate.provider === 'CACHE' && candidate.freshness === 'STALE');
  const kisVerifiedShortCircuitCandidate = kisVerifiedShortCircuitAvailable
    ? multiSourceMaterialization.candidates.find((candidate) => candidate.provider === 'KIS_API') ?? null
    : null;
  const selectedMultiSourceCandidate = kisVerifiedShortCircuitCandidate ?? (kisFirstMode || krxAutoDisabled
    ? multiSourceMaterialization.rankedCandidates.find(isRouterSelectableMaterializedCandidate) ?? null
    : isRouterSelectableMaterializedCandidate(multiSourceMaterialization.selectedCandidate)
      ? multiSourceMaterialization.selectedCandidate
      : multiSourceMaterialization.rankedCandidates.find(isRouterSelectableMaterializedCandidate) ?? null);
  const adapterCarriesActualRow = sanitizedInvestorFlowRows.length > 0;
  const candidateBeforeSelectionCarriesActualRow = multiSourceMaterialization.candidates.some((candidate) => candidate.provider === 'KIS_API' && (candidate.actualInvestorFlowRowCount ?? 0) > 0);
  if (selectedMultiSourceCandidate) {
    const sample = samplesByProvider[selectedMultiSourceCandidate.provider];
    if (sample && selectedProvider !== selectedMultiSourceCandidate.provider) {
      const previousReason = providerReasons[selectedMultiSourceCandidate.provider];
      selectedProvider = selectedMultiSourceCandidate.provider;
      selectedReason = kisVerifiedShortCircuitCandidate
        ? `KIS_VERIFIED_SHORTCIRCUIT: ${selectedMultiSourceCandidate.selectionReason}`
        : `ADR-0503 multi-source materialized candidate selected: ${selectedMultiSourceCandidate.selectionReason}`;
      semanticNetBuy = sample;
      routeStatus = sample.status;
      providerReasons[selectedMultiSourceCandidate.provider] = previousReason ? `${selectedReason}; ${previousReason}` : selectedReason;
      diagnostics.push(providerReasons[selectedMultiSourceCandidate.provider]);
      if (kisVerifiedShortCircuitCandidate) {
        diagnostics.push('[ADR-0477] InvestorFlowProviderRouter selectedProvider=KIS_API status=VERIFIED reason=KIS_VERIFIED_SHORTCIRCUIT executionImpact=NONE liveExecutionAllowed=false');
      }
    }
  }

  const diagnosticUsableCandidates: InvestorFlowDiagnosticUsableCandidateAdr0504[] = [];
  const fssFreshDataSnapshot = findFreshDataSnapshotBySourceIdAdr0477(input.freshDataSupplyAdr0487, 'FSS_PASSIVE_ACTIVE');
  if (fssFreshDataSnapshot && (fssFreshDataSnapshot.status === 'STALE' || fssFreshDataSnapshot.sourceState === 'STALE' || fssFreshDataSnapshot.usableForShadow === true)) {
    providerStatuses.FSS_PASSIVE_ACTIVE = providerStatuses.FSS_PASSIVE_ACTIVE ?? 'STALE';
    providerStatuses.FSS = providerStatuses.FSS ?? providerStatuses.FSS_PASSIVE_ACTIVE;
    providerReasons.FSS_PASSIVE_ACTIVE = providerReasons.FSS_PASSIVE_ACTIVE ?? `FreshData aggregate diagnostic provider=FSS status=${fssFreshDataSnapshot.status} confidence=${fssFreshDataSnapshot.confidence}; selectedForShadow=true selectedForLive=false.`;
    diagnosticUsableCandidates.push({
      provider: 'FSS_PASSIVE_ACTIVE',
      status: providerStatuses.FSS_PASSIVE_ACTIVE,
      reason: providerReasons.FSS_PASSIVE_ACTIVE,
      source: 'FRESH_DATA_AGGREGATE',
    });
  }
  const cacheFreshDataSnapshot = findFreshDataSnapshotBySourceIdAdr0477(input.freshDataSupplyAdr0487, 'SUPPLY_SNAPSHOT_CACHE');
  const cacheDiagnosticStatus = providerStatuses.CACHE;
  if ((cacheLookup && (cacheLookup.status === 'CACHE_HIT' || cacheLookup.status === 'CACHE_STALE_HIT' || cacheLookup.status === 'STALE_HIT')) || cacheFreshDataSnapshot?.cacheState === 'FRESH' || cacheFreshDataSnapshot?.cacheState === 'STALE') {
    providerStatuses.CACHE = providerStatuses.CACHE ?? (cacheFreshDataSnapshot?.cacheState === 'STALE' ? 'CACHE_STALE_HIT' : 'CACHE_HIT');
    providerReasons.CACHE = providerReasons.CACHE ?? `FreshData/cache diagnostic fallback status=${providerStatuses.CACHE}; selectedForShadow=true selectedForLive=false.`;
    diagnosticUsableCandidates.push({
      provider: 'CACHE',
      status: providerStatuses.CACHE ?? cacheDiagnosticStatus ?? 'OBSERVING',
      reason: providerReasons.CACHE,
      source: 'CACHE_LOOKUP',
    });
  }
  for (const candidate of multiSourceMaterialization.candidates) {
    if (candidate.provider !== 'NAVER_INVESTOR_TREND' && candidate.provider !== 'SEMANTIC_NETBUY' && !isBlockedAutoKrxCandidate(candidate.provider) && candidate.sampleMaterialized && candidate.usableForShadow && !candidate.placeholderDetected) {
      diagnosticUsableCandidates.push({
        provider: candidate.provider,
        status: samplesByProvider[candidate.provider]?.status ?? (candidate.freshness === 'STALE' ? 'STALE' : 'OBSERVING'),
        reason: candidate.selectionReason,
        source: 'MATERIALIZED_SHADOW',
      });
    }
  }
  const selectedDiagnosticCandidate = selectedProvider === 'NONE'
    ? diagnosticUsableCandidates.find((candidate) => candidate.provider === 'FSS_PASSIVE_ACTIVE')
      ?? diagnosticUsableCandidates.find((candidate) => candidate.provider === 'CACHE' && (!kisFirstMode || candidate.status === 'CACHE_HIT'))
      ?? diagnosticUsableCandidates.find((candidate) => !(kisFirstMode && candidate.provider === 'CACHE' && candidate.status !== 'CACHE_HIT'))
      ?? null
    : null;
  let selectedDiagnosticProvider: InvestorFlowProviderId | null = null;
  let selectedDiagnosticReason: string | null = null;
  if (selectedDiagnosticCandidate) {
    selectedProvider = selectedDiagnosticCandidate.provider;
    selectedDiagnosticProvider = selectedDiagnosticCandidate.provider;
    selectedDiagnosticReason = selectedDiagnosticCandidate.reason;
    selectedReason = selectedDiagnosticCandidate.reason;
    routeStatus = selectedDiagnosticCandidate.status === 'CACHE_HIT' ? 'OBSERVING' : selectedDiagnosticCandidate.status;
    providerStatuses[selectedDiagnosticCandidate.provider] = selectedDiagnosticCandidate.status;
    providerReasons[selectedDiagnosticCandidate.provider] = selectedDiagnosticCandidate.reason;
    const diagnosticSample = samplesByProvider[selectedDiagnosticCandidate.provider];
    if (!semanticNetBuy && diagnosticSample) semanticNetBuy = diagnosticSample;
    diagnostics.push(`diagnosticUsableCandidate selected provider=${selectedDiagnosticCandidate.provider}; source=${selectedDiagnosticCandidate.source}; status=${selectedDiagnosticCandidate.status}; selectedForShadow=true; selectedForLive=false`);
  }

  const staleCacheQuarantinedByKisFirst = kisFirstMode
    && selectedProvider === 'NONE'
    && (providerStatuses.CACHE === 'CACHE_STALE_HIT' || providerStatuses.CACHE === 'STALE');
  if (staleCacheQuarantinedByKisFirst) {
    selectedReason = 'NO_FRESH_SEMANTIC_NETBUY';
    routeStatus = input.krxInvestorDiagnosticAdr0505 && isKrxQuarantineDiagnosticAdr0477(input.krxInvestorDiagnosticAdr0505)
      ? 'DATA_UNAVAILABLE'
      : routeStatus;
    diagnostics.push('selectedProvider=NONE; fallbackProvider=CACHE; fallbackStatus=CACHE_STALE_HIT; fallbackDiagnosticOnly=true; selectedReason=NO_FRESH_SEMANTIC_NETBUY; marketSignal=false');
  }

  const selectedSemanticRow = semanticRowsByProvider[selectedProvider] ?? null;
  const selectedGateSemanticFlatRow = buildInvestorFlowFlatRowForGate(selectedSemanticRow);
  const selectedMaterializedCandidate = selectedMultiSourceCandidate?.provider === selectedProvider
    ? selectedMultiSourceCandidate
    : multiSourceMaterialization.candidates.find((candidate) => candidate.provider === selectedProvider) ?? null;
  // ADR-0477 supply actual row carry — sanitizedInvestorFlowRows (KIS adapter SSOT) 가
  // selectedProvider !== 'KIS_API' 일 때도 diagnostic-only 로 propagate. selectedProvider 의
  // CORE 판단은 그대로 (KRX/NAVER/CACHE 등 multi-source materialization 결과 우선),
  // KIS adapter row 는 diagnostic / SHADOW_SCORE 전용 — executionImpact='NONE',
  // liveExecutionAllowed=false 보존. 사용자 명시 #6: adapterCarriesActualRow=47/47 인데
  // routerCarriesActualRow=0/47 인 단절 차단 — adapter 가 데이터 보유 시 router 도 carry.
  // 사용자 명시 #9 (KRX CORE 직결 금지) 정합 — selectedProvider 결정 로직 변경 0.
  const normalizedFallbackActualRows = (kisNormalizedDiagnosticInvestorRow ?? kisSemanticDiagnosticInvestorRow)
    ? [kisNormalizedDiagnosticInvestorRow ?? kisSemanticDiagnosticInvestorRow as Record<string, unknown>]
    : [];
  const adapterFallbackActualRows = sanitizedInvestorFlowRows.length > 0 ? sanitizedInvestorFlowRows : normalizedFallbackActualRows;
  const diagnosticActualRowFromNormalized = (sanitizedInvestorFlowRows.length === 0 && normalizedFallbackActualRows.length > 0) || (adapterFallbackActualRows.length > 0 && /NORMALIZED/.test(investorRowMaterializationClass));
  const selectedCandidateActualRows = selectedMaterializedCandidate?.actualInvestorFlowRows
    ?? (selectedProvider === 'KIS_API' ? adapterFallbackActualRows : adapterFallbackActualRows);
  const selectedCandidateActualRowCount = selectedMaterializedCandidate?.actualInvestorFlowRowCount ?? selectedCandidateActualRows.length;
  const selectedCandidateCarriesActualRow = selectedCandidateActualRowCount > 0;
  // INVESTOR-FLOW-ACTUAL-ROW-CARRY-WIRING-001 — adapter actual row 를 selectedProvider 와
  // *완전히 분리*. 기존 `selectedProvider !== 'NONE'` guard 가 selectedProvider==='NONE'
  // (materialized 후보 0건) 케이스를 제외해 routerCarriesActualRow=0/46 결함 발생.
  // diagnosticActualInvestorRow 는 selectedProvider 무관 carry — DIAGNOSTIC_ONLY scope,
  // executionImpact='NONE', liveExecutionAllowed=false. CORE 결정 입력 아님.
  const actualRowProvider: 'KIS_API' | 'NAVER_INVESTOR_TREND' | 'UNKNOWN' | null =
    adapterFallbackActualRows.length > 0
      ? 'KIS_API'
      : selectedMaterializedCandidate?.actualInvestorRow
        ? (selectedProvider === 'NAVER_INVESTOR_TREND' ? 'NAVER_INVESTOR_TREND' : 'UNKNOWN')
        : null;
  const diagnosticActualInvestorRow: Record<string, unknown> | null =
    (adapterFallbackActualRows[0] as Record<string, unknown> | undefined)
    ?? (selectedMaterializedCandidate?.actualInvestorRow ?? null);
  const actualRowProviderMatchesSelected = actualRowProvider != null && selectedProvider === actualRowProvider && !diagnosticActualRowFromNormalized;
  const selectedProviderActualInvestorRow: Record<string, unknown> | null =
    actualRowProviderMatchesSelected ? diagnosticActualInvestorRow : null;
  const actualInvestorRowUseScope: 'SELECTED_PROVIDER' | 'DIAGNOSTIC_ONLY' | 'SHADOW_SCORE' | 'GATE_SCORE_ELIGIBLE' =
    actualRowProviderMatchesSelected ? 'SELECTED_PROVIDER' : 'DIAGNOSTIC_ONLY';
  // FIXED: `selectedProvider !== 'NONE'` guard 제거 — selectedProvider==='NONE' 도
  // adapter row 를 보유하면 cross-provider carry 로 인정.
  const adapterRowsForwardedAcrossProviders =
    actualRowProvider != null && selectedProvider !== actualRowProvider && diagnosticActualInvestorRow != null;
  const selectedCandidateActualRowFieldKeysTop = selectedMaterializedCandidate?.actualInvestorFlowFieldKeys ?? selectedActualRowFieldKeys;
  const selectedCandidateActualRowDropReason: ActualInvestorFlowDropReasonAdr0477 = selectedCandidateCarriesActualRow
    ? (adapterRowsForwardedAcrossProviders ? 'SELECTED_CANDIDATE_CARRIES_ACTUAL_ROW' : 'SELECTED_CANDIDATE_CARRIES_ACTUAL_ROW')
    : !input.kisInvestorRaw
      ? 'ADAPTER_ROW_NOT_PRESENT'
      : sanitizedInvestorFlowRows.length === 0
        ? 'NORMALIZER_DROPPED_ACTUAL_ROW'
        : !candidateBeforeSelectionCarriesActualRow
          ? 'MATERIALIZED_CANDIDATE_DROPPED_ACTUAL_ROW'
          : selectedProvider === 'KIS_API'
            ? 'SELECTED_CANDIDATE_DROPPED_ACTUAL_ROW'
            : 'UNKNOWN';
  if (selectedMaterializedCandidate) {
    selectedMaterializedCandidate.supplyProviderStatus = routeStatus;
    diagnostics.push(`[SELECTED_CANDIDATE_SUPPLY_ROW_ATTACHED] symbol=${input.code} hasActualInvestorRow=${Boolean(selectedMaterializedCandidate.actualInvestorRow ?? selectedCandidateActualRows[0])} hasSemanticInvestorRow=${Boolean(selectedMaterializedCandidate.semanticInvestorRow ?? selectedSemanticRow)} source=SUPPLY_ROUTER_BY_SYMBOL fieldKeys=${(selectedMaterializedCandidate.actualInvestorFlowFieldKeys ?? selectedCandidateActualRowFieldKeysTop).slice(0, 16).join(',') || 'NONE'} numericKeys=${(selectedMaterializedCandidate.actualInvestorFlowNumericKeys ?? selectedActualNumericFieldKeys).slice(0, 16).join(',') || 'NONE'}`);
  }
  diagnostics.push(`[INVESTOR_FLOW_ACTUAL_ROW_CARRY] symbol=${input.code} selectedProvider=${selectedProvider} actualRowProvider=${actualRowProvider ?? 'NONE'} useScope=${actualInvestorRowUseScope} materializationClass=${investorRowMaterializationClass} diagnosticActualRow=${diagnosticActualInvestorRow != null} diagnosticActualRowFromNormalized=${diagnosticActualRowFromNormalized} selectedProviderActualRow=${selectedProviderActualInvestorRow != null} adapterForwarded=${adapterRowsForwardedAcrossProviders} executionImpact=NONE liveExecutionAllowed=false`);
  const selectedSemanticNetBuy = semanticNetBuy as SemanticNetBuySample | null;
  const signal = selectedSemanticNetBuy?.signal ?? 'UNKNOWN';
  if (!semanticNetBuy && !selectedDiagnosticProvider && providerStatuses.NAVER === 'NOT_WIRED' && providerStatuses.CACHE === 'CACHE_EMPTY') {
    routeStatus = 'DATA_UNAVAILABLE';
  }
  const sourceAge = input.sourceAgeTradingDays ?? input.cacheAgeTradingDays ?? null;
  const oldest = [input.sourceAgeTradingDays, input.cacheAgeTradingDays, input.fssSourceAgeTradingDays]
    .filter((item): item is number => finiteNumber(item))
    .sort((a, b) => b - a)[0] ?? null;
  // ADR-0477 supply actual row carry — adapter 가 데이터 보유 시 router 가 무조건 carry
  // (selectedProvider 무관). selectedProvider != 'KIS_API' 일 때도 adapterFallbackActualRows
  // 가 router 결과로 propagate — diagnostic / SHADOW_SCORE 전용, executionImpact='NONE'.
  const routerCarriesActualRow = selectedCandidateCarriesActualRow
    || (selectedProvider === 'KIS_API' && sanitizedInvestorFlowRows.length > 0)
    || adapterRowsForwardedAcrossProviders;
  const routerVerifiedGuardStatus: InvestorFlowProviderStatus = routeStatus === 'VERIFIED' && (selectedProvider === 'KIS_API' || providerStatuses.KIS_API === 'VERIFIED') && !routerCarriesActualRow
    ? (adapterCarriesActualRow ? 'VERIFIED_ADAPTER_ONLY' : 'SEMANTIC_CARRY_FAILED')
    : routeStatus;
  const status = signal === 'UNKNOWN' && routerVerifiedGuardStatus === 'VERIFIED' ? 'DEGRADED' : routerVerifiedGuardStatus;
  const inputSources = Array.from(new Set([
    ...multiSourceMaterialization.candidates.filter((candidate) => candidate.sampleMaterialized).map((candidate) => candidate.provider),
    ...(input.naverCollectorResultAdr0481?.semanticNetBuyCandidate ? ['NAVER_INVESTOR_TREND' as const] : []),
    ...(input.semanticNetBuyNormalizationAdr0482?.samples.map((sample) => providerFromSemanticAdr0482(sample.provider)) ?? []),
    ...(cacheLookupSample || input.cacheRaw || input.previousTradingDayCacheRaw ? ['CACHE' as const] : []),
    ...(selectedDiagnosticProvider ? [selectedDiagnosticProvider] : []),
  ]));
  const statusCoverage = coverageFromStatuses(providerStatuses);
  const fallbackChain: InvestorFlowProviderId[] = ['KRX_SYMBOL_INVESTOR_FLOW', 'KRX_MARKET_INVESTOR_FLOW', 'KIS_API', 'FSS_PASSIVE_ACTIVE', 'NAVER_INVESTOR_TREND', 'CACHE', 'SEMANTIC_NETBUY'];
  const selectedProviderForDiagnostics = selectedProvider as InvestorFlowProviderId;
  const rejectedReasonByProvider: Record<string, string> = {};
  for (const [providerName, materialization] of Object.entries(materializationDiagnostics)) {
    const provider = providerIdFromMaterializationAdr0477(providerName as InvestorSampleProviderNameAdr0502);
    if (provider === selectedProviderForDiagnostics) continue;
    if (materialization?.usableForRouter === true) continue;
    rejectedReasonByProvider[providerName] = materialization
      ? `blockedReason=${materialization.blockedReason}; sampleMaterialized=${materialization.sampleMaterialized}; usableForRouter=${materialization.usableForRouter}; rawCount=${materialization.rawCount}; normalizedCount=${materialization.normalizedCount}; materializedCount=${materialization.materializedCount}; placeholderDetected=${materialization.placeholderDetected}; inputSourceKind=${materialization.inputSourceKind}`
      : providerReasons[provider] ?? providerStatuses[provider] ?? 'NO_DIAGNOSTIC';
  }
  for (const provider of ['KRX_SYMBOL_INVESTOR_FLOW', 'KRX_MARKET_INVESTOR_FLOW', 'KRX_INVESTOR_FLOW', 'KIS_API', 'FSS_PASSIVE_ACTIVE', 'NAVER_INVESTOR_TREND', 'CACHE', 'SEMANTIC_NETBUY'] as const) {
    if (provider === selectedProviderForDiagnostics || rejectedReasonByProvider[provider]) continue;
    if (providerStatuses[provider]) rejectedReasonByProvider[provider] = providerReasons[provider] ?? `status=${providerStatuses[provider]}`;
  }
  const rejectedProviders = Object.keys(rejectedReasonByProvider) as InvestorFlowProviderId[];
  const coverageAfterSet = new Set<InvestorFlowProviderId>();
  for (const materialization of Object.values(materializationDiagnostics)) {
    const provider = materialization ? providerIdFromMaterializationAdr0477(materialization.providerName) : 'UNKNOWN';
    const staleCacheRouterBlocked = kisFirstMode && provider === 'CACHE' && (providerStatuses.CACHE === 'CACHE_STALE_HIT' || providerStatuses.CACHE === 'STALE');
    if (materialization?.usableForRouter && !staleCacheRouterBlocked) coverageAfterSet.add(provider);
  }
  if (selectedProviderForDiagnostics !== 'NONE' && selectedDiagnosticProvider !== selectedProviderForDiagnostics) coverageAfterSet.add(selectedProviderForDiagnostics);
  const coverageAfter = coverageAfterSet.size;
  const routerUsableCoverage = {
    available: coverageAfterSet.size,
    total: statusCoverage.total,
  };
  const diagnosticUsableCoverageSet = new Set<InvestorFlowProviderId>();
  for (const candidate of diagnosticUsableCandidates) diagnosticUsableCoverageSet.add(candidate.provider);
  const diagnosticUsableCount = diagnosticUsableCoverageSet.size;
  const diagnosticUsableCoverage = {
    available: diagnosticUsableCount,
    total: statusCoverage.total,
  };
  const fallbackProvider: InvestorFlowProviderId | null = staleCacheQuarantinedByKisFirst ? 'CACHE' : null;
  const fallbackStatus: InvestorFlowProviderStatus | null = staleCacheQuarantinedByKisFirst ? 'CACHE_STALE_HIT' : null;
  const fallbackDiagnosticOnly = staleCacheQuarantinedByKisFirst;
  const cacheFallbackReason = selectedProviderForDiagnostics === 'CACHE'
    ? `CACHE selected after rejectedProviders=${rejectedProviders.join(',') || 'NONE'}; selectedReason=${selectedReason ?? 'NONE'}`
    : staleCacheQuarantinedByKisFirst
      ? 'CACHE_STALE_HIT retained as fallbackDiagnosticOnly under KIS_FIRST_REBUILD_MODE=true; selectedProvider=NONE'
    : null;
  const staleButSelectedReason = selectedSemanticNetBuy?.status === 'STALE' || selectedSemanticNetBuy?.status === 'CACHE_STALE_HIT'
    ? `stale selected for SHADOW_ONLY diagnostic only; provider=${selectedProviderForDiagnostics}; status=${selectedSemanticNetBuy.status}; liveExecutionAllowed=false`
    : null;
  diagnostics.push(`fallbackChain=${fallbackChain.join('>')}; selectedProvider=${selectedProviderForDiagnostics}; rejectedProviders=${rejectedProviders.join(',') || 'NONE'}; cacheFallbackReason=${cacheFallbackReason ?? 'NONE'}; staleButSelectedReason=${staleButSelectedReason ?? 'NONE'}; coverageBefore=${statusCoverage.available}; coverageAfter=${coverageAfter}; routerUsableCoverage=${routerUsableCoverage.available}/${routerUsableCoverage.total}; diagnosticUsableCoverage=${diagnosticUsableCoverage.available}/${diagnosticUsableCoverage.total}; diagnosticUsableCount=${diagnosticUsableCount}; selectedDiagnosticProvider=${selectedDiagnosticProvider ?? 'NONE'}; coverageBasis=routerUsableSampleCount plus selected SHADOW fallback.`);
  diagnostics.push(`sourceOfTruth=${selectedProvider === 'KRX_INVESTOR_FLOW' || selectedProvider === 'KRX_SYMBOL_INVESTOR_FLOW' || selectedProvider === 'KRX_MARKET_INVESTOR_FLOW' ? 'KRX' : selectedProvider === 'FSS_PASSIVE_ACTIVE' ? 'FSS_OFFICIAL_DIAGNOSTIC' : selectedProvider === 'NAVER_INVESTOR_TREND' ? 'NAVER_SECONDARY' : selectedProvider === 'CACHE' ? 'CACHE_STALE_FALLBACK' : selectedProvider === 'SEMANTIC_NETBUY' ? 'SEMANTIC_DERIVED' : selectedProvider}; NAVER role=SECONDARY; SEMANTIC role=DERIVED; CACHE role=STALE_FALLBACK`);
  const kisSelectedCandidateCarriesSemanticRow = selectedProvider === 'KIS_API' && Boolean(selectedSemanticRow);
  const semanticRowBreakPoint = selectedProvider === 'KIS_API'
    ? !input.kisInvestorRaw
      ? 'ADAPTER_DID_NOT_ATTACH_ACTUAL_ROW'
      : sanitizedInvestorFlowRows.length === 0 && selectedActualWrapperOnly
        ? 'ACTUAL_ROW_CARRIED_BUT_EMPTY'
        : sanitizedInvestorFlowRows.length === 0
          ? 'ADAPTER_DID_NOT_ATTACH_ACTUAL_ROW'
          : !kisRawRowAvailableAtAdapter
            ? 'ADAPTER_DID_NOT_RETURN_RAW_ROW'
            : !selectedSemanticRow
              ? 'ROUTER_SELECTED_CANDIDATE_DROPPED_ACTUAL_ROW'
              : !kisNormalizedRowAvailableAtRouter
                ? 'ACTUAL_ROW_CARRIED_ALIAS_NOT_MAPPED'
                : 'ACTUAL_ROW_CARRIED_WITH_FIELDS'
    : undefined;
  diagnostics.push(`kisRawRowAvailableAtAdapter=${kisRawRowAvailableAtAdapter}; kisNormalizedRowAvailableAtRouter=${kisNormalizedRowAvailableAtRouter}; kisSelectedCandidateCarriesSemanticRow=${kisSelectedCandidateCarriesSemanticRow}; semanticRowBreakPoint=${semanticRowBreakPoint ?? 'UNKNOWN'}; selectedActualRowPath=${selectedActualRowPath ?? 'none'}; selectedActualRowFieldKeys=${selectedActualRowFieldKeys.join(',') || 'none'}; selectedActualNumericStringFieldKeys=${selectedActualNumericStringFieldKeys.join(',') || 'none'}; sanitizedInvestorFlowRows=${sanitizedInvestorFlowRows.length}; rawPayloadPersistenceAllowed=false`);
  const routeBySymbolPayload: InvestorFlowProviderRouteBySymbolPayloadAdr0477 = {
    code: input.code,
    requestSymbol: input.code,
    candidateSymbol: selectedSemanticNetBuy?.code ?? input.code,
    quoteSymbol: input.code,
    providerSymbol: selectedSemanticNetBuy?.code ?? input.code,
    normalizedSymbol: selectedSemanticNetBuy?.code ?? input.code,
    providerScope: selectedSemanticNetBuy?.code ? 'SYMBOL_LEVEL' : 'UNKNOWN',
    routePurpose: 'GATE1_FORENSIC_SHADOW_AUDIT',
    materialized: Boolean(selectedMaterializedCandidate?.sampleMaterialized ?? selectedSemanticNetBuy),
    usableForRouter: selectedProvider !== 'NONE',
    usableForGate: false,
    usableForLive: false,
    usableForShadow: true,
    selectedProvider,
    semanticRow: selectedSemanticRow,
    gateSemanticFlatRow: selectedGateSemanticFlatRow,
    // ADR-0477 carry fix — adapter row 가 모든 selectedProvider 에서 fallback. selectedProvider 의
    // CORE 결정은 그대로 (selectedMaterializedCandidate.actualInvestorRow 우선), KIS adapter 는 마지막
    // fallback 으로 diagnostic 자료 보존. executionImpact='NONE' literal 유지.
    actualInvestorRow: selectedMaterializedCandidate?.actualInvestorRow ?? selectedCandidateActualRows[0] ?? adapterFallbackActualRows[0] ?? null,
    normalizedInvestorRow: selectedMaterializedCandidate?.normalizedInvestorRow ?? normalizedInvestorRowFromSemanticAdr0477(selectedSemanticRow) ?? null,
    semanticInvestorRow: selectedMaterializedCandidate?.semanticInvestorRow ?? selectedSemanticRow,
    supplySemanticRow: selectedMaterializedCandidate?.supplySemanticRow ?? selectedSemanticRow,
    actualRowAvailable: Boolean(selectedMaterializedCandidate?.actualInvestorRow ?? selectedCandidateActualRows[0] ?? adapterFallbackActualRows[0]),
    normalizedRowAvailable: Boolean(selectedMaterializedCandidate?.normalizedInvestorRow ?? selectedSemanticRow),
    semanticRowAvailable: Boolean(selectedMaterializedCandidate?.semanticInvestorRow ?? selectedSemanticRow),
    // rowCarryPath — ADAPTER_TO_ROUTER 은 KIS_API selected 또는 adapter fallback 모두 인정.
    rowCarryPath: selectedProvider === 'KIS_API' || adapterRowsForwardedAcrossProviders ? 'ADAPTER_TO_ROUTER' : 'NONE',
    sanitizedInvestorFlowRows,
    actualInvestorFlowRows: selectedProvider === 'KIS_API' ? selectedCandidateActualRows : (sanitizedInvestorFlowRows.length > 0 ? sanitizedInvestorFlowRows : selectedCandidateActualRows),
    actualInvestorFlowRowCount: selectedProvider === 'KIS_API' ? selectedCandidateActualRowCount : (sanitizedInvestorFlowRows.length > 0 ? sanitizedInvestorFlowRows.length : selectedCandidateActualRowCount),
    actualInvestorFlowRowSourcePath: selectedMaterializedCandidate?.actualInvestorFlowRowSourcePath ?? selectedActualRowPath,
    actualInvestorFlowFieldKeys: selectedMaterializedCandidate?.actualInvestorFlowFieldKeys ?? selectedActualRowFieldKeys,
    actualInvestorFlowNumericKeys: selectedMaterializedCandidate?.actualInvestorFlowNumericKeys ?? Array.from(new Set([...selectedActualNumericFieldKeys, ...selectedActualNumericStringFieldKeys])),
    actualInvestorFlowNumericStringKeys: selectedMaterializedCandidate?.actualInvestorFlowNumericStringKeys ?? selectedActualNumericStringFieldKeys,
    // actualInvestorFlowCarried — selectedProvider 무관 adapter carry 인정 (diagnostic only).
    actualInvestorFlowCarried: (selectedProvider === 'KIS_API' && selectedCandidateCarriesActualRow) || adapterRowsForwardedAcrossProviders,
    adapterRowsForwardedAcrossProviders,
    // INVESTOR-FLOW-ACTUAL-ROW-CARRY-WIRING-001 — diagnostic actual row 를 bySymbol payload
    // 에 저장 (selectedProvider 무관). forensic 단계가 이 payload 를 merge 해 carry 유지.
    diagnosticActualInvestorRow,
    selectedProviderActualInvestorRow,
    actualInvestorRowProvider: actualRowProvider,
    actualInvestorRowUseScope,
    investorRowMaterializationClass,
    diagnosticActualInvestorRowFromNormalized: diagnosticActualRowFromNormalized,
    selectedCandidate: selectedMaterializedCandidate,
    selectedActualRowPath,
    selectedActualRowFieldKeys,
    selectedActualNumericFieldKeys,
    selectedActualNumericStringFieldKeys,
    selectedActualPlaceholderFieldKeys,
    kisRawRowAvailableAtAdapter,
    kisNormalizedRowAvailableAtRouter,
    kisSelectedCandidateCarriesSemanticRow,
    semanticRowBreakPoint,
    status,
    signal,
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    scoreUsage: 'SHADOW_ONLY',
  };
  const routeBySymbolKey = normalizeCodeAdr0477(input.code);
  diagnostics.push(`adapterCarriesActualRow=${String(adapterCarriesActualRow)}; routerCarriesActualRow=${String(routerCarriesActualRow)}; adapterRowsForwardedAcrossProviders=${String(adapterRowsForwardedAcrossProviders)}; candidateBeforeSelectionCarriesActualRow=${String(candidateBeforeSelectionCarriesActualRow)}; selectedCandidateCarriesActualRow=${String(selectedCandidateCarriesActualRow)}; selectedCandidateActualRowCount=${selectedCandidateActualRowCount}; selectedCandidateActualRowFieldKeysTop=${selectedCandidateActualRowFieldKeysTop.slice(0, 16).join(',') || 'NONE'}; selectedCandidateActualRowDropReason=${selectedCandidateActualRowDropReason}; executionImpact=NONE; scoreUsage=SHADOW_ONLY`);
  diagnostics.push(`[SUPPLY_ROUTER_VERIFIED_GUARD] symbol=${input.code} adapterHasActualRow=${adapterCarriesActualRow} routerCarriesActualRow=${routerCarriesActualRow} adapterRowsForwardedAcrossProviders=${adapterRowsForwardedAcrossProviders} candidateCarriesActualRow=${selectedCandidateCarriesActualRow} forensicCarriesActualRow=deferred routerStatus=${status}`);
  diagnostics.push(`multiSourceCandidates=${multiSourceMaterialization.candidates.map((candidate) => `${candidate.provider}:${candidate.materializedCount}:${candidate.blockedReason}:priority=${candidate.selectedPriority}`).join('|') || 'NONE'}; noMaterializedCandidateReason=${multiSourceMaterialization.noMaterializedCandidateReason ?? 'NONE'}`);
  for (const materialization of Object.values(materializationDiagnostics)) {
    diagnostics.push(formatInvestorSampleDiagnosticsAdr0502(materialization));
  }

  return {
    code: input.code,
    route: 'investor_flow',
    requestSymbol: input.code,
    candidateSymbol: input.code,
    quoteSymbol: input.code,
    providerSymbol: selectedSemanticNetBuy?.code ?? null,
    normalizedSymbol: selectedSemanticNetBuy?.code ?? input.code,
    providerScope: 'SYMBOL_LEVEL',
    routePurpose: 'SYMBOL_LEVEL_INVESTOR_FLOW_SHADOW_AUDIT',
    materialized: Boolean(selectedSemanticNetBuy),
    usableForRouter: routerUsableCoverage.available > 0,
    usableForGate: false,
    usableForLive: false,
    usableForShadow: true,
    scoreUsage: 'SHADOW_ONLY',
    inferredSymbolMatched: !selectedSemanticNetBuy?.code && Boolean(input.code),
    selectedProvider,
    providerTried,
    providerReasons,
    providerStatuses,
    semanticNetBuy: selectedSemanticNetBuy,
    semanticRow: selectedSemanticRow,
    gateSemanticFlatRow: selectedGateSemanticFlatRow,
    // ADR-0477 carry fix — top-level result 도 bySymbol 과 동일 fallback 패턴.
    actualInvestorRow: selectedMaterializedCandidate?.actualInvestorRow ?? selectedCandidateActualRows[0] ?? adapterFallbackActualRows[0] ?? null,
    normalizedInvestorRow: selectedMaterializedCandidate?.normalizedInvestorRow ?? normalizedInvestorRowFromSemanticAdr0477(selectedSemanticRow) ?? null,
    semanticInvestorRow: selectedMaterializedCandidate?.semanticInvestorRow ?? selectedSemanticRow,
    supplySemanticRow: selectedMaterializedCandidate?.supplySemanticRow ?? selectedSemanticRow,
    actualRowAvailable: Boolean(selectedMaterializedCandidate?.actualInvestorRow ?? selectedCandidateActualRows[0] ?? adapterFallbackActualRows[0]),
    normalizedRowAvailable: Boolean(selectedMaterializedCandidate?.normalizedInvestorRow ?? selectedSemanticRow),
    semanticRowAvailable: Boolean(selectedMaterializedCandidate?.semanticInvestorRow ?? selectedSemanticRow),
    rowCarryPath: selectedProvider === 'KIS_API' || adapterRowsForwardedAcrossProviders ? 'ADAPTER_TO_ROUTER' : 'NONE',
    sanitizedInvestorFlowRows,
    actualInvestorFlowRows: selectedProvider === 'KIS_API' ? selectedCandidateActualRows : (sanitizedInvestorFlowRows.length > 0 ? sanitizedInvestorFlowRows : selectedCandidateActualRows),
    actualInvestorFlowRowCount: selectedProvider === 'KIS_API' ? selectedCandidateActualRowCount : (sanitizedInvestorFlowRows.length > 0 ? sanitizedInvestorFlowRows.length : selectedCandidateActualRowCount),
    actualInvestorFlowRowSourcePath: selectedMaterializedCandidate?.actualInvestorFlowRowSourcePath ?? selectedActualRowPath,
    actualInvestorFlowFieldKeys: selectedMaterializedCandidate?.actualInvestorFlowFieldKeys ?? selectedActualRowFieldKeys,
    actualInvestorFlowNumericKeys: selectedMaterializedCandidate?.actualInvestorFlowNumericKeys ?? Array.from(new Set([...selectedActualNumericFieldKeys, ...selectedActualNumericStringFieldKeys])),
    actualInvestorFlowNumericStringKeys: selectedMaterializedCandidate?.actualInvestorFlowNumericStringKeys ?? selectedActualNumericStringFieldKeys,
    actualInvestorFlowCarried: (selectedProvider === 'KIS_API' && selectedCandidateCarriesActualRow) || adapterRowsForwardedAcrossProviders,
    adapterRowsForwardedAcrossProviders,
    diagnosticActualInvestorRow,
    selectedProviderActualInvestorRow,
    actualInvestorRowProvider: actualRowProvider,
    actualInvestorRowUseScope,
    investorRowMaterializationClass,
    diagnosticActualInvestorRowFromNormalized: diagnosticActualRowFromNormalized,
    selectedCandidate: selectedMaterializedCandidate,
    bySymbol: { [routeBySymbolKey]: routeBySymbolPayload },
    selectedActualRowPath,
    selectedActualRowFieldKeys,
    selectedActualNumericFieldKeys,
    selectedActualNumericStringFieldKeys,
    selectedActualPlaceholderFieldKeys,
    kisRawRowAvailableAtAdapter,
    kisNormalizedRowAvailableAtRouter,
    kisSelectedCandidateCarriesSemanticRow,
    semanticRowBreakPoint,
    status,
    signal,
    coverage: {
      ...statusCoverage,
      available: routerUsableCoverage.available,
    },
    freshness: {
      cacheState: cacheState(providerStatuses.CACHE),
      sourceState: sourceState(sourceAge),
      sourceAgeTradingDays: sourceAge,
      oldestSourceAgeTradingDays: oldest,
      lastSourceDate: selectedSemanticNetBuy?.sourceDate ?? null,
    },
    ...ROUTER_POLICY,
    selectedReason,
    inputSources,
    cacheFallbackUsed: selectedProvider === 'CACHE' || selectedSemanticNetBuy?.source === 'CACHE',
    semanticInputStatus: providerStatuses.SEMANTIC_NETBUY ?? 'DATA_UNAVAILABLE',
    naverSampleStatus: providerStatuses.NAVER_INVESTOR_TREND ?? providerStatuses.NAVER ?? 'DATA_UNAVAILABLE',
    naverReadinessKind: naverFreshDataSnapshot?.readinessKind,
    semanticReadinessKind: semanticFreshDataSnapshot?.readinessKind,
    selectedFreshness: selectedDiagnosticProvider
      ? (routeStatus === 'STALE' || routeStatus === 'CACHE_STALE_HIT' ? 'STALE' : routeStatus === 'OBSERVING' || routeStatus === 'CACHE_HIT' ? 'UNKNOWN' : 'MISSING')
      : selectedSemanticNetBuy?.status === 'STALE' || selectedSemanticNetBuy?.status === 'CACHE_STALE_HIT'
      ? 'STALE'
      : selectedSemanticNetBuy?.status === 'VERIFIED' || selectedSemanticNetBuy?.status === 'READY_FOR_SHADOW' || selectedSemanticNetBuy?.status === 'PARTIAL' || selectedSemanticNetBuy?.status === 'CACHE_HIT'
        ? 'FRESH'
        : selectedSemanticNetBuy ? 'UNKNOWN' : 'MISSING',
    selectedConfidence: selectedSemanticNetBuy?.confidence ?? (selectedDiagnosticProvider ? 'LOW' : 'NONE'),
    routerUsableCoverage,
    diagnosticUsableCoverage,
    selectedDiagnosticProvider,
    selectedDiagnosticReason,
    selectedForLive: false,
    selectedForShadow: selectedProvider !== 'NONE',
    kisFirstMode,
    dryRunLane: kisFirstMode ? 'LEGACY_DIAGNOSTIC' : undefined,
    usedForCurrentGate: false,
    usedForLiveDecision: false,
    fallbackProvider,
    fallbackStatus,
    fallbackDiagnosticOnly,
    legacyDryRunSummary: kisFirstMode
      ? 'ADR-0467/0468/0469/0470/0471/0472/0475/0476/0477 emitted; usedForCurrentGate=false; executionImpact=NONE'
      : null,
    krxSourceRepairDiagnostic: input.krxInvestorDiagnosticAdr0505
      ? {
          parserStatus: input.krxInvestorDiagnosticAdr0505.parserStatus,
          endpointIssueHint: input.krxInvestorDiagnosticAdr0505.endpointIssueHint,
          selectedKrxFlowMode: input.krxInvestorDiagnosticAdr0505.selectedKrxFlowMode,
          payloadMode: input.krxInvestorDiagnosticAdr0505.payloadMode,
          routePurpose: input.krxInvestorDiagnosticAdr0505.routePurpose,
          selectedBld: input.krxInvestorDiagnosticAdr0505.selectedBld,
          requiredParamMissing: input.krxInvestorDiagnosticAdr0505.requiredParamMissing,
          shortCodeToIsuCdResolved: input.krxInvestorDiagnosticAdr0505.shortCodeToIsuCdResolved,
          isuCd: input.krxInvestorDiagnosticAdr0505.isuCd,
          inqTpCd: input.krxInvestorDiagnosticAdr0505.inqTpCd,
          inqVal: input.krxInvestorDiagnosticAdr0505.inqVal,
          detailView: input.krxInvestorDiagnosticAdr0505.detailView,
          tradeDate: input.krxInvestorDiagnosticAdr0505.tradeDate,
          previousTradingDateCandidate: input.krxInvestorDiagnosticAdr0505.previousTradingDateCandidate,
          selectedVariant: input.krxInvestorDiagnosticAdr0505.selectedVariant,
          otpGenerated: input.krxInvestorDiagnosticAdr0505.otpGenerated,
          csvDownloaded: input.krxInvestorDiagnosticAdr0505.csvDownloaded,
          csvRowCount: input.krxInvestorDiagnosticAdr0505.csvRowCount,
          csvHeaderDetected: input.krxInvestorDiagnosticAdr0505.csvHeaderDetected,
          csvNoDataReason: input.krxInvestorDiagnosticAdr0505.csvNoDataReason,
          omittedKeys: input.krxInvestorDiagnosticAdr0505.omittedKeys,
          forbiddenKeysPresent: input.krxInvestorDiagnosticAdr0505.forbiddenKeysPresent,
          requiredKeysPresent: input.krxInvestorDiagnosticAdr0505.requiredKeysPresent,
          requiredKeysMissing: input.krxInvestorDiagnosticAdr0505.requiredKeysMissing,
          sentPayloadKeys: input.krxInvestorDiagnosticAdr0505.sentPayloadKeys,
          contentType: input.krxInvestorDiagnosticAdr0505.contentType,
          responseKind: input.krxInvestorDiagnosticAdr0505.responseKind,
          consecutiveFailures: input.krxInvestorDiagnosticAdr0505.consecutiveFailures,
          cooldownActive: input.krxInvestorDiagnosticAdr0505.cooldownActive,
          cooldownRemainingMs: input.krxInvestorDiagnosticAdr0505.cooldownRemainingMs,
          offHoursSuppressed: input.krxInvestorDiagnosticAdr0505.offHoursSuppressed,
          diagnosticOnly: input.krxInvestorDiagnosticAdr0505.diagnosticOnly,
          useForRouter: input.krxInvestorDiagnosticAdr0505.useForRouter,
          useForGate: input.krxInvestorDiagnosticAdr0505.useForGate,
          useForLive: input.krxInvestorDiagnosticAdr0505.useForLive,
          useForShadow: input.krxInvestorDiagnosticAdr0505.useForShadow,
          selectedRowCount: input.krxInvestorDiagnosticAdr0505.selectedRowCount,
          normalizedRows: input.krxInvestorDiagnosticAdr0505.normalizedRows,
          summary: input.krxInvestorDiagnosticAdr0505.summary,
        }
      : null,
    materializationDiagnostics,
    rejectedProviders,
    rejectedReasonByProvider,
    fallbackChain,
    cacheFallbackReason,
    staleButSelectedReason,
    coverageBefore: statusCoverage.available,
    coverageAfter,
    diagnosticUsableCount,
    noMaterializedCandidateReason: multiSourceMaterialization.noMaterializedCandidateReason,
    diagnostics,
  };
}
