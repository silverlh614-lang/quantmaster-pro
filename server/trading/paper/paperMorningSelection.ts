// @responsibility Select dated morning recommendations from frozen Shadow observations.
import type { PaperAdaptiveCandidate, PaperAdaptiveRule } from '../../../src/types/paperAdaptive.js';
import type { PaperObservation } from '../../../src/types/paperExperiment.js';
import type { PaperMorningPick, PaperMorningSelection, PaperMorningSource } from '../../../src/types/paperMorning.js';
import { PAPER_FEATURES, type PaperFeatureKey } from '../../../src/types/paperObservationFeatures.js';
import { PAPER_INVENTED_FEATURE_CUTS, paperIndicatorFormulaId, validPaperIndicatorFormula } from '../../../src/types/paperIndicatorFormula.js';
import { isKrxTradingDay, previousKrxTradingDay, toKstDateKey } from '../../calendar/krxTradingCalendar.js';
import { adaptiveFeatureValue, adaptiveRuleId, adaptiveRuleMatches } from './paperAdaptiveSelection.js';

const pending = new Set(['MISSING_INPUT', 'INSUFFICIENT_TRAINING', 'INSUFFICIENT_VALIDATION', 'FORWARD_OBSERVATION']);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const positive = (value: unknown): value is number => finite(value) && value > 0;
const score = (pick: PaperMorningPick) => {
  const value = (pick.purpose === 'VALIDATED' ? pick.candidate.validation : pick.candidate.training).meanDailyExcessPct;
  return finite(value) ? value : -Infinity;
};
const turnover = (pick: PaperMorningPick) => {
  const value = pick.observation.features?.values.turnover20;
  return finite(value) ? value : -Infinity;
};
const rank = (left: PaperMorningPick, right: PaperMorningPick) => Number(left.purpose === 'EXPLORATION') - Number(right.purpose === 'EXPLORATION')
  || score(right) - score(left) || turnover(right) - turnover(left) || left.symbol.localeCompare(right.symbol)
  || adaptiveRuleId(left.candidate.rule).localeCompare(adaptiveRuleId(right.candidate.rule));

function validRule(rule: PaperAdaptiveRule, evaluatedAt: string): boolean {
  if (![1, 3, 5].includes(rule.horizon) || !Number.isInteger(rule.bucket) || rule.bucket < 0) return false;
  const invention = rule.invention;
  if (!invention) return Object.hasOwn(PAPER_FEATURES, rule.feature) && rule.bucket <= PAPER_FEATURES[rule.feature as PaperFeatureKey].cuts.length;
  return validPaperIndicatorFormula(invention.formula) && paperIndicatorFormulaId(invention.formula) === rule.feature && invention.id === rule.feature
    && invention.rule.bucket === rule.bucket && invention.rule.horizon === rule.horizon && rule.bucket <= PAPER_INVENTED_FEATURE_CUTS.length
    && Date.parse(invention.discoveryCutoffAt) <= Date.parse(invention.createdAt) && Date.parse(invention.createdAt) <= Date.parse(evaluatedAt);
}

function validObservation(observation: PaperObservation, asOf: string, tradingDate: string, technicalDate: string): boolean {
  const features = observation.features;
  return /^\d{6}$/.test(observation.symbol) && positive(observation.price) && !observation.issue
    && toKstDateKey(observation.observedAt) === tradingDate && Date.parse(observation.observedAt) <= Date.parse(asOf)
    && features?.version === 'observation-features-v1' && features.technicalDate === technicalDate
    && toKstDateKey(features.asOf) === tradingDate && Date.parse(features.asOf) <= Date.parse(asOf);
}

export function buildPaperMorningSelection(source: PaperMorningSource | null, now: Date): PaperMorningSelection {
  if (!Number.isFinite(now.getTime())) throw new Error('아침 추천 생성 시각 오류');
  const tradingDate = toKstDateKey(now), scheduledAt = new Date(`${tradingDate}T08:30:00+09:00`).toISOString();
  const result: PaperMorningSelection = { version: 'morning-recommendation-v1', id: `paper:recommendation:${tradingDate}`,
    tradingDate, scheduledAt, createdAt: now.toISOString(), status: 'DATA_UNAVAILABLE', reason: '',
    sourceSnapshotId: null, sourceAsOf: null, adaptiveEvaluatedAt: null, adaptiveCutoffAt: null,
    consideredCount: 0, matchedCount: 0, heldCount: 0, picks: [] };
  if (now.getTime() < Date.parse(scheduledAt)) return { ...result, reason: '08:30 추천 시각 전입니다.' };
  if (!isKrxTradingDay(tradingDate)) return { ...result, status: 'HOLIDAY', reason: '휴장일입니다. 신규 추천 대신 연구 현황을 확인합니다.' };
  if (!source || source.version !== 'morning-source-v1') return { ...result, reason: '저장된 아침 관측 자료가 없습니다.' };
  const { snapshot, adaptive } = source, sourceMs = Date.parse(snapshot.asOf), endMs = Date.parse(scheduledAt);
  if (!snapshot.id.trim() || snapshot.tradingDate !== tradingDate || toKstDateKey(snapshot.asOf) !== tradingDate
    || !(sourceMs >= endMs - 90 * 60_000 && sourceMs <= endMs)) {
    return { ...result, reason: '당일 07:00~08:30에 수집을 마친 관측 자료가 필요합니다.' };
  }
  const cutoffAt = new Date(`${tradingDate}T00:00:00+09:00`).toISOString();
  if (adaptive.tradingDate !== tradingDate || toKstDateKey(adaptive.evaluatedAt) !== tradingDate
    || !(Date.parse(adaptive.evaluatedAt) <= sourceMs) || Date.parse(adaptive.cutoffAt) !== Date.parse(cutoffAt)
    || !(Date.parse(adaptive.cutoffAt) <= Date.parse(adaptive.evaluatedAt))) {
    return { ...result, reason: '관측 시각까지 확정된 당일 연구 상태를 확인할 수 없습니다.' };
  }
  Object.assign(result, { sourceSnapshotId: snapshot.id, sourceAsOf: snapshot.asOf,
    adaptiveEvaluatedAt: adaptive.evaluatedAt, adaptiveCutoffAt: adaptive.cutoffAt });
  const technicalDate = previousKrxTradingDay(now), closeAt = Date.parse(`${technicalDate}T15:30:00+09:00`);
  const counts = new Map<string, number>();
  for (const observation of snapshot.observations) counts.set(observation.symbol, (counts.get(observation.symbol) ?? 0) + 1);
  const held = new Set(source.openSymbols), matches: PaperMorningPick[] = [];
  const active = adaptive.candidates.filter(item => item.active && item.reason === 'ACTIVE' && validRule(item.rule, adaptive.evaluatedAt));
  const trials = (adaptive.exploration?.rules ?? []).filter(item => !item.candidate.active && pending.has(item.candidate.reason)
    && validRule(item.candidate.rule, adaptive.evaluatedAt) && toKstDateKey(item.registeredAt) === tradingDate
    && Date.parse(item.registeredAt) <= sourceMs
    && (!item.candidate.rule.invention || Date.parse(item.candidate.rule.invention.createdAt) <= Date.parse(item.registeredAt)));
  for (const observation of snapshot.observations) {
    if (counts.get(observation.symbol) !== 1 || !validObservation(observation, snapshot.asOf, tradingDate, technicalDate)) continue;
    const closes = observation.dailyCloses.filter(item => item.tradingDate === technicalDate);
    if (closes.length !== 1 || !positive(closes[0].close) || !(Date.parse(closes[0].availableAt) >= closeAt)
      || !(Date.parse(closes[0].availableAt) <= sourceMs)) continue;
    result.consideredCount++;
    if (held.has(observation.symbol)) { result.heldCount++; continue; }
    let best: PaperMorningPick | undefined;
    const consider = (candidate: PaperAdaptiveCandidate, purpose: PaperMorningPick['purpose'], trial?: PaperMorningPick['trial']) => {
      if (!adaptiveRuleMatches(observation, candidate.rule, snapshot.asOf)) return;
      const value = adaptiveFeatureValue(observation, candidate.rule.feature, snapshot.asOf, candidate.rule.invention);
      if (value === null) return;
      const choice: PaperMorningPick = { rank: 0, symbol: observation.symbol, name: observation.name, purpose, referenceClose: closes[0],
        observation, candidate, ruleValue: value, ...(trial ? { trial } : {}) };
      if (!best || rank(choice, best) < 0) best = choice;
    };
    for (const candidate of active) consider(candidate, 'VALIDATED');
    if (!best) for (const trial of trials) if (Date.parse(trial.registeredAt) < Date.parse(observation.observedAt)
      && Date.parse(trial.registeredAt) < Date.parse(observation.features!.asOf)) {
      consider(trial.candidate, 'EXPLORATION', { id: trial.id, registeredAt: trial.registeredAt });
    }
    if (best) matches.push(best);
  }
  result.matchedCount = matches.length;
  // Clone only the winners, keeping each pick and its reference close independent.
  result.picks = matches.sort(rank).slice(0, 3).map((pick, index) => structuredClone({ ...pick, rank: index + 1,
    referenceClose: { ...pick.referenceClose } }));
  if (!result.consideredCount) return { ...result, reason: '전일 확정 지표와 종가를 갖춘 유효 관측이 없습니다.' };
  if (!result.picks.length) return { ...result, status: 'NO_MATCH', reason: result.heldCount === result.consideredCount
    ? '관측 종목은 모두 보유 중이어서 신규 추천이 없습니다.' : '연결된 검증·탐색 규칙에 맞는 신규 종목이 없습니다.' };
  const validated = result.picks.filter(item => item.purpose === 'VALIDATED').length;
  return { ...result, status: 'READY', reason: `검증 추천 ${validated}개 · 탐색 추천 ${result.picks.length - validated}개(검증 전)` };
}
