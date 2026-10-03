// @responsibility Supply deterministic empirical strategy test fixtures.
import type { PaperCostModel, PaperExperiment, PaperObservation, PaperSnapshot } from '../../../src/types/paperExperiment.js';
import type { PaperStrategyLedger } from '../../../src/types/paperStrategy.js';
import { createPaperExperiment, updatePaperOutcomes } from './paperExperimentPolicy.js';
import { addBusinessDaysFromKstDate } from '../krxHolidays.js';
import { paperEvidenceDigest, paperStrategyCohort } from './paperStrategyEvidence.js';
import { summarizePaperNews } from '../../../src/utils/paperNews.js';

export const strategyTestCost = (): PaperCostModel => ({ version: 'test', buyFeeRate: 0, sellFeeRate: 0, sellTaxRate: 0, slippageRate: 0 });
export const emptyStrategyLedger = (): PaperStrategyLedger => ({ schemaVersion: 1, trades: [], latestDecisions: [], lastRun: null });
export const strategyTestObservation = (at = '2026-09-18T01:00:00Z'): PaperObservation => ({
  symbol: '005930', name: '삼성전자', price: 10000, observedAt: at, source: 'KIS_REST_REQUEST_OBSERVED',
  return1dPct: 1, return5dPct: 2, aboveMa20: true, news: [], dailyCloses: [],
});
export const strategyTestSnapshot = (): PaperSnapshot => ({ id: 'test-scan', asOf: '2026-09-18T01:00:00Z',
  tradingDate: '2026-09-18', marketOpen: true, observations: [strategyTestObservation()] });

/** Frozen pre-adaptive ledger shape for read/hold/exit compatibility; no retired entry policy is executed. */
export function legacyStrategyLedger(
  snapshot = strategyTestSnapshot(), version: 'news-trend-v1' | 'news-trend-v2' = 'news-trend-v2',
): PaperStrategyLedger {
  const observation = structuredClone(snapshot.observations[0]);
  const id = `${version}:${snapshot.tradingDate}:${observation.symbol}`;
  const cohort = paperStrategyCohort(observation, snapshot.asOf)!;
  const evidence = { cutoffAt: snapshot.asOf, cohort, sampleCount: 12, entryDateCount: 3,
    experimentIdsDigest: paperEvidenceDigest(matureStrategySamples().map(item => item.id)),
    horizons: ([1, 3, 5] as const).map((horizon, index) => ({ horizon, count: 12,
      meanNetReturnPct: [1, 9, 10][index], meanDailyNetReturnPct: [1, 3, 2][index], winRatePct: 100 })),
    selectedHorizon: 3 as const, baselineSampleCount: 12, historicalSampleCount: 0 };
  const entryDecision = { snapshotId: snapshot.id, decisionAt: snapshot.asOf,
    symbol: observation.symbol, name: observation.name, action: 'BUY' as const,
    reasonCode: 'POSITIVE_COHORT_EXPECTANCY' as const, reason: '보존된 뉴스·추세 전략 진입',
    cohort, evidence, tradeId: id, newsSummary: summarizePaperNews(observation.news, snapshot.asOf, 72),
    ...(observation.investorFlow ? { investorFlow: structuredClone(observation.investorFlow) } : {}) };
  return { schemaVersion: 1, trades: [{ id, strategyVersion: version, symbol: observation.symbol, name: observation.name,
    status: 'OPEN', entrySnapshotId: snapshot.id, entryAt: snapshot.asOf, tradingDate: snapshot.tradingDate,
    entryPrice: observation.price!, quantity: 1, entryObservation: observation, entryDecision,
    policy: { version, newsLookbackHours: 72, minimumSamples: 10, minimumEntryDates: 3,
      horizonSelection: 'MEAN_NET_RETURN_PER_DAY', exitModel: 'SCHEDULED_CLOSE' },
    costModel: strategyTestCost(), horizon: 3, scheduledExitDate: '2026-09-23', scheduledExitAt: '2026-09-23T06:30:00.000Z', exit: null }],
    latestDecisions: [structuredClone(entryDecision)], lastRun: { snapshotId: snapshot.id, asOf: snapshot.asOf,
      openedCount: 1, closedCount: 0, waitingCount: 0, holdingCount: 0 } };
}

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
