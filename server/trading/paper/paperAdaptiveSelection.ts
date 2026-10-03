// @responsibility Reassess independent Shadow feature rules using dated baseline evidence.
import type { PaperExperiment, PaperObservation } from '../../../src/types/paperExperiment.js';
import { PAPER_FEATURES, type PaperFeatureKey } from '../../../src/types/paperObservationFeatures.js';
import type { PaperAdaptiveCandidate, PaperAdaptivePolicy, PaperAdaptiveRule, PaperAdaptiveState, PaperAdaptiveStats } from '../../../src/types/paperAdaptive.js';
import { toKstDateKey, isKrxTradingDay } from '../../calendar/krxTradingCalendar.js';
import { addBusinessDaysFromKstDate } from '../krxHolidays.js';
import { calculatePaperReturn } from './paperAccounting.js';
import { paperStrategyCohort, scheduledPaperClose } from './paperStrategyEvidence.js';

export const PAPER_ADAPTIVE_POLICY: Readonly<PaperAdaptivePolicy> = Object.freeze({
  version: 'adaptive-features-v1', windowEntryDates: 60, trainingFraction: 0.7,
  minimumSamples: 10, minimumEntryDates: 3, activationMarginDailyPct: 0.05,
  replacementMarginDailyPct: 0.05, maxActiveRules: 3,
});
const keys = Object.keys(PAPER_FEATURES) as PaperFeatureKey[];
const horizons = [1, 3, 5] as const;
interface Row { experiment: PaperExperiment; returns: number[]; lastAvailableAt: number; cell: string; values: Partial<Record<PaperFeatureKey, number>> }
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
export const adaptiveRuleId = (rule: PaperAdaptiveRule) => `${rule.feature}:${rule.bucket}:D${rule.horizon}`;

function featureValues(observation: PaperObservation, asOf: string) {
  const features = observation.features;
  if (!features || features.version !== 'observation-features-v1'
    || !(Date.parse(features.asOf) <= Date.parse(asOf))
    || !(Date.parse(features.asOf) >= Date.parse(`${toKstDateKey(new Date(asOf))}T00:00:00+09:00`))) return null;
  return features.values;
}
export function adaptiveFeatureValue(observation: PaperObservation, key: PaperFeatureKey, asOf: string): number | null {
  const value = featureValues(observation, asOf)?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
export function adaptiveRuleMatches(observation: PaperObservation, rule: PaperAdaptiveRule, asOf: string): boolean {
  const value = adaptiveFeatureValue(observation, rule.feature, asOf);
  const cuts: readonly number[] = PAPER_FEATURES[rule.feature].cuts;
  return value !== null && value >= (cuts[rule.bucket - 1] ?? -Infinity) && value < (cuts[rule.bucket] ?? Infinity);
}

function matureRows(experiments: PaperExperiment[], cutoffAt: string): Row[] {
  const cutoff = Date.parse(cutoffAt), seen = new Set<string>(), rows: Row[] = [];
  const schedules = new Map<string, Array<{ date: string; closeAt: number }>>();
  for (const experiment of [...experiments].sort((a, b) => a.entryAt.localeCompare(b.entryAt) || a.id.localeCompare(b.id))) {
    const entryMs = Date.parse(experiment.entryAt), observation = experiment.entryObservation;
    const key = `${experiment.symbol}:${experiment.tradingDate}`;
    if (seen.has(key) || experiment.strategyVersion !== 'shadow-baseline-v1'
      || !/^\d{6}$/.test(experiment.symbol) || !Number.isFinite(entryMs) || !(entryMs < cutoff)
      || !isKrxTradingDay(experiment.tradingDate) || toKstDateKey(new Date(entryMs)) !== experiment.tradingDate
      || observation.symbol !== experiment.symbol || observation.price !== experiment.entryPrice
      || !(Date.parse(observation.observedAt) <= entryMs) || toKstDateKey(new Date(observation.observedAt)) !== experiment.tradingDate
      || !(experiment.entryPrice > 0) || !Number.isFinite(experiment.entryPrice)
      || ![experiment.costModel.buyFeeRate, experiment.costModel.sellFeeRate, experiment.costModel.sellTaxRate,
        experiment.costModel.slippageRate].every(rate => Number.isFinite(rate) && rate >= 0)) continue;
    const recorded = featureValues(observation, experiment.entryAt);
    if (!recorded) continue;
    const values: Partial<Record<PaperFeatureKey, number>> = {};
    for (const feature of keys) if (typeof recorded[feature] === 'number' && Number.isFinite(recorded[feature])) values[feature] = recorded[feature]!;
    if (!Object.keys(values).length) continue;
    let schedule = schedules.get(experiment.tradingDate);
    if (!schedule) {
      schedule = horizons.map(horizon => { const date = addBusinessDaysFromKstDate(experiment.tradingDate, horizon); return { date, closeAt: Date.parse(scheduledPaperClose(date)) }; });
      schedules.set(experiment.tradingDate, schedule);
    }
    const returns: number[] = [], available: number[] = [];
    for (const horizon of horizons) {
      const outcomes = experiment.outcomes.filter(item => item.horizon === horizon), outcome = outcomes[0];
      const { date, closeAt } = schedule[horizons.indexOf(horizon)];
      if (outcomes.length !== 1 || outcome.tradingDate !== date || !(outcome.exitPrice > 0) || !Number.isFinite(outcome.exitPrice)
        || !(Date.parse(outcome.availableAt) < cutoff) || !(Date.parse(outcome.availableAt) >= closeAt)) break;
      returns.push(calculatePaperReturn(experiment.entryPrice, outcome.exitPrice, experiment.costModel).netReturnPct);
      available.push(Date.parse(outcome.availableAt));
    }
    if (returns.length !== 3 || !returns.every(Number.isFinite)) continue;
    seen.add(key);
    rows.push({ experiment, returns, values, lastAvailableAt: Math.max(...available),
      cell: `${experiment.tradingDate}:${observation.market ?? 'UNKNOWN'}:${paperStrategyCohort(observation, experiment.entryAt) ?? 'UNKNOWN'}` });
  }
  return rows;
}

function stats(rows: Row[], rule: PaperAdaptiveRule): PaperAdaptiveStats {
  const index = horizons.indexOf(rule.horizon);
  const selected: Row[] = [];
  const cuts: readonly number[] = PAPER_FEATURES[rule.feature].cuts;
  const lower = cuts[rule.bucket - 1] ?? -Infinity, upper = cuts[rule.bucket] ?? Infinity;
  const cells = new Map<string, { date: string; count: number; sum: number; selectedCount: number; selectedSum: number }>();
  for (const row of rows) {
    const value = row.values[rule.feature];
    if (value === undefined) continue;
    const cell = cells.get(row.cell) ?? { date: row.experiment.tradingDate, count: 0, sum: 0, selectedCount: 0, selectedSum: 0 };
    cell.count++; cell.sum += row.returns[index];
    if (value >= lower && value < upper) {
      selected.push(row); cell.selectedCount++; cell.selectedSum += row.returns[index];
    }
    cells.set(row.cell, cell);
  }
  // Equal weight per date, then per market/news-trend cell within that date. Controls include the selected rows.
  const dates = new Map<string, { net: number[]; excess: number[] }>();
  for (const cell of cells.values()) if (cell.selectedCount) {
    const date = dates.get(cell.date) ?? { net: [], excess: [] };
    date.net.push(cell.selectedSum / cell.selectedCount);
    date.excess.push((cell.selectedSum / cell.selectedCount - cell.sum / cell.count) / rule.horizon);
    dates.set(cell.date, date);
  }
  const daily = [...dates.values()].map(value => ({ net: mean(value.net), excess: mean(value.excess) }));
  return { sampleCount: selected.length, dateCount: dates.size,
    symbolCount: new Set(selected.map(row => row.experiment.symbol)).size, experimentIds: selected.map(row => row.experiment.id),
    meanNetReturnPct: daily.length ? mean(daily.map(item => item.net)) : null,
    meanDailyExcessPct: daily.length ? mean(daily.map(item => item.excess)) : null };
}
const sufficient = (value: PaperAdaptiveStats) => value.sampleCount >= PAPER_ADAPTIVE_POLICY.minimumSamples
  && value.dateCount >= PAPER_ADAPTIVE_POLICY.minimumEntryDates;
const positive = (value: PaperAdaptiveStats) => (value.meanNetReturnPct ?? -Infinity) > 0 && (value.meanDailyExcessPct ?? -Infinity) > 0;
const score = (value: PaperAdaptiveCandidate) => value.training.meanDailyExcessPct ?? -Infinity;
const rank = (a: PaperAdaptiveCandidate, b: PaperAdaptiveCandidate) => score(b) - score(a)
  || a.rule.horizon - b.rule.horizon || adaptiveRuleId(a.rule).localeCompare(adaptiveRuleId(b.rule));

function candidate(rule: PaperAdaptiveRule, train: Row[], test: Row[], previous: PaperAdaptiveState | undefined): PaperAdaptiveCandidate {
  const training = stats(train, rule), validation = stats(test, rule);
  const retained = previous?.candidates.some(item => item.active && adaptiveRuleId(item.rule) === adaptiveRuleId(rule));
  const reason = !training.sampleCount ? 'MISSING_INPUT' : !sufficient(training) ? 'INSUFFICIENT_TRAINING'
    : !positive(training) ? 'NO_TRAINING_EDGE' : !sufficient(validation) ? 'INSUFFICIENT_VALIDATION'
      : !positive(validation) || validation.meanDailyExcessPct! <= (retained ? 0 : PAPER_ADAPTIVE_POLICY.activationMarginDailyPct)
        ? 'NO_VALIDATION_EDGE' : 'ACTIVE';
  return { rule, training, validation, active: reason === 'ACTIVE', reason };
}

function chooseFeature(feature: PaperFeatureKey, train: Row[], test: Row[], previous: PaperAdaptiveState | undefined): PaperAdaptiveCandidate {
  const rules = Array.from({ length: PAPER_FEATURES[feature].cuts.length + 1 }, (_, bucket) =>
    horizons.map(horizon => candidate({ feature, bucket, horizon }, train, [], undefined))).flat();
  // Choose the range and horizon on training only, never retune them to the validation results.
  rules.sort((a, b) => Number(sufficient(b.training) && positive(b.training)) - Number(sufficient(a.training) && positive(a.training))
    || Number(sufficient(b.training)) - Number(sufficient(a.training)) || rank(a, b));
  let chosen = candidate(rules[0].rule, train, test, previous);
  const old = previous?.candidates.find(item => item.active && item.rule.feature === feature);
  if (old) {
    const incumbent = candidate(old.rule, train, test, previous);
    if (incumbent.active && (!chosen.active || score(chosen) <= score(incumbent) + PAPER_ADAPTIVE_POLICY.replacementMarginDailyPct)) chosen = incumbent;
  }
  return chosen;
}

export function selectPaperAdaptiveState(previous: PaperAdaptiveState | undefined, experiments: PaperExperiment[], asOf: string): PaperAdaptiveState {
  if (!Number.isFinite(Date.parse(asOf))) throw new Error('자율 지표 평가 시각 오류');
  if (previous && Date.parse(previous.evaluatedAt) > Date.parse(asOf)) throw new Error('과거 스냅샷으로 자율 지표 상태를 변경할 수 없습니다.');
  const tradingDate = toKstDateKey(new Date(asOf));
  if (previous?.tradingDate === tradingDate) return structuredClone(previous);
  const cutoffAt = new Date(`${tradingDate}T00:00:00+09:00`).toISOString();
  const all = matureRows(experiments, cutoffAt);
  const dates = [...new Set(all.map(row => row.experiment.tradingDate))].sort().slice(-PAPER_ADAPTIVE_POLICY.windowEntryDates);
  const validationStartDate = dates[Math.floor(dates.length * PAPER_ADAPTIVE_POLICY.trainingFraction)] ?? null;
  const rows = all.filter(row => dates.includes(row.experiment.tradingDate));
  const splitMs = validationStartDate ? Date.parse(`${validationStartDate}T00:00:00+09:00`) : Infinity;
  const train = rows.filter(row => validationStartDate && row.experiment.tradingDate < validationStartDate && row.lastAvailableAt < splitMs);
  const test = rows.filter(row => validationStartDate && row.experiment.tradingDate >= validationStartDate);
  const candidates = keys.map(feature => chooseFeature(feature, train, test, previous));
  const eligible = candidates.filter(item => item.active).sort(rank);
  // Retain still-valid active indicators when a challenger only marginally changes the ranking.
  eligible.sort((a, b) => {
    const retained = (item: PaperAdaptiveCandidate) => previous?.candidates.some(old => old.active && adaptiveRuleId(old.rule) === adaptiveRuleId(item.rule)) ? PAPER_ADAPTIVE_POLICY.replacementMarginDailyPct : 0;
    return score(b) + retained(b) - score(a) - retained(a) || rank(a, b);
  });
  const activeIds = new Set(eligible.slice(0, PAPER_ADAPTIVE_POLICY.maxActiveRules).map(item => adaptiveRuleId(item.rule)));
  for (const item of candidates) if (item.active && !activeIds.has(adaptiveRuleId(item.rule))) { item.active = false; item.reason = 'RANKED_OUT'; }
  const changes = [...(previous?.changes ?? [])];
  for (const item of candidates) {
    const from = previous?.candidates.find(old => old.active && old.rule.feature === item.rule.feature)?.rule ?? null;
    const to = item.active ? item.rule : null;
    if ((from ? adaptiveRuleId(from) : null) !== (to ? adaptiveRuleId(to) : null)) {
      changes.push({ at: asOf, feature: item.rule.feature, from: from ? { ...from } : null, to: to ? { ...to } : null, reason: item.reason });
    }
  }
  return { policy: { ...PAPER_ADAPTIVE_POLICY }, tradingDate, evaluatedAt: asOf, cutoffAt,
    windowStartDate: dates[0] ?? null, validationStartDate, matureSampleCount: rows.length, matureDateCount: dates.length,
    candidates: candidates.sort(rank), changes: changes.slice(-100) };
}
