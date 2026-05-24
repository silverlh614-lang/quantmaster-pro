import { describe, expect, it } from 'vitest';
import {
  buildFinalDecisionRuntimeAuditSummary,
  resolveFinalExecutionDecision,
  type FinalDecisionResolverRuntimeInput,
} from './finalDecisionResolver.js';

const input: FinalDecisionResolverRuntimeInput = {
  sourceSnapshotId: 'scan:adr0521',
  symbol: '000001',
  gate1Status: 'PASS',
  gate2Status: 'GATE2_PASS_STRONG',
  gate3Readiness: 'EXECUTION_READY',
  entryTimingSignal: 'ENTRY_READY',
  engineMode: 'SELL_ONLY',
  marketSession: 'REGULAR',
  effectiveRegime: 'GREEN',
  providerHealth: { quote: 'VERIFIED', supply: 'VERIFIED', dart: 'VERIFIED', macro: 'VERIFIED' },
  dataConfidenceCeiling: 'HIGH',
  marketSignal: false,
  providerIssue: false,
  shadowMode: 'NORMAL',
  requestedSide: 'BUY',
  isDiagnosticOnly: false,
};

describe('ADR-0521 Gate3 signal and live permission separation', () => {
  it('does not treat Gate3 ENTRY_READY as live permission', () => {
    const decision = resolveFinalExecutionDecision(input);

    expect(decision.decisionTrace.gateDecision).toBe('ENTRY_READY');
    expect(decision.liveBuyAllowed).toBe(false);
    expect(decision.shadowBuyAllowed).toBe(true);
    expect(decision.livePermissionNotEvaluatedInGate3).toBe(true);
  });

  it('reports live permission leaks from runtime input probes', () => {
    const decision = resolveFinalExecutionDecision(input);
    const summary = buildFinalDecisionRuntimeAuditSummary({
      sourceSnapshotId: input.sourceSnapshotId,
      decisions: [decision],
      inputs: [{ ...input, gate3LiveBuyAllowed: true } as unknown as FinalDecisionResolverRuntimeInput],
    });

    expect(summary.gate3LivePermissionLeakDetected).toBe(1);
    expect(summary.lastTriggerDirectOrderLeakDetected).toBe(0);
  });

  it('WAIT_TRIGGER never creates order permission', () => {
    const decision = resolveFinalExecutionDecision({
      ...input,
      engineMode: 'NORMAL',
      entryTimingSignal: 'WAIT_TRIGGER',
      gate3Readiness: 'TRIGGER_WAIT',
    });

    expect(decision.finalAction).toBe('WAIT');
    expect(decision.liveBuyAllowed).toBe(false);
    expect(decision.shadowBuyAllowed).toBe(false);
    expect(decision.executionImpact).toBe('NONE');
  });
});
