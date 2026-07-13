/**
 * @responsibility ADR-0505 summary 누적 헬퍼 — failed/all audit 순회 본문을 mutable state 로 추출.
 */

import type {
  DominantFailureReason,
  Gate1ForensicTraceSourcePath,
  Gate1MinimumSignalForensicAuditAdr0505,
  HydrationMissingReason,
  RsHydrationSourceAdr0509,
  BreakoutHydrationSourceAdr0509,
  SellOnlyCarryBreakPointAdr0507,
  SupplyScopeWarning,
  WatchlistBreakPointAdr0510,
  QuoteHydrationBreakPointAdr0510,
  ConditionResultsBreakPointAdr0510,
} from './types.js';
import type { InvestorFlowSemanticAvailabilityReason } from '../../../supply/investorFlowSemanticAvailability.js';
import { bump } from './auditBuilder.js';
import { BREAKOUT_CONDITION_KEYS } from './featureHydrationAudit.js';
import { resolveSupplyUnknownRootCause } from './supplyScopeAudit.js';

/** router 가 verified 인데 forensic semantic 0 일 때의 단절 사유 분기 SSOT. */
export function resolveRouterForensicConflictReason(s: SummaryAccumulatorState): string | undefined {
  if (!(s.supplyDiagnosticAvailable > 0 && s.supplySemanticAvailable === 0)) return undefined;
  return s.semanticReasonDistribution.STALE_ONLY > 0
    ? 'ROUTER_VERIFIED_BUT_SHADOW_ONLY_STALE'
    : s.semanticRowMetadataOnlyCount > 0
      ? 'ROUTER_VERIFIED_BUT_SELECTED_CANDIDATE_METADATA_ONLY'
      : Object.keys(s.semanticRowBreakPointDistribution).some((key) => key.includes('DROPPED') && s.semanticRowBreakPointDistribution[key] > 0)
        ? 'ROUTER_VERIFIED_BUT_SEMANTIC_ROW_DROPPED'
        : s.semanticReasonDistribution.FIELD_ALIAS_NOT_MAPPED > 0
          ? 'ROUTER_VERIFIED_BUT_FIELD_ALIAS_NOT_MAPPED'
          : s.semanticReasonDistribution.ONLY_MARKET_LEVEL_FLOW > 0 || s.semanticReasonDistribution.ONLY_SECTOR_LEVEL_FLOW > 0
            ? 'ROUTER_VERIFIED_BUT_MARKET_LEVEL_ONLY'
            : 'ROUTER_VERIFIED_BUT_SEMANTIC_FIELDS_MISSING';
}

/** watchlist source/import 불일치 사유 분기 SSOT. */
export function resolveWatchlistConflictReason(
  watchlistSourceAvailableCount: number,
  watchlistScoreImportedCount: number,
  watchlistUpstreamMissing: number,
): 'DIFFERENT_SOURCE_PATH' | 'TRACE_FIELD_MISSING' | undefined {
  return watchlistSourceAvailableCount !== watchlistScoreImportedCount
    ? 'DIFFERENT_SOURCE_PATH'
    : watchlistUpstreamMissing > 0 && watchlistScoreImportedCount > 0
      ? 'TRACE_FIELD_MISSING'
      : undefined;
}

/** `for (const k of keys ?? []) target[k] = (target[k] ?? 0) + 1;` 인라인 tally 루프 SSOT. */
function tallyKeys(target: Record<string, number>, keys: ReadonlyArray<string> | undefined): void {
  for (const k of keys ?? []) target[k] = (target[k] ?? 0) + 1;
}

/** failed/all audit 순회가 변형하는 누적 변수 묶음 (참조 전달 — scalar 값 보존). */
export interface SummaryAccumulatorState {
  supplyScopeWarnings: Record<SupplyScopeWarning, number>;
  supplySymbolMatchedCount: number;
  inferredSymbolMatchedCount: number;
  candidateSymbolAvailableCount: number;
  quoteSymbolAvailableCount: number;
  requestSymbolAvailableCount: number;
  providerSymbolAvailableCount: number;
  symbolMissingCount: number;
  symbolMismatchCount: number;
  providerScopeDistribution: Record<string, number>;
  semanticReasonDistribution: Record<InvestorFlowSemanticAvailabilityReason, number>;
  scoreUsageDistribution: Record<string, number>;
  supplyUnknownRootCauseDistribution: Record<string, number>;
  kisRawFieldKeysTop: Record<string, number>;
  actualRawFieldKeysTop: Record<string, number>;
  actualNumericStringFieldKeysTop: Record<string, number>;
  actualNumberFieldKeysTop: Record<string, number>;
  actualPlaceholderFieldKeysTop: Record<string, number>;
  candidateNetBuyFieldKeysTop: Record<string, number>;
  selectedActualRawFieldKeysTop: Record<string, number>;
  selectedNumericStringFieldKeysTop: Record<string, number>;
  rejectedWrapperPathsTop: Record<string, number>;
  rowCandidateCount: number;
  selectedRowScoreSum: number;
  selectedRowScoreCount: number;
  wrapperOnlyCount: number;
  numericCandidateCount: number;
  aliasCandidateCount: number;
  selectedPathTop: Record<string, number>;
  kisNormalizedFieldKeysTop: Record<string, number>;
  kisSemanticFieldKeysTop: Record<string, number>;
  semanticRowBreakPointDistribution: Record<string, number>;
  semanticRowAvailableCount: number;
  semanticRowMetadataOnlyCount: number;
  rawInvestorRowAvailableCount: number;
  adapterRowsForwardedAcrossProvidersCount: number;
  diagnosticActualInvestorRowCarriedCount: number;
  selectedProviderActualRowCount: number;
  diagnosticOnlyActualRowCount: number;
  actualInvestorRowProviderDistribution: Record<string, number>;
  actualInvestorRowUseScopeDistribution: Record<string, number>;
  kisNormalizedRowsMaterialized: number;
  kisSemanticRowsMaterialized: number;
  normalizedRowsPromotedToDiagnosticActualRow: number;
  normalizedMetadataOnlyRows: number;
  semanticMetadataOnlyRows: number;
  bySymbolDiagnosticActualRowFromNormalized: number;
  sellOnlyBySymbolPayloadFromNormalized: number;
  semanticFromNormalizedActualRow: number;
  investorRowMaterializationClassDistribution: Record<string, number>;
  selectedCandidateCarriesSemanticRowCount: number;
  selectedCandidateCarriesActualRowCount: number;
  forensicInputCarriesSemanticRowCount: number;
  forensicInputCarriesActualInvestorRowsCount: number;
  actualInvestorRowPathDistribution: Record<string, number>;
  actualInvestorRowFieldKeysTop: Record<string, number>;
  actualInvestorNumericStringKeysTop: Record<string, number>;
  actualInvestorNumberKeysTop: Record<string, number>;
  sampleValueKindDistribution: Record<string, number>;
  mappedFieldDistribution: { foreign: Record<string, number>; institution: Record<string, number>; individual: Record<string, number> };
  supplySemanticAvailable: number;
  supplyDiagnosticAvailable: number;
  foreignNetBuyAvailable: number;
  institutionalNetBuyAvailable: number;
  zeroButMaterializedCount: number;
  shadowEligibleSupplyCount: number;
  rsHydrationAvailableCount: number;
  breakoutHydrationAvailableCount: number;
  rsMissingReasonDistribution: Record<HydrationMissingReason, number>;
  breakoutMissingReasonDistribution: Record<HydrationMissingReason, number>;
  hydrationMissingFieldCounts: Record<string, number>;
  rsMissingFieldCounts: Record<string, number>;
  breakoutMissingFieldCounts: Record<string, number>;
  watchlistSourceFieldDistribution: Record<string, number>;
  watchlistMissingReasonCounts: Record<string, number>;
  watchlistScoreScaleDistribution: Record<string, number>;
  watchlistScoreSum: number;
  quoteMissingReasonCounts: Record<string, number>;
  quoteFeatureFieldCoverage: Record<string, number>;
  quoteFeatureAvailableCount: number;
  conditionResultsKeyCoverage: Record<string, number>;
  conditionResultStatusDistribution: Record<string, number>;
  rsConditionStatusDistribution: Record<string, number>;
  breakoutConditionStatusDistribution: Record<string, number>;
  conditionResultsAvailableCount: number;
  breakoutConditionKeyCoverage: Record<string, number>;
  rsSourceDistribution: Record<RsHydrationSourceAdr0509, number>;
  breakoutSourceDistribution: Record<BreakoutHydrationSourceAdr0509, number>;
  watchlistSourceAvailableCount: number;
  watchlistScoreImportedCount: number;
  rsScoreUsableCount: number;
  breakoutScoreUsableCount: number;
  candidateTraceHasQuote: number;
  candidateTraceHasSymbolFeatures: number;
  candidateTraceHasConditionResults: number;
  computedTechnicalTraceCount: number;
  sourcePathDistribution: Record<Gate1ForensicTraceSourcePath, number>;
  sourcePathWithWatchlistScore: Record<Gate1ForensicTraceSourcePath, number>;
  sourcePathWithQuote: Record<Gate1ForensicTraceSourcePath, number>;
  sourcePathWithConditionResults: Record<Gate1ForensicTraceSourcePath, number>;
  sellOnlyCarryBreakPointDistribution: Record<SellOnlyCarryBreakPointAdr0507, number>;
  sellOnlyBySymbolPayloadAvailableCount: number;
  sellOnlyBySymbolPayloadMergedCount: number;
  sellOnlyActualRowsCarriedCount: number;
  sourcePathMissingFieldCounts: Record<string, Record<string, number>>;
  watchlistBreakPointDistribution: Record<WatchlistBreakPointAdr0510, number>;
  quoteHydrationBreakPointDistribution: Record<QuoteHydrationBreakPointAdr0510, number>;
  conditionResultsBreakPointDistribution: Record<ConditionResultsBreakPointAdr0510, number>;
  watchlistEntryScoreAvailable: number;
  stage2ScoreAvailable: number;
  promotionScoreAvailable: number;
  entryFilterTraceScoreAvailable: number;
  forensicInputScoreAvailable: number;
  sectorEnergyStrongBuyBlockedCount: number;
  sectorEnergyHardBlockCount: number;
  watchlistScoreNormalized: number;
  watchlistScoreMissing: number;
  watchlistScoreScaleFixed: number;
  promotionScoreCopied: number;
  watchlistScoreScaleDistributionBefore: Record<string, number>;
  watchlistScoreScaleDistributionAfter: Record<string, number>;
  watchlistScoreNormalizationBreakPoint: Record<string, number>;
  technicalProjectionCoverage: Record<string, number>;
  maAlignmentComputed: number;
  return5dAvailable: number;
  return20dAvailable: number;
  technicalComputedButProjectionMissingCount: number;
  technicalProjectionBreakPoint: Record<string, number>;
  maAlignmentAdvisoryOnlyCount: number;
  technicalTrendDeathHardBlockCount: number;
  rsBreakPointDistribution: Record<string, number>;
  rsComputedFromReturn20dCount: number;
  rsIndexFallbackUsedCount: number;
  rsTraceButScoreMissingBreakPoint: Record<string, number>;
  supplyMissingNeutralized: number;
  supplyMissingLearningTagDistribution: Record<string, number>;
}

/** failed audit 1건의 supply/hydration/sourcePath 누적 (line 445 루프 본문 SSOT). */
export function accumulateFailedAudit(s: SummaryAccumulatorState, a: Gate1MinimumSignalForensicAuditAdr0505): void {
  const sourcePath = a.sourcePath === 'SELL_ONLY_DIAGNOSTIC_SNAPSHOT'
    ? 'PREFLIGHT_UNIVERSE_SNAPSHOT'
    : a.sourcePath ?? 'UNKNOWN';
  accSourcePathBreakpoints(s, a, sourcePath);
  accSupplyScopeSymbol(s, a);
  accMaterialization(s, a);
  accFieldDiagnostics(s, a);
  accWatchlistQuoteCondition(s, a);
  accHydrationSourceFields(s, a);
}

function accSourcePathBreakpoints(s: SummaryAccumulatorState, a: Gate1MinimumSignalForensicAuditAdr0505, sourcePath: Gate1ForensicTraceSourcePath): void {
  bump(s.sourcePathDistribution, sourcePath);
  bump(s.watchlistBreakPointDistribution, a.watchlistBreakPoint ?? 'UNKNOWN');
  bump(s.quoteHydrationBreakPointDistribution, a.quoteHydrationBreakPoint === 'SELL_ONLY_SKIPPED_QUOTE_EVALUATION' ? 'PRECHECK_ONLY_TRACE' : a.quoteHydrationBreakPoint ?? 'UNKNOWN');
  bump(s.conditionResultsBreakPointDistribution, a.conditionResultsBreakPoint === 'SELL_ONLY_SKIPPED_GATE_EVALUATION' ? 'PRECHECK_ONLY_TRACE' : a.conditionResultsBreakPoint ?? 'UNKNOWN');
  if (a.hydrationAuditAdr0509?.watchlist.scoreImported) {
    s.sourcePathWithWatchlistScore[sourcePath] += 1;
    s.forensicInputScoreAvailable += 1;
  }
  if (a.hydrationAuditAdr0509?.watchlist.watchlistScore != null) s.watchlistEntryScoreAvailable += 1;
  if (a.hydrationAuditAdr0509?.watchlist.stage2Score != null) s.stage2ScoreAvailable += 1;
  if (a.hydrationAuditAdr0509?.watchlist.upstreamCandidateScore != null) s.promotionScoreAvailable += 1;
  if (a.hydrationAuditAdr0509?.watchlist.sourceAvailable) s.entryFilterTraceScoreAvailable += 1;
  if (a.hydrationAuditAdr0509?.candidateTraceHasQuote) s.sourcePathWithQuote[sourcePath] += 1;
  if (a.hydrationAuditAdr0509?.candidateTraceHasConditionResults) s.sourcePathWithConditionResults[sourcePath] += 1;
  for (const field of a.hydrationAuditAdr0509?.missingFields ?? []) {
    const byField = s.sourcePathMissingFieldCounts[sourcePath] ?? {};
    byField[field] = (byField[field] ?? 0) + 1;
    s.sourcePathMissingFieldCounts[sourcePath] = byField;
  }
}

function accSupplyScopeSymbol(s: SummaryAccumulatorState, a: Gate1MinimumSignalForensicAuditAdr0505): void {
  s.supplyScopeWarnings[a.supplyScopeAudit.warning] += 1;
  if (a.supplyScopeAudit.symbolMatched === true) s.supplySymbolMatchedCount += 1;
  if (a.supplyScopeAudit.inferredSymbolMatched === true) s.inferredSymbolMatchedCount += 1;
  if (a.supplyScopeAudit.candidateSymbol) s.candidateSymbolAvailableCount += 1;
  if (a.supplyScopeAudit.quoteSymbol) s.quoteSymbolAvailableCount += 1;
  if (a.supplyScopeAudit.requestSymbol) s.requestSymbolAvailableCount += 1;
  if (a.supplyScopeAudit.providerSymbol || a.supplyScopeAudit.kisFlowSymbol || a.supplyScopeAudit.normalizedSymbol) s.providerSymbolAvailableCount += 1;
  if (a.supplyScopeAudit.warning === 'KIS_FLOW_SYMBOL_MISSING') s.symbolMissingCount += 1;
  if (a.supplyScopeAudit.warning === 'KIS_FLOW_SYMBOL_MISMATCH') s.symbolMismatchCount += 1;
  const scopeKey = a.supplyScopeAudit.providerScope ?? 'UNKNOWN';
  s.providerScopeDistribution[scopeKey] = (s.providerScopeDistribution[scopeKey] ?? 0) + 1;
  if (a.supplyScopeAudit.semanticAvailable) s.supplySemanticAvailable += 1;
  if (a.supplyScopeAudit.semanticDiagnosticAvailable) s.supplyDiagnosticAvailable += 1;
  if (a.supplyScopeAudit.semanticRowAvailable) s.semanticRowAvailableCount += 1;
  if (a.supplyScopeAudit.semanticRowMetadataOnly) s.semanticRowMetadataOnlyCount += 1;
  if (a.supplyScopeAudit.rawInvestorRowAvailable) s.rawInvestorRowAvailableCount += 1;
  // ADR-0477 supply actual row carry diagnostic — adapter (KIS) 가 actual row 보유 +
  // selectedProvider != KIS_API 인 경우에도 router 가 carry. 사용자 명시 #6 단절 진단 집계.
  if (a.supplyScopeAudit.adapterRowsForwardedAcrossProviders) s.adapterRowsForwardedAcrossProvidersCount += 1;
  // INVESTOR-FLOW-ACTUAL-ROW-CARRY-WIRING-001 — diagnostic actual row carry 집계.
  if (a.supplyScopeAudit.diagnosticActualInvestorRowCarried) {
    s.diagnosticActualInvestorRowCarriedCount += 1;
    if (
      a.supplyScopeAudit.actualInvestorRowUseScope === 'SELECTED_PROVIDER' ||
      a.supplyScopeAudit.actualInvestorRowUseScope === 'GATE_SCORE_ELIGIBLE'
    ) {
      s.selectedProviderActualRowCount += 1;
    }
    else s.diagnosticOnlyActualRowCount += 1;
  }
  if (a.supplyScopeAudit.actualInvestorRowProvider) {
    const provider = a.supplyScopeAudit.actualInvestorRowProvider;
    s.actualInvestorRowProviderDistribution[provider] = (s.actualInvestorRowProviderDistribution[provider] ?? 0) + 1;
  }
  if (a.supplyScopeAudit.actualInvestorRowUseScope) {
    const scope = a.supplyScopeAudit.actualInvestorRowUseScope;
    s.actualInvestorRowUseScopeDistribution[scope] = (s.actualInvestorRowUseScopeDistribution[scope] ?? 0) + 1;
  }
}

function accMaterialization(s: SummaryAccumulatorState, a: Gate1MinimumSignalForensicAuditAdr0505): void {
  // Patch-SUPPLY-DIAG-ACCURACY: kisNormalizedRowsMaterialized 는 실제 정규화 *값* 이 1개
  // 이상 존재할 때만 카운트한다. 이전엔 `kisNormalizedFieldKeysTop.length > 0` OR 분기가
  // wrapper/metadata 키만 보유한 후보까지 materialized 로 집계해 40/40 false positive 를
  // 만들었다 (kisSemanticRowsMaterialized 0/40 + investorRowMaterializationClass none 과 모순).
  if ((a.supplyScopeAudit.normalizedCount ?? 0) > 0) s.kisNormalizedRowsMaterialized += 1;
  if ((a.supplyScopeAudit.materializedCount ?? 0) > 0 || a.supplyScopeAudit.semanticRowAvailable) s.kisSemanticRowsMaterialized += 1;
  const materializationClass = a.supplyScopeAudit.investorRowMaterializationClass ?? (a.supplyScopeAudit.diagnosticActualInvestorRowFromNormalized ? 'NORMALIZED_NUMERIC_ROW' : undefined);
  if (materializationClass) s.investorRowMaterializationClassDistribution[materializationClass] = (s.investorRowMaterializationClassDistribution[materializationClass] ?? 0) + 1;
  if (a.supplyScopeAudit.diagnosticActualInvestorRowFromNormalized && a.supplyScopeAudit.diagnosticActualInvestorRowCarried) {
    s.normalizedRowsPromotedToDiagnosticActualRow += 1;
    s.semanticFromNormalizedActualRow += a.supplyScopeAudit.semanticAvailable ? 1 : 0;
  }
  if (materializationClass === 'NORMALIZED_METADATA_ONLY') s.normalizedMetadataOnlyRows += 1;
  if (materializationClass === 'SEMANTIC_METADATA_ONLY') s.semanticMetadataOnlyRows += 1;
  if (a.supplyScopeAudit.diagnosticActualInvestorRowFromNormalized && a.supplyScopeAudit.sellOnlyBySymbolPayloadAvailable) s.bySymbolDiagnosticActualRowFromNormalized += 1;
  if (a.supplyScopeAudit.diagnosticActualInvestorRowFromNormalized && a.supplyScopeAudit.sellOnlyBySymbolPayloadAvailable) s.sellOnlyBySymbolPayloadFromNormalized += 1;
  if (a.supplyScopeAudit.selectedCandidateCarriesSemanticRow) s.selectedCandidateCarriesSemanticRowCount += 1;
  if ((a.supplyScopeAudit.selectedActualRowFieldKeys?.length ?? 0) > 0) s.selectedCandidateCarriesActualRowCount += 1;
  if (a.supplyScopeAudit.forensicInputCarriesSemanticRow) s.forensicInputCarriesSemanticRowCount += 1;
  if (a.supplyScopeAudit.forensicInputCarriesActualInvestorRows) s.forensicInputCarriesActualInvestorRowsCount += 1;
  if (a.supplyScopeAudit.selectedActualRowPath) s.actualInvestorRowPathDistribution[a.supplyScopeAudit.selectedActualRowPath] = (s.actualInvestorRowPathDistribution[a.supplyScopeAudit.selectedActualRowPath] ?? 0) + 1;
  tallyKeys(s.actualInvestorRowFieldKeysTop, a.supplyScopeAudit.selectedActualRowFieldKeys);
  tallyKeys(s.actualInvestorNumericStringKeysTop, a.supplyScopeAudit.selectedActualNumericStringFieldKeys);
  tallyKeys(s.actualInvestorNumberKeysTop, a.supplyScopeAudit.selectedActualNumericFieldKeys);
  const breakPoint = a.supplyScopeAudit.semanticRowBreakPoint ?? 'UNKNOWN';
  s.semanticRowBreakPointDistribution[breakPoint] = (s.semanticRowBreakPointDistribution[breakPoint] ?? 0) + 1;
  if (a.supplyScopeAudit.foreignNetBuy !== null) s.foreignNetBuyAvailable += 1;
  if (a.supplyScopeAudit.institutionalNetBuy !== null) s.institutionalNetBuyAvailable += 1;
  const semanticReason = a.supplyScopeAudit.semanticReason ?? 'UNKNOWN';
  s.semanticReasonDistribution[semanticReason] = (s.semanticReasonDistribution[semanticReason] ?? 0) + 1;
  if (semanticReason === 'ZERO_BUT_MATERIALIZED') s.zeroButMaterializedCount += 1;
  const scoreUsageKey = a.supplyScopeAudit.scoreUsage ?? 'SHADOW_ONLY';
  s.scoreUsageDistribution[scoreUsageKey] = (s.scoreUsageDistribution[scoreUsageKey] ?? 0) + 1;
  if (a.supplyScopeAudit.wouldBeEligibleIfForeignOrInstitutionFieldMapped) s.shadowEligibleSupplyCount += 1;
}

function accFieldDiagnostics(s: SummaryAccumulatorState, a: Gate1MinimumSignalForensicAuditAdr0505): void {
  const fieldDiagnostics = a.supplyScopeAudit.fieldKeyDiagnostics;
  tallyKeys(s.kisRawFieldKeysTop, fieldDiagnostics?.kisRawFieldKeysTop);
  tallyKeys(s.actualRawFieldKeysTop, fieldDiagnostics?.actualRawFieldKeysTop);
  tallyKeys(s.actualNumericStringFieldKeysTop, fieldDiagnostics?.actualNumericStringFieldKeysTop);
  tallyKeys(s.actualNumberFieldKeysTop, fieldDiagnostics?.actualNumberFieldKeysTop);
  tallyKeys(s.actualPlaceholderFieldKeysTop, fieldDiagnostics?.actualPlaceholderFieldKeysTop);
  tallyKeys(s.candidateNetBuyFieldKeysTop, fieldDiagnostics?.candidateNetBuyFieldKeysTop);
  tallyKeys(s.selectedActualRawFieldKeysTop, fieldDiagnostics?.selectedActualRawFieldKeysTop);
  tallyKeys(s.selectedNumericStringFieldKeysTop, fieldDiagnostics?.selectedNumericStringFieldKeysTop);
  tallyKeys(s.rejectedWrapperPathsTop, fieldDiagnostics?.rejectedWrapperPathsTop);
  s.rowCandidateCount += fieldDiagnostics?.rowCandidateCount ?? 0;
  if (typeof fieldDiagnostics?.selectedRowScore === 'number') {
    s.selectedRowScoreSum += fieldDiagnostics.selectedRowScore;
    s.selectedRowScoreCount += 1;
  }
  s.wrapperOnlyCount += fieldDiagnostics?.wrapperOnlyCount ?? 0;
  s.numericCandidateCount += fieldDiagnostics?.numericCandidateCount ?? 0;
  s.aliasCandidateCount += fieldDiagnostics?.aliasCandidateCount ?? 0;
  if (fieldDiagnostics?.selectedPath) s.selectedPathTop[fieldDiagnostics.selectedPath] = (s.selectedPathTop[fieldDiagnostics.selectedPath] ?? 0) + 1;
  for (const key of fieldDiagnostics?.kisNormalizedFieldKeysTop ?? []) {
    s.kisNormalizedFieldKeysTop[key] = (s.kisNormalizedFieldKeysTop[key] ?? 0) + 1;
    s.kisSemanticFieldKeysTop[key] = (s.kisSemanticFieldKeysTop[key] ?? 0) + 1;
  }
  for (const [kind, count] of Object.entries(fieldDiagnostics?.sampleValueKinds ?? {})) {
    s.sampleValueKindDistribution[kind] = (s.sampleValueKindDistribution[kind] ?? 0) + Number(count);
  }
  tallyKeys(s.mappedFieldDistribution.foreign, fieldDiagnostics?.candidateMappedFields.foreign);
  tallyKeys(s.mappedFieldDistribution.institution, fieldDiagnostics?.candidateMappedFields.institution);
  tallyKeys(s.mappedFieldDistribution.individual, fieldDiagnostics?.candidateMappedFields.individual);
  if (a.penaltyComponents['SUPPLY_CONFLUENCE']?.weightedScore < 0) {
    const rootCause = resolveSupplyUnknownRootCause(a.supplyScopeAudit);
    s.supplyUnknownRootCauseDistribution[rootCause] = (s.supplyUnknownRootCauseDistribution[rootCause] ?? 0) + 1;
  }
}

function accWatchlistQuoteCondition(s: SummaryAccumulatorState, a: Gate1MinimumSignalForensicAuditAdr0505): void {
  if (a.hydrationAuditAdr0509?.watchlist.sourceAvailable) s.watchlistSourceAvailableCount += 1;
  if (a.hydrationAuditAdr0509?.watchlist.scoreImported) s.watchlistScoreImportedCount += 1;
  const watchlistField = a.hydrationAuditAdr0509?.watchlist.sourceField ?? 'none';
  s.watchlistSourceFieldDistribution[watchlistField] = (s.watchlistSourceFieldDistribution[watchlistField] ?? 0) + 1;
  const watchlistScale = a.hydrationAuditAdr0509?.watchlist.scoreScale ?? 'none';
  s.watchlistScoreScaleDistribution[watchlistScale] = (s.watchlistScoreScaleDistribution[watchlistScale] ?? 0) + 1;
  if (a.hydrationAuditAdr0509?.watchlist.scoreImported && typeof a.hydrationAuditAdr0509.watchlist.normalizedWatchlistScore === 'number') {
    s.watchlistScoreSum += a.hydrationAuditAdr0509.watchlist.normalizedWatchlistScore;
  }
  const watchlistMissingReason = a.hydrationAuditAdr0509?.watchlist.missingReason;
  if (watchlistMissingReason) s.watchlistMissingReasonCounts[watchlistMissingReason] = (s.watchlistMissingReasonCounts[watchlistMissingReason] ?? 0) + 1;
  if (!a.hydrationAuditAdr0509?.candidateTraceHasQuote) s.quoteMissingReasonCounts.QUOTE_MISSING = (s.quoteMissingReasonCounts.QUOTE_MISSING ?? 0) + 1;
  let candidateHasQuoteFeature = false;
  for (const field of Object.keys(s.quoteFeatureFieldCoverage)) {
    if (!a.hydrationAuditAdr0509?.rsMissingFields.includes(field) || !a.hydrationAuditAdr0509?.breakoutMissingFields.includes(field)) {
      s.quoteFeatureFieldCoverage[field] += 1;
      candidateHasQuoteFeature = true;
    }
  }
  if (candidateHasQuoteFeature) s.quoteFeatureAvailableCount += 1;
  for (const [key, value] of Object.entries(a.hydrationAuditAdr0509?.conditionKeyStatus ?? {})) {
    s.conditionResultsKeyCoverage[key] = (s.conditionResultsKeyCoverage[key] ?? 0) + 1;
    const status = value || 'DATA_UNAVAILABLE';
    s.conditionResultStatusDistribution[status] = (s.conditionResultStatusDistribution[status] ?? 0) + 1;
    if (key === 'relative_strength') s.rsConditionStatusDistribution[status] = (s.rsConditionStatusDistribution[status] ?? 0) + 1;
    if (BREAKOUT_CONDITION_KEYS.has(key)) s.breakoutConditionStatusDistribution[status] = (s.breakoutConditionStatusDistribution[status] ?? 0) + 1;
    s.conditionResultsAvailableCount += 1;
  }
  for (const key of a.hydrationAuditAdr0509?.breakoutConditionKeys ?? []) {
    s.breakoutConditionKeyCoverage[key] = (s.breakoutConditionKeyCoverage[key] ?? 0) + 1;
  }
}

function accHydrationSourceFields(s: SummaryAccumulatorState, a: Gate1MinimumSignalForensicAuditAdr0505): void {
  if (a.hydrationAuditAdr0509?.rsAvailable) s.rsHydrationAvailableCount += 1;
  if (a.hydrationAuditAdr0509?.breakoutAvailable) s.breakoutHydrationAvailableCount += 1;
  if (a.hydrationAuditAdr0509?.rsScoreUsable) s.rsScoreUsableCount += 1;
  if (a.hydrationAuditAdr0509?.breakoutScoreUsable) s.breakoutScoreUsableCount += 1;
  if (a.hydrationAuditAdr0509?.rsSource) s.rsSourceDistribution[a.hydrationAuditAdr0509.rsSource] += 1;
  if (a.hydrationAuditAdr0509?.breakoutSource) s.breakoutSourceDistribution[a.hydrationAuditAdr0509.breakoutSource] += 1;
  for (const reason of a.hydrationAuditAdr0509?.rsMissingReasons ?? []) s.rsMissingReasonDistribution[reason] += 1;
  for (const reason of a.hydrationAuditAdr0509?.breakoutMissingReasons ?? []) s.breakoutMissingReasonDistribution[reason] += 1;
  tallyKeys(s.hydrationMissingFieldCounts, a.hydrationAuditAdr0509?.missingFields);
  tallyKeys(s.rsMissingFieldCounts, a.hydrationAuditAdr0509?.rsMissingFields);
  tallyKeys(s.breakoutMissingFieldCounts, a.hydrationAuditAdr0509?.breakoutMissingFields);
  if (a.hydrationAuditAdr0509?.candidateTraceHasQuote) s.candidateTraceHasQuote += 1;
  if (a.hydrationAuditAdr0509?.candidateTraceHasSymbolFeatures) s.candidateTraceHasSymbolFeatures += 1;
  if (a.hydrationAuditAdr0509?.candidateTraceHasConditionResults) s.candidateTraceHasConditionResults += 1;
  if (a.conditionResultsBreakPoint === 'CONDITION_RESULTS_PROJECTED') s.computedTechnicalTraceCount += 1;
  if (a.sectorEnergyAudit.strongBuyAllowed === false) s.sectorEnergyStrongBuyBlockedCount += 1;
  // 사용자 명시 — SectorEnergy hardBlock 절대 금지. 본 카운터는 *항상* 0 이어야 함.
  if (a.sectorEnergyAudit.executionImpact === 'HARD_BLOCK') {
    s.sectorEnergyHardBlockCount += 1;
  }
}

/** 전체 audit 1건의 watchlist 정규화 / technical projection / supply-missing 누적 (line 632 루프 본문 SSOT). */
export function accumulateAllAudit(s: SummaryAccumulatorState, a: Gate1MinimumSignalForensicAuditAdr0505): void {
  const hydration = a.hydrationAuditAdr0509;
  const watchlist = hydration?.watchlist;
  const normalized = watchlist?.watchlistScoreNormalized ?? watchlist?.normalizedWatchlistScore;
  if (typeof normalized === 'number' && Number.isFinite(normalized)) s.watchlistScoreNormalized += 1;
  if (watchlist?.watchlistScoreMissing === true || watchlist?.scoreImported === false) s.watchlistScoreMissing += 1;
  if (watchlist?.watchlistScoreScaleFixed === true) s.watchlistScoreScaleFixed += 1;
  if (watchlist?.promotionScoreCopied === true) s.promotionScoreCopied += 1;
  bump(s.watchlistScoreScaleDistributionBefore, watchlist?.scoreScale ?? 'none');
  bump(s.watchlistScoreScaleDistributionAfter, watchlist?.scoreImported ? '0~100' : 'missing');
  bump(s.watchlistScoreNormalizationBreakPoint, watchlist?.watchlistScoreNormalizationBreakPoint ?? 'WATCHLIST_SCORE_MISSING');

  for (const [field, covered] of Object.entries(hydration?.technicalProjectionCoverage ?? {})) {
    if (covered) s.technicalProjectionCoverage[field] = (s.technicalProjectionCoverage[field] ?? 0) + 1;
  }
  if (hydration?.maAlignmentComputed) s.maAlignmentComputed += 1;
  if (hydration?.return5dAvailable) s.return5dAvailable += 1;
  if (hydration?.return20dAvailable) s.return20dAvailable += 1;
  bump(s.technicalProjectionBreakPoint, hydration?.technicalProjectionBreakPoint ?? 'TRACE_MISSING');
  if (hydration?.technicalProjectionBreakPoint === 'TECHNICAL_STATUS_COMPUTED_FIELD_MISSING') {
    s.technicalComputedButProjectionMissingCount += 1;
  }
  if (hydration?.maAlignmentPolicy?.advisoryOnly) s.maAlignmentAdvisoryOnlyCount += 1;
  if (hydration?.maAlignmentPolicy?.hardBlockReason === 'TECHNICAL_TREND_DEATH') s.technicalTrendDeathHardBlockCount += 1;
  bump(s.rsBreakPointDistribution, hydration?.rsBreakPoint ?? 'UNKNOWN');
  if (hydration?.rsComputedFromReturn20d) s.rsComputedFromReturn20dCount += 1;
  if (hydration?.rsIndexFallbackUsed) s.rsIndexFallbackUsedCount += 1;
  if (hydration?.rsTraceButScoreMissingBreakPoint) {
    bump(s.rsTraceButScoreMissingBreakPoint, hydration.rsTraceButScoreMissingBreakPoint);
  }

  if (a.supplyScopeAudit.supplyMissingNeutralized) {
    s.supplyMissingNeutralized += 1;
    bump(s.supplyMissingLearningTagDistribution, a.supplyScopeAudit.learningTag ?? 'CASE_SUPPLY_ROW_NOT_FOUND');
  }
}
