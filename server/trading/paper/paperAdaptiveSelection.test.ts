// @responsibility Verify dated autonomous selection, retirement, frozen entries, and persisted evidence integrity.
import { describe, expect, it } from 'vitest';
import type { PaperSnapshot } from '../../../src/types/paperExperiment.js';
import type { PaperAdaptiveState } from '../../../src/types/paperAdaptive.js';
import type { PaperStrategyLedger } from '../../../src/types/paperStrategy.js';
import { isKrxTradingDay } from '../../calendar/krxTradingCalendar.js';
import { addBusinessDaysFromKstDate } from '../krxHolidays.js';
import { adaptiveFeatureValue, adaptiveRuleMatches, selectPaperAdaptiveState } from './paperAdaptiveSelection.js';
import { adaptiveTestSnapshot, matureAdaptiveSamples } from './paperAdaptiveFixtures.js';
import { evaluatePaperStrategyScan } from './paperStrategyPolicy.js';
import { assertPaperStrategyLedger } from './paperStrategyValidation.js';
import { emptyStrategyLedger, matureStrategySamples, strategyTestCost, strategyTestSnapshot } from './paperStrategyFixtures.js';

const asOf = '2026-09-18T01:00:00Z';
const rsi = (state: PaperAdaptiveState) => state.candidates.find(item => item.rule.feature === 'rsi14')!;
const select = (samples = matureAdaptiveSamples()) => selectPaperAdaptiveState(undefined, samples, asOf);
const enter = (samples = matureAdaptiveSamples(), snapshot = adaptiveTestSnapshot()) =>
  evaluatePaperStrategyScan(emptyStrategyLedger(), samples, snapshot, strategyTestCost, [], selectPaperAdaptiveState(undefined, samples, snapshot.asOf));
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

  it('excludes future entries, duplicate symbol/dates, invalid costs and invalid outcome dates', () => {
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
    expect(select([...samples, duplicate, ...invalid])).toEqual(expected);
  });

  it('uses only outcomes available strictly before the evaluation-day cutoff', () => {
    const samples = matureAdaptiveSamples(), cutoffAt = select(samples).cutoffAt;
    samples[0].outcomes[2].availableAt = cutoffAt;
    samples[1].outcomes[2].availableAt = '2026-09-18T00:30:00Z';
    const state = select(samples);
    expect(state.matureSampleCount).toBe(254);
    expect(rsi(state).training.experimentIds).not.toContain(samples[0].id);
    expect(rsi(state).training.experimentIds).not.toContain(samples[1].id);
    samples[0].outcomes[2].availableAt = new Date(Date.parse(cutoffAt) - 1).toISOString();
    expect(select(samples).matureSampleCount).toBe(255);
  });

  it('purges training entries whose D5 outcome overlaps the validation period', () => {
    const samples = matureAdaptiveSamples(), state = select(samples), candidate = rsi(state);
    const boundary = Date.parse(`${state.validationStartDate}T00:00:00+09:00`);
    const training = samples.filter(item => candidate.training.experimentIds!.includes(item.id));
    const validation = samples.filter(item => candidate.validation.experimentIds!.includes(item.id));
    expect(training).toHaveLength(68);
    expect(validation).toHaveLength(40);
    expect(training.every(item => item.outcomes.every(outcome => Date.parse(outcome.availableAt) < boundary))).toBe(true);
    expect(validation.every(item => item.tradingDate >= state.validationStartDate!)).toBe(true);
    const overlap = samples.filter(item => item.tradingDate < state.validationStartDate!
      && item.outcomes.some(outcome => Date.parse(outcome.availableAt) >= boundary));
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
      const ledger = evaluatePaperStrategyScan(emptyStrategyLedger(), [], snapshot, strategyTestCost, [], state);
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
    const ledger = evaluatePaperStrategyScan(emptyStrategyLedger(), samples, snapshot, strategyTestCost, [], state);
    expect(ledger.trades).toHaveLength(1); expect(ledger.latestDecisions).toHaveLength(1);
    const next = evaluatePaperStrategyScan(restore(ledger), samples, snapshot, strategyTestCost, [], restore(state));
    expect(next.trades).toEqual(ledger.trades);
    expect(next.latestDecisions[0].action).toBe('HOLD');
  });

  it('preserves committed exit and frozen entry evidence when the rule is disconnected', () => {
    const ledger = enter(), snapshot = snapshotOn('2026-09-21');
    const disconnected = selectPaperAdaptiveState(ledger.adaptive, [], snapshot.asOf);
    expect(disconnected.candidates.some(item => item.active)).toBe(false);
    const held = evaluatePaperStrategyScan(restore(ledger), [], snapshot, strategyTestCost, [], disconnected);
    expect(held.trades[0]).toEqual(ledger.trades[0]);
    expect(held.latestDecisions[0]).toMatchObject({ action: 'HOLD', reasonCode: 'HORIZON_PENDING' });
    const exitSnapshot = snapshotOn('2026-09-23'); exitSnapshot.asOf = '2026-09-23T07:00:00Z'; exitSnapshot.marketOpen = false;
    exitSnapshot.observations[0].dailyCloses = [{ tradingDate: '2026-09-23', close: 11000, availableAt: exitSnapshot.asOf }];
    const closed = evaluatePaperStrategyScan(held, [], exitSnapshot, strategyTestCost, [], selectPaperAdaptiveState(disconnected, [], exitSnapshot.asOf));
    expect(closed.trades[0].exit).toMatchObject({ price: 11000, effectiveAt: '2026-09-23T06:30:00.000Z', netPnl: 1000 });
    expect(closed.trades[0].exit!.decision.adaptiveEvidence).toEqual(ledger.trades[0].entryDecision.adaptiveEvidence);
    expect(() => assertPaperStrategyLedger(restore(closed))).not.toThrow();
  });

  it('roundtrips adaptive and legacy ledgers and allows existing legacy trades to finish after switching', () => {
    const legacy = evaluatePaperStrategyScan(emptyStrategyLedger(), matureStrategySamples(), strategyTestSnapshot(), strategyTestCost);
    const switched = evaluatePaperStrategyScan(restore(legacy), matureAdaptiveSamples(), adaptiveTestSnapshot(), strategyTestCost, [], select());
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
