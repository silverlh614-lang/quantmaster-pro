// @responsibility Register bounded Shadow trials from observed feature ranges.
import type { PaperAdaptiveCandidate, PaperAdaptiveFeatureKey, PaperAdaptiveRule, PaperAdaptiveState,
  PaperIndicatorInvention } from '../../../src/types/paperAdaptive.js';
import type { PaperObservation } from '../../../src/types/paperExperiment.js';
import { PAPER_FEATURES, type PaperFeatureKey } from '../../../src/types/paperObservationFeatures.js';
import { PAPER_INVENTED_FEATURE_CUTS } from '../../../src/types/paperIndicatorFormula.js';
import { toKstDateKey } from '../../calendar/krxTradingCalendar.js';
import type { PaperStrategyTrade } from '../../../src/types/paperStrategy.js';
import { paperAutonomyRuleKey } from '../../../src/types/paperAutonomy.js';
import { buildPaperAutonomy } from './paperAutonomy.js';
import { paperAutonomyStateSchema } from './paperAutonomyValidation.js';

const pending = new Set(['MISSING_INPUT', 'INSUFFICIENT_TRAINING', 'INSUFFICIENT_VALIDATION', 'FORWARD_OBSERVATION']);
const eligible = (item: PaperAdaptiveCandidate) => !item.active && pending.has(item.reason);
const horizons = [1, 3, 5] as const;
const rotate = <T>(items: T[], offset: number): T[] => items.length
  ? [...items.slice(offset % items.length), ...items.slice(0, offset % items.length)] : [];

export function selectPaperShadowExploration(input: {
  previous: PaperAdaptiveState | undefined; candidates: PaperAdaptiveCandidate[];
  observations: PaperObservation[]; asOf: string;
  trades?: readonly PaperStrategyTrade[];
  value: (observation: PaperObservation, feature: PaperAdaptiveFeatureKey, invention?: PaperIndicatorInvention) => number | null;
  evaluate: (rule: PaperAdaptiveRule) => PaperAdaptiveCandidate;
}): PaperAdaptiveState['exploration'] {
  const tradingDate = toKstDateKey(new Date(input.asOf));
  const sameDay = input.previous?.tradingDate === tradingDate;
  if (sameDay && input.previous?.exploration?.rules.length) return structuredClone(input.previous.exploration);
  const autonomous = input.trades !== undefined || Boolean(input.previous?.exploration?.autonomy);
  const observations = input.observations.filter(item => /^\d{6}$/.test(item.symbol) && !item.issue
    && item.price !== null && Number.isFinite(item.price) && item.price > 0
    && Date.parse(item.observedAt) <= Date.parse(input.asOf)
    && toKstDateKey(new Date(item.observedAt)) === tradingDate);
  const baseKeys = Object.keys(PAPER_FEATURES) as PaperFeatureKey[];
  // Empty snapshots retain allocation history without registering or freezing any old trial.
  if (!autonomous && !observations.some(item => baseKeys.some(feature => input.value(item, feature) !== null))) return undefined;
  const sequence = sameDay && input.previous?.exploration ? input.previous.exploration.sequence
    : (input.previous?.exploration?.sequence ?? 0) + 1;
  const seed = Math.floor(Date.parse(`${tradingDate}T00:00:00Z`) / 86_400_000);
  const rules: NonNullable<PaperAdaptiveState['exploration']>['rules'] = [];
  const availableBuckets = (rule: PaperAdaptiveRule): number[] => {
    const cuts: readonly number[] = rule.invention ? PAPER_INVENTED_FEATURE_CUTS : PAPER_FEATURES[rule.feature as PaperFeatureKey].cuts;
    return [...new Set(observations.flatMap(observation => {
      const value = input.value(observation, rule.feature, rule.invention);
      return value === null ? [] : [cuts.filter(cut => value >= cut).length];
    }))].sort((a, b) => a - b);
  };
  const register = (rule: PaperAdaptiveRule) => {
    const evaluated = input.evaluate(rule);
    if (!eligible(evaluated)) return false;
    rules.push({ id: `shadow-exploration-v1:${tradingDate}:${sequence}:${rule.feature}:${rule.bucket}:D${rule.horizon}`,
      registeredAt: input.asOf, candidate: structuredClone(evaluated) });
    return true;
  };
  // A discovered formula keeps its original range, holding period, birth date, and training evidence.
  const inventions = input.candidates.filter(item => item.rule.invention && eligible(item))
    .sort((a, b) => b.rule.invention!.createdAt.localeCompare(a.rule.invention!.createdAt) || a.rule.feature.localeCompare(b.rule.feature));
  for (const item of inventions) {
    if (Date.parse(item.rule.invention!.createdAt) <= Date.parse(input.asOf) && availableBuckets(item.rule).includes(item.rule.bucket)) register(item.rule);
    if (rules.length === 2 && !autonomous) break;
  }
  const bases = rotate(input.candidates.filter(item => !item.rule.invention && eligible(item))
    .map(item => ({ item, buckets: availableBuckets(item.rule) })).filter(item => item.buckets.length)
    .sort((a, b) => a.item.rule.feature.localeCompare(b.item.rule.feature)), seed);
  for (const [index, { item, buckets: available }] of bases.entries()) {
    if (rules.length === 2 && !autonomous) break;
    const buckets = rotate(available, sequence - 1 + index);
    let registered = false;
    for (const bucket of buckets) {
      for (const horizon of rotate([...horizons], sequence - 1 + index)) {
        if (register({ feature: item.rule.feature, bucket, horizon })) { registered = true; break; }
      }
      if (registered) break;
    }
  }
  if (!autonomous) return { version: 'shadow-exploration-v1', sequence, rules };
  try {
    const autonomy = buildPaperAutonomy(rules.map(item => item.candidate), rules.length ? input.trades ?? [] : [],
      input.previous?.exploration?.autonomy, input.asOf);
    if (!rules.length) {
      paperAutonomyStateSchema.parse(autonomy);
      return { version: 'shadow-exploration-v1', sequence, rules, autonomy };
    }
    const entry = (trial: typeof rules[number]) => autonomy.entries.find(item => item.ruleKey === paperAutonomyRuleKey(trial.candidate.rule))!;
    // One evidence-priority slot plus one least-recently-selected slot preserves exploration access.
    const ordered = [...rules].sort((a, b) => entry(b).weight - entry(a).weight || entry(a).stats.sampleCount - entry(b).stats.sampleCount);
    const first = ordered[0];
    const signature = (trial: typeof rules[number]) => {
      const rule = trial.candidate.rule;
      const cuts = rule.invention ? PAPER_INVENTED_FEATURE_CUTS : PAPER_FEATURES[rule.feature as PaperFeatureKey].cuts;
      return [...new Set(observations.filter(observation => {
        const value = input.value(observation, rule.feature, rule.invention);
        return value !== null && cuts.filter(cut => value >= cut).length === rule.bucket;
      }).map(item => item.symbol))].sort().join(',');
    };
    const firstSignature = signature(first), rest = rules.filter(item => item !== first);
    const diverse = rest.filter(item => signature(item) !== firstSignature);
    const second = (diverse.length ? diverse : rest).sort((a, b) =>
      (entry(a).lastSelectedAt ?? '').localeCompare(entry(b).lastSelectedAt ?? '') || entry(a).stats.sampleCount - entry(b).stats.sampleCount)[0];
    const selected = second ? [first, second] : [first];
    autonomy.selectedRuleKeys = selected.map(item => paperAutonomyRuleKey(item.candidate.rule));
    autonomy.selectionHistory = [...(autonomy.selectionHistory ?? []).filter(item => !autonomy.selectedRuleKeys.includes(item.ruleKey)),
      ...autonomy.selectedRuleKeys.map(ruleKey => ({ ruleKey, selectedAt: input.asOf }))].slice(-256);
    for (const item of autonomy.entries) item.lastSelectedAt = autonomy.selectionHistory.find(row => row.ruleKey === item.ruleKey)?.selectedAt ?? null;
    paperAutonomyStateSchema.parse(autonomy);
    return { version: 'shadow-exploration-v1', sequence, rules: selected, autonomy };
  } catch (error) {
    console.error('[PaperAutonomy] 연구 배분 실패, 기존 순환 유지:', error instanceof Error ? error.message : '평가 오류');
    return { version: 'shadow-exploration-v1', sequence, rules: rules.slice(0, 2), autonomy: {
      version: 'shadow-autonomy-v1', evaluatedAt: input.asOf, cutoffAt: new Date(`${tradingDate}T00:00:00+09:00`).toISOString(),
      status: 'FALLBACK', entries: [], selectedRuleKeys: [], fallbackReason: '연구 배분 계산을 확인할 때까지 기존 순환 방식을 사용합니다.',
    } };
  }
}
