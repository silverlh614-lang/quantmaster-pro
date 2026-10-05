// @responsibility Reassess independent Shadow feature rules using dated baseline evidence.
import type { PaperExperiment, PaperObservation } from '../../../src/types/paperExperiment.js';
import { PAPER_FEATURES, type PaperFeatureKey } from '../../../src/types/paperObservationFeatures.js';
import type { PaperAdaptiveCandidate, PaperAdaptiveFeatureKey, PaperAdaptivePolicy, PaperAdaptiveRule, PaperAdaptiveState,
  PaperAdaptiveStats, PaperIndicatorInvention } from '../../../src/types/paperAdaptive.js';
import { PAPER_INVENTED_FEATURE_CUTS, paperIndicatorFormulaId, paperIndicatorFormulaValue, paperIndicatorFormulaOperands,
  type PaperIndicatorFormula } from '../../../src/types/paperIndicatorFormula.js';
import { toKstDateKey, isKrxTradingDay } from '../../calendar/krxTradingCalendar.js';
import { addBusinessDaysFromKstDate } from '../krxHolidays.js';
import { calculatePaperReturn } from './paperAccounting.js';
import { paperStrategyCohort, scheduledPaperClose } from './paperStrategyEvidence.js';
import { discoverPaperIndicators } from './paperIndicatorDiscovery.js';
import { selectPaperShadowExploration } from './paperShadowExploration.js';
import type { PaperProgramProposal } from './paperProgramResearch.js';

export const PAPER_ADAPTIVE_POLICY: Readonly<PaperAdaptivePolicy> = Object.freeze({
  version: 'adaptive-features-v1', maturityModel: 'per-horizon-v1', windowEntryDates: 60, trainingFraction: 0.7,
  minimumSamples: 10, minimumEntryDates: 3, activationMarginDailyPct: 0.05,
  replacementMarginDailyPct: 0.05, maxActiveRules: 3,
});
const keys = Object.keys(PAPER_FEATURES) as PaperFeatureKey[];
const horizons = [1, 3, 5] as const;
interface Row { experiment: PaperExperiment; returns: Array<number | undefined>; availableAt: Array<number | undefined>;
  cell: string; values: Partial<Record<PaperAdaptiveFeatureKey, number>> }
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
export const adaptiveRuleId = (rule: PaperAdaptiveRule) => `${rule.feature}:${rule.bucket}:D${rule.horizon}`;

function featureValues(observation: PaperObservation, asOf: string) {
  const features = observation.features;
  if (!features || features.version !== 'observation-features-v1'
    || !(Date.parse(features.asOf) <= Date.parse(asOf))
    || !(Date.parse(features.asOf) >= Date.parse(`${toKstDateKey(new Date(asOf))}T00:00:00+09:00`))) return null;
  return features.values;
}
export function adaptiveFeatureValue(observation: PaperObservation, key: PaperAdaptiveFeatureKey, asOf: string,
  invention?: PaperIndicatorInvention): number | null {
  const values = featureValues(observation, asOf);
  if (!values) return null;
  if (invention) return invention.id === key ? paperIndicatorFormulaValue(invention.formula, values) : null;
  const value = values[key as PaperFeatureKey];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
const ruleCuts = (rule: PaperAdaptiveRule): readonly number[] => rule.feature.startsWith('invented:')
  ? PAPER_INVENTED_FEATURE_CUTS : PAPER_FEATURES[rule.feature as PaperFeatureKey].cuts;
export function adaptiveRuleMatches(observation: PaperObservation, rule: PaperAdaptiveRule, asOf: string): boolean {
  const value = adaptiveFeatureValue(observation, rule.feature, asOf, rule.invention);
  const cuts = ruleCuts(rule);
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
    const returns: Array<number | undefined> = horizons.map(() => undefined), availableAt: Array<number | undefined> = horizons.map(() => undefined);
    for (const horizon of horizons) {
      const outcomes = experiment.outcomes.filter(item => item.horizon === horizon), outcome = outcomes[0];
      const index = horizons.indexOf(horizon), { date, closeAt } = schedule[index];
      if (outcomes.length !== 1 || outcome.tradingDate !== date || !(outcome.exitPrice > 0) || !Number.isFinite(outcome.exitPrice)
        || !(Date.parse(outcome.availableAt) < cutoff) || !(Date.parse(outcome.availableAt) >= closeAt)) continue;
      const netReturn = calculatePaperReturn(experiment.entryPrice, outcome.exitPrice, experiment.costModel).netReturnPct;
      if (!Number.isFinite(netReturn)) continue;
      returns[index] = netReturn; availableAt[index] = Date.parse(outcome.availableAt);
    }
    if (returns.every(value => value === undefined)) continue;
    seen.add(key);
    rows.push({ experiment, returns, values, availableAt,
      cell: `${experiment.tradingDate}:${observation.market ?? 'UNKNOWN'}:${paperStrategyCohort(observation, experiment.entryAt) ?? 'UNKNOWN'}` });
  }
  return rows;
}

function stats(rows: Row[], rule: PaperAdaptiveRule): PaperAdaptiveStats {
  const index = horizons.indexOf(rule.horizon);
  const selected: Row[] = [];
  const cuts = ruleCuts(rule);
  const lower = cuts[rule.bucket - 1] ?? -Infinity, upper = cuts[rule.bucket] ?? Infinity;
  const cells = new Map<string, { date: string; count: number; sum: number; selectedCount: number; selectedSum: number }>();
  for (const row of rows) {
    const value = row.values[rule.feature], netReturn = row.returns[index];
    if (value === undefined || netReturn === undefined) continue;
    const cell = cells.get(row.cell) ?? { date: row.experiment.tradingDate, count: 0, sum: 0, selectedCount: 0, selectedSum: 0 };
    cell.count++; cell.sum += netReturn;
    if (value >= lower && value < upper) {
      selected.push(row); cell.selectedCount++; cell.selectedSum += netReturn;
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
  const training = rule.invention ? structuredClone(rule.invention.training) : stats(train, rule), validation = stats(test, rule);
  const retained = previous?.candidates.some(item => item.active && adaptiveRuleId(item.rule) === adaptiveRuleId(rule));
  const hasTrainingOutcomes = train.some(row => row.returns[horizons.indexOf(rule.horizon)] !== undefined);
  const rejectedValidation = !sufficient(training) && sufficient(validation)
    && (validation.meanNetReturnPct! < 0 || validation.meanDailyExcessPct! < 0);
  const reason = rejectedValidation ? 'NO_VALIDATION_EDGE'
    : !training.sampleCount ? (hasTrainingOutcomes ? 'MISSING_INPUT' : 'INSUFFICIENT_TRAINING') : !sufficient(training) ? 'INSUFFICIENT_TRAINING'
    : !positive(training) ? 'NO_TRAINING_EDGE' : !sufficient(validation) ? (rule.invention ? 'FORWARD_OBSERVATION' : 'INSUFFICIENT_VALIDATION')
      : !positive(validation) || validation.meanDailyExcessPct! <= (retained ? 0 : PAPER_ADAPTIVE_POLICY.activationMarginDailyPct)
        ? 'NO_VALIDATION_EDGE' : 'ACTIVE';
  return { rule, training, validation, active: reason === 'ACTIVE', reason };
}

function chooseFormula(formula: PaperIndicatorFormula, train: Row[]): PaperAdaptiveCandidate | null {
  const feature = paperIndicatorFormulaId(formula);
  const rules = Array.from({ length: PAPER_INVENTED_FEATURE_CUTS.length + 1 }, (_, bucket) =>
    horizons.map(horizon => candidate({ feature, bucket, horizon }, train, [], undefined))).flat();
  const chosen = rules.sort((a, b) => Number(sufficient(b.training) && positive(b.training)) - Number(sufficient(a.training) && positive(a.training))
    || Number(sufficient(b.training)) - Number(sufficient(a.training)) || rank(a, b))[0];
  const paired = train.filter(row => row.values[feature] !== undefined && row.returns[horizons.indexOf(chosen.rule.horizon)] !== undefined);
  for (const operand of paperIndicatorFormulaOperands(formula)) {
    if (new Set(paired.map(row => row.values[operand.feature])).size < 2) return null;
  }
  const ids = new Set(chosen.training.experimentIds);
  for (const operand of paperIndicatorFormulaOperands(formula)) {
    const cuts: readonly number[] = PAPER_FEATURES[operand.feature].cuts;
    for (let bucket = 0; bucket <= cuts.length; bucket++) {
      const lower = cuts[bucket - 1] ?? -Infinity, upper = cuts[bucket] ?? Infinity;
      const source = paired.filter(row => row.values[operand.feature]! >= lower && row.values[operand.feature]! < upper);
      if (source.length === ids.size && source.every(row => ids.has(row.experiment.id))) return null;
    }
  }
  return chosen;
}

function rankCandidates(candidates: PaperAdaptiveCandidate[], previous: PaperAdaptiveState | undefined): void {
  const eligible = candidates.filter(item => item.active).sort(rank);
  // Retain still-valid active indicators when a challenger only marginally changes the ranking.
  eligible.sort((a, b) => {
    const retained = (item: PaperAdaptiveCandidate) => previous?.candidates.some(old => old.active && adaptiveRuleId(old.rule) === adaptiveRuleId(item.rule)) ? PAPER_ADAPTIVE_POLICY.replacementMarginDailyPct : 0;
    return score(b) + retained(b) - score(a) - retained(a) || rank(a, b);
  });
  const activeIds = new Set(eligible.slice(0, PAPER_ADAPTIVE_POLICY.maxActiveRules).map(item => adaptiveRuleId(item.rule)));
  for (const item of candidates) if (item.active && !activeIds.has(adaptiveRuleId(item.rule))) { item.active = false; item.reason = 'RANKED_OUT'; }
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

export function selectPaperAdaptiveState(previous: PaperAdaptiveState | undefined, experiments: PaperExperiment[], asOf: string,
  observations: PaperObservation[] = [], programs: PaperProgramProposal[] = []): PaperAdaptiveState {
  if (!Number.isFinite(Date.parse(asOf))) throw new Error('자율 지표 평가 시각 오류');
  if (previous && Date.parse(previous.evaluatedAt) > Date.parse(asOf)) throw new Error('과거 스냅샷으로 자율 지표 상태를 변경할 수 없습니다.');
  const tradingDate = toKstDateKey(new Date(asOf));
  const frozen = previous?.tradingDate === tradingDate && previous.policy.maturityModel === PAPER_ADAPTIVE_POLICY.maturityModel
    && keys.every(key => previous.candidates.some(item => item.rule.feature === key));
  if (frozen && (previous.exploration?.rules.length || !observations.length)) return structuredClone(previous);
  const cutoffAt = new Date(`${tradingDate}T00:00:00+09:00`).toISOString();
  const all = matureRows(experiments, cutoffAt);
  const dates = [...new Set(all.map(row => row.experiment.tradingDate))].sort()
    .filter(date => !frozen || (previous.windowStartDate !== null && date >= previous.windowStartDate)).slice(-PAPER_ADAPTIVE_POLICY.windowEntryDates);
  const validationStartDate = frozen ? previous.validationStartDate : dates[Math.floor(dates.length * PAPER_ADAPTIVE_POLICY.trainingFraction)] ?? null;
  const rows = all.filter(row => dates.includes(row.experiment.tradingDate));
  const splitMs = validationStartDate ? Date.parse(`${validationStartDate}T00:00:00+09:00`) : Infinity;
  // Each holding period must finish before validation starts; unfinished longer periods cannot erase usable shorter outcomes.
  const train = rows.filter(row => validationStartDate && row.experiment.tradingDate < validationStartDate).flatMap(row => {
    const returns = row.returns.map((value, index) => row.availableAt[index] !== undefined && row.availableAt[index]! < splitMs ? value : undefined);
    return returns.some(value => value !== undefined) ? [{ ...row, returns }] : [];
  });
  const test = rows.filter(row => validationStartDate && row.experiment.tradingDate >= validationStartDate);
  const horizonSamples = horizons.map(horizon => {
    const usable = (source: Row[]) => source.filter(row => row.returns[horizons.indexOf(horizon)] !== undefined);
    const mature = usable(rows), training = usable(train), validation = usable(test);
    const dateCount = (source: Row[]) => new Set(source.map(row => row.experiment.tradingDate)).size;
    return { horizon, matureSampleCount: mature.length, matureDateCount: dateCount(mature),
      trainingSampleCount: training.length, trainingDateCount: dateCount(training),
      validationSampleCount: validation.length, validationDateCount: dateCount(validation) };
  });
  const computed = new Set<string>();
  const compute = (formula: PaperIndicatorFormula) => {
    const id = paperIndicatorFormulaId(formula);
    if (computed.has(id)) return;
    computed.add(id);
    for (const row of rows) {
      const value = paperIndicatorFormulaValue(formula, row.values);
      if (value !== null) row.values[id] = value;
    }
  };
  const forwardRows = (invention: PaperIndicatorInvention) => {
    compute(invention.formula);
    const created = Date.parse(invention.createdAt), createdDate = toKstDateKey(new Date(created));
    return rows.filter(row => Date.parse(row.experiment.entryAt) > created && row.experiment.tradingDate > createdDate);
  };
  const exploration = (candidates: PaperAdaptiveCandidate[]) => selectPaperShadowExploration({ previous, candidates, observations, asOf,
    value: (observation, feature, invention) => adaptiveFeatureValue(observation, feature, asOf, invention),
    evaluate: rule => candidate(rule, rule.invention ? [] : train, rule.invention ? forwardRows(rule.invention) : test, previous) });
  if (frozen) {
    const state = structuredClone(previous), trials = exploration(state.candidates);
    if (trials) state.exploration = trials;
    return state;
  }
  const candidates = keys.map(feature => chooseFeature(feature, train, test, previous));
  for (const invention of previous?.discovery?.inventions ?? []) {
    candidates.push(candidate({ feature: invention.id, ...invention.rule, invention: structuredClone(invention) },
      [], forwardRows(invention), previous));
  }
  rankCandidates(candidates, previous);
  const pairEligibility = new Map<string, boolean>();
  // A one-time same-day policy migration must not spend an existing discovery round's daily budget twice.
  const discovery = previous?.tradingDate === tradingDate && previous.discovery
    ? { discovery: structuredClone(previous.discovery), created: [], retired: [] }
    : discoverPaperIndicators({ previous, asOf, cutoffAt, candidates, programs,
    trainingDates: [...new Set(train.map(row => row.experiment.tradingDate))].sort(),
    sufficientInputs: formula => {
      const inputs = paperIndicatorFormulaOperands(formula).map(operand => operand.feature), pair = inputs.join(':');
      if (pairEligibility.has(pair)) return pairEligibility.get(pair)!;
      const counts = horizons.map(() => 0), dates = horizons.map(() => new Set<string>());
      for (const row of train) if (inputs.every(key => row.values[key] !== undefined)) {
        row.returns.forEach((value, index) => { if (value !== undefined) { counts[index]++; dates[index].add(row.experiment.tradingDate); } });
        if (counts.some((count, index) => count >= PAPER_ADAPTIVE_POLICY.minimumSamples && dates[index].size >= PAPER_ADAPTIVE_POLICY.minimumEntryDates)) break;
      }
      const eligible = counts.some((count, index) => count >= PAPER_ADAPTIVE_POLICY.minimumSamples && dates[index].size >= PAPER_ADAPTIVE_POLICY.minimumEntryDates);
      pairEligibility.set(pair, eligible); return eligible;
    },
    evaluateTraining: formula => { compute(formula); return chooseFormula(formula, train); },
    forwardDateCount: invention => new Set(forwardRows(invention).filter(row => row.values[invention.id] !== undefined
      && row.returns[horizons.indexOf(invention.rule.horizon)] !== undefined)
      .map(row => row.experiment.tradingDate)).size,
  });
  const retiredIds = new Set<string>(discovery.retired.map(item => item.id));
  const retainedCandidates = candidates.filter(item => !retiredIds.has(item.rule.feature));
  for (const invention of discovery.created) retainedCandidates.push(candidate({ feature: invention.id, ...invention.rule,
    invention: structuredClone(invention) }, [], [], previous));
  const changes = [...(previous?.changes ?? [])];
  for (const item of retainedCandidates) {
    const from = previous?.candidates.find(old => old.active && old.rule.feature === item.rule.feature)?.rule ?? null;
    const to = item.active ? item.rule : null;
    if ((from ? adaptiveRuleId(from) : null) !== (to ? adaptiveRuleId(to) : null)) {
      changes.push({ at: asOf, feature: item.rule.feature, from: from ? { ...from } : null, to: to ? { ...to } : null, reason: item.reason });
    }
  }
  for (const invention of discovery.retired) changes.push({ at: asOf, feature: invention.id,
    from: { feature: invention.id, ...invention.rule, invention: structuredClone(invention) }, to: null, reason: 'DISCOVERY_RETIRED' });
  for (const invention of discovery.created) changes.push({ at: asOf, feature: invention.id, from: null,
    to: { feature: invention.id, ...invention.rule, invention: structuredClone(invention) }, reason: 'FORWARD_OBSERVATION' });
  return { policy: { ...PAPER_ADAPTIVE_POLICY }, tradingDate, evaluatedAt: asOf, cutoffAt,
    windowStartDate: dates[0] ?? null, validationStartDate, matureSampleCount: rows.length, matureDateCount: dates.length, horizonSamples,
    candidates: retainedCandidates.sort(rank), discovery: discovery.discovery, changes: changes.slice(-100), exploration: exploration(retainedCandidates) };
}
