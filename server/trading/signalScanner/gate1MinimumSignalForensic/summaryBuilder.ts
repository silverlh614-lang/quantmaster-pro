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
import { bump, resolveGate1EvaluationStateAdr0510 } from './auditBuilder.js';
import { BREAKOUT_CONDITION_KEYS } from './featureHydrationAudit.js';
import { resolveSupplyUnknownRootCause } from './supplyScopeAudit.js';
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
  const dominantFailureDistribution = { ...EMPTY_DOMINANT_DISTRIBUTION };
  for (const a of failed) {
    dominantFailureDistribution[a.dominantFailureReason] += 1;
  }

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

  const technicalTrendMissing = emptyTechnicalTrendMissingClassification();
  for (const a of failed) {
    if (!hasTechnicalTrendMissing(a)) continue;
    technicalTrendMissing.total += 1;
    const reason = classifyAuditTechnicalTrendMissing(a);
    technicalTrendMissing.reasons[reason] += 1;
  }

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
  const diagnosticPenaltyBreakdown = buildDiagnosticPenaltyBreakdown(technicalTrendMissing);
  diagnosticPenaltyBreakdown.softFailPenalty += Math.max(0, penaltyCounts.softFailPenalty - diagnosticPenaltyBreakdown.softFailPenalty);

  const supplyScopeWarnings = { ...EMPTY_SUPPLY_SCOPE_WARNINGS };
  let supplySymbolMatchedCount = 0;
  let inferredSymbolMatchedCount = 0;
  let candidateSymbolAvailableCount = 0;
  let quoteSymbolAvailableCount = 0;
  let requestSymbolAvailableCount = 0;
  let providerSymbolAvailableCount = 0;
  let symbolMissingCount = 0;
  let symbolMismatchCount = 0;
  const providerScopeDistribution: Record<string, number> = {};
  const semanticReasonDistribution = { ...EMPTY_SEMANTIC_REASON_DISTRIBUTION };
  const scoreUsageDistribution: Record<string, number> = {};
  const supplyUnknownRootCauseDistribution: Record<string, number> = {};
  const kisRawFieldKeysTop: Record<string, number> = {};
  const actualRawFieldKeysTop: Record<string, number> = {};
  const actualNumericStringFieldKeysTop: Record<string, number> = {};
  const actualNumberFieldKeysTop: Record<string, number> = {};
  const actualPlaceholderFieldKeysTop: Record<string, number> = {};
  const candidateNetBuyFieldKeysTop: Record<string, number> = {};
  const selectedActualRawFieldKeysTop: Record<string, number> = {};
  const selectedNumericStringFieldKeysTop: Record<string, number> = {};
  const rejectedWrapperPathsTop: Record<string, number> = {};
  let rowCandidateCount = 0;
  let selectedRowScoreSum = 0;
  let selectedRowScoreCount = 0;
  let wrapperOnlyCount = 0;
  let numericCandidateCount = 0;
  let aliasCandidateCount = 0;
  const selectedPathTop: Record<string, number> = {};
  const kisNormalizedFieldKeysTop: Record<string, number> = {};
  const kisSemanticFieldKeysTop: Record<string, number> = {};
  const semanticRowBreakPointDistribution: Record<string, number> = {};
  let semanticRowAvailableCount = 0;
  let semanticRowMetadataOnlyCount = 0;
  let rawInvestorRowAvailableCount = 0;
  let adapterRowsForwardedAcrossProvidersCount = 0;
  // INVESTOR-FLOW-ACTUAL-ROW-CARRY-WIRING-001 — diagnostic actual row carry 카운터.
  let diagnosticActualInvestorRowCarriedCount = 0;
  let selectedProviderActualRowCount = 0;
  let diagnosticOnlyActualRowCount = 0;
  const actualInvestorRowProviderDistribution: Record<string, number> = {};
  const actualInvestorRowUseScopeDistribution: Record<string, number> = {};
  let kisNormalizedRowsMaterialized = 0;
  let kisSemanticRowsMaterialized = 0;
  let normalizedRowsPromotedToDiagnosticActualRow = 0;
  let normalizedMetadataOnlyRows = 0;
  let semanticMetadataOnlyRows = 0;
  let bySymbolDiagnosticActualRowFromNormalized = 0;
  let sellOnlyBySymbolPayloadFromNormalized = 0;
  let semanticFromNormalizedActualRow = 0;
  const investorRowMaterializationClassDistribution: Record<string, number> = {};
  let selectedCandidateCarriesSemanticRowCount = 0;
  let selectedCandidateCarriesActualRowCount = 0;
  let forensicInputCarriesSemanticRowCount = 0;
  let forensicInputCarriesActualInvestorRowsCount = 0;
  const actualInvestorRowPathDistribution: Record<string, number> = {};
  const actualInvestorRowFieldKeysTop: Record<string, number> = {};
  const actualInvestorNumericStringKeysTop: Record<string, number> = {};
  const actualInvestorNumberKeysTop: Record<string, number> = {};
  const sampleValueKindDistribution: Record<string, number> = {};
  const mappedFieldDistribution: { foreign: Record<string, number>; institution: Record<string, number>; individual: Record<string, number> } = {
    foreign: {},
    institution: {},
    individual: {},
  };
  let supplySemanticAvailable = 0;
  let supplyDiagnosticAvailable = 0;
  let foreignNetBuyAvailable = 0;
  let institutionalNetBuyAvailable = 0;
  let zeroButMaterializedCount = 0;
  let shadowEligibleSupplyCount = 0;
  let rsHydrationAvailableCount = 0;
  let breakoutHydrationAvailableCount = 0;
  const rsMissingReasonDistribution = { ...EMPTY_HYDRATION_REASON_DISTRIBUTION };
  const breakoutMissingReasonDistribution = { ...EMPTY_HYDRATION_REASON_DISTRIBUTION };
  const hydrationMissingFieldCounts: Record<string, number> = {};
  const rsMissingFieldCounts: Record<string, number> = {};
  const breakoutMissingFieldCounts: Record<string, number> = {};
  const watchlistSourceFieldDistribution: Record<string, number> = {};
  const watchlistMissingReasonCounts: Record<string, number> = {};
  const watchlistScoreScaleDistribution: Record<string, number> = {};
  let watchlistScoreSum = 0;
  const quoteMissingReasonCounts: Record<string, number> = {};
  const quoteFeatureFieldCoverage: Record<string, number> = { return5d: 0, return20d: 0, high5d: 0, high20d: 0, volume: 0, avgVolume: 0, ma20: 0, ma60: 0 };
  let quoteFeatureAvailableCount = 0;
  const conditionResultsKeyCoverage: Record<string, number> = {};
  const conditionResultStatusDistribution: Record<string, number> = { FIRED: 0, DATA_UNAVAILABLE: 0, THRESHOLD_NOT_MET: 0, PROVIDER_DEGRADED: 0, ERROR: 0 };
  const rsConditionStatusDistribution: Record<string, number> = {};
  const breakoutConditionStatusDistribution: Record<string, number> = {};
  let conditionResultsAvailableCount = 0;
  const breakoutConditionKeyCoverage: Record<string, number> = {};
  const rsSourceDistribution: Record<RsHydrationSourceAdr0509, number> = {
    QUOTE_RETURN: 0,
    SYMBOL_FEATURES: 0,
    CONDITION_RESULTS: 0,
    EXPLICIT_RELATIVE_RETURN: 0,
    WATCHLIST_PROXY: 0,
    MISSING: 0,
  };
  const breakoutSourceDistribution: Record<BreakoutHydrationSourceAdr0509, number> = {
    QUOTE_OHLCV: 0,
    SYMBOL_FEATURES: 0,
    CONDITION_RESULTS: 0,
    CONDITION_KEYS: 0,
    WATCHLIST_REASON_PROXY: 0,
    MISSING: 0,
  };
  let watchlistSourceAvailableCount = 0;
  let watchlistScoreImportedCount = 0;
  let rsScoreUsableCount = 0;
  let breakoutScoreUsableCount = 0;
  let candidateTraceHasQuote = 0;
  let candidateTraceHasSymbolFeatures = 0;
  let candidateTraceHasConditionResults = 0;
  let computedTechnicalTraceCount = 0;
  const sourcePathDistribution: Record<Gate1ForensicTraceSourcePath, number> = {
    ENTRY_FILTER_GATE1_CANDIDATE_TRACE: 0,
    ENTRY_FILTER_CANDIDATE_TRACE: 0,
    WATCHLIST_CANDIDATE: 0,
    PREFLIGHT_UNIVERSE_SNAPSHOT: 0,
    SELL_ONLY_DIAGNOSTIC_SNAPSHOT: 0,
    UNKNOWN: 0,
  };
  const sourcePathWithWatchlistScore: Record<Gate1ForensicTraceSourcePath, number> = { ...sourcePathDistribution };
  const sourcePathWithQuote: Record<Gate1ForensicTraceSourcePath, number> = { ...sourcePathDistribution };
  const sourcePathWithConditionResults: Record<Gate1ForensicTraceSourcePath, number> = { ...sourcePathDistribution };
  const sellOnlyCarryBreakPointDistribution: Record<SellOnlyCarryBreakPointAdr0507, number> = {
    BYSYMBOL_PAYLOAD_MISSING: 0,
    BYSYMBOL_PAYLOAD_STALE: 0,
    BYSYMBOL_PAYLOAD_FOUND_NOT_MERGED: 0,
    BYSYMBOL_PAYLOAD_MERGED_BUT_FORENSIC_DROPPED: 0,
    MERGED_BUT_FORENSIC_DROPPED: 0,
    PSEUDO_SYMBOL_NOT_RESOLVED: 0,
    CARRIED_TO_FORENSIC: 0,
    UNKNOWN: 0,
  };
  let sellOnlyBySymbolPayloadAvailableCount = 0;
  let sellOnlyBySymbolPayloadMergedCount = 0;
  let sellOnlyActualRowsCarriedCount = 0;
  const sourcePathMissingFieldCounts: Record<string, Record<string, number>> = {};
  const watchlistBreakPointDistribution: Record<WatchlistBreakPointAdr0510, number> = {
    WATCHLIST_ENTRY_MISSING_SCORE: 0,
    STAGE2_SCORE_NOT_COPIED: 0,
    PROMOTION_SCORE_NOT_COPIED: 0,
    ENTRY_FILTER_TRACE_MISSING_SCORE: 0,
    FORENSIC_INPUT_MISSING_SCORE: 0,
    SOURCE_FIELD_NONE: 0,
    UNKNOWN: 0,
  };
  const quoteHydrationBreakPointDistribution: Record<QuoteHydrationBreakPointAdr0510, number> = {
    QUOTE_NOT_FETCHED: 0,
    QUOTE_FETCHED_NOT_COPIED: 0,
    SAFE_QUOTE_FEATURES_NOT_BUILT: 0,
    SELL_ONLY_SKIPPED_QUOTE_EVALUATION: 0,
    PRECHECK_ONLY_TRACE: 0,
    UNKNOWN: 0,
  };
  const conditionResultsBreakPointDistribution: Record<ConditionResultsBreakPointAdr0510, number> = {
    NONE: 0,
    CONDITION_RESULTS_PROJECTED: 0,
    CONDITION_RESULTS_SKELETON_ONLY: 0,
    EVALUATE_SERVER_GATE_NOT_CALLED: 0,
    GATE_OUTPUTS_NOT_COPIED: 0,
    CONDITION_RESULTS_NOT_PROJECTED: 0,
    SELL_ONLY_SKIPPED_GATE_EVALUATION: 0,
    PRECHECK_ONLY_TRACE: 0,
    UNKNOWN: 0,
  };
  let watchlistEntryScoreAvailable = 0;
  let stage2ScoreAvailable = 0;
  let promotionScoreAvailable = 0;
  let entryFilterTraceScoreAvailable = 0;
  let forensicInputScoreAvailable = 0;
  let sectorEnergyStrongBuyBlockedCount = 0;
  let sectorEnergyHardBlockCount = 0;
  let watchlistScoreNormalized = 0;
  let watchlistScoreMissing = 0;
  let watchlistScoreScaleFixed = 0;
  let promotionScoreCopied = 0;
  const watchlistScoreScaleDistributionBefore: Record<string, number> = {};
  const watchlistScoreScaleDistributionAfter: Record<string, number> = {};
  const watchlistScoreNormalizationBreakPoint: Record<string, number> = {};
  const technicalProjectionCoverage: Record<string, number> = {
    aboveMA20: 0,
    aboveMA60: 0,
    maAlignmentStatus: 0,
    return5d: 0,
    return20d: 0,
    rsUsable: 0,
    breakoutUsable: 0,
  };
  let maAlignmentComputed = 0;
  let return5dAvailable = 0;
  let return20dAvailable = 0;
  let technicalComputedButProjectionMissingCount = 0;
  const technicalProjectionBreakPoint: Record<string, number> = {};
  let maAlignmentAdvisoryOnlyCount = 0;
  let technicalTrendDeathHardBlockCount = 0;
  const rsBreakPointDistribution: Record<string, number> = {};
  let rsComputedFromReturn20dCount = 0;
  let rsIndexFallbackUsedCount = 0;
  const rsTraceButScoreMissingBreakPoint: Record<string, number> = {};
  let supplyMissingNeutralized = 0;
  const supplyMissingLearningTagDistribution: Record<string, number> = {};

  for (const a of failed) {
    const sourcePath = a.sourcePath === 'SELL_ONLY_DIAGNOSTIC_SNAPSHOT'
      ? 'PREFLIGHT_UNIVERSE_SNAPSHOT'
      : a.sourcePath ?? 'UNKNOWN';
    bump(sourcePathDistribution, sourcePath);
    bump(watchlistBreakPointDistribution, a.watchlistBreakPoint ?? 'UNKNOWN');
    bump(quoteHydrationBreakPointDistribution, a.quoteHydrationBreakPoint === 'SELL_ONLY_SKIPPED_QUOTE_EVALUATION' ? 'PRECHECK_ONLY_TRACE' : a.quoteHydrationBreakPoint ?? 'UNKNOWN');
    bump(conditionResultsBreakPointDistribution, a.conditionResultsBreakPoint === 'SELL_ONLY_SKIPPED_GATE_EVALUATION' ? 'PRECHECK_ONLY_TRACE' : a.conditionResultsBreakPoint ?? 'UNKNOWN');
    if (a.hydrationAuditAdr0509?.watchlist.scoreImported) {
      sourcePathWithWatchlistScore[sourcePath] += 1;
      forensicInputScoreAvailable += 1;
    }
    if (a.hydrationAuditAdr0509?.watchlist.watchlistScore != null) watchlistEntryScoreAvailable += 1;
    if (a.hydrationAuditAdr0509?.watchlist.stage2Score != null) stage2ScoreAvailable += 1;
    if (a.hydrationAuditAdr0509?.watchlist.upstreamCandidateScore != null) promotionScoreAvailable += 1;
    if (a.hydrationAuditAdr0509?.watchlist.sourceAvailable) entryFilterTraceScoreAvailable += 1;
    if (a.hydrationAuditAdr0509?.candidateTraceHasQuote) sourcePathWithQuote[sourcePath] += 1;
    if (a.hydrationAuditAdr0509?.candidateTraceHasConditionResults) sourcePathWithConditionResults[sourcePath] += 1;
    for (const field of a.hydrationAuditAdr0509?.missingFields ?? []) {
      const byField = sourcePathMissingFieldCounts[sourcePath] ?? {};
      byField[field] = (byField[field] ?? 0) + 1;
      sourcePathMissingFieldCounts[sourcePath] = byField;
    }
    supplyScopeWarnings[a.supplyScopeAudit.warning] += 1;
    if (a.supplyScopeAudit.symbolMatched === true) supplySymbolMatchedCount += 1;
    if (a.supplyScopeAudit.inferredSymbolMatched === true) inferredSymbolMatchedCount += 1;
    if (a.supplyScopeAudit.candidateSymbol) candidateSymbolAvailableCount += 1;
    if (a.supplyScopeAudit.quoteSymbol) quoteSymbolAvailableCount += 1;
    if (a.supplyScopeAudit.requestSymbol) requestSymbolAvailableCount += 1;
    if (a.supplyScopeAudit.providerSymbol || a.supplyScopeAudit.kisFlowSymbol || a.supplyScopeAudit.normalizedSymbol) providerSymbolAvailableCount += 1;
    if (a.supplyScopeAudit.warning === 'KIS_FLOW_SYMBOL_MISSING') symbolMissingCount += 1;
    if (a.supplyScopeAudit.warning === 'KIS_FLOW_SYMBOL_MISMATCH') symbolMismatchCount += 1;
    const scopeKey = a.supplyScopeAudit.providerScope ?? 'UNKNOWN';
    providerScopeDistribution[scopeKey] = (providerScopeDistribution[scopeKey] ?? 0) + 1;
    if (a.supplyScopeAudit.semanticAvailable) supplySemanticAvailable += 1;
    if (a.supplyScopeAudit.semanticDiagnosticAvailable) supplyDiagnosticAvailable += 1;
    if (a.supplyScopeAudit.semanticRowAvailable) semanticRowAvailableCount += 1;
    if (a.supplyScopeAudit.semanticRowMetadataOnly) semanticRowMetadataOnlyCount += 1;
    if (a.supplyScopeAudit.rawInvestorRowAvailable) rawInvestorRowAvailableCount += 1;
    // ADR-0477 supply actual row carry diagnostic — adapter (KIS) 가 actual row 보유 +
    // selectedProvider != KIS_API 인 경우에도 router 가 carry. 사용자 명시 #6 단절 진단 집계.
    if (a.supplyScopeAudit.adapterRowsForwardedAcrossProviders) adapterRowsForwardedAcrossProvidersCount += 1;
    // INVESTOR-FLOW-ACTUAL-ROW-CARRY-WIRING-001 — diagnostic actual row carry 집계.
    if (a.supplyScopeAudit.diagnosticActualInvestorRowCarried) {
      diagnosticActualInvestorRowCarriedCount += 1;
      if (
        a.supplyScopeAudit.actualInvestorRowUseScope === 'SELECTED_PROVIDER' ||
        a.supplyScopeAudit.actualInvestorRowUseScope === 'GATE_SCORE_ELIGIBLE'
      ) {
        selectedProviderActualRowCount += 1;
      }
      else diagnosticOnlyActualRowCount += 1;
    }
    if (a.supplyScopeAudit.actualInvestorRowProvider) {
      const provider = a.supplyScopeAudit.actualInvestorRowProvider;
      actualInvestorRowProviderDistribution[provider] = (actualInvestorRowProviderDistribution[provider] ?? 0) + 1;
    }
    if (a.supplyScopeAudit.actualInvestorRowUseScope) {
      const scope = a.supplyScopeAudit.actualInvestorRowUseScope;
      actualInvestorRowUseScopeDistribution[scope] = (actualInvestorRowUseScopeDistribution[scope] ?? 0) + 1;
    }
    // Patch-SUPPLY-DIAG-ACCURACY: kisNormalizedRowsMaterialized 는 실제 정규화 *값* 이 1개
    // 이상 존재할 때만 카운트한다. 이전엔 `kisNormalizedFieldKeysTop.length > 0` OR 분기가
    // wrapper/metadata 키만 보유한 후보까지 materialized 로 집계해 40/40 false positive 를
    // 만들었다 (kisSemanticRowsMaterialized 0/40 + investorRowMaterializationClass none 과 모순).
    if ((a.supplyScopeAudit.normalizedCount ?? 0) > 0) kisNormalizedRowsMaterialized += 1;
    if ((a.supplyScopeAudit.materializedCount ?? 0) > 0 || a.supplyScopeAudit.semanticRowAvailable) kisSemanticRowsMaterialized += 1;
    const materializationClass = a.supplyScopeAudit.investorRowMaterializationClass ?? (a.supplyScopeAudit.diagnosticActualInvestorRowFromNormalized ? 'NORMALIZED_NUMERIC_ROW' : undefined);
    if (materializationClass) investorRowMaterializationClassDistribution[materializationClass] = (investorRowMaterializationClassDistribution[materializationClass] ?? 0) + 1;
    if (a.supplyScopeAudit.diagnosticActualInvestorRowFromNormalized && a.supplyScopeAudit.diagnosticActualInvestorRowCarried) {
      normalizedRowsPromotedToDiagnosticActualRow += 1;
      semanticFromNormalizedActualRow += a.supplyScopeAudit.semanticAvailable ? 1 : 0;
    }
    if (materializationClass === 'NORMALIZED_METADATA_ONLY') normalizedMetadataOnlyRows += 1;
    if (materializationClass === 'SEMANTIC_METADATA_ONLY') semanticMetadataOnlyRows += 1;
    if (a.supplyScopeAudit.diagnosticActualInvestorRowFromNormalized && a.supplyScopeAudit.sellOnlyBySymbolPayloadAvailable) bySymbolDiagnosticActualRowFromNormalized += 1;
    if (a.supplyScopeAudit.diagnosticActualInvestorRowFromNormalized && a.supplyScopeAudit.sellOnlyBySymbolPayloadAvailable) sellOnlyBySymbolPayloadFromNormalized += 1;
    if (a.supplyScopeAudit.selectedCandidateCarriesSemanticRow) selectedCandidateCarriesSemanticRowCount += 1;
    if ((a.supplyScopeAudit.selectedActualRowFieldKeys?.length ?? 0) > 0) selectedCandidateCarriesActualRowCount += 1;
    if (a.supplyScopeAudit.forensicInputCarriesSemanticRow) forensicInputCarriesSemanticRowCount += 1;
    if (a.supplyScopeAudit.forensicInputCarriesActualInvestorRows) forensicInputCarriesActualInvestorRowsCount += 1;
    if (a.supplyScopeAudit.selectedActualRowPath) actualInvestorRowPathDistribution[a.supplyScopeAudit.selectedActualRowPath] = (actualInvestorRowPathDistribution[a.supplyScopeAudit.selectedActualRowPath] ?? 0) + 1;
    for (const key of a.supplyScopeAudit.selectedActualRowFieldKeys ?? []) actualInvestorRowFieldKeysTop[key] = (actualInvestorRowFieldKeysTop[key] ?? 0) + 1;
    for (const key of a.supplyScopeAudit.selectedActualNumericStringFieldKeys ?? []) actualInvestorNumericStringKeysTop[key] = (actualInvestorNumericStringKeysTop[key] ?? 0) + 1;
    for (const key of a.supplyScopeAudit.selectedActualNumericFieldKeys ?? []) actualInvestorNumberKeysTop[key] = (actualInvestorNumberKeysTop[key] ?? 0) + 1;
    const breakPoint = a.supplyScopeAudit.semanticRowBreakPoint ?? 'UNKNOWN';
    semanticRowBreakPointDistribution[breakPoint] = (semanticRowBreakPointDistribution[breakPoint] ?? 0) + 1;
    if (a.supplyScopeAudit.foreignNetBuy !== null) foreignNetBuyAvailable += 1;
    if (a.supplyScopeAudit.institutionalNetBuy !== null) institutionalNetBuyAvailable += 1;
    const semanticReason = a.supplyScopeAudit.semanticReason ?? 'UNKNOWN';
    semanticReasonDistribution[semanticReason] = (semanticReasonDistribution[semanticReason] ?? 0) + 1;
    if (semanticReason === 'ZERO_BUT_MATERIALIZED') zeroButMaterializedCount += 1;
    const scoreUsageKey = a.supplyScopeAudit.scoreUsage ?? 'SHADOW_ONLY';
    scoreUsageDistribution[scoreUsageKey] = (scoreUsageDistribution[scoreUsageKey] ?? 0) + 1;
    if (a.supplyScopeAudit.wouldBeEligibleIfForeignOrInstitutionFieldMapped) shadowEligibleSupplyCount += 1;
    const fieldDiagnostics = a.supplyScopeAudit.fieldKeyDiagnostics;
    for (const key of fieldDiagnostics?.kisRawFieldKeysTop ?? []) kisRawFieldKeysTop[key] = (kisRawFieldKeysTop[key] ?? 0) + 1;
    for (const key of fieldDiagnostics?.actualRawFieldKeysTop ?? []) actualRawFieldKeysTop[key] = (actualRawFieldKeysTop[key] ?? 0) + 1;
    for (const key of fieldDiagnostics?.actualNumericStringFieldKeysTop ?? []) actualNumericStringFieldKeysTop[key] = (actualNumericStringFieldKeysTop[key] ?? 0) + 1;
    for (const key of fieldDiagnostics?.actualNumberFieldKeysTop ?? []) actualNumberFieldKeysTop[key] = (actualNumberFieldKeysTop[key] ?? 0) + 1;
    for (const key of fieldDiagnostics?.actualPlaceholderFieldKeysTop ?? []) actualPlaceholderFieldKeysTop[key] = (actualPlaceholderFieldKeysTop[key] ?? 0) + 1;
    for (const key of fieldDiagnostics?.candidateNetBuyFieldKeysTop ?? []) candidateNetBuyFieldKeysTop[key] = (candidateNetBuyFieldKeysTop[key] ?? 0) + 1;
    for (const key of fieldDiagnostics?.selectedActualRawFieldKeysTop ?? []) selectedActualRawFieldKeysTop[key] = (selectedActualRawFieldKeysTop[key] ?? 0) + 1;
    for (const key of fieldDiagnostics?.selectedNumericStringFieldKeysTop ?? []) selectedNumericStringFieldKeysTop[key] = (selectedNumericStringFieldKeysTop[key] ?? 0) + 1;
    for (const key of fieldDiagnostics?.rejectedWrapperPathsTop ?? []) rejectedWrapperPathsTop[key] = (rejectedWrapperPathsTop[key] ?? 0) + 1;
    rowCandidateCount += fieldDiagnostics?.rowCandidateCount ?? 0;
    if (typeof fieldDiagnostics?.selectedRowScore === 'number') {
      selectedRowScoreSum += fieldDiagnostics.selectedRowScore;
      selectedRowScoreCount += 1;
    }
    wrapperOnlyCount += fieldDiagnostics?.wrapperOnlyCount ?? 0;
    numericCandidateCount += fieldDiagnostics?.numericCandidateCount ?? 0;
    aliasCandidateCount += fieldDiagnostics?.aliasCandidateCount ?? 0;
    if (fieldDiagnostics?.selectedPath) selectedPathTop[fieldDiagnostics.selectedPath] = (selectedPathTop[fieldDiagnostics.selectedPath] ?? 0) + 1;
    for (const key of fieldDiagnostics?.kisNormalizedFieldKeysTop ?? []) {
      kisNormalizedFieldKeysTop[key] = (kisNormalizedFieldKeysTop[key] ?? 0) + 1;
      kisSemanticFieldKeysTop[key] = (kisSemanticFieldKeysTop[key] ?? 0) + 1;
    }
    for (const [kind, count] of Object.entries(fieldDiagnostics?.sampleValueKinds ?? {})) {
      sampleValueKindDistribution[kind] = (sampleValueKindDistribution[kind] ?? 0) + Number(count);
    }
    for (const key of fieldDiagnostics?.candidateMappedFields.foreign ?? []) mappedFieldDistribution.foreign[key] = (mappedFieldDistribution.foreign[key] ?? 0) + 1;
    for (const key of fieldDiagnostics?.candidateMappedFields.institution ?? []) mappedFieldDistribution.institution[key] = (mappedFieldDistribution.institution[key] ?? 0) + 1;
    for (const key of fieldDiagnostics?.candidateMappedFields.individual ?? []) mappedFieldDistribution.individual[key] = (mappedFieldDistribution.individual[key] ?? 0) + 1;
    if (a.penaltyComponents['SUPPLY_CONFLUENCE']?.weightedScore < 0) {
      const rootCause = resolveSupplyUnknownRootCause(a.supplyScopeAudit);
      supplyUnknownRootCauseDistribution[rootCause] = (supplyUnknownRootCauseDistribution[rootCause] ?? 0) + 1;
    }
    if (a.hydrationAuditAdr0509?.watchlist.sourceAvailable) watchlistSourceAvailableCount += 1;
    if (a.hydrationAuditAdr0509?.watchlist.scoreImported) watchlistScoreImportedCount += 1;
    const watchlistField = a.hydrationAuditAdr0509?.watchlist.sourceField ?? 'none';
    watchlistSourceFieldDistribution[watchlistField] = (watchlistSourceFieldDistribution[watchlistField] ?? 0) + 1;
    const watchlistScale = a.hydrationAuditAdr0509?.watchlist.scoreScale ?? 'none';
    watchlistScoreScaleDistribution[watchlistScale] = (watchlistScoreScaleDistribution[watchlistScale] ?? 0) + 1;
    if (a.hydrationAuditAdr0509?.watchlist.scoreImported && typeof a.hydrationAuditAdr0509.watchlist.normalizedWatchlistScore === 'number') {
      watchlistScoreSum += a.hydrationAuditAdr0509.watchlist.normalizedWatchlistScore;
    }
    const watchlistMissingReason = a.hydrationAuditAdr0509?.watchlist.missingReason;
    if (watchlistMissingReason) watchlistMissingReasonCounts[watchlistMissingReason] = (watchlistMissingReasonCounts[watchlistMissingReason] ?? 0) + 1;
    if (!a.hydrationAuditAdr0509?.candidateTraceHasQuote) quoteMissingReasonCounts.QUOTE_MISSING = (quoteMissingReasonCounts.QUOTE_MISSING ?? 0) + 1;
    let candidateHasQuoteFeature = false;
    for (const field of Object.keys(quoteFeatureFieldCoverage)) {
      if (!a.hydrationAuditAdr0509?.rsMissingFields.includes(field) || !a.hydrationAuditAdr0509?.breakoutMissingFields.includes(field)) {
        quoteFeatureFieldCoverage[field] += 1;
        candidateHasQuoteFeature = true;
      }
    }
    if (candidateHasQuoteFeature) quoteFeatureAvailableCount += 1;
    for (const [key, value] of Object.entries(a.hydrationAuditAdr0509?.conditionKeyStatus ?? {})) {
      conditionResultsKeyCoverage[key] = (conditionResultsKeyCoverage[key] ?? 0) + 1;
      const status = value || 'DATA_UNAVAILABLE';
      conditionResultStatusDistribution[status] = (conditionResultStatusDistribution[status] ?? 0) + 1;
      if (key === 'relative_strength') rsConditionStatusDistribution[status] = (rsConditionStatusDistribution[status] ?? 0) + 1;
      if (BREAKOUT_CONDITION_KEYS.has(key)) breakoutConditionStatusDistribution[status] = (breakoutConditionStatusDistribution[status] ?? 0) + 1;
      conditionResultsAvailableCount += 1;
    }
    for (const key of a.hydrationAuditAdr0509?.breakoutConditionKeys ?? []) {
      breakoutConditionKeyCoverage[key] = (breakoutConditionKeyCoverage[key] ?? 0) + 1;
    }
    if (a.hydrationAuditAdr0509?.rsAvailable) rsHydrationAvailableCount += 1;
    if (a.hydrationAuditAdr0509?.breakoutAvailable) breakoutHydrationAvailableCount += 1;
    if (a.hydrationAuditAdr0509?.rsScoreUsable) rsScoreUsableCount += 1;
    if (a.hydrationAuditAdr0509?.breakoutScoreUsable) breakoutScoreUsableCount += 1;
    if (a.hydrationAuditAdr0509?.rsSource) rsSourceDistribution[a.hydrationAuditAdr0509.rsSource] += 1;
    if (a.hydrationAuditAdr0509?.breakoutSource) breakoutSourceDistribution[a.hydrationAuditAdr0509.breakoutSource] += 1;
    for (const reason of a.hydrationAuditAdr0509?.rsMissingReasons ?? []) rsMissingReasonDistribution[reason] += 1;
    for (const reason of a.hydrationAuditAdr0509?.breakoutMissingReasons ?? []) breakoutMissingReasonDistribution[reason] += 1;
    for (const field of a.hydrationAuditAdr0509?.missingFields ?? []) {
      hydrationMissingFieldCounts[field] = (hydrationMissingFieldCounts[field] ?? 0) + 1;
    }
    for (const field of a.hydrationAuditAdr0509?.rsMissingFields ?? []) {
      rsMissingFieldCounts[field] = (rsMissingFieldCounts[field] ?? 0) + 1;
    }
    for (const field of a.hydrationAuditAdr0509?.breakoutMissingFields ?? []) {
      breakoutMissingFieldCounts[field] = (breakoutMissingFieldCounts[field] ?? 0) + 1;
    }
    if (a.hydrationAuditAdr0509?.candidateTraceHasQuote) candidateTraceHasQuote += 1;
    if (a.hydrationAuditAdr0509?.candidateTraceHasSymbolFeatures) candidateTraceHasSymbolFeatures += 1;
    if (a.hydrationAuditAdr0509?.candidateTraceHasConditionResults) candidateTraceHasConditionResults += 1;
    if (a.conditionResultsBreakPoint === 'CONDITION_RESULTS_PROJECTED') computedTechnicalTraceCount += 1;
    if (a.sectorEnergyAudit.strongBuyAllowed === false) sectorEnergyStrongBuyBlockedCount += 1;
    // 사용자 명시 — SectorEnergy hardBlock 절대 금지. 본 카운터는 *항상* 0 이어야 함.
    if (a.sectorEnergyAudit.executionImpact === 'HARD_BLOCK') {
      sectorEnergyHardBlockCount += 1;
    }
  }

  for (const a of audits) {
    const hydration = a.hydrationAuditAdr0509;
    const watchlist = hydration?.watchlist;
    const normalized = watchlist?.watchlistScoreNormalized ?? watchlist?.normalizedWatchlistScore;
    if (typeof normalized === 'number' && Number.isFinite(normalized)) watchlistScoreNormalized += 1;
    if (watchlist?.watchlistScoreMissing === true || watchlist?.scoreImported === false) watchlistScoreMissing += 1;
    if (watchlist?.watchlistScoreScaleFixed === true) watchlistScoreScaleFixed += 1;
    if (watchlist?.promotionScoreCopied === true) promotionScoreCopied += 1;
    bump(watchlistScoreScaleDistributionBefore, watchlist?.scoreScale ?? 'none');
    bump(watchlistScoreScaleDistributionAfter, watchlist?.scoreImported ? '0~100' : 'missing');
    bump(watchlistScoreNormalizationBreakPoint, watchlist?.watchlistScoreNormalizationBreakPoint ?? 'WATCHLIST_SCORE_MISSING');

    for (const [field, covered] of Object.entries(hydration?.technicalProjectionCoverage ?? {})) {
      if (covered) technicalProjectionCoverage[field] = (technicalProjectionCoverage[field] ?? 0) + 1;
    }
    if (hydration?.maAlignmentComputed) maAlignmentComputed += 1;
    if (hydration?.return5dAvailable) return5dAvailable += 1;
    if (hydration?.return20dAvailable) return20dAvailable += 1;
    bump(technicalProjectionBreakPoint, hydration?.technicalProjectionBreakPoint ?? 'TRACE_MISSING');
    if (hydration?.technicalProjectionBreakPoint === 'TECHNICAL_STATUS_COMPUTED_FIELD_MISSING') {
      technicalComputedButProjectionMissingCount += 1;
    }
    if (hydration?.maAlignmentPolicy?.advisoryOnly) maAlignmentAdvisoryOnlyCount += 1;
    if (hydration?.maAlignmentPolicy?.hardBlockReason === 'TECHNICAL_TREND_DEATH') technicalTrendDeathHardBlockCount += 1;
    bump(rsBreakPointDistribution, hydration?.rsBreakPoint ?? 'UNKNOWN');
    if (hydration?.rsComputedFromReturn20d) rsComputedFromReturn20dCount += 1;
    if (hydration?.rsIndexFallbackUsed) rsIndexFallbackUsedCount += 1;
    if (hydration?.rsTraceButScoreMissingBreakPoint) {
      bump(rsTraceButScoreMissingBreakPoint, hydration.rsTraceButScoreMissingBreakPoint);
    }

    if (a.supplyScopeAudit.supplyMissingNeutralized) {
      supplyMissingNeutralized += 1;
      bump(supplyMissingLearningTagDistribution, a.supplyScopeAudit.learningTag ?? 'CASE_SUPPLY_ROW_NOT_FOUND');
    }
  }

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
    routerForensicConflictReason: supplyDiagnosticAvailable > 0 && supplySemanticAvailable === 0
      ? semanticReasonDistribution.STALE_ONLY > 0
        ? 'ROUTER_VERIFIED_BUT_SHADOW_ONLY_STALE'
        : semanticRowMetadataOnlyCount > 0
          ? 'ROUTER_VERIFIED_BUT_SELECTED_CANDIDATE_METADATA_ONLY'
          : Object.keys(semanticRowBreakPointDistribution).some((key) => key.includes('DROPPED') && semanticRowBreakPointDistribution[key] > 0)
            ? 'ROUTER_VERIFIED_BUT_SEMANTIC_ROW_DROPPED'
            : semanticReasonDistribution.FIELD_ALIAS_NOT_MAPPED > 0
              ? 'ROUTER_VERIFIED_BUT_FIELD_ALIAS_NOT_MAPPED'
              : semanticReasonDistribution.ONLY_MARKET_LEVEL_FLOW > 0 || semanticReasonDistribution.ONLY_SECTOR_LEVEL_FLOW > 0
                ? 'ROUTER_VERIFIED_BUT_MARKET_LEVEL_ONLY'
                : 'ROUTER_VERIFIED_BUT_SEMANTIC_FIELDS_MISSING'
      : undefined,
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
    conflictReason: watchlistSourceAvailableCount !== watchlistScoreImportedCount
      ? 'DIFFERENT_SOURCE_PATH'
      : missingPositiveSourceCounts.watchlistUpstreamMissing > 0 && watchlistScoreImportedCount > 0
        ? 'TRACE_FIELD_MISSING'
        : undefined,
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
