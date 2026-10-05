// @responsibility Allocate new Shadow entries with frozen exploratory outcome evidence.
import type { PaperAdaptiveCandidate, PaperAdaptiveState, PaperExplorationTrial } from '../../../src/types/paperAdaptive.js';
import { paperAutonomyAssignment, paperAutonomyRuleKey, type PaperAutonomyAllocation, type PaperAutonomyState } from '../../../src/types/paperAutonomy.js';
import { toKstDateKey } from '../../calendar/krxTradingCalendar.js';
import { paperAutonomyAllocationSchema, paperAutonomyStateSchema } from './paperAutonomyValidation.js';

interface Choice { candidate: PaperAdaptiveCandidate; trial?: PaperExplorationTrial }
/** Recover only current allocation metadata; historical trades keep their original evidence. */
export function recoverPaperAutonomyState(adaptive: PaperAdaptiveState): void {
  const exploration = adaptive.exploration, state = exploration?.autonomy;
  if (!exploration || !state) return;
  const valid = paperAutonomyStateSchema.safeParse(state).success && state.cutoffAt === adaptive.cutoffAt
    && exploration.rules.every(trial => trial.registeredAt === state.evaluatedAt)
    && (state.status === 'FALLBACK' || exploration.rules.length === state.selectedRuleKeys.length
      && exploration.rules.every(trial => state.selectedRuleKeys.includes(paperAutonomyRuleKey(trial.candidate.rule))));
  if (valid) return;
  console.error('[PaperAutonomy] 현재 배분 근거 불일치, 기존 배정 상태로 복귀');
  exploration.autonomy = { version: 'shadow-autonomy-v1', status: 'FALLBACK', entries: [], selectedRuleKeys: [],
    evaluatedAt: exploration.rules[0]?.registeredAt ?? adaptive.evaluatedAt, cutoffAt: adaptive.cutoffAt,
    fallbackReason: '현재 배분 근거 불일치 · 기존 배정 유지' };
}
export function allocatePaperAutonomyEntry<T extends Choice>(matching: T[], state: PaperAutonomyState | undefined, symbol: string, asOf: string): {
  choice: T; allocation?: PaperAutonomyAllocation;
} {
  const identity = (item: T) => `${item.trial?.id ?? 'validated'}:${item.candidate.rule.feature}:${item.candidate.rule.bucket}:D${item.candidate.rule.horizon}`;
  const ordered = [...matching].sort((a, b) => identity(a).localeCompare(identity(b)));
  const date = toKstDateKey(asOf), cutoffAt = new Date(`${date}T00:00:00+09:00`).toISOString();
  const baseline = paperAutonomyAssignment(symbol, date, ordered.map(() => 2));
  if (!state) return { choice: ordered[baseline] };
  const fallback = (): PaperAutonomyAllocation => ({ version: 'shadow-autonomy-v1', evaluatedAt: asOf, cutoffAt,
    method: 'LEGACY_FALLBACK', baselineRuleKey: paperAutonomyRuleKey(ordered[baseline].candidate.rule),
    selectedRuleKey: paperAutonomyRuleKey(ordered[baseline].candidate.rule), choices: ordered.map(item => ({
      ruleKey: paperAutonomyRuleKey(item.candidate.rule), purpose: item.trial ? 'EXPLORATION' : 'VALIDATED', weight: 2, reason: 'FALLBACK',
    })) });
  let allocation = fallback();
  if (state.status !== 'FALLBACK') try {
    paperAutonomyStateSchema.parse(state);
    if (state.cutoffAt !== cutoffAt || Date.parse(state.evaluatedAt) > Date.parse(asOf)) throw new Error('연구 배분 시각 불일치');
    const choices: PaperAutonomyAllocation['choices'] = ordered.map(item => {
      const ruleKey = paperAutonomyRuleKey(item.candidate.rule);
      if (!item.trial) return { ruleKey, purpose: 'VALIDATED', weight: 2, reason: 'FIXED_VALIDATED' };
      const saved = state.entries.find(entry => entry.ruleKey === ruleKey);
      if (!saved || !state.selectedRuleKeys.includes(ruleKey)) throw new Error('연구 배분 근거 미확인');
      return { ruleKey, purpose: 'EXPLORATION', weight: saved.weight, reason: saved.reason, stats: structuredClone(saved.stats) };
    });
    const index = paperAutonomyAssignment(symbol, date, choices.map(item => item.weight));
    allocation = { ...allocation, method: 'OUTCOME_WEIGHTED', evaluatedAt: state.evaluatedAt,
      choices, selectedRuleKey: choices[index].ruleKey };
    paperAutonomyAllocationSchema.parse(allocation);
  } catch (error) {
    console.error('[PaperAutonomy] 진입 배분 실패, 기존 배정 유지:', error instanceof Error ? error.message : '계산 오류');
    allocation = fallback();
  }
  return { choice: ordered.find(item => paperAutonomyRuleKey(item.candidate.rule) === allocation.selectedRuleKey)!, allocation };
}
