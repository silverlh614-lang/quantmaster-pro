import { describe, expect, it } from 'vitest';
import {
  buildFinalDecisionRuntimeAuditSummary,
  resolveFinalExecutionDecision,
  type FinalDecisionResolverRuntimeInput,
} from './finalDecisionResolver.js';

const diagnostic: FinalDecisionResolverRuntimeInput = {
  sourceSnapshotId: 'scan:diagnostic',
  symbol: '000004',
  gate1Status: 'DATA_INCOMPLETE',
  gate2Status: 'DATA_INCOMPLETE',
  gate3Readiness: 'DATA_INCOMPLETE',
  entryTimingSignal: 'ENTRY_READY',
  engineMode: 'NORMAL',
  marketSession: 'REGULAR',
  effectiveRegime: 'GREEN',
  providerHealth: { quote: 'VERIFIED', supply: 'MISSING', dart: 'MISSING', macro: 'VERIFIED' },
  dataConfidenceCeiling: 'LOW',
  marketSignal: false,
  providerIssue: false,
  shadowMode: 'NORMAL',
  requestedSide: 'BUY',
  isDiagnosticOnly: true,
};

describe('ADR-0521 diagnostic-only order block', () => {
  it('blocks broker and paper orders while retaining learning', () => {
    const decision = resolveFinalExecutionDecision(diagnostic);

    expect(decision.finalAction).toBe('OBSERVE_ONLY');
    expect(decision.brokerOrderAllowed).toBe(false);
    expect(decision.paperOrderAllowed).toBe(false);
    expect(decision.executionImpact).toBe('ORDER_BLOCKED_DIAGNOSTIC_ONLY');
    expect(decision.blockReasons).toContain('DIAGNOSTIC_ONLY_ORDER_BLOCKED');
    expect(decision.learningAllowed).toBe(true);
    expect(decision.counterfactualAllowed).toBe(true);
  });

  it('summarizes diagnostic-only broker leaks as zero', () => {
    const decision = resolveFinalExecutionDecision(diagnostic);
    const summary = buildFinalDecisionRuntimeAuditSummary({
      sourceSnapshotId: diagnostic.sourceSnapshotId,
      decisions: [decision],
      inputs: [diagnostic],
    });

    expect(summary.diagnosticOnlyBlocked).toBe(1);
    expect(summary.diagnosticOnlyBrokerOrderLeakDetected).toBe(0);
    expect(summary.shadowLearningSuppressedCount).toBe(0);
  });
});
