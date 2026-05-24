// @responsibility Gate3 final completion scoring and operator formatting; diagnostic only.

import type { Gate3CandidateDetail, Gate3Readiness } from './gate3CandidateDetail.js';
import type { Gate3EvidenceScore } from './gate3EvidenceScore.js';
import { buildGate3EvidenceWarmupStatus, type Gate3EvidenceWarmupStatus } from './gate3EvidenceWarmup.js';
import type { Gate3OutcomeSeed, Gate3OutcomeTrackingSummary } from './gate3OutcomeSeed.js';
import type { Gate3ShadowPolicy, Gate3ShadowRoute, Gate3ShadowRoutingSummary } from './gate3ShadowPolicy.js';
import type { LiveReadinessScore } from './liveReadinessScore.js';

export type Gate3CompletionStatus = 'COMPLETE' | 'PARTIAL' | 'INCOMPLETE' | 'BROKEN';

export type Gate3CompletionComponent =
  | 'EVALUATION'
  | 'PRICE_GUARD'
  | 'RRR_BUILDER'
  | 'PRICE_CONFIRMATION'
  | 'VOLUME_CONFIRMATION'
  | 'LAST_TRIGGER'
  | 'CANDIDATE_DETAIL'
  | 'SHADOW_POLICY'
  | 'OUTCOME_TRACKING'
  | 'THRESHOLD_EVIDENCE'
  | 'SOURCE_SNAPSHOT_INTEGRITY'
  | 'POLICY_SEPARATION'
  | 'LEARNING_CONTINUITY';

export interface Gate3CompletionCheck {
  component: Gate3CompletionComponent;
  passed: boolean;
  score: number;
  reason: string;
  severity: 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';
}

export interface Gate3CompletionScore {
  status: Gate3CompletionStatus;
  score: number;
  checks: Gate3CompletionCheck[];
  blockers: Gate3CompletionCheck[];
  warnings: Gate3CompletionCheck[];
  sourceSnapshotId: string | null;
  evaluatedCount: number;
  candidateDetailCount: number;
  completionReady: boolean;
  liveReadinessContribution: number;
  asOf: string;
}

export interface Gate3CompletionContext {
  sourceSnapshotId?: string | null;
  gate1SourceSnapshotId?: string | null;
  gate2SourceSnapshotId?: string | null;
  gate3SourceSnapshotId?: string | null;
  asOf?: string;
  shadowLearning?: boolean;
  counterfactualRecorded?: boolean;
  engineMode?: string | null;
  macroRegime?: string | null;
}

export interface Gate3CompletionSummaryInput {
  samples: number;
  timingReadiness: Record<string, number>;
  lastTriggerStatus: Record<string, number>;
  priceFreshness: Record<string, number>;
  executionImpact: Record<string, number>;
  priceConfirmationStatus: Record<string, number>;
  volumeConfirmationStatus: Record<string, number>;
  rrrPassCount: number;
  rrrWatchCount: number;
  rrrFailCount: number;
  rrrMissingCount: number;
  entryPriceStaleCount: number;
  candidateDetails: Gate3CandidateDetail[];
  shadowPolicies: Gate3ShadowPolicy[];
  shadowRouting?: Gate3ShadowRoutingSummary;
  outcomeSeeds: Gate3OutcomeSeed[];
  outcomeTracking?: Gate3OutcomeTrackingSummary;
  thresholdEvidence?: Gate3EvidenceScore;
  evidenceWarmup?: Gate3EvidenceWarmupStatus;
  providerIssue?: boolean;
  marketSignal?: boolean;
  completionScore?: Gate3CompletionScore;
  liveReadinessScore?: LiveReadinessScore;
}

export interface Gate3LearningFinalizationSummary {
  outcomeSeeds: number;
  labeled: number;
  pending: number;
  dataInsufficient: number;
  thresholdEvidenceSampleSize: number;
  suggestions: number;
  completionScore: number;
  status: Gate3CompletionStatus;
  evidenceWarmup: Gate3EvidenceWarmupStatus;
  marketSignal: false;
}

const MAX_SCORE: Record<Gate3CompletionComponent, number> = {
  EVALUATION: 10,
  PRICE_GUARD: 8,
  RRR_BUILDER: 10,
  PRICE_CONFIRMATION: 8,
  VOLUME_CONFIRMATION: 8,
  LAST_TRIGGER: 10,
  CANDIDATE_DETAIL: 8,
  SHADOW_POLICY: 8,
  OUTCOME_TRACKING: 8,
  THRESHOLD_EVIDENCE: 6,
  SOURCE_SNAPSHOT_INTEGRITY: 6,
  POLICY_SEPARATION: 5,
  LEARNING_CONTINUITY: 5,
};

const READINESS_VALUES: Gate3Readiness[] = ['READY', 'WAIT', 'BLOCKED', 'DATA_INCOMPLETE'];
const LAST_TRIGGER_VALUES = new Set(['FIRED', 'WAIT', 'THRESHOLD_NOT_MET', 'DATA_UNAVAILABLE']);
const PRICE_VALUES = new Set(['BREAKOUT_CONFIRMED', 'NEAR_BREAKOUT', 'PULLBACK_ENTRY', 'NOT_CONFIRMED', 'OVEREXTENDED', 'DATA_UNAVAILABLE']);
const VOLUME_VALUES = new Set(['CONFIRMED', 'PARTIAL', 'DRY_UP', 'WEAK', 'SPIKE_RISK', 'DATA_UNAVAILABLE']);
const ROUTE_BY_READINESS: Record<Gate3Readiness, Gate3ShadowRoute> = {
  READY: 'SHADOW_ENTRY_ALLOWED',
  WAIT: 'NEAR_ENTRY_TRACKING',
  BLOCKED: 'COUNTERFACTUAL_ONLY',
  DATA_INCOMPLETE: 'DIAGNOSTIC_ONLY',
};

function sumCounts(counts: Record<string, number> | undefined): number {
  return Object.values(counts ?? {}).reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
}

function validCountKeys(counts: Record<string, number> | undefined, allowed: ReadonlySet<string>): boolean {
  const keys = Object.keys(counts ?? {}).filter((key) => (counts?.[key] ?? 0) > 0);
  return keys.length > 0 && keys.every((key) => allowed.has(key));
}

function addCheck(
  checks: Gate3CompletionCheck[],
  component: Gate3CompletionComponent,
  passed: boolean,
  reason: string,
  severity: Gate3CompletionCheck['severity'],
  scoreOverride?: number,
): void {
  checks.push({
    component,
    passed,
    score: passed ? MAX_SCORE[component] : (scoreOverride ?? 0),
    reason,
    severity: passed ? 'INFO' : severity,
  });
}

function uniqueStrings(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0))];
}

function sourceSnapshotIdFor(summary: Gate3CompletionSummaryInput, context: Gate3CompletionContext): string | null {
  return context.sourceSnapshotId
    ?? uniqueStrings(summary.candidateDetails.map((detail) => detail.sourceSnapshotId))[0]
    ?? null;
}

function dataUnavailableExplained(detail: Gate3CandidateDetail): boolean {
  if (detail.lastTriggerStatus !== 'DATA_UNAVAILABLE') return true;
  return detail.issue === 'DATA_UNAVAILABLE'
    || detail.issue === 'RRR_MISSING'
    || detail.rrr.status === 'MISSING'
    || detail.priceConfirmation.status === 'DATA_UNAVAILABLE'
    || detail.volumeConfirmation.status === 'DATA_UNAVAILABLE';
}

function completionStatus(score: number, checks: readonly Gate3CompletionCheck[], blockers: readonly Gate3CompletionCheck[]): Gate3CompletionStatus {
  if (blockers.some((check) => check.severity === 'CRITICAL') || score < 70) return 'BROKEN';
  if (blockers.length > 0 || score < 90) return 'INCOMPLETE';
  if (score >= 98 && checks.every((check) => check.passed)) return 'COMPLETE';
  return 'PARTIAL';
}

export function buildGate3CompletionScore(
  summary: Gate3CompletionSummaryInput | null | undefined,
  context: Gate3CompletionContext = {},
): Gate3CompletionScore {
  const asOf = context.asOf ?? new Date().toISOString();
  if (!summary) {
    const check: Gate3CompletionCheck = {
      component: 'EVALUATION',
      passed: false,
      score: 0,
      reason: 'GATE3_SUMMARY_MISSING',
      severity: 'CRITICAL',
    };
    return {
      status: 'BROKEN',
      score: 0,
      checks: [check],
      blockers: [check],
      warnings: [],
      sourceSnapshotId: context.sourceSnapshotId ?? null,
      evaluatedCount: 0,
      candidateDetailCount: 0,
      completionReady: false,
      liveReadinessContribution: 0,
      asOf,
    };
  }

  const checks: Gate3CompletionCheck[] = [];
  const evaluatedCount = summary.samples;
  const candidateDetailCount = summary.candidateDetails.length;
  const sourceSnapshotId = sourceSnapshotIdFor(summary, context);
  const readinessSum = sumCounts(summary.timingReadiness);
  const rrrSum = summary.rrrPassCount + summary.rrrWatchCount + summary.rrrFailCount + summary.rrrMissingCount;
  const candidateSources = uniqueStrings(summary.candidateDetails.map((detail) => detail.sourceSnapshotId));
  const contextSources = uniqueStrings([
    context.sourceSnapshotId ?? sourceSnapshotId,
    context.gate1SourceSnapshotId,
    context.gate2SourceSnapshotId,
    context.gate3SourceSnapshotId,
  ]);

  addCheck(
    checks,
    'EVALUATION',
    evaluatedCount > 0 && readinessSum === evaluatedCount,
    `evaluated=${evaluatedCount} readinessSum=${readinessSum}`,
    evaluatedCount > 0 ? 'ERROR' : 'CRITICAL',
  );
  addCheck(
    checks,
    'PRICE_GUARD',
    sumCounts(summary.priceFreshness) === evaluatedCount
      && summary.candidateDetails.every((detail) => Boolean(detail.priceFreshness)),
    `priceFreshnessSum=${sumCounts(summary.priceFreshness)} staleBlocked=${summary.entryPriceStaleCount}`,
    'ERROR',
  );
  addCheck(
    checks,
    'RRR_BUILDER',
    rrrSum === evaluatedCount
      && summary.candidateDetails.every((detail) => Boolean(detail.rrr) && detail.rrr.status !== undefined),
    `rrrSum=${rrrSum} pass=${summary.rrrPassCount} watch=${summary.rrrWatchCount} fail=${summary.rrrFailCount} missing=${summary.rrrMissingCount}`,
    'ERROR',
  );
  addCheck(
    checks,
    'PRICE_CONFIRMATION',
    sumCounts(summary.priceConfirmationStatus) === evaluatedCount
      && validCountKeys(summary.priceConfirmationStatus, PRICE_VALUES)
      && summary.candidateDetails.every((detail) => PRICE_VALUES.has(detail.priceConfirmation.status)),
    `priceConfirmationSum=${sumCounts(summary.priceConfirmationStatus)}`,
    'ERROR',
  );
  addCheck(
    checks,
    'VOLUME_CONFIRMATION',
    sumCounts(summary.volumeConfirmationStatus) === evaluatedCount
      && validCountKeys(summary.volumeConfirmationStatus, VOLUME_VALUES)
      && summary.candidateDetails.every((detail) => VOLUME_VALUES.has(detail.volumeConfirmation.status)),
    `volumeConfirmationSum=${sumCounts(summary.volumeConfirmationStatus)}`,
    'ERROR',
  );
  addCheck(
    checks,
    'LAST_TRIGGER',
    sumCounts(summary.lastTriggerStatus) === evaluatedCount
      && validCountKeys(summary.lastTriggerStatus, LAST_TRIGGER_VALUES)
      && summary.candidateDetails.every(dataUnavailableExplained),
    `lastTriggerStatusSum=${sumCounts(summary.lastTriggerStatus)}`,
    'ERROR',
  );
  addCheck(
    checks,
    'CANDIDATE_DETAIL',
    candidateDetailCount === evaluatedCount
      && summary.candidateDetails.every((detail) => typeof detail.compactText === 'string' && detail.compactText.length > 0),
    `candidateDetails=${candidateDetailCount} evaluated=${evaluatedCount}`,
    candidateDetailCount === evaluatedCount ? 'WARN' : 'CRITICAL',
  );
  addCheck(
    checks,
    'SHADOW_POLICY',
    summary.shadowPolicies.length === candidateDetailCount
      && summary.shadowPolicies.every((policy) => policy.route === ROUTE_BY_READINESS[policy.readiness])
      && summary.shadowPolicies.every((policy) => policy.counterfactualAllowed === true),
    `shadowPolicies=${summary.shadowPolicies.length} candidateDetails=${candidateDetailCount}`,
    'CRITICAL',
  );
  addCheck(
    checks,
    'OUTCOME_TRACKING',
    summary.outcomeSeeds.length === candidateDetailCount
      && summary.outcomeTracking !== undefined,
    `outcomeSeeds=${summary.outcomeSeeds.length} candidateDetails=${candidateDetailCount}`,
    'WARN',
  );
  addCheck(
    checks,
    'THRESHOLD_EVIDENCE',
    summary.thresholdEvidence !== undefined
      && summary.thresholdEvidence.sampleSize > 0
      && summary.thresholdEvidence.suggestions.every((item) => item.applyMode === 'SUGGEST_ONLY'),
    summary.thresholdEvidence
      ? `sampleSize=${summary.thresholdEvidence.sampleSize} suggestions=${summary.thresholdEvidence.suggestions.length}`
      : 'thresholdEvidence=MISSING',
    summary.thresholdEvidence?.suggestions.some((item) => item.applyMode !== 'SUGGEST_ONLY') ? 'CRITICAL' : 'WARN',
    summary.thresholdEvidence && summary.thresholdEvidence.suggestions.every((item) => item.applyMode === 'SUGGEST_ONLY') ? 5 : 0,
  );
  addCheck(
    checks,
    'SOURCE_SNAPSHOT_INTEGRITY',
    candidateSources.length === 1
      && (contextSources.length === 0 || contextSources.every((id) => id === candidateSources[0])),
    `candidateSources=${candidateSources.join(',') || 'none'} contextSources=${contextSources.join(',') || 'none'}`,
    'CRITICAL',
  );
  addCheck(
    checks,
    'POLICY_SEPARATION',
    summary.marketSignal !== true
      && summary.providerIssue !== true
      && summary.candidateDetails.every((detail) => detail.marketSignal === false)
      && summary.shadowPolicies.every((policy) => policy.marketSignal === false && policy.providerIssue === false),
    'marketSignal=false providerIssue=false readiness/livePermissionSeparated=true',
    'CRITICAL',
  );
  addCheck(
    checks,
    'LEARNING_CONTINUITY',
    context.shadowLearning !== false
      && context.counterfactualRecorded !== false
      && (summary.shadowRouting?.counterfactualAllowedCount ?? summary.shadowPolicies.filter((policy) => policy.counterfactualAllowed).length) === candidateDetailCount,
    `shadowLearning=${context.shadowLearning !== false} counterfactualAllowed=${summary.shadowRouting?.counterfactualAllowedCount ?? 0}`,
    'ERROR',
  );

  const score = checks.reduce((sum, check) => sum + check.score, 0);
  const blockers = checks.filter((check) => !check.passed && (check.severity === 'ERROR' || check.severity === 'CRITICAL'));
  const warnings = checks.filter((check) => !check.passed && check.severity === 'WARN');
  const status = completionStatus(score, checks, blockers);

  return {
    status,
    score,
    checks,
    blockers,
    warnings,
    sourceSnapshotId,
    evaluatedCount,
    candidateDetailCount,
    completionReady: status === 'COMPLETE',
    liveReadinessContribution: Math.round((score / 100) * 10),
    asOf,
  };
}

function checkLine(check: Gate3CompletionCheck): string {
  const label = check.passed ? '[OK]' : check.severity === 'WARN' ? '[WARN]' : '[BLOCK]';
  return `${label} ${check.component} ${check.score}/${MAX_SCORE[check.component]} reason=${check.reason}`;
}

function completionMessage(score: Gate3CompletionScore): string {
  if (score.status === 'COMPLETE') {
    return 'Gate3 COMPLETE - Entry timing, RRR, price/volume confirmation, LastTrigger, Shadow routing, Outcome tracking, Threshold evidence, and Policy separation validated. Live execution remains policy-controlled.';
  }
  if (score.status === 'PARTIAL') {
    return `Gate3 PARTIAL - Core timing engine operational. Remaining: ${[...score.blockers, ...score.warnings].map((item) => item.component).join(', ') || 'none'}. Shadow and Counterfactual remain active.`;
  }
  if (score.status === 'BROKEN') {
    return 'Gate3 BROKEN - Diagnostic only. Live promotion prohibited. Shadow learning remains active if possible.';
  }
  return `Gate3 INCOMPLETE - Remaining: ${score.blockers.map((item) => item.component).join(', ') || 'unknown'}. Shadow and Counterfactual remain active.`;
}

export function formatGate3FinalizationSection(input: {
  completionScore?: Gate3CompletionScore | null;
  liveReadinessScore?: LiveReadinessScore | null;
}): string | null {
  const score = input.completionScore;
  if (!score) return null;
  const live = input.liveReadinessScore;
  return [
    'Gate3 Finalization',
    '------------------',
    `completionStatus: ${score.status}`,
    `completionScore: ${score.score}/100`,
    `completionReady: ${score.completionReady}`,
    `sourceSnapshotId: ${score.sourceSnapshotId ?? 'N/A'}`,
    `evaluated: ${score.evaluatedCount}`,
    `candidateDetails: ${score.candidateDetailCount}`,
    `blockers: ${score.blockers.length}`,
    `warnings: ${score.warnings.length}`,
    '',
    'Checks:',
    ...score.checks.map(checkLine),
    '',
    'Gate3 LiveReadiness Contribution',
    `gate3EntryTiming: ${live?.components.gate3EntryTiming ?? 'N/A'}/15`,
    `gate3Completion: ${live?.components.gate3Completion ?? score.liveReadinessContribution}/10`,
    `shadowEvidence: ${live?.components.shadowEvidence ?? 'N/A'}/10`,
    `livePolicy: ${live?.liveBlockedReasons.join(',') || (live?.liveAllowedByScore ? 'ALLOWED' : 'N/A')}`,
    `shadowAllowed: ${live?.shadowAllowed ?? true}`,
    `counterfactualAllowed: ${live?.counterfactualAllowed ?? true}`,
    'marketSignal=false',
    completionMessage(score),
  ].join('\n');
}

export function buildGate3LearningFinalization(
  summary: Gate3CompletionSummaryInput | null | undefined,
): Gate3LearningFinalizationSummary {
  if (!summary) {
    return {
      outcomeSeeds: 0,
      labeled: 0,
      pending: 0,
      dataInsufficient: 0,
      thresholdEvidenceSampleSize: 0,
      suggestions: 0,
      completionScore: 0,
      status: 'INCOMPLETE',
      evidenceWarmup: buildGate3EvidenceWarmupStatus([]),
      marketSignal: false,
    };
  }
  const completion = summary?.completionScore ?? buildGate3CompletionScore(summary);
  const evidenceWarmup = summary.evidenceWarmup ?? buildGate3EvidenceWarmupStatus(summary.outcomeSeeds, {
    outcomeTracking: summary.outcomeTracking,
    thresholdEvidenceSampleSize: summary.thresholdEvidence?.sampleSize ?? 0,
  });
  return {
    outcomeSeeds: summary.outcomeSeeds.length,
    labeled: summary.outcomeTracking?.labeled ?? 0,
    pending: (summary.outcomeTracking?.pending ?? 0) + (summary.outcomeTracking?.partial ?? 0),
    dataInsufficient: summary.outcomeTracking?.dataInsufficient ?? 0,
    thresholdEvidenceSampleSize: summary.thresholdEvidence?.sampleSize ?? 0,
    suggestions: summary.thresholdEvidence?.suggestions.length ?? 0,
    completionScore: completion.score,
    status: completion.status,
    evidenceWarmup,
    marketSignal: false,
  };
}

export function formatGate3LearningFinalizationSection(summary: Gate3LearningFinalizationSummary | null | undefined): string | null {
  if (!summary) return null;
  return [
    'Gate3 Learning Finalization',
    '---------------------------',
    `outcomeSeeds: ${summary.outcomeSeeds}`,
    `labeled: ${summary.labeled}`,
    `pending: ${summary.pending}`,
    `dataInsufficient: ${summary.dataInsufficient}`,
    `thresholdEvidenceSampleSize: ${summary.thresholdEvidenceSampleSize}`,
    `suggestions: ${summary.suggestions}`,
    `completionScore: ${summary.completionScore}`,
    `status: ${summary.status}`,
    `evidenceWarmupSchedulerHealthy: ${summary.evidenceWarmup.schedulerHealthy}`,
    `evidenceWarmupWarnings: ${summary.evidenceWarmup.warnings.join(',') || 'none'}`,
    'marketSignal=false; shadowLearning=true; counterfactualRecorded=true',
  ].join('\n');
}
