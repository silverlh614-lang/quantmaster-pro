import { describe, expect, it } from 'vitest';
import { buildGate3EvidenceScore } from './gate3EvidenceScore.js';
import type { Gate3OutcomeLabel, Gate3OutcomeSeed, Gate3OutcomeStatus } from './gate3OutcomeSeed.js';
import type { Gate3Readiness } from './gate3CandidateDetail.js';

let nextId = 0;

function seed(input: {
  readiness: Gate3Readiness;
  label: Gate3OutcomeLabel | null;
  status?: Gate3OutcomeStatus;
  issue?: string;
  d5?: number | null;
  max?: number | null;
  volumeConfirmation?: string;
}): Gate3OutcomeSeed {
  nextId += 1;
  return {
    id: `seed-${nextId}`,
    symbol: `S${nextId}`,
    sourceSnapshotId: 'scan-eval:evidence',
    gate3SnapshotId: 'scan-eval:evidence:gate3',
    asOf: '2026-05-24T09:00:00.000Z',
    tradeDate: '2026-05-24',
    readiness: input.readiness,
    issue: input.issue ?? 'FIRED',
    route: input.readiness === 'READY'
      ? 'SHADOW_ENTRY_ALLOWED'
      : input.readiness === 'WAIT'
        ? 'NEAR_ENTRY_TRACKING'
        : input.readiness === 'BLOCKED'
          ? 'COUNTERFACTUAL_ONLY'
          : 'DIAGNOSTIC_ONLY',
    entryReferencePrice: 10_000,
    stopLoss: 9_300,
    targetPrice: 11_500,
    rrr: 2.14,
    priceConfirmation: 'BREAKOUT_CONFIRMED',
    volumeConfirmation: input.volumeConfirmation ?? 'CONFIRMED',
    falseBreakoutRisk: 'LOW',
    lastTriggerStatus: input.readiness === 'READY' ? 'FIRED' : 'THRESHOLD_NOT_MET',
    learningLabel: input.readiness === 'READY'
      ? 'GATE3_READY_FIRED'
      : input.readiness === 'WAIT'
        ? 'GATE3_WAIT_NEAR_BREAKOUT'
        : input.readiness === 'BLOCKED'
          ? 'GATE3_BLOCKED_PRICE_NOT_CONFIRMED'
          : 'GATE3_DATA_INCOMPLETE_UNKNOWN',
    forwardReturns: { d1: null, d3: null, d5: input.d5 ?? null, d10: null },
    maxForwardReturnPct: input.max ?? input.d5 ?? null,
    minForwardReturnPct: input.d5 ?? null,
    hitTarget: false,
    hitStop: false,
    outcomeStatus: input.status ?? 'LABELED',
    outcomeLabel: input.label,
    executionImpact: 'DIAGNOSTIC_ONLY',
    marketSignal: false,
    providerIssue: false,
  };
}

describe('buildGate3EvidenceScore', () => {
  it('aggregates READY wins and losses from labeled samples only', () => {
    const score = buildGate3EvidenceScore([
      seed({ readiness: 'READY', label: 'GATE3_READY_WIN', d5: 4 }),
      seed({ readiness: 'READY', label: 'GATE3_READY_FAILED_BREAKOUT', d5: -3 }),
      seed({ readiness: 'READY', label: null, status: 'PENDING', d5: 9 }),
    ]);

    expect(score.sampleSize).toBe(2);
    expect(score.readySampleSize).toBe(2);
    expect(score.readyWinRate).toBe(50);
    expect(score.readyFailureRate).toBe(50);
    expect(score.readyAvgReturn).toBe(0.5);
    expect(score.falsePositiveRate).toBe(50);
  });

  it('aggregates WAIT missed breakout and patience outcomes', () => {
    const score = buildGate3EvidenceScore([
      seed({ readiness: 'WAIT', label: 'GATE3_WAIT_BECAME_READY', d5: 2 }),
      seed({ readiness: 'WAIT', label: 'GATE3_WAIT_MISSED_BREAKOUT', d5: 6 }),
      seed({ readiness: 'WAIT', label: 'GATE3_WAIT_CORRECT_PATIENCE', d5: -1 }),
    ]);

    expect(score.waitSampleSize).toBe(3);
    expect(score.waitBecameReadyRate).toBe(33.3);
    expect(score.waitMissedBreakoutRate).toBe(33.3);
    expect(score.waitCorrectPatienceRate).toBe(33.3);
    expect(score.missedBreakoutRate).toBe(33.3);
  });

  it('aggregates BLOCKED correct blocks and false negatives', () => {
    const score = buildGate3EvidenceScore([
      seed({ readiness: 'BLOCKED', label: 'GATE3_BLOCKED_CORRECT', issue: 'PRICE_NOT_CONFIRMED', d5: -1 }),
      seed({ readiness: 'BLOCKED', label: 'GATE3_BLOCKED_FALSE_NEGATIVE', issue: 'FALSE_BREAKOUT_HIGH', d5: 6 }),
      seed({ readiness: 'BLOCKED', label: 'GATE3_BLOCKED_OVERSTRICT_VOLUME', issue: 'VOLUME_WEAK', d5: 7 }),
    ]);

    expect(score.blockedSampleSize).toBe(3);
    expect(score.blockedCorrectRate).toBe(33.3);
    expect(score.blockedFalseNegativeRate).toBe(66.7);
    expect(score.falseNegativeRate).toBe(66.7);
    expect(score.correctBlockRate).toBe(33.3);
    expect(score.volumeOverstrictScore).toBe(100);
  });

  it('aggregates DATA_INCOMPLETE resolved and missed opportunity labels', () => {
    const score = buildGate3EvidenceScore([
      seed({ readiness: 'DATA_INCOMPLETE', label: 'GATE3_DATA_INCOMPLETE_RESOLVED', issue: 'DATA_UNAVAILABLE', d5: 1 }),
      seed({ readiness: 'DATA_INCOMPLETE', label: 'GATE3_DATA_INCOMPLETE_MISSED_OPPORTUNITY', issue: 'RRR_MISSING', d5: 6 }),
    ]);

    expect(score.dataIncompleteSampleSize).toBe(2);
    expect(score.dataIncompleteResolvedRate).toBe(50);
    expect(score.dataIncompleteMissedOpportunityRate).toBe(50);
  });
});
