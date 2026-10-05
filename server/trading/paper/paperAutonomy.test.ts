// @responsibility Verify causal outcome-based Shadow allocation evidence.
import { describe, expect, it } from 'vitest';
import type { PaperAdaptiveCandidate, PaperAdaptiveStats } from '../../../src/types/paperAdaptive.js';
import type { PaperStrategyTrade } from '../../../src/types/paperStrategy.js';
import { PAPER_FEATURES, type PaperFeatureValues } from '../../../src/types/paperObservationFeatures.js';
import { paperAutonomyAssignment, paperAutonomyRuleKey } from '../../../src/types/paperAutonomy.js';
import { createPaperIndicatorFormula, paperIndicatorFormulaId } from '../../../src/types/paperIndicatorFormula.js';
import { buildPaperAutonomy } from './paperAutonomy.js';
import { strategyTestCost, strategyTestObservation } from './paperStrategyFixtures.js';
import { paperEvidenceDigest } from './paperStrategyEvidence.js';
import { addBusinessDaysFromKstDate } from '../krxHolidays.js';

const asOf = '2026-10-05T00:00:00Z';
const empty = (): PaperAdaptiveStats => ({ sampleCount: 0, dateCount: 0, symbolCount: 0,
  meanNetReturnPct: null, meanDailyExcessPct: null });
const candidate = (): PaperAdaptiveCandidate => ({ rule: { feature: 'rsi14', bucket: 0, horizon: 1 },
  active: false, reason: 'INSUFFICIENT_VALIDATION', training: empty(), validation: empty() });
function trade(date: string, index: number, net = 5, rule = candidate()): PaperStrategyTrade {
  const entryAt = `${date}T01:00:00Z`, exitAt = `${date}T06:00:00Z`, registeredAt = `${date}T00:59:00Z`;
  const symbol = String(100000 + index), id = `adaptive-features-v1:${date}:${symbol}`;
  const observation = { ...strategyTestObservation(entryAt), symbol, features: {
    version: 'observation-features-v1' as const, asOf: entryAt, technicalDate: date, financials: null,
    values: { ...Object.fromEntries(Object.keys(PAPER_FEATURES).map(key => [key, null])) as PaperFeatureValues,
      rsi14: 20, volumeRatio20: 1 } } };
  const policy = { version: 'adaptive-features-v1' as const, windowEntryDates: 60, trainingFraction: 0.7,
    minimumSamples: 10, minimumEntryDates: 3, activationMarginDailyPct: 0.05, replacementMarginDailyPct: 0.05, maxActiveRules: 3 };
  const decision: PaperStrategyTrade['entryDecision'] = { snapshotId: id, decisionAt: entryAt, symbol, name: observation.name,
    action: 'BUY', reasonCode: 'ADAPTIVE_EXPLORATION_SELECTED', reason: '탐색', cohort: null, evidence: null, tradeId: id,
    explorationEvidence: { cutoffAt: new Date(`${date}T00:00:00+09:00`).toISOString(), evaluatedAt: `${date}T00:30:00Z`,
      validationStartDate: null, trialId: `trial:${date}`, registeredAt, policy, candidate: structuredClone(rule) } };
  return { id, strategyVersion: policy.version, symbol, name: observation.name, status: 'CLOSED', entrySnapshotId: id,
    entryAt, tradingDate: date, entryPrice: 10000, quantity: 1, entryObservation: observation, entryDecision: decision,
    policy: { version: policy.version, newsLookbackHours: 72, minimumSamples: 10, minimumEntryDates: 3,
      horizonSelection: 'FORWARD_VALIDATED_FEATURE', exitModel: 'ADAPTIVE_OBSERVED' }, costModel: strategyTestCost(),
    horizon: rule.rule.horizon, scheduledExitAt: '2026-10-06T06:30:00Z', scheduledExitDate: '2026-10-06',
    exit: { model: 'ADAPTIVE_OBSERVED', snapshotId: `${id}:exit`, effectiveAt: exitAt, observedAt: exitAt, decisionAt: exitAt,
      price: 10000 * (1 + net / 100), grossReturnPct: net, netReturnPct: net, netPnl: net * 100,
      decision: { ...structuredClone(decision), snapshotId: `${id}:exit`, action: 'EXIT', reasonCode: 'ADAPTIVE_TRAILING_STOP', decisionAt: exitAt } } };
}
const cohort = (returns = [5, 5, 5]) => returns.flatMap((net, index) =>
  Array.from({ length: 4 }, (_, symbol) => trade(`2026-09-0${index + 1}`, symbol, net)));
const entry = (trades: PaperStrategyTrade[], rule = candidate()) => buildPaperAutonomy([rule], trades, undefined, asOf).entries[0];

describe('autonomous exploration evidence', () => {
  it.each([
    [[5, 5, 5], 'INCREASE', 3], [[-5, -5, -5], 'REDUCE', 1], [[-5, 2, 5], 'MAINTAIN', 2], [[0, 0, 0], 'MAINTAIN', 2],
  ] as const)('grades completed dated outcomes %s without removing any opportunity', (returns, reason, weight) => {
    const result = entry(cohort([...returns]));
    expect(result).toMatchObject({ reason, weight, stats: { totalCount: 12, closedCount: 12, pendingCount: 0, sampleCount: 12, dateCount: 3 } });
    expect(result.stats.tradeIdsDigest).toBe(paperEvidenceDigest(cohort([...returns]).map(row => row.id)));
  });

  it('does not grade recent winners while matching positions from the same entry dates remain pending', () => {
    const rows = cohort();
    for (const index of [0, 4, 8]) { rows[index].status = 'OPEN'; rows[index].exit = null; }
    expect(entry(rows)).toMatchObject({ reason: 'EXPLORE', weight: 2, stats: {
      totalCount: 12, closedCount: 9, pendingCount: 3, sampleCount: 0, dateCount: 0,
      meanNetReturnPct: 5, meanDateNetReturnPct: null, standardErrorPct: null } });
    rows[0] = trade('2026-09-01', 0);
    expect(entry(rows).stats).toMatchObject({ closedCount: 10, pendingCount: 2, sampleCount: 4, dateCount: 1, standardErrorPct: null });
  });

  it('requires both independent entry dates and a minimum number of completed trades', () => {
    expect(entry(Array.from({ length: 100 }, (_, index) => trade('2026-09-01', index))).reason).toBe('EXPLORE');
    expect(entry(cohort().filter((_, index) => index % 4 === 0))).toMatchObject({ reason: 'EXPLORE', stats: { sampleCount: 3, dateCount: 3 } });
  });

  it('balances dates instead of allowing a crowded winning day to determine the allocation', () => {
    const rows = [...Array.from({ length: 20 }, (_, index) => trade('2026-09-01', index, 10)),
      trade('2026-09-02', 0, -5), trade('2026-09-03', 0, -5)];
    const result = entry(rows);
    expect(result.stats.meanNetReturnPct).toBeCloseTo(190 / 22);
    expect(result.stats.meanDateNetReturnPct).toBe(0);
    expect(result.reason).toBe('MAINTAIN');
  });

  it('recomputes net outcomes from actual prices and frozen costs instead of trusting saved returns or training evidence', () => {
    const rows = cohort();
    for (const row of rows) {
      row.costModel = { ...strategyTestCost(), buyFeeRate: 0.1 };
      row.exit!.netReturnPct = 9999; row.exit!.netPnl = 9999;
      row.entryDecision.explorationEvidence!.candidate.training.meanNetReturnPct = 9999;
      row.entryDecision.explorationEvidence!.candidate.validation.meanNetReturnPct = 9999;
    }
    expect(entry(rows)).toMatchObject({ reason: 'REDUCE', weight: 1, stats: { meanNetReturnPct: -5 } });
  });

  it.each(['effectiveAt', 'observedAt', 'decisionAt'] as const)('does not use an exit whose %s reaches the daily cutoff', field => {
    const rows = cohort(); rows[0].exit![field] = '2026-10-04T15:00:00Z';
    expect(entry(rows).stats).toMatchObject({ totalCount: 12, closedCount: 11, pendingCount: 1, sampleCount: 8, dateCount: 2 });
  });

  it('keeps missing or invalid exits pending and ignores entries not yet available at midnight', () => {
    const rows = cohort(); rows[0].exit = null; rows[1].exit!.price = Number.NaN;
    rows.push(trade('2026-10-05', 0));
    expect(entry(rows).stats).toMatchObject({ totalCount: 12, closedCount: 10, pendingCount: 2, sampleCount: 8, dateCount: 2 });
  });

  it.each(['legacy', 'validated', 'wrong-rule', 'invalid-cost', 'future-entry-observation', 'provider-issue'] as const)(
    'ignores %s records as exploration evidence', problem => {
      const row = trade('2026-09-01', 0);
      if (problem === 'legacy') row.strategyVersion = 'news-trend-v2';
      if (problem === 'validated') row.entryDecision.reasonCode = 'ADAPTIVE_FEATURE_SELECTED';
      if (problem === 'wrong-rule') row.entryDecision.explorationEvidence!.candidate.rule.bucket = 3;
      if (problem === 'invalid-cost') row.costModel.buyFeeRate = -1;
      if (problem === 'future-entry-observation') row.entryObservation.observedAt = '2026-10-05T01:00:00Z';
      if (problem === 'provider-issue') row.entryObservation.issue = 'CURRENT_QUOTE_UNAVAILABLE';
      expect(entry([row]).stats).toMatchObject({ totalCount: 0, sampleCount: 0, meanNetReturnPct: null, tradeIdsDigest: paperEvidenceDigest([]) });
    });

  it('deduplicates trade identities deterministically and leaves conflicting results pending', () => {
    const rows = cohort(), duplicate = structuredClone(rows[0]);
    expect(entry([...rows, duplicate]).stats.totalCount).toBe(12);
    duplicate.exit!.price = 9000;
    const forward = entry([...rows, duplicate]), reversed = entry([...rows, duplicate].reverse());
    expect(forward).toEqual(reversed);
    expect(forward.stats).toMatchObject({ totalCount: 12, closedCount: 11, pendingCount: 1, sampleCount: 8 });
    const changed = candidate(); changed.rule.horizon = 3;
    expect(() => buildPaperAutonomy([candidate(), changed], [rows[0], trade('2026-09-01', 0, 5, changed)], undefined, asOf))
      .toThrow('conflicting trade rules');
  });

  it('separates identical formulas born in different discovery rounds', () => {
    const formula = createPaperIndicatorFormula('MEAN', 'rsi14', 'volumeRatio20'), feature = paperIndicatorFormulaId(formula);
    const old = candidate(); old.rule = { feature, bucket: 1, horizon: 1, invention: {
      id: feature, formula, createdAt: '2026-08-20T00:00:00Z', discoveryCutoffAt: '2026-08-19T15:00:00Z',
      rule: { bucket: 1, horizon: 1 }, training: empty() } };
    const current = structuredClone(old); current.rule.invention!.createdAt = '2026-09-20T00:00:00Z';
    const rows = [trade('2026-09-01', 0, 5, old), trade('2026-09-21', 0, -5, current)];
    const state = buildPaperAutonomy([old, current], rows, undefined, asOf);
    expect(new Set(state.entries.map(row => row.ruleKey)).size).toBe(2);
    expect(state.entries.map(row => row.stats.totalCount)).toEqual([1, 1]);
    expect(entry(rows, current).stats.meanNetReturnPct).toBe(-5);
  });

  it('does not mutate input or treat its own selections as new outcomes', () => {
    const candidates = [candidate()], rows = cohort(), first = buildPaperAutonomy(candidates, rows, undefined, asOf);
    first.entries[0].lastSelectedAt = '2026-10-04T00:00:00Z'; first.selectedRuleKeys = [paperAutonomyRuleKey(candidates[0].rule)];
    delete first.selectionHistory;
    const saved = JSON.stringify([candidates, rows, first]);
    const next = buildPaperAutonomy(candidates, [...rows].reverse(), first, asOf);
    expect(JSON.stringify([candidates, rows, first])).toBe(saved);
    expect(next.entries[0].lastSelectedAt).toBe('2026-10-04T00:00:00Z');
    expect(next.entries[0].stats).toEqual(first.entries[0].stats);
    expect(next.selectedRuleKeys).toEqual([]);
    expect(next.cutoffAt).toBe('2026-10-04T15:00:00.000Z');
    expect(() => buildPaperAutonomy(candidates, rows, first, 'invalid')).toThrow('evaluation time');
  });

  it('limits outcome learning to the latest 60 entry dates', () => {
    const rows = Array.from({ length: 61 }, (_, index) => trade(addBusinessDaysFromKstDate('2026-06-01', index), 0, index ? -5 : 100));
    const result = entry(rows);
    expect(result).toMatchObject({ reason: 'REDUCE', stats: { totalCount: 60, dateCount: 60, meanDateNetReturnPct: -5 } });
    expect(result.stats.tradeIdsDigest).toBe(paperEvidenceDigest(rows.slice(1).map(row => row.id)));
  });

  it('restores prior selection history when an absent rule returns without carrying future selection times', () => {
    const rule = candidate(), first = buildPaperAutonomy([rule], [], undefined, asOf), key = paperAutonomyRuleKey(rule.rule);
    first.selectionHistory = [{ ruleKey: key, selectedAt: '2026-10-02T00:00:00Z' },
      { ruleKey: 'rsi14:1:D1', selectedAt: '2026-10-05T00:01:00Z' }];
    const absent = buildPaperAutonomy([], [], first, asOf);
    expect(absent.entries).toEqual([]);
    expect(absent.selectionHistory).toEqual([{ ruleKey: key, selectedAt: '2026-10-02T00:00:00Z' }]);
    expect(buildPaperAutonomy([rule], [], absent, asOf).entries[0].lastSelectedAt).toBe('2026-10-02T00:00:00Z');
    expect(first.selectionHistory).toHaveLength(2);
  });
});

describe('deterministic allocation', () => {
  it('preserves equal-weight legacy selection and gives every nonzero option opportunities', () => {
    const counts = [0, 0, 0];
    for (let index = 0; index < 6000; index++) {
      const symbol = String(100000 + index), date = '2026-10-06';
      const legacyHash = [...`${symbol}:${date}`].reduce((hash, char) => Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0, 2166136261);
      expect(paperAutonomyAssignment(symbol, date, [2, 2, 2])).toBe(legacyHash % 3);
      counts[paperAutonomyAssignment(symbol, date, [1, 2, 3])]++;
    }
    expect(counts[0]).toBeGreaterThan(800); expect(counts[1]).toBeGreaterThan(1800); expect(counts[2]).toBeGreaterThan(2800);
    expect(counts[0]).toBeLessThan(counts[1]); expect(counts[1]).toBeLessThan(counts[2]);
    for (const weights of [[], [0], [4], [Number.NaN], [1.5]]) expect(() => paperAutonomyAssignment('005930', '2026-10-06', weights)).toThrow();
  });
});
