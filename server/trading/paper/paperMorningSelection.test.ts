// @responsibility Verify frozen morning recommendation selection boundaries.
import { describe, expect, it, vi } from 'vitest';
import type { PaperObservation } from '../../../src/types/paperExperiment.js';
import type { PaperMorningSource } from '../../../src/types/paperMorning.js';
import { createPaperIndicatorFormula, paperIndicatorFormulaId } from '../../../src/types/paperIndicatorFormula.js';
import { adaptiveTestSnapshot, matureAdaptiveSamples } from './paperAdaptiveFixtures.js';
import { selectPaperAdaptiveState } from './paperAdaptiveSelection.js';
import { buildPaperMorningSelection } from './paperMorningSelection.js';

const asOf = '2026-09-17T23:00:00Z', now = new Date('2026-09-17T23:30:00Z');
function observation(symbol = '005930'): PaperObservation {
  const value = adaptiveTestSnapshot().observations[0];
  value.symbol = symbol; value.name = `종목 ${symbol}`; value.observedAt = asOf;
  value.features!.asOf = asOf; value.features!.technicalDate = '2026-09-17';
  value.features!.values.turnover20 = 50;
  value.dailyCloses = [{ tradingDate: '2026-09-17', close: 9800, availableAt: '2026-09-17T07:00:00Z' }];
  return value;
}
function source(): PaperMorningSource {
  return { version: 'morning-source-v1', snapshot: { ...adaptiveTestSnapshot(), id: 'morning-source', asOf,
    tradingDate: '2026-09-18', marketOpen: false, observations: [observation()] },
  adaptive: selectPaperAdaptiveState(undefined, matureAdaptiveSamples(), asOf), openSymbols: [] };
}
function trial(current: PaperMorningSource, registeredAt = '2026-09-17T22:30:00Z') {
  const candidate = structuredClone(current.adaptive.candidates.find(item => item.active)!);
  candidate.rule = { feature: 'per', bucket: 0, horizon: 1 }; candidate.active = false; candidate.reason = 'INSUFFICIENT_VALIDATION';
  candidate.training.meanDailyExcessPct = 99;
  candidate.validation = { sampleCount: 0, dateCount: 0, symbolCount: 0, meanNetReturnPct: null, meanDailyExcessPct: null };
  const value = { id: 'shadow-exploration-v1:2026-09-18:1:per:0:D1', registeredAt, candidate };
  current.adaptive.exploration = { version: 'shadow-exploration-v1', sequence: 1, rules: [value] };
  return value;
}

describe('08:30 frozen morning recommendations', () => {
  it('ranks three unique recommendations by their frozen rule evidence, turnover, then symbol', () => {
    const current = source();
    const stronger = current.adaptive.candidates.find(item => item.rule.feature === 'return20')!;
    const original = current.adaptive.candidates.find(item => item.active)!;
    Object.assign(stronger, { ...structuredClone(original), rule: { feature: 'return20', bucket: 0, horizon: 3 } });
    stronger.validation.meanDailyExcessPct = 5;
    current.snapshot.observations = ['000004', '000002', '000003', '000001'].map(observation);
    current.snapshot.observations[0].features!.values.turnover20 = 100;
    current.snapshot.observations[1].features!.values.turnover20 = 100;
    Object.assign(current.snapshot.observations[2].features!.values, { rsi14: 80, return20: -20, turnover20: 1 });
    current.snapshot.observations[3].features!.values.turnover20 = 10;
    const before = structuredClone(current), selection = buildPaperMorningSelection(current, now);
    expect(selection).toMatchObject({ version: 'morning-recommendation-v1', id: 'paper:recommendation:2026-09-18',
      scheduledAt: '2026-09-17T23:30:00.000Z', createdAt: now.toISOString(), status: 'READY', sourceSnapshotId: 'morning-source',
      sourceAsOf: asOf, adaptiveEvaluatedAt: asOf, adaptiveCutoffAt: '2026-09-17T15:00:00.000Z', consideredCount: 4, matchedCount: 4, heldCount: 0 });
    expect(selection.picks.map(item => [item.rank, item.symbol])).toEqual([[1, '000003'], [2, '000002'], [3, '000004']]);
    expect(selection.picks[0].referenceClose).toEqual(current.snapshot.observations[2].dailyCloses[0]);
    expect(selection.picks[0].candidate).toEqual(stronger);
    expect(current).toEqual(before);
    selection.picks[0].candidate.rule.bucket = 1; selection.picks[0].observation.price = 1;
    expect(current).toEqual(before);
    expect(buildPaperMorningSelection({ ...current, snapshot: { ...current.snapshot, observations: [...current.snapshot.observations].reverse() } }, now).picks
      .map(item => item.symbol)).toEqual(['000003', '000002', '000004']);
  });

  it('fills remaining places with labeled exploration without outranking validated picks', () => {
    const current = source(), pending = trial(current);
    current.snapshot.observations = ['000001', '000002', '000003'].map(observation);
    Object.assign(current.snapshot.observations[0].features!.values, { per: 5, turnover20: 1 });
    Object.assign(current.snapshot.observations[1].features!.values, { turnover20: 2 });
    Object.assign(current.snapshot.observations[2].features!.values, { rsi14: 80, per: 5, turnover20: 9999 });
    const result = buildPaperMorningSelection(current, now);
    expect(result.picks.map(item => [item.symbol, item.purpose])).toEqual([
      ['000002', 'VALIDATED'], ['000001', 'VALIDATED'], ['000003', 'EXPLORATION'],
    ]);
    expect(result.picks[2].trial).toEqual({ id: pending.id, registeredAt: pending.registeredAt });
    expect(result.reason).toContain('탐색 추천 1개(검증 전)');
    expect(result.picks[2].candidate.active).toBe(false);
  });

  it('clones only the final three picks while isolating shared rule evidence and reference closes', () => {
    const current = source(), original = current.adaptive.candidates.find(item => item.active)!;
    const stronger = structuredClone(original);
    stronger.rule = { feature: 'return20', bucket: 0, horizon: 3 };
    stronger.validation.meanDailyExcessPct = original.validation.meanDailyExcessPct! + 1;
    current.adaptive.candidates = [original, stronger];
    trial(current);
    current.snapshot.observations = Array.from({ length: 12 }, (_, index) => {
      const value = observation(String(index + 1).padStart(6, '0'));
      Object.assign(value.features!.values, { return20: -20, per: 5, turnover20: index });
      return value;
    });
    const before = structuredClone(current), clone = vi.spyOn(globalThis, 'structuredClone');
    let result: ReturnType<typeof buildPaperMorningSelection>;
    try {
      result = buildPaperMorningSelection(current, now);
      expect(clone).toHaveBeenCalledTimes(3);
    } finally {
      clone.mockRestore();
    }
    expect(result).toMatchObject({ status: 'READY', consideredCount: 12, matchedCount: 12 });
    expect(result.picks.map(item => [item.symbol, item.purpose, item.candidate.rule.feature])).toEqual([
      ['000012', 'VALIDATED', 'return20'], ['000011', 'VALIDATED', 'return20'], ['000010', 'VALIDATED', 'return20'],
    ]);
    result.picks[0].candidate.rule.bucket = 1;
    result.picks[0].observation.features!.values.return20 = 99;
    result.picks[0].referenceClose.close = 1;
    expect(result.picks[1].candidate).toEqual(stronger);
    expect(result.picks[1].observation.features!.values.return20).toBe(-20);
    expect(result.picks[0].observation.dailyCloses[0].close).toBe(9800);
    expect(current).toEqual(before);
  });

  it('permits autonomous exploration with no mature training instead of requiring validated entries', () => {
    const current = source();
    current.adaptive = selectPaperAdaptiveState(undefined, [], asOf, current.snapshot.observations);
    current.snapshot.asOf = '2026-09-17T23:05:00Z';
    current.snapshot.observations[0].observedAt = current.snapshot.asOf;
    current.snapshot.observations[0].features!.asOf = current.snapshot.asOf;
    const result = buildPaperMorningSelection(current, now);
    expect(result.status).toBe('READY');
    expect(result.picks).toHaveLength(1);
    expect(result.picks[0]).toMatchObject({ purpose: 'EXPLORATION', candidate: { active: false, reason: 'INSUFFICIENT_TRAINING',
      training: { sampleCount: 0, meanNetReturnPct: null }, validation: { sampleCount: 0 } } });
  });

  it('requires both quote and feature observations strictly after trial registration', () => {
    for (const field of ['quote', 'feature', 'future-registration'] as const) {
      const current = source();
      current.adaptive.candidates.forEach(item => { item.active = false; });
      const value = trial(source(), asOf);
      value.candidate.rule.feature = 'rsi14';
      current.adaptive.exploration = { version: 'shadow-exploration-v1', sequence: 1, rules: [value] };
      current.snapshot.asOf = '2026-09-17T23:10:00Z';
      current.snapshot.observations[0].observedAt = field === 'quote' ? asOf : current.snapshot.asOf;
      current.snapshot.observations[0].features!.asOf = field === 'feature' ? asOf : current.snapshot.asOf;
      if (field === 'future-registration') value.registeredAt = '2026-09-17T23:20:00Z';
      expect(buildPaperMorningSelection(current, now)).toMatchObject({ status: 'NO_MATCH', picks: [] });
    }
  });

  it('excludes held and ambiguous duplicate symbols while keeping independently valid observations', () => {
    const current = source();
    current.snapshot.observations = ['000001', '000001', '000002', '000003'].map(observation);
    current.openSymbols = ['000002'];
    const result = buildPaperMorningSelection(current, now);
    expect(result).toMatchObject({ consideredCount: 2, heldCount: 1, matchedCount: 1, status: 'READY' });
    expect(result.picks.map(item => item.symbol)).toEqual(['000003']);
    current.openSymbols.push('000003');
    expect(buildPaperMorningSelection(current, now)).toMatchObject({ status: 'NO_MATCH', picks: [], heldCount: 2 });
  });

  it('rejects sources outside the pre-scheduled 90-minute window or inconsistent daily research clocks', () => {
    const mutations: Array<(value: PaperMorningSource) => void> = [
      value => { value.snapshot.asOf = '2026-09-17T21:59:59Z'; },
      value => { value.snapshot.asOf = '2026-09-17T23:30:01Z'; },
      value => { value.snapshot.tradingDate = '2026-09-17'; },
      value => { value.snapshot.asOf = 'not-a-date'; },
      value => { value.adaptive.evaluatedAt = '2026-09-17T23:01:00Z'; },
      value => { value.adaptive.evaluatedAt = '2026-09-17T14:00:00Z'; },
      value => { value.adaptive.cutoffAt = '2026-09-17T23:10:00Z'; },
      value => { value.adaptive.tradingDate = '2026-09-17'; },
    ];
    for (const mutate of mutations) {
      const current = source(); mutate(current);
      expect(buildPaperMorningSelection(current, now)).toMatchObject({ status: 'DATA_UNAVAILABLE', picks: [],
        sourceSnapshotId: null, sourceAsOf: null, adaptiveEvaluatedAt: null, adaptiveCutoffAt: null });
    }
    expect(buildPaperMorningSelection(source(), new Date('2026-09-17T23:29:59Z')).status).toBe('DATA_UNAVAILABLE');
    expect(buildPaperMorningSelection(null, now).status).toBe('DATA_UNAVAILABLE');
  });

  it('requires exact prior-session technical data and a unique confirmed reference close', () => {
    const mutations: Array<(value: PaperObservation) => void> = [
      value => { value.price = Number.NaN; },
      value => { value.issue = 'CURRENT_QUOTE_STALE'; },
      value => { value.observedAt = '2026-09-17T23:01:00Z'; },
      value => { value.observedAt = '2026-09-17T01:00:00Z'; },
      value => { value.features!.asOf = '2026-09-17T23:01:00Z'; },
      value => { value.features!.technicalDate = '2026-09-16'; },
      value => { value.dailyCloses[0].tradingDate = '2026-09-16'; },
      value => { value.dailyCloses[0].availableAt = '2026-09-17T06:00:00Z'; },
      value => { value.dailyCloses[0].availableAt = '2026-09-17T23:01:00Z'; },
      value => { value.dailyCloses.push(structuredClone(value.dailyCloses[0])); },
      value => { delete value.features; },
    ];
    for (const mutate of mutations) {
      const current = source(); mutate(current.snapshot.observations[0]);
      expect(buildPaperMorningSelection(current, now)).toMatchObject({ status: 'DATA_UNAVAILABLE', picks: [],
        sourceSnapshotId: current.snapshot.id, consideredCount: 0 });
    }
  });

  it('freezes invented formulas without rewriting their training evidence or substituting another range', () => {
    const current = source(), candidate = structuredClone(current.adaptive.candidates.find(item => item.active)!);
    const formula = createPaperIndicatorFormula('DIFFERENCE', 'adx14', 'currentRatio'), id = paperIndicatorFormulaId(formula);
    candidate.rule = { feature: id, bucket: 0, horizon: 1, invention: { id, formula, createdAt: '2026-09-10T01:00:00Z',
      discoveryCutoffAt: '2026-09-09T15:00:00Z', rule: { bucket: 0, horizon: 1 }, training: structuredClone(candidate.training) } };
    current.adaptive.candidates = [candidate];
    Object.assign(current.snapshot.observations[0].features!.values, { adx14: 15, currentRatio: 250 });
    const result = buildPaperMorningSelection(current, now);
    expect(result.picks[0]).toMatchObject({ purpose: 'VALIDATED', ruleValue: -1.5, candidate: { rule: { feature: id, bucket: 0, horizon: 1 } } });
    expect(result.picks[0].candidate).toEqual(candidate);
    candidate.rule.invention!.createdAt = '2026-09-17T23:20:00Z';
    expect(buildPaperMorningSelection(current, now)).toMatchObject({ status: 'NO_MATCH', picks: [] });
    expect(result.picks[0].candidate.rule.invention!.createdAt).toBe('2026-09-10T01:00:00Z');
  });

  it('distinguishes honest no-match and holiday results instead of filling fabricated recommendations', () => {
    const current = source(); current.snapshot.observations[0].features!.values.rsi14 = 80;
    expect(buildPaperMorningSelection(current, now)).toMatchObject({ status: 'NO_MATCH', consideredCount: 1, matchedCount: 0, picks: [] });
    expect(buildPaperMorningSelection(current, new Date('2026-09-18T23:30:00Z'))).toMatchObject({
      status: 'HOLIDAY', tradingDate: '2026-09-19', sourceSnapshotId: null, picks: [],
    });
  });

  it('keeps missing turnover last without turning it into an extra eligibility gate', () => {
    const current = source();
    current.snapshot.observations = ['000001', '000002'].map(observation);
    current.snapshot.observations[0].features!.values.turnover20 = null;
    const result = buildPaperMorningSelection(current, now);
    expect(result.picks.map(item => item.symbol)).toEqual(['000002', '000001']);
    expect(result.matchedCount).toBe(2);
  });
});
