import { describe, expect, it } from 'vitest';
import { applyGate3OutcomeLabel, labelGate3Outcome } from './gate3OutcomeLabeler.js';
import type { Gate3OutcomeSeed } from './gate3OutcomeSeed.js';

function seed(overrides: Partial<Gate3OutcomeSeed> = {}): Gate3OutcomeSeed {
  return {
    id: 'seed-1',
    symbol: '204320',
    sourceSnapshotId: 'scan-eval:test',
    gate3SnapshotId: 'scan-eval:test:gate3',
    asOf: '2026-05-24T09:00:00.000Z',
    tradeDate: '2026-05-24',
    readiness: 'READY',
    issue: 'FIRED',
    route: 'SHADOW_ENTRY_ALLOWED',
    entryReferencePrice: 100,
    stopLoss: 93,
    targetPrice: 115,
    rrr: 2.1,
    priceConfirmation: 'BREAKOUT_CONFIRMED',
    volumeConfirmation: 'CONFIRMED',
    falseBreakoutRisk: 'LOW',
    lastTriggerStatus: 'FIRED',
    learningLabel: 'GATE3_READY_FIRED',
    forwardReturns: { d1: null, d3: null, d5: null, d10: null },
    maxForwardReturnPct: null,
    minForwardReturnPct: null,
    hitTarget: null,
    hitStop: null,
    outcomeStatus: 'PENDING',
    outcomeLabel: null,
    executionImpact: 'NONE',
    marketSignal: false,
    providerIssue: false,
    ...overrides,
  };
}

describe('Gate3 outcome labeler', () => {
  it('labels READY win/loss/follow-through/breakeven/failed breakout', () => {
    expect(labelGate3Outcome(seed({ hitTarget: true }))).toBe('GATE3_READY_WIN');
    expect(labelGate3Outcome(seed({ hitStop: true }))).toBe('GATE3_READY_LOSS');
    expect(labelGate3Outcome(seed({ forwardReturns: { d1: 1, d3: 2, d5: 3.2, d10: null }, maxForwardReturnPct: 4 }))).toBe('GATE3_READY_FOLLOW_THROUGH');
    expect(labelGate3Outcome(seed({ forwardReturns: { d1: -1, d3: -1.5, d5: -2.1, d10: null }, maxForwardReturnPct: 0 }))).toBe('GATE3_READY_FAILED_BREAKOUT');
    expect(labelGate3Outcome(seed({ forwardReturns: { d1: 0.3, d3: 0.4, d5: 0.2, d10: null }, maxForwardReturnPct: 0.6 }))).toBe('GATE3_READY_BREAKEVEN');
  });

  it('labels WAIT became-ready/missed-breakout/correct-patience/failed-setup', () => {
    const wait = seed({ readiness: 'WAIT', route: 'NEAR_ENTRY_TRACKING', issue: 'NEAR_BREAKOUT_DRY_UP', learningLabel: 'GATE3_WAIT_DRY_UP' });
    expect(labelGate3Outcome(wait, { becameReadyWithin3d: true })).toBe('GATE3_WAIT_BECAME_READY');
    expect(labelGate3Outcome({ ...wait, forwardReturns: { d1: 1, d3: 3, d5: 5.2, d10: null }, maxForwardReturnPct: 6 })).toBe('GATE3_WAIT_MISSED_BREAKOUT');
    expect(labelGate3Outcome({ ...wait, forwardReturns: { d1: -0.5, d3: 0, d5: -0.1, d10: null }, maxForwardReturnPct: 1 })).toBe('GATE3_WAIT_CORRECT_PATIENCE');
    expect(labelGate3Outcome({ ...wait, forwardReturns: { d1: 1, d3: 2, d5: 2.5, d10: null }, maxForwardReturnPct: 4 })).toBe('GATE3_WAIT_FAILED_SETUP');
  });

  it('labels BLOCKED correct/false-negative/overstrict variants', () => {
    const blocked = seed({ readiness: 'BLOCKED', route: 'COUNTERFACTUAL_ONLY', issue: 'PRICE_NOT_CONFIRMED', learningLabel: 'GATE3_BLOCKED_PRICE_NOT_CONFIRMED' });
    expect(labelGate3Outcome({ ...blocked, forwardReturns: { d1: -1, d3: -2, d5: -0.1, d10: null }, maxForwardReturnPct: 0 })).toBe('GATE3_BLOCKED_CORRECT');
    expect(labelGate3Outcome({ ...blocked, forwardReturns: { d1: 2, d3: 4, d5: 5.1, d10: null }, maxForwardReturnPct: 6 })).toBe('GATE3_BLOCKED_OVERSTRICT_PRICE');
    expect(labelGate3Outcome({ ...blocked, issue: 'VOLUME_WEAK', forwardReturns: { d1: 2, d3: 4, d5: 5.1, d10: null }, maxForwardReturnPct: 6 })).toBe('GATE3_BLOCKED_OVERSTRICT_VOLUME');
    expect(labelGate3Outcome({ ...blocked, issue: 'RRR_FAIL', forwardReturns: { d1: 2, d3: 4, d5: 5.1, d10: null }, maxForwardReturnPct: 6 })).toBe('GATE3_BLOCKED_OVERSTRICT_RRR');
    expect(labelGate3Outcome({ ...blocked, issue: 'FALSE_BREAKOUT_HIGH', forwardReturns: { d1: 2, d3: 4, d5: 5.1, d10: null }, maxForwardReturnPct: 6 })).toBe('GATE3_BLOCKED_FALSE_NEGATIVE');
  });

  it('labels DATA_INCOMPLETE resolved/missed-opportunity/provider-gap/no-signal', () => {
    const incomplete = seed({ readiness: 'DATA_INCOMPLETE', route: 'DIAGNOSTIC_ONLY', issue: 'RRR_MISSING', learningLabel: 'GATE3_DATA_INCOMPLETE_RRR_MISSING' });
    expect(labelGate3Outcome(incomplete, { dataResolvedWithin3d: true })).toBe('GATE3_DATA_INCOMPLETE_RESOLVED');
    expect(labelGate3Outcome({ ...incomplete, forwardReturns: { d1: 1, d3: 3, d5: 5.2, d10: null }, maxForwardReturnPct: 6 })).toBe('GATE3_DATA_INCOMPLETE_MISSED_OPPORTUNITY');
    expect(labelGate3Outcome(incomplete, { dataStillMissing: true })).toBe('GATE3_DATA_INCOMPLETE_PROVIDER_GAP');
    expect(labelGate3Outcome({ ...incomplete, forwardReturns: { d1: 0, d3: 0.3, d5: 0.5, d10: null }, maxForwardReturnPct: 1 })).toBe('GATE3_DATA_INCOMPLETE_NO_SIGNAL');
  });

  it('applies labels without making providerIssue or marketSignal true', () => {
    const labeled = applyGate3OutcomeLabel(seed({ hitTarget: true }));
    expect(labeled.outcomeStatus).toBe('LABELED');
    expect(labeled.outcomeLabel).toBe('GATE3_READY_WIN');
    expect(labeled.marketSignal).toBe(false);
    expect(labeled.providerIssue).toBe(false);
  });
});
