// @responsibility ADR-0520 Gate3 runtime regression and LastTrigger closure tests.
import { describe, expect, it } from 'vitest';
import {
  buildGate3RuntimeClosureSummary,
  buildGate3RuntimeEvaluation,
} from './gate3RuntimeClosure.js';

const base = {
  symbol: '204320',
  gate1Passed: true,
  gate2Status: 'GATE2_PASS_STRONG',
  currentPrice: 10_000,
  high20d: 9_900,
  volume: 2_000_000,
  avgVolume20d: 1_000_000,
  rsi14: 58,
  macdHistogram: 0.2,
  priceFreshness: 'VERIFIED',
  entryPriceAgeSec: 20,
  falseBreakoutRisk: 'LOW',
};

describe('ADR-0520 Gate3 runtime closure', () => {
  it('computes RRR when entry, stop and target are present', () => {
    const result = buildGate3RuntimeEvaluation({
      trace: { ...base, stopLoss: 9_300, targetPrice: 11_500 },
      sourceSnapshotId: 'scan:gate3',
    });

    expect(result.rrrValue).toBeCloseTo(1500 / 700, 5);
    expect(result.rrrStatus).toBe('RRR_ACCEPTABLE');
    expect(result.gate3Readiness).toBe('EXECUTION_READY');
    expect(result.entryTimingSignal).toBe('ENTRY_READY');
    expect(result.livePermissionNotEvaluatedHere).toBe(true);
  });

  it('uses fallback stop and keeps weak RRR as trigger wait/timing not live permission', () => {
    const result = buildGate3RuntimeEvaluation({
      trace: { ...base, targetPrice: 11_500 },
      sourceSnapshotId: 'scan:gate3',
    });

    expect(result.stopLossPrice).toBe(9_200);
    expect(result.rrrStopFallbackUsed).toBe(true);
    expect(result.rrrStatus).toBe('RRR_WEAK');
    expect(['TIMING_FAIL', 'TRIGGER_WAIT', 'SETUP_READY']).toContain(result.gate3Readiness);
    expect(result.executionImpact).toBe('NONE');
  });

  it('uses fallback target from 2.5R when target is missing', () => {
    const result = buildGate3RuntimeEvaluation({
      trace: { ...base, stopLoss: 9_300 },
      sourceSnapshotId: 'scan:gate3',
    });

    expect(result.targetPrice).toBe(11_750);
    expect(result.rrrTargetFallbackUsed).toBe(true);
    expect(result.rrrStatus).toBe('RRR_ACCEPTABLE');
  });

  it('separates priceFresh VERIFIED but invalid target as RRR_INVALID_REWARD', () => {
    const result = buildGate3RuntimeEvaluation({
      trace: { ...base, stopLoss: 9_300, targetPrice: 9_900, priceFreshness: 'VERIFIED' },
      sourceSnapshotId: 'scan:gate3',
    });

    expect(result.priceFreshness).toBe('VERIFIED');
    expect(result.rrrStatus).toBe('RRR_INVALID');
    expect(result.rrrMissingReason).toBe('RRR_INVALID_REWARD');
    expect(result.gate3Readiness).toBe('DATA_INCOMPLETE');
  });

  it('classifies acceptable RRR without breakout as TRIGGER_WAIT', () => {
    const result = buildGate3RuntimeEvaluation({
      trace: {
        ...base,
        currentPrice: 9_900,
        high20d: 10_000,
        volume: 420_000,
        avgVolume20d: 1_000_000,
        stopLoss: 9_300,
        targetPrice: 11_500,
      },
      sourceSnapshotId: 'scan:gate3',
    });

    expect(result.lastTriggerState).toBe('TRIGGER_WAIT');
    expect(result.gate3Readiness).toBe('TRIGGER_WAIT');
    expect(result.entryTimingSignal).toBe('WAIT_TRIGGER');
  });

  it('skips Gate3 on Gate2 fail and preserves shadow learning flags', () => {
    const result = buildGate3RuntimeEvaluation({
      trace: { ...base, gate2Status: 'GATE2_FAIL' },
      sourceSnapshotId: 'scan:gate3',
    });

    expect(result.gate3Readiness).toBe('SKIPPED');
    expect(result.lastTriggerState).toBe('NOT_EVALUATED');
    expect(result.executionImpact).toBe('NONE');
    expect(result.shadowLearning).toBe(true);
    expect(result.counterfactualRecorded).toBe(true);
  });

  it('aggregates transition, RRR, LastTrigger and completion diagnostics', () => {
    const summary = buildGate3RuntimeClosureSummary({
      sourceSnapshotId: 'scan:gate3',
      traces: [
        { ...base, symbol: 'A', stopLoss: 9_300, targetPrice: 11_500 },
        { ...base, symbol: 'B', targetPrice: 9_900, stopLoss: 9_300 },
        { ...base, symbol: 'C', gate2Status: 'GATE2_FAIL' },
      ],
    });

    expect(summary.totalCandidates).toBe(3);
    expect(summary.evaluated).toBe(2);
    expect(summary.rrrComputed).toBe(1);
    expect(summary.rrrMissingReasonDistribution.RRR_INVALID_REWARD).toBe(1);
    expect(summary.lastTriggerTriggeredCount).toBe(1);
    expect(summary.gate3SkippedByGate2Fail).toBe(1);
    expect(summary.executionImpact).toBe('NONE');
    expect(summary.marketSignal).toBe(false);
  });
});
