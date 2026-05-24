import { describe, expect, it } from 'vitest';
import { resolveFinalExecutionDecision, type FinalDecisionResolverRuntimeInput } from './finalDecisionResolver.js';

const base: FinalDecisionResolverRuntimeInput = {
  sourceSnapshotId: 'scan:adr0521',
  symbol: '204320',
  asOf: '2026-05-24T09:00:00.000Z',
  gate1Status: 'PASS',
  gate2Status: 'GATE2_PASS_STRONG',
  gate3Readiness: 'EXECUTION_READY',
  entryTimingSignal: 'ENTRY_READY',
  engineMode: 'NORMAL',
  marketSession: 'REGULAR',
  effectiveRegime: 'GREEN',
  riskOverride: 'NONE',
  providerHealth: { quote: 'VERIFIED', supply: 'VERIFIED', dart: 'VERIFIED', macro: 'VERIFIED' },
  dataConfidenceCeiling: 'HIGH',
  marketSignal: false,
  providerIssue: false,
  shadowMode: 'NORMAL',
  requestedSide: 'BUY',
  currentPositionState: 'NONE',
  isDiagnosticOnly: false,
};

describe('ADR-0521 FinalDecisionResolver policy matrix', () => {
  it('NORMAL + REGULAR + ENTRY_READY allows live buy through resolver only', () => {
    const decision = resolveFinalExecutionDecision(base);

    expect(decision.finalAction).toBe('LIVE_BUY_ALLOWED');
    expect(decision.liveBuyAllowed).toBe(true);
    expect(decision.shadowBuyAllowed).toBe(true);
    expect(decision.brokerOrderAllowed).toBe(true);
    expect(decision.livePermissionNotEvaluatedInGate3).toBe(true);
  });

  it('SELL_ONLY + ENTRY_READY blocks live buy and preserves shadow buy', () => {
    const decision = resolveFinalExecutionDecision({ ...base, engineMode: 'SELL_ONLY' });

    expect(decision.finalAction).toBe('SHADOW_BUY_ALLOWED');
    expect(decision.liveBuyAllowed).toBe(false);
    expect(decision.liveSellAllowed).toBe(true);
    expect(decision.shadowBuyAllowed).toBe(true);
    expect(decision.executionImpact).toBe('LIVE_BUY_BLOCKED');
    expect(decision.blockReasons).toContain('SELL_ONLY_LIVE_BUY_BLOCKED');
    expect(decision.blockedLearningCase?.learningTag).toBe('CASE_ENTRY_READY_LIVE_BLOCKED_SELL_ONLY');
  });

  it('R6_DEFENSE + ENTRY_READY blocks live buy and preserves shadow buy', () => {
    const decision = resolveFinalExecutionDecision({ ...base, effectiveRegime: 'R6_DEFENSE', riskOverride: 'R6_DEFENSE' });

    expect(decision.finalAction).toBe('SHADOW_BUY_ALLOWED');
    expect(decision.liveBuyAllowed).toBe(false);
    expect(decision.liveSellAllowed).toBe(true);
    expect(decision.shadowBuyAllowed).toBe(true);
    expect(decision.executionImpact).toBe('LIVE_BUY_BLOCKED');
    expect(decision.blockReasons).toContain('R6_DEFENSE_LIVE_BUY_BLOCKED');
    expect(decision.blockedLearningCase?.learningTag).toBe('CASE_ENTRY_READY_LIVE_BLOCKED_R6');
  });

  it('SHADOW_ONLY + ENTRY_READY blocks broker order and allows paper order', () => {
    const decision = resolveFinalExecutionDecision({ ...base, engineMode: 'SHADOW_ONLY', shadowMode: 'SHADOW_ONLY' });

    expect(decision.finalAction).toBe('SHADOW_BUY_ALLOWED');
    expect(decision.liveBuyAllowed).toBe(false);
    expect(decision.shadowBuyAllowed).toBe(true);
    expect(decision.brokerOrderAllowed).toBe(false);
    expect(decision.paperOrderAllowed).toBe(true);
    expect(decision.executionImpact).toBe('LIVE_ALL_BLOCKED');
  });

  it('HOLIDAY + ENTRY_READY blocks orders and keeps counterfactual', () => {
    const decision = resolveFinalExecutionDecision({ ...base, marketSession: 'HOLIDAY' });

    expect(decision.finalAction).toBe('OBSERVE_ONLY');
    expect(decision.brokerOrderAllowed).toBe(false);
    expect(decision.paperOrderAllowed).toBe(false);
    expect(decision.counterfactualAllowed).toBe(true);
    expect(decision.executionImpact).toBe('ORDER_BLOCKED_DIAGNOSTIC_ONLY');
  });
});
