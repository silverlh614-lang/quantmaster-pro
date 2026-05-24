import { describe, expect, it } from 'vitest';
import { buildGate3EvidenceScore } from './gate3EvidenceScore.js';
import type { Gate3OutcomeLabel, Gate3OutcomeSeed } from './gate3OutcomeSeed.js';
import type { Gate3Readiness } from './gate3CandidateDetail.js';

let nextId = 0;

function seed(input: {
  readiness: Gate3Readiness;
  issue: string;
  label: Gate3OutcomeLabel;
  d5: number;
  volumeConfirmation?: string;
}): Gate3OutcomeSeed {
  nextId += 1;
  return {
    id: `suggestion-seed-${nextId}`,
    symbol: `S${nextId}`,
    sourceSnapshotId: 'scan-eval:threshold',
    gate3SnapshotId: 'scan-eval:threshold:gate3',
    asOf: '2026-05-24T09:00:00.000Z',
    tradeDate: '2026-05-24',
    readiness: input.readiness,
    issue: input.issue,
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
    priceConfirmation: input.issue === 'PRICE_NOT_CONFIRMED' ? 'NOT_CONFIRMED' : 'BREAKOUT_CONFIRMED',
    volumeConfirmation: input.volumeConfirmation ?? (input.issue === 'VOLUME_WEAK' ? 'WEAK' : 'CONFIRMED'),
    falseBreakoutRisk: 'LOW',
    lastTriggerStatus: input.readiness === 'READY' ? 'FIRED' : 'THRESHOLD_NOT_MET',
    learningLabel: input.readiness === 'READY'
      ? 'GATE3_READY_FIRED'
      : input.readiness === 'WAIT'
        ? 'GATE3_WAIT_NEAR_BREAKOUT'
        : input.readiness === 'BLOCKED'
          ? 'GATE3_BLOCKED_PRICE_NOT_CONFIRMED'
          : 'GATE3_DATA_INCOMPLETE_UNKNOWN',
    forwardReturns: { d1: null, d3: null, d5: input.d5, d10: null },
    maxForwardReturnPct: input.d5,
    minForwardReturnPct: input.d5,
    hitTarget: false,
    hitStop: false,
    outcomeStatus: 'LABELED',
    outcomeLabel: input.label,
    executionImpact: 'DIAGNOSTIC_ONLY',
    marketSignal: false,
    providerIssue: false,
  };
}

function many(count: number, builder: (index: number) => Gate3OutcomeSeed): Gate3OutcomeSeed[] {
  return Array.from({ length: count }, (_, index) => builder(index));
}

describe('Gate3 threshold suggestions', () => {
  it('suggests RRR relaxation when RRR-blocked false negatives are high', () => {
    const score = buildGate3EvidenceScore(many(20, () =>
      seed({ readiness: 'BLOCKED', issue: 'RRR_FAIL', label: 'GATE3_BLOCKED_OVERSTRICT_RRR', d5: 6 }),
    ));

    const rrr = score.suggestions.find(item => item.key === 'RRR_PASS_MIN');
    expect(score.rrrOverstrictScore).toBe(100);
    expect(rrr).toMatchObject({
      currentValue: 2,
      suggestedValue: 1.8,
      confidence: 'MEDIUM',
      sampleSize: 20,
      applyMode: 'SUGGEST_ONLY',
    });
  });

  it('suggests volume relaxation when weak-volume blocks later win', () => {
    const score = buildGate3EvidenceScore(many(20, () =>
      seed({ readiness: 'BLOCKED', issue: 'VOLUME_WEAK', label: 'GATE3_BLOCKED_OVERSTRICT_VOLUME', d5: 7 }),
    ));

    const volume = score.suggestions.find(item =>
      item.key === 'VOLUME_CONFIRMED_RATIO' && item.suggestedValue === 1.3,
    );
    expect(score.volumeOverstrictScore).toBe(100);
    expect(volume).toMatchObject({
      currentValue: 1.5,
      confidence: 'MEDIUM',
      applyMode: 'SUGGEST_ONLY',
    });
  });

  it('suggests volume strengthening when READY confirmed-volume failures are high', () => {
    const score = buildGate3EvidenceScore(many(20, () =>
      seed({
        readiness: 'READY',
        issue: 'FIRED',
        label: 'GATE3_READY_FAILED_BREAKOUT',
        d5: -3,
        volumeConfirmation: 'CONFIRMED',
      }),
    ));

    const strengthen = score.suggestions.find(item =>
      item.key === 'VOLUME_CONFIRMED_RATIO' && item.suggestedValue === 1.7,
    );
    expect(score.readyFailureRate).toBe(100);
    expect(strengthen).toMatchObject({
      confidence: 'MEDIUM',
      applyMode: 'SUGGEST_ONLY',
    });
  });

  it('keeps low confidence on small samples', () => {
    const score = buildGate3EvidenceScore(many(3, () =>
      seed({ readiness: 'BLOCKED', issue: 'RRR_FAIL', label: 'GATE3_BLOCKED_OVERSTRICT_RRR', d5: 8 }),
    ));

    expect(score.suggestions[0]).toMatchObject({
      key: 'RRR_PASS_MIN',
      confidence: 'LOW',
      applyMode: 'SUGGEST_ONLY',
    });
  });

  it('never mutates the current threshold config and keeps suggestions suggest-only', () => {
    const thresholds = {
      rrrPassMin: 2,
      volumeConfirmedRatio: 1.5,
    };
    const before = JSON.stringify(thresholds);
    const score = buildGate3EvidenceScore(many(20, () =>
      seed({ readiness: 'WAIT', issue: 'NEAR_BREAKOUT_DRY_UP', label: 'GATE3_WAIT_MISSED_BREAKOUT', d5: 6 }),
    ), { thresholds });

    expect(JSON.stringify(thresholds)).toBe(before);
    expect(score.suggestions).toContainEqual(expect.objectContaining({
      key: 'NEAR_BREAKOUT_DISTANCE',
      applyMode: 'SUGGEST_ONLY',
    }));
    expect(score.suggestions.every(item => item.applyMode === 'SUGGEST_ONLY')).toBe(true);
  });
});
