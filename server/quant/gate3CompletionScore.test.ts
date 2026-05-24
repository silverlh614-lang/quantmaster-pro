import { describe, expect, it } from 'vitest';
import { buildGate3CompletionScore, type Gate3CompletionSummaryInput } from './gate3CompletionScore.js';
import { buildGate3EvidenceScore } from './gate3EvidenceScore.js';
import type { Gate3CandidateDetail } from './gate3CandidateDetail.js';
import type { Gate3OutcomeSeed } from './gate3OutcomeSeed.js';
import type { Gate3ShadowPolicy } from './gate3ShadowPolicy.js';

function candidate(input: Partial<Gate3CandidateDetail> = {}): Gate3CandidateDetail {
  return {
    symbol: input.symbol ?? '204320',
    name: input.name,
    sourceSnapshotId: input.sourceSnapshotId ?? 'scan-eval:complete',
    asOf: '2026-05-24T09:00:00.000Z',
    readiness: input.readiness ?? 'READY',
    issue: input.issue ?? 'FIRED',
    priceFreshness: 'VERIFIED',
    rrr: input.rrr ?? {
      value: 2.2,
      status: 'PASS',
      source: 'FALLBACK_PERCENT',
      entryPrice: 10_000,
      stopLoss: 9_300,
      targetPrice: 11_500,
    },
    priceConfirmation: input.priceConfirmation ?? {
      status: input.readiness === 'WAIT' ? 'NEAR_BREAKOUT' : 'BREAKOUT_CONFIRMED',
      distanceToHigh20dPct: 0,
      extensionFromMa20Pct: 2,
    },
    volumeConfirmation: input.volumeConfirmation ?? {
      status: input.readiness === 'WAIT' ? 'DRY_UP' : 'CONFIRMED',
      volumeRatio20d: input.readiness === 'WAIT' ? 0.4 : 1.8,
    },
    falseBreakoutRisk: 'LOW',
    lastTriggerStatus: input.lastTriggerStatus ?? (input.readiness === 'WAIT' ? 'WAIT' : 'FIRED'),
    permissions: {
      liveBuyAllowed: true,
      shadowAllowed: true,
      counterfactualAllowed: true,
      executionImpact: 'NONE',
    },
    compactText: input.compactText ?? 'Gate3 candidate compact',
    marketSignal: input.marketSignal ?? false,
    shadowPolicy: input.shadowPolicy,
  };
}

function policy(detail: Gate3CandidateDetail): Gate3ShadowPolicy {
  const route = detail.readiness === 'READY'
    ? 'SHADOW_ENTRY_ALLOWED'
    : detail.readiness === 'WAIT'
      ? 'NEAR_ENTRY_TRACKING'
      : detail.readiness === 'BLOCKED'
        ? 'COUNTERFACTUAL_ONLY'
        : 'DIAGNOSTIC_ONLY';
  return {
    symbol: detail.symbol,
    sourceSnapshotId: detail.sourceSnapshotId,
    readiness: detail.readiness,
    route,
    shadowEntryAllowed: detail.readiness === 'READY',
    paperOrderAllowed: detail.readiness === 'READY',
    nearEntryTracking: detail.readiness === 'WAIT',
    watchlistUpgrade: detail.readiness === 'WAIT',
    counterfactualAllowed: true,
    diagnosticOnly: detail.readiness === 'DATA_INCOMPLETE',
    learningLabel: detail.readiness === 'READY' ? 'GATE3_READY_FIRED' : 'GATE3_WAIT_DRY_UP',
    liveBuyAllowed: detail.readiness === 'READY',
    executionImpact: 'DIAGNOSTIC_ONLY',
    reason: 'test',
    marketSignal: false,
    providerIssue: false,
  };
}

function outcome(detail: Gate3CandidateDetail, index: number): Gate3OutcomeSeed {
  return {
    id: `outcome-${index}`,
    symbol: detail.symbol,
    sourceSnapshotId: detail.sourceSnapshotId,
    gate3SnapshotId: `${detail.sourceSnapshotId}:gate3`,
    asOf: detail.asOf,
    tradeDate: '2026-05-24',
    readiness: detail.readiness,
    issue: detail.issue,
    route: policy(detail).route,
    entryReferencePrice: detail.rrr.entryPrice,
    stopLoss: detail.rrr.stopLoss,
    targetPrice: detail.rrr.targetPrice,
    rrr: detail.rrr.value,
    priceConfirmation: detail.priceConfirmation.status,
    volumeConfirmation: detail.volumeConfirmation.status,
    falseBreakoutRisk: detail.falseBreakoutRisk,
    lastTriggerStatus: detail.lastTriggerStatus,
    learningLabel: policy(detail).learningLabel,
    forwardReturns: { d1: null, d3: null, d5: 3, d10: null },
    maxForwardReturnPct: 3,
    minForwardReturnPct: 1,
    hitTarget: false,
    hitStop: false,
    outcomeStatus: 'LABELED',
    outcomeLabel: detail.readiness === 'READY' ? 'GATE3_READY_FOLLOW_THROUGH' : 'GATE3_WAIT_CORRECT_PATIENCE',
    executionImpact: 'DIAGNOSTIC_ONLY',
    marketSignal: false,
    providerIssue: false,
  };
}

function completeSummary(): Gate3CompletionSummaryInput {
  const details = [
    candidate({ symbol: '204320', readiness: 'READY' }),
    candidate({ symbol: '011210', readiness: 'WAIT' }),
  ];
  const policies = details.map(policy);
  const outcomes = details.map(outcome);
  return {
    samples: 2,
    timingReadiness: { READY: 1, WAIT: 1 },
    lastTriggerStatus: { FIRED: 1, WAIT: 1 },
    priceFreshness: { VERIFIED: 2 },
    executionImpact: { NONE: 1, DIAGNOSTIC_ONLY: 1 },
    priceConfirmationStatus: { BREAKOUT_CONFIRMED: 1, NEAR_BREAKOUT: 1 },
    volumeConfirmationStatus: { CONFIRMED: 1, DRY_UP: 1 },
    rrrPassCount: 2,
    rrrWatchCount: 0,
    rrrFailCount: 0,
    rrrMissingCount: 0,
    entryPriceStaleCount: 0,
    candidateDetails: details,
    shadowPolicies: policies,
    shadowRouting: {
      samples: 2,
      routeCounts: { SHADOW_ENTRY_ALLOWED: 1, NEAR_ENTRY_TRACKING: 1, COUNTERFACTUAL_ONLY: 0, DIAGNOSTIC_ONLY: 0 },
      learningLabels: {} as never,
      shadowEntryAllowedCount: 1,
      nearEntryTrackingCount: 1,
      counterfactualOnlyCount: 0,
      diagnosticOnlyCount: 0,
      watchlistUpgradeCount: 1,
      paperOrderAllowedCount: 1,
      livePolicyBlockedCount: 0,
      counterfactualAllowedCount: 2,
    },
    outcomeSeeds: outcomes,
    outcomeTracking: {
      seedCreatedToday: 2,
      pending: 0,
      partial: 0,
      labeled: 2,
      expired: 0,
      dataInsufficient: 0,
      duplicateSuppressed: 0,
      byReadiness: {
        READY: { pending: 0, labeled: 1 },
        WAIT: { pending: 0, labeled: 1 },
        BLOCKED: { pending: 0, labeled: 0 },
        DATA_INCOMPLETE: { pending: 0, labeled: 0 },
      },
      recentLabels: {},
      marketSignal: false,
      providerIssue: false,
      executionImpact: 'NONE',
    },
    thresholdEvidence: buildGate3EvidenceScore(outcomes),
  };
}

describe('buildGate3CompletionScore', () => {
  it('returns COMPLETE when every Gate3 completion component passes', () => {
    const score = buildGate3CompletionScore(completeSummary(), {
      sourceSnapshotId: 'scan-eval:complete',
      gate1SourceSnapshotId: 'scan-eval:complete',
      gate2SourceSnapshotId: 'scan-eval:complete',
      gate3SourceSnapshotId: 'scan-eval:complete',
      asOf: '2026-05-24T09:00:00.000Z',
    });

    expect(score.status).toBe('COMPLETE');
    expect(score.score).toBe(100);
    expect(score.blockers).toHaveLength(0);
    expect(score.completionReady).toBe(true);
  });

  it('keeps low threshold evidence as PARTIAL but not BROKEN', () => {
    const summary = completeSummary();
    summary.thresholdEvidence = buildGate3EvidenceScore([]);
    const score = buildGate3CompletionScore(summary, { sourceSnapshotId: 'scan-eval:complete' });

    expect(score.status).toBe('PARTIAL');
    expect(score.score).toBe(99);
    expect(score.blockers).toHaveLength(0);
    expect(score.warnings.map(check => check.component)).toContain('THRESHOLD_EVIDENCE');
  });

  it('blocks on candidate detail count mismatch', () => {
    const summary = completeSummary();
    summary.candidateDetails = summary.candidateDetails.slice(0, 1);
    const score = buildGate3CompletionScore(summary, { sourceSnapshotId: 'scan-eval:complete' });

    expect(score.status).toBe('BROKEN');
    expect(score.blockers.map(check => check.component)).toContain('CANDIDATE_DETAIL');
  });

  it('marks sourceSnapshot mismatch as a critical blocker', () => {
    const summary = completeSummary();
    summary.candidateDetails[1] = candidate({ symbol: '011210', readiness: 'WAIT', sourceSnapshotId: 'scan-eval:other' });
    const score = buildGate3CompletionScore(summary, { sourceSnapshotId: 'scan-eval:complete' });

    expect(score.status).toBe('BROKEN');
    expect(score.blockers.find(check => check.component === 'SOURCE_SNAPSHOT_INTEGRITY')?.severity).toBe('CRITICAL');
  });

  it('marks marketSignal pollution as a critical blocker', () => {
    const summary = completeSummary();
    summary.candidateDetails[0] = candidate({ symbol: '204320', readiness: 'READY', marketSignal: true as never });
    const score = buildGate3CompletionScore(summary, { sourceSnapshotId: 'scan-eval:complete' });

    expect(score.blockers.find(check => check.component === 'POLICY_SEPARATION')?.severity).toBe('CRITICAL');
  });

  it('blocks threshold suggestions that are not suggest-only', () => {
    const summary = completeSummary();
    summary.thresholdEvidence = {
      ...summary.thresholdEvidence!,
      suggestions: [{
        key: 'RRR_PASS_MIN',
        currentValue: 2,
        suggestedValue: 1.8,
        reason: 'bad test suggestion',
        confidence: 'LOW',
        sampleSize: 10,
        evidenceWindow: 'D5',
        applyMode: 'AUTO_APPLY',
      } as never],
    };
    const score = buildGate3CompletionScore(summary, { sourceSnapshotId: 'scan-eval:complete' });

    expect(score.status).toBe('BROKEN');
    expect(score.blockers.find(check => check.component === 'THRESHOLD_EVIDENCE')?.severity).toBe('CRITICAL');
  });
});
