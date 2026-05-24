import { describe, expect, it } from 'vitest';
import { resolveFinalExecutionDecision, type FinalDecisionResolverRuntimeInput } from '../trading/gates/finalDecisionResolver.js';
import { buildOutcomeSeed } from './outcomeClosure.js';

type OutcomeSeedTestOverrides = Omit<Partial<Parameters<typeof buildOutcomeSeed>[0]>, 'runtimeInput'> & {
  runtimeInput?: Partial<FinalDecisionResolverRuntimeInput>;
};

export function runtimeInput(overrides: Partial<FinalDecisionResolverRuntimeInput> = {}): FinalDecisionResolverRuntimeInput {
  return {
    sourceSnapshotId: 'scan:0522',
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
    ...overrides,
  };
}

export function seed(overrides: OutcomeSeedTestOverrides = {}) {
  const { runtimeInput: runtimeOverride, decision: decisionOverride, ...seedOverrides } = overrides;
  const input = runtimeInput(runtimeOverride as Partial<FinalDecisionResolverRuntimeInput> | undefined);
  const decision = decisionOverride ?? resolveFinalExecutionDecision(input);
  return buildOutcomeSeed({
    decision,
    runtimeInput: input,
    entryPrice: 10_000,
    stopLossPrice: 9_300,
    targetPrice: 11_500,
    rrrValue: 2.14,
    gate1Score: 80,
    gate2Score: 82,
    gate3CompletionScore: 91,
    gate2AxisScores: { SUPPLY_CONFLUENCE: 90, TECHNICAL_TREND: 70 },
    gate3ComponentScores: { rrrProfile: 26, lastTrigger: 25, priceConfirmation: 15, volumeConfirmation: 15, falseBreakoutGuard: 10 },
    ...seedOverrides,
  });
}

describe('ADR-0522 outcome seed creation', () => {
  it('creates a seed from Gate and FinalDecision runtime result', () => {
    const created = seed();

    expect(created.sourceSnapshotId).toBe('scan:0522');
    expect(created.decisionType).toBe('LIVE_EXECUTED');
    expect(created.entryTimingSignal).toBe('ENTRY_READY');
    expect(created.outcomeStatus).toBe('PENDING');
    expect(created.marketSignal).toBe(false);
    expect(created.labelDueDates.d10).toBe('2026-06-03');
  });

  it('stores blocked decision learning tags', () => {
    const input = runtimeInput({ engineMode: 'SELL_ONLY' });
    const decision = resolveFinalExecutionDecision(input);
    const created = buildOutcomeSeed({ decision, runtimeInput: input, entryPrice: 10_000 });

    expect(created.decisionType).toBe('LIVE_BLOCKED');
    expect(created.blockReasons).toContain('SELL_ONLY_LIVE_BUY_BLOCKED');
    expect(created.learningTags).toContain('CASE_ENTRY_READY_LIVE_BLOCKED_SELL_ONLY');
  });

  it('marks missing entry reference as data insufficient', () => {
    const created = seed({ entryPrice: null });

    expect(created.outcomeStatus).toBe('DATA_INSUFFICIENT');
    expect(created.quarantineReason).toBe('ENTRY_PRICE_MISSING');
  });
});
