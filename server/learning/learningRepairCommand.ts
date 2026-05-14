// @responsibility LearningRepairCommand service — orchestrates safe virtual-only repair dry-run/run sequence
import { runGhostCloseResolver } from './ghostCloseResolver.js';
import { runGhostOutcomeFinalizer } from './ghostOutcomeFinalizer.js';
import { runAttributionBackfill } from './attributionBackfillEngine.js';
import { analyzeSampleStarvation } from './sampleStarvationGuard.js';
import { runSuggestThresholdCalibrator } from './suggestThresholdCalibrator.js';
import { scheduleGeminiLearningReflection } from './geminiUtilizationScheduler.js';
import { runLearningIntegrityGuard } from './learningIntegrityGuard.js';
import { appendJson, LEARNING_REPAIR_RUNS_FILE } from './learningStorage.js';
import { collectLearningPulseV2, formatLearningPulseV2Message } from './learningPulseDiagnostics.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';
export async function learningRepairDryRun(now: Date = new Date()) {
  const close = await runGhostCloseResolver({ now, dryRun: true });
  const starvation = analyzeSampleStarvation(now);
  const attr = runAttributionBackfill({ now, dryRun: true });
  const suggest = runSuggestThresholdCalibrator({ now, suggest7d: { counterfactual: 0, ledger: 0, kellySurface: 0, regime: 0 } });
  const gemini = scheduleGeminiLearningReflection(now);
  return { mode: 'dryrun' as const, expectedClosable: close.closed, expectedOutcomeFinalization: starvation.reasons.close_without_label + close.closed, expectedAttributionBackfill: attr.processedCount, suggestBlocker: suggest.blocker, geminiNextScheduledAt: gemini.nextScheduledAt, brokerOrdersCreated: 0 as const };
}
export async function learningRepairRun(now: Date = new Date()) {
  const order: string[] = [];
  order.push('GhostCloseResolver'); const close = await runGhostCloseResolver({ now });
  order.push('GhostOutcomeFinalizer'); const outcome = runGhostOutcomeFinalizer();
  order.push('AttributionBackfillEngine'); const attr = runAttributionBackfill({ now });
  order.push('SuggestThresholdCalibrator'); const suggest = runSuggestThresholdCalibrator({ now, suggest7d: { counterfactual: 0, ledger: 0, kellySurface: 0, regime: 0 } });
  order.push('GeminiUtilizationScheduler'); const gemini = scheduleGeminiLearningReflection(now);
  const integrity = runLearningIntegrityGuard({ brokerOrdersCreated: close.brokerOrdersCreated, liveExecutionAllowed: false });
  const result = { mode: 'run' as const, runAt: now.toISOString(), order, close, outcome, attr, suggest, gemini, criticalIntegrityEvents: integrity.filter(e => e.severity === 'CRITICAL').length, brokerOrdersCreated: 0 as const };
  if (result.criticalIntegrityEvents > 0) await sendTelegramAlert(`🚨 Learning repair critical integrity events=${result.criticalIntegrityEvents} executionImpact=NONE brokerOrdersCreated=${result.brokerOrdersCreated}`, { priority: 'HIGH', tier: 'T1_ALARM', category: 'learning_integrity', dedupeKey: 'learning_repair_critical_integrity' });
  appendJson(LEARNING_REPAIR_RUNS_FILE, result);
  return result;
}
export function formatDryRunMessage(r: Awaited<ReturnType<typeof learningRepairDryRun>>): string { return [`🧪 learning_repair_dryrun`, `예상 close 가능 case: ${r.expectedClosable}`, `예상 outcome finalization: ${r.expectedOutcomeFinalization}`, `예상 attribution backfill: ${r.expectedAttributionBackfill}`, `suggest blocker: ${r.suggestBlocker}`, `gemini nextScheduledAt: ${r.geminiNextScheduledAt ?? 'N/A'}`, `brokerOrdersCreated: ${r.brokerOrdersCreated}`].join('\n'); }
export function formatRunMessage(r: Awaited<ReturnType<typeof learningRepairRun>>): string { return [`🛠 learning_repair_run`, `순서: ${r.order.join(' → ')}`, `closed=${r.close.closed} pendingRetry=${r.close.pendingRetry} quarantined=${r.close.quarantined}`, `outcomeFinalized=${r.outcome.finalized}`, `attributionProcessed=${r.attr.processedCount} skipped=${r.attr.skippedCount}`, `diagnosticSuggest=${r.suggest.proposals.length} autoApply=false`, `gemini nextScheduledAt=${r.gemini.nextScheduledAt ?? 'N/A'}`, `brokerOrdersCreated=${r.brokerOrdersCreated} criticalIntegrityEvents=${r.criticalIntegrityEvents}`].join('\n'); }
export function learningPulseMessage(now = new Date()) { return formatLearningPulseV2Message(collectLearningPulseV2(now)); }
