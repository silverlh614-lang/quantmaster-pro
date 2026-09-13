// @responsibility Compare historical features on held-out dates.
import type { HistoricalPaperSample, ResearchFeatures, ResearchFeatureStudy, ResearchGroupResult } from '../../../src/types/paperResearch.js';
import type { PaperStrategyHorizon } from '../../../src/types/paperStrategy.js';

const horizons = [1, 3, 5] as const;
const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const valueAt = (sample: HistoricalPaperSample, horizon: PaperStrategyHorizon) => sample.outcomes.find((item) => item.horizon === horizon)!.netReturnPct;
const featureDefinitions: Array<[keyof Omit<ResearchFeatures, 'benchmarkSeriesId'>, string]> = [
  ['volumeRatio20d', '20일 평균 대비 거래량'], ['relativeReturn20dPct', '시장 대비 20일 상대강도'],
  ['return5dPct', '5거래일 가격 모멘텀'], ['extensionMa20Pct', '20일 평균가격 이격률'],
  ['distanceHigh20dPct', '20일 고점까지의 거리'], ['atr14Pct', '직전 14거래일 변동폭 / 진입가'],
  ['priceSetup', 'Gate 3 돌파·눌림목·과열 위치'],
];

function summarize(group: string, samples: HistoricalPaperSample[]): ResearchGroupResult {
  return { group, count: samples.length, entryDates: new Set(samples.map((item) => item.tradingDate)).size,
    horizons: horizons.map((horizon) => {
      const values = samples.map((item) => valueAt(item, horizon));
      return { horizon, meanNetReturnPct: mean(values)!, winRatePct: values.filter((value) => value > 0).length / values.length * 100 };
    }) };
}

/** All seven hypotheses are shown; no winning factor is automatically promoted into trading. */
export function compareResearchFeatures(samples: HistoricalPaperSample[], splitDate: string | null): ResearchFeatureStudy[] {
  return featureDefinitions.map(([feature, label]) => {
    const available = samples.filter((item) => {
      const value = item.features?.[feature];
      return typeof value === 'number' ? Number.isFinite(value) : typeof value === 'string';
    });
    const train = splitDate ? available.filter((item) => item.tradingDate < splitDate
      && item.outcomes.every((outcome) => outcome.tradingDate < splitDate)) : [];
    const test = splitDate ? available.filter((item) => item.tradingDate >= splitDate) : [];
    const numbers = train.map((item) => item.features![feature]).filter((value): value is number => typeof value === 'number').sort((a, b) => a - b);
    const middle = Math.floor(numbers.length / 2);
    const threshold = numbers.length ? numbers.length % 2 ? numbers[middle] : (numbers[middle - 1] + numbers[middle]) / 2 : null;
    const bucket = (sample: HistoricalPaperSample) => {
      const value = sample.features![feature];
      return typeof value === 'string' ? value : threshold === null ? 'UNCLASSIFIED' : value! <= threshold ? 'LOWER' : 'UPPER';
    };
    const groups = [...new Set(available.map(bucket))];
    const result: ResearchFeatureStudy = { feature, label, availableCount: available.length, missingCount: samples.length - available.length,
      splitDate, threshold, groups: groups.map((group) => summarize(group, available.filter((item) => bucket(item) === group))),
      trainingCount: train.length, testAvailableCount: test.length, selectedGroup: null, selectedHorizon: null, selectedTrainingCount: 0,
      testCount: 0, testDateCount: 0, testSymbolCount: 0, testMeanNetReturnPct: null,
      matchedGroupCount: 0, matchedSelectedMeanPct: null, matchedBaselineMeanPct: null, matchedDifferencePct: null,
      status: available.length ? 'NO_TRAIN_VARIATION' : 'MISSING_INPUT' };
    const trainGroups = [...new Set(train.map(bucket))];
    if (trainGroups.length < 2) return result;
    const ranked = trainGroups.flatMap((group) => {
      const members = train.filter((item) => bucket(item) === group);
      return horizons.map((horizon) => ({ group, horizon, count: members.length,
        score: mean(members.map((item) => valueAt(item, horizon)))! / horizon }));
    }).sort((a, b) => b.score - a.score || a.horizon - b.horizon || a.group.localeCompare(b.group));
    const winner = ranked[0];
    const selected = test.filter((item) => bucket(item) === winner.group);
    Object.assign(result, { selectedGroup: winner.group, selectedHorizon: winner.horizon, selectedTrainingCount: winner.count,
      testCount: selected.length, testDateCount: new Set(selected.map((item) => item.tradingDate)).size,
      testSymbolCount: new Set(selected.map((item) => item.symbol)).size,
      testMeanNetReturnPct: mean(selected.map((item) => valueAt(item, winner.horizon))) });
    // Each date + original news/MA cohort gets equal weight in both arms. Missing-feature rows are excluded from both.
    const key = (item: HistoricalPaperSample) => `${item.tradingDate}:${item.cohort ?? `UNKNOWN_${item.aboveMa20}`}`;
    const selectedMeans: number[] = [];
    const baselineMeans: number[] = [];
    for (const cell of new Set(selected.map(key))) {
      selectedMeans.push(mean(selected.filter((item) => key(item) === cell).map((item) => valueAt(item, winner.horizon)))!);
      baselineMeans.push(mean(test.filter((item) => key(item) === cell).map((item) => valueAt(item, winner.horizon)))!);
    }
    result.matchedGroupCount = selectedMeans.length;
    result.matchedSelectedMeanPct = mean(selectedMeans);
    result.matchedBaselineMeanPct = mean(baselineMeans);
    result.matchedDifferencePct = mean(selectedMeans.map((value, index) => value - baselineMeans[index]));
    result.status = selected.length ? 'EVALUATED' : 'NO_TEST_MATCH';
    return result;
  });
}
