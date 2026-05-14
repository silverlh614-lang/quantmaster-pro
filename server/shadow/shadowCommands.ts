// @responsibility Shadow Telegram/control command formatter — Telegram 요약, 상세는 server log
import { collectFreshOnlyPromotion, collectFreshShadowLifecycle, collectFreshShadowStatus, formatFreshOnlyPromotion, formatFreshShadowLifecycle, formatFreshShadowStatus, inspectFreshShadowIntegrity } from './freshShadowLifecycle.js';
import { inspectShadowIntegrity, summarizeIntegrity } from './shadowIntegrityGuard.js';
import type { ShadowCaseLedgerStore } from './shadowCaseLedger.js';
import { buildPromotionReport } from './shadowPromotionGate.js';
import type { ReturnFlowMetrics } from './shadowReturnFlow.js';

export function formatShadowStatus(ledger: ShadowCaseLedgerStore): string {
  const cases = ledger.listCases();
  return [
    '🌑 <b>[Shadow Status]</b>',
    '- engine: alive',
    '- tradingMode: SHADOW',
    '- liveExecutionAllowed: false',
    '- executionImpact: NONE',
    `- todaySignals: ${cases.length}`,
    `- paperFilled: ${cases.filter((c) => c.state === 'SHADOW_PAPER_FILLED').length}`,
    `- openPositions: ${cases.filter((c) => c.outcomeLabel === 'ACTIVE').length}`,
    `- closedToday: ${cases.filter((c) => c.outcomeLabel && c.outcomeLabel !== 'ACTIVE').length}`,
    `- pendingLabels: ${cases.filter((c) => c.state === 'SHADOW_POSITION_CLOSED' && !c.outcomeLabel).length}`,
    `- duplicateSuppressed: ${cases.filter((c) => c.duplicateTelegramSuppressed).length}`,
  ].join('\n');
}

export function formatShadowIntegrity(ledger: ShadowCaseLedgerStore): string {
  const issues = [...inspectShadowIntegrity(ledger), ...inspectFreshShadowIntegrity(ledger)];
  console.info('[ShadowIntegrityDetail]', JSON.stringify(issues));
  const s = summarizeIntegrity(issues);
  const get = (name: string) => issues.find((i) => i.item === name)?.count ?? 0;
  return ['🧪 <b>[Shadow Integrity]</b>', `- verdict: ${s.verdict}`, `- critical: ${s.critical}`, `- warn: ${s.warn}`, `- closed_without_label: ${get('closed_without_label')}`, `- blocked_without_counterfactual: ${get('blocked_without_counterfactual')}`, `- executionImpactViolation: ${get('executionImpact_not_NONE_in_shadow') + get('executionImpact_not_NONE')}`].join('\n');
}

export function formatShadowPromotion(ledger: ShadowCaseLedgerStore, returnFlowHitRate = 1): string {
  const diagnostic = buildPromotionReport(ledger, returnFlowHitRate);
  const fresh = collectFreshOnlyPromotion(ledger, returnFlowHitRate);
  console.info('[ShadowPromotionDetail]', JSON.stringify({ fresh, ghostRepairDiagnosticOnly: diagnostic }));
  return ['🚦 <b>[Shadow Promotion]</b>', formatFreshOnlyPromotion(fresh), `diagnosticOnly.ghostRepairSampleSize=${diagnostic.sampleSize}`, `diagnosticOnly.ghostRepairExpectancyR=${diagnostic.expectancyR.toFixed(4)}`, 'diagnosticOnly=true', `blockers=${fresh.blockers.join(', ') || fresh.blocker}`].join('\n');
}

export function formatFreshShadowStatusCommand(ledger: ShadowCaseLedgerStore): string { return formatFreshShadowStatus(collectFreshShadowStatus(ledger)); }
export function formatFreshShadowLifecycleCommand(ledger: ShadowCaseLedgerStore): string { return formatFreshShadowLifecycle(collectFreshShadowLifecycle(ledger)); }



export function formatShadowOutcomes(ledger: ShadowCaseLedgerStore): string {
  const counts = new Map<string, number>();
  for (const c of ledger.listCases()) counts.set(c.outcomeLabel ?? 'PENDING', (counts.get(c.outcomeLabel ?? 'PENDING') ?? 0) + 1);
  const rows = Array.from(counts.entries()).sort(([a], [b]) => a.localeCompare(b));
  return ['📊 <b>[Shadow Outcomes]</b>', ...rows.map(([label, count]) => `- ${label}: ${count}`)].join('\n');
}

export function formatShadowReturnFlow(metrics: ReturnFlowMetrics): string {
  return ['🔁 <b>[Shadow Return Flow]</b>', `- lookups: ${metrics.lookups}`, `- hits: ${metrics.hits}`, `- misses: ${metrics.misses}`, `- stale: ${metrics.stale}`, `- pending: ${metrics.pending}`, `- fallback: ${metrics.providerFallbackUsed}`, `- hitRate: ${metrics.hitRate.toFixed(2)}`].join('\n');
}

export function formatShadowCase(ledger: ShadowCaseLedgerStore, caseId: string): string {
  const c = ledger.getCase(caseId);
  if (!c) return `Shadow case not found: ${caseId}`;
  console.info('[ShadowCaseDetail]', JSON.stringify(c));
  return [`🔎 <b>[Shadow Case]</b> ${c.caseId}`, `- symbol: ${c.symbol} ${c.symbolName}`, `- state: ${c.state ?? 'n/a'}`, `- outcome: ${c.outcomeLabel ?? 'n/a'}`, `- impact: ${c.executionImpact}`].join('\n');
}

export function formatShadowSymbol(ledger: ShadowCaseLedgerStore, symbol: string): string {
  const rows = ledger.listCases().filter((c) => c.symbol === symbol).slice(-5);
  return [`🔎 <b>[Shadow Symbol]</b> ${symbol}`, ...rows.map((c) => `- ${c.caseId}: ${c.outcomeLabel ?? c.state ?? 'n/a'} (${c.executionImpact})`)].join('\n');
}
