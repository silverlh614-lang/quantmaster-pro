// @responsibility LearningIntegrityGuard — detects broken learning-loop links and ghost/live safety contamination
import { loadGhostPortfolio } from '../persistence/reflectionRepo.js';
import { loadCurrentSchemaRecords } from '../persistence/attributionRepo.js';
import { appendJson, LEARNING_INTEGRITY_EVENTS_FILE } from './learningStorage.js';
import type { LearningGhostCase, LearningIntegrityEvent } from './learningTypes.js';
function ev(check: string, severity: LearningIntegrityEvent['severity'], message: string, caseId?: string): LearningIntegrityEvent { return { id: `${check}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, at: new Date().toISOString(), check, severity, message, caseId }; }
export function runLearningIntegrityGuard(input: { brokerOrdersCreated?: number; liveExecutionAllowed?: boolean } = {}): LearningIntegrityEvent[] {
  const ghosts = loadGhostPortfolio() as LearningGhostCase[];
  const attrs = loadCurrentSchemaRecords();
  const ids = new Set<string>();
  const events: LearningIntegrityEvent[] = [];
  for (const g of ghosts) {
    const id = g.id ?? `${g.stockCode}|${g.signalDate}`;
    if (!g.closed && !g.lastUpdatedAt) events.push(ev('open_without_monitor', 'WARN', 'open ghost case has no monitor timestamp', id));
    if (!g.closed && g.lastUpdatedAt && Date.now() - new Date(g.lastUpdatedAt).getTime() > 24 * 3600000) events.push(ev('stale_open_case', 'WARN', 'open ghost case stale for >24h', id));
    if (g.closed && !g.outcomeLabel) events.push(ev('close_without_outcome', 'WARN', 'closed ghost case has no outcomeLabel', id));
    if (g.outcomeLabel && !['ACTIVE','DATA_CORRUPTED','QUARANTINED'].includes(g.outcomeLabel) && !g.attributionProcessed) events.push(ev('outcome_without_attribution', 'WARN', 'valid outcome has not been attributed', id));
    if (g.executionImpact && g.executionImpact !== 'NONE') events.push(ev('executionImpact_not_NONE_in_ghost', 'CRITICAL', 'ghost/shadow executionImpact must be NONE', id));
    if ((g as any).brokerOrderId || (g as any).realOrderId) events.push(ev('real_order_linked_to_ghost_case', 'CRITICAL', 'ghost case is linked to a real/broker order', id));
    if (ids.has(id)) events.push(ev('duplicate_case', 'WARN', 'duplicate ghost case key detected', id)); ids.add(id);
  }
  const attrIds = new Set(attrs.map(a => a.tradeId));
  for (const a of attrs) if (!a.conditionScores || Object.keys(a.conditionScores).length === 0) events.push(ev('attribution_without_weight_update', 'INFO', 'attribution sample lacks condition score vector', a.tradeId));
  if (attrs.length === 0 || attrIds.size === 0) events.push(ev('suggest_silence_7d', 'WARN', 'suggestion pipeline may be silent without attribution samples'));
  if ((input.brokerOrdersCreated ?? 0) > 0) events.push(ev('ghost_close_created_broker_order', 'CRITICAL', 'learning repair created broker orders'));
  if (input.liveExecutionAllowed === false && (input.brokerOrdersCreated ?? 0) > 0) events.push(ev('liveExecutionAllowed_false_broker_order', 'CRITICAL', 'broker order created while liveExecutionAllowed=false'));
  for (const e of events) appendJson(LEARNING_INTEGRITY_EVENTS_FILE, e);
  return events;
}
