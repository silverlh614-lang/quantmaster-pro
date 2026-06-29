/**
 * @responsibility ADR-0477 investor flow route result assembler — selection, diagnostics, final payload build.
 */

import {
  formatInvestorSampleDiagnosticsAdr0502,
  type InvestorSampleProviderNameAdr0502,
} from '../investorSampleMaterializationAdr0502.js';
import type {
  ActualInvestorFlowDropReasonAdr0477,
  InvestorFlowProviderId,
  InvestorFlowProviderRouteBySymbolPayloadAdr0477,
  InvestorFlowProviderRouteResult,
  InvestorFlowProviderRouterInput,
  InvestorFlowProviderStatus,
} from './types.js';
import {
  ROUTER_POLICY,
  finiteNumber,
  normalizeCodeAdr0477,
  providerIdFromMaterializationAdr0477,
} from './primitives.js';
import {
  cacheState,
  coverageFromStatuses,
  findFreshDataSnapshotBySourceIdAdr0477,
  isKrxQuarantineDiagnosticAdr0477,
  isOptionalKrxInvestorDetailUnavailableAdr0477,
  sourceState,
} from './freshDataAdapters.js';
import {
  buildInvestorFlowFlatRowForGate,
  buildInvestorFlowMultiSourceMaterialization,
  normalizedInvestorRowFromSemanticAdr0477,
  type InvestorFlowDiagnosticUsableCandidateAdr0504,
} from './materialization.js';
import {
  providerFromSemanticAdr0482,
} from './semanticAdapters.js';
import type { RouteAccumulatorAdr0477, RoutePrologueAdr0477 } from './routeBlocks.js';
import type { SemanticNetBuySample } from './types.js';

export function buildRouteResultAdr0477(
  acc: RouteAccumulatorAdr0477,
  input: InvestorFlowProviderRouterInput,
  prologue: RoutePrologueAdr0477,
): InvestorFlowProviderRouteResult {
  const { collectedAt: _collectedAt, kisFirstMode, providerTried, naverFreshDataSnapshot, semanticFreshDataSnapshot, cacheLookup, cacheLookupSample } = prologue;

  const multiSourceMaterialization = buildInvestorFlowMultiSourceMaterialization(acc.materializationDiagnostics, acc.samplesByProvider, acc.actualRowCarryByProvider);
  const optionalKrxDetailUnavailable = input.krxInvestorDiagnosticAdr0505
    ? isOptionalKrxInvestorDetailUnavailableAdr0477(input.krxInvestorDiagnosticAdr0505)
    : false;
  const hasRouterUsableKrxRawCandidate = multiSourceMaterialization.rankedCandidates.some((candidate) =>
    (candidate.provider === 'KRX_INVESTOR_FLOW' || candidate.provider === 'KRX_SYMBOL_INVESTOR_FLOW' || candidate.provider === 'KRX_MARKET_INVESTOR_FLOW') &&
    candidate.sampleMaterialized &&
    candidate.usableForRouter,
  );
  const kisMaterialization = acc.materializationDiagnostics.KIS_INVESTOR;
  const kisSampleForSelection = acc.samplesByProvider.KIS_API;
  const naverStatusForShortCircuit = acc.providerStatuses.NAVER_INVESTOR_TREND;
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
    acc.providerReasons.NAVER_INVESTOR_TREND = acc.providerReasons.NAVER_INVESTOR_TREND
      ? `${acc.providerReasons.NAVER_INVESTOR_TREND}; ${naverExclusion}`
      : naverExclusion;
    acc.diagnostics.push(`[ADR-0477] ${naverExclusion}`);
  }
  const krxAutoDisabled = acc.providerStatuses.KRX_INVESTOR_FLOW === 'DISABLED_BY_KIS_FIRST_MODE' || acc.providerStatuses.KRX === 'DISABLED_BY_KIS_FIRST_MODE';
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
  const adapterCarriesActualRow = acc.sanitizedInvestorFlowRows.length > 0;
  const candidateBeforeSelectionCarriesActualRow = multiSourceMaterialization.candidates.some((candidate) => candidate.provider === 'KIS_API' && (candidate.actualInvestorFlowRowCount ?? 0) > 0);
  if (selectedMultiSourceCandidate) {
    const sample = acc.samplesByProvider[selectedMultiSourceCandidate.provider];
    if (sample && acc.selectedProvider !== selectedMultiSourceCandidate.provider) {
      const previousReason = acc.providerReasons[selectedMultiSourceCandidate.provider];
      acc.selectedProvider = selectedMultiSourceCandidate.provider;
      acc.selectedReason = kisVerifiedShortCircuitCandidate
        ? `KIS_VERIFIED_SHORTCIRCUIT: ${selectedMultiSourceCandidate.selectionReason}`
        : `ADR-0503 multi-source materialized candidate selected: ${selectedMultiSourceCandidate.selectionReason}`;
      acc.semanticNetBuy = sample;
      acc.routeStatus = sample.status;
      acc.providerReasons[selectedMultiSourceCandidate.provider] = previousReason ? `${acc.selectedReason}; ${previousReason}` : acc.selectedReason;
      acc.diagnostics.push(acc.providerReasons[selectedMultiSourceCandidate.provider]);
      if (kisVerifiedShortCircuitCandidate) {
        acc.diagnostics.push('[ADR-0477] InvestorFlowProviderRouter selectedProvider=KIS_API status=VERIFIED reason=KIS_VERIFIED_SHORTCIRCUIT executionImpact=NONE liveExecutionAllowed=false');
      }
    }
  }

  const diagnosticUsableCandidates: InvestorFlowDiagnosticUsableCandidateAdr0504[] = [];
  const fssFreshDataSnapshot = findFreshDataSnapshotBySourceIdAdr0477(input.freshDataSupplyAdr0487, 'FSS_PASSIVE_ACTIVE');
  if (fssFreshDataSnapshot && (fssFreshDataSnapshot.status === 'STALE' || fssFreshDataSnapshot.sourceState === 'STALE' || fssFreshDataSnapshot.usableForShadow === true)) {
    acc.providerStatuses.FSS_PASSIVE_ACTIVE = acc.providerStatuses.FSS_PASSIVE_ACTIVE ?? 'STALE';
    acc.providerStatuses.FSS = acc.providerStatuses.FSS ?? acc.providerStatuses.FSS_PASSIVE_ACTIVE;
    acc.providerReasons.FSS_PASSIVE_ACTIVE = acc.providerReasons.FSS_PASSIVE_ACTIVE ?? `FreshData aggregate diagnostic provider=FSS status=${fssFreshDataSnapshot.status} confidence=${fssFreshDataSnapshot.confidence}; selectedForShadow=true selectedForLive=false.`;
    diagnosticUsableCandidates.push({
      provider: 'FSS_PASSIVE_ACTIVE',
      status: acc.providerStatuses.FSS_PASSIVE_ACTIVE,
      reason: acc.providerReasons.FSS_PASSIVE_ACTIVE,
      source: 'FRESH_DATA_AGGREGATE',
    });
  }
  const cacheFreshDataSnapshot = findFreshDataSnapshotBySourceIdAdr0477(input.freshDataSupplyAdr0487, 'SUPPLY_SNAPSHOT_CACHE');
  const cacheDiagnosticStatus = acc.providerStatuses.CACHE;
  if ((cacheLookup && (cacheLookup.status === 'CACHE_HIT' || cacheLookup.status === 'CACHE_STALE_HIT' || cacheLookup.status === 'STALE_HIT')) || cacheFreshDataSnapshot?.cacheState === 'FRESH' || cacheFreshDataSnapshot?.cacheState === 'STALE') {
    acc.providerStatuses.CACHE = acc.providerStatuses.CACHE ?? (cacheFreshDataSnapshot?.cacheState === 'STALE' ? 'CACHE_STALE_HIT' : 'CACHE_HIT');
    acc.providerReasons.CACHE = acc.providerReasons.CACHE ?? `FreshData/cache diagnostic fallback status=${acc.providerStatuses.CACHE}; selectedForShadow=true selectedForLive=false.`;
    diagnosticUsableCandidates.push({
      provider: 'CACHE',
      status: acc.providerStatuses.CACHE ?? cacheDiagnosticStatus ?? 'OBSERVING',
      reason: acc.providerReasons.CACHE,
      source: 'CACHE_LOOKUP',
    });
  }
  for (const candidate of multiSourceMaterialization.candidates) {
    if (candidate.provider !== 'NAVER_INVESTOR_TREND' && candidate.provider !== 'SEMANTIC_NETBUY' && !isBlockedAutoKrxCandidate(candidate.provider) && candidate.sampleMaterialized && candidate.usableForShadow && !candidate.placeholderDetected) {
      diagnosticUsableCandidates.push({
        provider: candidate.provider,
        status: acc.samplesByProvider[candidate.provider]?.status ?? (candidate.freshness === 'STALE' ? 'STALE' : 'OBSERVING'),
        reason: candidate.selectionReason,
        source: 'MATERIALIZED_SHADOW',
      });
    }
  }
  const selectedDiagnosticCandidate = acc.selectedProvider === 'NONE'
    ? diagnosticUsableCandidates.find((candidate) => candidate.provider === 'FSS_PASSIVE_ACTIVE')
      ?? diagnosticUsableCandidates.find((candidate) => candidate.provider === 'CACHE' && (!kisFirstMode || candidate.status === 'CACHE_HIT'))
      ?? diagnosticUsableCandidates.find((candidate) => !(kisFirstMode && candidate.provider === 'CACHE' && candidate.status !== 'CACHE_HIT'))
      ?? null
    : null;
  let selectedDiagnosticProvider: InvestorFlowProviderId | null = null;
  let selectedDiagnosticReason: string | null = null;
  if (selectedDiagnosticCandidate) {
    acc.selectedProvider = selectedDiagnosticCandidate.provider;
    selectedDiagnosticProvider = selectedDiagnosticCandidate.provider;
    selectedDiagnosticReason = selectedDiagnosticCandidate.reason;
    acc.selectedReason = selectedDiagnosticCandidate.reason;
    acc.routeStatus = selectedDiagnosticCandidate.status === 'CACHE_HIT' ? 'OBSERVING' : selectedDiagnosticCandidate.status;
    acc.providerStatuses[selectedDiagnosticCandidate.provider] = selectedDiagnosticCandidate.status;
    acc.providerReasons[selectedDiagnosticCandidate.provider] = selectedDiagnosticCandidate.reason;
    const diagnosticSample = acc.samplesByProvider[selectedDiagnosticCandidate.provider];
    if (!acc.semanticNetBuy && diagnosticSample) acc.semanticNetBuy = diagnosticSample;
    acc.diagnostics.push(`diagnosticUsableCandidate selected provider=${selectedDiagnosticCandidate.provider}; source=${selectedDiagnosticCandidate.source}; status=${selectedDiagnosticCandidate.status}; selectedForShadow=true; selectedForLive=false`);
  }

  const staleCacheQuarantinedByKisFirst = kisFirstMode
    && acc.selectedProvider === 'NONE'
    && (acc.providerStatuses.CACHE === 'CACHE_STALE_HIT' || acc.providerStatuses.CACHE === 'STALE');
  if (staleCacheQuarantinedByKisFirst) {
    acc.selectedReason = 'NO_FRESH_SEMANTIC_NETBUY';
    acc.routeStatus = input.krxInvestorDiagnosticAdr0505 && isKrxQuarantineDiagnosticAdr0477(input.krxInvestorDiagnosticAdr0505)
      ? 'DATA_UNAVAILABLE'
      : acc.routeStatus;
    acc.diagnostics.push('selectedProvider=NONE; fallbackProvider=CACHE; fallbackStatus=CACHE_STALE_HIT; fallbackDiagnosticOnly=true; selectedReason=NO_FRESH_SEMANTIC_NETBUY; marketSignal=false');
  }

  const selectedSemanticRow = acc.semanticRowsByProvider[acc.selectedProvider] ?? null;
  const selectedGateSemanticFlatRow = buildInvestorFlowFlatRowForGate(selectedSemanticRow);
  const selectedMaterializedCandidate = selectedMultiSourceCandidate?.provider === acc.selectedProvider
    ? selectedMultiSourceCandidate
    : multiSourceMaterialization.candidates.find((candidate) => candidate.provider === acc.selectedProvider) ?? null;
  // ADR-0477 supply actual row carry — sanitizedInvestorFlowRows (KIS adapter SSOT) 가
  // selectedProvider !== 'KIS_API' 일 때도 diagnostic-only 로 propagate. selectedProvider 의
  // CORE 판단은 그대로 (KRX/NAVER/CACHE 등 multi-source materialization 결과 우선),
  // KIS adapter row 는 diagnostic / SHADOW_SCORE 전용 — executionImpact='NONE',
  // liveExecutionAllowed=false 보존. 사용자 명시 #6: adapterCarriesActualRow=47/47 인데
  // routerCarriesActualRow=0/47 인 단절 차단 — adapter 가 데이터 보유 시 router 도 carry.
  // 사용자 명시 #9 (KRX CORE 직결 금지) 정합 — selectedProvider 결정 로직 변경 0.
  const normalizedFallbackActualRows = (acc.kisNormalizedDiagnosticInvestorRow ?? acc.kisSemanticDiagnosticInvestorRow)
    ? [acc.kisNormalizedDiagnosticInvestorRow ?? acc.kisSemanticDiagnosticInvestorRow as Record<string, unknown>]
    : [];
  const adapterFallbackActualRows = acc.sanitizedInvestorFlowRows.length > 0 ? acc.sanitizedInvestorFlowRows : normalizedFallbackActualRows;
  const diagnosticActualRowFromNormalized = (acc.sanitizedInvestorFlowRows.length === 0 && normalizedFallbackActualRows.length > 0) || (adapterFallbackActualRows.length > 0 && /NORMALIZED/.test(acc.investorRowMaterializationClass));
  const selectedCandidateActualRows = selectedMaterializedCandidate?.actualInvestorFlowRows
    ?? (acc.selectedProvider === 'KIS_API' ? adapterFallbackActualRows : adapterFallbackActualRows);
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
        ? (acc.selectedProvider === 'NAVER_INVESTOR_TREND' ? 'NAVER_INVESTOR_TREND' : 'UNKNOWN')
        : null;
  const diagnosticActualInvestorRow: Record<string, unknown> | null =
    (adapterFallbackActualRows[0] as Record<string, unknown> | undefined)
    ?? (selectedMaterializedCandidate?.actualInvestorRow ?? null);
  const actualRowProviderMatchesSelected =
    actualRowProvider != null &&
    acc.selectedProvider === actualRowProvider &&
    diagnosticActualInvestorRow != null;
  const selectedProviderActualInvestorRow: Record<string, unknown> | null =
    actualRowProviderMatchesSelected ? diagnosticActualInvestorRow : null;
  const selectedProviderGateScoreEligible =
    actualRowProviderMatchesSelected &&
    acc.selectedProvider === 'KIS_API' &&
    (
      selectedCandidateCarriesActualRow ||
      selectedCandidateActualRows.length > 0 ||
      selectedSemanticRow != null ||
      acc.kisNormalizedRowAvailableAtRouter
    );
  const actualInvestorRowUseScope: 'SELECTED_PROVIDER' | 'DIAGNOSTIC_ONLY' | 'SHADOW_SCORE' | 'GATE_SCORE_ELIGIBLE' =
    selectedProviderGateScoreEligible
      ? 'GATE_SCORE_ELIGIBLE'
      : actualRowProviderMatchesSelected
        ? 'SELECTED_PROVIDER'
        : 'DIAGNOSTIC_ONLY';
  // FIXED: `selectedProvider !== 'NONE'` guard 제거 — selectedProvider==='NONE' 도
  // adapter row 를 보유하면 cross-provider carry 로 인정.
  const adapterRowsForwardedAcrossProviders =
    actualRowProvider != null && acc.selectedProvider !== actualRowProvider && diagnosticActualInvestorRow != null;
  const selectedCandidateActualRowFieldKeysTop = selectedMaterializedCandidate?.actualInvestorFlowFieldKeys ?? acc.selectedActualRowFieldKeys;
  const selectedCandidateActualRowDropReason: ActualInvestorFlowDropReasonAdr0477 = selectedCandidateCarriesActualRow
    ? (adapterRowsForwardedAcrossProviders ? 'SELECTED_CANDIDATE_CARRIES_ACTUAL_ROW' : 'SELECTED_CANDIDATE_CARRIES_ACTUAL_ROW')
    : !input.kisInvestorRaw
      ? 'ADAPTER_ROW_NOT_PRESENT'
      : acc.sanitizedInvestorFlowRows.length === 0
        ? 'NORMALIZER_DROPPED_ACTUAL_ROW'
        : !candidateBeforeSelectionCarriesActualRow
          ? 'MATERIALIZED_CANDIDATE_DROPPED_ACTUAL_ROW'
          : acc.selectedProvider === 'KIS_API'
            ? 'SELECTED_CANDIDATE_DROPPED_ACTUAL_ROW'
            : 'UNKNOWN';
  if (selectedMaterializedCandidate) {
    selectedMaterializedCandidate.supplyProviderStatus = acc.routeStatus;
    acc.diagnostics.push(`[SELECTED_CANDIDATE_SUPPLY_ROW_ATTACHED] symbol=${input.code} hasActualInvestorRow=${Boolean(selectedMaterializedCandidate.actualInvestorRow ?? selectedCandidateActualRows[0])} hasSemanticInvestorRow=${Boolean(selectedMaterializedCandidate.semanticInvestorRow ?? selectedSemanticRow)} source=SUPPLY_ROUTER_BY_SYMBOL fieldKeys=${(selectedMaterializedCandidate.actualInvestorFlowFieldKeys ?? selectedCandidateActualRowFieldKeysTop).slice(0, 16).join(',') || 'NONE'} numericKeys=${(selectedMaterializedCandidate.actualInvestorFlowNumericKeys ?? acc.selectedActualNumericFieldKeys).slice(0, 16).join(',') || 'NONE'}`);
  }
  acc.diagnostics.push(`[INVESTOR_FLOW_ACTUAL_ROW_CARRY] symbol=${input.code} selectedProvider=${acc.selectedProvider} actualRowProvider=${actualRowProvider ?? 'NONE'} useScope=${actualInvestorRowUseScope} materializationClass=${acc.investorRowMaterializationClass} diagnosticActualRow=${diagnosticActualInvestorRow != null} diagnosticActualRowFromNormalized=${diagnosticActualRowFromNormalized} selectedProviderActualRow=${selectedProviderActualInvestorRow != null} adapterForwarded=${adapterRowsForwardedAcrossProviders} executionImpact=NONE liveExecutionAllowed=false`);
  const selectedSemanticNetBuy = acc.semanticNetBuy as SemanticNetBuySample | null;
  const signal = selectedSemanticNetBuy?.signal ?? 'UNKNOWN';
  if (!acc.semanticNetBuy && !selectedDiagnosticProvider && acc.providerStatuses.NAVER === 'NOT_WIRED' && acc.providerStatuses.CACHE === 'CACHE_EMPTY') {
    acc.routeStatus = 'DATA_UNAVAILABLE';
  }
  const sourceAge = input.sourceAgeTradingDays ?? input.cacheAgeTradingDays ?? null;
  const oldest = [input.sourceAgeTradingDays, input.cacheAgeTradingDays, input.fssSourceAgeTradingDays]
    .filter((item): item is number => finiteNumber(item))
    .sort((a, b) => b - a)[0] ?? null;
  // ADR-0477 supply actual row carry — adapter 가 데이터 보유 시 router 가 무조건 carry
  // (selectedProvider 무관). selectedProvider != 'KIS_API' 일 때도 adapterFallbackActualRows
  // 가 router 결과로 propagate — diagnostic / SHADOW_SCORE 전용, executionImpact='NONE'.
  const routerCarriesActualRow = selectedCandidateCarriesActualRow
    || (acc.selectedProvider === 'KIS_API' && acc.sanitizedInvestorFlowRows.length > 0)
    || adapterRowsForwardedAcrossProviders;
  const routerVerifiedGuardStatus: InvestorFlowProviderStatus = acc.routeStatus === 'VERIFIED' && (acc.selectedProvider === 'KIS_API' || acc.providerStatuses.KIS_API === 'VERIFIED') && !routerCarriesActualRow
    ? (adapterCarriesActualRow ? 'VERIFIED_ADAPTER_ONLY' : 'SEMANTIC_CARRY_FAILED')
    : acc.routeStatus;
  const status = signal === 'UNKNOWN' && routerVerifiedGuardStatus === 'VERIFIED' ? 'DEGRADED' : routerVerifiedGuardStatus;
  const inputSources = Array.from(new Set([
    ...multiSourceMaterialization.candidates.filter((candidate) => candidate.sampleMaterialized).map((candidate) => candidate.provider),
    ...(input.naverCollectorResultAdr0481?.semanticNetBuyCandidate ? ['NAVER_INVESTOR_TREND' as const] : []),
    ...(input.semanticNetBuyNormalizationAdr0482?.samples.map((sample) => providerFromSemanticAdr0482(sample.provider)) ?? []),
    ...(cacheLookupSample || input.cacheRaw || input.previousTradingDayCacheRaw ? ['CACHE' as const] : []),
    ...(selectedDiagnosticProvider ? [selectedDiagnosticProvider] : []),
  ]));
  const statusCoverage = coverageFromStatuses(acc.providerStatuses);
  const fallbackChain: InvestorFlowProviderId[] = ['KRX_SYMBOL_INVESTOR_FLOW', 'KRX_MARKET_INVESTOR_FLOW', 'KIS_API', 'FSS_PASSIVE_ACTIVE', 'NAVER_INVESTOR_TREND', 'CACHE', 'SEMANTIC_NETBUY'];
  const selectedProviderForDiagnostics = acc.selectedProvider as InvestorFlowProviderId;
  const rejectedReasonByProvider: Record<string, string> = {};
  for (const [providerName, materialization] of Object.entries(acc.materializationDiagnostics)) {
    const provider = providerIdFromMaterializationAdr0477(providerName as InvestorSampleProviderNameAdr0502);
    if (provider === selectedProviderForDiagnostics) continue;
    if (materialization?.usableForRouter === true) continue;
    rejectedReasonByProvider[providerName] = materialization
      ? `blockedReason=${materialization.blockedReason}; sampleMaterialized=${materialization.sampleMaterialized}; usableForRouter=${materialization.usableForRouter}; rawCount=${materialization.rawCount}; normalizedCount=${materialization.normalizedCount}; materializedCount=${materialization.materializedCount}; placeholderDetected=${materialization.placeholderDetected}; inputSourceKind=${materialization.inputSourceKind}`
      : acc.providerReasons[provider] ?? acc.providerStatuses[provider] ?? 'NO_DIAGNOSTIC';
  }
  for (const provider of ['KRX_SYMBOL_INVESTOR_FLOW', 'KRX_MARKET_INVESTOR_FLOW', 'KRX_INVESTOR_FLOW', 'KIS_API', 'FSS_PASSIVE_ACTIVE', 'NAVER_INVESTOR_TREND', 'CACHE', 'SEMANTIC_NETBUY'] as const) {
    if (provider === selectedProviderForDiagnostics || rejectedReasonByProvider[provider]) continue;
    if (acc.providerStatuses[provider]) rejectedReasonByProvider[provider] = acc.providerReasons[provider] ?? `status=${acc.providerStatuses[provider]}`;
  }
  const rejectedProviders = Object.keys(rejectedReasonByProvider) as InvestorFlowProviderId[];
  const coverageAfterSet = new Set<InvestorFlowProviderId>();
  for (const materialization of Object.values(acc.materializationDiagnostics)) {
    const provider = materialization ? providerIdFromMaterializationAdr0477(materialization.providerName) : 'UNKNOWN';
    const staleCacheRouterBlocked = kisFirstMode && provider === 'CACHE' && (acc.providerStatuses.CACHE === 'CACHE_STALE_HIT' || acc.providerStatuses.CACHE === 'STALE');
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
    ? `CACHE selected after rejectedProviders=${rejectedProviders.join(',') || 'NONE'}; selectedReason=${acc.selectedReason ?? 'NONE'}`
    : staleCacheQuarantinedByKisFirst
      ? 'CACHE_STALE_HIT retained as fallbackDiagnosticOnly under KIS_FIRST_REBUILD_MODE=true; selectedProvider=NONE'
    : null;
  const staleButSelectedReason = selectedSemanticNetBuy?.status === 'STALE' || selectedSemanticNetBuy?.status === 'CACHE_STALE_HIT'
    ? `stale selected for SHADOW_ONLY diagnostic only; provider=${selectedProviderForDiagnostics}; status=${selectedSemanticNetBuy.status}; liveExecutionAllowed=false`
    : null;
  acc.diagnostics.push(`fallbackChain=${fallbackChain.join('>')}; selectedProvider=${selectedProviderForDiagnostics}; rejectedProviders=${rejectedProviders.join(',') || 'NONE'}; cacheFallbackReason=${cacheFallbackReason ?? 'NONE'}; staleButSelectedReason=${staleButSelectedReason ?? 'NONE'}; coverageBefore=${statusCoverage.available}; coverageAfter=${coverageAfter}; routerUsableCoverage=${routerUsableCoverage.available}/${routerUsableCoverage.total}; diagnosticUsableCoverage=${diagnosticUsableCoverage.available}/${diagnosticUsableCoverage.total}; diagnosticUsableCount=${diagnosticUsableCount}; selectedDiagnosticProvider=${selectedDiagnosticProvider ?? 'NONE'}; coverageBasis=routerUsableSampleCount plus selected SHADOW fallback.`);
  acc.diagnostics.push(`sourceOfTruth=${acc.selectedProvider === 'KRX_INVESTOR_FLOW' || acc.selectedProvider === 'KRX_SYMBOL_INVESTOR_FLOW' || acc.selectedProvider === 'KRX_MARKET_INVESTOR_FLOW' ? 'KRX' : acc.selectedProvider === 'FSS_PASSIVE_ACTIVE' ? 'FSS_OFFICIAL_DIAGNOSTIC' : acc.selectedProvider === 'NAVER_INVESTOR_TREND' ? 'NAVER_SECONDARY' : acc.selectedProvider === 'CACHE' ? 'CACHE_STALE_FALLBACK' : acc.selectedProvider === 'SEMANTIC_NETBUY' ? 'SEMANTIC_DERIVED' : acc.selectedProvider}; NAVER role=SECONDARY; SEMANTIC role=DERIVED; CACHE role=STALE_FALLBACK`);
  const kisSelectedCandidateCarriesSemanticRow = acc.selectedProvider === 'KIS_API' && Boolean(selectedSemanticRow);
  const semanticRowBreakPoint = acc.selectedProvider === 'KIS_API'
    ? !input.kisInvestorRaw
      ? 'ADAPTER_DID_NOT_ATTACH_ACTUAL_ROW'
      : acc.sanitizedInvestorFlowRows.length === 0 && acc.selectedActualWrapperOnly
        ? 'ACTUAL_ROW_CARRIED_BUT_EMPTY'
        : acc.sanitizedInvestorFlowRows.length === 0
          ? 'ADAPTER_DID_NOT_ATTACH_ACTUAL_ROW'
          : !acc.kisRawRowAvailableAtAdapter
            ? 'ADAPTER_DID_NOT_RETURN_RAW_ROW'
            : !selectedSemanticRow
              ? 'ROUTER_SELECTED_CANDIDATE_DROPPED_ACTUAL_ROW'
              : !acc.kisNormalizedRowAvailableAtRouter
                ? 'ACTUAL_ROW_CARRIED_ALIAS_NOT_MAPPED'
                : 'ACTUAL_ROW_CARRIED_WITH_FIELDS'
    : undefined;
  acc.diagnostics.push(`kisRawRowAvailableAtAdapter=${acc.kisRawRowAvailableAtAdapter}; kisNormalizedRowAvailableAtRouter=${acc.kisNormalizedRowAvailableAtRouter}; kisSelectedCandidateCarriesSemanticRow=${kisSelectedCandidateCarriesSemanticRow}; semanticRowBreakPoint=${semanticRowBreakPoint ?? 'UNKNOWN'}; selectedActualRowPath=${acc.selectedActualRowPath ?? 'none'}; selectedActualRowFieldKeys=${acc.selectedActualRowFieldKeys.join(',') || 'none'}; selectedActualNumericStringFieldKeys=${acc.selectedActualNumericStringFieldKeys.join(',') || 'none'}; sanitizedInvestorFlowRows=${acc.sanitizedInvestorFlowRows.length}; rawPayloadPersistenceAllowed=false`);
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
    usableForRouter: acc.selectedProvider !== 'NONE',
    usableForGate: false,
    usableForLive: false,
    usableForShadow: true,
    selectedProvider: acc.selectedProvider,
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
    rowCarryPath: acc.selectedProvider === 'KIS_API' || adapterRowsForwardedAcrossProviders ? 'ADAPTER_TO_ROUTER' : 'NONE',
    sanitizedInvestorFlowRows: acc.sanitizedInvestorFlowRows,
    actualInvestorFlowRows: acc.selectedProvider === 'KIS_API' ? selectedCandidateActualRows : (acc.sanitizedInvestorFlowRows.length > 0 ? acc.sanitizedInvestorFlowRows : selectedCandidateActualRows),
    actualInvestorFlowRowCount: acc.selectedProvider === 'KIS_API' ? selectedCandidateActualRowCount : (acc.sanitizedInvestorFlowRows.length > 0 ? acc.sanitizedInvestorFlowRows.length : selectedCandidateActualRowCount),
    actualInvestorFlowRowSourcePath: selectedMaterializedCandidate?.actualInvestorFlowRowSourcePath ?? acc.selectedActualRowPath,
    actualInvestorFlowFieldKeys: selectedMaterializedCandidate?.actualInvestorFlowFieldKeys ?? acc.selectedActualRowFieldKeys,
    actualInvestorFlowNumericKeys: selectedMaterializedCandidate?.actualInvestorFlowNumericKeys ?? Array.from(new Set([...acc.selectedActualNumericFieldKeys, ...acc.selectedActualNumericStringFieldKeys])),
    actualInvestorFlowNumericStringKeys: selectedMaterializedCandidate?.actualInvestorFlowNumericStringKeys ?? acc.selectedActualNumericStringFieldKeys,
    // actualInvestorFlowCarried — selectedProvider 무관 adapter carry 인정 (diagnostic only).
    actualInvestorFlowCarried: (acc.selectedProvider === 'KIS_API' && selectedCandidateCarriesActualRow) || adapterRowsForwardedAcrossProviders,
    adapterRowsForwardedAcrossProviders,
    // INVESTOR-FLOW-ACTUAL-ROW-CARRY-WIRING-001 — diagnostic actual row 를 bySymbol payload
    // 에 저장 (selectedProvider 무관). forensic 단계가 이 payload 를 merge 해 carry 유지.
    diagnosticActualInvestorRow,
    selectedProviderActualInvestorRow,
    actualInvestorRowProvider: actualRowProvider,
    actualInvestorRowUseScope,
    investorRowMaterializationClass: acc.investorRowMaterializationClass,
    diagnosticActualInvestorRowFromNormalized: diagnosticActualRowFromNormalized,
    selectedCandidate: selectedMaterializedCandidate,
    selectedActualRowPath: acc.selectedActualRowPath,
    selectedActualRowFieldKeys: acc.selectedActualRowFieldKeys,
    selectedActualNumericFieldKeys: acc.selectedActualNumericFieldKeys,
    selectedActualNumericStringFieldKeys: acc.selectedActualNumericStringFieldKeys,
    selectedActualPlaceholderFieldKeys: acc.selectedActualPlaceholderFieldKeys,
    kisRawRowAvailableAtAdapter: acc.kisRawRowAvailableAtAdapter,
    kisNormalizedRowAvailableAtRouter: acc.kisNormalizedRowAvailableAtRouter,
    kisSelectedCandidateCarriesSemanticRow,
    semanticRowBreakPoint,
    status,
    signal,
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    scoreUsage: 'SHADOW_ONLY',
  };
  const routeBySymbolKey = normalizeCodeAdr0477(input.code);
  acc.diagnostics.push(`adapterCarriesActualRow=${String(adapterCarriesActualRow)}; routerCarriesActualRow=${String(routerCarriesActualRow)}; adapterRowsForwardedAcrossProviders=${String(adapterRowsForwardedAcrossProviders)}; candidateBeforeSelectionCarriesActualRow=${String(candidateBeforeSelectionCarriesActualRow)}; selectedCandidateCarriesActualRow=${String(selectedCandidateCarriesActualRow)}; selectedCandidateActualRowCount=${selectedCandidateActualRowCount}; selectedCandidateActualRowFieldKeysTop=${selectedCandidateActualRowFieldKeysTop.slice(0, 16).join(',') || 'NONE'}; selectedCandidateActualRowDropReason=${selectedCandidateActualRowDropReason}; executionImpact=NONE; scoreUsage=SHADOW_ONLY`);
  acc.diagnostics.push(`[SUPPLY_ROUTER_VERIFIED_GUARD] symbol=${input.code} adapterHasActualRow=${adapterCarriesActualRow} routerCarriesActualRow=${routerCarriesActualRow} adapterRowsForwardedAcrossProviders=${adapterRowsForwardedAcrossProviders} candidateCarriesActualRow=${selectedCandidateCarriesActualRow} forensicCarriesActualRow=deferred routerStatus=${status}`);
  acc.diagnostics.push(`multiSourceCandidates=${multiSourceMaterialization.candidates.map((candidate) => `${candidate.provider}:${candidate.materializedCount}:${candidate.blockedReason}:priority=${candidate.selectedPriority}`).join('|') || 'NONE'}; noMaterializedCandidateReason=${multiSourceMaterialization.noMaterializedCandidateReason ?? 'NONE'}`);
  for (const materialization of Object.values(acc.materializationDiagnostics)) {
    acc.diagnostics.push(formatInvestorSampleDiagnosticsAdr0502(materialization));
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
    // ADR-0657 — 추정수급 SHADOW-only fallback 분류 필드는 flag ON(acc 가 set) 일 때만 emit.
    // flag OFF 면 acc 미설정 → 전부 unset(undefined) = byte-identical. selectedProvider/CORE 무영향.
    ...(acc.estimateShadowFallbackUsed !== undefined ? { estimateShadowFallbackUsed: acc.estimateShadowFallbackUsed } : {}),
    ...(acc.estimateProvider !== undefined ? { estimateProvider: acc.estimateProvider } : {}),
    ...(acc.estimateUseScope !== undefined ? { estimateUseScope: acc.estimateUseScope } : {}),
    ...(acc.estimateConfidence !== undefined ? { estimateConfidence: acc.estimateConfidence } : {}),
    inferredSymbolMatched: !selectedSemanticNetBuy?.code && Boolean(input.code),
    selectedProvider: acc.selectedProvider,
    providerTried,
    providerReasons: acc.providerReasons,
    providerStatuses: acc.providerStatuses,
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
    rowCarryPath: acc.selectedProvider === 'KIS_API' || adapterRowsForwardedAcrossProviders ? 'ADAPTER_TO_ROUTER' : 'NONE',
    sanitizedInvestorFlowRows: acc.sanitizedInvestorFlowRows,
    actualInvestorFlowRows: acc.selectedProvider === 'KIS_API' ? selectedCandidateActualRows : (acc.sanitizedInvestorFlowRows.length > 0 ? acc.sanitizedInvestorFlowRows : selectedCandidateActualRows),
    actualInvestorFlowRowCount: acc.selectedProvider === 'KIS_API' ? selectedCandidateActualRowCount : (acc.sanitizedInvestorFlowRows.length > 0 ? acc.sanitizedInvestorFlowRows.length : selectedCandidateActualRowCount),
    actualInvestorFlowRowSourcePath: selectedMaterializedCandidate?.actualInvestorFlowRowSourcePath ?? acc.selectedActualRowPath,
    actualInvestorFlowFieldKeys: selectedMaterializedCandidate?.actualInvestorFlowFieldKeys ?? acc.selectedActualRowFieldKeys,
    actualInvestorFlowNumericKeys: selectedMaterializedCandidate?.actualInvestorFlowNumericKeys ?? Array.from(new Set([...acc.selectedActualNumericFieldKeys, ...acc.selectedActualNumericStringFieldKeys])),
    actualInvestorFlowNumericStringKeys: selectedMaterializedCandidate?.actualInvestorFlowNumericStringKeys ?? acc.selectedActualNumericStringFieldKeys,
    actualInvestorFlowCarried: (acc.selectedProvider === 'KIS_API' && selectedCandidateCarriesActualRow) || adapterRowsForwardedAcrossProviders,
    adapterRowsForwardedAcrossProviders,
    diagnosticActualInvestorRow,
    selectedProviderActualInvestorRow,
    actualInvestorRowProvider: actualRowProvider,
    actualInvestorRowUseScope,
    investorRowMaterializationClass: acc.investorRowMaterializationClass,
    diagnosticActualInvestorRowFromNormalized: diagnosticActualRowFromNormalized,
    selectedCandidate: selectedMaterializedCandidate,
    bySymbol: { [routeBySymbolKey]: routeBySymbolPayload },
    selectedActualRowPath: acc.selectedActualRowPath,
    selectedActualRowFieldKeys: acc.selectedActualRowFieldKeys,
    selectedActualNumericFieldKeys: acc.selectedActualNumericFieldKeys,
    selectedActualNumericStringFieldKeys: acc.selectedActualNumericStringFieldKeys,
    selectedActualPlaceholderFieldKeys: acc.selectedActualPlaceholderFieldKeys,
    kisRawRowAvailableAtAdapter: acc.kisRawRowAvailableAtAdapter,
    kisNormalizedRowAvailableAtRouter: acc.kisNormalizedRowAvailableAtRouter,
    kisSelectedCandidateCarriesSemanticRow,
    semanticRowBreakPoint,
    status,
    signal,
    coverage: {
      ...statusCoverage,
      available: routerUsableCoverage.available,
    },
    freshness: {
      cacheState: cacheState(acc.providerStatuses.CACHE),
      sourceState: sourceState(sourceAge),
      sourceAgeTradingDays: sourceAge,
      oldestSourceAgeTradingDays: oldest,
      lastSourceDate: selectedSemanticNetBuy?.sourceDate ?? null,
    },
    ...ROUTER_POLICY,
    selectedReason: acc.selectedReason,
    inputSources,
    cacheFallbackUsed: acc.selectedProvider === 'CACHE' || selectedSemanticNetBuy?.source === 'CACHE',
    semanticInputStatus: acc.providerStatuses.SEMANTIC_NETBUY ?? 'DATA_UNAVAILABLE',
    naverSampleStatus: acc.providerStatuses.NAVER_INVESTOR_TREND ?? acc.providerStatuses.NAVER ?? 'DATA_UNAVAILABLE',
    naverReadinessKind: naverFreshDataSnapshot?.readinessKind,
    semanticReadinessKind: semanticFreshDataSnapshot?.readinessKind,
    selectedFreshness: selectedDiagnosticProvider
      ? (acc.routeStatus === 'STALE' || acc.routeStatus === 'CACHE_STALE_HIT' ? 'STALE' : acc.routeStatus === 'OBSERVING' || acc.routeStatus === 'CACHE_HIT' ? 'UNKNOWN' : 'MISSING')
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
    selectedForShadow: acc.selectedProvider !== 'NONE',
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
    materializationDiagnostics: acc.materializationDiagnostics,
    rejectedProviders,
    rejectedReasonByProvider,
    fallbackChain,
    cacheFallbackReason,
    staleButSelectedReason,
    coverageBefore: statusCoverage.available,
    coverageAfter,
    diagnosticUsableCount,
    noMaterializedCandidateReason: multiSourceMaterialization.noMaterializedCandidateReason,
    diagnostics: acc.diagnostics,
  };
}
