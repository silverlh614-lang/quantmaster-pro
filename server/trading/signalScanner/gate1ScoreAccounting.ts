/**
 * @responsibility Gate1 score accounting diagnostic SSOT for scan_blockers.
 */

import type { FinalGate1CalibrationAuditReport } from './gate1FinalCalibration.js';
import type { PenaltyDeduplicationReport } from './gate1PenaltyDeduplication.js';
import type { PositiveScoreStarvationReport } from './gate1PositiveScoreStarvation.js';
import type { CanonicalRuntimeResolutionStep27 } from './runtimeResolverTraceStep26.js';
import { resolveScoringEffectiveRegime } from './scanDiagnostics/gate0MacroPermissionDecision.js';
import { formatGate1RegimeAwareSurvivorLine } from './gate1RegimeAwareSurvivorAdr0546.js';
import type { ScanSummary } from './scanDiagnostics/scanSummaryTypes.js';
import {
  LEGACY_GATE1_REQUIRED_SCORE,
  getRegimeAwareGate1RequiredScore,
  isGate1RegimeAwareRequiredEnabled,
  resolveGate1RequiredScore,
} from '../gateConfig.js';

type InvariantStatus = 'OK' | 'FAIL';

export interface Gate1PenaltyAccounting {
  effectiveOriginalPenaltyAvg: number;
  effectiveDedupedPenaltyAvg: number;
  effectiveRemovedPenaltyAvg: number;
  diagnosticOriginalPenaltyAvg: number;
  diagnosticDedupedPenaltyAvg: number;
  diagnosticRemovedPenaltyAvg: number;
  effectiveGateScoreImpact: number;
  diagnosticOnly: boolean;
  diagnosticGroupKey: string;
}

export interface Gate1SurvivorTaxonomy {
  totalCandidates: number;
  gate1Evaluated: number;
  gate1HardPass: number;
  gate1SoftPass: number;
  minSignalLivePass: number;
  liveCandidateAfterGate1: number;
  diagnosticSurvivor: number;
  shadowObservable: number;
  counterfactualRecorded: number;
  note: string;
}

export interface Gate1ScoreAccountingReport {
  requiredScoreAvg: number;
  finalGate1ScoreAvg: number;
  finalGate1ScoreMin: number;
  finalGate1ScoreMax: number;
  rawPositiveScoreAvg: number;
  rawPenaltyScoreAvg: number;
  effectivePenaltyScoreAvg: number;
  netScoreAvg: number;
  normalizedGate1ScorePct: number;
  configuredPositiveMax: number;
  observedPositiveMax: number;
  utilizationByMaxPct: number;
  utilizationByAvgPct: number;
  previousPositiveUtilizationAvgDeprecated: number;
  scaleMismatch: boolean;
  scaleObservationMode: 'NONE' | 'SCALE_OBSERVATION_ONLY';
  /** ADR-0546 섀도 병행 — 레거시(현행) Gate1 required (×10, 항상 70). */
  legacyRequiredScore: number;
  /** ADR-0546 섀도 병행 — 레짐 인식 required (×10). 플래그 OFF 라도 관측용으로 항상 계산. */
  regimeAwareRequiredScore: number;
  /** ADR-0546 섀도 병행 — legacy - regimeAware (양수 = 레짐 완화 여지). */
  regimeAwareGap: number;
  /** ADR-0546 — 실제 적용 required (resolveGate1RequiredScore; Phase1=legacy 70). */
  appliedRequiredScore: number;
  /** ADR-0546 — GATE1_REGIME_AWARE_REQUIRED 활성 여부. Phase1 항상 false. */
  regimeAwareRequiredActive: boolean;
  thresholdAutoChanged: false;
  operatorApprovalRequired: true;
  liveExecutionAllowed: false;
  primaryIssue: string;
  secondaryIssue: string;
  penalty: Gate1PenaltyAccounting;
  survivor: Gate1SurvivorTaxonomy;
  invariants: Array<{
    code: string;
    status: InvariantStatus;
    message: string;
  }>;
  executionImpact: 'NONE';
  shadowLearning: true;
}

export interface Gate1ScoreAccountingInput {
  positive?: PositiveScoreStarvationReport | null;
  penalty?: PenaltyDeduplicationReport | null;
  finalCalibration?: FinalGate1CalibrationAuditReport | null;
  canonical?: CanonicalRuntimeResolutionStep27 | null;
  summary?: ScanSummary | null;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function round1(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 10) / 10 : 0;
}

function pct(numerator: number, denominator: number): number {
  if (!Number.isFinite(denominator) || denominator <= 0) return 0;
  return round1(Math.max(0, Math.min(100, (numerator / denominator) * 100)));
}

function countSnapshots(
  summary: ScanSummary | null | undefined,
  predicate: (candidate: NonNullable<ScanSummary['candidatePool']>['candidateSnapshots'][number]) => boolean,
): number {
  const snapshots = summary?.candidatePool?.candidateSnapshots ?? [];
  return snapshots.filter(predicate).length;
}

function countEntryLane(summary: ScanSummary | null | undefined, key: keyof NonNullable<ScanSummary['entryLaneSplit']>): number {
  const value = summary?.entryLaneSplit?.[key];
  return finite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function diagnosticGroupTotals(report?: PenaltyDeduplicationReport | null): {
  original: number;
  deduped: number;
  removed: number;
  groupKey: string;
} {
  if (!report || report.duplicateGroups.length === 0) {
    return { original: 0, deduped: 0, removed: 0, groupKey: 'NONE' };
  }
  const groups = report.duplicateGroups;
  const first = groups[0];
  return {
    original: round1(groups.reduce((acc, group) => acc + group.avgOriginalPenalty, 0)),
    deduped: round1(groups.reduce((acc, group) => acc + group.avgDedupedPenalty, 0)),
    removed: round1(groups.reduce((acc, group) => acc + group.avgRemovedPenalty, 0)),
    groupKey: first?.groupKey ?? 'DIAGNOSTIC_GROUP',
  };
}

/**
 * scaleMismatch 판정식 SSOT (ADR-0546). finalGate1/actual 와 net 의 괴리(≥5) 또는
 * positive utilization>100 이면 스케일 혼선으로 판정. gate1PositiveScoreStarvation 가
 * 동일 식을 재사용 (이전 중복 정의 제거).
 */
export function isGate1ScaleMismatch(
  scoreAvg: number,
  netScoreAvg: number,
  positiveUtilizationAvg: number,
): boolean {
  return Math.abs(scoreAvg - netScoreAvg) >= 5 || positiveUtilizationAvg > 100;
}

function buildPenaltyAccounting(input: Gate1ScoreAccountingInput): Gate1PenaltyAccounting {
  const report = input.penalty;
  const canonical = input.canonical;
  const effectiveFromCanonical = canonical
    ? canonical.providerPenalty.effectiveProviderPenaltyAvg + canonical.providerPenalty.effectiveUnknownPenaltyAvg
    : undefined;
  const marketSignalPenalty = report?.marketSignalPenaltyAvg ?? 0;
  const effectiveOriginal = round1(Math.max(
    0,
    report?.effectiveOriginalPenaltyAvg ?? effectiveFromCanonical ?? report?.originalPenaltyAvg ?? 0,
    marketSignalPenalty,
  ));
  const effectiveRemoved = round1(Math.min(effectiveOriginal, report?.removedPenaltyAvg ?? 0));
  const effectiveDeduped = round1(Math.max(0, effectiveOriginal - effectiveRemoved));
  const diagnostic = diagnosticGroupTotals(report);
  const diagnosticOnly = diagnostic.removed > 0 && effectiveRemoved === 0;
  return {
    effectiveOriginalPenaltyAvg: effectiveOriginal,
    effectiveDedupedPenaltyAvg: effectiveDeduped,
    effectiveRemovedPenaltyAvg: effectiveRemoved,
    diagnosticOriginalPenaltyAvg: diagnostic.original,
    diagnosticDedupedPenaltyAvg: diagnostic.deduped,
    diagnosticRemovedPenaltyAvg: diagnostic.removed,
    effectiveGateScoreImpact: effectiveRemoved,
    diagnosticOnly,
    diagnosticGroupKey: diagnostic.groupKey,
  };
}

function buildSurvivorTaxonomy(input: Gate1ScoreAccountingInput, positive: PositiveScoreStarvationReport): Gate1SurvivorTaxonomy {
  const summary = input.summary;
  const totalCandidates = Math.max(0, Math.floor(summary?.candidates ?? positive.totalCandidates));
  const gate1Evaluated = totalCandidates;
  const decomposition = summary?.entryFilterDecomposition;
  const rawHardPass = summary?.gate2SoftLeadershipLane?.gate1HardSurvivors
    ?? countSnapshots(summary, (candidate) => (candidate as { gate1Passed?: boolean }).gate1Passed === true);
  const rawSoftPass = decomposition?.gate1DecompositionReport?.gate1Passed
    ?? summary?.candidateGateAggregate?.gate1PassCount.value
    ?? rawHardPass;
  const gate1HardPass = Math.min(rawHardPass, gate1Evaluated);
  const gate1SoftPass = Math.min(Math.max(rawSoftPass, gate1HardPass), gate1Evaluated);
  const rawMinSignalPass = summary?.gate2SoftLeadershipLane?.minSignalLivePass
    ?? countSnapshots(summary, (candidate) => (candidate as { minSignalScorePassed?: boolean }).minSignalScorePassed === true);
  const minSignalLivePass = Math.min(rawMinSignalPass, gate1Evaluated);
  const rawLiveCandidate = countEntryLane(summary, 'liveCandidates') || (summary?.liveEligibleCount ?? 0);
  const liveCandidateAfterGate1 = Math.min(rawLiveCandidate, minSignalLivePass);
  const diagnosticSurvivor = Math.min(
    Math.max(
      gate1SoftPass,
      rawLiveCandidate,
      summary?.gate2SoftLeadershipLane?.gate2PendingPreserved ?? 0,
    ),
    gate1Evaluated,
  );
  const rawShadowObservable = summary?.shadowObservableCount
    ?? summary?.gate2SoftLeadershipLane?.gate2PendingPreserved
    ?? 0;
  const shadowObservable = Math.min(rawShadowObservable, gate1Evaluated);
  // Source the actual counterfactual ledger rows created (canonical entryLaneSplit.counterfactualCreated),
  // not the entry-filter block-distribution metric. decomposition.counterfactualRecorded counts candidates
  // diverted INTO the counterfactual entry lane during the buy loop (frequently 0 under WATCH/SHADOW_ONLY),
  // which is a different scope and contradicted Candidate Pool / Entry Lane Split (both report the ledger count).
  // 0 is not nullish, so the previous `decomposition?.counterfactualRecorded ?? …` chain short-circuited and
  // never reached the lane count. executionImpact=NONE — diagnostic accounting consistency only.
  const laneCounterfactual = summary?.entryLaneSplit
    ? countEntryLane(summary, 'counterfactualCreated')
    : undefined;
  const rawCounterfactual = laneCounterfactual
    ?? decomposition?.counterfactualRecorded
    ?? (summary?.gate2SoftLeadershipLane?.counterfactualRecorded ? totalCandidates : 0);
  const counterfactualRecorded = Math.min(rawCounterfactual, totalCandidates);
  const note = gate1HardPass === 0 && rawLiveCandidate > 0
    ? 'liveCandidateAfterGate1 excludes policy-blocked diagnostic candidates; raw liveCandidates are reported as diagnosticSurvivor.'
    : 'liveCandidateAfterGate1 is executable-live taxonomy only; diagnostic/shadow candidates are counted separately.';
  return {
    totalCandidates,
    gate1Evaluated,
    gate1HardPass,
    gate1SoftPass,
    minSignalLivePass,
    liveCandidateAfterGate1,
    diagnosticSurvivor,
    shadowObservable,
    counterfactualRecorded,
    note,
  };
}

function gate2NotEvaluatedWhenGate1Fail(summary?: ScanSummary | null): boolean {
  const results = summary?.candidateGate2Confluence?.results ?? [];
  return results.every((result) => {
    const record = result as unknown as Record<string, unknown>;
    if (record.gate1Status !== 'FAIL_HARD') return true;
    return record.finalGate2 === 'NOT_EVALUATED_DUE_TO_GATE1_FAIL' &&
      record.upstreamBlocker === 'GATE1_FAIL' &&
      record.primaryBlocker === undefined;
  });
}

function legacyR6NotUsedForDecision(summary?: ScanSummary | null): boolean {
  const macro = summary?.macroGateState;
  if (!macro) return true;
  const legacyEffective = macro.macroRegimeEffective === 'R6_DEFENSE' || macro.riskOverride === 'R6_DEFENSE';
  if (!legacyEffective) return true;
  return macro.macroRegimeRaw !== 'R6_DEFENSE' &&
    macro.regime !== 'R6_DEFENSE' &&
    macro.displayRegime !== 'R6_DEFENSE';
}

export function buildGate1ScoreAccountingReport(
  input: Gate1ScoreAccountingInput,
): Gate1ScoreAccountingReport | null {
  const positive = input.positive;
  if (!positive || positive.totalCandidates <= 0) return null;
  const penalty = buildPenaltyAccounting(input);
  const configuredPositiveMax = round1(Math.max(
    positive.scoreCeilingAudit.configuredPositiveMaxScore,
    positive.grossPositiveScoreAvg,
    positive.actualScoreMax,
    0.1,
  ));
  const observedPositiveMax = round1(Math.max(
    positive.scoreCeilingAudit.observedPositiveMaxScore,
    positive.grossPositiveScoreAvg,
  ));
  const finalGate1ScoreAvg = positive.actualScoreAvg;
  const netScoreAvg = round1(positive.grossPositiveScoreAvg - penalty.effectiveOriginalPenaltyAvg);
  const normalizedGate1ScorePct = pct(finalGate1ScoreAvg, configuredPositiveMax);
  const scaleMismatch = isGate1ScaleMismatch(finalGate1ScoreAvg, netScoreAvg, positive.positiveUtilizationAvg);
  // ADR-0546 섀도 병행 — legacy(70) vs 레짐 인식 required 를 나란히 기록 (Phase1 동작 보존).
  // scoring-effective regime SSOT 사용 — stale legacy R6 누출 차단(R6 6×10=60 오염 방지).
  const regime = resolveScoringEffectiveRegime(input.summary?.macroGateState);
  const legacyRequiredScore = LEGACY_GATE1_REQUIRED_SCORE;
  const regimeAwareRequiredScore = round1(getRegimeAwareGate1RequiredScore(regime));
  const regimeAwareGap = round1(legacyRequiredScore - regimeAwareRequiredScore);
  const appliedRequiredScore = resolveGate1RequiredScore(regime);
  const regimeAwareRequiredActive = isGate1RegimeAwareRequiredEnabled();
  const survivor = buildSurvivorTaxonomy(input, positive);
  const kis = input.canonical?.kisInvestorFlow as (CanonicalRuntimeResolutionStep27['kisInvestorFlow'] & {
    apiPath?: string | null;
    trId?: string | null;
    metadataCarryInvariant?: string;
  }) | undefined;
  const metadataPresent = Boolean(kis?.apiPath && kis.trId);
  const metadataCarryOk = !kis || kis.selectedProvider !== 'KIS_API' ||
    (metadataPresent && kis.metadataCarryInvariant !== 'MISSING');
  const survivorOk =
    survivor.gate1HardPass <= survivor.gate1SoftPass &&
    survivor.gate1SoftPass <= survivor.gate1Evaluated &&
    survivor.minSignalLivePass <= survivor.gate1Evaluated &&
    survivor.liveCandidateAfterGate1 <= survivor.minSignalLivePass &&
    survivor.shadowObservable <= survivor.gate1Evaluated &&
    survivor.counterfactualRecorded <= survivor.totalCandidates;
  return {
    requiredScoreAvg: positive.requiredScoreAvg,
    finalGate1ScoreAvg,
    finalGate1ScoreMin: positive.actualScoreMin,
    finalGate1ScoreMax: positive.actualScoreMax,
    rawPositiveScoreAvg: positive.grossPositiveScoreAvg,
    rawPenaltyScoreAvg: positive.totalPenaltyScoreAvg,
    effectivePenaltyScoreAvg: penalty.effectiveOriginalPenaltyAvg,
    netScoreAvg,
    normalizedGate1ScorePct,
    configuredPositiveMax,
    observedPositiveMax,
    utilizationByMaxPct: pct(observedPositiveMax, configuredPositiveMax),
    utilizationByAvgPct: pct(positive.grossPositiveScoreAvg, configuredPositiveMax),
    previousPositiveUtilizationAvgDeprecated: positive.positiveUtilizationAvg,
    scaleMismatch,
    scaleObservationMode: scaleMismatch ? 'SCALE_OBSERVATION_ONLY' : 'NONE',
    legacyRequiredScore,
    regimeAwareRequiredScore,
    regimeAwareGap,
    appliedRequiredScore,
    regimeAwareRequiredActive,
    thresholdAutoChanged: false,
    operatorApprovalRequired: true,
    liveExecutionAllowed: false,
    primaryIssue: finalGate1ScoreAvg < positive.requiredScoreAvg ? 'SCORE_THRESHOLD_NOT_MET' : 'NONE',
    secondaryIssue: scaleMismatch ? 'SCALE_OBSERVATION_ONLY' : positive.recommendedAction,
    penalty,
    survivor,
    invariants: [
      {
        code: 'GATE1_SCORE_LABEL_CONSISTENCY',
        status: 'OK',
        message: 'final/raw/effective/diagnostic score labels are rendered from one accounting report.',
      },
      {
        code: 'SCORE_AVG_CONSISTENCY',
        status: 'OK',
        message: 'actualScoreAvg is rendered as finalGate1ScoreAvg; rawPositive/net labels are separate.',
      },
      {
        code: 'GATE1_OBSERVATION_LEDGER_NON_EXECUTIONAL',
        status: 'OK',
        message: 'Gate1 observation rows are diagnostic only; thresholdAutoChanged=false and liveExecutionAllowed=false.',
      },
      {
        code: 'PENALTY_ACCOUNTING_CONSISTENCY',
        status: penalty.effectiveRemovedPenaltyAvg <= penalty.effectiveOriginalPenaltyAvg ? 'OK' : 'FAIL',
        message: 'effectiveRemovedPenaltyAvg must not exceed effectiveOriginalPenaltyAvg.',
      },
      {
        code: 'DIAGNOSTIC_PENALTY_SEPARATION',
        status: !penalty.diagnosticOnly || penalty.effectiveGateScoreImpact === 0 ? 'OK' : 'FAIL',
        message: 'diagnosticOnly penalty must not affect effectiveGateScore.',
      },
      {
        code: 'SURVIVOR_TAXONOMY_CONSISTENCY',
        status: survivorOk ? 'OK' : 'FAIL',
        message: 'hard/soft/live/diagnostic survivor counts obey hierarchy.',
      },
      {
        code: 'POSITIVE_UTILIZATION_RANGE',
        status: positive.positiveUtilizationAvg <= 100 && pct(observedPositiveMax, configuredPositiveMax) <= 100 ? 'OK' : 'FAIL',
        message: 'utilization percentage must stay <=100 unless explicitly named deprecated/overutilization.',
      },
      {
        code: 'KIS_METADATA_CARRY',
        status: metadataCarryOk ? 'OK' : 'FAIL',
        message: 'canonical apiPath/trId must be carried without UNKNOWN metadata markers when present.',
      },
      {
        code: 'GATE2_NOT_EVALUATED_WHEN_GATE1_FAIL',
        status: gate2NotEvaluatedWhenGate1Fail(input.summary) ? 'OK' : 'FAIL',
        message: 'Gate2 matrix must not imply a Gate2 hard failure for Gate1-failed candidates.',
      },
      {
        code: 'SHADOW_LEARNING_CONTINUES_UNDER_SHADOW_ONLY',
        status: 'OK',
        message: 'Shadow learning remains observable while live execution is policy-blocked.',
      },
      {
        code: 'LEGACY_R6_NOT_USED_FOR_DECISION',
        status: legacyR6NotUsedForDecision(input.summary) ? 'OK' : 'FAIL',
        message: 'Legacy R6 labels must not leak into current Gate1/Gate2 decision attribution.',
      },
    ],
    executionImpact: 'NONE',
    shadowLearning: true,
  };
}

export function formatGate1ScoreHealthSection(
  summary: ScanSummary | null | undefined,
  canonical?: CanonicalRuntimeResolutionStep27 | null,
): string | null {
  const report = buildGate1ScoreAccountingReport({
    positive: summary?.positiveScoreStarvation,
    penalty: summary?.penaltyDeduplication,
    finalCalibration: summary?.finalGate1Calibration,
    canonical: canonical ?? summary?.canonicalRuntimeResolution,
    summary,
  });
  if (!report) return null;
  const gap = round1(report.finalGate1ScoreAvg - report.requiredScoreAvg);
  const penalty = report.penalty;
  const survivor = report.survivor;
  return [
    'Gate1 Score Health:',
    `- finalScoreAvg=${report.finalGate1ScoreAvg.toFixed(1)} / required=${report.requiredScoreAvg.toFixed(1)} / gap=${gap.toFixed(1)}`,
    `- finalScoreMinMax=${report.finalGate1ScoreMin.toFixed(1)}~${report.finalGate1ScoreMax.toFixed(1)}`,
    `- rawPositiveAvg=${report.rawPositiveScoreAvg.toFixed(1)}`,
    `- effectivePenaltyAvg=${report.effectivePenaltyScoreAvg.toFixed(1)}`,
    `- diagnosticPenaltyAvg=${penalty.diagnosticOriginalPenaltyAvg.toFixed(1)}, diagnosticRemoved=${penalty.diagnosticRemovedPenaltyAvg.toFixed(1)}, gateScoreImpact=${penalty.effectiveGateScoreImpact.toFixed(1)}`,
    `- hardPass=${survivor.gate1HardPass}, softPass=${survivor.gate1SoftPass}, minSignalLivePass=${survivor.minSignalLivePass}`,
    `- primaryIssue=${report.primaryIssue}`,
    `- secondaryIssue=${report.secondaryIssue}`,
    `- scaleObservationMode=${report.scaleObservationMode}`,
    `- legacyRequired=${report.legacyRequiredScore.toFixed(1)} regimeAwareRequired=${report.regimeAwareRequiredScore.toFixed(1)} regimeAwareGap=${report.regimeAwareGap.toFixed(1)} applied=${report.appliedRequiredScore.toFixed(1)} regimeAwareActive=${report.regimeAwareRequiredActive} (ADR-0546 shadow)`,
    formatGate1RegimeAwareSurvivorLine(summary?.gate1RegimeAwareSurvivor),
    `- thresholdAutoChanged=${report.thresholdAutoChanged}`,
    `- operatorApprovalRequired=${report.operatorApprovalRequired}`,
    `- liveExecutionAllowed=${report.liveExecutionAllowed}`,
    '- operatorMessage=Gate1 기준 미달 우세 - 데이터 배선 문제 아님',
    '- executionImpact=NONE',
    '- shadowLearning=true',
    '',
    'Positive Score Utilization:',
    `- configuredPositiveMax=${report.configuredPositiveMax.toFixed(1)}`,
    `- observedPositiveMax=${report.observedPositiveMax.toFixed(1)}`,
    `- rawPositiveAvg=${report.rawPositiveScoreAvg.toFixed(1)}`,
    `- finalGate1ScoreAvg=${report.finalGate1ScoreAvg.toFixed(1)}`,
    `- utilizationByMax=${report.utilizationByMaxPct.toFixed(1)}%`,
    `- utilizationByAvg=${report.utilizationByAvgPct.toFixed(1)}%`,
    `- scaleMismatch=${report.scaleMismatch} observationOnly=${report.scaleObservationMode === 'SCALE_OBSERVATION_ONLY'}`,
    `- previousPositiveUtilizationAvgDeprecated=${report.previousPositiveUtilizationAvgDeprecated.toFixed(1)}%`,
    '',
    'Penalty Diagnostic:',
    `- effective penalties: ${penalty.effectiveOriginalPenaltyAvg > 0 ? `original=${penalty.effectiveOriginalPenaltyAvg.toFixed(1)} deduped=${penalty.effectiveDedupedPenaltyAvg.toFixed(1)} removed=${penalty.effectiveRemovedPenaltyAvg.toFixed(1)}` : 'none'}`,
    `- diagnostic duplicate group: ${penalty.diagnosticGroupKey}, affected=diagnostic, removed=${penalty.diagnosticRemovedPenaltyAvg.toFixed(1)}, impact=NONE`,
    '- no bearish conversion',
    '',
    'Gate1 Survivor Taxonomy:',
    `- totalCandidates=${survivor.totalCandidates}`,
    `- evaluated=${survivor.gate1Evaluated}`,
    `- hardPass=${survivor.gate1HardPass}`,
    `- softPass=${survivor.gate1SoftPass}`,
    `- minSignalLivePass=${survivor.minSignalLivePass}`,
    `- liveCandidateAfterGate1=${survivor.liveCandidateAfterGate1}`,
    `- diagnosticSurvivor=${survivor.diagnosticSurvivor}`,
    `- shadowObservable=${survivor.shadowObservable}`,
    // P2 후속 (scanblockers-truth-consistency followup): entry-lane scope counterfactual
    //   (entryLaneSplit.counterfactualCreated). universe-scope(candidatePoolBuilder.
    //   universeCounterfactualRowsCreated)와 혼동을 막기 위해 scope-prefix. 값/의미 무변경 — 라벨만.
    `- entryCounterfactualRecorded=${survivor.counterfactualRecorded}`,
    `- note: ${survivor.note}`,
    '',
    'Gate1 Score Invariants:',
    ...report.invariants.map((item) => `[${item.status}] ${item.code} - ${item.message}`),
  ].join('\n');
}
