// @responsibility Verify autonomous trial selection continuity across unavailable observations.
import { describe, expect, it, vi } from 'vitest';
import type { PaperAdaptiveCandidate, PaperAdaptiveFeatureKey, PaperAdaptiveRule, PaperAdaptiveState } from '../../../src/types/paperAdaptive.js';
import type { PaperStrategyTrade } from '../../../src/types/paperStrategy.js';
import type { PaperFeatureKey } from '../../../src/types/paperObservationFeatures.js';
import { paperAutonomyRuleKey } from '../../../src/types/paperAutonomy.js';
import { adaptiveTestSnapshot } from './paperAdaptiveFixtures.js';
import { selectPaperAdaptiveState } from './paperAdaptiveSelection.js';
import { selectPaperShadowExploration } from './paperShadowExploration.js';
import { adaptiveStateSchema } from './paperAdaptiveValidation.js';
import { paperAutonomyStateSchema } from './paperAutonomyValidation.js';

function snapshot(at = '2026-09-18T01:00:00Z') {
  const value = adaptiveTestSnapshot(); value.asOf = at; value.tradingDate = at.slice(0, 10);
  value.observations[0].observedAt = at; value.observations[0].features!.asOf = at;
  Object.assign(value.observations[0].features!.values, { rsi14: 20, per: 5, pbr: 0.5 });
  return value;
}
function selectionInput() {
  const source = snapshot(), state = selectPaperAdaptiveState(undefined, [], source.asOf);
  const features: PaperFeatureKey[] = ['rsi14', 'per', 'pbr'];
  const candidates = features.map(feature => structuredClone(state.candidates.find(item => item.rule.feature === feature)!));
  const observations = [source.observations[0], { ...structuredClone(source.observations[0]), symbol: '000660' }];
  return { previous: undefined as PaperAdaptiveState | undefined, candidates, observations, asOf: source.asOf,
    trades: [] as PaperStrategyTrade[], value: (_observation: typeof observations[number], _feature: PaperAdaptiveFeatureKey) => 0 as number | null,
    evaluate: (rule: PaperAdaptiveRule): PaperAdaptiveCandidate => ({
      ...structuredClone(candidates.find(item => item.rule.feature === rule.feature)!), rule: structuredClone(rule) }) };
}

describe('autonomous trial selection continuity', () => {
  it('retains bounded selection history across a normal next-day empty scan then resumes with current-day rules', () => {
    const firstSource = snapshot(), first = selectPaperAdaptiveState(undefined, [], firstSource.asOf, firstSource.observations, [], []);
    const original = JSON.stringify(first), history = first.exploration!.autonomy!.selectionHistory!;
    expect(history).toHaveLength(2);
    const empty = selectPaperAdaptiveState(first, [], '2026-09-21T00:00:00Z', [], [], []);
    expect(empty.exploration).toMatchObject({ sequence: first.exploration!.sequence + 1, rules: [], autonomy: {
      status: 'READY', entries: [], selectedRuleKeys: [], evaluatedAt: '2026-09-21T00:00:00Z', selectionHistory: expect.arrayContaining(history) } });
    expect(empty.exploration!.autonomy!.selectionHistory).toHaveLength(history.length);
    expect(adaptiveStateSchema.safeParse(empty).success).toBe(true);
    const later = snapshot('2026-09-21T01:00:00Z');
    const resumed = selectPaperAdaptiveState(empty, [], later.asOf, later.observations, [], []);
    expect(resumed.exploration!.sequence).toBe(empty.exploration!.sequence);
    expect(resumed.exploration!.rules).toHaveLength(2);
    expect(resumed.exploration!.rules.every(rule => rule.registeredAt === later.asOf)).toBe(true);
    expect(resumed.exploration!.autonomy!.selectionHistory!.length).toBeGreaterThanOrEqual(history.length);
    for (const item of history) expect(resumed.exploration!.autonomy!.selectionHistory!.some(row => row.ruleKey === item.ruleKey)).toBe(true);
    expect(adaptiveStateSchema.safeParse(resumed).success).toBe(true);
    expect(JSON.stringify(first)).toBe(original);
  });

  it('keeps sequence and history through consecutive empty days and rejects stale observations as new trials', () => {
    const source = snapshot(), first = selectPaperAdaptiveState(undefined, [], source.asOf, source.observations, [], []);
    const next = selectPaperAdaptiveState(first, [], '2026-09-21T00:00:00Z', source.observations, [], []);
    const after = selectPaperAdaptiveState(next, [], '2026-09-22T00:00:00Z', [], [], []);
    expect(next.exploration!.rules).toEqual([]); expect(after.exploration!.rules).toEqual([]);
    expect(after.exploration!.sequence).toBe(first.exploration!.sequence + 2);
    expect(after.exploration!.autonomy!.selectionHistory).toEqual(expect.arrayContaining(first.exploration!.autonomy!.selectionHistory!));
    expect(after.exploration!.autonomy!.selectionHistory).toHaveLength(first.exploration!.autonomy!.selectionHistory!.length);
    expect(adaptiveStateSchema.safeParse(after).success).toBe(true);
  });

  it('preserves history when inputs exist but no candidate remains eligible', () => {
    const input = selectionInput(), first = selectPaperShadowExploration(input)!;
    const previous = selectPaperAdaptiveState(undefined, [], '2026-09-17T01:00:00Z');
    previous.exploration = { ...first, rules: [], autonomy: { ...first.autonomy!, entries: [], selectedRuleKeys: [],
      selectionHistory: first.autonomy!.selectionHistory!.map(row => ({ ...row, selectedAt: '2026-09-17T01:00:00Z' })) } };
    const result = selectPaperShadowExploration({ ...input, previous, candidates: input.candidates.map(item => ({ ...item, reason: 'NO_TRAINING_EDGE' })) })!;
    expect(result.rules).toEqual([]);
    expect(result.autonomy).toMatchObject({ status: 'READY', entries: [], selectedRuleKeys: [],
      selectionHistory: expect.arrayContaining(previous.exploration.autonomy!.selectionHistory!) });
    expect(result.autonomy!.selectionHistory).toHaveLength(previous.exploration.autonomy!.selectionHistory!.length);
    expect(paperAutonomyStateSchema.safeParse(result.autonomy).success).toBe(true);
  });

  it('uses the second slot for a different observed stock group when one is available', () => {
    const input = selectionInput();
    const legacy = selectPaperShadowExploration({ ...input, trades: undefined })!;
    const sameGroup = new Set(legacy.rules.map(trial => trial.candidate.rule.feature));
    input.value = (observation, feature) => (sameGroup.has(feature) === (observation.symbol === input.observations[0].symbol)) ? 0 : null;
    const result = selectPaperShadowExploration(input)!;
    expect(result.rules).toHaveLength(2);
    expect(sameGroup.has(result.rules[0].candidate.rule.feature)).toBe(true);
    expect(sameGroup.has(result.rules[1].candidate.rule.feature)).toBe(false);
  });

  it('gives the least-recently-selected rule the second slot when stock groups overlap', () => {
    const input = selectionInput(), initial = selectPaperShadowExploration(input)!;
    const previous = selectPaperAdaptiveState(undefined, [], input.asOf, [], [], []);
    const selected = initial.rules.map(row => paperAutonomyRuleKey(row.candidate.rule));
    const old = initial.autonomy!.entries.find(item => !selected.includes(item.ruleKey))!.ruleKey;
    previous.exploration = { ...initial, rules: [], autonomy: { ...initial.autonomy!, entries: [], selectedRuleKeys: [],
      selectionHistory: initial.autonomy!.entries.map(item => ({ ruleKey: item.ruleKey,
        selectedAt: item.ruleKey === old ? '2026-09-15T01:00:00Z' : '2026-09-17T01:00:00Z' })) } };
    const result = selectPaperShadowExploration({ ...input, previous })!;
    expect(paperAutonomyRuleKey(result.rules[0].candidate.rule)).toBe(selected[0]);
    expect(paperAutonomyRuleKey(result.rules[1].candidate.rule)).toBe(old);
    expect(result.autonomy!.entries.find(item => item.ruleKey === old)!.lastSelectedAt).toBe(input.asOf);
  });

  it('logs a scoring failure and keeps the legacy two trial choices', () => {
    const input = selectionInput(), legacy = selectPaperShadowExploration({ ...input, trades: undefined })!;
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = selectPaperShadowExploration({ ...input, trades: [null as unknown as PaperStrategyTrade] })!;
      expect(result.rules).toEqual(legacy.rules);
      expect(result.autonomy).toMatchObject({ status: 'FALLBACK', entries: [], selectedRuleKeys: [] });
      expect(paperAutonomyStateSchema.safeParse(result.autonomy).success).toBe(true);
      expect(log).toHaveBeenCalledOnce();
    } finally { log.mockRestore(); }
  });
});
