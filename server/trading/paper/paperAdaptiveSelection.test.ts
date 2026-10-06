// @responsibility Verify dated autonomous selection, retirement, frozen entries, and persisted evidence integrity.
import { describe, expect, it } from 'vitest';
import type { PaperSnapshot } from '../../../src/types/paperExperiment.js';
import type { PaperAdaptiveState } from '../../../src/types/paperAdaptive.js';
import type { PaperStrategyLedger } from '../../../src/types/paperStrategy.js';
import { PAPER_FEATURES, PAPER_LEGACY_FEATURE_KEYS, type PaperFeatureKey } from '../../../src/types/paperObservationFeatures.js';
import { isKrxTradingDay } from '../../calendar/krxTradingCalendar.js';
import { addBusinessDaysFromKstDate } from '../krxHolidays.js';
import { adaptiveFeatureValue, adaptiveRuleMatches, PAPER_PLACEBO_PERMUTATIONS, paperPlaceboDonors, selectPaperAdaptiveState } from './paperAdaptiveSelection.js';
import { adaptiveTestSnapshot, matureAdaptiveSamples } from './paperAdaptiveFixtures.js';
import { evaluatePaperStrategyScan } from './paperStrategyPolicy.js';
import { assertPaperStrategyLedger } from './paperStrategyValidation.js';
import { adaptiveObservationSchema, adaptiveStateSchema } from './paperAdaptiveValidation.js';
import { emptyStrategyLedger, legacyStrategyLedger, strategyTestCost } from './paperStrategyFixtures.js';

const asOf = '2026-09-18T01:00:00Z';
const rsi = (state: PaperAdaptiveState) => state.candidates.find(item => item.rule.feature === 'rsi14')!;
const select = (samples = matureAdaptiveSamples()) => selectPaperAdaptiveState(undefined, samples, asOf);
const enter = (samples = matureAdaptiveSamples(), snapshot = adaptiveTestSnapshot()) =>
  evaluatePaperStrategyScan(emptyStrategyLedger(), snapshot, strategyTestCost, selectPaperAdaptiveState(undefined, samples, snapshot.asOf));
const restore = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function snapshotOn(date: string): PaperSnapshot {
  const snapshot = adaptiveTestSnapshot();
  snapshot.tradingDate = date; snapshot.asOf = `${date}T01:00:00Z`; snapshot.id = `scan-${date}`;
  snapshot.observations[0].observedAt = snapshot.asOf; snapshot.observations[0].features!.asOf = snapshot.asOf;
  return snapshot;
}

describe('dated autonomous feature selection', () => {
  it('activates the training-selected D3 RSI rule and connects it to one-share Shadow BUY', () => {
    const samples = matureAdaptiveSamples(), state = select(samples), ledger = enter(samples);
    expect(samples).toHaveLength(256);
    expect(samples.every(item => isKrxTradingDay(item.tradingDate) && item.outcomes.length === 3)).toBe(true);
    expect(state).toMatchObject({ matureSampleCount: 256, matureDateCount: 32 });
    expect(state.candidates.filter(item => item.active)).toHaveLength(1);
    expect(rsi(state)).toMatchObject({ rule: { feature: 'rsi14', bucket: 0, horizon: 3 }, active: true, reason: 'ACTIVE' });
    expect(rsi(state).training.meanDailyExcessPct).toBeCloseTo(1.5);
    expect(rsi(state).validation.meanDailyExcessPct).toBeCloseTo(1.5);
    expect(ledger.trades[0]).toMatchObject({ strategyVersion: 'adaptive-features-v1', quantity: 1, horizon: 3,
      scheduledExitDate: '2026-09-23', entryDecision: { action: 'BUY', reasonCode: 'ADAPTIVE_FEATURE_SELECTED', evidence: null } });
    expect(ledger.trades[0].entryDecision.adaptiveEvidence!.candidate).toEqual(rsi(state));
    expect(state.changes).toEqual([{ at: asOf, feature: 'rsi14', from: null, to: rsi(state).rule, reason: 'ACTIVE' }]);
  });

  it('excludes invalid observations and rejects malformed results independently for each horizon', () => {
    const samples = matureAdaptiveSamples(), expected = select(samples);
    const invalid = Array.from({ length: 5 }, (_, index) => {
      const row = structuredClone(samples[0]);
      row.id = `invalid-${index}`; row.symbol = `99900${index}`; row.entryObservation.symbol = row.symbol;
      return row;
    });
    invalid[0].entryAt = '2026-09-18T02:00:00Z';
    invalid[1].costModel.buyFeeRate = -0.01;
    invalid[2].costModel.slippageRate = Number.NaN;
    invalid[3].outcomes[2].tradingDate = addBusinessDaysFromKstDate(invalid[3].tradingDate, 6);
    invalid[4].outcomes[1].availableAt = `${invalid[4].outcomes[1].tradingDate}T06:00:00Z`;
    const duplicate = { ...structuredClone(samples[0]), id: `${samples[0].id}-duplicate` };
    expect(select([...samples, duplicate, ...invalid.slice(0, 3)])).toEqual(expected);
    const partlyValid = select([...samples, ...invalid.slice(3)]);
    expect(partlyValid.matureSampleCount).toBe(258);
    expect(partlyValid.horizonSamples!.map(item => item.matureSampleCount)).toEqual([258, 257, 257]);
    expect(rsi(partlyValid).training.experimentIds).toContain(invalid[3].id);
    expect(rsi(partlyValid).training.experimentIds).not.toContain(invalid[4].id);
  });

  it('uses only outcomes available strictly before the evaluation-day cutoff', () => {
    const samples = matureAdaptiveSamples(), cutoffAt = select(samples).cutoffAt;
    const first = samples.at(-8)!, second = samples.at(-7)!;
    first.outcomes[1].availableAt = cutoffAt;
    second.outcomes[1].availableAt = '2026-09-18T00:30:00Z';
    const state = select(samples);
    expect(state.matureSampleCount).toBe(256);
    expect(state.horizonSamples!.find(item => item.horizon === 3)?.matureSampleCount).toBe(254);
    expect(rsi(state).validation.experimentIds).not.toContain(first.id);
    expect(rsi(state).validation.experimentIds).not.toContain(second.id);
    first.outcomes[1].availableAt = new Date(Date.parse(cutoffAt) - 1).toISOString();
    expect(select(samples).horizonSamples!.find(item => item.horizon === 3)?.matureSampleCount).toBe(255);
    expect(rsi(select(samples)).validation.experimentIds).toContain(first.id);
  });

  it('purges the selected horizon when it overlaps validation without discarding its usable result because D5 is later', () => {
    const samples = matureAdaptiveSamples(), state = select(samples), candidate = rsi(state);
    const boundary = Date.parse(`${state.validationStartDate}T00:00:00+09:00`);
    const training = samples.filter(item => candidate.training.experimentIds!.includes(item.id));
    const validation = samples.filter(item => candidate.validation.experimentIds!.includes(item.id));
    expect(training).toHaveLength(76);
    expect(validation).toHaveLength(40);
    expect(training.every(item => Date.parse(item.outcomes.find(outcome => outcome.horizon === candidate.rule.horizon)!.availableAt) < boundary)).toBe(true);
    expect(training.some(item => Date.parse(item.outcomes.find(outcome => outcome.horizon === 5)!.availableAt) >= boundary)).toBe(true);
    expect(validation.every(item => item.tradingDate >= state.validationStartDate!)).toBe(true);
    const overlap = samples.filter(item => item.tradingDate < state.validationStartDate!
      && Date.parse(item.outcomes.find(outcome => outcome.horizon === candidate.rule.horizon)!.availableAt) >= boundary);
    expect(overlap.length).toBeGreaterThan(0);
    expect(overlap.every(item => !candidate.training.experimentIds!.includes(item.id))).toBe(true);
  });

  it('does not retune the bucket or horizon to a profitable validation-only alternative', () => {
    const state = select(matureAdaptiveSamples({
      selectedReturns: (_, index) => index < 22 ? [1, 9, 10] : [-1, -9, -10],
      controlReturns: (_, index) => index < 22 ? [0, 0, 0] : [10, 18, 20],
    }));
    expect(rsi(state)).toMatchObject({ rule: { bucket: 0, horizon: 3 }, active: false, reason: 'NO_VALIDATION_EDGE' });
    expect(rsi(state).training.meanDailyExcessPct).toBeGreaterThan(0);
    expect(rsi(state).validation.meanDailyExcessPct).toBeLessThan(0);
  });

  it('chooses a profitable training horizon over a stronger relative edge that still loses money', () => {
    const samples = matureAdaptiveSamples({ selectedReturns: [-1, 1, 0], controlReturns: [-5, -1, 0] });
    const state = select(samples);
    expect(rsi(state)).toMatchObject({ rule: { feature: 'rsi14', bucket: 0, horizon: 3 }, active: true, reason: 'ACTIVE' });
    expect(rsi(state).training.meanNetReturnPct).toBeCloseTo(1);
    expect(rsi(state).training.meanDailyExcessPct).toBeCloseTo(1 / 3);
    const ledger = enter(samples);
    expect(ledger.trades[0]).toMatchObject({ horizon: 3, entryDecision: { action: 'BUY', reasonCode: 'ADAPTIVE_FEATURE_SELECTED' } });
  });

  it('learns and validates D1 from seven dated outcomes while D3 and D5 still lack independent training dates', () => {
    const samples = matureAdaptiveSamples({ startDate: '2026-09-21', entryDateCount: 8, selectedReturns: [3, 60, 100] });
    const current = selectPaperAdaptiveState(undefined, samples, '2026-10-03T01:00:00Z');
    expect(current).toMatchObject({ validationStartDate: '2026-09-29', matureDateCount: 7, matureSampleCount: 56,
      policy: { maturityModel: 'per-horizon-v1' } });
    expect(current.horizonSamples).toEqual([
      { horizon: 1, matureSampleCount: 56, matureDateCount: 7, trainingSampleCount: 24, trainingDateCount: 3, validationSampleCount: 24, validationDateCount: 3 },
      { horizon: 3, matureSampleCount: 40, matureDateCount: 5, trainingSampleCount: 8, trainingDateCount: 1, validationSampleCount: 8, validationDateCount: 1 },
      { horizon: 5, matureSampleCount: 24, matureDateCount: 3, trainingSampleCount: 0, trainingDateCount: 0, validationSampleCount: 0, validationDateCount: 0 },
    ]);
    expect(rsi(current)).toMatchObject({ active: true, rule: { horizon: 1 }, training: { sampleCount: 12, dateCount: 3 }, validation: { sampleCount: 12, dateCount: 3 } });
    const futureChanged = structuredClone(samples);
    for (const sample of futureChanged) for (const outcome of sample.outcomes) {
      if (Date.parse(outcome.availableAt) >= Date.parse(current.cutoffAt)) outcome.exitPrice *= 100;
    }
    expect(selectPaperAdaptiveState(undefined, futureChanged, current.evaluatedAt)).toEqual(current);
    const snapshot = snapshotOn('2026-10-06');
    const ledger = evaluatePaperStrategyScan(emptyStrategyLedger(), snapshot, strategyTestCost,
      selectPaperAdaptiveState(current, samples, snapshot.asOf));
    expect(ledger.trades[0]).toMatchObject({ horizon: 1, quantity: 1, entryDecision: { action: 'BUY' } });
    expect(() => assertPaperStrategyLedger(restore(ledger))).not.toThrow();
  });

  it('excludes unavailable horizon outcomes from controls instead of treating them as zero returns', () => {
    const samples = matureAdaptiveSamples({ selectedReturns: [-1, 9, -1], controlReturns: [-1, 90, -1] });
    for (const sample of samples) if (Number(sample.symbol.at(-1)) >= 4) sample.outcomes = sample.outcomes.filter(item => item.horizon !== 3);
    const current = select(samples);
    expect(rsi(current)).toMatchObject({ active: false, reason: 'NO_TRAINING_EDGE' });
    expect(rsi(current).training.meanDailyExcessPct).toBe(0);
    expect(rsi(current).validation.meanDailyExcessPct).toBe(0);
    expect(current.horizonSamples!.find(item => item.horizon === 3)?.matureSampleCount).toBe(128);
  });

  it('distinguishes absent training outcomes from a missing feature in otherwise usable training observations', () => {
    const short = selectPaperAdaptiveState(undefined, matureAdaptiveSamples({ startDate: '2026-09-21', entryDateCount: 3 }), '2026-10-03T01:00:00Z');
    expect(rsi(short)).toMatchObject({ training: { dateCount: 1 }, reason: 'INSUFFICIENT_TRAINING' });
    const noOutcome = selectPaperAdaptiveState(undefined, [], asOf);
    expect(noOutcome.candidates.every(item => item.reason === 'INSUFFICIENT_TRAINING')).toBe(true);
    expect(select().candidates.find(item => item.rule.feature === 'per')!.reason).toBe('MISSING_INPUT');
  });

  it('migrates an old maturity policy once on the same day without rewriting existing trade evidence', () => {
    const ledger = enter(), originalTrade = structuredClone(ledger.trades[0]);
    delete ledger.adaptive!.policy.maturityModel;
    const snapshot = adaptiveTestSnapshot(); snapshot.asOf = '2026-09-18T05:00:00Z';
    snapshot.observations[0].observedAt = snapshot.asOf; snapshot.observations[0].features!.asOf = snapshot.asOf;
    const current = selectPaperAdaptiveState(ledger.adaptive, matureAdaptiveSamples(), snapshot.asOf);
    expect(current.evaluatedAt).toBe(snapshot.asOf);
    expect(current.policy.maturityModel).toBe('per-horizon-v1');
    expect(selectPaperAdaptiveState(restore(current), [], '2026-09-18T06:00:00Z')).toEqual(current);
    const updatedTrade = evaluatePaperStrategyScan(ledger, snapshot, strategyTestCost, current).trades[0];
    expect(updatedTrade.entryDecision).toEqual(originalTrade.entryDecision);
    expect(updatedTrade.entryObservation).toEqual(originalTrade.entryObservation);
    expect(updatedTrade.policy).toEqual(originalTrade.policy);
    expect(updatedTrade.exitPolicy).toEqual(originalTrade.exitPolicy);
  });

  it('expands a legacy catalog once without backfilling old observations or changing frozen evidence', () => {
    const legacyKeys = new Set<PaperFeatureKey>(PAPER_LEGACY_FEATURE_KEYS);
    const newKeys = (Object.keys(PAPER_FEATURES) as PaperFeatureKey[]).filter(key => !legacyKeys.has(key));
    const samples = matureAdaptiveSamples();
    for (const sample of samples) for (const key of newKeys) delete sample.entryObservation.features!.values[key];
    const ledger = enter(samples);
    ledger.trades[0].policy.exitModel = 'SCHEDULED_CLOSE';
    delete ledger.trades[0].exitPolicy; delete ledger.trades[0].exitResearch;
    const before = restore(ledger.trades[0]);
    for (const key of newKeys) delete ledger.trades[0].entryObservation.features!.values[key];
    ledger.adaptive!.candidates = ledger.adaptive!.candidates.filter(item => legacyKeys.has(item.rule.feature as PaperFeatureKey));
    expect(adaptiveObservationSchema.safeParse(samples[0].entryObservation.features).success).toBe(true);
    expect(adaptiveStateSchema.safeParse(restore(ledger.adaptive)).success).toBe(true);
    expect(() => assertPaperStrategyLedger(restore(ledger))).not.toThrow();
    const frozen = restore(ledger), expanded = selectPaperAdaptiveState(ledger.adaptive, samples, '2026-09-18T05:00:00Z');
    expect(expanded.candidates).toHaveLength(Object.keys(PAPER_FEATURES).length);
    expect(expanded.evaluatedAt).toBe('2026-09-18T05:00:00Z');
    expect(expanded.discovery).toEqual(ledger.adaptive!.discovery);
    expect(expanded.candidates.filter(item => newKeys.includes(item.rule.feature as PaperFeatureKey))
      .every(item => !item.active && item.training.sampleCount === 0 && item.reason === 'MISSING_INPUT')).toBe(true);
    expect(selectPaperAdaptiveState(restore(expanded), [], '2026-09-18T06:00:00Z')).toEqual(expanded);
    expect(ledger).toEqual(frozen);
    expect(ledger.trades[0].entryDecision).toEqual(before.entryDecision);
    expect(newKeys.every(key => samples.every(sample => !(key in sample.entryObservation.features!.values)))).toBe(true);
    expect(adaptiveStateSchema.safeParse(expanded).success).toBe(true);
    const incomplete = restore(expanded); incomplete.candidates.pop();
    expect(adaptiveStateSchema.safeParse(incomplete).success).toBe(false);
  });

  it('learns a new feature independently once its actual recorded outcomes become usable', () => {
    const samples = matureAdaptiveSamples({ features: selected => ({ return5: selected ? -5 : 5, rsi14: null }) });
    const state = select(samples), selected = state.candidates.find(item => item.rule.feature === 'return5')!;
    expect(selected).toMatchObject({ active: true, rule: { feature: 'return5', bucket: 0 }, reason: 'ACTIVE' });
    expect(state.candidates.filter(item => item.active)).toHaveLength(1);
    expect(state.discovery!.inventions).toHaveLength(0);
    const observation = adaptiveTestSnapshot().observations[0];
    expect(adaptiveFeatureValue(observation, 'return5', asOf)).toBeNull();
    observation.features!.values.return5 = -5;
    expect(adaptiveRuleMatches(observation, selected.rule, asOf)).toBe(true);
  });

  it('lets invented D1 formulas validate on later D1 outcomes and preserves discovery budgets during same-day migration', () => {
    const interaction = (startDate: string, entryDateCount: number) => {
      const samples = matureAdaptiveSamples({ startDate, entryDateCount, selectedReturns: [3, 60, 100] });
      for (const sample of samples) {
        const index = Number(sample.symbol.at(-1));
        sample.entryObservation.features!.values.rsi14 = index % 4 < 2 ? 20 : 80;
        sample.entryObservation.features!.values.volumeRatio20 = [0, 1, 6, 7].includes(index) ? 0.25 : 1.75;
      }
      return samples;
    };
    const initial = interaction('2026-09-21', 8);
    const discovered = selectPaperAdaptiveState(undefined, initial, '2026-10-03T01:00:00Z');
    expect(discovered.discovery!.inventions).toHaveLength(1);
    expect(discovered.discovery!.inventions[0].rule.horizon).toBe(1);
    const old = structuredClone(discovered); delete old.policy.maturityModel;
    const migrated = selectPaperAdaptiveState(old, initial, '2026-10-03T02:00:00Z');
    expect(migrated.discovery).toEqual(discovered.discovery);
    expect(migrated.changes).toEqual(discovered.changes);
    const later = interaction('2026-10-06', 4);
    for (const sample of later) sample.outcomes = sample.outcomes.filter(item => item.horizon === 1);
    const connected = selectPaperAdaptiveState(migrated, [...initial, ...later], '2026-10-13T01:00:00Z');
    const invented = connected.candidates.find(item => item.rule.feature === discovered.discovery!.inventions[0].id)!;
    expect(invented).toMatchObject({ active: true, rule: { horizon: 1 }, validation: { sampleCount: 12, dateCount: 3 } });
    expect(invented.validation.experimentIds!.every(id => later.some(row => row.id === id))).toBe(true);
    expect(invented.rule.invention).toEqual(discovered.discovery!.inventions[0]);
  });

  it('freezes the daily choice across later scans and JSON restart, then reevaluates next day', () => {
    const samples = matureAdaptiveSamples(), saved = restore(select(samples));
    const negative = matureAdaptiveSamples({ selectedReturns: [-1, -9, -10] });
    const sameDay = selectPaperAdaptiveState(saved, negative, '2026-09-18T05:00:00Z');
    expect(sameDay).toEqual(saved); expect(sameDay).not.toBe(saved);
    const nextDate = addBusinessDaysFromKstDate(saved.tradingDate, 1);
    expect(rsi(selectPaperAdaptiveState(saved, negative, `${nextDate}T01:00:00Z`)).active).toBe(false);
    expect(() => selectPaperAdaptiveState(saved, samples, '2026-09-17T01:00:00Z')).toThrow('과거 스냅샷');
  });

  it('retires deteriorating performance and autonomously reconnects after new recovery evidence', () => {
    const initial = matureAdaptiveSamples(), active = select(initial);
    const declining = matureAdaptiveSamples({ startDate: addBusinessDaysFromKstDate(initial.at(-1)!.tradingDate, 1),
      entryDateCount: 20, selectedReturns: [-1, -9, -10] });
    const declineDate = addBusinessDaysFromKstDate(declining.at(-1)!.tradingDate, 6);
    const retired = selectPaperAdaptiveState(active, [...initial, ...declining], `${declineDate}T01:00:00Z`);
    expect(rsi(retired)).toMatchObject({ active: false, reason: 'NO_VALIDATION_EDGE' });
    expect(retired.changes.at(-1)).toMatchObject({ feature: 'rsi14', from: rsi(active).rule, to: null });
    const recovery = matureAdaptiveSamples({ startDate: addBusinessDaysFromKstDate(declining.at(-1)!.tradingDate, 1), entryDateCount: 60 });
    const recoveredDate = addBusinessDaysFromKstDate(recovery.at(-1)!.tradingDate, 6);
    const recovered = selectPaperAdaptiveState(retired, [...initial, ...declining, ...recovery], `${recoveredDate}T01:00:00Z`);
    expect(recovered.matureDateCount).toBe(60);
    expect(recovered.windowStartDate).toBe(recovery[0].tradingDate);
    expect(rsi(recovered)).toMatchObject({ active: true, reason: 'ACTIVE', rule: rsi(active).rule });
    expect(recovered.changes.at(-1)).toMatchObject({ feature: 'rsi14', from: null, to: rsi(active).rule });
  });

  it('treats missing, stale and future feature snapshots as unavailable instead of numeric zero', () => {
    const state = select(), rule = rsi(state).rule;
    for (const problem of ['missing', 'null', 'stale', 'future'] as const) {
      const snapshot = adaptiveTestSnapshot(), observation = snapshot.observations[0];
      if (problem === 'missing') delete observation.features;
      if (problem === 'null') observation.features!.values.rsi14 = null;
      if (problem === 'stale') observation.features!.asOf = '2026-09-17T01:00:00Z';
      if (problem === 'future') observation.features!.asOf = '2026-09-18T02:00:00Z';
      expect(adaptiveFeatureValue(observation, 'rsi14', asOf)).toBeNull();
      expect(adaptiveRuleMatches(observation, rule, asOf)).toBe(false);
      const ledger = evaluatePaperStrategyScan(emptyStrategyLedger(), snapshot, strategyTestCost, state);
      expect(ledger.trades).toHaveLength(0);
      expect(ledger.latestDecisions[0].reasonCode).toBe('ADAPTIVE_FEATURE_UNAVAILABLE');
    }
    const zero = adaptiveTestSnapshot().observations[0]; zero.features!.values.rsi14 = 0;
    expect(adaptiveFeatureValue(zero, 'rsi14', asOf)).toBe(0);
    expect(adaptiveRuleMatches(zero, rule, asOf)).toBe(true);
  });
});

describe('autonomous Shadow lifecycle and persistence', () => {
  it('deduplicates overlapping active indicators and repeated observations into one trade', () => {
    const samples = matureAdaptiveSamples({ features: selected => ({ volumeRatio20: selected ? 3 : 1, ma20Gap: selected ? 8 : 2 }) });
    const state = select(samples), snapshot = adaptiveTestSnapshot();
    expect(state.candidates.filter(item => item.active)).toHaveLength(3);
    Object.assign(snapshot.observations[0].features!.values, { volumeRatio20: 3, ma20Gap: 8 });
    snapshot.observations.push(structuredClone(snapshot.observations[0]));
    const ledger = evaluatePaperStrategyScan(emptyStrategyLedger(), snapshot, strategyTestCost, state);
    expect(ledger.trades).toHaveLength(1); expect(ledger.latestDecisions).toHaveLength(1);
    const next = evaluatePaperStrategyScan(restore(ledger), snapshot, strategyTestCost, restore(state));
    expect(next.trades).toEqual(ledger.trades);
    expect(next.latestDecisions[0].action).toBe('HOLD');
  });

  it('preserves committed exit and frozen entry evidence when the rule is disconnected', () => {
    const ledger = enter(), snapshot = snapshotOn('2026-09-21');
    ledger.trades[0].policy.exitModel = 'SCHEDULED_CLOSE';
    delete ledger.trades[0].exitPolicy; delete ledger.trades[0].exitResearch;
    const disconnected = selectPaperAdaptiveState(ledger.adaptive, [], snapshot.asOf);
    expect(disconnected.candidates.some(item => item.active)).toBe(false);
    const held = evaluatePaperStrategyScan(restore(ledger), snapshot, strategyTestCost, disconnected);
    expect(held.trades[0]).toEqual(ledger.trades[0]);
    expect(held.latestDecisions[0]).toMatchObject({ action: 'HOLD', reasonCode: 'HORIZON_PENDING' });
    const exitSnapshot = snapshotOn('2026-09-23'); exitSnapshot.asOf = '2026-09-23T07:00:00Z'; exitSnapshot.marketOpen = false;
    exitSnapshot.observations[0].dailyCloses = [{ tradingDate: '2026-09-23', close: 11000, availableAt: exitSnapshot.asOf }];
    const closed = evaluatePaperStrategyScan(held, exitSnapshot, strategyTestCost, selectPaperAdaptiveState(disconnected, [], exitSnapshot.asOf));
    expect(closed.trades[0].exit).toMatchObject({ price: 11000, effectiveAt: '2026-09-23T06:30:00.000Z', netPnl: 1000 });
    expect(closed.trades[0].exit!.decision.adaptiveEvidence).toEqual(ledger.trades[0].entryDecision.adaptiveEvidence);
    expect(() => assertPaperStrategyLedger(restore(closed))).not.toThrow();
  });

  it('roundtrips adaptive and legacy ledgers and allows existing legacy trades to finish after switching', () => {
    const legacy = legacyStrategyLedger();
    const switched = evaluatePaperStrategyScan(restore(legacy), adaptiveTestSnapshot(), strategyTestCost, select());
    for (const ledger of [emptyStrategyLedger(), enter(), legacy, switched]) {
      expect(() => assertPaperStrategyLedger(restore(ledger))).not.toThrow();
    }
    expect(switched.trades[0]).toEqual(legacy.trades[0]);
    expect(switched.latestDecisions[0].action).toBe('HOLD');
  });

  const tampering: Array<[string, (ledger: PaperStrategyLedger) => void]> = [
    ['invalid rule bucket', ledger => { ledger.trades[0].entryDecision.adaptiveEvidence!.candidate.rule.bucket = 99; }],
    ['future feature snapshot', ledger => { ledger.trades[0].entryObservation.features!.asOf = '2026-09-18T02:00:00Z'; }],
    ['entry feature outside chosen bucket', ledger => { ledger.trades[0].entryObservation.features!.values.rsi14 = 60; }],
    ['changed holding horizon', ledger => { ledger.trades[0].entryDecision.adaptiveEvidence!.candidate.rule.horizon = 5; }],
    ['overlapping train and validation IDs', ledger => {
      const item = ledger.trades[0].entryDecision.adaptiveEvidence!.candidate;
      item.validation.experimentIds![0] = item.training.experimentIds![0];
    }],
    ['negative activation evidence', ledger => { ledger.trades[0].entryDecision.adaptiveEvidence!.candidate.validation.meanDailyExcessPct = -1; }],
    ['wrong state cutoff', ledger => { ledger.adaptive!.cutoffAt = ledger.adaptive!.evaluatedAt; }],
    ['duplicate state candidate', ledger => { ledger.adaptive!.candidates[1] = structuredClone(ledger.adaptive!.candidates[0]); }],
    ['future decision evidence', ledger => { ledger.trades[0].entryDecision.adaptiveEvidence!.evaluatedAt = '2026-09-18T02:00:00Z'; }],
  ];
  it.each(tampering)('rejects persisted %s', (_, mutate) => {
    const ledger = restore(enter()); mutate(ledger);
    expect(() => assertPaperStrategyLedger(ledger)).toThrow('PAPER_STRATEGY_INVALID');
  });
});

describe('stock-shuffled chance check', () => {
  it('repeats validation on shuffled returns once per evaluation day without changing the choice', () => {
    const samples = matureAdaptiveSamples(), state = select(samples);
    expect(rsi(state)).toMatchObject({ active: true, reason: 'ACTIVE' });
    expect(state.placebo).toMatchObject({ version: 'symbol-permutation-v1', permutations: PAPER_PLACEBO_PERMUTATIONS, passedCount: 1 });
    expect(state.placebo!.rules).toEqual([{ feature: 'rsi14', bucket: 0, horizon: 3, chancePct: expect.any(Number) }]);
    // A cyclic pairing always hands at least one strong-range stock a control return, so no shuffle can match the real edge.
    expect(state.placebo!.rules[0].chancePct).toBeLessThanOrEqual(10);
    expect(select(samples)).toEqual(state);
    expect(adaptiveStateSchema.safeParse(restore(state)).success).toBe(true);
    const sameDay = selectPaperAdaptiveState(restore(state), matureAdaptiveSamples({ selectedReturns: [-1, -9, -10] }), '2026-09-18T05:00:00Z');
    expect(sameDay.placebo).toEqual(state.placebo);
  });

  it('reports chance level when nothing passes and waits for a validation period', () => {
    expect(select(matureAdaptiveSamples({ selectedReturns: [0, 0, 0] })).placebo).toMatchObject({
      passedCount: 0, shuffledMeanPassedCount: 0, shuffledHighPassedCount: 0, chancePct: 100, rules: [] });
    expect(selectPaperAdaptiveState(undefined, [], asOf).placebo).toBeUndefined();
  });

  it('pairs every row with a same-date, same-market donor when the universe changes by date', () => {
    const row = (tradingDate: string, symbol: string, market: 'KOSPI' | 'KOSDAQ' = 'KOSPI') =>
      ({ experiment: { tradingDate, symbol, entryObservation: { market } } }) as Parameters<typeof paperPlaceboDonors>[0][number];
    const rows = [row('2026-09-01', 'A'), row('2026-09-01', 'B'), row('2026-09-01', 'C'), row('2026-09-01', 'K', 'KOSDAQ'),
      row('2026-09-02', 'A'), row('2026-09-02', 'B'), row('2026-09-02', 'D'), row('2026-09-02', 'E')];
    const donors = paperPlaceboDonors(rows, new Map([['A', 0], ['B', 1], ['C', 2], ['D', 3], ['E', 4], ['K', 5]]));
    const pair = (index: number) => `${rows[index].experiment.symbol}<-${donors[index].experiment.symbol}`;
    expect(rows.map((_, index) => pair(index))).toEqual(['A<-B', 'B<-C', 'C<-A', 'K<-K', 'A<-B', 'B<-D', 'D<-E', 'E<-A']);
    expect(donors.every((donor, index) => donor.experiment.tradingDate === rows[index].experiment.tradingDate
      && donor.experiment.entryObservation.market === rows[index].experiment.entryObservation.market)).toBe(true);
  });

  it('rejects a persisted chance check whose rules disagree with its count', () => {
    const state = restore(select());
    state.placebo!.passedCount = 2;
    expect(adaptiveStateSchema.safeParse(state).success).toBe(false);
  });
});
