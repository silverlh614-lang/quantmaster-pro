// @responsibility Verify autonomous trial allocation preserves real Shadow lifecycle evidence.
import { describe, expect, it, vi } from 'vitest';
import { adaptiveTestSnapshot } from './paperAdaptiveFixtures.js';
import { selectPaperAdaptiveState } from './paperAdaptiveSelection.js';
import { evaluatePaperStrategyScan } from './paperStrategyPolicy.js';
import { emptyStrategyLedger, strategyTestCost } from './paperStrategyFixtures.js';
import { assertPaperStrategyLedger } from './paperStrategyValidation.js';
import { allocatePaperAutonomyEntry } from './paperAutonomyAllocation.js';
import { paperAutonomyRuleKey } from '../../../src/types/paperAutonomy.js';
import { paperEvidenceDigest } from './paperStrategyEvidence.js';

function ready() {
  const snapshot = adaptiveTestSnapshot();
  Object.assign(snapshot.observations[0].features!.values, { per: 5, pbr: 1, rsi14: 20 });
  const state = selectPaperAdaptiveState(undefined, [], snapshot.asOf, snapshot.observations, [], []);
  snapshot.id = 'autonomous-entry'; snapshot.asOf = '2026-09-18T01:01:00Z';
  snapshot.observations[0].observedAt = snapshot.asOf; snapshot.observations[0].features!.asOf = snapshot.asOf;
  return { snapshot, state };
}
describe('autonomous exploration integration', () => {
  it('records daily research plus equal-weight baseline without changing entries or holdings', () => {
    const { snapshot, state } = ready();
    expect(state.exploration!.autonomy).toMatchObject({ status: 'READY', selectedRuleKeys: expect.any(Array) });
    expect(state.exploration!.rules).toHaveLength(2);
    expect(state.exploration!.autonomy!.entries.every(item => item.reason === 'EXPLORE')).toBe(true);
    const ledger = evaluatePaperStrategyScan(emptyStrategyLedger(), snapshot, strategyTestCost, state);
    const trade = ledger.trades[0], frozen = structuredClone(trade.entryDecision.allocation!);
    expect(frozen.method).toBe('OUTCOME_WEIGHTED'); expect(frozen.selectedRuleKey).toBe(frozen.baselineRuleKey);
    expect(trade.quantity).toBe(1); expect(() => assertPaperStrategyLedger(ledger)).not.toThrow();
    expect(selectPaperAdaptiveState(state, [], snapshot.asOf, snapshot.observations, [], ledger.trades)).toEqual(state);
    const oldState = structuredClone(state); delete oldState.exploration!.autonomy;
    const baseline = evaluatePaperStrategyScan(emptyStrategyLedger(), snapshot, strategyTestCost, oldState);
    expect(baseline.trades[0].entryDecision.explorationEvidence).toEqual(trade.entryDecision.explorationEvidence);
    const held = evaluatePaperStrategyScan(JSON.parse(JSON.stringify(ledger)), snapshot, strategyTestCost, oldState);
    expect(held.latestDecisions[0].allocation).toEqual(frozen);
    snapshot.id = 'autonomous-exit'; snapshot.asOf = '2026-09-18T01:03:00Z'; snapshot.quoteOnly = true;
    snapshot.observations[0].price = trade.entryPrice * 0.9; snapshot.observations[0].observedAt = snapshot.asOf;
    delete snapshot.observations[0].features;
    const closed = evaluatePaperStrategyScan(held, snapshot, strategyTestCost, oldState);
    expect(closed.trades[0].exit?.decision.allocation).toEqual(frozen);
    expect(closed.trades[0].exitPolicy).toEqual(trade.exitPolicy);
    expect(() => assertPaperStrategyLedger(closed)).not.toThrow();
    const tampered = structuredClone(closed); tampered.trades[0].exit!.decision.allocation!.choices.reverse();
    expect(() => assertPaperStrategyLedger(tampered)).toThrow();
  });
  it('gives bounded positive and negative trials opportunities reproducibly, then falls back on invalid evidence', () => {
    const { snapshot, state } = ready(), autonomy = state.exploration!.autonomy!;
    const matching = state.exploration!.rules.map(trial => ({ trial, candidate: trial.candidate }));
    const strongKey = paperAutonomyRuleKey(matching[0].candidate.rule);
    for (const item of autonomy.entries) {
      const strong = item.ruleKey === strongKey;
      item.reason = strong ? 'INCREASE' : 'REDUCE'; item.weight = strong ? 3 : 1;
      item.stats = { totalCount: 12, closedCount: 12, pendingCount: 0, sampleCount: 12, dateCount: 3,
        meanNetReturnPct: strong ? 2 : -2, meanDateNetReturnPct: strong ? 2 : -2, standardErrorPct: 0,
        tradeIdsDigest: paperEvidenceDigest(['test-history']) };
    }
    const counts = new Map<string, number>(); let changes = 0;
    for (let index = 0; index < 400; index++) {
      const symbol = String(100000 + index), result = allocatePaperAutonomyEntry(matching, autonomy, symbol, snapshot.asOf);
      const allocation = result.allocation!;
      expect(allocatePaperAutonomyEntry([...matching].reverse(), JSON.parse(JSON.stringify(autonomy)), symbol, snapshot.asOf).allocation).toEqual(allocation);
      counts.set(allocation.selectedRuleKey, (counts.get(allocation.selectedRuleKey) ?? 0) + 1);
      if (allocation.selectedRuleKey !== allocation.baselineRuleKey) changes++;
    }
    expect(counts.size).toBe(2); expect(counts.get(strongKey)).toBeGreaterThan(240); expect(changes).toBeGreaterThan(0);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const invalid = structuredClone(autonomy); invalid.cutoffAt = snapshot.asOf;
      const result = allocatePaperAutonomyEntry(matching, invalid, '100001', snapshot.asOf);
      expect(result.allocation).toMatchObject({ method: 'LEGACY_FALLBACK' });
      expect(result.allocation!.selectedRuleKey).toBe(result.allocation!.baselineRuleKey);
      expect(log).toHaveBeenCalledOnce();
    } finally { log.mockRestore(); }
  });
  it('keeps an unavailable first snapshot from freezing autonomous research before usable inputs arrive', () => {
    const { snapshot } = ready();
    const first = selectPaperAdaptiveState(undefined, [], '2026-09-18T00:00:00Z', [], [], []);
    const current = selectPaperAdaptiveState(first, [], snapshot.asOf, snapshot.observations, [], []);
    expect(current.evaluatedAt).toBe(first.evaluatedAt);
    expect(current.exploration!.autonomy!.evaluatedAt).toBe(snapshot.asOf);
    expect(() => assertPaperStrategyLedger({ ...emptyStrategyLedger(), adaptive: current })).not.toThrow();
  });
  it('persists legacy fallback after invalid current allocation without rewriting held trade evidence', () => {
    const { snapshot, state } = ready();
    const original = evaluatePaperStrategyScan(emptyStrategyLedger(), snapshot, strategyTestCost, state);
    const frozen = structuredClone(original.trades[0].entryDecision);
    const invalid = structuredClone(state); invalid.exploration!.autonomy!.cutoffAt = snapshot.asOf;
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const fallback = evaluatePaperStrategyScan(emptyStrategyLedger(), snapshot, strategyTestCost, invalid);
      expect(fallback.adaptive!.exploration!.autonomy).toMatchObject({ status: 'FALLBACK', cutoffAt: state.cutoffAt });
      expect(fallback.trades[0].entryDecision.allocation!.method).toBe('LEGACY_FALLBACK');
      expect(() => assertPaperStrategyLedger(JSON.parse(JSON.stringify(fallback)))).not.toThrow();
      const held = evaluatePaperStrategyScan(original, snapshot, strategyTestCost, invalid);
      expect(held.trades[0].entryDecision).toEqual(frozen);
      expect(held.latestDecisions[0].allocation).toEqual(frozen.allocation);
      expect(() => assertPaperStrategyLedger(held)).not.toThrow();
      expect(invalid.exploration!.autonomy!.cutoffAt).toBe(snapshot.asOf);
      expect(log).toHaveBeenCalledTimes(2);
    } finally { log.mockRestore(); }
  });
});
