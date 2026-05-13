// @responsibility Shadow ledger 완결성 검사 — CRITICAL 안전 위반 감지
import { STALE_PENDING_BUSINESS_DAYS } from './shadowConstants.js';
import type { ShadowCaseLedgerStore } from './shadowCaseLedger.js';
import type { IntegrityIssue, IntegritySeverity, ShadowCase } from './shadowTypes.js';

const CLOSED_STATES = new Set(['SHADOW_POSITION_CLOSED', 'OUTCOME_LABELED', 'REFLECTION_READY', 'PARAM_UPDATE_CANDIDATE']);

function daysOld(iso?: string, now = Date.now()): number {
  if (!iso) return 0;
  return (now - new Date(iso).getTime()) / 86_400_000;
}

function issue(item: string, severity: IntegritySeverity, cases: ShadowCase[]): IntegrityIssue {
  return { item, severity, count: cases.length, examples: cases.slice(0, 5).map((c) => `${c.caseId}:${c.symbol}`) };
}

export function inspectShadowIntegrity(ledger: ShadowCaseLedgerStore, now: Date = new Date()): IntegrityIssue[] {
  const cases = ledger.listCases();
  const duplicateSignalIds = new Set<string>();
  const seen = new Set<string>();
  for (const c of cases) {
    if (seen.has(c.signalId)) duplicateSignalIds.add(c.signalId);
    seen.add(c.signalId);
  }
  const specs: Array<[string, IntegritySeverity, (c: ShadowCase) => boolean]> = [
    ['candidate_without_decision', 'WARN', (c) => c.state === 'CANDIDATE_DETECTED'],
    ['decision_without_order', 'WARN', (c) => ['DECISION_MADE', 'LIVE_BLOCKED_SHADOW_ALLOWED', 'SHADOW_ONLY'].includes(c.state ?? '') && c.shadowDecision !== 'TRACE_ONLY'],
    ['order_without_fill', 'WARN', (c) => c.state === 'SHADOW_ORDER_CREATED'],
    ['fill_without_position', 'ERROR', (c) => c.state === 'SHADOW_PAPER_FILLED'],
    ['open_without_monitor', 'WARN', (c) => c.state === 'SHADOW_POSITION_OPENED'],
    ['exit_triggered_without_close', 'ERROR', (c) => c.state === 'SHADOW_EXIT_TRIGGERED' || c.state === 'SHADOW_PAPER_SOLD'],
    ['closed_without_label', 'WARN', (c) => CLOSED_STATES.has(c.state ?? '') && !c.outcomeLabel],
    ['blocked_without_counterfactual', 'WARN', (c) => Boolean(c.blockedReason) && !c.counterfactualRecorded],
    ['stale_pending_outcome', 'WARN', (c) => c.outcomeLabel === 'ACTIVE' && daysOld(c.updatedAt, now.getTime()) >= STALE_PENDING_BUSINESS_DAYS],
    ['duplicate_signal', 'WARN', (c) => duplicateSignalIds.has(c.signalId)],
    ['duplicate_telegram', 'WARN', (c) => c.duplicateTelegramSuppressed === false],
    ['ledger_mismatch', 'CRITICAL', (c) => c.state === 'SHADOW_POSITION_CLOSED' && c.currentReturnPct !== undefined && c.finalReturnPct === undefined],
    ['executionImpact_not_NONE_in_shadow', 'CRITICAL', (c) => c.engineMode !== 'NORMAL' && c.executionImpact !== 'NONE'],
    ['live_order_created_in_shadow_mode', 'CRITICAL', (c) => ['SHADOW', 'SHADOW_ONLY', 'SELL_ONLY', 'HARD_BLOCK', 'OBSERVE_ONLY'].includes(c.engineMode) && Boolean(c.liveOrderCreated || c.brokerOrderCreated)],
  ];
  return specs.map(([item, severity, pred]) => issue(item, severity, cases.filter(pred))).filter((x) => x.count > 0);
}

export function summarizeIntegrity(issues: IntegrityIssue[]): { verdict: 'OK' | 'WARN' | 'ERROR'; critical: number; warn: number } {
  const critical = issues.filter((i) => i.severity === 'CRITICAL').reduce((s, i) => s + i.count, 0);
  const warn = issues.filter((i) => i.severity === 'WARN').reduce((s, i) => s + i.count, 0);
  const error = issues.filter((i) => i.severity === 'ERROR').reduce((s, i) => s + i.count, 0);
  return { verdict: critical || error ? 'ERROR' : warn ? 'WARN' : 'OK', critical, warn };
}
