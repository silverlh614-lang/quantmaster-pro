import { describe, expect, it } from 'vitest';
import { resolveFinalExecutionDecision, type FinalDecisionEngineMode, type FinalDecisionResolverRuntimeInput } from './finalDecisionResolver.js';

function input(engineMode: FinalDecisionEngineMode): FinalDecisionResolverRuntimeInput {
  return {
    sourceSnapshotId: `scan:${engineMode}`,
    symbol: '000003',
    gate1Status: 'PASS',
    gate2Status: 'GATE2_PASS_STRONG',
    gate3Readiness: 'EXECUTION_READY',
    entryTimingSignal: 'ENTRY_READY',
    engineMode,
    marketSession: 'REGULAR',
    effectiveRegime: engineMode === 'SELL_ONLY' ? 'R6_DEFENSE' : 'GREEN',
    providerHealth: { quote: 'VERIFIED', supply: 'VERIFIED', dart: 'VERIFIED', macro: 'VERIFIED' },
    dataConfidenceCeiling: 'HIGH',
    marketSignal: false,
    providerIssue: false,
    shadowMode: engineMode === 'SHADOW_ONLY' ? 'SHADOW_ONLY' : engineMode === 'OBSERVE_ONLY' ? 'OBSERVE_ONLY' : 'NORMAL',
    requestedSide: 'BUY',
    isDiagnosticOnly: false,
  };
}

describe('ADR-0521 shadow learning always-on', () => {
  it.each(['NORMAL', 'SELL_ONLY', 'SHADOW_ONLY', 'OBSERVE_ONLY'] as const)('keeps learning and counterfactual on in %s', (mode) => {
    const decision = resolveFinalExecutionDecision(input(mode));

    expect(decision.learningAllowed).toBe(true);
    expect(decision.shadowLearning).toBe(true);
    expect(decision.counterfactualAllowed).toBe(true);
    expect(decision.counterfactualRecorded).toBe(true);
  });

  it('DATA_INCOMPLETE blocks buy but records learning case', () => {
    const decision = resolveFinalExecutionDecision({
      ...input('NORMAL'),
      gate3Readiness: 'DATA_INCOMPLETE',
      entryTimingSignal: 'DATA_INCOMPLETE',
    });

    expect(decision.finalAction).toBe('BLOCKED');
    expect(decision.liveBuyAllowed).toBe(false);
    expect(decision.blockedLearningCase?.learningTag).toBe('CASE_DATA_INCOMPLETE_BLOCKED');
    expect(decision.executionImpact).toBe('NONE');
  });
});
