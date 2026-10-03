// @responsibility Verify bounded prospective Shadow trial registration.
import { describe, expect, it } from 'vitest';
import type { PaperObservation } from '../../../src/types/paperExperiment.js';
import type { PaperFeatureValues } from '../../../src/types/paperObservationFeatures.js';
import { adaptiveTestSnapshot, matureAdaptiveSamples } from './paperAdaptiveFixtures.js';
import { adaptiveRuleMatches, selectPaperAdaptiveState } from './paperAdaptiveSelection.js';
import { assertPaperStrategyLedger } from './paperStrategyValidation.js';
import { emptyStrategyLedger } from './paperStrategyFixtures.js';

const asOf = '2026-09-18T01:00:00Z';
function observe(values: Partial<PaperFeatureValues> = {}, at = asOf): PaperObservation {
  const observation = adaptiveTestSnapshot().observations[0];
  observation.observedAt = at; observation.features!.asOf = at;
  Object.assign(observation.features!.values, values);
  return observation;
}
const restore = <T>(value: T): T => JSON.parse(JSON.stringify(value));

describe('prospective Shadow trial registration', () => {
  it('selects at most two reproducible observed ranges without claiming positive evidence', () => {
    const observations = [observe({ rsi14: 80, volumeRatio20: 3, per: 50 })];
    const state = selectPaperAdaptiveState(undefined, [], asOf, observations);
    expect(state.exploration).toMatchObject({ version: 'shadow-exploration-v1', sequence: 1 });
    expect(state.exploration!.rules).toHaveLength(2);
    expect(state).toEqual(selectPaperAdaptiveState(undefined, [], asOf, observations));
    for (const trial of state.exploration!.rules) {
      expect(trial.registeredAt).toBe(asOf);
      expect(trial.id).toBe(`shadow-exploration-v1:2026-09-18:1:${trial.candidate.rule.feature}:3:D${trial.candidate.rule.horizon}`);
      expect(trial.candidate).toMatchObject({ active: false, reason: 'INSUFFICIENT_TRAINING', rule: { bucket: 3 },
        training: { sampleCount: 0, meanNetReturnPct: null, meanDailyExcessPct: null }, validation: { sampleCount: 0 } });
      expect(adaptiveRuleMatches(observations[0], trial.candidate.rule, asOf)).toBe(true);
    }
    expect(state.candidates.some(item => item.active)).toBe(false);
    expect(() => assertPaperStrategyLedger(restore({ ...emptyStrategyLedger(), adaptive: state }))).not.toThrow();
  });

  it('initializes after the first usable observation without rewriting the already frozen daily evaluation', () => {
    const first = selectPaperAdaptiveState(undefined, [], asOf, []);
    const missing = observe({ rsi14: null }, '2026-09-18T01:01:00Z');
    const stillWaiting = selectPaperAdaptiveState(first, [], missing.observedAt, [missing]);
    expect(stillWaiting.exploration).toBeUndefined();
    const later = observe({ rsi14: 80 }, '2026-09-18T01:02:00Z');
    const registered = selectPaperAdaptiveState(stillWaiting, [], later.observedAt, [later]);
    expect(registered.evaluatedAt).toBe(asOf);
    expect(registered.candidates).toEqual(first.candidates);
    expect(registered.discovery).toEqual(first.discovery);
    expect(registered.changes).toEqual(first.changes);
    expect(registered.exploration!.rules[0].registeredAt).toBe(later.observedAt);
    const changed = observe({ rsi14: 20, volumeRatio20: 3 }, '2026-09-18T02:00:00Z');
    expect(selectPaperAdaptiveState(restore(registered), matureAdaptiveSamples(), changed.observedAt, [changed])).toEqual(registered);
    expect(() => assertPaperStrategyLedger(restore({ ...emptyStrategyLedger(), adaptive: registered }))).not.toThrow();
  });

  it('does not initialize with stale, future, broken, or absent source inputs', () => {
    const bad = [observe(), observe(), observe(), observe(), observe(), observe()];
    bad[0].features!.asOf = '2026-09-17T01:00:00Z';
    bad[1].features!.asOf = '2026-09-18T02:00:00Z';
    bad[2].observedAt = '2026-09-17T01:00:00Z';
    bad[3].observedAt = '2026-09-18T02:00:00Z';
    bad[4].issue = 'provider unavailable';
    bad[5].price = null;
    expect(selectPaperAdaptiveState(undefined, [], asOf, bad).exploration).toBeUndefined();
  });

  it('retries an empty trial set when pending inputs recover, then freezes the first registered rules', () => {
    const samples = matureAdaptiveSamples();
    const first = selectPaperAdaptiveState(undefined, samples, asOf, [observe()]);
    expect(first.candidates.find(item => item.rule.feature === 'rsi14')!.active).toBe(true);
    expect(first.exploration).toMatchObject({ sequence: 1, rules: [] });
    const stillEmptyAt = '2026-09-18T01:01:00Z';
    const stillEmpty = selectPaperAdaptiveState(restore(first), samples, stillEmptyAt, [observe({}, stillEmptyAt)]);
    expect(stillEmpty.exploration).toEqual(first.exploration);
    const recoveredAt = '2026-09-18T01:02:00Z';
    const recovered = selectPaperAdaptiveState(stillEmpty, samples, recoveredAt, [observe({ per: 50 }, recoveredAt)]);
    expect(recovered.exploration).toMatchObject({ sequence: 1, rules: [{ registeredAt: recoveredAt,
      candidate: { active: false, rule: { feature: 'per', bucket: 3 } } }] });
    expect(recovered.evaluatedAt).toBe(first.evaluatedAt);
    expect(recovered.candidates).toEqual(first.candidates);
    const laterAt = '2026-09-18T02:00:00Z';
    expect(selectPaperAdaptiveState(restore(recovered), samples, laterAt, [observe({ per: 5, pbr: 3 }, laterAt)])).toEqual(recovered);
    expect(() => assertPaperStrategyLedger(restore({ ...emptyStrategyLedger(), adaptive: recovered }))).not.toThrow();
  });

  it('rotates actual populated buckets and holding periods on later daily registrations', () => {
    const observations = [observe({ rsi14: 20 }), observe({ rsi14: 80 })];
    const first = selectPaperAdaptiveState(undefined, [], asOf, observations);
    const nextAt = '2026-09-21T01:00:00Z';
    const later = [observe({ rsi14: 20 }, nextAt), observe({ rsi14: 80 }, nextAt)];
    const second = selectPaperAdaptiveState(first, [], nextAt, later);
    expect(first.exploration!.rules[0].candidate.rule).toMatchObject({ feature: 'rsi14', bucket: 0, horizon: 1 });
    expect(second.exploration).toMatchObject({ sequence: 2, rules: [{ candidate: { rule: { feature: 'rsi14', bucket: 3, horizon: 3 } } }] });
    expect(second.exploration!.rules[0].id).not.toBe(first.exploration!.rules[0].id);
    expect(second.exploration!.rules[0].registeredAt).toBe(nextAt);
  });

  it('calculates the selected bucket statistics instead of copying the training winner', () => {
    const samples = matureAdaptiveSamples({ entryDateCount: 3 });
    const state = selectPaperAdaptiveState(undefined, samples, asOf, [observe({ rsi14: 60 })]);
    const winner = state.candidates.find(item => item.rule.feature === 'rsi14')!;
    const trial = state.exploration!.rules[0].candidate;
    expect(winner.rule.bucket).toBe(0);
    expect(winner.training.meanNetReturnPct).toBeGreaterThan(0);
    expect(trial.rule).toEqual({ feature: 'rsi14', bucket: 2, horizon: 1 });
    expect(trial.training).toMatchObject({ sampleCount: 4, dateCount: 1, meanNetReturnPct: 0 });
    expect(trial.validation).toMatchObject({ sampleCount: 4, dateCount: 1, meanNetReturnPct: 0 });
    expect(trial.training.experimentIds!.every(id => samples.some(row => row.id === id && Number(row.symbol.at(-1)) >= 4))).toBe(true);
    expect(trial.training.experimentIds).not.toEqual(winner.training.experimentIds);
  });

  it('cannot bypass active or empirically rejected features by trying a different bucket', () => {
    for (const samples of [matureAdaptiveSamples(), matureAdaptiveSamples({ selectedReturns: [-1, -9, -10] }),
      matureAdaptiveSamples({ selectedReturns: (_, index) => index < 22 ? [1, 9, 10] : [-1, -9, -10] })]) {
      const state = selectPaperAdaptiveState(undefined, samples, asOf, [observe({ rsi14: 60 })]);
      expect(state.exploration!.rules).toEqual([]);
    }
  });

  it('rejects adequately sampled validation losses even when training inputs were absent', () => {
    const samples = matureAdaptiveSamples({ entryDateCount: 8, selectedReturns: [-2, -2, -2], controlReturns: [-2, -2, -2] });
    const dates = [...new Set(samples.map(row => row.tradingDate))];
    for (const row of samples) {
      row.entryObservation.features!.values.volumeRatio20 = 1;
      if (row.tradingDate < dates[5]) row.entryObservation.features!.values.rsi14 = null;
    }
    const state = selectPaperAdaptiveState(undefined, samples, asOf, [observe()]);
    expect(state.candidates.find(item => item.rule.feature === 'rsi14')).toMatchObject({ active: false, reason: 'NO_VALIDATION_EDGE',
      training: { sampleCount: 0 }, validation: { sampleCount: 12, dateCount: 3 } });
    expect(state.exploration!.rules).toEqual([]);
  });

  it('keeps exploration available for scant losses or small nonnegative validation returns', () => {
    for (const variant of ['scant-loss', 'weak-positive'] as const) {
      const returns = variant === 'scant-loss' ? -2 : 0.01;
      const samples = matureAdaptiveSamples({ entryDateCount: 8, selectedReturns: [returns, returns, returns], controlReturns: [returns, returns, returns] });
      const dates = [...new Set(samples.map(row => row.tradingDate))];
      for (const row of samples) {
        row.entryObservation.features!.values.volumeRatio20 = 1;
        if (row.tradingDate < dates[variant === 'scant-loss' ? 7 : 5]) row.entryObservation.features!.values.rsi14 = null;
      }
      const state = selectPaperAdaptiveState(undefined, samples, asOf, [observe()]);
      expect(state.candidates.find(item => item.rule.feature === 'rsi14')).toMatchObject({ active: false, reason: 'MISSING_INPUT', training: { sampleCount: 0 } });
      expect(state.exploration!.rules).toHaveLength(1);
      expect(state.exploration!.rules[0].candidate.rule.feature).toBe('rsi14');
    }
  });

  it('prioritizes pending inventions while preserving their frozen definition and excluding historical validation', () => {
    const samples = matureAdaptiveSamples();
    for (const row of samples) {
      const index = Number(row.symbol.slice(-1));
      row.entryObservation.features!.values.rsi14 = index % 4 < 2 ? 20 : 80;
      row.entryObservation.features!.values.volumeRatio20 = [0, 1, 6, 7].includes(index) ? 0.25 : 1.75;
    }
    const observation = observe({ rsi14: 20, volumeRatio20: 0.25, per: 20 });
    const state = selectPaperAdaptiveState(undefined, samples, asOf, [observation]);
    expect(state.exploration!.rules).toHaveLength(2);
    expect(state.exploration!.rules.every(trial => trial.candidate.rule.invention)).toBe(true);
    for (const trial of state.exploration!.rules) {
      expect(trial.candidate).toMatchObject({ active: false, reason: 'FORWARD_OBSERVATION', validation: { sampleCount: 0, dateCount: 0 } });
      expect(trial.candidate.rule.invention).toEqual(state.discovery!.inventions.find(item => item.id === trial.candidate.rule.feature));
      expect(trial.candidate.training).toEqual(trial.candidate.rule.invention!.training);
    }
  });
});
