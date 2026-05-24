import { describe, expect, it } from 'vitest';
import { applyGate3ForwardReturns, calculateGate3ForwardReturnPct, updatePendingGate3Outcomes } from './gate3ForwardReturn.js';
import type { Gate3OutcomeSeed } from './gate3OutcomeSeed.js';

function seed(overrides: Partial<Gate3OutcomeSeed> = {}): Gate3OutcomeSeed {
  return {
    id: 'seed-1',
    symbol: '204320',
    sourceSnapshotId: 'scan-eval:test',
    gate3SnapshotId: 'scan-eval:test:gate3',
    asOf: '2026-05-24T09:00:00.000Z',
    tradeDate: '2026-05-24',
    readiness: 'WAIT',
    issue: 'NEAR_BREAKOUT_DRY_UP',
    route: 'NEAR_ENTRY_TRACKING',
    entryReferencePrice: 100,
    stopLoss: 93,
    targetPrice: 115,
    rrr: 2.1,
    priceConfirmation: 'NEAR_BREAKOUT',
    volumeConfirmation: 'DRY_UP',
    falseBreakoutRisk: 'LOW',
    lastTriggerStatus: 'WAIT',
    learningLabel: 'GATE3_WAIT_DRY_UP',
    forwardReturns: { d1: null, d3: null, d5: null, d10: null },
    maxForwardReturnPct: null,
    minForwardReturnPct: null,
    hitTarget: null,
    hitStop: null,
    outcomeStatus: 'PENDING',
    outcomeLabel: null,
    executionImpact: 'DIAGNOSTIC_ONLY',
    marketSignal: false,
    providerIssue: false,
    ...overrides,
  };
}

describe('Gate3 forward return', () => {
  it('calculates return percentage', () => {
    expect(calculateGate3ForwardReturnPct(100, 103)).toBe(3);
    expect(calculateGate3ForwardReturnPct(100, 97.5)).toBe(-2.5);
    expect(calculateGate3ForwardReturnPct(null, 103)).toBeNull();
  });

  it('updates d1/d3/d5/d10 and excursions', () => {
    const updated = applyGate3ForwardReturns(seed(), {
      d1: 101,
      d3: 104,
      d5: 106,
      d10: 102,
    });

    expect(updated.forwardReturns).toEqual({ d1: 1, d3: 4, d5: 6, d10: 2 });
    expect(updated.maxForwardReturnPct).toBe(6);
    expect(updated.minForwardReturnPct).toBe(1);
    expect(updated.outcomeStatus).toBe('LABELED');
    expect(updated.outcomeLabel).toBe('GATE3_WAIT_MISSED_BREAKOUT');
    expect(updated.marketSignal).toBe(false);
    expect(updated.providerIssue).toBe(false);
  });

  it('keeps missing quote pending before maturity', () => {
    const [updated] = updatePendingGate3Outcomes([seed()], [], { elapsedTradingDays: 3 });
    expect(updated.outcomeStatus).toBe('PENDING');
    expect(updated.forwardReturns.d5).toBeNull();
  });

  it('marks no-price matured rows data insufficient', () => {
    const [updated] = updatePendingGate3Outcomes([seed()], [], { elapsedTradingDays: 11 });
    expect(updated.outcomeStatus).toBe('DATA_INSUFFICIENT');
    expect(updated.providerIssue).toBe(false);
  });

  it('expires partial rows after ten trading days without d10', () => {
    const partial = seed({ forwardReturns: { d1: 1, d3: null, d5: null, d10: null }, outcomeStatus: 'PARTIAL' });
    const [updated] = updatePendingGate3Outcomes([partial], [], { elapsedTradingDays: 11 });
    expect(updated.outcomeStatus).toBe('EXPIRED');
  });
});
