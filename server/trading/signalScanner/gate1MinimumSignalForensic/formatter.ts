/**
 * @responsibility ADR-0505 scan blockers formatter.
 */

import type {
  DominantFailureReason,
  Gate1MinimumSignalForensicSummaryAdr0505,
} from './types.js';

export function formatGate1MinimumSignalForensicSection(
  summary: Gate1MinimumSignalForensicSummaryAdr0505 | undefined,
): string | null {
  if (!summary || summary.totalCandidates === 0) return null;

  const lines: string[] = [];
  appendGate1OverviewLines(lines, summary);
  appendSupplySemanticCoverageLines(lines, summary);
  appendSupplySemanticUnwrapLines(lines, summary);
  appendSupplyActualRowCarryLines(lines, summary);
  appendKisInvestorFlowActualRowLines(lines, summary);
  appendGate1DistributionLines(lines, summary);
  appendGate1HydrationTraceLines(lines, summary);
  appendGate1SectorLines(lines, summary);

  return lines.join('\n');
}

function appendGate1OverviewLines(lines: string[], summary: Gate1MinimumSignalForensicSummaryAdr0505): void {
  lines.push('🧬 Gate1 Minimum Signal Forensic (ADR-0505)');
  lines.push(`- evaluationState=${summary.evaluationState} diagnosticEvaluated=${summary.evaluatedCandidateCount}/${summary.totalCandidates} traceOnly=${summary.traceOnlyCandidateCount}`);
  if (summary.evaluationState === 'EVALUATED') {
    lines.push(`- candidates=${summary.totalCandidates} failed=${summary.failedCandidates}`);
    lines.push(
      `- requiredAvg=${summary.requiredScoreAvg.toFixed(1)} actualAvg=${summary.actualScoreAvg.toFixed(1)} gap=${summary.avgScoreGap.toFixed(1)}`,
    );
  } else {
    lines.push(`- candidates=${summary.totalCandidates} failed=n/a (not live failure)`);
    lines.push(`- minScore=n/a diagnosticFallback=${summary.actualScoreAvg.toFixed(1)}`);
  }

  // dominant — failed > 0 일 때만 표시
  if (summary.failedCandidates > 0) {
    const dominant = pickTopDominant(summary.dominantFailureDistribution);
    if (dominant) lines.push(`- dominant=${dominant}`);
  }

  // missing — 1개 이상일 때만 표시
  const m = summary.missingPositiveSourceCounts;
  const missingParts: string[] = [];
  if (m.watchlistUpstreamMissing > 0) missingParts.push(`watchlist=${m.watchlistUpstreamMissing}`);
  if (missingParts.length > 0) lines.push(`- Gate1Missing: ${missingParts.join(' ')}`);
  const gate2MissingParts: string[] = [];
  if (m.relativeStrengthMissing > 0) gate2MissingParts.push(`rs=${m.relativeStrengthMissing}`);
  if (gate2MissingParts.length > 0) lines.push(`- Gate2Missing: ${gate2MissingParts.join(' ')}`);
  const gate3MissingParts: string[] = [];
  if (m.breakoutStructureMissing > 0) gate3MissingParts.push(`breakout=${m.breakoutStructureMissing}`);
  if (gate3MissingParts.length > 0) lines.push(`- Gate3Missing: ${gate3MissingParts.join(' ')}`);

  // penalties — 1개 이상일 때만 표시
  const p = summary.penaltyCounts;
  const penaltyParts: string[] = [];
  if (p.supplyUnknownPenalty > 0) penaltyParts.push(`supplyUnknown=${p.supplyUnknownPenalty}`);
  if (p.investorFlowUnknownPenalty > 0) penaltyParts.push(`investorUnknown=${p.investorFlowUnknownPenalty}`);
  if (p.sectorEnergyPenaltyOrBlocked > 0) penaltyParts.push(`sectorBlocked=${p.sectorEnergyPenaltyOrBlocked}`);
  if (penaltyParts.length > 0) lines.push(`- penalties: ${penaltyParts.join(' ')}`);

  // supplyScopeWarnings — 1개 이상일 때만 표시
  const w = summary.supplyScopeWarnings;
  const warnParts: string[] = [];
  if (w.KIS_FLOW_SYMBOL_MISSING > 0) warnParts.push(`symbolMissing=${w.KIS_FLOW_SYMBOL_MISSING}`);
  if (w.KIS_FLOW_SYMBOL_MISMATCH > 0) warnParts.push(`mismatch=${w.KIS_FLOW_SYMBOL_MISMATCH}`);
  if (w.KIS_FLOW_SEMANTIC_UNAVAILABLE > 0) warnParts.push(`semanticUnavailable=${w.KIS_FLOW_SEMANTIC_UNAVAILABLE}`);
  if (w.POSSIBLE_MARKET_WIDE_FLOW_IN_SYMBOL_SLOT > 0) {
    warnParts.push(`marketWide=${w.POSSIBLE_MARKET_WIDE_FLOW_IN_SYMBOL_SLOT}`);
  }
  if (warnParts.length > 0) lines.push(`- supplyScopeWarnings: ${warnParts.join(' ')}`);

}

function appendSupplySemanticCoverageLines(lines: string[], summary: Gate1MinimumSignalForensicSummaryAdr0505): void {
  const total = summary.totalCandidates;
  const rawAvailable = count(summary.rawInvestorRowAvailableCount);
  const displayUsable = count(summary.supplyDiagnosticAvailable);
  const gateEligible = count(summary.supplySemanticAvailable);
  const shadowObservable = Math.max(displayUsable, count(summary.forensicInputCarriesActualInvestorRowsCount));
  const semanticUnavailable = Math.max(0, total - gateEligible);
  lines.push('- Supply Layer Split:');
  lines.push(`  - Raw Provider Coverage: ${rawAvailable}/${total}`);
  lines.push(`  - Display/Preview Usable: ${displayUsable}/${total}`);
  lines.push(`  - Shadow Observable: ${shadowObservable}/${total}`);
  lines.push(`  - Gate Score Eligible: ${gateEligible}/${total}`);
  lines.push(`  - Live Promotion Eligible: 0/${total}`);
  lines.push(`  - Semantic Unavailable: ${semanticUnavailable}/${total}`);
  lines.push('  - ExecutionImpact: NONE');
  lines.push('  - MarketSignal: false');
  lines.push('  - ProviderIssueConvertedToBearish: false');
  lines.push('  - 안내: 수급 raw/display coverage와 Gate score eligible coverage는 다른 레이어입니다. displayUsable row는 Shadow/Watch 관측에는 사용할 수 있으나, live promotion이나 Gate score에는 별도 semantic eligibility를 통과해야 합니다.');
  lines.push(
    `- supplySemanticCoverage=${gateEligible}/${summary.totalCandidates} supplyDiagnosticRows=${displayUsable}/${summary.totalCandidates} semanticUnavailable=${semanticUnavailable} marketSignal=false`,
  );
  lines.push(
    `- supplySemantic: available=${gateEligible}/${summary.totalCandidates} diagnosticAvailable=${displayUsable}/${summary.totalCandidates}`,
  );
  const pseudoSkipped = summary.semanticReasonDistribution?.DIAGNOSTIC_SKIPPED_PSEUDO_SYMBOL ?? 0;
  if (pseudoSkipped > 0) {
    lines.push(`[SUPPLY_SEMANTIC_WIRE_SUMMARY] pseudoSkipped=${pseudoSkipped} reason=DIAGNOSTIC_SKIPPED_PSEUDO_SYMBOL executionImpact=NONE`);
  }
  lines.push(
    `- supplySemanticFields: foreignField=${count(summary.foreignNetBuyAvailable)}/${summary.totalCandidates} institutionField=${count(summary.institutionalNetBuyAvailable)}/${summary.totalCandidates} zeroButMaterialized=${count(summary.zeroButMaterializedCount)}`,
  );
  lines.push(`- semanticRowAvailable: ${count(summary.semanticRowAvailableCount)}/${summary.totalCandidates}`);
  lines.push(`- semanticRowMetadataOnly: ${count(summary.semanticRowMetadataOnlyCount)}/${summary.totalCandidates}`);
  lines.push(`- rawInvestorRowAvailable: ${count(summary.rawInvestorRowAvailableCount)}/${summary.totalCandidates}`);
  lines.push(`- selectedCandidateCarriesSemanticRow: ${count(summary.selectedCandidateCarriesSemanticRowCount)}/${summary.totalCandidates}`);
  lines.push(`- forensicInputCarriesSemanticRow: ${count(summary.forensicInputCarriesSemanticRowCount)}/${summary.totalCandidates}`);
  lines.push(`- forensicInputCarriesActualInvestorRows: ${count(summary.forensicInputCarriesActualInvestorRowsCount)}/${summary.totalCandidates}`);
  if (summary.semanticReasonDistribution) lines.push(`- semanticReasonDistribution: ${formatDistribution(summary.semanticReasonDistribution)}`);
  if (summary.kisRawFieldKeysTop) lines.push(`- kisRawFieldKeysTop: ${formatDistribution(summary.kisRawFieldKeysTop)}`);
}

function appendSupplySemanticUnwrapLines(lines: string[], summary: Gate1MinimumSignalForensicSummaryAdr0505): void {
  lines.push('- Supply Semantic Unwrap:');
  lines.push(`  - unwrapRows: ${Object.values(summary.selectedPathTop ?? {}).reduce((sum, count) => sum + count, 0)}/${summary.totalCandidates}`);
  lines.push(`  - rowCandidateCount: ${count(summary.rowCandidateCount)}`);
  lines.push(`  - selectedRowScore: ${(count(summary.selectedRowScoreAvg)).toFixed(1)}`);
  if (summary.selectedPathTop) lines.push(`  - selectedPathTop: ${formatDistribution(summary.selectedPathTop)}`);
  if (summary.actualNumericStringFieldKeysTop) lines.push(`  - actualNumericStringFieldKeysTop: ${formatDistribution(summary.actualNumericStringFieldKeysTop)}`);
  if (summary.actualRawFieldKeysTop) lines.push(`  - actualRawFieldKeysTop: ${formatDistribution(summary.actualRawFieldKeysTop)}`);
  if (summary.selectedActualRawFieldKeysTop) lines.push(`  - selectedActualRawFieldKeysTop: ${formatDistribution(summary.selectedActualRawFieldKeysTop)}`);
  if (summary.selectedNumericStringFieldKeysTop) lines.push(`  - selectedNumericStringFieldKeysTop: ${formatDistribution(summary.selectedNumericStringFieldKeysTop)}`);
  if (summary.actualNumberFieldKeysTop) lines.push(`  - actualNumberFieldKeysTop: ${formatDistribution(summary.actualNumberFieldKeysTop)}`);
  if (summary.actualPlaceholderFieldKeysTop) lines.push(`  - actualPlaceholderFieldKeysTop: ${formatDistribution(summary.actualPlaceholderFieldKeysTop)}`);
  if (summary.candidateNetBuyFieldKeysTop) lines.push(`  - candidateNetBuyFieldKeysTop: ${formatDistribution(summary.candidateNetBuyFieldKeysTop)}`);
  if (summary.rejectedWrapperPathsTop) lines.push(`  - rejectedWrapperPathsTop: ${formatDistribution(summary.rejectedWrapperPathsTop)}`);
  lines.push(`  - wrapperOnlyCount: ${count(summary.wrapperOnlyCount)}`);
  lines.push(`  - numericCandidateCount: ${count(summary.numericCandidateCount)}`);
  lines.push(`  - aliasCandidateCount: ${count(summary.aliasCandidateCount)}`);
  if (summary.semanticRowBreakPointDistribution) lines.push(`  - semanticRowBreakPointDistribution: ${formatDistribution(summary.semanticRowBreakPointDistribution)}`);
  lines.push(`  - semanticAvailable: ${count(summary.supplySemanticAvailable)}/${summary.totalCandidates}`);
  lines.push(`  - zeroButMaterialized: ${count(summary.zeroButMaterializedCount)}`);
}

function appendSupplyActualRowCarryLines(lines: string[], summary: Gate1MinimumSignalForensicSummaryAdr0505): void {
  lines.push('- Supply Actual Row Carry:');
  lines.push(`  - adapterCarriesActualRow: ${count(summary.rawInvestorRowAvailableCount)}/${summary.totalCandidates}`);
  lines.push(`  - routerCarriesActualRow: ${count(summary.selectedCandidateCarriesActualRowCount)}/${summary.totalCandidates}`);
  // ADR-0477 supply actual row carry diagnostic — adapter (KIS) 가 actual row 보유했지만
  // selectedProvider != KIS_API 인 경우에도 router 가 carry. 사용자 명시 #6 단절 진단 (47/47 vs 0/47).
  lines.push(`  - adapterRowsForwardedAcrossProviders: ${count(summary.adapterRowsForwardedAcrossProvidersCount)}/${summary.totalCandidates}`);
  // INVESTOR-FLOW-ACTUAL-ROW-CARRY-WIRING-001 — diagnostic actual row carry 진단 (selectedProvider 무관).
  lines.push(`  - diagnosticActualInvestorRowCarried: ${count(summary.diagnosticActualInvestorRowCarriedCount)}/${summary.totalCandidates}`);
  lines.push(`  - kisNormalizedRowsMaterialized: ${count(summary.kisNormalizedRowsMaterialized)}/${summary.totalCandidates}`);
  lines.push(`  - kisSemanticRowsMaterialized: ${count(summary.kisSemanticRowsMaterialized)}/${summary.totalCandidates}`);
  lines.push(`  - normalizedRowsPromotedToDiagnosticActualRow: ${count(summary.normalizedRowsPromotedToDiagnosticActualRow)}/${summary.totalCandidates}`);
  lines.push(`  - normalizedMetadataOnlyRows: ${count(summary.normalizedMetadataOnlyRows)}/${summary.totalCandidates}`);
  lines.push(`  - semanticMetadataOnlyRows: ${count(summary.semanticMetadataOnlyRows)}/${summary.totalCandidates}`);
  lines.push(`  - bySymbolDiagnosticActualRowFromNormalized: ${count(summary.bySymbolDiagnosticActualRowFromNormalized)}/${summary.totalCandidates}`);
  lines.push(`  - sellOnlyBySymbolPayloadFromNormalized: ${count(summary.sellOnlyBySymbolPayloadFromNormalized)}/${summary.totalCandidates}`);
  lines.push(`  - semanticFromNormalizedActualRow: ${count(summary.semanticFromNormalizedActualRow)}/${summary.totalCandidates}`);
  lines.push(`  - investorRowMaterializationClass: ${formatDistribution(summary.investorRowMaterializationClassDistribution ?? {})}`);
  lines.push(`  - selectedProviderActualRow: ${count(summary.selectedProviderActualRowCount)}/${summary.totalCandidates}`);
  lines.push(`  - diagnosticOnlyActualRow: ${count(summary.diagnosticOnlyActualRowCount)}/${summary.totalCandidates}`);
  lines.push(`  - actualInvestorRowProvider: ${formatDistribution(summary.actualInvestorRowProviderDistribution ?? {})}`);
  lines.push(`  - actualInvestorRowUseScope: ${formatDistribution(summary.actualInvestorRowUseScopeDistribution ?? {})}`);
  lines.push(`  - forensicCarriesActualRow: ${count(summary.forensicInputCarriesActualInvestorRowsCount)}/${summary.totalCandidates}`);
  lines.push(`  - actualRowsCarried: ${count(summary.forensicInputCarriesActualInvestorRowsCount)}/${summary.totalCandidates}`);
  lines.push(`  - sellOnlyBySymbolPayloadAvailable: ${count(summary.sellOnlyBySymbolPayloadAvailableCount)}/${summary.totalCandidates}`);
  lines.push(`  - sellOnlyBySymbolPayloadMerged: ${count(summary.sellOnlyBySymbolPayloadMergedCount)}/${summary.totalCandidates}`);
  lines.push(`  - sellOnlyActualRowsCarried: ${count(summary.sellOnlyActualRowsCarriedCount)}/${summary.totalCandidates}`);
  lines.push(`  - sellOnlyCarryBreakPoint: ${formatDistribution(summary.sellOnlyCarryBreakPointDistribution ?? {})}`);
  lines.push(`  - fieldKeysTop: ${formatDistribution(summary.actualInvestorRowFieldKeysTop ?? {})}`);
  lines.push(`  - numericKeysTop: ${formatDistribution({ ...(summary.actualInvestorNumericStringKeysTop ?? {}), ...(summary.actualInvestorNumberKeysTop ?? {}) })}`);
  lines.push(`  - forensicActualRowCount: ${count(summary.forensicInputCarriesActualInvestorRowsCount)}/${summary.totalCandidates}`);
  lines.push(`  - forensicActualRowFieldKeysTop: ${formatDistribution(summary.actualInvestorRowFieldKeysTop ?? {})}`);
  lines.push(`  - forensicActualRowNumericKeysTop: ${formatDistribution({ ...(summary.actualInvestorNumericStringKeysTop ?? {}), ...(summary.actualInvestorNumberKeysTop ?? {}) })}`);
  lines.push(`  - breakPointTop: ${formatDistribution(summary.semanticRowBreakPointDistribution ?? {})}`);
  lines.push(`  - nextAction: ${resolveSupplySemanticUnwrapNextAction(summary)}`);
}

function appendKisInvestorFlowActualRowLines(lines: string[], summary: Gate1MinimumSignalForensicSummaryAdr0505): void {
  lines.push('- KIS Investor Flow Actual Row:');
  lines.push(`  - actualRowsCarried: ${count(summary.forensicInputCarriesActualInvestorRowsCount)}/${summary.totalCandidates}`);
  lines.push(`  - sellOnlyBySymbolPayloadAvailable: ${count(summary.sellOnlyBySymbolPayloadAvailableCount)}/${summary.totalCandidates}`);
  lines.push(`  - sellOnlyBySymbolPayloadMerged: ${count(summary.sellOnlyBySymbolPayloadMergedCount)}/${summary.totalCandidates}`);
  lines.push(`  - sellOnlyActualRowsCarried: ${count(summary.sellOnlyActualRowsCarriedCount)}/${summary.totalCandidates}`);
  lines.push(`  - sellOnlyCarryBreakPoint: ${formatDistribution(summary.sellOnlyCarryBreakPointDistribution ?? {})}`);
  lines.push(`  - selectedPathTop: ${formatDistribution(summary.actualInvestorRowPathDistribution ?? {})}`);
  lines.push(`  - numericStringKeysTop: ${formatDistribution(summary.actualInvestorNumericStringKeysTop ?? {})}`);
  lines.push(`  - numberKeysTop: ${formatDistribution(summary.actualInvestorNumberKeysTop ?? {})}`);
  lines.push(`  - fieldKeysTop: ${formatDistribution(summary.actualInvestorRowFieldKeysTop ?? {})}`);
  lines.push(`  - wrapperOnly: ${count(summary.wrapperOnlyCount)}/${summary.totalCandidates}`);
  lines.push(`  - breakPoint: ${formatDistribution(summary.semanticRowBreakPointDistribution ?? {})}`);
  lines.push(`  - nextAction: ${resolveSupplySemanticUnwrapNextAction(summary)}`);
}

function appendGate1DistributionLines(lines: string[], summary: Gate1MinimumSignalForensicSummaryAdr0505): void {
  if (summary.kisNormalizedFieldKeysTop) lines.push(`- kisNormalizedFieldKeysTop: ${formatDistribution(summary.kisNormalizedFieldKeysTop)}`);
  if (summary.kisSemanticFieldKeysTop) lines.push(`- kisSemanticFieldKeysTop: ${formatDistribution(summary.kisSemanticFieldKeysTop)}`);
  if (summary.semanticRowBreakPointDistribution) lines.push(`- semanticRowBreakPointDistribution: ${formatDistribution(summary.semanticRowBreakPointDistribution)}`);
  if (summary.sampleValueKindDistribution) lines.push(`- sampleValueKinds: ${formatDistribution(summary.sampleValueKindDistribution)}`);
  if (summary.mappedFieldDistribution) {
    lines.push(`- mappedFieldDistribution: foreign=${formatDistribution(summary.mappedFieldDistribution.foreign)} institution=${formatDistribution(summary.mappedFieldDistribution.institution)} individual=${formatDistribution(summary.mappedFieldDistribution.individual)}`);
  }
  if (summary.providerScopeDistribution) lines.push(`- providerScopeDistribution: ${formatDistribution(summary.providerScopeDistribution)}`);
  if (summary.scoreUsageDistribution) lines.push(`- scoreUsageDistribution: ${formatDistribution(summary.scoreUsageDistribution)}`);
  if (summary.supplyUnknownRootCauseDistribution) lines.push(`- supplyUnknownRootCause: ${formatDistribution(summary.supplyUnknownRootCauseDistribution)}`);
  lines.push(
    `- supplyRouterForensicConflict=${summary.supplyRouterForensicConflict === true} routerStatus=${summary.routerStatus ?? 'UNKNOWN'} routerSignal=${summary.routerSignal ?? 'UNKNOWN'} forensicSemanticAvailable=${summary.forensicSemanticAvailable ?? `${count(summary.supplySemanticAvailable)}/${summary.totalCandidates}`} conflictReason=${summary.routerForensicConflictReason ?? 'NONE'}`,
  );
}

function appendGate1HydrationTraceLines(lines: string[], summary: Gate1MinimumSignalForensicSummaryAdr0505): void {
  lines.push(`- watchlistImported: ${count(summary.watchlistScoreImportedCount)}/${summary.totalCandidates}`);
  lines.push(`- rsScoreUsable: ${summary.rsScoreUsableCount ?? count(summary.rsHydrationAvailableCount)}/${summary.totalCandidates}`);
  lines.push(`- breakoutScoreUsable: ${summary.breakoutScoreUsableCount ?? count(summary.breakoutHydrationAvailableCount)}/${summary.totalCandidates}`);
  lines.push(`- supplySymbolMatched: ${summary.symbolMatchedCount ?? count(summary.supplySymbolMatchedCount)}/${summary.totalCandidates}`);
  lines.push(`- supplySymbolInferred: ${count(summary.inferredSymbolMatchedCount)}/${summary.totalCandidates}`);
  lines.push(
    `- traceCompleteness: quote ${summary.traceWithQuoteCount ?? count(summary.candidateTraceHasQuote)}/${summary.totalCandidates}, symbolFeatures ${summary.traceWithSymbolFeaturesCount ?? count(summary.candidateTraceHasSymbolFeatures)}/${summary.totalCandidates}, conditionResults ${summary.traceWithConditionResultsCount ?? count(summary.candidateTraceHasConditionResults)}/${summary.totalCandidates}`,
  );
  const topHydrationMissingFields = summary.topHydrationMissingFields ?? [];
  if (topHydrationMissingFields.length > 0) {
    lines.push(`- topMissingFields: ${topHydrationMissingFields.slice(0, 4).join(', ')}`);
  }
  lines.push(`- rsTraceAvailable: ${summary.rsTraceAvailableCount ?? count(summary.rsHydrationAvailableCount)}/${summary.totalCandidates}`);
  lines.push(`- breakoutTraceAvailable: ${summary.breakoutTraceAvailableCount ?? count(summary.breakoutHydrationAvailableCount)}/${summary.totalCandidates}`);
  if (summary.watchlistSourceFieldDistribution) {
    lines.push(`- watchlistSourceFieldDistribution: ${formatDistribution(summary.watchlistSourceFieldDistribution)}`);
  }
  if (summary.watchlistScoreScaleDistribution) {
    lines.push(`- watchlistScoreScaleDistribution: ${formatDistribution(summary.watchlistScoreScaleDistribution)}`);
  }
  if (summary.watchlistScoreScaleDistributionBefore) {
    lines.push(`- watchlistScoreScaleDistributionBefore: ${formatDistribution(summary.watchlistScoreScaleDistributionBefore)}`);
  }
  lines.push(
    `- watchlistScoreNormalized=${count(summary.watchlistScoreNormalizedCount ?? summary.watchlistScoreNormalized)}/${summary.totalCandidates} watchlistScoreMissing=${count(summary.watchlistScoreMissingCount ?? summary.watchlistScoreMissing)} watchlistScoreScaleFixed=${count(summary.watchlistScoreScaleFixedCount ?? summary.watchlistScoreScaleFixed)} promotionScoreCopied=${count(summary.promotionScoreCopiedCount ?? summary.promotionScoreCopied)}`,
  );
  if (summary.watchlistScoreScaleDistributionAfter) {
    lines.push(`- watchlistScoreScaleDistributionAfter: ${formatDistribution(summary.watchlistScoreScaleDistributionAfter)}`);
  }
  if (summary.watchlistScoreNormalizationBreakPoint) {
    lines.push(`- watchlistScoreNormalizationBreakPoint: ${formatDistribution(summary.watchlistScoreNormalizationBreakPoint)}`);
  }
  lines.push(`- watchlistScoreAvg: ${(count(summary.watchlistScoreAvg)).toFixed(1)}`);
  lines.push('- Gate1 Runtime Calibration:');
  lines.push(`  - scoreNormalized: ${count(summary.watchlistScoreNormalizedCount ?? summary.watchlistScoreNormalized)}/${summary.totalCandidates}`);
  lines.push(`  - technicalProjected: ${count(summary.technicalProjectedCount)}/${summary.totalCandidates}`);
  lines.push(`  - rsUsable: ${count(summary.rsScoreUsableCount)}/${summary.totalCandidates}`);
  lines.push(`  - maAlignmentPolicy: DAMPENER`);
  lines.push(`  - hardTechnicalDeath: ${count(summary.technicalTrendDeathCount ?? summary.technicalTrendDeathHardBlockCount)}`);
  lines.push(`  - supplyMissingNeutralized: ${count(summary.supplyMissingNeutralizedCount ?? summary.supplyMissingNeutralized)}`);
  lines.push('  - executionImpact: NONE');
  lines.push('  - shadowLearning: true');
  lines.push('  - counterfactualRecorded: true');
  if (summary.technicalProjectionCoverage) {
    lines.push(`- technicalProjectionCoverage: ${formatDistribution(summary.technicalProjectionCoverage)}`);
  }
  lines.push(
    `- maAlignmentComputed=${count(summary.maAlignmentComputedCount ?? summary.maAlignmentComputed)}/${summary.totalCandidates} aboveMA20Available=${count(summary.aboveMA20AvailableCount)}/${summary.totalCandidates} aboveMA60Available=${count(summary.aboveMA60AvailableCount)}/${summary.totalCandidates} return5dAvailable=${count(summary.return5dAvailableCount ?? summary.return5dAvailable)}/${summary.totalCandidates} return20dAvailable=${count(summary.return20dAvailableCount ?? summary.return20dAvailable)}/${summary.totalCandidates}`,
  );
  if (summary.technicalProjectionBreakPoint) {
    lines.push(`- technicalProjectionBreakPoint: ${formatDistribution(summary.technicalProjectionBreakPoint)}`);
  }
  lines.push(`- technicalComputedButProjectionMissing=${count(summary.technicalComputedButProjectionMissingCount)}`);
  lines.push(
    `- maAlignmentPolicy=${summary.maAlignmentPolicy ?? 'ADVISORY_DAMPENER'} dampener=${count(summary.maAlignmentDampenerCount ?? summary.maAlignmentAdvisoryOnlyCount)} hardBlock=${count(summary.maAlignmentHardBlockCount)} technicalTrendDeath=${count(summary.technicalTrendDeathCount ?? summary.technicalTrendDeathHardBlockCount)} topGate1BlockReasonAfter=${summary.topGate1BlockReasonAfter ?? 'TECHNICAL_MA_ALIGNMENT_DAMPENER'}`,
  );
  if (summary.rsBreakPointDistribution) lines.push(`- rsBreakPointDistribution: ${formatDistribution(summary.rsBreakPointDistribution)}`);
  lines.push(`- rsComputedFromReturn20d=${count(summary.rsComputedFromReturn20dCount)} rsIndexFallbackUsed=${count(summary.rsIndexFallbackUsedCount)} rsTraceButScoreMissingBreakPoint=${formatDistribution(summary.rsTraceButScoreMissingBreakPoint ?? {})}`);
  lines.push(`- breakoutAdvisoryOnly=${summary.breakoutAdvisoryOnly === true} breakoutUsedForGate1Block=${String(summary.breakoutUsedForGate1Block ?? false)}`);
  lines.push(
    `- supplyMissingNeutralized=${count(summary.supplyMissingNeutralizedCount ?? summary.supplyMissingNeutralized)} supplyMissingExecutionImpact=${summary.supplyMissingExecutionImpact ?? 'NONE'} supplyMissingMarketSignal=${String(summary.supplyMissingMarketSignal ?? false)} supplyRowMissingLearningTag=${count(summary.supplyRowMissingLearningTagCount)} learningTag=${formatDistribution(summary.supplyMissingLearningTagDistribution ?? {})}`,
  );
  const candidateCount = summary.totalCandidates;
  const candidateTraceContainer = summary.candidateTraceContainerCount ?? candidateCount;
  const conditionResultsContainer = summary.conditionResultsContainerCount ?? candidateCount;
  const fullComputedTrace = summary.computedTechnicalTraceCount ?? 0;
  const traceWithConditionResults = summary.traceWithConditionResultsCount ?? count(summary.candidateTraceHasConditionResults);
  const skeletonOnlyTrace = Math.max(0, traceWithConditionResults - fullComputedTrace);
  const missingTraceContainer = Math.max(0, candidateCount - candidateTraceContainer);

  lines.push('- ConditionResults Projection:');
  lines.push(`  - candidateCount: ${candidateCount}`);
  lines.push(`  - candidateTraceContainer: ${candidateTraceContainer}/${candidateCount}`);
  lines.push(`  - conditionResultsContainer: ${conditionResultsContainer}/${candidateCount}`);
  lines.push(`  - fullComputedTrace: ${fullComputedTrace}/${candidateCount}`);
  lines.push(`  - skeletonOnlyTrace: ${skeletonOnlyTrace}/${candidateCount}`);
  lines.push(`  - missingTraceContainer: ${missingTraceContainer}/${candidateCount}`);
  lines.push(`  - computedTechnicalTraceCount: ${fullComputedTrace}/${candidateCount}`);
  lines.push(`  - traceWithConditionResultsCount: ${traceWithConditionResults}/${candidateCount}`);
  lines.push('  - executionImpact: NONE');
  lines.push('  - marketSignal: false');
  lines.push('  - note: ConditionResults container coverage와 full computed technical trace coverage는 다른 개념입니다. Skeleton-only trace는 후보가 누락된 것이 아니라, 일부 기술 필드가 부족하여 UNAVAILABLE/DIAGNOSTIC_ONLY로 기록된 설명용 trace입니다.');

  if (summary.sourcePathDistribution) {
    const full = summary.sourcePathDistribution.ENTRY_FILTER_GATE1_CANDIDATE_TRACE ?? 0;
    lines.push(`- sourcePathDistribution: ENTRY_FILTER_GATE1_CANDIDATE_TRACE_FULL=${full}, ENTRY_FILTER_GATE1_CANDIDATE_TRACE_SKELETON=${skeletonOnlyTrace}, ENTRY_FILTER_GATE1_CANDIDATE_TRACE_TOTAL=${traceWithConditionResults}`);
    lines.push(`- TraceContainerDistribution: FULL_COMPUTED=${fullComputedTrace}, SKELETON_ONLY=${skeletonOnlyTrace}, MISSING=${missingTraceContainer}, TOTAL=${candidateCount}`);
  }
  if (summary.watchlistBreakPointDistribution) lines.push(`- watchlistBreakPoint: ${formatDistribution(summary.watchlistBreakPointDistribution)}`);
  if (summary.quoteHydrationBreakPointDistribution) lines.push(`- quoteHydrationBreakPoint: ${formatDistribution(summary.quoteHydrationBreakPointDistribution)}`);
  if (summary.conditionResultsBreakPointDistribution) {
    lines.push(`- conditionResultsBreakPoint: CONDITION_RESULTS_PROJECTED_FULL=${fullComputedTrace}, CONDITION_RESULTS_SKELETON_ONLY=${skeletonOnlyTrace}, CONDITION_RESULTS_MISSING=${missingTraceContainer}`);
  }
  if (skeletonOnlyTrace > 0) {
    const quoteMissing = summary.quoteHydrationBreakPointDistribution?.QUOTE_FETCHED_NOT_COPIED ?? 0;
    const technicalMissing = summary.technicalProjectionBreakPointDistribution?.TECHNICAL_STATUS_COMPUTED_FIELD_MISSING ?? 0;
    lines.push(`- skeletonOnlyReasonTop: QUOTE_RETURN_FIELD_MISSING=${quoteMissing}, TECHNICAL_FIELD_NOT_COMPUTED=${technicalMissing}`);
  }
  lines.push(`- nextAction: ${resolveGate1ForensicNextAction(summary)}`);
}

function appendGate1SectorLines(lines: string[], summary: Gate1MinimumSignalForensicSummaryAdr0505): void {
  // SectorEnergy — 강제 노출 (운영자 인지 의무)
  lines.push(
    `- SectorEnergy: boost=0 strongBuyBlocked=${summary.sectorEnergyStrongBuyBlockedCount} hardBlock=${summary.sectorEnergyHardBlockCount}`,
  );
  lines.push('- executionImpact=NONE live=false');
}

/* ───────── 보조 헬퍼 ───────── */

const GATE1_SEMANTIC_REASON_ACTIONS: Record<string, string> = {
  SEMANTIC_ROW_METADATA_ONLY: 'WIRE_KIS_SELECTED_CANDIDATE_SEMANTIC_ROW',
  ROUTER_DROPPED_SEMANTIC_ROW: 'WIRE_KIS_SELECTED_CANDIDATE_SEMANTIC_ROW',
  FORENSIC_INPUT_DROPPED_SEMANTIC_ROW: 'WIRE_KIS_SELECTED_CANDIDATE_SEMANTIC_ROW',
  FIELD_ALIAS_NOT_MAPPED: 'MAP_KIS_NETBUY_FIELDS',
  NO_FOREIGN_OR_INSTITUTION_FIELD: 'MAP_KIS_NETBUY_FIELDS',
  ROW_MAPPING_FAILED: 'MAP_INVESTOR_TYPE_ROWS_TO_NETBUY',
  ONLY_MARKET_LEVEL_FLOW: 'REJECT_MARKET_LEVEL_FLOW_FOR_SYMBOL_SCORE',
  ONLY_SECTOR_LEVEL_FLOW: 'REJECT_MARKET_LEVEL_FLOW_FOR_SYMBOL_SCORE',
};

export function resolveGate1ForensicNextAction(summary: Gate1MinimumSignalForensicSummaryAdr0505): string {
  const topSemanticReason = pickTopDistributionKey(summary.semanticReasonDistribution ?? {});
  const semanticAction = topSemanticReason ? GATE1_SEMANTIC_REASON_ACTIONS[topSemanticReason] : undefined;
  return semanticAction ?? resolveGate1ForensicFallbackAction(summary);
}

function resolveGate1ForensicFallbackAction(summary: Gate1MinimumSignalForensicSummaryAdr0505): string {
  const checks: Array<[boolean, string]> = [
    [(count(summary.zeroButMaterializedCount)) > 0, 'OBSERVE_ZERO_NEUTRAL_SUPPLY'],
    [(count(summary.watchlistScoreImportedCount)) === 0, 'WIRE_WATCHLIST_UPSTREAM_SCORE'],
    [(summary.traceWithQuoteCount ?? count(summary.candidateTraceHasQuote)) === 0, 'WIRE_QUOTE_FEATURES_TO_FORENSIC_TRACE'],
    [(summary.traceWithConditionResultsCount ?? count(summary.candidateTraceHasConditionResults)) === 0, 'WIRE_CONDITION_RESULTS_TO_FORENSIC_TRACE'],
    [(summary.rsTraceAvailableCount ?? count(summary.rsHydrationAvailableCount)) === 0, 'WIRE_RS_RETURN_FEATURES'],
    [(summary.breakoutTraceAvailableCount ?? count(summary.breakoutHydrationAvailableCount)) === 0, 'WIRE_BREAKOUT_CONDITION_RESULTS'],
    [(summary.symbolMatchedCount ?? count(summary.supplySymbolMatchedCount)) === 0 && summary.totalCandidates > 0, 'WIRE_SYMBOL_LEVEL_SUPPLY'],
  ];
  for (const [matched, action] of checks) {
    if (matched) return action;
  }
  return 'OBSERVE_3D_THEN_REVIEW';
}

function resolveSupplySemanticUnwrapNextAction(summary: Gate1MinimumSignalForensicSummaryAdr0505): string {
  const breakPoint = pickTopDistributionKey(summary.semanticRowBreakPointDistribution ?? {});
  if (breakPoint === 'ADAPTER_DID_NOT_ATTACH_ACTUAL_ROW' || breakPoint === 'ACTUAL_ROW_CARRIED_BUT_EMPTY') return 'WIRE_ADAPTER_ACTUAL_ROW';
  if (breakPoint === 'ROUTER_SELECTED_CANDIDATE_DROPPED_ACTUAL_ROW') return 'WIRE_ROUTER_SELECTED_CANDIDATE_ACTUAL_ROW';
  if (breakPoint === 'FORENSIC_COLLECTOR_DROPPED_ACTUAL_ROW') return 'WIRE_FORENSIC_COLLECTOR_ACTUAL_ROW';
  if (breakPoint === 'ACTUAL_ROW_CARRIED_ALIAS_NOT_MAPPED' || breakPoint === 'NUMERIC_FIELDS_FOUND_BUT_NOT_RECOGNIZED' || breakPoint === 'NESTED_ROW_UNWRAPPED_BUT_ALIAS_NOT_MAPPED') return 'ADD_ALIAS_FOR_ACTUAL_NUMERIC_KEYS';
  if (breakPoint === 'ROW_ARRAY_FOUND_BUT_INVESTOR_TYPE_NOT_MAPPED') return 'MAP_INVESTOR_TYPE_ROWS';
  if (breakPoint === 'ONLY_WRAPPER_METADATA' || breakPoint === 'NO_ROW_FOUND') return 'WIRE_SELECTED_CANDIDATE_ACTUAL_ROW';
  if ((count(summary.zeroButMaterializedCount)) > 0) return 'OBSERVE_ZERO_NEUTRAL_SUPPLY';
  return 'OBSERVE_ZERO_NEUTRAL_SUPPLY';
}

function count(value: number | null | undefined): number {
  return value ?? 0;
}

function pickTopDistributionKey(distribution: Record<string, number>): string | null {
  const top = Object.entries(distribution).filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1])[0];
  return top?.[0] ?? null;
}

function formatDistribution(distribution: Record<string, number>): string {
  return Object.entries(distribution)
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([key, value]) => `${key}=${value}`)
    .join(', ') || 'none';
}

function pickTopDominant(distribution: Record<DominantFailureReason, number>): DominantFailureReason | null {
  let top: DominantFailureReason | null = null;
  let topCount = 0;
  for (const [k, v] of Object.entries(distribution)) {
    if (v > topCount) {
      topCount = v;
      top = k as DominantFailureReason;
    }
  }
  return top;
}

function round1(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10) / 10;
}
