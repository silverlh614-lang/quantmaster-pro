// @responsibility LearningPulseDiagnostics v2 — read-only closed-loop learning health snapshot
import { loadGhostPortfolio, loadReflectionBudget } from '../persistence/reflectionRepo.js';
import { loadConditionWeights } from '../persistence/conditionWeightsRepo.js';
import { loadCurrentSchemaRecords } from '../persistence/attributionRepo.js';
import { readJson, GHOST_CLOSE_RUNS_FILE } from './learningStorage.js';
import type { GhostCloseResolverResult, LearningGhostCase } from './learningTypes.js';
import { analyzeSampleStarvation } from './sampleStarvationGuard.js';
import { getGeminiLearningRuns } from './geminiUtilizationScheduler.js';
import { loadSuggestDiagnosticProposals } from './suggestThresholdCalibrator.js';
import { LEARNING_ATTRIBUTION_TARGET_7D, LEARNING_GEMINI_UTILIZATION_TARGET, LEARNING_STALE_OPEN_HOURS, LEARNING_SUGGEST_CHANNELS, LEARNING_TRADING_DAYS_PER_MONTH } from './learningConstants.js';
function recent(iso: string | undefined, days: number, now: Date) { const t = iso ? new Date(iso).getTime() : NaN; return Number.isFinite(t) && t >= now.getTime() - days * 86400000; }
function ageMinutes(iso: string | undefined, now: Date) { const t = iso ? new Date(iso).getTime() : NaN; return Number.isFinite(t) ? Math.max(0, Math.floor((now.getTime() - t) / 60000)) : 0; }
export function collectLearningPulseV2(now: Date = new Date()) {
  const ghosts = loadGhostPortfolio() as LearningGhostCase[];
  const attr = loadCurrentSchemaRecords();
  const weights = loadConditionWeights();
  const openCases = ghosts.filter(g => !g.closed);
  const closed7d = ghosts.filter(g => g.closed && recent(g.closedAt ?? g.lastUpdatedAt, 7, now)).length;
  const closed14d = ghosts.filter(g => g.closed && recent(g.closedAt ?? g.lastUpdatedAt, 14, now)).length;
  const closed30d = ghosts.filter(g => g.closed && recent(g.closedAt ?? g.lastUpdatedAt, 30, now)).length;
  const closeRateDenominator7d = closed7d + openCases.length;
  const rawCloseRate7d = closeRateDenominator7d > 0 ? closed7d / closeRateDenominator7d : 0;
  const closeRate7d = rawCloseRate7d > 1 ? 1 : rawCloseRate7d;
  const metricWarnings = rawCloseRate7d > 1 ? ['METRIC_DENOMINATOR_ERROR'] : [] as string[];
  const staleOpenCount = openCases.filter(g => ageMinutes(g.lastUpdatedAt ?? g.entryAt ?? `${g.signalDate}T00:00:00Z`, now) >= LEARNING_STALE_OPEN_HOURS * 60).length;
  const oldestOpenAge = openCases.reduce((m, g) => Math.max(m, ageMinutes(g.entryAt ?? `${g.signalDate}T00:00:00Z`, now)), 0);
  const lastClose = readJson<GhostCloseResolverResult[]>(GHOST_CLOSE_RUNS_FILE, []).at(-1);
  const starvation = analyzeSampleStarvation(now, LEARNING_ATTRIBUTION_TARGET_7D);
  const totalWeights = Object.keys(weights ?? {}).length || 27;
  const learned = Object.values(weights ?? {}).filter(v => typeof v === 'number' && v !== 1).length;
  const budget = loadReflectionBudget();
  const geminiRuns = getGeminiLearningRuns();
  const geminiLast = geminiRuns.at(-1);
  const proposals = loadSuggestDiagnosticProposals();
  const byChannel = Object.fromEntries(LEARNING_SUGGEST_CHANNELS.map(c => [c, proposals.filter(p => p.channel === c && recent(p.createdAt, 7, now)).length]));
  const totalSuggest = Object.values(byChannel).reduce((a: number, b: any) => a + Number(b), 0);
  const flags: string[] = [];
  if (metricWarnings.length) flags.push(...metricWarnings);
  if (openCases.length >= 100 && closeRate7d < 0.1) flags.push('ghost_close_blocker');
  if (starvation.starvationFlag) flags.push('sample_starvation');
  if (totalSuggest < 1) flags.push('suggest_silence');
  if ((budget.callCount / LEARNING_TRADING_DAYS_PER_MONTH) < LEARNING_GEMINI_UTILIZATION_TARGET) flags.push('gemini_underuse');
  if (!lastClose || ageMinutes(lastClose.lastRunAt, now) > 24 * 60) flags.push('close_resolver_stale');
  if (starvation.reasons.label_without_attribution > 0) flags.push('attribution_backfill_needed');
  if (starvation.reasons.close_without_label > 0) flags.push('outcome_finalizer_needed');
  return { capturedAt: now.toISOString(), ghost: { open: openCases.length, closed7d, closed14d, closed30d, closeRate7d, closeRateDenominator7d, repairCloseRate: lastClose && lastClose.candidatesScanned > 0 ? Math.min(1, lastClose.closed / lastClose.candidatesScanned) : undefined, staleOpenCount, oldestOpenAge }, closeResolver: { lastRunAt: lastClose?.lastRunAt, candidatesScanned: lastClose?.candidatesScanned ?? 0, closed: lastClose?.closed ?? 0, pendingRetry: lastClose?.pendingRetry ?? 0, quarantined: lastClose?.quarantined ?? 0 }, attribution: { samples7d: attr.filter(r => recent(r.closedAt, 7, now)).length, samples14d: attr.filter(r => recent(r.closedAt, 14, now)).length, samples30d: attr.filter(r => recent(r.closedAt, 30, now)).length, target: LEARNING_ATTRIBUTION_TARGET_7D, starvationReason: starvation.primaryReason === 'resolved' ? 'NONE' : starvation.primaryReason, previousStarvationReason: starvation.previousStarvationReason }, conditionWeights: { learned, unlearned: Math.max(0, totalWeights - learned), skipped: starvation.reasons.data_quarantine_too_many, changed: learned, lastUpdateAt: undefined }, suggest: { total7d: totalSuggest, byChannel, blocker: proposals.at(-1)?.blocker ?? (totalSuggest === 0 ? 'NO_DIAGNOSTIC_PROPOSAL' : 'NONE'), diagnosticSuggestCreated: proposals.some(p => recent(p.createdAt, 7, now)) }, gemini: { callsThisMonth: budget.callCount, tradingDaysThisMonth: LEARNING_TRADING_DAYS_PER_MONTH, utilizationRate: budget.callCount / LEARNING_TRADING_DAYS_PER_MONTH, lastCallAt: budget.lastReflectionDate, nextScheduledAt: geminiLast?.nextScheduledAt }, diagnosticFlags: flags };
}
export function formatLearningPulseV2Message(s: ReturnType<typeof collectLearningPulseV2>): string {
  return [`🩺 Learning Pulse v2`, `Ghost Portfolio: OPEN ${s.ghost.open} / closed7d ${s.ghost.closed7d} / closed14d ${s.ghost.closed14d} / closed30d ${s.ghost.closed30d} / closeRate7d ${(s.ghost.closeRate7d*100).toFixed(1)}% / repairCloseRate ${typeof s.ghost.repairCloseRate === 'number' ? `${(s.ghost.repairCloseRate*100).toFixed(1)}%` : 'N/A'} / staleOpenCount ${s.ghost.staleOpenCount} / oldestOpenAge ${s.ghost.oldestOpenAge}m`, `Close Resolver: lastRunAt ${s.closeResolver.lastRunAt ?? 'N/A'} / scanned ${s.closeResolver.candidatesScanned} / closed ${s.closeResolver.closed} / pendingRetry ${s.closeResolver.pendingRetry} / quarantined ${s.closeResolver.quarantined}`, `Attribution: samples7d ${s.attribution.samples7d} / samples14d ${s.attribution.samples14d} / samples30d ${s.attribution.samples30d} / target ${s.attribution.target} / starvationReason ${s.attribution.starvationReason}${s.attribution.previousStarvationReason ? ` / previousStarvationReason ${s.attribution.previousStarvationReason}` : ''}`,  `Condition Weights: learned ${s.conditionWeights.learned} / unlearned ${s.conditionWeights.unlearned} / skipped ${s.conditionWeights.skipped} / changed ${s.conditionWeights.changed}`, `Suggest: total7d ${s.suggest.total7d} / byChannel ${JSON.stringify(s.suggest.byChannel)} / blocker ${s.suggest.blocker} / diagnosticSuggestCreated ${s.suggest.diagnosticSuggestCreated}`, `Gemini: callsThisMonth ${s.gemini.callsThisMonth} / tradingDaysThisMonth ${s.gemini.tradingDaysThisMonth} / utilizationRate ${(s.gemini.utilizationRate*100).toFixed(0)}% / lastCallAt ${s.gemini.lastCallAt ?? 'N/A'} / nextScheduledAt ${s.gemini.nextScheduledAt ?? 'N/A'}`, `Diagnostic Flags: ${s.diagnosticFlags.join(', ') || 'none'}`].join('\n');
}
