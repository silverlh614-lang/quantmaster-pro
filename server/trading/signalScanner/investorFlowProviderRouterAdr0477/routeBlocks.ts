/**
 * @responsibility ADR-0477 investor flow route builder block helpers — mutate shared accumulator, byte-equivalent.
 */

import type { SemanticNetBuySampleAdr0482 } from '../semanticNetBuyNormalizerAdr0482.js';
import type { FreshDataSnapshotAdr0487 } from '../freshDataSupplyLayerAdr0487.js';
import type { SupplySnapshotCacheLookupAdr0491 } from '../supplySnapshotStoreReplayAdr0491.js';
import { normalizeInvestorFlowSnapshotKeyAdr0491 } from '../investorFlowSnapshotKeyNormalizerAdr0491.js';
import {
  buildInvestorSampleDiagnosticsAdr0502,
  type InvestorSampleDiagnosticsAdr0502,
  type InvestorSampleProviderNameAdr0502,
} from '../investorSampleMaterializationAdr0502.js';
import { buildSanitizedInvestorFlowSemanticRow, hasActualInvestorNumericRow, type SanitizedInvestorFlowSemanticRow } from '../../../supply/investorFlowSemanticAvailability.js';
import type {
  ActualInvestorFlowCarryAdr0477,
  InvestorFlowProviderId,
  InvestorFlowProviderRouterInput,
  InvestorFlowProviderStatus,
  InvestorRowMaterializationClass,
  SemanticNetBuySample,
} from './types.js';
import {
  mapSemanticNetBuyStatusAdr0482ToAdr0477,
  normalizeSemanticNetBuySampleAdr0477,
  selectedActualRowDiagnosticsAdr0477,
} from './primitives.js';
import {
  cacheLookupStatusAdr0477,
  compactClosestMatchesAdr0477,
  compactRetainedSummaryAdr0477,
  compactRouterLookupAdr0477,
  freshDataSnapshotMaterializedAdr0477,
  freshDataSnapshotSampleAdr0477,
  freshDataSnapshotUsableForRouterAdr0477,
  formatKrxRepairDiagnosticAdr0477,
  isKrxQuarantineDiagnosticAdr0477,
  isOptionalKrxInvestorDetailUnavailableAdr0477,
  krxDiagnosticStatusAdr0477,
  krxOptionalDetailExcludedReasonAdr0477,
  materializationFromSemanticSampleAdr0477,
  sampleFromCacheLookupAdr0491,
  statusFromFreshDataSnapshot,
} from './freshDataAdapters.js';
import {
  normalizedInvestorRowFromSemanticAdr0477,
  supplyNumericKeysAdr0477,
  supplyRowKeysAdr0477,
} from './materialization.js';
import {
  mapNaverAdr0481StatusToAdr0477,
  providerFromSemanticAdr0482,
  sampleFromSemanticAdr0482,
  semanticNetBuyDiagnosticCandidate,
  semanticNetBuyFreshCandidate,
} from './semanticAdapters.js';

/**
 * 함수-스코프 mutable 지역상태를 단일 참조 객체로 보유. scalar 는 프로퍼티, 누적 객체/배열은 참조.
 * buildInvestorFlowProviderRouteResultAdr0477 와 byte-equivalent 동작 보장 (값 보존).
 */
export interface RouteAccumulatorAdr0477 {
  providerStatuses: Record<string, InvestorFlowProviderStatus>;
  providerReasons: Record<string, string>;
  diagnostics: string[];
  selectedProvider: InvestorFlowProviderId;
  selectedReason: string | null;
  semanticNetBuy: SemanticNetBuySample | null;
  routeStatus: InvestorFlowProviderStatus;
  pendingSemanticFresh: SemanticNetBuySampleAdr0482 | null;
  pendingSemanticDiagnostic: SemanticNetBuySampleAdr0482 | null;
  pendingNaverStale: SemanticNetBuySample | null;
  materializationDiagnostics: Partial<Record<InvestorSampleProviderNameAdr0502, InvestorSampleDiagnosticsAdr0502>>;
  samplesByProvider: Partial<Record<InvestorFlowProviderId, SemanticNetBuySample>>;
  actualRowCarryByProvider: Partial<Record<InvestorFlowProviderId, ActualInvestorFlowCarryAdr0477>>;
  semanticRowsByProvider: Partial<Record<InvestorFlowProviderId, SanitizedInvestorFlowSemanticRow>>;
  kisRawRowAvailableAtAdapter: boolean;
  kisNormalizedRowAvailableAtRouter: boolean;
  selectedActualRowPath: string | null;
  sanitizedInvestorFlowRows: Array<Record<string, unknown>>;
  kisNormalizedDiagnosticInvestorRow: Record<string, unknown> | null;
  kisSemanticDiagnosticInvestorRow: Record<string, unknown> | null;
  investorRowMaterializationClass: InvestorRowMaterializationClass;
  selectedActualRowFieldKeys: string[];
  selectedActualNumericFieldKeys: string[];
  selectedActualNumericStringFieldKeys: string[];
  selectedActualPlaceholderFieldKeys: string[];
  selectedActualWrapperOnly: boolean;
}

/**
 * 함수 prologue 에서 1회 계산되어 블록 helper 와 result build 로 전달되는 read-only const 묶음.
 * 이들 중 일부(naverFreshDataSnapshot 등)는 downstream 에서도 소비되므로 prologue 에 보존.
 */
export interface RoutePrologueAdr0477 {
  collectedAt: string;
  kisFirstMode: boolean;
  providerTried: InvestorFlowProviderId[];
  naverFreshDataSnapshot: FreshDataSnapshotAdr0487 | null;
  freshNaver: SemanticNetBuySample | null;
  semanticFreshDataSnapshot: FreshDataSnapshotAdr0487 | null;
  freshSemantic: SemanticNetBuySample | null;
  cacheLookup: SupplySnapshotCacheLookupAdr0491 | null | undefined;
  cacheLookupSample: SemanticNetBuySample | null;
}

export function createRouteAccumulatorAdr0477(input: InvestorFlowProviderRouterInput): RouteAccumulatorAdr0477 {
  return {
    providerStatuses: {},
    providerReasons: {},
    diagnostics: [],
    selectedProvider: 'NONE',
    selectedReason: null,
    semanticNetBuy: null,
    routeStatus: input.nonTradingDay === true ? 'NON_TRADING_DAY' : 'DATA_UNAVAILABLE',
    pendingSemanticFresh: null,
    pendingSemanticDiagnostic: null,
    pendingNaverStale: null,
    materializationDiagnostics: {},
    samplesByProvider: {},
    actualRowCarryByProvider: {},
    semanticRowsByProvider: {},
    kisRawRowAvailableAtAdapter: false,
    kisNormalizedRowAvailableAtRouter: false,
    selectedActualRowPath: null,
    sanitizedInvestorFlowRows: [],
    kisNormalizedDiagnosticInvestorRow: null,
    kisSemanticDiagnosticInvestorRow: null,
    investorRowMaterializationClass: 'MISSING',
    selectedActualRowFieldKeys: [],
    selectedActualNumericFieldKeys: [],
    selectedActualNumericStringFieldKeys: [],
    selectedActualPlaceholderFieldKeys: [],
    selectedActualWrapperOnly: false,
  };
}

function selectShadowAdr0477(
  acc: RouteAccumulatorAdr0477,
  provider: InvestorFlowProviderId,
  sample: SemanticNetBuySample,
  reason: string,
): void {
  if (provider === 'NAVER_INVESTOR_TREND') {
    acc.samplesByProvider.NAVER_INVESTOR_TREND = sample;
    acc.providerReasons.NAVER_INVESTOR_TREND = `${reason}; selectedProviderCandidate=false; diagnosticOnly=true; reason=NAVER_SECONDARY_NOT_ROUTER_SELECTABLE; executionImpact=NONE`;
    acc.diagnostics.push(acc.providerReasons.NAVER_INVESTOR_TREND);
    return;
  }
  if (acc.semanticNetBuy) return;
  acc.selectedProvider = provider;
  acc.selectedReason = reason;
  acc.semanticNetBuy = sample;
  acc.samplesByProvider[provider] = sample;
  acc.routeStatus = sample.status;
  acc.providerReasons[provider] = reason;
  acc.diagnostics.push(reason);
}

export function applyNaverFreshBlockAdr0477(
  acc: RouteAccumulatorAdr0477,
  input: InvestorFlowProviderRouterInput,
  prologue: RoutePrologueAdr0477,
): void {
  if (input.nonTradingDay === true) {
    acc.providerStatuses.KRX = 'NON_TRADING_DAY';
    acc.diagnostics.push('NON_TRADING_DAY is data unavailable, not bearish.');
  }

  const { naverFreshDataSnapshot, freshNaver } = prologue;
  if (freshNaver) {
    acc.materializationDiagnostics.NAVER_INVESTOR_TREND = materializationFromSemanticSampleAdr0477('NAVER_INVESTOR_TREND', freshNaver, 'NORMALIZED_PROVIDER');
    acc.samplesByProvider.NAVER_INVESTOR_TREND = freshNaver;
    acc.providerStatuses.NAVER = freshNaver.status;
    acc.providerStatuses.NAVER_INVESTOR_TREND = freshNaver.status;
    acc.providerReasons.NAVER_INVESTOR_TREND = 'FreshData registry bridge READY_FOR_SHADOW normalized NAVER_INVESTOR_TREND sample; role=SECONDARY sourceOfTruth=KRX when KRX is available.';
    selectShadowAdr0477(acc, 'NAVER_INVESTOR_TREND', freshNaver, acc.providerReasons.NAVER_INVESTOR_TREND);
  } else if (naverFreshDataSnapshot) {
    const sampleMaterialized = freshDataSnapshotMaterializedAdr0477(naverFreshDataSnapshot);
    const usableForRouter = freshDataSnapshotUsableForRouterAdr0477(naverFreshDataSnapshot);
    acc.providerStatuses.NAVER = sampleMaterialized ? statusFromFreshDataSnapshot(naverFreshDataSnapshot) : 'REGISTRY_READY_NOT_MATERIALIZED';
    acc.providerStatuses.NAVER_INVESTOR_TREND = acc.providerStatuses.NAVER;
    acc.providerReasons.NAVER_INVESTOR_TREND = `FreshData NAVER readinessKind=${naverFreshDataSnapshot.readinessKind ?? 'REGISTRY_READY'} sampleMaterialized=${String(sampleMaterialized)} usableForRouter=${String(usableForRouter)}; not router-selectable.`;
    acc.materializationDiagnostics.NAVER_INVESTOR_TREND = buildInvestorSampleDiagnosticsAdr0502({
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
    acc.diagnostics.push(acc.providerReasons.NAVER_INVESTOR_TREND);
  }
}

export function applySemanticFreshBlockAdr0477(
  acc: RouteAccumulatorAdr0477,
  input: InvestorFlowProviderRouterInput,
  prologue: RoutePrologueAdr0477,
): void {
  const { semanticFreshDataSnapshot, freshSemantic } = prologue;
  if (freshSemantic) {
    acc.materializationDiagnostics.SEMANTIC_NETBUY = materializationFromSemanticSampleAdr0477('SEMANTIC_NETBUY', freshSemantic, 'NORMALIZED_PROVIDER');
    acc.samplesByProvider.SEMANTIC_NETBUY = freshSemantic;
    acc.providerStatuses.SEMANTIC_NETBUY = freshSemantic.status;
    acc.providerReasons.SEMANTIC_NETBUY = 'FreshData registry bridge READY_FOR_SHADOW normalized SEMANTIC_NETBUY sample; role=DERIVED usableForShadow=true usableForLive=false and not selectable as source-of-truth.';
    acc.diagnostics.push(acc.providerReasons.SEMANTIC_NETBUY);
  } else if (semanticFreshDataSnapshot) {
    const sampleMaterialized = freshDataSnapshotMaterializedAdr0477(semanticFreshDataSnapshot);
    const usableForRouter = freshDataSnapshotUsableForRouterAdr0477(semanticFreshDataSnapshot);
    acc.providerStatuses.SEMANTIC_NETBUY = sampleMaterialized ? statusFromFreshDataSnapshot(semanticFreshDataSnapshot) : 'NO_INPUT_SAMPLE';
    acc.providerReasons.SEMANTIC_NETBUY = `FreshData SemanticNetBuy readinessKind=${semanticFreshDataSnapshot.readinessKind ?? 'REGISTRY_READY'} sampleMaterialized=${String(sampleMaterialized)} usableForRouter=${String(usableForRouter)}; not router-selectable.`;
    acc.materializationDiagnostics.SEMANTIC_NETBUY = buildInvestorSampleDiagnosticsAdr0502({
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
    acc.diagnostics.push(acc.providerReasons.SEMANTIC_NETBUY);
  }
}

export function applySemanticNormalizationBlockAdr0477(
  acc: RouteAccumulatorAdr0477,
  input: InvestorFlowProviderRouterInput,
  prologue: RoutePrologueAdr0477,
): void {
  if (input.semanticNetBuyNormalizationAdr0482) {
    acc.materializationDiagnostics.SEMANTIC_NETBUY = input.semanticNetBuyNormalizationAdr0482.materializationDiagnostics;
    acc.providerStatuses.SEMANTIC_NETBUY = mapSemanticNetBuyStatusAdr0482ToAdr0477(input.semanticNetBuyNormalizationAdr0482.status);
    for (const sample of input.semanticNetBuyNormalizationAdr0482.samples) {
      acc.providerStatuses[providerFromSemanticAdr0482(sample.provider)] = mapSemanticNetBuyStatusAdr0482ToAdr0477(sample.status);
    }
    acc.pendingSemanticFresh = semanticNetBuyFreshCandidate(input.semanticNetBuyNormalizationAdr0482);
    acc.pendingSemanticDiagnostic = semanticNetBuyDiagnosticCandidate(input.semanticNetBuyNormalizationAdr0482);
    const semanticCandidate = acc.pendingSemanticFresh ?? acc.pendingSemanticDiagnostic;
    if (semanticCandidate) acc.samplesByProvider.SEMANTIC_NETBUY = sampleFromSemanticAdr0482(semanticCandidate);
    if (!acc.pendingSemanticFresh && !acc.pendingSemanticDiagnostic) {
      acc.routeStatus = mapSemanticNetBuyStatusAdr0482ToAdr0477(input.semanticNetBuyNormalizationAdr0482.status);
      acc.diagnostics.push(`ADR-0482 semantic net-buy report has no selectable sample; reason=${input.semanticNetBuyNormalizationAdr0482.diagnostics.join('; ') || 'INPUT_SAMPLE_UNAVAILABLE'}. UNKNOWN is not bearish.`);
    }
  } else if (!prologue.freshSemantic) {
    acc.providerStatuses.SEMANTIC_NETBUY = 'DATA_UNAVAILABLE';
    acc.providerReasons.SEMANTIC_NETBUY = 'ADR-0482 normalizer input not supplied and no FreshData registry bridge sample.';
    acc.diagnostics.push('ADR-0482 semantic net-buy normalizer input not supplied; reason=INPUT_SAMPLE_UNAVAILABLE.');
  }
}

export function applyNaverCollectorBlockAdr0477(
  acc: RouteAccumulatorAdr0477,
  input: InvestorFlowProviderRouterInput,
  prologue: RoutePrologueAdr0477,
): void {
  const { collectedAt, freshNaver } = prologue;
  if (input.naverCollectorWired === true || input.naverCollectorResultAdr0481) {
    const adr0481 = input.naverCollectorResultAdr0481;
    if (adr0481?.materializationDiagnostics) {
      acc.materializationDiagnostics.NAVER_INVESTOR_TREND = adr0481.materializationDiagnostics;
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
    if (!acc.materializationDiagnostics.NAVER_INVESTOR_TREND) {
      acc.materializationDiagnostics.NAVER_INVESTOR_TREND = materializationFromSemanticSampleAdr0477('NAVER_INVESTOR_TREND', naverSample, 'RAW_PROVIDER');
    }
    if (acc.materializationDiagnostics.NAVER_INVESTOR_TREND?.sampleMaterialized) acc.samplesByProvider.NAVER_INVESTOR_TREND = naverSample;
    const collectorStatus = adr0481 ? mapNaverAdr0481StatusToAdr0477(adr0481.status) : naverSample.status;
    if (adr0481?.semanticNetBuyCandidate || !acc.providerStatuses.NAVER_INVESTOR_TREND) {
      acc.providerStatuses.NAVER = collectorStatus;
      acc.providerStatuses.NAVER_INVESTOR_TREND = collectorStatus;
    }
    if ((naverSample.status === 'VERIFIED' || naverSample.status === 'PARTIAL') && !acc.semanticNetBuy) {
      selectShadowAdr0477(acc, 'NAVER_INVESTOR_TREND', naverSample, 'ADR-0481 NAVER investor trend collector selected for SHADOW_ONLY as SECONDARY/DISPLAY_DERIVED fallback; KRX remains sourceOfTruth when available.');
    } else if (naverSample.status === 'STALE' || naverSample.status === 'DEGRADED') {
      acc.pendingNaverStale = naverSample;
      acc.routeStatus = naverSample.status;
      acc.diagnostics.push('NAVER source is stale/degraded; positive source blocked, not bearish.');
    }
  } else if (!freshNaver) {
    acc.providerStatuses.NAVER = 'NOT_WIRED';
    acc.providerReasons.NAVER = 'NAVER collector implementation not wired and no FreshData registry bridge sample.';
    acc.diagnostics.push('NAVER investor trend collector NOT_WIRED; provider issue only.');
  }
}

export function applyPendingSelectionBlockAdr0477(acc: RouteAccumulatorAdr0477): void {
  if (!acc.semanticNetBuy && acc.pendingSemanticFresh) {
    const sample = sampleFromSemanticAdr0482(acc.pendingSemanticFresh);
    acc.samplesByProvider.SEMANTIC_NETBUY = sample;
    acc.routeStatus = sample.status;
    acc.diagnostics.push('ADR-0482 semantic net-buy fresh sample retained for SHADOW_ONLY DERIVED diagnostics; selectedProvider remains real-source-only.');
  }

  if (!acc.semanticNetBuy && acc.pendingNaverStale) {
    acc.samplesByProvider.NAVER_INVESTOR_TREND = acc.pendingNaverStale;
    selectShadowAdr0477(acc, 'NAVER_INVESTOR_TREND', acc.pendingNaverStale, 'ADR-0481 NAVER previousTradingDate/off-hours sample selected as STALE SHADOW_ONLY diagnostic.');
  }

  if (!acc.semanticNetBuy && acc.pendingSemanticDiagnostic) {
    const sample = sampleFromSemanticAdr0482(acc.pendingSemanticDiagnostic);
    acc.samplesByProvider.SEMANTIC_NETBUY = sample;
    acc.routeStatus = sample.status;
    acc.diagnostics.push('ADR-0482 semantic net-buy diagnostic sample retained for OBSERVE/SHADOW_ONLY DERIVED diagnostics; selectedProvider remains real-source-only.');
  }
}

export function applyCacheBlockAdr0477(
  acc: RouteAccumulatorAdr0477,
  input: InvestorFlowProviderRouterInput,
  prologue: RoutePrologueAdr0477,
): void {
  const { collectedAt, kisFirstMode, naverFreshDataSnapshot, cacheLookup, cacheLookupSample } = prologue;
  if (cacheLookup) {
    acc.providerStatuses.CACHE = cacheLookupStatusAdr0477(cacheLookup.status);
    const mismatchHints = cacheLookup.debug?.mismatchHints?.join(',') || 'NONE';
    const dateCandidates = cacheLookup.debug?.routerLookup?.tradingDateCandidates?.join(',') ?? 'NONE';
    acc.providerReasons.CACHE = `ADR-0491 cacheLookupResult=${cacheLookup.status} reason=${cacheLookup.reason} mismatchHints=${mismatchHints} dateCandidates=${dateCandidates}`;
    const normalizedCacheKey = normalizeInvestorFlowSnapshotKeyAdr0491({ code: input.code, route: 'investor_flow', domain: 'SUPPLY' });
    acc.diagnostics.push(`cacheLookupResult=${cacheLookup.status}; cacheLookupKey=${cacheLookup.debug?.lookupKey ?? normalizedCacheKey.lookupKey}; triedKeys=${cacheLookup.debug?.triedKeys?.join(',') ?? 'NONE'}; retained=${cacheLookup.retained}; sourceKeyNormalized=${normalizedCacheKey.sourceCandidates.join(',')}; dateCandidates=${dateCandidates}; mismatchHints=${mismatchHints}; rawPayloadPersistenceAllowed=false; liveExecutionAllowed=false`);
    acc.diagnostics.push(`retainedSummary=${compactRetainedSummaryAdr0477(cacheLookup.debug?.retainedSummary)}`);
    acc.diagnostics.push(`routerLookup=${compactRouterLookupAdr0477(cacheLookup.debug?.routerLookup)}`);
    acc.diagnostics.push(`closestMatches=${compactClosestMatchesAdr0477(cacheLookup.debug?.closestMatches)}`);
  }
  if (!acc.semanticNetBuy) {
    const cacheRaw = cacheLookupSample ? null : input.cacheRaw ?? input.previousTradingDayCacheRaw;
    const cacheSample = cacheLookupSample ?? normalizeSemanticNetBuySampleAdr0477(cacheRaw, 'CACHE', {
      code: input.code,
      collectedAt,
      sourceAgeTradingDays: input.cacheAgeTradingDays,
      fallbackStatus: cacheRaw ? undefined : 'CACHE_EMPTY',
    });
    acc.materializationDiagnostics.CACHE = materializationFromSemanticSampleAdr0477(
      'CACHE',
      cacheSample.status === 'CACHE_EMPTY' || cacheSample.status === 'DATA_UNAVAILABLE' ? null : cacheSample,
      'CACHE_FALLBACK',
      cacheSample.status === 'CACHE_EMPTY' ? 'NO_INPUT_SAMPLE' : undefined,
    );
    if (acc.materializationDiagnostics.CACHE?.sampleMaterialized) acc.samplesByProvider.CACHE = cacheSample;
    if (!cacheLookup || cacheLookupSample) acc.providerStatuses.CACHE = cacheLookupSample && cacheLookup ? cacheLookupStatusAdr0477(cacheLookup.status) : cacheSample.status;
    if (cacheSample.status === 'VERIFIED' || cacheSample.status === 'PARTIAL' || cacheSample.status === 'STALE' || cacheSample.status === 'CACHE_HIT' || cacheSample.status === 'CACHE_STALE_HIT') {
      const staleCacheBlockedByKisFirst = kisFirstMode && (cacheSample.status === 'STALE' || cacheSample.status === 'CACHE_STALE_HIT');
      const naverNotMaterialized = naverFreshDataSnapshot && !freshDataSnapshotMaterializedAdr0477(naverFreshDataSnapshot)
        ? ` because NAVER readinessKind=${naverFreshDataSnapshot.readinessKind ?? 'REGISTRY_READY'} usableForRouter=${String(freshDataSnapshotUsableForRouterAdr0477(naverFreshDataSnapshot))}`
        : '';
      if (staleCacheBlockedByKisFirst) {
        acc.diagnostics.push(`KIS_FIRST_REBUILD_MODE=true; CACHE_STALE_HIT is fallbackDiagnosticOnly and cannot be selectedProvider. fallbackProvider=CACHE; fallbackStatus=${cacheSample.status}; marketSignal=false.`);
      } else {
        selectShadowAdr0477(acc, 'CACHE', cacheSample, cacheLookup ? `ADR-0491 sanitized snapshot cache selected: ${cacheLookup.status}${naverNotMaterialized}.` : `CACHE fallback used${naverNotMaterialized}; fallback only, not primary truth.`);
      }
    }
  } else if (!acc.providerStatuses.CACHE) {
    acc.providerStatuses.CACHE = input.cacheRaw ? 'PARTIAL' : 'CACHE_EMPTY';
  }
}

export function applyKrxBlockAdr0477(
  acc: RouteAccumulatorAdr0477,
  input: InvestorFlowProviderRouterInput,
  prologue: RoutePrologueAdr0477,
): void {
  const { collectedAt, kisFirstMode } = prologue;
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
    acc.materializationDiagnostics[krxMaterializationProvider] = materializationFromSemanticSampleAdr0477(krxMaterializationProvider, krxSample, 'RAW_PROVIDER');
    if (acc.materializationDiagnostics[krxMaterializationProvider]?.sampleMaterialized) acc.samplesByProvider[krxProvider] = krxSample;
    acc.providerStatuses[krxProvider] = krxSample.status;
    acc.providerStatuses.KRX_INVESTOR_FLOW = krxSample.status;
    acc.providerStatuses.KRX = krxSample.status;
    acc.providerReasons[krxProvider] = input.previousTradingDayKrxRaw
      ? `${krxProvider} previousTradingDate materialized investor-flow row selected as SHADOW_ONLY diagnostic candidate.`
      : `${krxProvider} materialized investor-flow row selected as SHADOW_ONLY diagnostic candidate.`;
    acc.providerReasons.KRX_INVESTOR_FLOW = acc.providerReasons[krxProvider];
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
    acc.providerStatuses[krxDiagnosticProvider] = krxStatus;
    acc.providerStatuses.KRX_INVESTOR_FLOW = krxStatus;
    acc.providerStatuses.KRX = krxStatus;
    acc.providerReasons[krxDiagnosticProvider] = krxStatus === 'DISABLED_BY_KIS_FIRST_MODE'
      ? `${krxReason}; status=DISABLED_BY_KIS_FIRST_MODE; provider=KRX; providerIssue=false; marketSignal=false; useForRouter=false; useForGate=false; useForLive=false; useForShadow=false; executionImpact=NONE`
      : optionalDetailUnavailable
        ? `${krxReason}; selectedProviderCandidate=false; routedStatus=OPTIONAL_KRX_DETAIL_UNAVAILABLE; reason=${krxOptionalDetailExcludedReasonAdr0477(input.krxInvestorDiagnosticAdr0505)}; useForRouter=false; useForGate=false; useForLive=false; useForShadow=false; diagnosticOnly=true; providerIssue=false; marketSignal=false; executionImpact=NONE`
        : krxQuarantined
        ? `${krxReason}; QUARANTINED retryAfterMs=${input.krxInvestorDiagnosticAdr0505.cooldownRemainingMs ?? 60 * 60 * 1000}; useForGate=false; useForRouter=false; useForLive=false; useForShadow=true; diagnosticOnly=true; executionImpact=NONE`
        : krxReason;
    acc.providerReasons.KRX_INVESTOR_FLOW = acc.providerReasons[krxDiagnosticProvider];
    acc.providerReasons.KRX = acc.providerReasons[krxDiagnosticProvider];
    acc.diagnostics.push(acc.providerReasons[krxDiagnosticProvider]);
    if (optionalDetailUnavailable) {
      acc.diagnostics.push(`[KRX_OPTIONAL_DETAIL_EXCLUDED] endpoint=${input.krxInvestorDiagnosticAdr0505.endpoint ?? input.krxInvestorDiagnosticAdr0505.selectedBld ?? 'UNKNOWN'} reason=${krxOptionalDetailExcludedReasonAdr0477(input.krxInvestorDiagnosticAdr0505)} useForRouter=false executionImpact=NONE`);
    }
  }
}

export function applyKisBlockAdr0477(
  acc: RouteAccumulatorAdr0477,
  input: InvestorFlowProviderRouterInput,
  prologue: RoutePrologueAdr0477,
): void {
  const { collectedAt } = prologue;
  if (input.kisInvestorRaw) {
    const actualRowDiagnostic = selectedActualRowDiagnosticsAdr0477(input.kisInvestorRaw);
    acc.sanitizedInvestorFlowRows = actualRowDiagnostic.rows;
    acc.selectedActualRowPath = actualRowDiagnostic.selectedPath;
    acc.selectedActualRowFieldKeys = actualRowDiagnostic.fieldKeys;
    acc.selectedActualNumericFieldKeys = actualRowDiagnostic.numericFieldKeys;
    acc.selectedActualNumericStringFieldKeys = actualRowDiagnostic.numericStringFieldKeys;
    acc.selectedActualPlaceholderFieldKeys = actualRowDiagnostic.placeholderFieldKeys;
    acc.selectedActualWrapperOnly = actualRowDiagnostic.wrapperOnly;
    const actualFlowForSemantic = acc.sanitizedInvestorFlowRows.length > 0 ? acc.sanitizedInvestorFlowRows : input.kisInvestorRaw;
    const kisSemanticRow = buildSanitizedInvestorFlowSemanticRow({
      flow: actualFlowForSemantic,
      symbol: input.code,
      provider: 'KIS_API',
      providerScope: 'SYMBOL_LEVEL',
    });
    acc.kisRawRowAvailableAtAdapter = kisSemanticRow.rawFieldKeys.length > 0 || acc.sanitizedInvestorFlowRows.length > 0;
    acc.kisNormalizedRowAvailableAtRouter = kisSemanticRow.normalizedFieldKeys.length > 0 || kisSemanticRow.foreignNetBuy !== null || kisSemanticRow.institutionalNetBuy !== null || kisSemanticRow.individualNetBuy !== null;
    acc.semanticRowsByProvider.KIS_API = kisSemanticRow;
    const kisActualInvestorRow = acc.sanitizedInvestorFlowRows[0] ?? (input.kisInvestorRaw as Record<string, unknown>);
    const kisNormalizedInvestorRow = normalizedInvestorRowFromSemanticAdr0477(kisSemanticRow);
    const semanticRowAsDiagnostic = kisSemanticRow as unknown as Record<string, unknown>;
    acc.kisNormalizedDiagnosticInvestorRow = hasActualInvestorNumericRow(kisNormalizedInvestorRow) ? kisNormalizedInvestorRow : null;
    acc.kisSemanticDiagnosticInvestorRow = hasActualInvestorNumericRow(semanticRowAsDiagnostic) ? semanticRowAsDiagnostic : null;
    const selectedActualPathIsNormalized = /normalized/i.test(acc.selectedActualRowPath ?? '');
    const hasExplicitNormalizedObject = input.kisInvestorRaw != null && typeof input.kisInvestorRaw === 'object' && !Array.isArray(input.kisInvestorRaw) && Object.prototype.hasOwnProperty.call(input.kisInvestorRaw, 'normalizedRow');
    acc.investorRowMaterializationClass = (acc.selectedActualWrapperOnly || actualRowDiagnostic.wrapperOnly) && acc.sanitizedInvestorFlowRows.length === 0 && !acc.kisNormalizedDiagnosticInvestorRow && !acc.kisSemanticDiagnosticInvestorRow && !hasExplicitNormalizedObject
      ? 'WRAPPER_ONLY'
      : acc.sanitizedInvestorFlowRows.some((row) => hasActualInvestorNumericRow(row))
        ? (selectedActualPathIsNormalized ? 'NORMALIZED_NUMERIC_ROW' : 'ACTUAL_NUMERIC_ROW')
        : acc.kisNormalizedDiagnosticInvestorRow
        ? 'NORMALIZED_NUMERIC_ROW'
        : acc.kisSemanticDiagnosticInvestorRow
          ? 'NORMALIZED_NUMERIC_ROW'
          : kisNormalizedInvestorRow
            ? 'NORMALIZED_METADATA_ONLY'
            : acc.kisNormalizedRowAvailableAtRouter
              ? 'SEMANTIC_METADATA_ONLY'
              : acc.selectedActualWrapperOnly || actualRowDiagnostic.wrapperOnly
                ? 'WRAPPER_ONLY'
                : 'MISSING';
    acc.kisRawRowAvailableAtAdapter = acc.investorRowMaterializationClass === 'ACTUAL_NUMERIC_ROW' || acc.investorRowMaterializationClass === 'NORMALIZED_NUMERIC_ROW';
    const kisSample = normalizeSemanticNetBuySampleAdr0477((acc.sanitizedInvestorFlowRows[0] ?? acc.kisNormalizedDiagnosticInvestorRow ?? acc.kisSemanticDiagnosticInvestorRow ?? input.kisInvestorRaw) as Record<string, unknown>, 'KIS_API', {
      code: input.code,
      collectedAt,
      sourceAgeTradingDays: input.sourceAgeTradingDays,
    });
    acc.materializationDiagnostics.KIS_INVESTOR = materializationFromSemanticSampleAdr0477('KIS_INVESTOR', kisSample, 'RAW_PROVIDER');
    const kisDiagnosticActualRows = acc.sanitizedInvestorFlowRows.length > 0
      ? acc.sanitizedInvestorFlowRows
      : (acc.kisNormalizedDiagnosticInvestorRow ?? acc.kisSemanticDiagnosticInvestorRow)
        ? [acc.kisNormalizedDiagnosticInvestorRow ?? acc.kisSemanticDiagnosticInvestorRow as Record<string, unknown>]
        : [];
    const kisDiagnosticFieldKeys = kisDiagnosticActualRows.length > 0 ? Array.from(new Set(kisDiagnosticActualRows.flatMap((row) => Object.keys(row)))) : acc.selectedActualRowFieldKeys;
    const kisDiagnosticNumericKeys = kisDiagnosticActualRows.length > 0 ? Array.from(new Set(kisDiagnosticActualRows.flatMap((row) => supplyNumericKeysAdr0477(row)))) : Array.from(new Set([...acc.selectedActualNumericFieldKeys, ...acc.selectedActualNumericStringFieldKeys]));
    const kisActualRowUseScope: ActualInvestorFlowCarryAdr0477['actualInvestorRowUseScope'] =
      kisSample.status === 'VERIFIED' && kisDiagnosticActualRows.length > 0
        ? 'GATE_SCORE_ELIGIBLE'
        : 'DIAGNOSTIC_ONLY';
    acc.actualRowCarryByProvider.KIS_API = {
      actualInvestorFlowRows: kisDiagnosticActualRows,
      actualInvestorFlowRowCount: kisDiagnosticActualRows.length,
      actualInvestorFlowRowSourcePath: acc.selectedActualRowPath ?? (kisDiagnosticActualRows.length > 0 ? 'input.normalizedInvestorRow' : null),
      actualInvestorFlowFieldKeys: kisDiagnosticFieldKeys,
      actualInvestorFlowNumericKeys: kisDiagnosticNumericKeys,
      actualInvestorFlowNumericStringKeys: acc.selectedActualNumericStringFieldKeys,
      actualInvestorFlowCarried: kisDiagnosticActualRows.length > 0,
      actualInvestorRow: kisActualInvestorRow,
      normalizedInvestorRow: kisNormalizedInvestorRow,
      semanticInvestorRow: kisSemanticRow,
      supplySemanticRow: kisSemanticRow,
      actualRowAvailable: Boolean(kisActualInvestorRow),
      diagnosticActualInvestorRow: acc.kisNormalizedDiagnosticInvestorRow ?? acc.kisSemanticDiagnosticInvestorRow ?? (hasActualInvestorNumericRow(kisActualInvestorRow) ? kisActualInvestorRow : null),
      actualInvestorRowProvider: (acc.kisNormalizedDiagnosticInvestorRow || acc.kisSemanticDiagnosticInvestorRow || hasActualInvestorNumericRow(kisActualInvestorRow)) ? 'KIS_API' : null,
      actualInvestorRowUseScope: kisActualRowUseScope,
      investorRowMaterializationClass: acc.investorRowMaterializationClass,
      diagnosticActualInvestorRowFromNormalized: Boolean(acc.kisNormalizedDiagnosticInvestorRow ?? acc.kisSemanticDiagnosticInvestorRow),
      normalizedRowAvailable: Boolean(kisNormalizedInvestorRow),
      semanticRowAvailable: acc.kisNormalizedRowAvailableAtRouter,
      rowCarryPath: 'ADAPTER_TO_ROUTER',
    };
    acc.diagnostics.push(`[SUPPLY_ROUTER_ROW_CARRIED] symbol=${input.code} actualRowAvailable=${Boolean(kisActualInvestorRow)} semanticRowAvailable=${acc.kisNormalizedRowAvailableAtRouter} materializationClass=${acc.investorRowMaterializationClass} normalizedPromoted=${Boolean(acc.kisNormalizedDiagnosticInvestorRow ?? acc.kisSemanticDiagnosticInvestorRow)} fieldKeys=${supplyRowKeysAdr0477(kisActualInvestorRow).slice(0, 16).join(',') || 'NONE'} numericKeys=${supplyNumericKeysAdr0477(kisActualInvestorRow).slice(0, 16).join(',') || 'NONE'} rowCarryPath=ADAPTER_TO_ROUTER useScope=${kisActualRowUseScope}`);
    acc.diagnostics.push(`[SUPPLY_SEMANTIC_FIELD_MAPPED] symbol=${input.code} foreignField=${kisSemanticRow.sourceFields.foreign ?? 'none'} institutionField=${kisSemanticRow.sourceFields.institutional ?? 'none'} individualField=${kisSemanticRow.sourceFields.individual ?? 'none'} foreignNetBuy=${kisSemanticRow.foreignNetBuy ?? 'null'} institutionNetBuy=${kisSemanticRow.institutionalNetBuy ?? 'null'} individualNetBuy=${kisSemanticRow.individualNetBuy ?? 'null'}`);
    if (acc.materializationDiagnostics.KIS_INVESTOR.sampleMaterialized) acc.samplesByProvider.KIS_API = kisSample;
    acc.providerStatuses.KIS_API = kisSample.status;
    acc.providerStatuses.KIS = kisSample.status;
    acc.providerReasons.KIS_API = 'KIS symbol-level investor-flow row materialized; route separated from program trading.';
  }
}

export function applyFssAndFlagsBlockAdr0477(
  acc: RouteAccumulatorAdr0477,
  input: InvestorFlowProviderRouterInput,
  prologue: RoutePrologueAdr0477,
): void {
  const { collectedAt, providerTried } = prologue;
  if (input.fssPassiveActiveRaw) {
    const fssSample = normalizeSemanticNetBuySampleAdr0477(input.fssPassiveActiveRaw, 'FSS_PASSIVE_ACTIVE', {
      code: input.code,
      collectedAt,
      sourceAgeTradingDays: input.fssSourceAgeTradingDays ?? 5,
      fallbackStatus: 'STALE',
    });
    acc.materializationDiagnostics.FSS_PASSIVE_ACTIVE = materializationFromSemanticSampleAdr0477('FSS_PASSIVE_ACTIVE', fssSample, 'RAW_PROVIDER');
    if (acc.materializationDiagnostics.FSS_PASSIVE_ACTIVE.sampleMaterialized) acc.samplesByProvider.FSS_PASSIVE_ACTIVE = fssSample;
    acc.providerStatuses.FSS_PASSIVE_ACTIVE = fssSample.status;
    acc.providerStatuses.FSS = fssSample.status;
    acc.providerReasons.FSS_PASSIVE_ACTIVE = 'FSS stale but materialized passive/active row allowed as SHADOW_ONLY diagnostic fallback.';
  }

  if (input.kisTriedForInvestorFlow === true) {
    providerTried.push('KIS');
    if (!acc.providerStatuses.KIS && !acc.providerStatuses.KIS_API) {
      acc.providerStatuses.KIS = 'PROVIDER_MISMATCH';
      acc.providerReasons.KIS_API = 'ROUTE_MISMATCH: KIS program route is not semantic investor_flow unless symbol-level investor fields are present.';
    }
    acc.diagnostics.push('KIS investor-flow mismatch decomposed: ROUTE_MISMATCH/SYMBOL_MISMATCH/FIELD_MISMATCH/SESSION_MISMATCH/EMPTY_OUTPUT.');
  }
  if (input.marketProgramStatus === 'ACCEPTED_EMPTY') {
    providerTried.push('KRX');
    acc.providerStatuses.MARKET_PROGRAM = 'ACCEPTED_EMPTY';
    acc.diagnostics.push('ACCEPTED_EMPTY market/program data excluded from scoring, not bearish.');
  }
  if ((input.fssSourceAgeTradingDays ?? 0) >= 4) {
    providerTried.push('FSS');
    acc.providerStatuses.FSS = acc.providerStatuses.FSS ?? 'STALE';
    acc.diagnostics.push(`FSS source stale ${input.fssSourceAgeTradingDays} trading days; diagnostic only.`);
  }
}
