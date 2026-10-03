// @responsibility Verify exploratory Shadow lifecycle integrity.
import { describe, expect, it } from 'vitest';
import type { PaperAdaptiveCandidate, PaperAdaptiveState } from '../../../src/types/paperAdaptive.js';
import { createPaperIndicatorFormula, paperIndicatorFormulaId, paperIndicatorFormulaValue, PAPER_INVENTED_FEATURE_CUTS } from '../../../src/types/paperIndicatorFormula.js';
import { adaptiveTestSnapshot, matureAdaptiveSamples } from './paperAdaptiveFixtures.js';
import { selectPaperAdaptiveState } from './paperAdaptiveSelection.js';
import { evaluatePaperStrategyScan } from './paperStrategyPolicy.js';
import { emptyStrategyLedger, strategyTestCost } from './paperStrategyFixtures.js';
import { assertPaperStrategyLedger } from './paperStrategyValidation.js';

const registeredAt = '2026-09-18T00:59:00Z';
const trialId = 'shadow-exploration-v1:2026-09-18:1:rsi14:0:D1';
function exploringState(): PaperAdaptiveState {
  const state = selectPaperAdaptiveState(undefined, [], adaptiveTestSnapshot().asOf);
  state.evaluatedAt = '2026-09-18T00:30:00Z';
  if (state.discovery) state.discovery.roundStartedAt = state.evaluatedAt;
  const candidate = structuredClone(state.candidates.find(item => item.rule.feature === 'rsi14')!);
  candidate.rule = { feature: 'rsi14', bucket: 0, horizon: 1 };
  state.exploration = { version: 'shadow-exploration-v1', sequence: 1,
    rules: [{ id: trialId, registeredAt, candidate }] };
  return state;
}
const enter = (state = exploringState(), snapshot = adaptiveTestSnapshot()) =>
  evaluatePaperStrategyScan(emptyStrategyLedger(), snapshot, strategyTestCost, state);

describe('exploratory Shadow entry execution', () => {
  it('opens one share before performance validation and preserves the original assessment and registration times', () => {
    const state = exploringState(), result = enter(state), trade = result.trades[0];
    expect(trade).toMatchObject({ quantity: 1, horizon: 1, scheduledExitDate: '2026-09-21',
      entryDecision: { action: 'BUY', reasonCode: 'ADAPTIVE_EXPLORATION_SELECTED',
        explorationEvidence: { trialId, registeredAt, evaluatedAt: state.evaluatedAt,
          validationStartDate: null, candidate: { active: false, reason: state.exploration!.rules[0].candidate.reason, training: { sampleCount: 0 } } } } });
    expect(trade.entryDecision.reason).toContain('성과 검증 전');
    expect(trade.entryDecision.adaptiveEvidence).toBeUndefined();
    expect(() => assertPaperStrategyLedger(JSON.parse(JSON.stringify(result)))).not.toThrow();
  });

  it.each(['equal-quote', 'prior-quote', 'equal-features', 'prior-features', 'future-features', 'missing-feature', 'future-registration', 'bad-price', 'provider-issue', 'market-closed'] as const)(
    'waits for valid fresh observations when faced with %s', problem => {
      const state = exploringState(), snapshot = adaptiveTestSnapshot(), observation = snapshot.observations[0];
      if (problem === 'equal-quote') observation.observedAt = registeredAt;
      if (problem === 'prior-quote') observation.observedAt = '2026-09-18T00:58:00Z';
      if (problem === 'equal-features') observation.features!.asOf = registeredAt;
      if (problem === 'prior-features') observation.features!.asOf = '2026-09-18T00:58:00Z';
      if (problem === 'future-features') observation.features!.asOf = '2026-09-18T01:01:00Z';
      if (problem === 'missing-feature') observation.features!.values.rsi14 = null;
      if (problem === 'future-registration') state.exploration!.rules[0].registeredAt = '2026-09-18T01:01:00Z';
      if (problem === 'bad-price') observation.price = null;
      if (problem === 'provider-issue') observation.issue = 'CURRENT_QUOTE_UNAVAILABLE';
      if (problem === 'market-closed') snapshot.marketOpen = false;
      const result = enter(state, snapshot);
      expect(result.trades).toHaveLength(0);
      expect(result.latestDecisions[0].action).toBe('WAIT');
    });

  it.each(['NO_TRAINING_EDGE', 'NO_VALIDATION_EDGE', 'RANKED_OUT'] as const)('does not reinterpret %s as an untested hypothesis', reason => {
    const state = exploringState(); state.exploration!.rules[0].candidate.reason = reason;
    expect(enter(state).trades).toHaveLength(0);
  });

  it('gives verified and both exploratory rules deterministic opportunities independent of input order', () => {
    const snapshot = adaptiveTestSnapshot(), state = selectPaperAdaptiveState(undefined, matureAdaptiveSamples(), snapshot.asOf);
    const first = exploringState().exploration!.rules[0];
    const secondId = 'shadow-exploration-v1:2026-09-18:1:rsi14:0:D5';
    state.exploration = { version: 'shadow-exploration-v1', sequence: 1, rules: [first,
      { ...structuredClone(first), id: secondId, candidate: { ...structuredClone(first.candidate), rule: { ...first.candidate.rule, horizon: 5 } } }] };
    snapshot.observations = Array.from({ length: 60 }, (_, index) => ({ ...structuredClone(snapshot.observations[0]), symbol: String(100000 + index) }));
    const original = enter(state, snapshot);
    const assignment = (ledger: typeof original) => Object.fromEntries(ledger.trades.map(trade => [trade.symbol,
      trade.entryDecision.explorationEvidence?.trialId ?? 'validated']).sort(([a], [b]) => a.localeCompare(b)));
    expect(new Set(Object.values(assignment(original)))).toEqual(new Set(['validated', first.id, secondId]));
    expect(original.trades).toHaveLength(60);
    state.candidates.reverse(); state.exploration.rules.reverse(); snapshot.observations.reverse();
    expect(assignment(enter(JSON.parse(JSON.stringify(state)), snapshot))).toEqual(assignment(original));
    const repeated = evaluatePaperStrategyScan(JSON.parse(JSON.stringify(original)), snapshot, strategyTestCost, state);
    expect(repeated.trades).toEqual(original.trades);
    expect(repeated.lastRun).toMatchObject({ openedCount: 0, holdingCount: 60 });
    expect(() => assertPaperStrategyLedger(original)).not.toThrow();
  });

  it('keeps a replaced exploration rule and benchmark frozen through restart, HOLD and observed EXIT', () => {
    const first = enter(), frozen = structuredClone(first.trades[0].entryDecision.explorationEvidence);
    const changed = exploringState(); changed.exploration!.rules[0].candidate.rule.horizon = 5;
    changed.exploration!.sequence = 2;
    changed.exploration!.rules[0].id = 'shadow-exploration-v1:2026-09-18:2:rsi14:0:D5';
    const held = evaluatePaperStrategyScan(JSON.parse(JSON.stringify(first)), adaptiveTestSnapshot(), strategyTestCost, changed);
    expect(held.latestDecisions[0]).toMatchObject({ action: 'HOLD', explorationEvidence: frozen });
    expect(held.trades[0]).toEqual(first.trades[0]);
    const snapshot = adaptiveTestSnapshot();
    snapshot.id = 'observed-exit'; snapshot.asOf = '2026-09-18T01:05:00Z';
    snapshot.observations[0].observedAt = snapshot.asOf; snapshot.observations[0].price = 9400;
    snapshot.observations[0].features!.asOf = snapshot.asOf;
    const retired = selectPaperAdaptiveState(undefined, [], snapshot.asOf);
    const closed = evaluatePaperStrategyScan(JSON.parse(JSON.stringify(held)), snapshot, strategyTestCost, retired);
    expect(closed.trades[0].exit).toMatchObject({ effectiveAt: snapshot.asOf, price: 9400,
      decision: { action: 'EXIT', explorationEvidence: frozen } });
    expect(closed.trades[0].entryDecision.explorationEvidence).toEqual(frozen);
    expect(() => assertPaperStrategyLedger(JSON.parse(JSON.stringify(closed)))).not.toThrow();
    for (const mutate of [
      (evidence: NonNullable<typeof frozen>) => { evidence.registeredAt = first.trades[0].entryAt; },
      (evidence: NonNullable<typeof frozen>) => { evidence.trialId = 'another-trial'; },
      (evidence: NonNullable<typeof frozen>) => { evidence.candidate.rule.horizon = 5; },
    ]) {
      const corrupt = structuredClone(closed); mutate(corrupt.trades[0].exit!.decision.explorationEvidence!);
      expect(() => assertPaperStrategyLedger(corrupt)).toThrow('PAPER_STRATEGY_INVALID');
    }
  });

  it('requires invented formulas to exist before trial registration and freezes their original arithmetic', () => {
    const state = exploringState(), snapshot = adaptiveTestSnapshot();
    snapshot.observations[0].features!.values.volumeRatio20 = 0.25;
    const formula = createPaperIndicatorFormula('PRODUCT', 'rsi14', 'volumeRatio20');
    const value = paperIndicatorFormulaValue(formula, snapshot.observations[0].features!.values)!;
    const bucket = PAPER_INVENTED_FEATURE_CUTS.filter(cut => value >= cut).length;
    const training = selectPaperAdaptiveState(undefined, matureAdaptiveSamples(), snapshot.asOf).candidates.find(item => item.active)!.training;
    const invention = { id: paperIndicatorFormulaId(formula), formula, createdAt: '2026-09-18T00:45:00Z',
      discoveryCutoffAt: state.cutoffAt, rule: { bucket, horizon: 1 as const }, training };
    const candidate: PaperAdaptiveCandidate = { ...state.exploration!.rules[0].candidate,
      rule: { feature: invention.id, ...invention.rule, invention }, training, reason: 'FORWARD_OBSERVATION' };
    state.exploration!.rules[0].candidate = candidate;
    state.exploration!.rules[0].id = `shadow-exploration-v1:2026-09-18:1:${invention.id}:${bucket}:D1`;
    const trade = enter(state, snapshot).trades[0];
    expect(trade.entryDecision.explorationEvidence!.candidate.rule.invention).toEqual(invention);
    candidate.rule.invention!.createdAt = '2026-09-18T00:59:30Z';
    expect(enter(state, snapshot).trades).toHaveLength(0);
    invention.formula.left.scale = 999;
    expect(trade.entryDecision.explorationEvidence!.candidate.rule.invention!.formula.left.scale).not.toBe(999);
  });
});
