/**
 * @responsibility ADR-0505 summary aggregation builder.
 */

import type {
  MinimumSignalScoreTrace,
  SignalScoreComponentTrace,
  SignalScoreComponentCode,
  SignalScoreComponentConfidence,
} from '../minimumSignalScoreTrace.js';
import type {
  CandidateEntryTrace,
  SupplyConfluenceState,
  SupplyProviderHealthTrace,
} from '../entryFilterDecomposition.js';
import type { SectorEnergyExecutionImpactResult } from '../../../clients/sectorEnergyExecutionImpact.js';
import { resolveWatchlistUpstreamScore } from '../watchlistUpstreamScoreResolver.js';
import { conditionResultsTraceToMap, type GateConditionResultTrace } from '../gateConditionResultTrace.js';
import {
  evaluateInvestorFlowSemanticAvailabilityV2,
  extractFlatInvestorFlowRow,
  hasActualInvestorNumericRow,
  shouldEmitSupplySemanticWireDiagLog,
  type InvestorFlowSemanticAvailabilityReason,
  type InvestorFlowSemanticAvailabilityResult,
  type InvestorFlowFieldKeyDiscoveryDiagnostic,
  type SanitizedInvestorFlowSemanticRow,
} from '../../../supply/investorFlowSemanticAvailability.js';
import type { InvestorRowMaterializationClass } from '../investorFlowProviderRouterAdr0477.js';
import { shouldSuppressNoise, recordNoiseSuppressed } from '../../../utils/logger.js';
import type {
  DominantFailureReason,
  Gate1EvaluationState,
  Gate1ForensicTraceSourcePath,
  Gate1MinimumSignalForensicAuditAdr0505,
  Gate1MinimumSignalForensicSummaryAdr0505,
  HydrationMissingReason,
  RsHydrationSourceAdr0509,
  BreakoutHydrationSourceAdr0509,
  SellOnlyCarryBreakPointAdr0507,
  SupplyScopeWarning,
  WatchlistBreakPointAdr0510,
  QuoteHydrationBreakPointAdr0510,
  ConditionResultsBreakPointAdr0510,
} from './types.js';
import { resolveGate1EvaluationStateAdr0510 } from './auditBuilder.js';
import {
  accumulateAllAudit,
  accumulateFailedAudit,
  resolveRouterForensicConflictReason,
  resolveWatchlistConflictReason,
  type SummaryAccumulatorState,
} from './summaryAccumulators.js';
import {
  buildDiagnosticPenaltyBreakdown,
  classifyTechnicalTrendMissing,
  emptyTechnicalTrendMissingClassification,
} from '../../sourceSnapshot/sourceSnapshotDataHealth.js';
import type { TechnicalTrendMissingReason } from '../../sourceSnapshot/sourceSnapshotDataHealth.js';

const EMPTY_HYDRATION_REASON_DISTRIBUTION: Record<HydrationMissingReason, number> = {
  CANDIDATE_TRACE_MISSING: 0,
  FIELD_MISSING: 0,
  QUOTE_MISSING: 0,
  SYMBOL_FEATURES_MISSING: 0,
  CONDITION_RESULTS_MISSING: 0,
};

/* ───────── sectorEnergyAudit SSOT ───────── */

const EMPTY_DOMINANT_DISTRIBUTION: Record<DominantFailureReason, number> = {
  POSITIVE_SCORE_STARVATION: 0,
  WATCHLIST_SCORE_NOT_IMPORTED: 0,
  RELATIVE_STRENGTH_SOURCE_MISSING: 0,
  BREAKOUT_STRUCTURE_SOURCE_MISSING: 0,
  SUPPLY_PROVIDER_UNKNOWN_PENALTY: 0,
  INVESTOR_FLOW_UNKNOWN_PENALTY: 0,
  SECTOR_ENERGY_DIAGNOSTIC_PENALTY: 0,
  SCORE_CEILING_BELOW_THRESHOLD: 0,
  POSITIVE_SIGNAL_BELOW_THRESHOLD: 0,
  MIXED: 0,
  UNKNOWN: 0,
};

const EMPTY_SUPPLY_SCOPE_WARNINGS: Record<SupplyScopeWarning, number> = {
  NONE: 0,
  KIS_FLOW_SYMBOL_MISMATCH: 0,
  KIS_FLOW_SYMBOL_MISSING: 0,
  KIS_FLOW_SEMANTIC_UNAVAILABLE: 0,
  POSSIBLE_MARKET_WIDE_FLOW_IN_SYMBOL_SLOT: 0,
};

const EMPTY_SEMANTIC_REASON_DISTRIBUTION: Record<InvestorFlowSemanticAvailabilityReason, number> = {
  AVAILABLE: 0,
  NO_FOREIGN_OR_INSTITUTION_FIELD: 0,
  SEMANTIC_ROW_METADATA_ONLY: 0,
  FIELD_ALIAS_NOT_MAPPED: 0,
  ONLY_WRAPPER_OBJECT_SELECTED: 0,
  NO_ACTUAL_ROW_FOUND: 0,
  ACTUAL_INVESTOR_ROW_NOT_CARRIED: 0,
  NO_NUMERIC_INVESTOR_FIELD_FOUND: 0,
  DEEP_UNWRAP_NO_NUMERIC_FIELDS: 0,
  NUMERIC_FIELDS_FOUND_BUT_ALIAS_UNKNOWN: 0,
  ALIAS_MAPPED_FOREIGN_ONLY: 0,
  ALIAS_MAPPED_INSTITUTION_ONLY: 0,
  ALIAS_MAPPED_BOTH: 0,
  INVESTOR_TYPE_ROW_MAPPING_FAILED: 0,
  RAW_INVESTOR_ROW_MISSING: 0,
  ROUTER_DROPPED_SEMANTIC_ROW: 0,
  FORENSIC_INPUT_DROPPED_SEMANTIC_ROW: 0,
  DIAGNOSTIC_SKIPPED_PSEUDO_SYMBOL: 0,
  SYMBOL_NOT_MATCHED: 0,
  PROVIDER_SCOPE_NOT_SYMBOL_LEVEL: 0,
  ONLY_MARKET_LEVEL_FLOW: 0,
  ONLY_SECTOR_LEVEL_FLOW: 0,
  PLACEHOLDER_ONLY: 0,
  STALE_ONLY: 0,
  ZERO_BUT_MATERIALIZED: 0,
  ROW_MAPPING_FAILED: 0,
  UNKNOWN: 0,
};

const TECHNICAL_FIELD_PATTERN = /ma20|ma60|rsi|atr|technical|indicator/i;

function hasTechnicalTrendMissing(a: Gate1MinimumSignalForensicAuditAdr0505): boolean {
  return a.missingPositiveSources.includes('TECHNICAL_TREND_MISSING');
}

function classifyAuditTechnicalTrendMissing(a: Gate1MinimumSignalForensicAuditAdr0505): TechnicalTrendMissingReason {
  const hydration = a.hydrationAuditAdr0509;
  const missingFields = [
    ...(hydration?.missingFields ?? []),
    ...(hydration?.rsMissingFields ?? []),
    ...(hydration?.breakoutMissingFields ?? []),
  ];
  const technicalFieldMissing = missingFields.some((field) => TECHNICAL_FIELD_PATTERN.test(field));
  const indicatorComputed = hydration?.breakoutSource === 'QUOTE_OHLCV'
    || hydration?.breakoutSource === 'SYMBOL_FEATURES'
    || hydration?.rsSource === 'SYMBOL_FEATURES'
    || hydration?.candidateTraceHasConditionResults === true && hydration?.conditionKeyStatus != null;
  const featureSnapshotPresent = hydration?.candidateTraceHasSymbolFeatures === true;
  const gateMappingPresent = hydration?.breakoutAvailable === true || hydration?.rsAvailable === true;

  return classifyTechnicalTrendMissing({
    quoteVerified: hydration?.candidateTraceHasQuote === true,
    ohlcvFetched: hydration?.breakoutSource === 'QUOTE_OHLCV' || featureSnapshotPresent,
    indicatorComputed,
    featureSnapshotPresent,
    gateMappingPresent,
    fieldPathMismatch: technicalFieldMissing && featureSnapshotPresent && hydration?.candidateTraceHasConditionResults === true,
  });
}

function buildDominantFailureDistribution(failed: ReadonlyArray<Gate1MinimumSignalForensicAuditAdr0505>): Record<DominantFailureReason, number> {
  const dominantFailureDistribution = { ...EMPTY_DOMINANT_DISTRIBUTION };
  for (const a of failed) {
    dominantFailureDistribution[a.dominantFailureReason] += 1;
  }
  return dominantFailureDistribution;
}

function buildMissingPositiveSourceCounts(failed: ReadonlyArray<Gate1MinimumSignalForensicAuditAdr0505>) {
  const missingPositiveSourceCounts = {
    watchlistUpstreamMissing: 0,
    relativeStrengthMissing: 0,
    breakoutStructureMissing: 0,
    priceMomentumMissing: 0,
    technicalTrendMissing: 0,
    volumeLiquidityMissing: 0,
  };
  for (const a of failed) {
    for (const m of a.missingPositiveSources) {
      switch (m) {
        case 'WATCHLIST_UPSTREAM_SCORE_MISSING':
          missingPositiveSourceCounts.watchlistUpstreamMissing += 1;
          break;
        case 'RELATIVE_STRENGTH_MISSING':
          missingPositiveSourceCounts.relativeStrengthMissing += 1;
          break;
        case 'BREAKOUT_STRUCTURE_MISSING':
          missingPositiveSourceCounts.breakoutStructureMissing += 1;
          break;
        case 'PRICE_MOMENTUM_MISSING':
          missingPositiveSourceCounts.priceMomentumMissing += 1;
          break;
        case 'TECHNICAL_TREND_MISSING':
          missingPositiveSourceCounts.technicalTrendMissing += 1;
          break;
        case 'VOLUME_LIQUIDITY_MISSING':
          missingPositiveSourceCounts.volumeLiquidityMissing += 1;
          break;
      }
    }
  }
  return missingPositiveSourceCounts;
}

function buildTechnicalTrendMissing(failed: ReadonlyArray<Gate1MinimumSignalForensicAuditAdr0505>) {
  const technicalTrendMissing = emptyTechnicalTrendMissingClassification();
  for (const a of failed) {
    if (!hasTechnicalTrendMissing(a)) continue;
    technicalTrendMissing.total += 1;
    const reason = classifyAuditTechnicalTrendMissing(a);
    technicalTrendMissing.reasons[reason] += 1;
  }
  return technicalTrendMissing;
}

function buildPenaltyCounts(failed: ReadonlyArray<Gate1MinimumSignalForensicAuditAdr0505>) {
  const penaltyCounts = {
    supplyUnknownPenalty: 0,
    investorFlowUnknownPenalty: 0,
    sectorEnergyPenaltyOrBlocked: 0,
    unknownDataPenalty: 0,
    softFailPenalty: 0,
    riskPenalty: 0,
  };
  for (const a of failed) {
    if (a.penaltyComponents['SUPPLY_CONFLUENCE']?.weightedScore < 0) penaltyCounts.supplyUnknownPenalty += 1;
    if (a.penaltyComponents['INVESTOR_FLOW']?.weightedScore < 0) penaltyCounts.investorFlowUnknownPenalty += 1;
    if (
      a.penaltyComponents['SECTOR_ENERGY']?.weightedScore < 0 ||
      a.sectorEnergyAudit.strongBuyAllowed === false
    ) {
      penaltyCounts.sectorEnergyPenaltyOrBlocked += 1;
    }
    if (a.penaltyComponents['UNKNOWN_DATA_PENALTY']) penaltyCounts.unknownDataPenalty += 1;
    if (a.penaltyComponents['SOFT_FAIL_PENALTY']) {
      const technicalReason = hasTechnicalTrendMissing(a) ? classifyAuditTechnicalTrendMissing(a) : null;
      if (!technicalReason || technicalReason === 'REAL_TECH_DATA_MISSING') penaltyCounts.softFailPenalty += 1;
    }
    if (a.penaltyComponents['RISK_PENALTY']) penaltyCounts.riskPenalty += 1;
  }
  return penaltyCounts;
}

export function buildGate1MinimumSignalForensicSummaryAdr0505(
  audits: ReadonlyArray<Gate1MinimumSignalForensicAuditAdr0505>,
): Gate1MinimumSignalForensicSummaryAdr0505 {
  const totalCandidates = audits.length;
  const failed = audits.filter((a) => !a.passed);
  const failedCandidates = failed.length;

  // 평균 계산 — 0건 시 0 fallback (NaN 차단)
  const requiredScoreAvg =
    totalCandidates > 0
      ? audits.reduce((sum, a) => sum + a.requiredScore, 0) / totalCandidates
      : 0;
  const actualScoreAvg =
    totalCandidates > 0 ? audits.reduce((sum, a) => sum + a.actualScore, 0) / totalCandidates : 0;
  const avgScoreGap =
    totalCandidates > 0 ? audits.reduce((sum, a) => sum + a.scoreGap, 0) / totalCandidates : 0;

  // 분포 집계 (failed only)
  const dominantFailureDistribution = buildDominantFailureDistribution(failed);
  const missingPositiveSourceCounts = buildMissingPositiveSourceCounts(failed);
  const technicalTrendMissing = buildTechnicalTrendMissing(failed);
  const penaltyCounts = buildPenaltyCounts(failed);
  const diagnosticPenaltyBreakdown = buildDiagnosticPenaltyBreakdown(technicalTrendMissing);
  diagnosticPenaltyBreakdown.softFailPenalty += Math.max(0, penaltyCounts.softFailPenalty - diagnosticPenaltyBreakdown.softFailPenalty);

  const state: SummaryAccumulatorState = {
    supplyScopeWarnings: { ...EMPTY_SUPPLY_SCOPE_WARNINGS },
    supplySymbolMatchedCount: 0,
    inferredSymbolMatchedCount: 0,
    candidateSymbolAvailableCount: 0,
    quoteSymbolAvailableCount: 0,
    requestSymbolAvailableCount: 0,
    providerSymbolAvailableCount: 0,
    symbolMissingCount: 0,
    symbolMismatchCount: 0,
    providerScopeDistribution: {},
    semanticReasonDistribution: { ...EMPTY_SEMANTIC_REASON_DISTRIBUTION },
    scoreUsageDistribution: {},
    supplyUnknownRootCauseDistribution: {},
    kisRawFieldKeysTop: {},
    actualRawFieldKeysTop: {},
    actualNumericStringFieldKeysTop: {},
    actualNumberFieldKeysTop: {},
    actualPlaceholderFieldKeysTop: {},
    candidateNetBuyFieldKeysTop: {},
    selectedActualRawFieldKeysTop: {},
    selectedNumericStringFieldKeysTop: {},
    rejectedWrapperPathsTop: {},
    rowCandidateCount: 0,
    selectedRowScoreSum: 0,
    selectedRowScoreCount: 0,
    wrapperOnlyCount: 0,
    numericCandidateCount: 0,
    aliasCandidateCount: 0,
    selectedPathTop: {},
    kisNormalizedFieldKeysTop: {},
    kisSemanticFieldKeysTop: {},
    semanticRowBreakPointDistribution: {},
    semanticRowAvailableCount: 0,
    semanticRowMetadataOnlyCount: 0,
    rawInvestorRowAvailableCount: 0,
    adapterRowsForwardedAcrossProvidersCount: 0,
    diagnosticActualInvestorRowCarriedCount: 0,
    selectedProviderActualRowCount: 0,
    diagnosticOnlyActualRowCount: 0,
    actualInvestorRowProviderDistribution: {},
    actualInvestorRowUseScopeDistribution: {},
    kisNormalizedRowsMaterialized: 0,
    kisSemanticRowsMaterialized: 0,
    normalizedRowsPromotedToDiagnosticActualRow: 0,
    normalizedMetadataOnlyRows: 0,
    semanticMetadataOnlyRows: 0,
    bySymbolDiagnosticActualRowFromNormalized: 0,
    sellOnlyBySymbolPayloadFromNormalized: 0,
    semanticFromNormalizedActualRow: 0,
    investorRowMaterializationClassDistribution: {},
    selectedCandidateCarriesSemanticRowCount: 0,
    selectedCandidateCarriesActualRowCount: 0,
    forensicInputCarriesSemanticRowCount: 0,
    forensicInputCarriesActualInvestorRowsCount: 0,
    actualInvestorRowPathDistribution: {},
    actualInvestorRowFieldKeysTop: {},
    actualInvestorNumericStringKeysTop: {},
    actualInvestorNumberKeysTop: {},
    sampleValueKindDistribution: {},
    mappedFieldDistribution: { foreign: {}, institution: {}, individual: {} },
    supplySemanticAvailable: 0,
    supplyDiagnosticAvailable: 0,
    foreignNetBuyAvailable: 0,
    institutionalNetBuyAvailable: 0,
    zeroButMaterializedCount: 0,
    shadowEligibleSupplyCount: 0,
    rsHydrationAvailableCount: 0,
    breakoutHydrationAvailableCount: 0,
    rsMissingReasonDistribution: { ...EMPTY_HYDRATION_REASON_DISTRIBUTION },
    breakoutMissingReasonDistribution: { ...EMPTY_HYDRATION_REASON_DISTRIBUTION },
    hydrationMissingFieldCounts: {},
    rsMissingFieldCounts: {},
    breakoutMissingFieldCounts: {},
    watchlistSourceFieldDistribution: {},
    watchlistMissingReasonCounts: {},
    watchlistScoreScaleDistribution: {},
    watchlistScoreSum: 0,
    quoteMissingReasonCounts: {},
    quoteFeatureFieldCoverage: { return5d: 0, return20d: 0, high5d: 0, high20d: 0, volume: 0, avgVolume: 0, ma20: 0, ma60: 0 },
    quoteFeatureAvailableCount: 0,
    conditionResultsKeyCoverage: {},
    conditionResultStatusDistribution: { FIRED: 0, DATA_UNAVAILABLE: 0, THRESHOLD_NOT_MET: 0, PROVIDER_DEGRADED: 0, ERROR: 0 },
    rsConditionStatusDistribution: {},
    breakoutConditionStatusDistribution: {},
    conditionResultsAvailableCount: 0,
    breakoutConditionKeyCoverage: {},
    rsSourceDistribution: {
      QUOTE_RETURN: 0,
      SYMBOL_FEATURES: 0,
      CONDITION_RESULTS: 0,
      EXPLICIT_RELATIVE_RETURN: 0,
      WATCHLIST_PROXY: 0,
      MISSING: 0,
    },
    breakoutSourceDistribution: {
      QUOTE_OHLCV: 0,
      SYMBOL_FEATURES: 0,
      CONDITION_RESULTS: 0,
      CONDITION_KEYS: 0,
      WATCHLIST_REASON_PROXY: 0,
      MISSING: 0,
    },
    watchlistSourceAvailableCount: 0,
    watchlistScoreImportedCount: 0,
    rsScoreUsableCount: 0,
    breakoutScoreUsableCount: 0,
    candidateTraceHasQuote: 0,
    candidateTraceHasSymbolFeatures: 0,
    candidateTraceHasConditionResults: 0,
    computedTechnicalTraceCount: 0,
    sourcePathDistribution: {
      ENTRY_FILTER_GATE1_CANDIDATE_TRACE: 0,
      ENTRY_FILTER_CANDIDATE_TRACE: 0,
      WATCHLIST_CANDIDATE: 0,
      PREFLIGHT_UNIVERSE_SNAPSHOT: 0,
      SELL_ONLY_DIAGNOSTIC_SNAPSHOT: 0,
      UNKNOWN: 0,
    },
    sourcePathWithWatchlistScore: {
      ENTRY_FILTER_GATE1_CANDIDATE_TRACE: 0,
      ENTRY_FILTER_CANDIDATE_TRACE: 0,
      WATCHLIST_CANDIDATE: 0,
      PREFLIGHT_UNIVERSE_SNAPSHOT: 0,
      SELL_ONLY_DIAGNOSTIC_SNAPSHOT: 0,
      UNKNOWN: 0,
    },
    sourcePathWithQuote: {
      ENTRY_FILTER_GATE1_CANDIDATE_TRACE: 0,
      ENTRY_FILTER_CANDIDATE_TRACE: 0,
      WATCHLIST_CANDIDATE: 0,
      PREFLIGHT_UNIVERSE_SNAPSHOT: 0,
      SELL_ONLY_DIAGNOSTIC_SNAPSHOT: 0,
      UNKNOWN: 0,
    },
    sourcePathWithConditionResults: {
      ENTRY_FILTER_GATE1_CANDIDATE_TRACE: 0,
      ENTRY_FILTER_CANDIDATE_TRACE: 0,
      WATCHLIST_CANDIDATE: 0,
      PREFLIGHT_UNIVERSE_SNAPSHOT: 0,
      SELL_ONLY_DIAGNOSTIC_SNAPSHOT: 0,
      UNKNOWN: 0,
    },
    sellOnlyCarryBreakPointDistribution: {
      BYSYMBOL_PAYLOAD_MISSING: 0,
      BYSYMBOL_PAYLOAD_STALE: 0,
      BYSYMBOL_PAYLOAD_FOUND_NOT_MERGED: 0,
      BYSYMBOL_PAYLOAD_MERGED_BUT_FORENSIC_DROPPED: 0,
      MERGED_BUT_FORENSIC_DROPPED: 0,
      PSEUDO_SYMBOL_NOT_RESOLVED: 0,
      CARRIED_TO_FORENSIC: 0,
      UNKNOWN: 0,
    },
    sellOnlyBySymbolPayloadAvailableCount: 0,
    sellOnlyBySymbolPayloadMergedCount: 0,
    sellOnlyActualRowsCarriedCount: 0,
    sourcePathMissingFieldCounts: {},
    watchlistBreakPointDistribution: {
      WATCHLIST_ENTRY_MISSING_SCORE: 0,
      STAGE2_SCORE_NOT_COPIED: 0,
      PROMOTION_SCORE_NOT_COPIED: 0,
      ENTRY_FILTER_TRACE_MISSING_SCORE: 0,
      FORENSIC_INPUT_MISSING_SCORE: 0,
      SOURCE_FIELD_NONE: 0,
      UNKNOWN: 0,
    },
    quoteHydrationBreakPointDistribution: {
      QUOTE_NOT_FETCHED: 0,
      QUOTE_FETCHED_NOT_COPIED: 0,
      SAFE_QUOTE_FEATURES_NOT_BUILT: 0,
      SELL_ONLY_SKIPPED_QUOTE_EVALUATION: 0,
      PRECHECK_ONLY_TRACE: 0,
      UNKNOWN: 0,
    },
    conditionResultsBreakPointDistribution: {
      NONE: 0,
      CONDITION_RESULTS_PROJECTED: 0,
      CONDITION_RESULTS_SKELETON_ONLY: 0,
      EVALUATE_SERVER_GATE_NOT_CALLED: 0,
      GATE_OUTPUTS_NOT_COPIED: 0,
      CONDITION_RESULTS_NOT_PROJECTED: 0,
      SELL_ONLY_SKIPPED_GATE_EVALUATION: 0,
      PRECHECK_ONLY_TRACE: 0,
      UNKNOWN: 0,
    },
    watchlistEntryScoreAvailable: 0,
    stage2ScoreAvailable: 0,
    promotionScoreAvailable: 0,
    entryFilterTraceScoreAvailable: 0,
    forensicInputScoreAvailable: 0,
    sectorEnergyStrongBuyBlockedCount: 0,
    sectorEnergyHardBlockCount: 0,
    watchlistScoreNormalized: 0,
    watchlistScoreMissing: 0,
    watchlistScoreScaleFixed: 0,
    promotionScoreCopied: 0,
    watchlistScoreScaleDistributionBefore: {},
    watchlistScoreScaleDistributionAfter: {},
    watchlistScoreNormalizationBreakPoint: {},
    technicalProjectionCoverage: {
      aboveMA20: 0,
      aboveMA60: 0,
      maAlignmentStatus: 0,
      return5d: 0,
      return20d: 0,
      rsUsable: 0,
      breakoutUsable: 0,
    },
    maAlignmentComputed: 0,
    return5dAvailable: 0,
    return20dAvailable: 0,
    technicalComputedButProjectionMissingCount: 0,
    technicalProjectionBreakPoint: {},
    maAlignmentAdvisoryOnlyCount: 0,
    technicalTrendDeathHardBlockCount: 0,
    rsBreakPointDistribution: {},
    rsComputedFromReturn20dCount: 0,
    rsIndexFallbackUsedCount: 0,
    rsTraceButScoreMissingBreakPoint: {},
    supplyMissingNeutralized: 0,
    supplyMissingLearningTagDistribution: {},
  };

  for (const a of failed) accumulateFailedAudit(state, a);
  for (const a of audits) accumulateAllAudit(state, a);

  const {
    supplyScopeWarnings,
    supplySymbolMatchedCount,
    inferredSymbolMatchedCount,
    candidateSymbolAvailableCount,
    quoteSymbolAvailableCount,
    requestSymbolAvailableCount,
    providerSymbolAvailableCount,
    symbolMissingCount,
    symbolMismatchCount,
    providerScopeDistribution,
    semanticReasonDistribution,
    scoreUsageDistribution,
    supplyUnknownRootCauseDistribution,
    kisRawFieldKeysTop,
    actualRawFieldKeysTop,
    actualNumericStringFieldKeysTop,
    actualNumberFieldKeysTop,
    actualPlaceholderFieldKeysTop,
    candidateNetBuyFieldKeysTop,
    selectedActualRawFieldKeysTop,
    selectedNumericStringFieldKeysTop,
    rejectedWrapperPathsTop,
    rowCandidateCount,
    selectedRowScoreSum,
    selectedRowScoreCount,
    wrapperOnlyCount,
    numericCandidateCount,
    aliasCandidateCount,
    selectedPathTop,
    kisNormalizedFieldKeysTop,
    kisSemanticFieldKeysTop,
    semanticRowBreakPointDistribution,
    semanticRowAvailableCount,
    semanticRowMetadataOnlyCount,
    rawInvestorRowAvailableCount,
    adapterRowsForwardedAcrossProvidersCount,
    diagnosticActualInvestorRowCarriedCount,
    selectedProviderActualRowCount,
    diagnosticOnlyActualRowCount,
    actualInvestorRowProviderDistribution,
    actualInvestorRowUseScopeDistribution,
    kisNormalizedRowsMaterialized,
    kisSemanticRowsMaterialized,
    normalizedRowsPromotedToDiagnosticActualRow,
    normalizedMetadataOnlyRows,
    semanticMetadataOnlyRows,
    bySymbolDiagnosticActualRowFromNormalized,
    sellOnlyBySymbolPayloadFromNormalized,
    semanticFromNormalizedActualRow,
    investorRowMaterializationClassDistribution,
    selectedCandidateCarriesSemanticRowCount,
    selectedCandidateCarriesActualRowCount,
    forensicInputCarriesSemanticRowCount,
    forensicInputCarriesActualInvestorRowsCount,
    actualInvestorRowPathDistribution,
    actualInvestorRowFieldKeysTop,
    actualInvestorNumericStringKeysTop,
    actualInvestorNumberKeysTop,
    sampleValueKindDistribution,
    mappedFieldDistribution,
    supplySemanticAvailable,
    supplyDiagnosticAvailable,
    foreignNetBuyAvailable,
    institutionalNetBuyAvailable,
    zeroButMaterializedCount,
    shadowEligibleSupplyCount,
    rsHydrationAvailableCount,
    breakoutHydrationAvailableCount,
    rsMissingReasonDistribution,
    breakoutMissingReasonDistribution,
    hydrationMissingFieldCounts,
    rsMissingFieldCounts,
    breakoutMissingFieldCounts,
    watchlistSourceFieldDistribution,
    watchlistMissingReasonCounts,
    watchlistScoreScaleDistribution,
    watchlistScoreSum,
    quoteMissingReasonCounts,
    quoteFeatureFieldCoverage,
    quoteFeatureAvailableCount,
    conditionResultsKeyCoverage,
    conditionResultStatusDistribution,
    rsConditionStatusDistribution,
    breakoutConditionStatusDistribution,
    conditionResultsAvailableCount,
    breakoutConditionKeyCoverage,
    rsSourceDistribution,
    breakoutSourceDistribution,
    watchlistSourceAvailableCount,
    watchlistScoreImportedCount,
    candidateTraceHasQuote,
    candidateTraceHasSymbolFeatures,
    candidateTraceHasConditionResults,
    computedTechnicalTraceCount,
    sourcePathDistribution,
    sourcePathWithWatchlistScore,
    sourcePathWithQuote,
    sourcePathWithConditionResults,
    sellOnlyCarryBreakPointDistribution,
    sellOnlyBySymbolPayloadAvailableCount,
    sellOnlyBySymbolPayloadMergedCount,
    sellOnlyActualRowsCarriedCount,
    sourcePathMissingFieldCounts,
    watchlistBreakPointDistribution,
    quoteHydrationBreakPointDistribution,
    conditionResultsBreakPointDistribution,
    watchlistEntryScoreAvailable,
    stage2ScoreAvailable,
    promotionScoreAvailable,
    entryFilterTraceScoreAvailable,
    forensicInputScoreAvailable,
    sectorEnergyStrongBuyBlockedCount,
    sectorEnergyHardBlockCount,
    watchlistScoreNormalized,
    watchlistScoreMissing,
    watchlistScoreScaleFixed,
    promotionScoreCopied,
    watchlistScoreScaleDistributionBefore,
    watchlistScoreScaleDistributionAfter,
    watchlistScoreNormalizationBreakPoint,
    technicalProjectionCoverage,
    maAlignmentComputed,
    return5dAvailable,
    return20dAvailable,
    technicalComputedButProjectionMissingCount,
    technicalProjectionBreakPoint,
    maAlignmentAdvisoryOnlyCount,
    technicalTrendDeathHardBlockCount,
    rsBreakPointDistribution,
    rsComputedFromReturn20dCount,
    rsIndexFallbackUsedCount,
    rsTraceButScoreMissingBreakPoint,
    supplyMissingNeutralized,
    supplyMissingLearningTagDistribution,
  } = state;

  return {
    totalCandidates,
    failedCandidates,
    evaluationState: resolveGate1EvaluationStateAdr0510({
      totalCandidates,
      traceWithQuoteCount: candidateTraceHasQuote,
      traceWithSymbolFeaturesCount: candidateTraceHasSymbolFeatures,
      traceWithConditionResultsCount: totalCandidates,
    candidateTraceContainerCount: totalCandidates,
    conditionResultsContainerCount: totalCandidates,
    computedTechnicalTraceCount,
      minSignalScoreTraceAvailableCount: totalCandidates,
      buyListLoopEntered: totalCandidates > 0,
      gateEvaluationOutputAvailableCount: totalCandidates,
    }),
    evaluatedCandidateCount: totalCandidates,
    traceOnlyCandidateCount: Math.max(0, totalCandidates - candidateTraceHasConditionResults),
    buyListLoopEntered: totalCandidates > 0,
    perSymbolEvaluationEntered: totalCandidates > 0,
    gateEvaluationOutputAvailableCount: totalCandidates,
    minSignalScoreTraceAvailableCount: totalCandidates,
    requiredScoreAvg: round1(requiredScoreAvg),
    actualScoreAvg: round1(actualScoreAvg),
    avgScoreGap: round1(avgScoreGap),
    dominantFailureDistribution,
    missingPositiveSourceCounts,
    penaltyCounts,
    technicalTrendMissing,
    diagnosticPenaltyBreakdown,
    supplyScopeWarnings,
    supplySymbolMatchedCount,
    rsHydrationAvailableCount,
    breakoutHydrationAvailableCount,
    rsMissingReasonDistribution,
    breakoutMissingReasonDistribution,
    topHydrationMissingFields: Object.entries(hydrationMissingFieldCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([field]) => field),
    candidateTraceHasQuote,
    candidateTraceHasSymbolFeatures,
    candidateTraceHasConditionResults,
    watchlistSourceAvailableCount: audits.filter((a) => a.hydrationAuditAdr0509?.watchlist.sourceAvailable).length,
    watchlistSourceFieldDistribution,
    watchlistScoreImportedCount: audits.filter((a) => a.hydrationAuditAdr0509?.watchlist.scoreImported).length,
    watchlistMissingReasonTop: Object.entries(watchlistMissingReasonCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([reason]) => reason),
    rsTraceAvailableCount: audits.filter((a) => a.hydrationAuditAdr0509?.rsAvailable).length,
    rsScoreUsableCount: audits.filter((a) => a.hydrationAuditAdr0509?.rsScoreUsable).length,
    rsMissingFieldsTop: Object.entries(rsMissingFieldCounts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([field]) => field),
    rsSourceDistribution,
    rsConditionStatusDistribution,
    breakoutTraceAvailableCount: audits.filter((a) => a.hydrationAuditAdr0509?.breakoutAvailable).length,
    breakoutScoreUsableCount: audits.filter((a) => a.hydrationAuditAdr0509?.breakoutScoreUsable).length,
    breakoutMissingFieldsTop: Object.entries(breakoutMissingFieldCounts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([field]) => field),
    breakoutSourceDistribution,
    technicalProjectionCoverage,
    technicalProjectedCount: technicalProjectionBreakPoint.PROJECTED ?? 0,
    maAlignmentComputed,
    maAlignmentComputedCount: maAlignmentComputed,
    aboveMA20AvailableCount: technicalProjectionCoverage.aboveMA20 ?? 0,
    aboveMA60AvailableCount: technicalProjectionCoverage.aboveMA60 ?? 0,
    return5dAvailable,
    return5dAvailableCount: return5dAvailable,
    return20dAvailable,
    return20dAvailableCount: return20dAvailable,
    technicalComputedButProjectionMissingCount,
    technicalProjectionBreakPoint,
    technicalProjectionBreakPointDistribution: technicalProjectionBreakPoint,
    maAlignmentAdvisoryOnlyCount,
    maAlignmentDampenerCount: maAlignmentAdvisoryOnlyCount,
    maAlignmentHardBlockCount: technicalTrendDeathHardBlockCount,
    technicalTrendDeathHardBlockCount,
    technicalTrendDeathCount: technicalTrendDeathHardBlockCount,
    maAlignmentPolicy: 'ADVISORY_DAMPENER',
    topGate1BlockReasonAfter: technicalTrendDeathHardBlockCount > 0 ? 'TECHNICAL_TREND_DEATH' : 'TECHNICAL_MA_ALIGNMENT_DAMPENER',
    rsBreakPointDistribution,
    rsComputedFromReturn20dCount,
    rsIndexFallbackUsedCount,
    rsTraceButScoreMissingBreakPoint,
    breakoutAdvisoryOnly: true,
    breakoutUsedForGate1Block: false,
    breakoutConditionStatusDistribution,
    candidateSymbolAvailableCount,
    quoteSymbolAvailableCount,
    requestSymbolAvailableCount,
    providerSymbolAvailableCount,
    symbolMatchedCount: supplySymbolMatchedCount,
    inferredSymbolMatchedCount,
    symbolMissingCount,
    symbolMismatchCount,
    providerScopeDistribution,
    scoreUsage: 'SHADOW_ONLY',
    supplySemanticAvailable,
    supplyDiagnosticAvailable,
    semanticReasonDistribution,
    foreignNetBuyAvailable,
    institutionalNetBuyAvailable,
    zeroButMaterializedCount,
    kisRawFieldKeysTop,
    actualRawFieldKeysTop,
    actualNumericStringFieldKeysTop,
    actualNumberFieldKeysTop,
    actualPlaceholderFieldKeysTop,
    candidateNetBuyFieldKeysTop,
    selectedActualRawFieldKeysTop,
    selectedNumericStringFieldKeysTop,
    rejectedWrapperPathsTop,
    rowCandidateCount,
    selectedRowScoreAvg: selectedRowScoreCount > 0 ? selectedRowScoreSum / selectedRowScoreCount : 0,
    wrapperOnlyCount,
    numericCandidateCount,
    aliasCandidateCount,
    selectedPathTop,
    kisNormalizedFieldKeysTop,
    kisSemanticFieldKeysTop,
    semanticRowAvailableCount,
    semanticRowMetadataOnlyCount,
    rawInvestorRowAvailableCount,
    adapterRowsForwardedAcrossProvidersCount,
    diagnosticActualInvestorRowCarriedCount,
    selectedProviderActualRowCount,
    diagnosticOnlyActualRowCount,
    actualInvestorRowProviderDistribution,
    actualInvestorRowUseScopeDistribution,
    kisNormalizedRowsMaterialized,
    kisSemanticRowsMaterialized,
    normalizedRowsPromotedToDiagnosticActualRow,
    normalizedMetadataOnlyRows,
    semanticMetadataOnlyRows,
    bySymbolDiagnosticActualRowFromNormalized,
    sellOnlyBySymbolPayloadFromNormalized,
    semanticFromNormalizedActualRow,
    investorRowMaterializationClassDistribution,
    selectedCandidateCarriesSemanticRowCount,
    selectedCandidateCarriesActualRowCount,
    forensicInputCarriesSemanticRowCount,
    forensicInputCarriesActualInvestorRowsCount,
    actualInvestorRowPathDistribution,
    actualInvestorRowFieldKeysTop,
    actualInvestorNumericStringKeysTop,
    actualInvestorNumberKeysTop,
    semanticRowBreakPointDistribution,
    sampleValueKindDistribution,
    mappedFieldDistribution,
    scoreUsageDistribution,
    supplyUnknownRootCauseDistribution,
    supplyRouterForensicConflict: supplyDiagnosticAvailable > 0 && supplySemanticAvailable === 0,
    routerStatus: supplyDiagnosticAvailable > 0 ? 'VERIFIED' : undefined,
    routerSignal: 'NEUTRAL',
    forensicSemanticAvailable: `${supplySemanticAvailable}/${totalCandidates}`,
    routerForensicConflictReason: resolveRouterForensicConflictReason(state),
    shadowEligibleSupplyCount,
    supplyMissingNeutralized,
    supplyMissingNeutralizedCount: supplyMissingNeutralized,
    supplyMissingExecutionImpact: 'NONE',
    supplyMissingMarketSignal: false,
    supplyMissingLearningTagDistribution,
    supplyRowMissingLearningTagCount: Object.values(supplyMissingLearningTagDistribution).reduce((sum, count) => sum + count, 0),
    candidateTraceCount: totalCandidates,
    traceWithQuoteCount: candidateTraceHasQuote,
    traceWithSymbolFeaturesCount: candidateTraceHasSymbolFeatures,
    traceWithConditionResultsCount: totalCandidates,
    candidateTraceContainerCount: totalCandidates,
    conditionResultsContainerCount: totalCandidates,
    computedTechnicalTraceCount,
    traceWithWatchlistScoreCount: audits.filter((a) => a.hydrationAuditAdr0509?.watchlist.scoreImported).length,
    watchlistScoreScaleDistribution,
    watchlistScoreScaleDistributionBefore,
    watchlistScoreAvg: watchlistScoreImportedCount > 0 ? round1(watchlistScoreSum / watchlistScoreImportedCount) : 0,
    watchlistScoreNormalized,
    watchlistScoreNormalizedCount: watchlistScoreNormalized,
    watchlistScoreMissing,
    watchlistScoreMissingCount: watchlistScoreMissing,
    watchlistScoreScaleFixed,
    watchlistScoreScaleFixedCount: watchlistScoreScaleFixed,
    promotionScoreCopied,
    promotionScoreCopiedCount: promotionScoreCopied,
    watchlistScoreScaleDistributionAfter,
    watchlistScoreNormalizationBreakPoint,
    watchlistDiagnosticConflict: watchlistSourceAvailableCount !== watchlistScoreImportedCount || missingPositiveSourceCounts.watchlistUpstreamMissing > 0 && watchlistScoreImportedCount > 0,
    adr0467WatchlistVerifiedCount: watchlistSourceAvailableCount,
    adr0505WatchlistImportedCount: watchlistScoreImportedCount,
    conflictReason: resolveWatchlistConflictReason(watchlistSourceAvailableCount, watchlistScoreImportedCount, missingPositiveSourceCounts.watchlistUpstreamMissing),
    quoteFeatureAvailableCount,
    quoteMissingReasonTop: Object.entries(quoteMissingReasonCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([reason]) => reason),
    quoteFeatureFieldCoverage,
    conditionResultsAvailableCount,
    conditionResultsKeyCoverage,
    conditionResultStatusDistribution,
    breakoutConditionKeyCoverage,
    traceWithSupplyContextCount: audits.filter((a) => a.hydrationAuditAdr0509?.candidateTraceHasSupplyContext).length,
    traceWithMinSignalScoreTraceCount: audits.filter((a) => a.hydrationAuditAdr0509?.candidateTraceHasMinSignalScoreTrace).length,
    ...(totalCandidates > 0 && candidateTraceHasQuote === 0 && candidateTraceHasSymbolFeatures === 0 && candidateTraceHasConditionResults === 0
      ? { traceDominantFailureReason: 'TRACE_HYDRATION_MISSING' as const }
      : {}),
    sourcePathDistribution,
    sourcePathTopMissingFields: Object.fromEntries(Object.entries(sourcePathMissingFieldCounts).map(([source, counts]) => [
      source,
      Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([field]) => field),
    ])),
    sourcePathWithWatchlistScore,
    sourcePathWithQuote,
    sourcePathWithConditionResults,
    sellOnlyBySymbolPayloadAvailableCount,
    sellOnlyBySymbolPayloadMergedCount,
    sellOnlyActualRowsCarriedCount,
    sellOnlyCarryBreakPointDistribution,
    watchlistBreakPointDistribution,
    watchlistEntryScoreAvailable,
    stage2ScoreAvailable,
    promotionScoreAvailable,
    entryFilterTraceScoreAvailable,
    forensicInputScoreAvailable,
    quoteHydrationBreakPointDistribution,
    conditionResultsBreakPointDistribution,
    sectorEnergyStrongBuyBlockedCount,
    sectorEnergyHardBlockCount,
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    policyPromotionMode: 'SHADOW_ONLY',
  };
}

/* ───────── /scan_blockers compact section formatter SSOT ───────── */

/**
 * Telegram-safe compact line — 사용자 명시 형식 정확 정합.
 * 4000-char budget (ADR-0478) 차원에서 12~14 줄 한도 의무.
 * 빈 entries 시 null 반환 (잡음 차단).
 */

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
