// @responsibility Verify invented indicators use frozen discovery and genuinely later observations.
import { describe, expect, it } from 'vitest';
import type { PaperAdaptiveState, PaperIndicatorInvention } from '../../../src/types/paperAdaptive.js';
import { PAPER_FEATURES, type PaperFeatureKey } from '../../../src/types/paperObservationFeatures.js';
import { paperIndicatorFormulaId } from '../../../src/types/paperIndicatorFormula.js';
import { addBusinessDaysFromKstDate } from '../krxHolidays.js';
import { adaptiveFeatureValue, adaptiveRuleMatches, selectPaperAdaptiveState } from './paperAdaptiveSelection.js';
import { adaptiveTestSnapshot, matureAdaptiveSamples, type AdaptiveSampleOptions } from './paperAdaptiveFixtures.js';
import { discoverPaperIndicators, paperIndicatorFormulaUniverse } from './paperIndicatorDiscovery.js';
import { evaluatePaperStrategyScan } from './paperStrategyPolicy.js';
import { assertPaperStrategyLedger } from './paperStrategyValidation.js';
import { emptyStrategyLedger, strategyTestCost } from './paperStrategyFixtures.js';

const asOf = '2026-09-18T01:00:00Z';
function interactionSamples(options: AdaptiveSampleOptions = {}) {
  const rows = matureAdaptiveSamples(options);
  for (const row of rows) {
    const index = Number(row.symbol.slice(-1));
    row.entryObservation.features!.values.rsi14 = index % 4 < 2 ? 20 : 80;
    row.entryObservation.features!.values.volumeRatio20 = [0, 1, 6, 7].includes(index) ? 0.25 : 1.75;
  }
  return rows;
}
const select = () => selectPaperAdaptiveState(undefined, interactionSamples(), asOf);
const inventions = (state: PaperAdaptiveState) => state.candidates.filter(item => item.rule.invention);
const afterMaturity = (rows: ReturnType<typeof interactionSamples>) => `${addBusinessDaysFromKstDate(rows.at(-1)!.tradingDate, 6)}T01:00:00Z`;

describe('autonomous indicator invention', () => {
  it('deterministically searches a finite canonical grammar and freezes training-only inventions', () => {
    const universe = paperIndicatorFormulaUniverse();
    expect(universe).toHaveLength(975);
    expect(new Set(universe.map(paperIndicatorFormulaId)).size).toBe(975);
    expect(universe.every(item => item.left.feature < item.right.feature)).toBe(true);
    const state = select();
    expect(state).toEqual(selectPaperAdaptiveState(undefined, interactionSamples().reverse(), asOf));
    expect(state.discovery!.attemptedIds).toHaveLength(3);
    expect(state.discovery!.inventions).toHaveLength(2);
    expect(state.candidates.filter(item => item.active)).toHaveLength(0);
    for (const item of inventions(state)) {
      expect(item).toMatchObject({ active: false, reason: 'FORWARD_OBSERVATION', validation: { sampleCount: 0 },
        rule: { invention: { createdAt: asOf, discoveryCutoffAt: state.cutoffAt } } });
      expect(item.training).toEqual(item.rule.invention!.training);
      expect(item.training.meanDailyExcessPct).toBeGreaterThan(0);
    }
    expect(state.changes.every(item => item.reason === 'FORWARD_OBSERVATION')).toBe(true);
  });

  it('does not rename a standalone indicator or a constant second input as a new invention', () => {
    for (const features of [
      (selected: boolean) => ({ volumeRatio20: selected ? 3 : 1 }),
      () => ({ volumeRatio20: 1 }),
    ]) {
      const state = selectPaperAdaptiveState(undefined, matureAdaptiveSamples({ features }), asOf);
      expect(state.discovery!.inventions).toHaveLength(0);
      expect(state.discovery!.attemptedIds).toHaveLength(3);
    }
  });

  it('never activates from historical validation or entries later on its creation date', () => {
    const state = select(), sameDate = interactionSamples({ startDate: '2026-09-18', entryDateCount: 1 });
    for (const row of sameDate) {
      row.entryAt = '2026-09-18T02:00:00Z'; row.entryObservation.observedAt = row.entryAt;
      row.entryObservation.features!.asOf = row.entryAt;
    }
    const updated = selectPaperAdaptiveState(state, [...interactionSamples(), ...sameDate], afterMaturity(sameDate));
    expect(inventions(updated).every(item => !item.active && item.validation.sampleCount === 0)).toBe(true);
    expect(updated.discovery!.inventions).toEqual(state.discovery!.inventions);
    expect(selectPaperAdaptiveState(JSON.parse(JSON.stringify(state)), [], '2026-09-18T05:00:00Z')).toEqual(state);
  });

  it('connects only after sufficient later results then disconnects on deteriorating forward performance', () => {
    const state = select(), later = interactionSamples({ startDate: '2026-09-21', entryDateCount: 8 });
    const connected = selectPaperAdaptiveState(state, [...interactionSamples(), ...later], afterMaturity(later));
    expect(inventions(connected).every(item => item.active)).toBe(true);
    for (const item of inventions(connected)) {
      expect(item.training).toEqual(state.discovery!.inventions.find(definition => definition.id === item.rule.feature)!.training);
      expect(item.validation.experimentIds!.every(id => later.some(row => row.id === id))).toBe(true);
    }
    const negative = interactionSamples({ startDate: addBusinessDaysFromKstDate(later.at(-1)!.tradingDate, 1),
      entryDateCount: 60, selectedReturns: [-1, -9, -10] });
    const disconnected = selectPaperAdaptiveState(connected, [...interactionSamples(), ...later, ...negative], afterMaturity(negative));
    expect(inventions(disconnected).filter(item => state.discovery!.inventions.some(definition => definition.id === item.rule.feature))
      .every(item => !item.active && item.reason === 'NO_VALIDATION_EDGE')).toBe(true);
  });

  it('buys with the invented formula and preserves it through disconnection and scheduled exit', () => {
    const state = select(), later = interactionSamples({ startDate: '2026-09-21', entryDateCount: 8 });
    const connected = selectPaperAdaptiveState(state, [...interactionSamples(), ...later], afterMaturity(later));
    const snapshot = adaptiveTestSnapshot();
    snapshot.asOf = connected.evaluatedAt; snapshot.tradingDate = connected.tradingDate;
    snapshot.observations[0].observedAt = snapshot.asOf; snapshot.observations[0].features!.asOf = snapshot.asOf;
    snapshot.observations[0].features!.values.volumeRatio20 = 0.25;
    const ledger = evaluatePaperStrategyScan(emptyStrategyLedger(), snapshot, strategyTestCost, connected);
    expect(ledger.trades).toHaveLength(1);
    expect(ledger.trades[0].entryDecision.adaptiveEvidence!.candidate.rule.invention).toBeDefined();
    expect(() => assertPaperStrategyLedger(JSON.parse(JSON.stringify(ledger)))).not.toThrow();
    const exit = structuredClone(snapshot), trade = ledger.trades[0];
    exit.tradingDate = trade.scheduledExitDate; exit.asOf = `${trade.scheduledExitDate}T07:00:00Z`; exit.marketOpen = false;
    exit.observations[0].dailyCloses = [{ tradingDate: trade.scheduledExitDate, close: 11000, availableAt: exit.asOf }];
    const disconnected = selectPaperAdaptiveState(connected, [], exit.asOf);
    const closed = evaluatePaperStrategyScan(ledger, exit, strategyTestCost, disconnected);
    expect(closed.trades[0].status).toBe('CLOSED');
    expect(closed.trades[0].exit!.decision.adaptiveEvidence).toEqual(trade.entryDecision.adaptiveEvidence);
    expect(() => assertPaperStrategyLedger(JSON.parse(JSON.stringify(closed)))).not.toThrow();
  });

  it('excludes missing operands from both forward selection and controls, and waits on unavailable current inputs', () => {
    const state = select(), later = interactionSamples({ startDate: '2026-09-21', entryDateCount: 4 });
    for (const row of later) if (Number(row.symbol.slice(-1)) >= 4) row.entryObservation.features!.values.volumeRatio20 = null;
    const updated = selectPaperAdaptiveState(state, [...interactionSamples(), ...later], afterMaturity(later));
    expect(inventions(updated).every(item => !item.active && item.validation.meanDailyExcessPct === 0)).toBe(true);
    const snapshot = adaptiveTestSnapshot(), rule = inventions(state)[0].rule;
    expect(adaptiveFeatureValue(snapshot.observations[0], rule.feature, snapshot.asOf, rule.invention)).toBeNull();
    expect(adaptiveRuleMatches(snapshot.observations[0], rule, snapshot.asOf)).toBe(false);
  });

  it('inspects at most24 formulas per day and proposes at most2 definitions', () => {
    const rows = interactionSamples();
    for (const row of rows) for (const key of Object.keys(PAPER_FEATURES) as PaperFeatureKey[]) {
      if (row.entryObservation.features!.values[key] === null) row.entryObservation.features!.values[key] = Number(row.symbol.slice(-1));
    }
    const first = selectPaperAdaptiveState(undefined, rows, asOf);
    expect(first.discovery!.attemptedIds).toHaveLength(24);
    expect(first.discovery!.inventions.length).toBeLessThanOrEqual(2);
    const second = selectPaperAdaptiveState(first, rows, '2026-09-19T01:00:00Z');
    expect(second.discovery!.attemptedIds).toHaveLength(48);
    expect(new Set(second.discovery!.attemptedIds).size).toBe(48);
    expect(second.discovery!.inventions.length).toBeLessThanOrEqual(4);
  });
});

describe('bounded continuing invention research', () => {
  function run(state: PaperAdaptiveState, dateCount: number, inputs: Partial<Parameters<typeof discoverPaperIndicators>[0]> = {}) {
    return discoverPaperIndicators({ previous: state, asOf: '2026-12-01T01:00:00Z', cutoffAt: '2026-11-30T15:00:00Z',
      candidates: state.candidates, trainingDates: Array.from({ length: dateCount }, (_, index) => addBusinessDaysFromKstDate('2026-09-21', index)),
      sufficientInputs: () => true, evaluateTraining: () => null, forwardDateCount: () => 0, ...inputs });
  }

  it('keeps a full registry awaiting forward samples, and retires only aged inactive definitions', () => {
    const state = select(), prototype = state.discovery!.inventions[0];
    state.discovery!.inventions = paperIndicatorFormulaUniverse().slice(0, 24).map(formula => ({ ...structuredClone(prototype),
      id: paperIndicatorFormulaId(formula), formula }));
    state.candidates = state.discovery!.inventions.map(invention => ({ rule: { feature: invention.id, ...invention.rule, invention },
      training: invention.training, validation: { ...invention.training }, active: false, reason: 'FORWARD_OBSERVATION' }));
    const waiting = run(state, 20);
    expect(waiting.discovery.inventions).toHaveLength(24); expect(waiting.retired).toHaveLength(0);
    expect(waiting.discovery.attemptedIds).toEqual(state.discovery!.attemptedIds);
    state.candidates[0].active = true; state.candidates[0].reason = 'ACTIVE';
    const aged = run(state, 20, { forwardDateCount: () => 20 });
    expect(aged.retired).toHaveLength(2);
    expect(aged.retired.map(item => item.id)).not.toContain(state.candidates[0].rule.feature);
    expect(aged.discovery.inventions).toHaveLength(22);
  });

  it('starts a fresh research round only after20 new training dates and keeps retained formulas frozen', () => {
    const state = select();
    state.discovery!.attemptedIds = paperIndicatorFormulaUniverse().map(paperIndicatorFormulaId);
    state.discovery!.roundTrainingEndDate = '2026-09-18';
    expect(run(state, 19).discovery.round).toBe(1);
    const next = run(state, 20);
    expect(next.discovery.round).toBe(2);
    expect(next.discovery.attemptedIds).toHaveLength(24);
    expect(next.discovery.inventions).toEqual(state.discovery!.inventions);
    expect(next.discovery.roundTrainingEndDate).toBe(addBusinessDaysFromKstDate('2026-09-21', 19));
    expect(next.discovery.attemptedIds.some(id => state.discovery!.inventions.some((item: PaperIndicatorInvention) => item.id === id))).toBe(false);
  });

  it('starts the first actual research date after an empty cold boot', () => {
    const empty = selectPaperAdaptiveState(undefined, [], '2026-07-01T01:00:00Z');
    expect(empty.discovery!.roundTrainingEndDate).toBeNull();
    const started = selectPaperAdaptiveState(empty, interactionSamples(), asOf);
    expect(started.discovery).toMatchObject({ round: 1, roundStartedAt: asOf });
    expect(started.discovery!.roundTrainingEndDate).not.toBeNull();
  });

  it('re-proposes an old formula in a fresh round with a new clock and no recycled forward validation', () => {
    const state = select(), originals = state.discovery!.inventions;
    state.discovery!.inventions = []; state.candidates = state.candidates.filter(item => !item.rule.invention);
    const fresh = interactionSamples({ startDate: '2026-09-21', entryDateCount: 60 });
    const updated = selectPaperAdaptiveState(state, [...interactionSamples(), ...fresh], afterMaturity(fresh));
    expect(updated.discovery!.round).toBe(2);
    expect(updated.discovery!.inventions.map(item => item.id)).toEqual(originals.map(item => item.id));
    expect(updated.discovery!.inventions.every(item => item.createdAt === updated.evaluatedAt)).toBe(true);
    expect(inventions(updated).every(item => !item.active && item.validation.sampleCount === 0)).toBe(true);
  });

  it('relearns failed formulas in a partial registry after reversal without recycling their old forward results', () => {
    const initial = interactionSamples(), state = select();
    const later = interactionSamples({ startDate: '2026-09-21', entryDateCount: 8 });
    const connected = selectPaperAdaptiveState(state, [...initial, ...later], afterMaturity(later));
    expect(inventions(connected).every(item => item.active)).toBe(true);
    const reversed = interactionSamples({ startDate: addBusinessDaysFromKstDate(later.at(-1)!.tradingDate, 1),
      entryDateCount: 80, selectedReturns: [-1, -9, -10], controlReturns: [1, 9, 10] });
    const samples = [...initial, ...later, ...reversed];
    const disconnected = selectPaperAdaptiveState(connected, samples, afterMaturity(reversed));
    expect(disconnected.discovery!.round).toBe(2);
    expect(disconnected.discovery!.inventions).toEqual(connected.discovery!.inventions);
    expect(inventions(disconnected).every(item => !item.active && item.reason === 'NO_VALIDATION_EDGE')).toBe(true);
    const nextDate = addBusinessDaysFromKstDate(disconnected.tradingDate, 1);
    const relearned = selectPaperAdaptiveState(disconnected, samples, `${nextDate}T01:00:00Z`);
    expect(relearned.discovery!.round).toBe(2);
    expect(relearned.discovery!.inventions).toHaveLength(2);
    for (const invention of relearned.discovery!.inventions) {
      const original = connected.discovery!.inventions.find(item => item.id === invention.id)!;
      expect(original).toBeDefined();
      expect(invention.createdAt).toBe(relearned.evaluatedAt);
      expect(invention.rule.bucket).not.toBe(original.rule.bucket);
      expect(invention.training.meanDailyExcessPct).toBeGreaterThan(0);
    }
    expect(inventions(relearned).every(item => !item.active && item.reason === 'FORWARD_OBSERVATION' && item.validation.sampleCount === 0)).toBe(true);
    expect(relearned.changes.slice(-4).map(item => item.reason)).toEqual(['DISCOVERY_RETIRED', 'DISCOVERY_RETIRED', 'FORWARD_OBSERVATION', 'FORWARD_OBSERVATION']);
    expect(selectPaperAdaptiveState(JSON.parse(JSON.stringify(relearned)), [], `${nextDate}T05:00:00Z`)).toEqual(relearned);
    expect(() => assertPaperStrategyLedger({ ...emptyStrategyLedger(), adaptive: relearned })).not.toThrow();
    const postBirth = interactionSamples({ startDate: addBusinessDaysFromKstDate(nextDate, 1), entryDateCount: 8,
      selectedReturns: [-1, -9, -10], controlReturns: [1, 9, 10] });
    const reconnected = selectPaperAdaptiveState(relearned, [...samples, ...postBirth], afterMaturity(postBirth));
    expect(inventions(reconnected).every(item => item.active && item.validation.experimentIds!.every(id => postBirth.some(row => row.id === id)))).toBe(true);
    expect(reconnected.discovery!.inventions).toEqual(relearned.discovery!.inventions);
  });

  it('renews research when every available formula is retained and keeps valid ranked-out definitions', () => {
    const state = select(), retainedIds = new Set(state.discovery!.inventions.map(item => item.id));
    state.discovery!.attemptedIds = []; state.discovery!.roundTrainingEndDate = '2026-09-18';
    for (const item of inventions(state)) item.reason = 'RANKED_OUT';
    const updated = run(state, 20, { sufficientInputs: formula => retainedIds.has(paperIndicatorFormulaId(formula)), forwardDateCount: () => 20 });
    expect(updated.discovery.round).toBe(2);
    expect(updated.discovery.inventions).toEqual(state.discovery!.inventions);
    expect(updated.retired).toHaveLength(0);
    expect(updated.discovery.attemptedIds).toHaveLength(0);
  });
});
