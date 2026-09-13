// @responsibility Verify chronological feature comparisons.
import { describe, expect, it } from 'vitest';
import type { HistoricalPaperSample, ResearchFeatures } from '../../../src/types/paperResearch.js';
import { compareResearchFeatures } from './paperResearchComparison.js';
import { strategyTestCost } from './paperStrategyFixtures.js';
import { addBusinessDaysFromKstDate } from '../krxHolidays.js';

const split = '2026-04-20';
function sample(date: string, upper: boolean, gain: number): HistoricalPaperSample {
  const symbol = upper ? '005930' : '000660';
  const features: ResearchFeatures = { volumeRatio20d: upper ? 2 : 1, return5dPct: null, relativeReturn20dPct: null,
    extensionMa20Pct: null, distanceHigh20dPct: null, atr14Pct: null, priceSetup: null, benchmarkSeriesId: null };
  return { id: `historical-close:${date}:${symbol}`, symbol, model: 'HISTORICAL_CLOSE_TO_CLOSE', tradingDate: date,
    entryAt: `${date}T06:30:00Z`, entryPrice: 100, aboveMa20: true, cohort: null, newsIds: [], seriesId: symbol,
    source: 'ARCHIVED_CHART', reconstructedAt: '2026-09-01T00:00:00Z', costModel: strategyTestCost(), features,
    outcomes: ([1, 3, 5] as const).map(horizon => ({ horizon, tradingDate: addBusinessDaysFromKstDate(date, horizon),
      availableAt: '2026-09-01T00:00:00Z', exitPrice: 100 + gain * horizon, grossReturnPct: gain * horizon,
      netReturnPct: gain * horizon, netPnl: gain * horizon })) };
}
function fixture() {
  return [...['2026-04-01', '2026-04-02', '2026-04-03'].flatMap(date => [sample(date, false, -1), sample(date, true, 2)]),
    ...['2026-04-20', '2026-04-21'].flatMap(date => [sample(date, false, 10), sample(date, true, 1)])];
}
const study = (rows: HistoricalPaperSample[]) => compareResearchFeatures(rows, split)[0];

describe('feature holdout comparisons', () => {
  it('selects on training only and reports a negative holdout difference honestly', () => {
    const result = study(fixture());
    expect(result).toMatchObject({ threshold: 1.5, trainingCount: 6, selectedGroup: 'UPPER', selectedHorizon: 1,
      selectedTrainingCount: 3, testCount: 2, testDateCount: 2, testMeanNetReturnPct: 1,
      matchedSelectedMeanPct: 1, matchedBaselineMeanPct: 5.5, matchedDifferencePct: -4.5, status: 'EVALUATED' });
  });
  it('purges training outcomes crossing the split and ignores test values when learning the split', () => {
    const rows = fixture();
    rows.push(sample('2026-04-17', false, 1000));
    for (const row of rows.filter(row => row.tradingDate >= split)) {
      row.features!.volumeRatio20d = 100;
      row.outcomes.forEach(outcome => { outcome.netReturnPct = outcome.horizon === 5 ? 9999 : -100; });
    }
    expect(study(rows)).toMatchObject({ threshold: 1.5, trainingCount: 6, selectedGroup: 'UPPER', selectedHorizon: 1 });
  });
  it('excludes missing inputs from both arms and matches original news/trend cohorts', () => {
    const rows = fixture();
    const missing = sample('2026-04-20', false, 999); missing.symbol = '035420'; missing.features!.volumeRatio20d = null;
    rows.push(missing);
    expect(study(rows)).toMatchObject({ missingCount: 1, matchedDifferencePct: -4.5 });
    rows.filter(row => row.tradingDate >= split && row.symbol === '000660').forEach(row => { row.aboveMa20 = false; });
    expect(study(rows).matchedDifferencePct).toBe(0);
  });
  it('shows unavailable and untestable hypotheses without treating them as zero returns', () => {
    const rows = fixture(); rows.forEach(row => { row.features!.volumeRatio20d = null; });
    expect(study(rows)).toMatchObject({ status: 'MISSING_INPUT', matchedDifferencePct: null, selectedHorizon: null });
    rows.forEach(row => { row.features!.volumeRatio20d = 1; });
    expect(study(rows)).toMatchObject({ status: 'NO_TRAIN_VARIATION', matchedDifferencePct: null });
    expect(study(fixture().filter(row => row.tradingDate < split))).toMatchObject({ status: 'NO_TEST_MATCH', matchedDifferencePct: null });
  });
});
