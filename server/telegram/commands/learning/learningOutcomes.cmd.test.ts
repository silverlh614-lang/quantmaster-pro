import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandContext } from '../_types.js';
import type { FinalDecisionResolverRuntimeInput } from '../../../trading/gates/finalDecisionResolver.js';

const runtimeInput: FinalDecisionResolverRuntimeInput = {
  sourceSnapshotId: 'scan:0522:cmd',
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

describe('/learning_outcomes ADR-0522 command', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('registers compact outcome closure summary aliases and replies read-only diagnostics', async () => {
    const registry = await import('../../commandRegistry.js');
    registry.commandRegistry.__resetForTests();
    const finalDecision = await import('../../../trading/gates/finalDecisionResolver.js');
    const outcome = await import('../../../learning/outcomeClosure.js');
    outcome.outcomeClosureRepo.reset();

    const decision = finalDecision.resolveFinalExecutionDecision(runtimeInput);
    const seed = outcome.buildOutcomeSeed({
      decision,
      runtimeInput,
      entryPrice: 10_000,
      stopLossPrice: 9_300,
      targetPrice: 11_500,
      rrrValue: 2.14,
      gate2AxisScores: { SUPPLY_CONFLUENCE: 90 },
      gate3ComponentScores: { lastTrigger: 100, priceConfirmation: 90 },
    });
    outcome.outcomeClosureRepo.createSeedIfNotExists(seed);
    outcome.outcomeClosureRepo.attachForwardReturn(seed.seedId, outcome.buildForwardReturnSnapshot({
      seed,
      horizon: '10D',
      asOf: '2026-06-03',
      closePrice: 10_700,
      highPrice: 11_600,
      lowPrice: 9_900,
      targetHitAt: '2026-05-27T06:00:00.000Z',
    }));
    outcome.outcomeClosureRepo.closeLabelIfReady(seed.seedId);

    await import('./learningOutcomes.cmd.js');
    const command = registry.commandRegistry.resolve('/learning_outcomes');
    expect(command).toBeDefined();
    expect(registry.commandRegistry.resolve('/outcome_labels')).toBe(command);
    expect(registry.commandRegistry.resolve('/outcome_attribution')).toBe(command);

    let replied = '';
    const reply: CommandContext['reply'] = async (message) => {
      replied = message;
    };
    await command!.execute({ args: [], reply });

    expect(replied).toContain('[Learning Outcomes]');
    expect(replied).toContain('Seeds: created 1 / pending 0 / labeled 1');
    expect(replied).toContain('ExecutionImpact: NONE for learning');
    expect(replied).toContain('ShadowLearning: true');
    expect(replied).toContain('no provider fetch, no broker order, no live promotion');
  });
});
