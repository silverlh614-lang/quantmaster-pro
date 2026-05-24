import { describe, expect, it } from 'vitest';
import { assertGate3CompletionInvariants, Gate3CompletionInvariantError } from './gate3CompletionGuard.js';
import { buildGate3EvidenceScore } from './gate3EvidenceScore.js';
import type { Gate3CompletionSummaryInput } from './gate3CompletionScore.js';

function summary(): Gate3CompletionSummaryInput {
  const detail = {
    symbol: '204320',
    sourceSnapshotId: 'scan-eval:guard',
    asOf: '2026-05-24T09:00:00.000Z',
    readiness: 'READY',
    issue: 'FIRED',
    priceFreshness: 'VERIFIED',
    rrr: { value: 2.1, status: 'PASS', source: 'FALLBACK_PERCENT', entryPrice: 10_000, stopLoss: 9_300, targetPrice: 11_500 },
    priceConfirmation: { status: 'BREAKOUT_CONFIRMED', distanceToHigh20dPct: 0, extensionFromMa20Pct: 2 },
    volumeConfirmation: { status: 'CONFIRMED', volumeRatio20d: 1.8 },
    falseBreakoutRisk: 'LOW',
    lastTriggerStatus: 'FIRED',
    permissions: { liveBuyAllowed: true, shadowAllowed: true, counterfactualAllowed: true, executionImpact: 'NONE' },
    compactText: 'Gate3 READY',
    marketSignal: false,
  } as const;
  const policy = {
    symbol: '204320',
    sourceSnapshotId: 'scan-eval:guard',
    readiness: 'READY',
    route: 'SHADOW_ENTRY_ALLOWED',
    shadowEntryAllowed: true,
    paperOrderAllowed: true,
    nearEntryTracking: false,
    watchlistUpgrade: false,
    counterfactualAllowed: true,
    diagnosticOnly: false,
    learningLabel: 'GATE3_READY_FIRED',
    liveBuyAllowed: true,
    executionImpact: 'NONE',
    reason: 'test',
    marketSignal: false,
    providerIssue: false,
  } as const;
  const outcome = {
    id: 'outcome-1',
    symbol: '204320',
    sourceSnapshotId: 'scan-eval:guard',
    gate3SnapshotId: 'scan-eval:guard:gate3',
    asOf: '2026-05-24T09:00:00.000Z',
    tradeDate: '2026-05-24',
    readiness: 'READY',
    issue: 'FIRED',
    route: 'SHADOW_ENTRY_ALLOWED',
    entryReferencePrice: 10_000,
    stopLoss: 9_300,
    targetPrice: 11_500,
    rrr: 2.1,
    priceConfirmation: 'BREAKOUT_CONFIRMED',
    volumeConfirmation: 'CONFIRMED',
    falseBreakoutRisk: 'LOW',
    lastTriggerStatus: 'FIRED',
    learningLabel: 'GATE3_READY_FIRED',
    forwardReturns: { d1: null, d3: null, d5: 3, d10: null },
    maxForwardReturnPct: 3,
    minForwardReturnPct: 1,
    hitTarget: false,
    hitStop: false,
    outcomeStatus: 'LABELED',
    outcomeLabel: 'GATE3_READY_FOLLOW_THROUGH',
    executionImpact: 'NONE',
    marketSignal: false,
    providerIssue: false,
  } as const;
  return {
    samples: 1,
    timingReadiness: { READY: 1 },
    lastTriggerStatus: { FIRED: 1 },
    priceFreshness: { VERIFIED: 1 },
    executionImpact: { NONE: 1 },
    priceConfirmationStatus: { BREAKOUT_CONFIRMED: 1 },
    volumeConfirmationStatus: { CONFIRMED: 1 },
    rrrPassCount: 1,
    rrrWatchCount: 0,
    rrrFailCount: 0,
    rrrMissingCount: 0,
    entryPriceStaleCount: 0,
    candidateDetails: [detail as never],
    shadowPolicies: [policy as never],
    shadowRouting: {
      samples: 1,
      routeCounts: { SHADOW_ENTRY_ALLOWED: 1, NEAR_ENTRY_TRACKING: 0, COUNTERFACTUAL_ONLY: 0, DIAGNOSTIC_ONLY: 0 },
      learningLabels: {} as never,
      shadowEntryAllowedCount: 1,
      nearEntryTrackingCount: 0,
      counterfactualOnlyCount: 0,
      diagnosticOnlyCount: 0,
      watchlistUpgradeCount: 0,
      paperOrderAllowedCount: 1,
      livePolicyBlockedCount: 0,
      counterfactualAllowedCount: 1,
    },
    outcomeSeeds: [outcome as never],
    outcomeTracking: {
      seedCreatedToday: 1,
      pending: 0,
      partial: 0,
      labeled: 1,
      expired: 0,
      dataInsufficient: 0,
      duplicateSuppressed: 0,
      byReadiness: {
        READY: { pending: 0, labeled: 1 },
        WAIT: { pending: 0, labeled: 0 },
        BLOCKED: { pending: 0, labeled: 0 },
        DATA_INCOMPLETE: { pending: 0, labeled: 0 },
      },
      recentLabels: {},
      marketSignal: false,
      providerIssue: false,
      executionImpact: 'NONE',
    },
    thresholdEvidence: buildGate3EvidenceScore([outcome as never]),
  };
}

describe('assertGate3CompletionInvariants', () => {
  it('returns a score when count, route, source, and policy invariants pass', () => {
    const score = assertGate3CompletionInvariants(summary(), { sourceSnapshotId: 'scan-eval:guard' });
    expect(score.status).toBe('COMPLETE');
  });

  it('throws on evaluated count mismatch', () => {
    const bad = summary();
    bad.samples = 2;
    expect(() => assertGate3CompletionInvariants(bad, { sourceSnapshotId: 'scan-eval:guard' })).toThrow(Gate3CompletionInvariantError);
  });

  it('throws on source snapshot mismatch', () => {
    const bad = summary();
    bad.candidateDetails[0] = { ...bad.candidateDetails[0], sourceSnapshotId: 'scan-eval:other' };
    expect(() => assertGate3CompletionInvariants(bad, { sourceSnapshotId: 'scan-eval:guard' })).toThrow(/source|candidateSources/i);
  });

  it('throws on shadow route invariant violation', () => {
    const bad = summary();
    bad.shadowPolicies[0] = { ...bad.shadowPolicies[0], route: 'COUNTERFACTUAL_ONLY' };
    expect(() => assertGate3CompletionInvariants(bad, { sourceSnapshotId: 'scan-eval:guard' })).toThrow(Gate3CompletionInvariantError);
  });
});
