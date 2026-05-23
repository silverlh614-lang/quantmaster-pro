/**
 * @responsibility Telegram scan blockers message formatter.
 * ADR-0001 scan diagnostics core split.
 */

import { describeEmptyScanReason } from '../emptyScanClassifier.js';
import { formatPreflightBlockedScanSection, getLastPreflightBlockedScanSummary } from '../preflightBlockedScanSummary.js';
import { formatR3NoiseGovernorCompactLine } from '../r3NoiseGovernor.js';
import { formatPreBreakoutWaitSummarySection } from '../preBreakoutWaitPolicy.js';
import { formatShadowNearBreakoutSection, type ShadowNearBreakoutBlockReason } from '../shadowNearBreakoutEntryPolicy.js';
import { formatFreshAttributionSection } from '../freshScanBlockerAttribution.js';
import { formatGate2AttributionSection, rebindGate2AttributionToSectorEnergyMasterAdr0488 } from '../gate2LeadershipAttribution.js';
import {
  formatSectorEnergyQualityDiagnosticSection,
  type SectorEnergyQualityDiagnostic,
} from '../../../clients/sectorEnergyQualityDiagnostic.js';
import { formatGate1MinimumSignalForensicSection } from '../gate1MinimumSignalForensicAuditAdr0505.js';
import { formatGateDecisionRouterSection } from '../gateDecisionRouter.js';
import { formatProvisionalShadowSection } from '../provisionalShadowLane.js';
import { formatCounterfactualShadowLearningSection } from '../counterfactualShadowLearningLane.js';
import { formatGateEligibilitySplitSection } from '../gateEligibilitySection.js';
import { formatGateReclassificationDryRunSection } from '../../../learning/gateReclassificationDryRun.js';
import { formatEntryFilterDecompositionSection } from '../entryFilterDecomposition.js';
import { formatPositiveScoreStarvationReport } from '../gate1PositiveScoreStarvation.js';
import { formatGate1ScoreCeilingRepairReport } from '../gate1ScoreCeilingRepair.js';
import { formatPenaltyDeduplicationReport } from '../gate1PenaltyDeduplication.js';
import { formatRiskDoubleCountAuditReport } from '../gate1RiskDoubleCount.js';
import { formatFinalGate1CalibrationReport } from '../gate1FinalCalibration.js';
import { formatGate1ScoringAlignmentReport } from '../gate1ScoringAlignmentAdr0472.js';
import { formatGate1PositiveSourceWiringReport } from '../gate1PositiveSourceWiringAdr0475.js';
import { formatGate1DryRunObservationSummary } from '../gate1DryRunObservationLedgerAdr0476.js';
import { formatInvestorFlowProviderRouterAdr0477 } from '../investorFlowProviderRouterAdr0477.js';
import { type PaperEntryCandidateForensic, type PaperEntryDecisionRecord, type ScanSummary } from './scanSummaryTypes.js';
import { formatGateScoreCandidateBucketSection, formatGateScoreHealthSection } from './gateScoreDiagnostics.js';
import { formatGate1SurvivalAuditSection, formatGate2CoverageAuditSection } from './gateLayerDiagnostics.js';
import { formatScanEvaluationSection } from '../state/scanEvaluationState.js';
import { emitScanDiagnosticBuildFailedWarn } from '../state/scanDiagnosticSuppressor.js';
import { formatFrozenQuoteSection, formatPriceCorrectionOverlaySection, formatPriceIntegritySection, formatR3StreakSkipLine } from './sectionFormatters.js';
import { getRegimePositionPolicy } from '../../sizing/regimePositionPolicy.js';
import { formatCandidatePoolSection, type CandidateFeatureCoverageDiagnostics, type CandidatePoolResult } from '../../candidatePoolBuilder.js';
import {
  buildCanonicalRuntimeResolutionStep27,
  type CanonicalRuntimeResolutionStep27,
  rebindGate1ForensicSummaryToCanonicalStep27,
  rebindGate1ScoreCeilingRepairReportToCanonicalStep27,
  rebindGate1ScoringAlignmentReportToCanonicalStep27,
  rebindPositiveScoreStarvationReportToCanonicalStep27,
  formatGatePositiveRuntimeAlignmentSection,
} from '../runtimeResolverTraceStep26.js';

function formatterGetByPath(obj: unknown, path: string): unknown {
  let current: unknown = obj;
  for (const key of path.split('.')) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function formatterFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function formatterRatioFromMaybePercent(value: unknown): number {
  if (!formatterFiniteNumber(value)) return 0;
  return value > 1 ? Math.max(0, Math.min(1, value / 100)) : Math.max(0, Math.min(1, value));
}

function sectorEnergyQualityDiagnosticForDisplay(summary: ScanSummary): SectorEnergyQualityDiagnostic | undefined {
  const diagnostic = summary.sectorEnergyQualityDiagnostic;
  const sectorMaster = summary.sectorEnergySupplyUnknownAdr0488?.sectorEnergyMaster;
  if (!diagnostic || !sectorMaster) return diagnostic;

  const groupedValidSectorCount =
    sectorMaster.internalGroupedValidSectorCount ??
    diagnostic.groupedSectorEnergy?.groupedValidSectorCount;
  const groupedExpectedSectorCount =
    sectorMaster.internalGroupedExpectedSectorCount ??
    diagnostic.groupedSectorEnergy?.expectedSectorCount;

  return {
    ...diagnostic,
    indexCodeCoverage: formatterRatioFromMaybePercent(sectorMaster.officialIndexCoverage),
    officialIndexCoverage: formatterRatioFromMaybePercent(sectorMaster.officialIndexCoverage),
    internalGroupedSnapshotCoverage: formatterRatioFromMaybePercent(
      sectorMaster.internalGroupedSnapshotCoverage ?? sectorMaster.internalProxyCoverage,
    ),
    ...(groupedValidSectorCount !== undefined ? { internalGroupedValidSectorCount: groupedValidSectorCount } : {}),
    ...(groupedExpectedSectorCount !== undefined ? { internalGroupedExpectedSectorCount: groupedExpectedSectorCount } : {}),
    internalProxyCoverage: formatterRatioFromMaybePercent(sectorMaster.internalProxyCoverage),
    stockBasketCoverage: formatterRatioFromMaybePercent(sectorMaster.stockDailyFallbackCoverage),
    selectedSectorEnergySourceTier: sectorMaster.selectedSectorEnergySourceTier,
    leadershipConfidence: sectorMaster.leadershipConfidence,
    promotionAllowed: sectorMaster.promotionAllowed,
    shadowLeadershipAllowed: sectorMaster.shadowLeadershipAllowed,
    counterfactualAllowed: sectorMaster.counterfactualAllowed,
    reasonCodes: sectorMaster.reasonCodes,
  };
}

function formatterComponentTrace(row: unknown, code: string): Record<string, unknown> | undefined {
  const components =
    formatterGetByPath(row, 'minSignalScoreTrace.components') ??
    formatterGetByPath(row, 'gate1Trace.minSignalScoreTrace.components');
  if (!Array.isArray(components)) return undefined;
  return components.find((component) =>
    component &&
    typeof component === 'object' &&
    (component as Record<string, unknown>).code === code,
  ) as Record<string, unknown> | undefined;
}

function formatterComponentConnected(component: Record<string, unknown> | undefined): boolean {
  return Boolean(component && component.confidence !== 'MISSING');
}

function formatterHasAnyPath(row: unknown, paths: readonly string[]): boolean {
  return paths.some((path) => formatterGetByPath(row, path) !== undefined);
}

function formatterComponentAppliedCount(rows: readonly unknown[], code: string): number {
  return rows.filter((row) => formatterComponentConnected(formatterComponentTrace(row, code))).length;
}

function buildCandidateFeatureCoverageFromSummary(
  summary: ScanSummary,
  canonical: CanonicalRuntimeResolutionStep27,
): CandidateFeatureCoverageDiagnostics | undefined {
  const candidatePool = summary.candidatePool;
  if (!candidatePool) return undefined;

  const forensic = summary.gate1MinimumSignalForensicAdr0505;
  const total = summary.candidates || forensic?.totalCandidates || candidatePool.validCount || candidatePool.candidateSnapshots.length;
  const traces = (summary.entryFilterDecomposition?.candidateTraces ?? []) as unknown[];
  const minSignalTraces = (summary.entryFilterDecomposition?.minSignalScoreTraces ?? []) as unknown[];
  const rsComponentApplied = Math.max(
    formatterComponentAppliedCount(traces, 'RELATIVE_STRENGTH'),
    formatterComponentAppliedCount(minSignalTraces, 'RELATIVE_STRENGTH'),
  );
  const rsRawComputed = Math.max(
    rsComponentApplied,
    forensic?.rsScoreUsableCount ?? 0,
    forensic?.rsHydrationAvailableCount ?? 0,
  );

  const breakoutPaths = [
    'breakout_momentum', 'turtle_high', 'volume_breakout', 'volume_surge', 'vcp', 'trend_acceleration',
    'breakoutSignals.breakout_momentum', 'breakoutSignals.turtle_high', 'breakoutSignals.volume_breakout', 'breakoutSignals.volume_surge', 'breakoutSignals.vcp', 'breakoutSignals.trend_acceleration',
    'breakoutTrace.breakout_momentum', 'breakoutTrace.turtle_high', 'breakoutTrace.volume_breakout', 'breakoutTrace.volume_surge', 'breakoutTrace.vcp', 'breakoutTrace.trend_acceleration',
    'featurePack.breakout.breakout_momentum', 'featurePack.breakout.turtle_high', 'featurePack.breakout.volume_breakout', 'featurePack.breakout.volume_surge', 'featurePack.breakout.vcp', 'featurePack.breakout.trend_acceleration',
    'conditionResults.breakout_momentum', 'conditionResults.turtle_high', 'conditionResults.volume_breakout', 'conditionResults.volume_surge', 'conditionResults.vcp', 'conditionResults.trend_acceleration',
    'gateLayerSummary.gate3.externalDataCoverage.priceStructure.turtle', 'gateLayerSummary.gate3.externalDataCoverage.priceStructure.breakout',
    'gateLayerSummary.gate3.externalDataCoverage.volumeTiming.breakoutVolume', 'gateLayerSummary.gate3.externalDataCoverage.volumeTiming.vcp',
    'gateLayerSummary.gate3.externalDataCoverage.momentumIndicators.shortMomentum',
    'gate3ExternalDataCoverage.priceStructure.turtle', 'gate3ExternalDataCoverage.priceStructure.breakout',
    'gate3ExternalDataCoverage.volumeTiming.breakoutVolume', 'gate3ExternalDataCoverage.volumeTiming.vcp',
    'gate3ExternalDataCoverage.momentumIndicators.shortMomentum',
  ] as const;
  const breakoutAlignmentRows = traces.map((row) => {
    const component = formatterComponentTrace(row, 'BREAKOUT_STRUCTURE');
    const mappedScore = formatterGetByPath(row, 'breakoutScore') ?? formatterGetByPath(row, 'breakoutStructureScore');
    const traceAvailable =
      formatterComponentConnected(component) ||
      formatterFiniteNumber(mappedScore) ||
      formatterHasAnyPath(row, breakoutPaths);
    const weightedScore = component?.weightedScore;
    return {
      traceAvailable,
      positive: formatterFiniteNumber(weightedScore) ? weightedScore > 0 : formatterFiniteNumber(mappedScore) ? mappedScore > 0 : false,
    };
  });
  const breakoutTraceAvailableAlignment = breakoutAlignmentRows.filter((row) => row.traceAvailable).length;
  const breakoutPositive = breakoutAlignmentRows.filter((row) => row.positive).length;
  const supply = summary.perSymbolSupplyInjection;
  const sectorMaster = summary.sectorEnergySupplyUnknownAdr0488?.sectorEnergyMaster;
  const rawVolumeKeys = [
    ...Object.keys(forensic?.actualRawFieldKeysTop ?? {}),
    ...Object.keys(forensic?.kisRawFieldKeysTop ?? {}),
    ...Object.keys(forensic?.quoteFeatureFieldCoverage ?? {}),
  ].filter((key) => /acml_vol|volume|vol/i.test(key));
  const rawVolumeFieldAvailable =
    rawVolumeKeys.length > 0 ||
    candidatePool.candidateSnapshots.some((candidate) => Number.isFinite(candidate.volume ?? NaN) && Number(candidate.volume) > 0);

  return {
    totalCandidates: total,
    rs: {
      rawComputed: rsRawComputed,
      traceAvailable: forensic?.rsTraceAvailableCount ?? Math.max(rsRawComputed, forensic?.rsScoreUsableCount ?? 0),
      gateApplied: rsComponentApplied || rsRawComputed,
      scoreUsable: forensic?.rsScoreUsableCount ?? rsComponentApplied,
      selectedBasisForActualMissing: 'traceAvailableFromForensic',
      selectedBasisForPromotionGap: 'scoreUsableFromForensic',
    },
    breakout: {
      mapped: canonical.breakout.scoreMapped,
      traceAvailableRuntime: canonical.breakout.traceAvailable || forensic?.breakoutTraceAvailableCount,
      traceAvailableAlignment: breakoutTraceAvailableAlignment || canonical.breakout.scoreMapped || forensic?.breakoutTraceAvailableCount,
      runtimeScoreComputed: canonical.breakout.scoreComputed,
      scoreMappedToGateRuntime: canonical.breakout.scoreMapped,
      scoreMappedToGateAlignment: breakoutTraceAvailableAlignment || canonical.breakout.scoreMapped,
      positive: breakoutPositive || undefined,
      zeroByCondition: canonical.breakout.zeroByCondition,
      selectedBasisForActualMissing: 'alignment.traceAvailable',
      selectedBasisForPromotionGap: 'alignment.scoreMappedToGate',
    },
    supply: {
      injected: supply?.injected ?? total,
      verified: supply?.verified ?? supply?.injected ?? total,
      symbolMatched: forensic?.supplySymbolMatchedCount ?? forensic?.symbolMatchedCount,
      semanticAvailable: canonical.kisInvestorFlow.gateEligibleRows || forensic?.supplySemanticAvailable,
      gateEligibleRows: canonical.kisInvestorFlow.gateEligibleRows || forensic?.supplySemanticAvailable,
      shadowOnlyRows: canonical.kisInvestorFlow.shadowOnlyRows || Math.max(0, total - (forensic?.supplySemanticAvailable ?? total)),
    },
    sectorLeadership: sectorMaster ? {
      officialIndexCoverage: sectorMaster.officialIndexCoverage,
      verifiedIndexCodeCoverage: sectorMaster.verifiedIndexCodeCoverage,
      internalGroupedSnapshotCoverage: sectorMaster.internalGroupedSnapshotCoverage,
      ...(sectorMaster.internalGroupedValidSectorCount !== undefined
        ? { internalGroupedValidSectorCount: sectorMaster.internalGroupedValidSectorCount }
        : {}),
      ...(sectorMaster.internalGroupedExpectedSectorCount !== undefined
        ? { internalGroupedExpectedSectorCount: sectorMaster.internalGroupedExpectedSectorCount }
        : {}),
      internalProxyCoverage: sectorMaster.internalProxyCoverage,
      stockDailyFallbackCoverage: sectorMaster.stockDailyFallbackCoverage,
      selectedSourceTier: sectorMaster.selectedSectorEnergySourceTier,
      leadershipConfidence: sectorMaster.leadershipConfidence,
      promotionAllowed: sectorMaster.promotionAllowed,
      sectorBoostAllowed: sectorMaster.sectorBoostAllowed,
      strongBuyAllowed: sectorMaster.strongBuyAllowed,
      shadowLeadershipAllowed: sectorMaster.shadowLeadershipAllowed,
      counterfactualAllowed: sectorMaster.counterfactualAllowed,
    } : undefined,
    volumeEnergy: {
      rawVolumeFieldAvailable,
      rawVolumeFieldKeys: rawVolumeKeys.length > 0 ? [...new Set(rawVolumeKeys)].slice(0, 8) : (rawVolumeFieldAvailable ? ['candidateSnapshot.volume'] : []),
      volumeEnergyPromoted: candidatePool.candidateSnapshots.some((candidate) => candidate.featureScores.volumeEnergyScore > 0),
    },
  };
}

function withCandidatePoolRuntimeCoverage(
  summary: ScanSummary,
  canonical: CanonicalRuntimeResolutionStep27,
): CandidatePoolResult | undefined {
  if (!summary.candidatePool) return undefined;
  const featureCoverage = buildCandidateFeatureCoverageFromSummary(summary, canonical);
  if (!featureCoverage) return summary.candidatePool;
  return {
    ...summary.candidatePool,
    diagnostics: {
      ...summary.candidatePool.diagnostics,
      featureCoverage: {
        ...(summary.candidatePool.diagnostics.featureCoverage ?? {}),
        ...featureCoverage,
      },
    },
  };
}

function formatRuntimeWiringSummary(
  summary: ScanSummary,
  canonical: CanonicalRuntimeResolutionStep27,
): string {
  const softLane = summary.gate2SoftLeadershipLane;
  const resolveRealPaperSkipReason = (record: PaperEntryDecisionRecord): { reason: string; missingInputReason?: string } => {
    if (record.skipReason && record.skipReason !== 'FORENSIC_CARRY_BROKEN' && record.skipReason !== 'MISSING_SKIP_REASON_EMISSION') {
      return { reason: record.skipReason };
    }
    if (record.executionPermission === 'SHADOW_ONLY' || record.executionPermission === 'DENY') {
      return { reason: 'PAPER_ENTRY_NOT_ALLOWED_SHADOW_ONLY_POLICY' };
    }
    if (!record.gate2PendingPreserved) return { reason: 'LEADERSHIP_NOT_CONFIRMED' };
    if (!record.minSignalLivePass) {
      if (record.gate1HardSurvivor) return { reason: 'PAPER_ENTRY_SCORE_BELOW_THRESHOLD' };
      return { reason: 'LIVE_ENTRY_SCORE_BELOW_THRESHOLD' };
    }
    if (record.gate2PendingPreserved) return { reason: 'PAPER_ENTRY_NOT_PROMOTED_SCORE_GAP' };
    if (record.sizingAllowed === false) {
      if (record.sizingReason?.toUpperCase().includes('ADVISORY')) return { reason: 'SIZING_ADVISORY_LOW' };
      return { reason: 'PAPER_ENTRY_OBSERVE_ONLY' };
    }
    return { reason: 'FORENSIC_CARRY_BROKEN', missingInputReason: 'missing gate/score/sizing/permission trace inputs' };
  };
  const buildPaperDecisionReasonView = (record: PaperEntryDecisionRecord): { primaryReason: string; secondaryReasons: string[] } => {
    if (record.decision !== 'SKIPPED') return { primaryReason: record.skipReason ?? 'NONE', secondaryReasons: [] };
    const primaryReason = record.skipReason ?? 'NONE';
    const secondaryReasons: string[] = [];
    if (record.gate2PendingPreserved) secondaryReasons.push('GATE2_PENDING');
    if (record.executionPermission !== 'ALLOW') secondaryReasons.push('GATE3_BLOCK');
    if (!record.sizingAllowed) secondaryReasons.push('SIZING_BLOCKED');
    return { primaryReason, secondaryReasons };
  };
  const derivePaperEntryForensic = () => {
    const paperForensic = summary.paperEntryForensic;
    const synthesizeDecisionRecords = (candidates: PaperEntryCandidateForensic[]): PaperEntryDecisionRecord[] => {
      const baseScanId = summary.snapshotId ?? summary.time ?? 'SCAN_UNKNOWN';
      const sourceSnapshotId = summary.candidatePool?.sourceSnapshotId ?? (summary.sourceSnapshotDataHealth as { sourceSnapshotId?: string } | undefined)?.sourceSnapshotId ?? 'SOURCE_SNAPSHOT_UNKNOWN';
      const candidateSetId = summary.candidatePool?.asOf ?? summary.time ?? 'CANDIDATE_SET_UNKNOWN';
      const gateScoreInputSnapshotId = (summary.entryFilterDecomposition as { sourceSnapshotId?: string } | undefined)?.sourceSnapshotId ?? sourceSnapshotId;
      return candidates
        .filter((candidate) => typeof candidate.symbol === 'string' && candidate.symbol.trim().length > 0)
        .map((candidate) => ({
          symbol: candidate.symbol,
          name: candidate.name,
          sourceSnapshotId: String(candidate.sourceSnapshotId ?? sourceSnapshotId),
          candidateSetId: String(candidate.candidateSetId ?? candidateSetId),
          gateScoreInputSnapshotId: String(candidate.gateScoreInputSnapshotId ?? gateScoreInputSnapshotId),
          scanId: baseScanId,
          decision: candidate.paperEntryDecision,
          stage: (candidate.paperEntrySkipStage as PaperEntryDecisionRecord['stage'] | undefined) ?? 'CANDIDATE_SELECTED',
          skipReason: candidate.paperEntrySkipReason ?? 'MISSING_SKIP_REASON_EMISSION',
          gate1HardSurvivor: candidate.gate1HardSurvivor,
          minSignalLivePass: candidate.minSignalLivePass,
          gate2PendingPreserved: candidate.gate2PendingPreserved,
          shadowObservableStrict: candidate.shadowObservableStrict,
          shadowObservableSoft: candidate.shadowObservableSoft,
          paperEntryEligible: candidate.paperEntryEligible,
          duplicateKey: candidate.duplicateKey,
          existingOpenShadowPosition: candidate.existingOpenShadowPosition,
          existingPendingPaperOrder: candidate.existingPendingPaperOrder,
          resolvedEntryPrice: candidate.resolvedEntryPrice,
          priceSource: candidate.priceSource,
          quoteFreshness: candidate.quoteFreshness,
          sizingAllowed: candidate.sizingAllowed,
          sizingReason: candidate.sizingReason,
          executionPermission: candidate.executionPermission ?? candidate.sessionPolicy ?? 'UNKNOWN',
        }));
    };

    let decisionRecords = (paperForensic?.decisionRecords && paperForensic.decisionRecords.length > 0)
      ? paperForensic.decisionRecords
      : synthesizeDecisionRecords(paperForensic?.candidates ?? []);
    if (decisionRecords.length === 0 && (softLane?.gate1HardSurvivors ?? 0) > 0) {
      const fallbackSymbols = (summary.candidatePool?.candidateSnapshots ?? [])
        .slice(0, softLane?.gate1HardSurvivors ?? 0)
        .map((snapshot) => snapshot.symbol)
        .filter((symbol) => typeof symbol === 'string' && symbol.trim().length > 0);
      const requiredFallbackCount = softLane?.gate1HardSurvivors ?? 0;
      while (fallbackSymbols.length < requiredFallbackCount) {
        fallbackSymbols.push(`UNKNOWN_${fallbackSymbols.length + 1}`);
      }
      const fallbackSourceSnapshotId = summary.candidatePool?.sourceSnapshotId ?? 'SOURCE_SNAPSHOT_UNKNOWN';
      const fallbackCandidateSetId = summary.candidatePool?.asOf ?? summary.time ?? 'CANDIDATE_SET_UNKNOWN';
      const fallbackGateScoreSnapshotId = (summary.entryFilterDecomposition as { sourceSnapshotId?: string } | undefined)?.sourceSnapshotId ?? fallbackSourceSnapshotId;
      decisionRecords = fallbackSymbols.map((symbol): PaperEntryDecisionRecord => ({
        symbol,
        sourceSnapshotId: fallbackSourceSnapshotId,
        candidateSetId: fallbackCandidateSetId,
        gateScoreInputSnapshotId: fallbackGateScoreSnapshotId,
        scanId: summary.snapshotId ?? summary.time ?? 'SCAN_UNKNOWN',
        decision: 'SKIPPED',
        stage: 'CANDIDATE_SELECTED',
        skipReason: 'FORENSIC_CARRY_BROKEN',
        gate1HardSurvivor: true,
        minSignalLivePass: false,
        gate2PendingPreserved: true,
        shadowObservableStrict: true,
        shadowObservableSoft: true,
        paperEntryEligible: false,
        existingOpenShadowPosition: false,
        existingPendingPaperOrder: false,
        sizingAllowed: false,
        executionPermission: 'UNKNOWN',
      }));
    }
    decisionRecords = decisionRecords.map((record) => {
      if (record.decision !== 'SKIPPED') return record;
      const resolved = resolveRealPaperSkipReason(record);
      return { ...record, skipReason: resolved.reason as PaperEntryDecisionRecord['skipReason'] };
    });
    const candidates = paperForensic?.candidates ?? [];
    const candidateSymbols = decisionRecords.map((record) => record.symbol).filter(Boolean);
    const createdRecords = decisionRecords.filter((record) => record.decision === 'CREATED');
    const skippedRecords = decisionRecords.filter((record) => record.decision === 'SKIPPED');
    const blockedRecords = decisionRecords.filter((record) => record.decision === 'BLOCKED');
    const errorRecords = decisionRecords.filter((record) => record.decision === 'ERROR');
    const skippedWithoutReason = skippedRecords.filter((record) => !record.skipReason || record.skipReason === 'NONE').length;
    const skipReasonDistribution = skippedRecords.reduce<Record<string, number>>((acc, record) => {
      if (!record.skipReason || record.skipReason === 'NONE') return acc;
      acc[record.skipReason] = (acc[record.skipReason] ?? 0) + 1;
      return acc;
    }, {});
    const createdSymbols = createdRecords.map((record) => record.symbol);
    const skippedSymbols = skippedRecords.map((record) => record.symbol);
    const candidateCount = decisionRecords.length;
    const createdCount = createdRecords.length;
    const skippedCount = skippedRecords.length;
    const blockedCount = blockedRecords.length;
    const errorCount = errorRecords.length;
    const topSkipReason = paperForensic?.topSkipReason ?? Object.entries(skipReasonDistribution).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const invariantValid =
      candidateCount === candidateSymbols.length &&
      createdCount === createdSymbols.length &&
      skippedCount === skippedSymbols.length &&
      createdCount + skippedCount + blockedCount + errorCount === candidateCount &&
      (skippedCount === 0 || skippedSymbols.length > 0) &&
      (skippedCount === 0 || Object.keys(skipReasonDistribution).length > 0) &&
      skippedWithoutReason === 0 &&
      decisionRecords.every((record) => typeof record.symbol === 'string' && record.symbol.trim().length > 0);
    const forensicFallbackReasonCount = skipReasonDistribution.FORENSIC_CARRY_BROKEN ?? 0;
    const hasForensicCarryBroken = forensicFallbackReasonCount > 0;
    const realSkipReasonResolvedCount = Math.max(0, skippedCount - forensicFallbackReasonCount);
    const semanticInvariantValid = !hasForensicCarryBroken;
    const invalidReasons: string[] = [];
    if ((softLane?.gate1HardSurvivors ?? 0) > 0 && candidateCount === 0) invalidReasons.push('FORENSIC_CARRY_BROKEN');
    if (candidateCount > 0 && candidateSymbols.length === 0) invalidReasons.push('FIX_PAPER_ENTRY_SYMBOL_PAYLOAD_CARRY');
    if (skippedCount > 0 && skippedSymbols.length === 0) invalidReasons.push('FIX_PAPER_ENTRY_SYMBOL_PAYLOAD_CARRY');
    if (skippedCount > 0 && Object.keys(skipReasonDistribution).length === 0) invalidReasons.push('FIX_PAPER_ENTRY_SKIP_REASON_EMISSION');
    if (!invariantValid) invalidReasons.push('FIX_PAPER_ENTRY_FORENSIC_CARRY');
    if (skippedWithoutReason > 0) invalidReasons.push('FIX_PAPER_ENTRY_SKIP_REASON_EMISSION');
    if (hasForensicCarryBroken) invalidReasons.push('FIX_REAL_SKIP_REASON_RESOLUTION');
    const forensicStatus = hasForensicCarryBroken ? 'DEGRADED' : (invalidReasons.length > 0 ? 'INVALID' : 'VALID');
    const recommendedAction = hasForensicCarryBroken
      ? 'FIX_REAL_SKIP_REASON_RESOLUTION'
      : (invalidReasons.length > 0 ? Array.from(new Set(invalidReasons)).join(',') : 'NONE');
    const invalidMarkers: string[] = [];
    if ((softLane?.gate1HardSurvivors ?? 0) > 0 && candidateCount === 0) invalidMarkers.push('[PAPER_ENTRY_DECISION_RECORD_MISSING]');
    if ((candidateCount > 0 && candidateSymbols.length === 0) || (skippedCount > 0 && skippedSymbols.length === 0)) invalidMarkers.push('[PAPER_ENTRY_SYMBOL_PAYLOAD_MISSING]');
    if ((skippedCount > 0 && Object.keys(skipReasonDistribution).length === 0) || skippedWithoutReason > 0) invalidMarkers.push('[PAPER_ENTRY_SKIP_REASON_MISSING]');
    if (!invariantValid) invalidMarkers.push('[PAPER_ENTRY_INVARIANT_BROKEN]');
    const missingInputReasons = skippedRecords
      .map((record) => ({ record, resolved: resolveRealPaperSkipReason(record) }))
      .filter(({ resolved }) => resolved.reason === 'FORENSIC_CARRY_BROKEN' && resolved.missingInputReason)
      .map(({ record, resolved }) => `${record.symbol}:${resolved.missingInputReason}`);
    return { candidates, decisionRecords, candidateSymbols, createdSymbols, skippedSymbols, skipReasonDistribution, candidateCount, createdCount, skippedCount, topSkipReason, forensicStatus, invariantValid: invariantValid && semanticInvariantValid, semanticInvariantValid, realSkipReasonResolvedCount, forensicFallbackReasonCount, recommendedAction, invalidMarkers, missingInputReasons };
  };

  const paper = derivePaperEntryForensic();
  const candidatePool = summary.candidatePool;
  const forensic = summary.gate1MinimumSignalForensicAdr0505;
  const total = summary.candidates || candidatePool?.candidateSnapshots.length || 0;
  const gateScoreInputCandidates =
    summary.entryFilterDecomposition?.tracedCandidates ??
    candidatePool?.gateEvaluated ??
    total;
  const rsRawComputed = summary.entryFilterDecomposition?.minSignalScoreTraces.filter((trace) =>
    trace.components.some((component) =>
      component.code === 'RELATIVE_STRENGTH' &&
      component.confidence !== 'MISSING',
    ),
  ).length ?? summary.gate1MinimumSignalForensicAdr0505?.rsScoreUsableCount ?? 0;
  const rsApplied = forensic?.rsScoreUsableCount ?? rsRawComputed;
  const rsFallbackUsable = Math.max(0, rsApplied - rsRawComputed);
  const minSignal = summary.entryFilterDecomposition?.minSignalScoreDecompositionReport;
  const minSignalLivePass = summary.gate2SoftLeadershipLane?.minSignalLivePass ??
    (minSignal ? Math.max(0, minSignal.totalCandidates - minSignal.minSignalFailed) : 0);
  const counterfactualLedgerRowsCreated = summary.entryFilterDecomposition?.ledgerRowsCreated ?? candidatePool?.counterfactualRecorded ?? 0;
  const gateCounterfactualReadyCount = summary.entryFilterDecomposition?.counterfactualReady ?? 0;
  const shadowObservableStrictCount = summary.shadowObservableCount ?? candidatePool?.shadowEligible ?? 0;
  const shadowObservableSoftCount = Math.max(
    shadowObservableStrictCount,
    (softLane?.gate1HardSurvivors ?? 0) + (softLane?.gate2PendingPreserved ?? 0) + minSignalLivePass,
  );
  const paperEntryCandidateCount = paper.candidateCount;
  const paperEntryCreatedCount = paper.createdCount;
  const paperEntrySkippedCount = paper.skippedCount;
  const paperEntryCandidateSymbols = paper.candidateSymbols;
  const paperEntryCreatedSymbols = paper.createdSymbols;
  const paperEntrySkippedSymbols = paper.skippedSymbols;
  const paperEntrySkipReasonDistribution = paper.skipReasonDistribution;
  const paperEntryTopSkipReason = paper.topSkipReason;
  const paperEntryExecutionImpact = summary.paperEntryForensic?.executionImpact ?? 'NONE';
  const paperEntryForensicStatus = paper.forensicStatus;
  const macro = summary.macroGateState;
  const rawRegime = macro?.macroRegimeRaw ?? macro?.regime ?? 'UNKNOWN';
  const legacyEffectiveRegime = macro?.macroRegimeEffective ?? macro?.regime ?? 'UNKNOWN';
  const displayRegime = macro?.displayRegime ?? macro?.regime ?? 'UNKNOWN';
  const riskOverride = macro?.riskOverride ?? 'NONE';
  const effectiveRegime =
    legacyEffectiveRegime === 'R6_DEFENSE' &&
    displayRegime !== 'R6_DEFENSE' &&
    macro?.regime !== 'R6_DEFENSE'
      ? rawRegime
      : legacyEffectiveRegime;

  const lines = [
    '🧩 <b>Runtime Wiring Summary</b>',
    `- Candidates: ${total}`,
    `- GateScoreInput candidates: ${gateScoreInputCandidates}`,
    `- Quote raw coverage: return5d ${canonical.momentum.return5dCount}/${total}, return20d ${canonical.momentum.return20dCount}/${total}`,
    `- PriceMomentum applied: ${canonical.momentum.priceMomentumComputedCount}/${total}`,
    `- RS rawComputed=${rsRawComputed}/${total} fallbackUsable=${rsFallbackUsable}/${total} applied=${rsApplied}/${total} fallbackIncluded=${rsFallbackUsable > 0}`,
    `- Breakout mapped: ${canonical.breakout.scoreMapped}/${total}`,
    `- KIS investorFlow gateEligibleRows: ${canonical.kisInvestorFlow.gateEligibleRows}/${canonical.kisInvestorFlow.totalRows || total}`,
    `- Watchlist score verified: ${canonical.watchlist.verified}/${total}`,
    `- Gate1 hard survivors: ${softLane?.gate1HardSurvivors ?? 0}`,
    `- MinSignal live pass: ${minSignalLivePass}`,
    `- Gate2 pending preserved: ${softLane?.gate2PendingPreserved ?? 0}`,
    `- shadowObservableStrictCount=${shadowObservableStrictCount}`,
    `- shadowObservableSoftCount=${shadowObservableSoftCount}`,
    `- counterfactualLedgerRowsCreated=${counterfactualLedgerRowsCreated}`,
    `- gateCounterfactualReadyCount=${gateCounterfactualReadyCount}`,
    `- paperEntryCandidateCount=${paperEntryCandidateCount} paperEntryCreatedCount=${paperEntryCreatedCount} paperEntrySkippedCount=${paperEntrySkippedCount}`,
    `- paperEntrySkipReasonDistribution=${Object.keys(paperEntrySkipReasonDistribution).length ? JSON.stringify(paperEntrySkipReasonDistribution) : '{}'}`,
    `- paperEntryCandidateSymbols=${paperEntryCandidateSymbols.length ? paperEntryCandidateSymbols.join(',') : '-'}`,
    `- paperEntryCreatedSymbols=${paperEntryCreatedSymbols.length ? paperEntryCreatedSymbols.join(',') : '-'}`,
    `- paperEntrySkippedSymbols=${paperEntrySkippedSymbols.length ? paperEntrySkippedSymbols.join(',') : '-'}`,
    `- paperEntryTopSkipReason=${paperEntryTopSkipReason ?? '-'}`,
    `- paperEntryExecutionImpact=${paperEntryExecutionImpact}`,
    `- paperEntryForensicStatus=${paperEntryForensicStatus}`,
    `- paperEntryInvariantValid=${paper.invariantValid}`,
    `- paperEntrySemanticInvariantValid=${paper.semanticInvariantValid}`,
    `- paperEntryRealSkipReasonResolvedCount=${paper.realSkipReasonResolvedCount}`,
    `- paperEntryForensicFallbackReasonCount=${paper.forensicFallbackReasonCount}`,
    `- paperEntryExecutionImpact=${paperEntryExecutionImpact}`,
    `- paperEntryRecommendedAction=${paper.recommendedAction}`,
    `- paperEntryDecisionLines=${paper.decisionRecords.length ? paper.decisionRecords.map((record) => {
      const reasonView = buildPaperDecisionReasonView(record);
      const secondary = reasonView.secondaryReasons.length > 0 ? reasonView.secondaryReasons.join(',') : 'NONE';
      return `${record.symbol}:${record.decision}:primary=${reasonView.primaryReason}:secondary=${secondary}:score=${record.minSignalLivePass ? 'PASS' : 'FAIL'}:gate1=${record.gate1HardSurvivor ? 'PASS' : 'FAIL'}:gate2=${record.gate2PendingPreserved ? 'PENDING' : 'FAIL'}:gate3=${record.executionPermission === 'ALLOW' ? 'PASS' : 'BLOCK'}:sizing=${record.sizingAllowed ? 'PASS' : (record.sizingReason ?? 'BLOCKED')}`;
    }).join('|') : '-'}`,
    ...(paper.missingInputReasons?.length ? [`- paperEntryMissingInputReason=${paper.missingInputReasons.join('|')}`] : []),
    `- Provider penalty: ${canonical.providerPenalty.penaltyScope}`,
    `- Sizing: advisory only / hardBlock=${canonical.sizing.hardBlockCount}`,
    `- Regime: raw=${rawRegime} effective=${effectiveRegime} display=${displayRegime} riskOverride=${riskOverride}`,
    `- legacyR6Path: ${effectiveRegime !== legacyEffectiveRegime ? 'deprecated/notUsedForDecision' : 'notUsed'}`,
  ];
  if (paper.invalidMarkers.length > 0) lines.push(...paper.invalidMarkers);

  if (paper.candidates.length > 0) {
    lines.push('[PaperEntry Forensic]');
    const formatCandidate = (candidate: PaperEntryCandidateForensic): string[] => [
      `- symbol=${candidate.symbol}`,
      `  eligible=${candidate.paperEntryEligible}`,
      `  decision=${candidate.paperEntryDecision}`,
      `  skipReason=${candidate.paperEntrySkipReason ?? '-'}`,
      `  skipStage=${candidate.paperEntrySkipStage ?? '-'}`,
      `  gate1HardSurvivor=${candidate.gate1HardSurvivor}`,
      `  minSignalLivePass=${candidate.minSignalLivePass}`,
      `  gate2PendingPreserved=${candidate.gate2PendingPreserved}`,
      `  shadowObservableStrict=${candidate.shadowObservableStrict}`,
      `  priceSource=${candidate.priceSource ?? '-'}`,
      `  resolvedEntryPrice=${candidate.resolvedEntryPrice ?? '-'}`,
      `  sizingAllowed=${candidate.sizingAllowed}`,
      `  duplicateKey=${candidate.duplicateKey ?? '-'}`,
      `  existingOpenShadowPosition=${candidate.existingOpenShadowPosition}`,
      `  existingPendingPaperOrder=${candidate.existingPendingPaperOrder}`,
    ];
    for (const candidate of paper.candidates) lines.push(...formatCandidate(candidate));
  }
  return lines.join('\n');
}

export function formatScanBlockersMessage(summary: ScanSummary | null): string {
  // ADR-0367: 직전 스캔이 buyListLoop 진입 전 preflight 차단됐으면 preflight blocked scan 을 우선 표시.
  // persistScanResults 가 _lastScanSummary 를 채울 때 clearPreflightBlockedScanSummary 로 stale 제거되므로
  // _lastPreflightBlockedScanSummary 가 non-null 이면 항상 "직전 스캔 = preflight 차단" 을 의미한다.
  const preflightBlocked = getLastPreflightBlockedScanSummary();
  if (preflightBlocked) {
    return formatPreflightBlockedScanSection(preflightBlocked);
  }
  if (!summary) {
    return '📊 <b>[매수 차단 사유]</b>\n━━━━━━━━━━━━━━━━\n진단 데이터 없음 (스캔 미실행).';
  }

  const canonicalRuntimeResolution =
    summary.canonicalRuntimeResolution ?? buildCanonicalRuntimeResolutionStep27(summary);
  const wd = summary.waitDistribution;
  const mg = summary.macroGateState;
  const lines: string[] = [];
  lines.push(`📊 <b>[매수 차단 사유 분포]</b> 직전 스캔 (${summary.time})`);
  lines.push('━━━━━━━━━━━━━━━━');

  if (mg) {
    lines.push('');
    lines.push('🛑 <b>거시 게이트:</b>');
    lines.push(`  • emergencyStop: ${mg.emergencyStop ? '<b>ON ⚠️</b>' : 'off'}`);
    lines.push(`  • autoTradeEnabled: ${mg.autoTradeEnabled ? 'on' : '<b>OFF ⚠️</b>'}`);
    const rawRegime = mg.macroRegimeRaw ?? mg.regime;
    const displayRegime = mg.displayRegime ?? mg.regime;
    const legacyEffectiveRegime = mg.macroRegimeEffective ?? mg.regime;
    const staleLegacyR6Path =
      legacyEffectiveRegime === 'R6_DEFENSE' &&
      displayRegime !== 'R6_DEFENSE' &&
      mg.regime !== 'R6_DEFENSE';
    const canonicalEffectiveRegime = staleLegacyR6Path ? rawRegime : legacyEffectiveRegime;
    const policyViewRegime = mg.riskOverride && mg.riskOverride !== 'NONE' ? mg.riskOverride : displayRegime;
    const positionPolicy = getRegimePositionPolicy(policyViewRegime || canonicalEffectiveRegime);
    lines.push(`  • 레짐: display=${displayRegime} effective=${canonicalEffectiveRegime} (policyView=${policyViewRegime || canonicalEffectiveRegime}, 총노출 ${positionPolicy.maxGrossExposurePct}%, 종목당 ${positionPolicy.perPositionPct}%)`);
    if (mg.macroRegimeRaw || mg.macroRegimeEffective || mg.displayRegime) {
      lines.push(`  • raw/effective/display/riskOverride: ${rawRegime} → ${canonicalEffectiveRegime} / ${displayRegime} / ${mg.riskOverride ?? 'NONE'}`);
      lines.push(`  • regimeSource: canonical=RegimeResolver.canonicalOutput display=${displayRegime} riskOverride=${mg.riskOverride ?? 'NONE'} executionPermissionImpact=NONE`);
    }
    if (staleLegacyR6Path) {
      lines.push(`  • legacyR6Path: deprecated=true notUsedForDecision=true legacyEffective=${legacyEffectiveRegime} legacyR6RecoveryStatus=${mg.r6RecoveryStatus ?? 'NONE'}`);
    } else {
      if (mg.r6RecoveryStatus) lines.push(`  • r6RecoveryStatus: ${mg.r6RecoveryStatus}`);
      if (mg.activeR6Triggers) lines.push(`  • activeR6Triggers: [${mg.activeR6Triggers.join(',') || 'none'}]`);
      if (mg.r6ShockLatch !== undefined) lines.push(`  • r6ShockLatch: ${mg.r6ShockLatch}`);
      if (mg.recoveryBlockedReason) lines.push(`  • recoveryBlockedReason: ${mg.recoveryBlockedReason}`);
    }
    if (mg.liveEntryAllowed !== undefined) lines.push(`  • liveEntryAllowed: ${mg.liveEntryAllowed}`);
    if (mg.liveExitAllowed !== undefined) lines.push(`  • liveExitAllowed: ${mg.liveExitAllowed}`);
    if (mg.shadowBuyAllowed !== undefined) lines.push(`  • shadowBuyAllowed: ${mg.shadowBuyAllowed}`);
    if (mg.shadowSellAllowed !== undefined) lines.push(`  • shadowSellAllowed: ${mg.shadowSellAllowed}`);
    if (mg.shadowLearningAllowed !== undefined) lines.push(`  • shadowLearningAllowed: ${mg.shadowLearningAllowed}`);
    if (mg.counterfactualAllowed !== undefined) lines.push(`  • counterfactualAllowed: ${mg.counterfactualAllowed}`);
    if (mg.brokerOrderAllowed !== undefined) lines.push(`  • brokerOrderAllowed: ${mg.brokerOrderAllowed}`);
    lines.push(`  • FOMC: ${mg.fomcPhase} (점수/신뢰도 보정만 적용, executionImpact=NONE)`);
    if (mg.vixGatingActive) lines.push(`  • VIX 게이팅: <b>ON ⚠️</b>`);
    if (mg.bearDefenseMode) lines.push(`  • bearDefenseMode: <b>ON ⚠️</b>`);
    if (mg.mhsBelow30) lines.push(`  • MHS<30: <b>ON ⚠️</b>`);
    if (mg.diagnosticLiveEntryBlocked) {
      const liveEntryBlockedReason = String(mg.liveEntryBlockedReason ?? 'DIAGNOSTIC_ONLY').toUpperCase();
      const removedPolicyReason = liveEntryBlockedReason.includes('SELL_ONLY') || liveEntryBlockedReason.includes('R6_DEFENSE');
      lines.push(`  • liveEntryBlocked: <b>${removedPolicyReason ? 'LEGACY_POLICY_INPUT_IGNORED' : mg.liveEntryBlockedReason ?? 'DIAGNOSTIC_ONLY'}</b> (diagnostics continue)`);
    }
    if (mg.sellOnlyMode) {
      lines.push('  Legacy defense policy input detected - executionImpact=NONE');
      lines.push('  removedPolicy: LEGACY_DEFENSE_POLICY_REMOVED');
      lines.push('  Current buy permission uses Gate/data quality only.');
      lines.push('  shadow note: Shadow/Counterfactual snapshot preserved; executionImpact=NONE.');
    }
    if (mg.watchlistEmpty) lines.push(`  • 워치리스트: <b>0개 ⚠️</b>`);
  }

  const scanEvaluationSection = formatScanEvaluationSection(summary.scanEvaluation);
  if (scanEvaluationSection) {
    lines.push('');
    lines.push(scanEvaluationSection);
  }

  const candidatePoolSection = formatCandidatePoolSection(
    withCandidatePoolRuntimeCoverage(summary, canonicalRuntimeResolution),
  );
  if (candidatePoolSection) {
    lines.push('');
    lines.push(candidatePoolSection);
  }

  lines.push('');
  lines.push(formatRuntimeWiringSummary(summary, canonicalRuntimeResolution));

  if (summary.sectorEnergyQuality !== undefined) {
    lines.push('');
    lines.push('🌐 <b>섹터 에너지 데이터 품질:</b>');
    // ADR-0396 (= 사용자 명시 ADR-0371): 5단계 union — DEGRADED 신규 마커 추가.
    const qualityIcon =
      summary.sectorEnergyQuality === 'OK' ? '✅'
      : summary.sectorEnergyQuality === 'PARTIAL' ? '🟡'
      : summary.sectorEnergyQuality === 'STALE' ? '🟠'
      : summary.sectorEnergyQuality === 'DEGRADED' ? '🔶'
      : '❌';
    lines.push(`  • dataQuality: ${qualityIcon} <b>${summary.sectorEnergyQuality}</b>`);
    if (summary.validSectorCount !== undefined) {
      lines.push(`  • validSectorCount: ${summary.validSectorCount}/12`);
    }
    if (summary.sectorEnergyReasons && summary.sectorEnergyReasons.length > 0) {
      lines.push(`  • reasons: ${summary.sectorEnergyReasons.slice(0, 3).join('; ')}`);
    }
    // ADR-0396: FAILED 외 DEGRADED 도 DATA_INVALID 후보 (emptyScanClassifier wiring 정합).
    if (summary.sectorEnergyQuality === 'FAILED' || summary.sectorEnergyQuality === 'DEGRADED') {
      lines.push(`  • <i>${summary.sectorEnergyQuality} → emptyScanReason DATA_INVALID 자동 가중 (ADR-0127/0396)</i>`);
    }
  }

  lines.push('');
  lines.push(`📋 <b>종목별 차단</b> (후보 ${summary.candidates}개):`);
  lines.push(`  • 진입: <b>${summary.entries}개</b>`);
  if (wd) {
    if (wd.dataHold > 0) lines.push(`  • DATA_HOLD: ${wd.dataHold}개 ⚠️`);
    if (wd.gateFail > 0) lines.push(`  • Gate 재검증 미달: ${wd.gateFail}개`);
    if (wd.preBreakout > 0) lines.push(`  • Pre-breakout WAIT: ${wd.preBreakout}개`);
    if (canonicalRuntimeResolution.sizing.hardBlockCount > 0) {
      lines.push(`  • Sizing BLOCKED: ${canonicalRuntimeResolution.sizing.hardBlockCount}개 ⚠️`);
    } else if (wd.sizingBlocked > 0 || canonicalRuntimeResolution.sizing.advisoryCount > 0) {
      lines.push(`  • SIZING_ADVISORY_LOW: ${canonicalRuntimeResolution.sizing.advisoryCount || wd.sizingBlocked}개 (hardBlock=0, canonicalRuntimeResolution.sizing)`);
    }
    if (wd.volumeDrop > 0) lines.push(`  • 거래량 급감: ${wd.volumeDrop}개`);
    if (wd.driftRemove > 0) lines.push(`  • Drift REMOVE: ${wd.driftRemove}개`);
    if (wd.corpAction > 0) lines.push(`  • Corporate Action: ${wd.corpAction}개`);
    if (wd.other > 0) lines.push(`  • 기타: ${wd.other}개`);
  } else {
    lines.push(`  • Gate 미달: ${summary.gateMisses}개 (waitDistribution 미수집)`);
    lines.push(`  • Yahoo 실패: ${summary.yahooFails}개`);
    lines.push(`  • RRR 미달: ${summary.rrrMisses}개`);
  }

  // ADR-0412 — Frozen Quote 진단 + R3 streak skip 라인 (R3 state machine 노출 *전*).
  if (summary.perSymbolSupplyInjection) {
    const s = summary.perSymbolSupplyInjection;
    lines.push('');
    lines.push('📊 <b>Per-Symbol Supply Injection</b>');
    lines.push(`  candidates: ${s.totalCandidates}`);
    lines.push(`  requested: ${s.requestedSymbols}`);
    lines.push(`  injected: ${s.injected}`);
    lines.push(`  verified: ${s.verified}`);
    lines.push(`  degraded: ${s.degraded}`);
    lines.push(`  stale: ${s.stale}`);
    lines.push(`  missing: ${s.missing}`);
    lines.push(`  unknown: ${s.unknown}`);
    lines.push(`  routerConnected: ${s.routerConnected}`);
    lines.push(`  gateContextConnected: ${s.gateContextConnected}`);
  }

  const frozenSection = formatFrozenQuoteSection(summary.frozenQuote);
  if (frozenSection) {
    lines.push(frozenSection);
  }
  const streakSkipLine = formatR3StreakSkipLine(summary.r3StreakSkipped);
  if (streakSkipLine) {
    lines.push('');
    lines.push(streakSkipLine);
  }

  // ADR-0414 — Price Integrity + Correction Overlay (Stage 1 Read-Only).
  // 진단 only — corrected 값 LIVE 매수 판단 사용 0건 (절대 원칙 #3).
  const priceIntegritySection = formatPriceIntegritySection(summary.priceIntegrity);
  if (priceIntegritySection) {
    lines.push(priceIntegritySection);
  }
  const priceCorrectionSection = formatPriceCorrectionOverlaySection(summary.priceCorrection);
  if (priceCorrectionSection) {
    lines.push(priceCorrectionSection);
  }

  // ADR-0401 — R3 Sanity state machine 결과 노출 (CLEAN 외 분기에서만).
  if (summary.r3ViolationState && summary.r3ViolationState.state !== 'CLEAN') {
    const r3 = summary.r3ViolationState;
    const stateIcon: Record<typeof r3.state, string> = {
      CLEAN: '✅',
      WARNING: '🟡',
      ELEVATED: '🟠',
      SHADOW_ONLY: '⚫️',
      HARD_BLOCK: '🚨',
    };
    lines.push('');
    lines.push(`${stateIcon[r3.state]} <b>R3 Sanity 단계 (ADR-0401):</b> ${r3.state}`);
    lines.push(
      `  • 누적 ${r3.consecutiveCount}회 / 임계 hard ${r3.profile.hardBlockAt} (regime ${r3.regime})`,
    );
    if (r3.guardReasons.length > 0) {
      lines.push(`  • guard 활성: ${r3.guardReasons.slice(0, 2).join('; ')}`);
    }
    if (r3.state === 'HARD_BLOCK') {
      lines.push('  • <code>/r3_unblock</code> 으로 해제');
    } else if (r3.state === 'SHADOW_ONLY') {
      lines.push('  • ephemeral — 다음 정상 스캔 시 자동 회복');
    }
  }

  lines.push('');
  if (summary.emptyScanReason) {
    const desc = describeEmptyScanReason(summary.emptyScanReason);
    const forensic = summary.gate1MinimumSignalForensicAdr0505;
    const supplyAvailable = forensic?.supplySemanticAvailable ?? 0;
    const supplyTotal = forensic?.totalCandidates ?? summary.candidates ?? 0;
    const supplyAvailabilityRate = supplyTotal > 0 ? supplyAvailable / supplyTotal : 0;
    if (summary.emptyScanReason === 'NO_LEADERSHIP' && supplyTotal > 0 && supplyAvailabilityRate < 0.3) {
      lines.push('💡 <b>빈스캔 원인 (ADR-0119):</b> DEGRADED_SCAN');
      lines.push(`  • 표면상 NO_LEADERSHIP이나, 수급 semantic row ${supplyAvailable}/${supplyTotal}으로 리더십 판정 신뢰도 낮음`);
      lines.push('  • leadership diagnosis confidence: LOW');
      lines.push('  • 우선 조치: Supply Semantic Row Carry 복구 필요');
    } else {
      lines.push(`💡 <b>빈스캔 원인 (ADR-0119):</b> ${summary.emptyScanReason}`);
      lines.push(`  • ${desc.label}`);
      lines.push(`  • ${desc.advice}`);
      if (supplyTotal > 0) lines.push(`  • supplySemantic availability: ${supplyAvailable}/${supplyTotal}`);
    }
  } else if (summary.entries > 0) {
    lines.push(`✅ <b>매수 발생:</b> ${summary.entries}개 (분류 대상 아님)`);
  } else {
    lines.push('💡 <b>빈스캔 원인:</b> 분류 데이터 부족 (waitDistribution 미수집)');
  }

  // ADR-0420 — Fresh Scan Blocker Attribution (GATE1_PASS_ZERO 상세) 노출.
  // gate1Pass=0 + candidates>0 시점에만 노출 (formatFreshAttributionSection 내부 필터).
  // last 7 days /gate_audit 와 *분리* (사용자 명시 핵심 불변식 #4).
  const freshSection = formatFreshAttributionSection(summary.freshConditionAttribution);
  if (freshSection) {
    lines.push('');
    lines.push(freshSection);
  }

  // ADR-0422 — Gate2 / NO_LEADERSHIP fresh attribution 노출.
  // gate1Pass>0 + gate2Pass=0 시점에만 노출 (formatGate2AttributionSection 내부 필터).
  // gate1Pass=0 시점은 ADR-0420 GATE1_PASS_ZERO 분석이 우선 (책임 분리).
  const gate2Section = formatGate2AttributionSection(
    rebindGate2AttributionToSectorEnergyMasterAdr0488(
      summary.freshGate2Attribution,
      summary.sectorEnergySupplyUnknownAdr0488,
    ),
  );
  if (gate2Section) {
    lines.push('');
    lines.push(gate2Section);
  }

  // ADR-0505 — Gate1 Minimum Signal Forensic Audit compact section.
  // 사용자 명시 ADR-0502 의미상 후속 (INDEX SSOT 정합 0505 재할당).
  // 100-scale minimum signal score 부결 원인을 component 단위로 분해 — positive
  // starvation vs penalty accumulation 구분. ADR-0420 fresh attribution 과 *책임 분리*
  // (ADR-0420 = 조건별 status 분해 / ADR-0505 = 100점형 점수 component 분해).
  // summary 부재 또는 totalCandidates=0 시 미노출 (formatter 내부 필터, 잡음 차단).
  const gate1ForensicSection = formatGate1MinimumSignalForensicSection(
    rebindGate1ForensicSummaryToCanonicalStep27(
      summary.gate1MinimumSignalForensicAdr0505,
      canonicalRuntimeResolution,
    ),
  );
  if (gate1ForensicSection) {
    lines.push('');
    lines.push(gate1ForensicSection);
    lines.push('');
    lines.push(formatCanonicalRuntimeResolutionAdoptionSection(canonicalRuntimeResolution));
    const gatePositiveRuntimeAlignmentSection = formatGatePositiveRuntimeAlignmentSection(summary, canonicalRuntimeResolution);
    if (gatePositiveRuntimeAlignmentSection) {
      lines.push('');
      lines.push(gatePositiveRuntimeAlignmentSection);
    }
  }

  // ADR-452c — Gate Score Health visibility (diagnostic-only).
  // Gate attribution 근처에 raw/available/normalized score health 를 노출한다.
  // normalizedGateScore 는 표시만 하며 live decision 에 사용하지 않는다.
  const gateScoreHealthSection = formatGateScoreHealthSection(summary.gateScoreHealth);
  if (gateScoreHealthSection) {
    lines.push('');
    lines.push(gateScoreHealthSection);
  }

  // ADR-452d — Gate near-miss buckets (diagnostic-only, executionImpact NONE).
  // DATA_BLOCKED_NEAR_MISS / PROBING / SHADOW_ONLY 는 실매수 승격 없이 운영 진단에만 노출한다.
  const gateScoreBucketSection = formatGateScoreCandidateBucketSection(summary.gateScoreCandidateBuckets);
  if (gateScoreBucketSection) {
    lines.push('');
    lines.push(gateScoreBucketSection);
  }

  // ADR-458 — Approved Gate Reclassification Dry-Run (shadow-only, executionImpact NONE).
  const gate1SurvivalSection = formatGate1SurvivalAuditSection(summary.gateLayerAudit?.gate1Survival);
  if (gate1SurvivalSection) {
    lines.push('');
    lines.push(gate1SurvivalSection);
  }
  const gate2CoverageSection = formatGate2CoverageAuditSection(summary.gateLayerAudit?.gate2Coverage);
  if (gate2CoverageSection) {
    lines.push('');
    lines.push(gate2CoverageSection);
  }

  const gateReclassificationDryRunSection = formatGateReclassificationDryRunSection(summary.gateReclassificationDryRun);
  if (gateReclassificationDryRunSection) {
    lines.push('');
    lines.push(gateReclassificationDryRunSection);
  }

  const positiveStarvationSection = formatPositiveScoreStarvationReport(
    rebindPositiveScoreStarvationReportToCanonicalStep27(
      summary.positiveScoreStarvation,
      canonicalRuntimeResolution,
    ),
    canonicalRuntimeResolution,
  );
  if (positiveStarvationSection) {
    lines.push('');
    lines.push(positiveStarvationSection);
  }

  const scoreCeilingRepairSection = formatGate1ScoreCeilingRepairReport(
    rebindGate1ScoreCeilingRepairReportToCanonicalStep27(
      summary.scoreCeilingRepair,
      canonicalRuntimeResolution,
    ),
  );
  if (scoreCeilingRepairSection) {
    lines.push('');
    lines.push(scoreCeilingRepairSection);
  }

  const penaltyDeduplicationSection = formatPenaltyDeduplicationReport(
    summary.penaltyDeduplication,
    canonicalRuntimeResolution,
  );
  if (penaltyDeduplicationSection) {
    lines.push('');
    lines.push(penaltyDeduplicationSection);
  }

  const riskDoubleCountSection = formatRiskDoubleCountAuditReport(summary.riskDoubleCount);
  if (riskDoubleCountSection) {
    lines.push('');
    lines.push(riskDoubleCountSection);
  }

  const finalGate1CalibrationSection = formatFinalGate1CalibrationReport(
    summary.finalGate1Calibration,
    canonicalRuntimeResolution,
  );
  if (finalGate1CalibrationSection) {
    lines.push('');
    lines.push(finalGate1CalibrationSection);
  }

  try {
    const gate1ScoringAlignmentSection = formatGate1ScoringAlignmentReport(
      rebindGate1ScoringAlignmentReportToCanonicalStep27(
        summary.gate1ScoringAlignment,
        canonicalRuntimeResolution,
      ),
    );
    if (gate1ScoringAlignmentSection) {
      lines.push('');
      lines.push(gate1ScoringAlignmentSection);
    }
  } catch (e) {
    emitScanDiagnosticBuildFailedWarn({ sourcePath: 'scanDiagnosticsCore.formatGate1ScoringAlignmentReport', error: e });
  }

  try {
    const positiveSourceWiringSection = formatGate1PositiveSourceWiringReport(summary.gate1PositiveSourceWiring);
    if (positiveSourceWiringSection) {
      lines.push('');
      lines.push(positiveSourceWiringSection);
    }
  } catch (e) {
    emitScanDiagnosticBuildFailedWarn({ sourcePath: 'scanDiagnosticsCore.formatGate1PositiveSourceWiringReport', error: e });
  }

  // ADR-0423 — SectorEnergy 데이터 진실성 진단 (indexCode coverage / symmetry / fallback 분해).
  // 기존 sectorEnergyQuality 라벨만으로는 SECTOR_DATA_STALE_DOMINANT 의 *진짜 원인* 인식 불가.
  // 본 섹션은 reasons 분해 + leadershipConfidence 차단 결정 + operatorAction 안내.
  // ADR-0422 Gate2 섹션의 sectorEnergy 표시(요약) 와 *책임 분리* — 본 섹션은 *원인 분해 상세*.
  try {
    const investorFlowRouterSection = formatInvestorFlowProviderRouterAdr0477(
      summary.investorFlowProviderRouter,
      canonicalRuntimeResolution,
    );
    if (investorFlowRouterSection) {
      lines.push('');
      lines.push(investorFlowRouterSection);
    }
  } catch (e) {
    emitScanDiagnosticBuildFailedWarn({ sourcePath: 'scanDiagnosticsCore.formatInvestorFlowProviderRouterAdr0477', error: e });
  }

  try {
    const dryRunObservationSection = formatGate1DryRunObservationSummary(summary.gate1DryRunObservationLedger);
    if (dryRunObservationSection) {
      lines.push('');
      lines.push(dryRunObservationSection);
    }
  } catch (e) {
    emitScanDiagnosticBuildFailedWarn({ sourcePath: 'scanDiagnosticsCore.formatGate1DryRunObservationSummary', error: e });
  }

  const sectorEnergySection = formatSectorEnergyQualityDiagnosticSection(sectorEnergyQualityDiagnosticForDisplay(summary));
  if (sectorEnergySection) {
    lines.push('');
    lines.push(sectorEnergySection);
  }

  // ADR-0425 — Gate Decision Router (hard block vs soft degrade separation).
  // 사용자 §F — Router 결과 (severity / lanes / reasons / operatorMessage) 노출.
  // Gate threshold 변경 0 — decision semantics 분리만. Shadow/Watch 학습 후보 보존.
  const routerSection = formatGateDecisionRouterSection(summary.gateDecisionRouter);
  if (routerSection) {
    lines.push('');
    lines.push(routerSection);
  }

  // ADR-0436 — Gate Eligibility Split (LIVE_ELIGIBLE vs SHADOW_OBSERVABLE).
  // 사용자 §5 — 실매수 후보 vs 학습/관측 후보 분리 표시. shadowObservableCount=undefined
  // 시 미노출 (ENV OFF 또는 ADR-0436 미작동 — 후방호환). 부재 시 진단 메시지 무영향.
  const gateEligibilitySection = formatGateEligibilitySplitSection(summary);
  if (gateEligibilitySection) {
    lines.push('');
    lines.push(gateEligibilitySection);
  }

  // ADR-0426 — R3_EARLY Provisional Shadow Lane.
  // 사용자 §E — eligible / created / topReasons / dominantLabel 노출.
  // R3_EARLY + Gate1 생존자 + SOFT_DEGRADE 시점에 학습 샘플 보존 lane.
  // LIVE 매매 본체 영향 0 — 후보 metadata 만 영속.
  const provisionalSection = formatProvisionalShadowSection(summary.provisionalShadowLane);
  if (provisionalSection) {
    lines.push('');
    lines.push(provisionalSection);
  }

  // ADR-0430 — Counterfactual Shadow Learning Lane.
  // SELL_ONLY/HARD_BLOCK 시점 학습 표본 분리 표시. ADR-0427 provisional 다음 노출.
  // 매매 정책 변경 0건 — 학습 ledger 진단만.
  if (summary.r6ShadowEntryPolicy) {
    const r6 = summary.r6ShadowEntryPolicy;
    lines.push('');
    lines.push('Shadow Learning:');
    lines.push(`  candidateEvaluated=${r6.candidateEvaluated}`);
    lines.push(`  accumulatingCandidates=${r6.accumulatingCandidates}`);
    lines.push(`  shadowBuySignals=${r6.shadowBuySignals}`);
    lines.push(`  r6CounterfactualEntries=${r6.r6CounterfactualEntries}`);
    lines.push(`  noShadowEntryReason=${r6.noShadowEntryReason ?? 'N/A'}`);
    lines.push('  legacy defense policy disabled; buy permission uses Gate/data quality only');
    lines.push('  executionImpact=NONE');
  }

  const counterfactualSection = formatCounterfactualShadowLearningSection(
    summary.counterfactualShadowLearning,
  );
  if (counterfactualSection) {
    lines.push('');
    lines.push(counterfactualSection);
  }

  // ADR-0464 — Entry Filter Conservatism Decomposition.
  const entryFilterSection = formatEntryFilterDecompositionSection(summary.entryFilterDecomposition);
  if (entryFilterSection) {
    lines.push('');
    lines.push(entryFilterSection);
  }

  // ADR-0448 Phase 0 — R3 Noise Governor compact line.
  //   Gate1 통과 0건 시점의 cause 분류 (TRUE_GATE1_ZERO / SELL_ONLY / LUNCH_BREAK /
  //   DATA_UNAVAILABLE / SECTOR_ENERGY_DIAGNOSTIC_BLOCKED / PROVIDER_DEGRADED /
  //   SHADOW_OBSERVABLE_EXISTS / UNKNOWN) + streakImpact (0/1) + liveBlockPreserved=true.
  //   부재 시 미노출 (gate1Pass>0 또는 ENV DISABLED — 후방호환).
  if (summary.r3NoiseDecision) {
    lines.push('');
    lines.push(formatR3NoiseGovernorCompactLine(summary.r3NoiseDecision));
  }

  // ADR-0449 — Pre-Breakout WAIT 7-state compact summary.
  //   Pre-breakout WAIT 후보 분류 (retryEligible / cooldown / shadowOnly / rejected /
  //   priceTooFar / volumeWeak / gateRecheckFailed) + topReasons + failCountProtected.
  //   부재 시 미노출 (decisions 빈 배열 — 후방호환).
  if (summary.preBreakoutWaitSummary) {
    const section = formatPreBreakoutWaitSummarySection(summary.preBreakoutWaitSummary);
    if (section) {
      lines.push('');
      lines.push(section);
    }
  }

  // ADR-0452 — Shadow Near-Breakout Entry compact section.
  //   Live WAIT 후보 중 near-breakout 학습 가치가 큰 후보를 Shadow 가상 진입으로 기록한 결과.
  //   created/blocked + topBlock + executionImpact: NONE 라인.
  //   부재 또는 created+blocked=0 시 미노출 (잡음 차단 — 후방호환).
  if (
    (summary.shadowNearBreakoutCreated ?? 0) > 0 ||
    (summary.shadowNearBreakoutBlocked ?? 0) > 0
  ) {
    const section = formatShadowNearBreakoutSection({
      created: summary.shadowNearBreakoutCreated ?? 0,
      blocked: summary.shadowNearBreakoutBlocked ?? 0,
      blockReasons:
        (summary.shadowNearBreakoutBlockReasons as Partial<
          Record<ShadowNearBreakoutBlockReason, number>
        >) ?? {},
    });
    if (section) {
      lines.push('');
      lines.push(section);
    }
  }

  return lines.join('\n');
}

function formatCanonicalRuntimeResolutionAdoptionSection(
  canonical: CanonicalRuntimeResolutionStep27,
): string {
  return [
    '[Canonical Runtime Resolution Adopted]',
    `scanId=${canonical.scanId}`,
    `sourceSnapshotId=${canonical.sourceSnapshotId}`,
    `gateScoreInputSnapshotId=${canonical.gateScoreInputSnapshotId}`,
    'KIS Investor Flow Semantic Row:',
    `- selectedProvider: ${canonical.kisInvestorFlow.selectedProvider}`,
    `- rawRow: ${canonical.kisInvestorFlow.rawRows}/${canonical.kisInvestorFlow.totalRows}`,
    `- semanticRow: ${canonical.kisInvestorFlow.semanticRows}/${canonical.kisInvestorFlow.totalRows}`,
    `- gateEligibleRows: ${canonical.kisInvestorFlow.gateEligibleRows}/${canonical.kisInvestorFlow.totalRows}`,
    `- shadowOnlyRows: ${canonical.kisInvestorFlow.shadowOnlyRows}/${canonical.kisInvestorFlow.totalRows}`,
    `- scoreUsage: ${canonical.kisInvestorFlow.finalGateScoreEligible ? 'GATE_SCORE_ELIGIBLE_PARTIAL' : 'SHADOW_ONLY_NEUTRAL_UNKNOWN'}`,
    `- finalRouterUsable: ${canonical.kisInvestorFlow.finalRouterUsable}`,
    `- finalGateScoreEligible: ${canonical.kisInvestorFlow.finalGateScoreEligible}`,
    `- failedCriteria: ${canonical.kisInvestorFlow.failedCriteria.length > 0 ? canonical.kisInvestorFlow.failedCriteria.join(',') : '[]'}`,
    `- marketSignal=${canonical.kisInvestorFlow.marketSignal}`,
    '- executionImpact=NONE',
    'actualInvestorRowUseScope:',
    `  GATE_SCORE_ELIGIBLE=${canonical.kisInvestorFlow.gateEligibleRows}`,
    `  SHADOW_ONLY_NEUTRAL_UNKNOWN=${canonical.kisInvestorFlow.shadowOnlyRows}`,
    'ADR-0467 Watchlist Resolver:',
    `- WATCHLIST_UPSTREAM_SCORE verified ${canonical.watchlist.verified} / missing ${canonical.watchlist.missing} / avg +${canonical.watchlist.avg.toFixed(1)}`,
    `- selectedInputPath=${canonical.watchlist.selectedInputPath}`,
    `- conflict=${canonical.watchlist.conflict}`,
    'Momentum Projection:',
    `- return5dCount=${canonical.momentum.return5dCount}`,
    `- return20dCount=${canonical.momentum.return20dCount}`,
    `- relativeReturn20dCount=${canonical.momentum.relativeReturn20dCount}`,
    `- marketRelativeReturnCount=${canonical.momentum.marketRelativeReturnCount}`,
    `- PRICE_MOMENTUM computedCount=${canonical.momentum.priceMomentumComputedCount}`,
    `- projectedToGate1=${canonical.momentum.projectedToGate1}`,
    'Breakout Runtime Mapping:',
    `- traceAvailable=${canonical.breakout.traceAvailable}`,
    `- scoreComputed=${canonical.breakout.scoreComputed}`,
    `- scoreMappedToGate=${canonical.breakout.scoreMapped}`,
    `- zeroByCondition=${canonical.breakout.zeroByCondition}`,
    `- missingByMapping=${canonical.breakout.missingByMapping}`,
    `- waitFeatureMissing=${canonical.breakout.waitFeatureMissing}`,
    `- waitEntryPriceNotReached=${canonical.breakout.waitEntryPriceNotReached}`,
    'Provider Penalty Policy:',
    `- providerIssuePenaltyApplied=${canonical.providerPenalty.providerIssuePenaltyApplied}`,
    `- unknownPenaltyApplied=${canonical.providerPenalty.unknownPenaltyApplied}`,
    `- penaltyScope=${canonical.providerPenalty.penaltyScope}`,
    `- effectiveProviderPenaltyAvg=${canonical.providerPenalty.effectiveProviderPenaltyAvg.toFixed(1)}`,
    `- effectiveUnknownPenaltyAvg=${canonical.providerPenalty.effectiveUnknownPenaltyAvg.toFixed(1)}`,
    '- gateScoreImpact=0',
    'Sizing:',
    `- hardBlockCount=${canonical.sizing.hardBlockCount}`,
    `- advisoryCount=${canonical.sizing.advisoryCount}`,
    '- executionImpact=NONE',
  ].join('\n');
}
