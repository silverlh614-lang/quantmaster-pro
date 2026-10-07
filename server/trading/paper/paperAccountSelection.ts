// @responsibility Freeze daily virtual account policies from verified signal evidence.
import type { PaperAccountCandidate, PaperAccountLedger, PaperAccountSelection } from '../../../src/types/paperAccount.js';
import { paperAdaptiveRuleLabel, type PaperAdaptiveState, type PaperAdaptiveStats } from '../../../src/types/paperAdaptive.js';
import type { PaperSnapshot } from '../../../src/types/paperExperiment.js';
import type { PaperStrategyTrade } from '../../../src/types/paperStrategy.js';
import { signalRuleKey } from '../../../src/utils/paperTradeReview.js';
import { toKstDateKey, isKrxTradingDay } from '../../calendar/krxTradingCalendar.js';
import { PAPER_ADAPTIVE_POLICY } from './paperAdaptiveSelection.js';
import { paperEvidenceDigest } from './paperStrategyEvidence.js';
import { isValidPaperAdaptiveCandidate } from './paperAdaptiveValidation.js';

const compact = (stats: PaperAdaptiveStats): PaperAdaptiveStats => ({
  sampleCount: stats.sampleCount, dateCount: stats.dateCount, symbolCount: stats.symbolCount,
  experimentIdsDigest: stats.experimentIds ? paperEvidenceDigest(stats.experimentIds) : stats.experimentIdsDigest,
  meanNetReturnPct: stats.meanNetReturnPct, meanDailyExcessPct: stats.meanDailyExcessPct,
});
export function accountCandidateRank(a: PaperAccountCandidate, b: PaperAccountCandidate): number {
  return b.validation.meanNetReturnPct! - a.validation.meanNetReturnPct!
    || b.validation.meanDailyExcessPct! - a.validation.meanDailyExcessPct! || a.ruleKey.localeCompare(b.ruleKey);
}
export function accountStatsEligible(stats: PaperAdaptiveStats, samples: number, dates: number): boolean {
  return Number.isSafeInteger(stats.sampleCount) && stats.sampleCount >= samples
    && Number.isSafeInteger(stats.dateCount) && stats.dateCount >= dates && stats.dateCount <= stats.sampleCount
    && Number.isSafeInteger(stats.symbolCount) && stats.symbolCount > 0 && stats.symbolCount <= stats.sampleCount
    && Number.isFinite(stats.meanNetReturnPct) && stats.meanNetReturnPct! > 0
    && Number.isFinite(stats.meanDailyExcessPct) && stats.meanDailyExcessPct! > 0
    && (Array.isArray(stats.experimentIds) && stats.experimentIds.length === stats.sampleCount
      || typeof stats.experimentIdsDigest === 'string' && /^[a-f0-9]{64}$/.test(stats.experimentIdsDigest));
}
/** Missing/stale research is retried; a valid day with no eligible rule is a recorded decision to wait. */
export function selectAccountPolicy(account: PaperAccountLedger, state: PaperAdaptiveState | undefined, snapshot: PaperSnapshot): PaperAccountSelection | undefined {
  const existing = account.selections?.find(item => item.tradingDate === snapshot.tradingDate);
  if (existing) return existing;
  if (snapshot.quoteOnly || !snapshot.marketOpen || !isKrxTradingDay(snapshot.tradingDate) || !state
    || state.tradingDate !== snapshot.tradingDate || toKstDateKey(snapshot.asOf) !== snapshot.tradingDate
    || !(Date.parse(state.evaluatedAt) <= Date.parse(snapshot.asOf))
    || toKstDateKey(state.evaluatedAt) !== snapshot.tradingDate
    || Date.parse(state.cutoffAt) !== Date.parse(`${snapshot.tradingDate}T00:00:00+09:00`)
    || state.policy.version !== PAPER_ADAPTIVE_POLICY.version) return undefined;
  const minimumSamples = Math.max(PAPER_ADAPTIVE_POLICY.minimumSamples, state.policy.minimumSamples);
  const minimumEntryDates = Math.max(PAPER_ADAPTIVE_POLICY.minimumEntryDates, state.policy.minimumEntryDates);
  const candidates = state.candidates.filter(item => isValidPaperAdaptiveCandidate(item) && item.active && item.reason === 'ACTIVE'
    && (!item.rule.invention || Date.parse(item.rule.invention.createdAt) < Date.parse(state.cutoffAt))
    && accountStatsEligible(item.training, minimumSamples, minimumEntryDates)
    && accountStatsEligible(item.validation, minimumSamples, minimumEntryDates))
    .map(item => ({ rule: { ...structuredClone(item.rule), ...(item.rule.invention ? { invention: { ...structuredClone(item.rule.invention), training: compact(item.rule.invention.training) } } : {}) }, ruleKey: signalRuleKey(item.rule), label: paperAdaptiveRuleLabel(item.rule),
      training: compact(item.training), validation: compact(item.validation) })).sort(accountCandidateRank);
  const selection: PaperAccountSelection = { version: 'validated-net-v1', id: `validated-net-v1:${snapshot.tradingDate}`,
    tradingDate: snapshot.tradingDate, selectedAt: snapshot.asOf, sourceEvaluatedAt: state.evaluatedAt,
    cutoffAt: state.cutoffAt, minimumSamples, minimumEntryDates, candidates, selectedRuleKey: candidates[0]?.ruleKey ?? null };
  (account.selections ??= []).push(selection);
  return selection;
}
/** Only signals of the day's selected rule become account orders; the rest stay 1-week research. */
export function isAccountRuleSignal(trade: PaperStrategyTrade, selection: PaperAccountSelection | undefined): boolean {
  const evidence = trade.entryDecision.adaptiveEvidence;
  return !trade.entryDecision.explorationEvidence && !!selection?.selectedRuleKey && !!evidence
    && signalRuleKey(evidence.candidate.rule) === selection.selectedRuleKey;
}
export function accountEntryRefusal(trade: PaperStrategyTrade, selection: PaperAccountSelection | undefined): string {
  if (trade.entryDecision.explorationEvidence) return '계좌는 검증 기준만 운용 · 탐색 신호는 1주 연구로 유지';
  if (!selection) return '당일 계좌 기준을 선택할 유효한 연구 자료 대기';
  if (!selection.selectedRuleKey) return '당일 검증 수익성 기준을 통과한 운용 규칙 없음';
  const evidence = trade.entryDecision.adaptiveEvidence, chosen = selection.candidates[0];
  if (!evidence || !(Date.parse(evidence.evaluatedAt) <= Date.parse(trade.entryAt))
    || Date.parse(evidence.evaluatedAt) !== Date.parse(selection.sourceEvaluatedAt)
    || Date.parse(evidence.cutoffAt) !== Date.parse(selection.cutoffAt)
    || !evidence.candidate.active || evidence.candidate.reason !== 'ACTIVE') return '진입 당시 검증 근거 불일치';
  if (signalRuleKey(evidence.candidate.rule) !== chosen.ruleKey) return '당일 선택한 수익성 우선 규칙과 다른 신호';
  if (JSON.stringify(compact(evidence.candidate.training)) !== JSON.stringify(chosen.training)
    || JSON.stringify(compact(evidence.candidate.validation)) !== JSON.stringify(chosen.validation)) return '진입 당시 검증 성적 불일치';
  return '';
}
