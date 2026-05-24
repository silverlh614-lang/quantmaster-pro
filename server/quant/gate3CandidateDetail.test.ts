import { describe, expect, it } from 'vitest';
import {
  buildGate3CandidateDetail,
  formatGate3CandidateDetailTable,
  groupGate3CandidateDetails,
} from './gate3CandidateDetail.js';

function diagnostic(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    timingReadiness: 'READY',
    falseBreakoutRisk: 'LOW',
    executionImpact: 'NONE',
    entryPriceGuard: { priceFreshness: 'VERIFIED' },
    rrrCheck: {
      rrr: 2.4,
      status: 'PASS',
      source: 'FALLBACK_PERCENT',
      entryPrice: 10_000,
      stopLoss: 9_300,
      targetPrice: 11_500,
    },
    lastTrigger: {
      status: 'FIRED',
      fired: true,
      reason: 'FIRED',
      liveBuyAllowed: true,
      shadowObservableAllowed: true,
      counterfactualAllowed: true,
      executionImpact: 'NONE',
      priceConfirmation: {
        status: 'BREAKOUT_CONFIRMED',
        distanceToHigh20dPct: 0.4,
        extensionFromMa20Pct: 5,
      },
      volumeConfirmationDetail: {
        status: 'CONFIRMED',
        volumeRatio20d: 1.8,
      },
    },
    ...overrides,
  };
}

function detail(overrides: Record<string, unknown> = {}) {
  return buildGate3CandidateDetail({
    symbol: '204320',
    name: 'HL만도',
    sourceSnapshotId: 'scan-eval:test',
    asOf: '2026-05-24T09:00:00.000Z',
    consolidatedDiagnostic: diagnostic(overrides),
  });
}

describe('Gate3 candidate detail', () => {
  it('builds READY detail', () => {
    const built = detail();

    expect(built.readiness).toBe('READY');
    expect(built.issue).toBe('FIRED');
    expect(built.lastTriggerStatus).toBe('FIRED');
    expect(built.rrr.status).toBe('PASS');
    expect(built.priceConfirmation.status).toBe('BREAKOUT_CONFIRMED');
    expect(built.volumeConfirmation.volumeRatio20d).toBe(1.8);
    expect(built.compactText).toContain('HL만도(204320) READY');
    expect(built.compactText).toContain('marketSignal=false');
  });

  it('builds WAIT detail for near breakout dry-up', () => {
    const built = detail({
      timingReadiness: 'WAIT',
      lastTrigger: {
        status: 'THRESHOLD_NOT_MET',
        fired: false,
        reason: 'NEAR_BREAKOUT_DRY_UP',
        liveBuyAllowed: false,
        shadowObservableAllowed: true,
        counterfactualAllowed: true,
        executionImpact: 'DIAGNOSTIC_ONLY',
        priceConfirmation: { status: 'NEAR_BREAKOUT', distanceToHigh20dPct: -0.8 },
        volumeConfirmationDetail: { status: 'DRY_UP', volumeRatio20d: 0.43 },
      },
    });

    expect(built.readiness).toBe('WAIT');
    expect(built.issue).toBe('NEAR_BREAKOUT_DRY_UP');
    expect(built.lastTriggerStatus).toBe('WAIT');
    expect(built.permissions.shadowAllowed).toBe(true);
    expect(built.compactText).toContain('Vol DRY_UP 0.43x');
  });

  it('builds BLOCKED detail and prioritizes false breakout risk', () => {
    const built = detail({
      timingReadiness: 'BLOCKED',
      falseBreakoutRisk: 'HIGH',
      rrrCheck: { rrr: 1.2, status: 'FAIL', source: 'EXPLICIT' },
      lastTrigger: {
        status: 'THRESHOLD_NOT_MET',
        fired: false,
        liveBuyAllowed: false,
        shadowObservableAllowed: true,
        counterfactualAllowed: true,
        executionImpact: 'LIVE_BUY_BLOCKED_ONLY',
        priceConfirmation: { status: 'OVEREXTENDED' },
        volumeConfirmationDetail: { status: 'WEAK', volumeRatio20d: 0.82 },
      },
    });

    expect(built.readiness).toBe('BLOCKED');
    expect(built.issue).toBe('FALSE_BREAKOUT_HIGH');
    expect(built.permissions.executionImpact).toBe('LIVE_BUY_BLOCKED_ONLY');
    expect(built.compactText).toContain('marketSignal=false');
  });

  it('builds DATA_INCOMPLETE detail for missing RRR', () => {
    const built = detail({
      timingReadiness: 'DATA_INCOMPLETE',
      rrrCheck: { rrr: null, status: 'MISSING', source: 'MISSING' },
      lastTrigger: {
        status: 'DATA_UNAVAILABLE',
        fired: false,
        liveBuyAllowed: false,
        shadowObservableAllowed: true,
        counterfactualAllowed: true,
        executionImpact: 'DIAGNOSTIC_ONLY',
        priceConfirmation: { status: 'NEAR_BREAKOUT' },
        volumeConfirmationDetail: { status: 'DRY_UP', volumeRatio20d: 0.42 },
      },
    });

    expect(built.readiness).toBe('DATA_INCOMPLETE');
    expect(built.issue).toBe('RRR_MISSING');
    expect(built.lastTriggerStatus).toBe('DATA_UNAVAILABLE');
    expect(built.compactText).toContain('RRR MISSING');
  });

  it('groups and truncates top N detail table', () => {
    const details = [
      detail({ lastTrigger: { status: 'FIRED', fired: true, priceConfirmation: { status: 'BREAKOUT_CONFIRMED' }, volumeConfirmationDetail: { status: 'CONFIRMED', volumeRatio20d: 2.2 } } }),
      detail({ timingReadiness: 'WAIT', lastTrigger: { status: 'THRESHOLD_NOT_MET', fired: false, priceConfirmation: { status: 'NEAR_BREAKOUT' }, volumeConfirmationDetail: { status: 'DRY_UP', volumeRatio20d: 0.4 } } }),
      detail({ timingReadiness: 'WAIT', lastTrigger: { status: 'THRESHOLD_NOT_MET', fired: false, priceConfirmation: { status: 'PULLBACK_ENTRY' }, volumeConfirmationDetail: { status: 'PARTIAL', volumeRatio20d: 1.2 } } }),
    ];
    const groups = groupGate3CandidateDetails(details, { ready: 5, wait: 1 });
    const table = formatGate3CandidateDetailTable({ detailsByReadiness: groups });

    expect(groups.wait).toHaveLength(1);
    expect(groups.hiddenWaitCount).toBe(1);
    expect(groups.detailTruncated).toBe(true);
    expect(table).toContain('Gate3 Candidate Detail');
    expect(table).toContain('detailTruncated=true');
  });
});
