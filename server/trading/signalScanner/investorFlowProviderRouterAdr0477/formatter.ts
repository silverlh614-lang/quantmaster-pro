/**
 * @responsibility ADR-0477 investor flow router formatter.
 */

import type { InvestorFlowProviderRouteResult } from './types.js';
import type { CanonicalRuntimeResolutionStep27 } from '../runtimeResolverTraceStep26.js';

export function formatInvestorFlowProviderRouterAdr0477(
  result?: InvestorFlowProviderRouteResult | null,
  canonicalRuntimeResolution?: CanonicalRuntimeResolutionStep27,
): string | null {
  if (!result) return null;
  const canonicalKis = canonicalRuntimeResolution?.kisInvestorFlow;
  const legacySelectedReasonDeprecated = canonicalKis?.finalRouterUsable && String(result.selectedReason ?? '').includes('NOT_ROUTER_USABLE');
  const selectedReason = legacySelectedReasonDeprecated
    ? 'CANONICAL_ROUTER_USABLE'
    : result.selectedReason ?? 'NONE';
  const nextAction = result.status === 'DATA_UNAVAILABLE' || result.coverage.notWired > 0
    ? 'WIRE_NAVER_OR_REPAIR_CACHE_KEY / feed SemanticNetBuy normalized input / keep UNKNOWN out of bearish scoring'
    : result.freshness.oldestSourceAgeTradingDays !== null && result.freshness.oldestSourceAgeTradingDays >= 4
      ? 'refresh stale FSS source / keep UNKNOWN out of bearish scoring'
      : 'store ADR-0476 observation row and keep provider issue out of bearish scoring';
  return [
    '🔌 Investor Flow Provider Router (ADR-0477)',
    `- route: ${result.route}`,
    `- selectedProvider: ${result.selectedProvider}`,
    `- status: ${result.status}`,
    `- signal: ${result.signal}`,
    `- coverage: ${result.coverage.available}/${result.coverage.total}`,
    `- routerUsableCoverage: ${result.routerUsableCoverage?.available ?? result.coverage.available}/${result.routerUsableCoverage?.total ?? result.coverage.total}`,
    `- diagnosticUsableCoverage: ${result.diagnosticUsableCoverage?.available ?? result.diagnosticUsableCount ?? 0}/${result.diagnosticUsableCoverage?.total ?? result.coverage.total}`,
    `- freshness: cache=${result.freshness.cacheState}, source=${result.freshness.sourceState}, oldest=${result.freshness.oldestSourceAgeTradingDays ?? 'unknown'} trading days`,
    `- selectedReason: ${selectedReason}`,
    ...(legacySelectedReasonDeprecated
      ? ['- legacySelectedReason: deprecated=true notUsedForDecision=true replacedBy=canonicalRuntimeResolution.kisInvestorFlow']
      : []),
    ...(canonicalKis
      ? [
          '- canonicalRuntimeResolution.kisInvestorFlow:',
          `  finalRouterUsable=${canonicalKis.finalRouterUsable}`,
          `  finalGateScoreEligible=${canonicalKis.finalGateScoreEligible}`,
          `  gateEligibleRows=${canonicalKis.gateEligibleRows}/${canonicalKis.totalRows}`,
          `  shadowOnlyRows=${canonicalKis.shadowOnlyRows}/${canonicalKis.totalRows}`,
          `  failedCriteria=${canonicalKis.failedCriteria.length > 0 ? canonicalKis.failedCriteria.join(',') : '[]'}`,
          `  marketSignal=${canonicalKis.marketSignal}`,
          '  executionImpact=NONE',
        ]
      : []),
    `- inputSources: ${result.inputSources?.join(',') || 'NONE'}`,
    `- cacheFallbackUsed: ${result.cacheFallbackUsed ?? false}`,
    `- fallbackChain: ${result.fallbackChain?.join(' > ') || 'NONE'}`,
    `- rejectedProviders: ${result.rejectedProviders?.join(',') || 'NONE'}`,
    `- rejectedReasonByProvider: ${Object.entries(result.rejectedReasonByProvider ?? {}).map(([provider, reason]) => `${provider}=${reason}`).join(' | ') || 'NONE'}`,
    `- noMaterializedCandidateReason: ${result.noMaterializedCandidateReason ?? 'NONE'}`,
    `- cacheFallbackReason: ${result.cacheFallbackReason ?? 'NONE'}`,
    `- staleButSelectedReason: ${result.staleButSelectedReason ?? 'NONE'}`,
    `- coverageBasis: routerUsableSampleCount plus selected SHADOW fallback; before=${result.coverageBefore ?? result.coverage.available}, after=${result.coverageAfter ?? result.coverage.available}`,
    `- diagnosticUsableCount: ${result.diagnosticUsableCount ?? 0}`,
    `- selectedDiagnosticProvider: ${result.selectedDiagnosticProvider ?? 'NONE'}`,
    `- selectedDiagnosticReason: ${result.selectedDiagnosticReason ?? 'NONE'}`,
    `- selectedForLive: ${result.selectedForLive ?? false}`,
    `- selectedForShadow: ${result.selectedForShadow ?? result.selectedProvider !== 'NONE'}`,
    `- kisFirstMode: ${result.kisFirstMode ?? false}`,
    `- dryRunLane: ${result.dryRunLane ?? 'NONE'}`,
    `- usedForCurrentGate: ${result.usedForCurrentGate ?? false}`,
    `- usedForLiveDecision: ${result.usedForLiveDecision ?? false}`,
    `- fallbackProvider: ${result.fallbackProvider ?? 'NONE'}`,
    `- fallbackStatus: ${result.fallbackStatus ?? 'NONE'}`,
    `- fallbackDiagnosticOnly: ${result.fallbackDiagnosticOnly ?? false}`,
    `- legacyDryRunSummary: ${result.legacyDryRunSummary ?? 'NONE'}`,
    `- krxSourceRepair: ${result.krxSourceRepairDiagnostic?.summary ?? result.krxSourceRepairDiagnostic?.parserStatus ?? 'NONE'}`,
    `- semanticInputStatus: ${result.semanticInputStatus ?? result.providerStatuses.SEMANTIC_NETBUY ?? 'DATA_UNAVAILABLE'}`,
    `- kisRawRowAvailableAtAdapter: ${result.kisRawRowAvailableAtAdapter ?? false}`,
    `- kisNormalizedRowAvailableAtRouter: ${result.kisNormalizedRowAvailableAtRouter ?? false}`,
    `- kisSelectedCandidateCarriesSemanticRow: ${result.kisSelectedCandidateCarriesSemanticRow ?? false}`,
    `- semanticRowBreakPoint: ${result.semanticRowBreakPoint ?? 'UNKNOWN'}`,
    `- selectedActualRowPath: ${result.selectedActualRowPath ?? 'NONE'}`,
    `- selectedActualRowFieldKeys: ${result.selectedActualRowFieldKeys?.join(',') || 'NONE'}`,
    `- selectedActualNumericStringFieldKeys: ${result.selectedActualNumericStringFieldKeys?.join(',') || 'NONE'}`,
    `- selectedCandidateCarriesActualRow: ${result.selectedCandidate?.actualInvestorFlowCarried ?? result.actualInvestorFlowCarried ?? false}`,
    `- selectedCandidateActualRowCount: ${result.selectedCandidate?.actualInvestorFlowRowCount ?? result.actualInvestorFlowRowCount ?? 0}`,
    `- selectedCandidateActualRowFieldKeysTop: ${(result.selectedCandidate?.actualInvestorFlowFieldKeys ?? result.actualInvestorFlowFieldKeys ?? []).slice(0, 16).join(',') || 'NONE'}`,
    `- selectedCandidateActualRowDropReason: ${(result.actualInvestorFlowCarried ?? false) ? 'SELECTED_CANDIDATE_CARRIES_ACTUAL_ROW' : 'SELECTED_CANDIDATE_DROPPED_ACTUAL_ROW'}`,

    `- naverSampleStatus: ${result.naverSampleStatus ?? result.providerStatuses.NAVER_INVESTOR_TREND ?? result.providerStatuses.NAVER ?? 'DATA_UNAVAILABLE'}`,
    `- naverReadinessKind: ${result.naverReadinessKind ?? 'UNKNOWN'}`,
    `- semanticReadinessKind: ${result.semanticReadinessKind ?? 'UNKNOWN'}`,
    `- selectedFreshness: ${result.selectedFreshness ?? 'UNKNOWN'}`,
    `- selectedConfidence: ${result.selectedConfidence ?? 'NONE'}`,
    `- providerTried: ${result.providerTried.join(' -> ') || 'NONE'}`,
    `- providerTriedDetail: ${Object.entries(result.providerReasons).map(([provider, reason]) => `${provider}=${reason}`).join(' | ') || 'NONE'}`,
    `- rawPayloadPersistenceAllowed: false`,
    `- executionImpact: ${result.executionImpact}`,
    `- liveExecutionAllowed: ${result.liveExecutionAllowed}`,
    '- 수급 악화가 아니라 수급 데이터 라우팅/커버리지 문제입니다.',
    '- UNKNOWN/provider issue는 bearish로 변환되지 않습니다.',
    '- STRONG_BUY는 차단될 수 있지만 Gate fail로 확정하지 않습니다.',
    '- ADR-0476 ledger에 관찰 row를 저장합니다.',
    `- nextAction: ${nextAction}`,
  ].join('\n');
}
