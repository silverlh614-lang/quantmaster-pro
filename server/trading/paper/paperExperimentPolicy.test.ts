// @responsibility Verify paper experiment accounting.
import { afterEach, describe, expect, it } from 'vitest';
import type { PaperObservation, PaperSnapshot } from '../../../src/types/paperExperiment.js';
import { computeNetPnL, resetExecutionCostOverride, setExecutionCostOverride } from '../executionCosts.js';
import { buildPaperExperimentView, capturePaperCostModel, createPaperExperiment, updatePaperOutcomes } from './paperExperimentPolicy.js';

const observation = (): PaperObservation => ({
  symbol: '005930', name: 'Samsung', price: 10000, observedAt: '2026-09-18T01:00:00Z',
  source: 'KIS_REST_REQUEST_OBSERVED', return1dPct: -20, return5dPct: -35, aboveMa20: false,
  news: [], dailyCloses: [],
});
const snapshot = (): PaperSnapshot => ({
  id: 'snapshot-1', asOf: '2026-09-18T01:01:00Z', tradingDate: '2026-09-18', marketOpen: true, observations: [],
});
const experiment = () => createPaperExperiment(snapshot(), observation(), capturePaperCostModel('KOSPI'))!;
afterEach(resetExecutionCostOverride);

describe('independent paper experiment policy', () => {
  it('opens one share without news, positive trends, or a sizing threshold', () => {
    expect(experiment()).toMatchObject({ quantity: 1, entryPrice: 10000, status: 'OPEN', outcomes: [] });
  });

  it('requires an observed finite price during the actual market session', () => {
    const cost = capturePaperCostModel('KOSPI');
    for (const price of [null, NaN, Infinity, 0, -1]) {
      expect(createPaperExperiment(snapshot(), { ...observation(), price }, cost)).toBeNull();
    }
    expect(createPaperExperiment({ ...snapshot(), marketOpen: false }, observation(), cost)).toBeNull();
    expect(createPaperExperiment(snapshot(), { ...observation(), observedAt: '2026-09-19T01:00:00Z' }, cost)).toBeNull();
  });

  it('copies entry features and excludes information unavailable at entry', () => {
    const input = observation();
    input.news = [
      { id: 'known', headline: 'known', observedAt: '2026-09-18T01:00:00Z', source: 'DART' },
      { id: 'future', headline: 'future', observedAt: '2026-09-18T02:00:00Z', source: 'DART' },
    ];
    input.dailyCloses = [{ tradingDate: '2026-09-18', close: 12000, availableAt: '2026-09-18T07:00:00Z' }];
    const cost = capturePaperCostModel('KOSPI');
    const saved = createPaperExperiment(snapshot(), input, cost)!;
    input.news[0].headline = 'mutated';
    cost.buyFeeRate = 1;
    expect(saved.entryObservation.news).toEqual([{ id: 'known', headline: 'known', observedAt: '2026-09-18T01:00:00Z', source: 'DART' }]);
    expect(saved.entryObservation.dailyCloses).toEqual([]);
    expect(saved.costModel.buyFeeRate).toBe(0.00015);
  });

  it('labels exact D1/D3/D5 across weekends and Chuseok holidays', () => {
    const input = observation();
    input.dailyCloses = [
      { tradingDate: '2026-09-21', close: 11000, availableAt: '2026-09-21T07:00:00Z' },
      { tradingDate: '2026-09-23', close: 12000, availableAt: '2026-09-23T07:00:00Z' },
      { tradingDate: '2026-09-29', close: 13000, availableAt: '2026-09-29T07:00:00Z' },
    ];
    const result = updatePaperOutcomes(experiment(), input, '2026-09-29T07:00:00Z');
    expect(result.outcomes.map((item) => [item.horizon, item.tradingDate])).toEqual([
      [1, '2026-09-21'], [3, '2026-09-23'], [5, '2026-09-29'],
    ]);
    expect(result.status).toBe('COMPLETED');
  });

  it('does not shift missing D1 to D2; D5 can mature with earlier gaps', () => {
    const input = observation();
    input.dailyCloses = [
      { tradingDate: '2026-09-22', close: 9000, availableAt: '2026-09-22T07:00:00Z' },
      { tradingDate: '2026-09-29', close: 11000, availableAt: '2026-09-29T07:00:00Z' },
    ];
    const result = updatePaperOutcomes(experiment(), input, '2026-09-29T07:00:00Z');
    expect(result.outcomes.map((item) => item.horizon)).toEqual([5]);
    expect(result.status).toBe('COMPLETED');
  });

  it('does not use future or intraday bars as completed closing prices', () => {
    const input = observation();
    input.dailyCloses = [{ tradingDate: '2026-09-21', close: 11000, availableAt: '2026-09-21T07:00:00Z' }];
    expect(updatePaperOutcomes(experiment(), input, '2026-09-21T06:00:00Z').outcomes).toEqual([]);
    input.dailyCloses[0].availableAt = '2026-09-21T06:00:00Z';
    expect(updatePaperOutcomes(experiment(), input, '2026-09-21T07:00:00Z').outcomes).toEqual([]);
  });

  it('fixes the cost model at entry and preserves already finalized outcomes', () => {
    const saved = experiment();
    const expected = computeNetPnL({ entryPrice: 10000, exitPrice: 11000, quantity: 1, market: 'KOSPI' });
    setExecutionCostOverride({ buyCommissionRate: 0.5, slippageRate: 0.5 });
    const input = { ...observation(), dailyCloses: [{ tradingDate: '2026-09-21', close: 11000, availableAt: '2026-09-21T07:00:00Z' }] };
    const result = updatePaperOutcomes(saved, input, '2026-09-21T07:00:00Z');
    expect(result.outcomes[0].netPnl).toBeCloseTo(expected.net, 10);
    expect(result.outcomes[0].netReturnPct).toBeCloseTo(expected.netPct, 10);
    expect(capturePaperCostModel('KOSPI').version).not.toBe(saved.costModel.version);
    input.dailyCloses[0].close = 50000;
    expect(updatePaperOutcomes(result, input, '2026-09-22T07:00:00Z').outcomes).toEqual(result.outcomes);
  });

  it('reports missing outcomes as null; display truncation does not truncate aggregates', () => {
    const rows = Array.from({ length: 205 }, (_, index) => ({ ...experiment(), id: `id-${index}` }));
    const view = buildPaperExperimentView({ schemaVersion: 1, experiments: rows, lastRun: null });
    expect(view.totalCount).toBe(205);
    expect(view.experiments).toHaveLength(200);
    expect(view.outcomes.map((item) => item.meanNetReturnPct)).toEqual([null, null, null]);
    expect(view.groups.every((group) => group.meanNetReturnPct === null && group.count === 0)).toBe(true);
  });
});
