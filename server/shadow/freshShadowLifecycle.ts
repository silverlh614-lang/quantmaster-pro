// @responsibility Fresh shadow lifecycle state transitions.
import type { ShadowCaseLedgerStore } from './shadowCaseLedger.js';
import type { IntegrityIssue, ShadowCase, ShadowLifecycleState, ShadowStateTransition } from './shadowTypes.js';

export const REQUIRED_FRESH_SAMPLES = 100;

const NORMAL_PATH: ShadowLifecycleState[] = [
  'CANDIDATE_DETECTED',
  'SHADOW_SIGNAL_APPROVED',
  'SHADOW_ORDER_CREATED',
  'SHADOW_PAPER_FILLED',
  'SHADOW_POSITION_OPENED',
  'SHADOW_MONITORING',
  'SHADOW_EXIT_TRIGGERED',
  'SHADOW_POSITION_CLOSED',
  'OUTCOME_LABELED',
];
const CLOSED_LABELS = new Set(['WIN', 'LOSS', 'BREAKEVEN', 'EXPIRED']);
const REPAIR_COHORTS = new Set(['GHOST_REPAIR', 'BACKLOG_REPAIR', 'RECOVERED_METADATA', 'QUARANTINED']);

function dayKey(iso: string | undefined, now: Date): string {
  const d = iso ? new Date(iso) : now;
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : now.toISOString().slice(0, 10);
}
function today(iso: string | undefined, now: Date): boolean { return dayKey(iso, now) === now.toISOString().slice(0, 10); }
function positive(n: unknown): n is number { return typeof n === 'number' && Number.isFinite(n) && n > 0; }
function statesFor(ledger: ShadowCaseLedgerStore, caseId: string): ShadowLifecycleState[] { return ledger.listTransitions(caseId).map((t) => t.to); }
function hasState(c: ShadowCase, ts: ShadowStateTransition[], s: ShadowLifecycleState): boolean { return c.state === s || ts.some((t) => t.to === s); }
function noRepairMarkers(c: ShadowCase): boolean { return !c.repairRunId && !c.backfillRunId && c.metadataRecovered !== true; }
export function isFreshShadowEligible(c: ShadowCase, transitions: ShadowStateTransition[] = [], now: Date = new Date()): boolean {
  return today(c.createdAt, now)
    && noRepairMarkers(c)
    && ['SHADOW', 'SHADOW_ONLY', 'OBSERVE_ONLY'].includes(c.engineMode)
    && (hasState(c, transitions, 'SHADOW_ORDER_CREATED') || hasState(c, transitions, 'SHADOW_PAPER_FILLED'))
    && !c.liveOrderCreated
    && !c.brokerOrderCreated
    && (c.brokerOrdersCreated ?? 0) === 0
    && c.executionImpact === 'NONE';
}
export function freshMetadataProblem(c: ShadowCase): 'entryPrice missing' | 'targetPrice missing' | 'stopPrice missing' | 'priceData missing' | undefined {
  if (c.dataHealth === 'EMPTY' || c.dataHealth === 'UNAVAILABLE') return 'priceData missing';
  if (!positive(c.entryPriceVirtual)) return 'entryPrice missing';
  if (!positive(c.targetPriceVirtual)) return 'targetPrice missing';
  if (!positive(c.stopPriceVirtual)) return 'stopPrice missing';
  return undefined;
}
export function prepareFreshShadowCase(input: ShadowCase, transitions: ShadowStateTransition[] = [], now: Date = new Date()): ShadowCase {
  const base: ShadowCase = { ...input, executionImpact: 'NONE', brokerOrdersCreated: input.brokerOrdersCreated ?? 0 };
  if (!isFreshShadowEligible(base, transitions, now)) return base;
  if (REPAIR_COHORTS.has(base.cohortType ?? '') && base.cohortType !== 'QUARANTINED') return base;
  const missing = freshMetadataProblem(base);
  if (missing === 'priceData missing') return { ...base, cohortType: 'QUARANTINED', state: 'QUARANTINED', pendingRetryReason: 'priceData missing' };
  if (missing) return { ...base, cohortType: 'QUARANTINED', state: 'QUARANTINED', outcomeLabel: 'QUARANTINED', quarantinedReason: missing };
  return {
    ...base,
    cohortType: 'FRESH_SHADOW',
    entryPriceSource: base.entryPriceSource ?? 'SHADOW_SIGNAL_PRICE',
    targetStopSource: base.targetStopSource ?? 'RISK_RULE_CALCULATED',
    riskRuleId: base.riskRuleId ?? 'fresh-shadow-default-risk-v1',
    rMultiple: base.rMultiple ?? Math.abs((base.targetPriceVirtual! - base.entryPriceVirtual!) / (base.entryPriceVirtual! - base.stopPriceVirtual!)),
    sourceConfidence: base.sourceConfidence ?? 'CALCULATED',
  };
}
function issue(item: string, severity: IntegrityIssue['severity'], rows: ShadowCase[]): IntegrityIssue {
  return { item, severity, count: rows.length, examples: rows.slice(0, 5).map((c) => `${c.caseId}:${c.symbol}`) };
}
export function inspectFreshShadowIntegrity(ledger: ShadowCaseLedgerStore, now: Date = new Date()): IntegrityIssue[] {
  const cases = ledger.listCases();
  const issues: IntegrityIssue[] = [];
  const freshish = cases.filter((c) => c.cohortType === 'FRESH_SHADOW' || (today(c.createdAt, now) && noRepairMarkers(c) && ['SHADOW', 'SHADOW_ONLY', 'OBSERVE_ONLY'].includes(c.engineMode) && c.state !== 'QUARANTINED'));
  const has = (c: ShadowCase, s: ShadowLifecycleState) => hasState(c, ledger.listTransitions(c.caseId), s);
  issues.push(issue('approved_without_order', 'WARN', freshish.filter((c) => has(c, 'SHADOW_SIGNAL_APPROVED') && !has(c, 'SHADOW_ORDER_CREATED'))));
  issues.push(issue('order_without_fill', 'WARN', freshish.filter((c) => has(c, 'SHADOW_ORDER_CREATED') && !has(c, 'SHADOW_PAPER_FILLED'))));
  issues.push(issue('fill_without_position', 'ERROR', freshish.filter((c) => has(c, 'SHADOW_PAPER_FILLED') && !has(c, 'SHADOW_POSITION_OPENED'))));
  issues.push(issue('position_without_monitor', 'WARN', freshish.filter((c) => has(c, 'SHADOW_POSITION_OPENED') && !has(c, 'SHADOW_MONITORING'))));
  issues.push(issue('exit_without_close', 'ERROR', freshish.filter((c) => has(c, 'SHADOW_EXIT_TRIGGERED') && !has(c, 'SHADOW_POSITION_CLOSED'))));
  issues.push(issue('close_without_label', 'WARN', freshish.filter((c) => has(c, 'SHADOW_POSITION_CLOSED') && !has(c, 'OUTCOME_LABELED') && !c.outcomeLabel)));
  issues.push(issue('fresh_case_missing_cohort', 'ERROR', cases.filter((c) => isFreshShadowEligible(c, ledger.listTransitions(c.caseId), now) && !freshMetadataProblem(c) && c.cohortType !== 'FRESH_SHADOW')));
  issues.push(issue('fresh_case_marked_as_ghost_repair', 'CRITICAL', cases.filter((c) => isFreshShadowEligible(c, ledger.listTransitions(c.caseId), now) && REPAIR_COHORTS.has(c.cohortType ?? ''))));
  issues.push(issue('executionImpact_not_NONE', 'CRITICAL', freshish.filter((c) => c.executionImpact !== 'NONE')));
  issues.push(issue('broker_order_created_in_shadow', 'CRITICAL', freshish.filter((c) => Boolean(c.liveOrderCreated || c.brokerOrderCreated) || (c.brokerOrdersCreated ?? 0) > 0)));
  return issues.filter((i) => i.count > 0);
}
function avg(xs: number[]): number { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
function rate(n: number, d: number, empty = 0): number { return d === 0 ? empty : n / d; }
function retR(c: ShadowCase): number { return typeof c.returnR === 'number' ? c.returnR : (c.finalReturnPct ?? 0); }
export function collectFreshShadowStatus(ledger: ShadowCaseLedgerStore, now: Date = new Date()) {
  const cases = ledger.listCases();
  const transitions = ledger.listTransitions();
  const fresh = cases.filter((c) => c.cohortType === 'FRESH_SHADOW');
  const closed7d = fresh.filter((c) => CLOSED_LABELS.has(c.outcomeLabel ?? '') && new Date(c.updatedAt).getTime() >= now.getTime() - 7 * 86400000);
  const wins = fresh.filter((c) => c.outcomeLabel === 'WIN');
  const losses = fresh.filter((c) => c.outcomeLabel === 'LOSS');
  const closed = fresh.filter((c) => CLOSED_LABELS.has(c.outcomeLabel ?? ''));
  const lifecycleBreaks = inspectFreshShadowIntegrity(ledger, now).filter((i) => i.severity !== 'CRITICAL').reduce((s, i) => s + i.count, 0);
  const critical = inspectFreshShadowIntegrity(ledger, now).filter((i) => i.severity === 'CRITICAL');
  const countToday = (s: ShadowLifecycleState) => transitions.filter((t) => t.to === s && today(t.timestamp, now)).length + cases.filter((c) => c.state === s && today(c.updatedAt, now) && !transitions.some((t) => t.caseId === c.caseId && t.to === s)).length;
  return {
    todayFreshCandidates: cases.filter((c) => today(c.createdAt, now) && noRepairMarkers(c) && ['SHADOW', 'SHADOW_ONLY', 'OBSERVE_ONLY'].includes(c.engineMode)).length,
    todayFreshApproved: countToday('SHADOW_SIGNAL_APPROVED'),
    todayShadowOrdersCreated: countToday('SHADOW_ORDER_CREATED'),
    todayPaperFilled: countToday('SHADOW_PAPER_FILLED'),
    todayPositionsOpened: countToday('SHADOW_POSITION_OPENED'),
    todayPositionsClosed: countToday('SHADOW_POSITION_CLOSED'),
    todayOutcomeLabeled: countToday('OUTCOME_LABELED'),
    freshShadowOpen: fresh.filter((c) => !CLOSED_LABELS.has(c.outcomeLabel ?? '')).length,
    freshShadowClosed7d: closed7d.length,
    freshShadowWin: wins.length,
    freshShadowLoss: losses.length,
    freshShadowExpectancyR: avg(closed.map(retR)),
    lifecycleBreaks,
    executionImpactViolations: critical.filter((i) => i.item === 'executionImpact_not_NONE').reduce((s, i) => s + i.count, 0),
    brokerOrdersCreated: fresh.reduce((s, c) => s + (c.brokerOrdersCreated ?? (c.brokerOrderCreated ? 1 : 0)), 0),
  };
}
export function collectFreshShadowLifecycle(ledger: ShadowCaseLedgerStore, limit = 5) {
  return ledger.listCases().filter((c) => c.cohortType === 'FRESH_SHADOW' || isFreshShadowEligible(c, ledger.listTransitions(c.caseId))).slice(-limit).reverse().map((c) => {
    const issues = inspectFreshShadowIntegrity(ledger).filter((i) => i.examples.some((e) => e.startsWith(`${c.caseId}:`)));
    return {
      caseId: c.caseId,
      symbol: c.symbol,
      createdAt: c.createdAt,
      currentState: c.state,
      cohortType: c.cohortType,
      transitions: statesFor(ledger, c.caseId),
      entryPrice: c.entryPriceVirtual,
      targetPrice: c.targetPriceVirtual,
      stopPrice: c.stopPriceVirtual,
      outcomeLabel: c.outcomeLabel,
      executionImpact: c.executionImpact,
      integrityStatus: issues.some((i) => i.severity === 'CRITICAL') ? 'CRITICAL' : issues.length ? 'WARN' : 'OK',
    };
  });
}
export function collectFreshOnlyPromotion(ledger: ShadowCaseLedgerStore, returnFlowHitRate = 1) {
  const fresh = ledger.listCases().filter((c) => c.cohortType === 'FRESH_SHADOW');
  const closed = fresh.filter((c) => CLOSED_LABELS.has(c.outcomeLabel ?? ''));
  const wins = closed.filter((c) => c.outcomeLabel === 'WIN');
  const losses = closed.filter((c) => c.outcomeLabel === 'LOSS');
  const labelDen = fresh.filter((c) => c.state === 'SHADOW_POSITION_CLOSED' || c.state === 'OUTCOME_LABELED' || CLOSED_LABELS.has(c.outcomeLabel ?? '')).length;
  const freshExpectancyR = fresh.length === 0 ? 'N/A' as const : avg(closed.map(retR));
  const blockers = fresh.length === 0 ? ['NO_FRESH_SAMPLE'] : fresh.length < REQUIRED_FRESH_SAMPLES ? ['FRESH_SAMPLE_SIZE_LT_100'] : [];
  return { basis: 'FRESH_ONLY' as const, freshSampleSize: fresh.length, freshClosedSampleSize: closed.length, freshWinRate: rate(wins.length, wins.length + losses.length), freshExpectancyR, freshExpectancyReason: fresh.length === 0 ? 'NO_FRESH_SAMPLE' as const : undefined, freshReturnFlowHitRate: returnFlowHitRate, freshLabelCompletionRate: rate(closed.length, labelDen, 1), requiredFreshSamples: REQUIRED_FRESH_SAMPLES, promotionAllowed: false, blocker: blockers[0] ?? 'PROMOTION_DISABLED_UNTIL_MANUAL_REVIEW', blockers };
}
export function formatFreshShadowStatus(s: ReturnType<typeof collectFreshShadowStatus>): string {
  return ['🌱 <b>[Fresh Shadow Status]</b>', ...Object.entries(s).map(([k, v]) => `- ${k}: ${typeof v === 'number' ? Number(v.toFixed(4)) : v}`)].join('\n');
}
export function formatFreshShadowLifecycle(rows: ReturnType<typeof collectFreshShadowLifecycle>): string {
  return ['🌿 <b>[Fresh Shadow Lifecycle]</b>', ...rows.map((r) => `- caseId=${r.caseId} symbol=${r.symbol} createdAt=${r.createdAt} currentState=${r.currentState} cohortType=${r.cohortType} transitions=${r.transitions.join('>')} entryPrice=${r.entryPrice ?? 'N/A'} targetPrice=${r.targetPrice ?? 'N/A'} stopPrice=${r.stopPrice ?? 'N/A'} outcomeLabel=${r.outcomeLabel ?? 'N/A'} executionImpact=${r.executionImpact} integrityStatus=${r.integrityStatus}`)].join('\n');
}
export function formatFreshOnlyPromotion(p: ReturnType<typeof collectFreshOnlyPromotion>): string {
  return [`basis=${p.basis}`, `freshSampleSize=${p.freshSampleSize}`, `freshClosedSampleSize=${p.freshClosedSampleSize}`, `freshWinRate=${p.freshWinRate.toFixed(4)}`, `freshExpectancyR=${typeof p.freshExpectancyR === 'number' ? p.freshExpectancyR.toFixed(4) : 'N/A'}`, `freshReturnFlowHitRate=${p.freshReturnFlowHitRate.toFixed(4)}`, `freshLabelCompletionRate=${p.freshLabelCompletionRate.toFixed(4)}`, `requiredFreshSamples=${p.requiredFreshSamples}`, `promotionAllowed=${p.promotionAllowed}`, `reason=${p.freshExpectancyReason ?? 'OK'}`, `blocker=${p.blocker}`].join('\n');
}
