// @responsibility Build mature baseline cohort evidence.
import type { PaperExperiment, PaperObservation } from '../../../src/types/paperExperiment.js';
import type { PaperStrategyCohort, PaperStrategyEvidence, PaperStrategyPolicy } from '../../../src/types/paperStrategy.js';
import { addBusinessDaysFromKstDate } from '../krxHolidays.js';
import { toKstDateKey, isKrxTradingDay } from '../../calendar/krxTradingCalendar.js';
import { calculatePaperReturn } from './paperAccounting.js';
import type { HistoricalPaperSample } from '../../../src/types/paperResearch.js';
import { historicalSampleUsable } from './paperResearch.js';

export const PAPER_STRATEGY_POLICY: Readonly<PaperStrategyPolicy> = Object.freeze({
  version: 'news-trend-v2', newsLookbackHours: 72, minimumSamples: 10, minimumEntryDates: 3,
  horizonSelection: 'MEAN_NET_RETURN_PER_DAY', exitModel: 'SCHEDULED_CLOSE',
});
export const STRATEGY_HORIZONS = [1, 3, 5] as const;

export function paperStrategyCohort(
  observation: PaperObservation, asOf: string, policy: PaperStrategyPolicy = PAPER_STRATEGY_POLICY,
): PaperStrategyCohort | null {
  if (observation.aboveMa20 !== true && observation.aboveMa20 !== false) return null;
  const cutoff = Date.parse(asOf);
  if (!Number.isFinite(cutoff)) return null;
  const recent = observation.news.some((item) => {
    const observed = Date.parse(item.observedAt);
    return observed <= cutoff && observed >= cutoff - policy.newsLookbackHours * 3_600_000;
  });
  return `${recent ? 'NEWS_RECENT' : 'NEWS_ABSENT'}_${observation.aboveMa20 ? 'ABOVE' : 'BELOW'}_MA20`;
}

export function scheduledPaperClose(tradingDate: string): string {
  return new Date(`${tradingDate}T15:30:00+09:00`).toISOString();
}

/** Pair all horizons on the same mature rows so younger D1 rows cannot bias horizon selection. */
export function buildPaperStrategyEvidence(
  experiments: PaperExperiment[], cohort: PaperStrategyCohort, cutoffAt: string,
  policy: PaperStrategyPolicy = PAPER_STRATEGY_POLICY,
  historical: HistoricalPaperSample[] = [],
): PaperStrategyEvidence {
  const cutoff = Date.parse(cutoffAt);
  const seen = new Set<string>();
  const rows: Array<{ id: string; date: string; returns: number[] }> = [];
  for (const experiment of [...experiments].sort((a, b) => a.entryAt.localeCompare(b.entryAt) || a.id.localeCompare(b.id))) {
    const entryMs = Date.parse(experiment.entryAt);
    const key = `${experiment.symbol}:${experiment.tradingDate}`;
    if (seen.has(key) || experiment.strategyVersion !== 'shadow-baseline-v1'
      || !/^\d{6}$/.test(experiment.symbol) || !/^\d{4}-\d{2}-\d{2}$/.test(experiment.tradingDate)
      || !Number.isFinite(entryMs) || !(entryMs < cutoff) || toKstDateKey(new Date(entryMs)) !== experiment.tradingDate
      || experiment.entryObservation.symbol !== experiment.symbol || experiment.entryObservation.price !== experiment.entryPrice
      || !(Date.parse(experiment.entryObservation.observedAt) <= entryMs)
      || toKstDateKey(new Date(experiment.entryObservation.observedAt)) !== experiment.tradingDate
      || !isKrxTradingDay(experiment.tradingDate) || !(experiment.entryPrice > 0) || !Number.isFinite(experiment.entryPrice)
      || paperStrategyCohort(experiment.entryObservation, experiment.entryAt, policy) !== cohort
      || ![experiment.costModel.buyFeeRate, experiment.costModel.sellFeeRate,
        experiment.costModel.sellTaxRate, experiment.costModel.slippageRate].every((rate) => Number.isFinite(rate) && rate >= 0)) continue;
    const returns: number[] = [];
    for (const horizon of STRATEGY_HORIZONS) {
      const outcomes = experiment.outcomes.filter((item) => item.horizon === horizon);
      const outcome = outcomes[0];
      const date = addBusinessDaysFromKstDate(experiment.tradingDate, horizon);
      if (outcomes.length !== 1 || outcome.tradingDate !== date
        || !(Date.parse(outcome.availableAt) < cutoff)
        || !(Date.parse(outcome.availableAt) >= Date.parse(scheduledPaperClose(date)))
        || !Number.isFinite(outcome.exitPrice) || outcome.exitPrice <= 0
        || !Number.isFinite(outcome.netReturnPct) || !Number.isFinite(outcome.netPnl)) break;
      returns.push(calculatePaperReturn(experiment.entryPrice, outcome.exitPrice, experiment.costModel).netReturnPct);
    }
    if (returns.length !== STRATEGY_HORIZONS.length || !returns.every(Number.isFinite)) continue;
    seen.add(key);
    rows.push({ id: experiment.id, date: experiment.tradingDate, returns });
  }
  const baselineSampleCount = rows.length;
  for (const sample of historical) {
    const key = `${sample.symbol}:${sample.tradingDate}`;
    if (seen.has(key) || sample.cohort !== cohort || !sample.newsIds.length || !historicalSampleUsable(sample, cutoffAt)) continue;
    const expected = `NEWS_RECENT_${sample.aboveMa20 ? 'ABOVE' : 'BELOW'}_MA20`;
    if (sample.cohort !== expected) continue;
    seen.add(key);
    rows.push({ id: sample.id, date: sample.tradingDate, returns: STRATEGY_HORIZONS.map((horizon) =>
      calculatePaperReturn(sample.entryPrice, sample.outcomes.find((item) => item.horizon === horizon)!.exitPrice, sample.costModel).netReturnPct) });
  }
  const horizons = STRATEGY_HORIZONS.map((horizon, index) => {
    const values = rows.map((row) => row.returns[index]);
    const mean = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    return { horizon, count: values.length, meanNetReturnPct: mean,
      meanDailyNetReturnPct: mean === null ? null : mean / horizon,
      winRatePct: values.length ? values.filter((value) => value > 0).length / values.length * 100 : null };
  });
  const ranked = [...horizons].sort((a, b) =>
    (b.meanDailyNetReturnPct ?? -Infinity) - (a.meanDailyNetReturnPct ?? -Infinity) || a.horizon - b.horizon);
  return { cutoffAt, cohort, sampleCount: rows.length, entryDateCount: new Set(rows.map((row) => row.date)).size,
    experimentIds: rows.map((row) => row.id), horizons, selectedHorizon: rows.length ? ranked[0].horizon : null,
    baselineSampleCount, historicalSampleCount: rows.length - baselineSampleCount };
}
