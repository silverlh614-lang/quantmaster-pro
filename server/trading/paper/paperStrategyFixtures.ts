// @responsibility Supply deterministic empirical strategy test fixtures.
import type { PaperCostModel, PaperExperiment, PaperObservation, PaperSnapshot } from '../../../src/types/paperExperiment.js';
import type { PaperStrategyLedger } from '../../../src/types/paperStrategy.js';
import { createPaperExperiment, updatePaperOutcomes } from './paperExperimentPolicy.js';
import { addBusinessDaysFromKstDate } from '../krxHolidays.js';

export const strategyTestCost = (): PaperCostModel => ({ version: 'test', buyFeeRate: 0, sellFeeRate: 0, sellTaxRate: 0, slippageRate: 0 });
export const emptyStrategyLedger = (): PaperStrategyLedger => ({ schemaVersion: 1, trades: [], latestDecisions: [], lastRun: null });
export const strategyTestObservation = (at = '2026-09-18T01:00:00Z'): PaperObservation => ({
  symbol: '005930', name: '삼성전자', price: 10000, observedAt: at, source: 'KIS_REST_REQUEST_OBSERVED',
  return1dPct: 1, return5dPct: 2, aboveMa20: true, news: [], dailyCloses: [],
});
export const strategyTestSnapshot = (): PaperSnapshot => ({ id: 'test-scan', asOf: '2026-09-18T01:00:00Z',
  tradingDate: '2026-09-18', marketOpen: true, observations: [strategyTestObservation()] });

export function matureStrategySamples(returns = [1, 9, 10], withNews = false): PaperExperiment[] {
  return Array.from({ length: 12 }, (_, index) => {
    const date = ['2026-09-01', '2026-09-02', '2026-09-03'][Math.floor(index / 4)];
    const at = `${date}T01:00:00Z`;
    const observation = { ...strategyTestObservation(at), symbol: `00010${index % 4}`,
      news: withNews ? [{ id: `news-${index}`, headline: '관측 뉴스', observedAt: `${date}T00:00:00Z`, source: 'DART' }] : [] };
    const snapshot = { ...strategyTestSnapshot(), asOf: at, tradingDate: date, observations: [observation] };
    const experiment = createPaperExperiment(snapshot, observation, strategyTestCost())!;
    const dailyCloses = ([1, 3, 5] as const).map((horizon, offset) => {
      const tradingDate = addBusinessDaysFromKstDate(date, horizon);
      return { tradingDate, close: 10000 * (1 + returns[offset] / 100), availableAt: `${tradingDate}T07:00:00Z` };
    });
    return updatePaperOutcomes(experiment, { ...observation, dailyCloses }, '2026-09-17T07:00:00Z');
  });
}
