// @responsibility Learning Outcome Quality Patch v1 — read-only outcome/open/quarantine/attribution/suggest diagnostics with promotion safety guards
import { loadGhostPortfolio } from '../persistence/reflectionRepo.js';
import { loadConditionWeights } from '../persistence/conditionWeightsRepo.js';
import { loadCurrentSchemaRecords } from '../persistence/attributionRepo.js';
import { readJson, LEARNING_COHORT_BACKFILL_RUNS_FILE, LEARNING_REPAIR_RUNS_FILE, GHOST_CLOSE_RUNS_FILE } from './learningStorage.js';
import { analyzeSampleStarvation } from './sampleStarvationGuard.js';
import { getGeminiLearningRuns } from './geminiUtilizationScheduler.js';
import { loadSuggestDiagnosticProposals } from './suggestThresholdCalibrator.js';
import { LEARNING_ATTRIBUTION_TARGET_7D, LEARNING_DEFAULT_MAX_HOLDING_MINUTES, LEARNING_DEFAULT_STOP_RETURN_PCT, LEARNING_DEFAULT_TARGET_RETURN_PCT } from './learningConstants.js';
import type { LearningCloseReason, LearningGhostCase, LearningOutcomeLabel } from './learningTypes.js';
import { collectLearningCohortSummary, collectLearningHoldingOutliers, inferLearningCohort, isHoldingOutlier } from './learningSampleQuality.js';

const OUTCOMES: LearningOutcomeLabel[] = ['WIN', 'LOSS', 'BREAKEVEN', 'EXPIRED', 'DATA_CORRUPTED', 'QUARANTINED'];
const CLOSE_REASONS: LearningCloseReason[] = ['VIRTUAL_TAKE_PROFIT', 'VIRTUAL_STOP_LOSS', 'VIRTUAL_TIME_EXIT', 'VIRTUAL_SESSION_END_EXIT', 'VIRTUAL_DATA_STALE_EXIT'];
const QUARANTINE_REASONS = ['MISSING_ENTRY_PRICE', 'MISSING_TARGET_STOP', 'MISSING_PRICE_DATA', 'INVALID_TIMESTAMP', 'SYMBOL_NOT_FOUND', 'PRICE_PROVIDER_FAILED', 'DATA_STALE', 'STATUS_ENUM_MISMATCH', 'DUPLICATE_CASE', 'UNKNOWN'] as const;
const DEFAULT_CONDITION_COUNT = 27;

type QuarantineReason = typeof QUARANTINE_REASONS[number];
type ConfidenceBucket = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN' | 'RECOVERED';

type LastRepair = { runAt?: string; close?: { closed?: number; brokerOrdersCreated?: number; candidatesScanned?: number; pendingRetry?: number; quarantined?: number; lastRunAt?: string }; outcome?: { finalized?: number }; attr?: { processedCount?: number; skippedCount?: number }; suggest?: { proposals?: unknown[] }; gemini?: { nextScheduledAt?: string }; criticalIntegrityEvents?: number; brokerOrdersCreated?: number };
type LastGhostClose = { lastRunAt?: string; runAt?: string; candidatesScanned?: number; closed?: number; pendingRetry?: number; quarantined?: number };
type LastCohortBackfill = { scanned?: number; updated?: number; before?: Record<string, number>; after?: Record<string, number>; runAt?: string };

function ageMinutes(iso: string | undefined, now: Date): number {
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isFinite(t) ? Math.max(0, Math.floor((now.getTime() - t) / 60000)) : 0;
}
function isRecent(iso: string | undefined, days: number, now: Date): boolean {
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isFinite(t) && t >= now.getTime() - days * 86400000;
}
function avg(xs: number[]): number { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
function round(n: number, d = 4): number { return Number((Number.isFinite(n) ? n : 0).toFixed(d)); }
function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function entryPrice(g: LearningGhostCase): number | undefined { return g.entryPrice ?? g.signalPriceKrw; }
function targetPrice(g: LearningGhostCase): number | undefined { const e = entryPrice(g); return g.targetPrice ?? (Number.isFinite(e) ? e! * (1 + LEARNING_DEFAULT_TARGET_RETURN_PCT / 100) : undefined); }
function stopPrice(g: LearningGhostCase): number | undefined { const e = entryPrice(g); return g.stopPrice ?? (Number.isFinite(e) ? e! * (1 + LEARNING_DEFAULT_STOP_RETURN_PCT / 100) : undefined); }
function maxHold(g: LearningGhostCase): number { return g.maxHoldingMinutes ?? LEARNING_DEFAULT_MAX_HOLDING_MINUTES; }
function currentPrice(g: LearningGhostCase): number | undefined {
  const e = entryPrice(g);
  if (Number.isFinite(g.exitPriceVirtual) && (g.exitPriceVirtual ?? 0) > 0) return g.exitPriceVirtual;
  if (Number.isFinite(e) && Number.isFinite(g.currentReturnPct)) return e! * (1 + (g.currentReturnPct ?? 0) / 100);
  return undefined;
}
function closeCandidate(g: LearningGhostCase, now: Date): boolean {
  const p = currentPrice(g), e = entryPrice(g), t = targetPrice(g), s = stopPrice(g);
  if (![p, e, t, s].every(v => Number.isFinite(v) && (v ?? 0) > 0)) return false;
  return p! >= t! || p! <= s! || ageMinutes(g.entryAt ?? `${g.signalDate}T00:00:00.000Z`, now) >= maxHold(g);
}
function bucketConfidence(v: unknown): ConfidenceBucket {
  if (v === 'RECOVERED') return 'RECOVERED';
  if (v === 'MEDIUM') return 'MEDIUM';
  if (v === 'HIGH') return 'HIGH';
  if (typeof v !== 'number' || !Number.isFinite(v)) return 'UNKNOWN';
  if (v >= 0.8) return 'HIGH';
  if (v >= 0.5) return 'MEDIUM';
  return 'LOW';
}
function quarantineReason(g: LearningGhostCase): QuarantineReason {
  const raw = String(g.quarantinedReason ?? g.pendingRetryReason ?? '').toUpperCase();
  if (raw.includes('ENTRY')) return 'MISSING_ENTRY_PRICE';
  if (raw.includes('TARGET') || raw.includes('STOP')) return 'MISSING_TARGET_STOP';
  if (raw.includes('PRICE') || raw.includes('OHLC')) return 'MISSING_PRICE_DATA';
  if (raw.includes('TIMESTAMP') || raw.includes('DATE')) return 'INVALID_TIMESTAMP';
  if (raw.includes('SYMBOL')) return 'SYMBOL_NOT_FOUND';
  if (raw.includes('PROVIDER')) return 'PRICE_PROVIDER_FAILED';
  if (raw.includes('STALE')) return 'DATA_STALE';
  if (raw.includes('STATUS') || raw.includes('ENUM')) return 'STATUS_ENUM_MISMATCH';
  if (raw.includes('DUPLICATE')) return 'DUPLICATE_CASE';
  if (!Number.isFinite(entryPrice(g)) || (entryPrice(g) ?? 0) <= 0) return 'MISSING_ENTRY_PRICE';
  if (!currentPrice(g)) return 'MISSING_PRICE_DATA';
  return 'UNKNOWN';
}
function lastRepairRun(): LastRepair | undefined { return readJson<LastRepair[]>(LEARNING_REPAIR_RUNS_FILE, []).at(-1); }
function lastGhostCloseRun(): LastGhostClose | undefined { return readJson<LastGhostClose[]>(GHOST_CLOSE_RUNS_FILE, []).at(-1); }
function lastCohortBackfillRun(): LastCohortBackfill | undefined { return readJson<LastCohortBackfill[]>(LEARNING_COHORT_BACKFILL_RUNS_FILE, []).at(-1); }
function pctRate(n: number, d: number): number | undefined { return d > 0 ? Math.min(1, Math.max(0, n / d)) : undefined; }
function expectancyValue(v: unknown, sampleSize: number, emptyReason: string): { value: number | 'N/A'; reason?: string; sampleSize: number } { return sampleSize > 0 && typeof v === 'number' && Number.isFinite(v) ? { value: v, sampleSize } : { value: 'N/A', reason: emptyReason, sampleSize }; }
function formatExpectancy(e: { value: number | 'N/A'; reason?: string; sampleSize: number }): string { return e.value === 'N/A' ? `N/A reason=${e.reason} sampleSize=${e.sampleSize}` : `${e.value} sampleSize=${e.sampleSize}`; }
function concentrationRisk(ghosts: LearningGhostCase[]): boolean {
  if (ghosts.length < 10) return false;
  const bySymbol = new Map<string, number>();
  for (const g of ghosts) bySymbol.set(g.stockCode, (bySymbol.get(g.stockCode) ?? 0) + 1);
  return Math.max(...bySymbol.values()) / ghosts.length > 0.35;
}
function winLossImbalanced(win: number, loss: number): boolean {
  const total = win + loss;
  if (total < 30) return false;
  const ratio = Math.max(win, loss) / Math.max(1, total);
  return ratio > 0.85;
}

export function collectLearningOutcomeSummary(now: Date = new Date()) {
  const ghosts = loadGhostPortfolio() as LearningGhostCase[];
  const closed = ghosts.filter(g => g.closed || OUTCOMES.includes(g.outcomeLabel as LearningOutcomeLabel));
  const attributed = closed.filter(g => g.attributionProcessed);
  const outcomeCounts = Object.fromEntries(OUTCOMES.map(o => [o, closed.filter(g => g.outcomeLabel === o).length])) as Record<LearningOutcomeLabel, number>;
  const closeReasonCounts = Object.fromEntries(CLOSE_REASONS.map(r => [r, closed.filter(g => g.closeReason === r).length])) as Record<typeof CLOSE_REASONS[number], number>;
  const returnPct = closed.map(g => g.finalReturnPct).filter((v): v is number => Number.isFinite(v));
  const returnR = closed.map(g => g.returnR).filter((v): v is number => Number.isFinite(v));
  const holds = closed.map(g => (g as LearningGhostCase & { holdingMinutes?: number }).holdingMinutes ?? ageMinutes(g.entryAt ?? `${g.signalDate}T00:00:00.000Z`, g.closedAt ? new Date(g.closedAt) : now)).filter(Number.isFinite);
  const qualityOk = closed.filter(g => !['CORRUPTED', 'QUARANTINED', 'MISSING'].includes(String(g.dataQuality ?? 'OK')) && !['DATA_CORRUPTED', 'QUARANTINED'].includes(String(g.outcomeLabel))).length;
  const sourceConfidenceBreakdown: Record<ConfidenceBucket, number> = { HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0, RECOVERED: 0 };
  for (const g of closed) sourceConfidenceBreakdown[bucketConfidence(g.sourceConfidence)]++;
  const lowSourceRate = closed.length ? sourceConfidenceBreakdown.LOW / closed.length : 0;
  const quarantinedRate = closed.length ? outcomeCounts.QUARANTINED / closed.length : 0;
  const dataQualityScore = closed.length ? qualityOk / closed.length : 0;
  const overfitRisk = collectLearningAttributionQuality(now).overfitRisk;
  const cohort = collectLearningCohortSummary(now);
  const fresh = closed.filter(g => inferLearningCohort(g) === 'FRESH_SHADOW' && !isHoldingOutlier(g, now));
  const freshReturnR = fresh.map(g => g.returnR).filter((v): v is number => Number.isFinite(v));
  const freshShadowExpectancyR = round(avg(freshReturnR));
  const counterfactualSampleSize = cohort.counterfactualCount;
  const guardBlockers = [
    fresh.length < 100 ? 'freshShadowSampleSize<100' : '',
    freshShadowExpectancyR <= 0 ? 'freshShadowExpectancyR<=0' : '',
    avg(returnR) <= 0 ? 'diagnosticOverallExpectancyR<=0' : '',
    dataQualityScore < 0.8 ? 'dataQualityScore<0.8' : '',
    ['HIGH', 'MEDIUM'].includes(overfitRisk) ? `overfitRisk=${overfitRisk}` : '',
    counterfactualSampleSize === 0 ? 'counterfactualSampleSize=0' : '',
    lowSourceRate > 0.3 ? 'sourceConfidenceLOW>30%' : '',
    quarantinedRate > 0.1 ? 'quarantinedRate>10%' : '',
    winLossImbalanced(outcomeCounts.WIN, outcomeCounts.LOSS) ? 'WIN_LOSS_IMBALANCE' : '',
    concentrationRisk(closed) ? 'SYMBOL_SECTOR_CONCENTRATION' : '',
  ].filter(Boolean);
  return { closedTotal: closed.length, finalizedTotal: closed.filter(g => !!g.outcomeLabel).length, attributedTotal: attributed.length, freshShadowSampleSize: fresh.length, freshShadowExpectancyR, promotionMetricBasis: fresh.length >= 100 && counterfactualSampleSize > 0 ? 'FRESH_ONLY' as const : 'BLOCKED' as const, ...outcomeCounts, ...closeReasonCounts, avgReturnPct: round(avg(returnPct)), avgReturnR: round(avg(returnR)), expectancyR: round(avg(returnR)), avgHoldingMinutes: round(avg(holds), 2), medianHoldingMinutes: round(median(holds), 2), maxWinR: round(returnR.length ? Math.max(...returnR) : 0), maxLossR: round(returnR.length ? Math.min(...returnR) : 0), dataQualityScore: round(dataQualityScore, 4), sourceConfidenceBreakdown, promotionAllowed: false as const, guardBlockers, autoApply: false as const, executionImpact: 'NONE' as const };
}

export function collectLearningOpenResidue(now: Date = new Date()) {
  const ghosts = loadGhostPortfolio() as LearningGhostCase[];
  const open = ghosts.filter(g => !g.closed);
  const quarantined = open.filter(g => g.outcomeLabel === 'QUARANTINED' || g.dataQuality === 'QUARANTINED' || !!g.quarantinedReason);
  const missingEntryPrice = open.filter(g => !Number.isFinite(entryPrice(g)) || (entryPrice(g) ?? 0) <= 0).length;
  const missingTargetStop = open.filter(g => !Number.isFinite(g.targetPrice) || !Number.isFinite(g.stopPrice)).length;
  const missingPriceData = open.filter(g => !currentPrice(g)).length;
  const staleData = open.filter(g => ageMinutes(g.lastUpdatedAt ?? g.entryAt ?? `${g.signalDate}T00:00:00.000Z`, now) > 24 * 60).length;
  const closeCandidates = open.filter(g => closeCandidate(g, now)).length;
  const notYetMatured = open.filter(g => !closeCandidate(g, now) && !quarantined.includes(g) && currentPrice(g) && ageMinutes(g.entryAt ?? `${g.signalDate}T00:00:00.000Z`, now) < maxHold(g)).length;
  const reasons: Record<string, number> = { notYetMatured, missingEntryPrice, missingTargetStop, missingPriceData, staleData, quarantined: quarantined.length };
  const zeroCloseReasonTop3 = Object.entries(reasons).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([reason, count]) => ({ reason, count }));
  const nextAction = closeCandidates > 0 ? 'run /learning_repair_run to close eligible virtual cases' : quarantined.length > 0 ? 'inspect /learning_quarantine_report and repair recoverable data gaps' : missingPriceData > 0 ? 'refresh virtual price snapshots before rerunning resolver' : 'wait for maturation or threshold hit; no auto execution';
  return { openRemaining: open.length, closeCandidates, notYetMatured, missingEntryPrice, missingTargetStop, missingPriceData, staleData, quarantined: quarantined.length, oldestOpenAge: open.reduce((m, g) => Math.max(m, ageMinutes(g.entryAt ?? `${g.signalDate}T00:00:00.000Z`, now)), 0), zeroCloseReasonTop3, nextAction, executionImpact: 'NONE' as const, brokerOrdersCreated: 0 as const };
}

export function collectLearningQuarantineReport() {
  const ghosts = loadGhostPortfolio() as LearningGhostCase[];
  const quarantined = ghosts.filter(g => g.outcomeLabel === 'QUARANTINED' || g.dataQuality === 'QUARANTINED' || !!g.quarantinedReason);
  const reasonBreakdown = Object.fromEntries(QUARANTINE_REASONS.map(r => [r, 0])) as Record<QuarantineReason, number>;
  for (const g of quarantined) reasonBreakdown[quarantineReason(g)]++;
  const recoverableSet = new Set<QuarantineReason>(['MISSING_ENTRY_PRICE', 'MISSING_TARGET_STOP', 'MISSING_PRICE_DATA', 'PRICE_PROVIDER_FAILED', 'DATA_STALE', 'UNKNOWN']);
  const recoverableCount = quarantined.filter(g => recoverableSet.has(quarantineReason(g))).length;
  const examples = quarantined.slice(0, 5).map(g => ({ id: g.id ?? `${g.stockCode}|${g.signalDate}`, stockCode: g.stockCode, reason: quarantineReason(g), rawReason: g.quarantinedReason ?? g.pendingRetryReason ?? 'N/A' }));
  const top = Object.entries(reasonBreakdown).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'UNKNOWN';
  return { totalQuarantined: quarantined.length, reasonBreakdown, examples, recoverableCount, unrecoverableCount: quarantined.length - recoverableCount, recommendedFix: recoverableCount > 0 ? `recover ${top} by backfilling entry/target/stop/price metadata; keep observe-only after repair` : 'manual audit required; do not promote corrupted samples', executionImpact: 'NONE' as const };
}

export function collectLearningAttributionQuality(now: Date = new Date()) {
  const records = loadCurrentSchemaRecords();
  const recent7 = records.filter(r => isRecent(r.closedAt, 7, now));
  const starvation = analyzeSampleStarvation(now, LEARNING_ATTRIBUTION_TARGET_7D);
  const weights = loadConditionWeights();
  const conditionIds = new Set<number>();
  for (const key of Object.keys(weights ?? {})) conditionIds.add(Number(key));
  for (let i = 1; i <= DEFAULT_CONDITION_COUNT; i++) conditionIds.add(i);
  for (const r of records) for (const k of Object.keys(r.conditionScores ?? {})) conditionIds.add(Number(k));
  const stats = [...conditionIds].filter(Number.isFinite).map(id => {
    const samples = records.filter(r => Number.isFinite(r.conditionScores?.[id]));
    const high = samples.filter(r => (r.conditionScores?.[id] ?? 0) >= 7);
    const low = samples.filter(r => (r.conditionScores?.[id] ?? 0) < 5);
    const avgHigh = avg(high.map(r => r.returnPct));
    const avgLow = avg(low.map(r => r.returnPct));
    const effect = avgHigh - avgLow;
    return { conditionId: id, samples: samples.length, highSamples: high.length, lowSamples: low.length, effect: round(effect), avgReturn: round(avg(samples.map(r => r.returnPct))) };
  });
  const covered = stats.filter(s => s.samples > 0);
  const decorated = stats.map(s => ({ ...s, confidence: s.samples >= 70 ? 'HIGH' : s.samples >= 30 ? 'MEDIUM' : s.samples > 0 ? 'LOW_SAMPLE' : 'NONE', minSamplePassed: s.samples >= 30, weightUpdateAllowed: s.samples >= 70 && s.highSamples + s.lowSamples > 0, overfitFlag: s.samples < 30 ? 'LOW_SAMPLE' : s.samples < 70 ? 'OBSERVE_ONLY' : 'OK', recommendation: s.samples < 30 ? 'LOW_SAMPLE / DO_NOT_TRADE' : s.samples < 70 ? 'OBSERVE_ONLY / DO_NOT_UPDATE_WEIGHT' : 'recommendationOnly' }));
  const learned = decorated.filter(s => s.minSamplePassed && Math.abs(s.effect) > 0.1);
  const lowSample = decorated.filter(s => s.samples > 0 && s.samples < 30).map(s => s.conditionId);
  const unstable = decorated.filter(s => s.samples < 70 || (s.highSamples + s.lowSamples === 0)).map(s => s.conditionId);
  const dataLeakageSuspect = records.some(r => r.tradeId.includes('future') || Object.keys(r.conditionScores ?? {}).some(k => Number(k) > 1000));
  const concentration = records.length ? Math.max(...Object.values(records.reduce<Record<string, number>>((acc, r) => { acc[r.stockCode] = (acc[r.stockCode] ?? 0) + 1; return acc; }, {}))) / records.length : 0;
  const overfitRisk = records.length < LEARNING_ATTRIBUTION_TARGET_7D || covered.length / Math.max(1, conditionIds.size) < 0.5 || concentration > 0.35 ? 'HIGH' : unstable.length > conditionIds.size * 0.35 ? 'MEDIUM' : 'LOW';
  const rankable = decorated.filter(s => s.samples >= 30 && s.highSamples + s.lowSamples > 0);
  const rankingBase = rankable.length ? rankable : decorated.filter(s => s.samples > 0).map(s => ({ ...s, effect: 0, recommendation: `${s.recommendation} / effect hidden until samples>=30` }));
  return { samples7d: recent7.length, targetSamples: LEARNING_ATTRIBUTION_TARGET_7D, starvation: starvation.starvationFlag, processed: records.length, skipped: starvation.reasons.data_quarantine_too_many + starvation.reasons.close_without_label + starvation.reasons.label_without_attribution, conditionCoverage: round(covered.length / Math.max(1, conditionIds.size), 4), learnedConditions: learned.map(s => s.conditionId), unlearnedConditions: stats.filter(s => s.samples === 0).map(s => s.conditionId), lowSampleConditions: lowSample, topPositiveConditions: [...rankingBase].sort((a, b) => b.effect - a.effect).slice(0, 5), topNegativeConditions: [...rankingBase].sort((a, b) => a.effect - b.effect).slice(0, 5), conditionReport: decorated, unstableConditions: unstable, dataLeakageSuspect, overfitRisk, recommendationOnly: true as const, autoApply: false as const, executionImpact: 'NONE' as const };
}

export function collectLearningConditionReport(now: Date = new Date()) {
  return collectLearningAttributionQuality(now).conditionReport;
}

export function collectLearningSuggestReport(now: Date = new Date()) {
  const proposals = loadSuggestDiagnosticProposals();
  const diagnostic = proposals.filter(p => p.autoApply === false);
  const latest = diagnostic.at(-1);
  return { totalProposals: proposals.length, diagnosticProposals: diagnostic.length, autoApply: false as const, channel: latest?.channel ?? 'N/A', currentThreshold: latest?.currentThreshold ?? 0, observedScore: latest?.observedScore ?? 0, sampleSize: latest?.sampleSize ?? 0, blocker: latest?.blocker ?? 'NO_DIAGNOSTIC_PROPOSAL', recommendation: latest?.recommendation ?? 'run /suggest_diagnostics to create observe-only proposal', riskLevel: latest?.riskLevel ?? 'LOW', requiredAdditionalSamples: Math.max(0, LEARNING_ATTRIBUTION_TARGET_7D - collectLearningAttributionQuality(now).samples7d), promotionAllowed: false as const, executionImpact: 'NONE' as const };
}

export function collectLearningPulseV3(now: Date = new Date()) {
  const lastLearning = lastRepairRun();
  const lastGhostClose = lastGhostCloseRun();
  const lastBackfill = lastCohortBackfillRun();
  const outcome = collectLearningOutcomeSummary(now);
  const open = collectLearningOpenResidue(now);
  const attr = collectLearningAttributionQuality(now);
  const suggest = collectLearningSuggestReport(now);
  const gemini = getGeminiLearningRuns().at(-1);
  const cohort = collectLearningCohortSummary(now);
  const metadataRepairStatus = collectLearningOpenResidue(now);
  const holding = collectLearningHoldingOutliers(now);
  const byCohort = cohort.byCohort as Record<string, number>;
  const cohortSum = Object.values(byCohort).reduce((a, b) => a + Number(b), 0);
  const closed7d = (loadGhostPortfolio() as LearningGhostCase[]).filter(g => g.closed && isRecent(g.closedAt ?? g.lastUpdatedAt, 7, now)).length;
  const closeRateDenominator7d = closed7d + open.openRemaining;
  const closeRate7d = pctRate(closed7d, closeRateDenominator7d) ?? 0;
  const lastGhostCloseRunCloseRate = pctRate(lastGhostClose?.closed ?? 0, lastGhostClose?.candidatesScanned ?? 0);
  const lastLearningRepairRunCloseRate = pctRate(lastLearning?.close?.closed ?? 0, (lastLearning?.close?.closed ?? 0) + open.openRemaining);
  const freshShadowExpectancyR = expectancyValue((cohort.expectancyByCohort as any).FRESH_SHADOW, cohort.freshShadowCount, 'NO_FRESH_SAMPLE');
  const ghostRepairExpectancyR = expectancyValue((cohort.expectancyByCohort as any).GHOST_REPAIR, cohort.ghostRepairCount, 'NO_GHOST_REPAIR_SAMPLE');
  const backlogRepairExpectancyR = expectancyValue((cohort.expectancyByCohort as any).BACKLOG_REPAIR, cohort.backlogRepairCount, 'NO_BACKLOG_SAMPLE');
  const quarantinedExpectancyR = { value: 'N/A' as const, reason: cohort.quarantinedCount > 0 ? 'QUARANTINED_COHORT_EXCLUDED' : 'NO_QUARANTINED_SAMPLE', sampleSize: cohort.quarantinedCount };
  const promotionPrimaryExpectancyR = outcome.promotionMetricBasis === 'FRESH_ONLY' ? freshShadowExpectancyR : { value: 'N/A' as const, reason: 'NO_FRESH_SAMPLE', sampleSize: cohort.freshShadowCount };
  const expectedGhostRepair = lastBackfill?.after?.GHOST_REPAIR;
  const metricWarnings: string[] = [];
  if (typeof expectedGhostRepair === 'number' && expectedGhostRepair !== cohort.ghostRepairCount) metricWarnings.push('COHORT_BACKFILL_NOT_REFLECTED_IN_PULSE');
  if (closeRate7d > 1 || (lastGhostCloseRunCloseRate ?? 0) > 1 || (lastLearningRepairRunCloseRate ?? 0) > 1) metricWarnings.push('METRIC_DENOMINATOR_ERROR');
  const consistencyCheck = {
    cohortBackfillApplied: !!lastBackfill || cohortSum === cohort.totalSamples,
    cohortSumMatchesTotal: cohortSum === cohort.totalSamples,
    ghostRepairReflectedInPulse: typeof expectedGhostRepair === 'number' ? expectedGhostRepair === cohort.ghostRepairCount : cohort.ghostRepairCount === byCohort.GHOST_REPAIR,
    repairRunSourceSeparated: (lastLearning?.close?.closed ?? undefined) !== (lastGhostClose?.closed ?? undefined) || !!lastLearning || !!lastGhostClose,
    closeRateValid: closeRate7d <= 1 && (lastGhostCloseRunCloseRate ?? 0) <= 1 && (lastLearningRepairRunCloseRate ?? 0) <= 1,
    starvationReasonConsistent: attr.starvation === (attr.samples7d < attr.targetSamples),
    suggestMetricsConsistent: suggest.totalProposals >= suggest.diagnosticProposals && suggest.autoApply === false,
    promotionBasisConsistent: outcome.promotionAllowed === false && outcome.promotionMetricBasis === 'BLOCKED',
    metricWarnings,
  };
  return {
    repairRuns: {
      lastLearningRepairRun: { closed: lastLearning?.close?.closed ?? 0, outcomeFinalized: lastLearning?.outcome?.finalized ?? 0, attributionProcessed: lastLearning?.attr?.processedCount ?? 0, diagnosticSuggest: lastLearning?.suggest?.proposals?.length ?? 0, criticalIntegrityEvents: lastLearning?.criticalIntegrityEvents ?? 0, brokerOrdersCreated: lastLearning?.brokerOrdersCreated ?? lastLearning?.close?.brokerOrdersCreated ?? 0, runAt: lastLearning?.runAt ?? lastLearning?.close?.lastRunAt },
      lastGhostCloseRun: { scanned: lastGhostClose?.candidatesScanned ?? 0, closed: lastGhostClose?.closed ?? 0, pendingRetry: lastGhostClose?.pendingRetry ?? 0, quarantined: lastGhostClose?.quarantined ?? 0, runAt: lastGhostClose?.runAt ?? lastGhostClose?.lastRunAt },
      lastCohortBackfillRun: { scanned: lastBackfill?.scanned ?? 0, updated: lastBackfill?.updated ?? 0, before: lastBackfill?.before ?? {}, after: lastBackfill?.after ?? {}, runAt: lastBackfill?.runAt },
    },
    repairLastRun: { closed: lastLearning?.close?.closed ?? 0, outcomeFinalized: lastLearning?.outcome?.finalized ?? 0, attributionProcessed: lastLearning?.attr?.processedCount ?? 0, diagnosticSuggest: lastLearning?.suggest?.proposals?.length ?? 0, criticalIntegrityEvents: lastLearning?.criticalIntegrityEvents ?? 0, brokerOrdersCreated: lastLearning?.brokerOrdersCreated ?? lastLearning?.close?.brokerOrdersCreated ?? 0 },
    outcomeQuality: { win: outcome.WIN, loss: outcome.LOSS, expired: outcome.EXPIRED, quarantined: outcome.QUARANTINED, expectancyR: outcome.expectancyR, dataQualityScore: outcome.dataQualityScore, promotionAllowed: outcome.promotionAllowed },
    cohortSummary: { freshShadowCount: cohort.freshShadowCount, ghostRepairCount: cohort.ghostRepairCount, backlogRepairCount: cohort.backlogRepairCount, openUnresolvedCount: cohort.openUnresolvedCount, recoveredMetadataCount: cohort.recoveredMetadataCount, quarantinedCount: cohort.quarantinedCount, counterfactualBuiltCount: cohort.counterfactualBuiltCount, counterfactualCandidateCount: cohort.counterfactualCandidateCount, promotionEligibleSamples: cohort.promotionEligibleSamples, promotionExcludedSamples: cohort.promotionExcludedSamples, freshShadowExpectancyR, ghostRepairExpectancyR, backlogRepairExpectancyR, quarantinedExpectancyR, promotionPrimaryExpectancyR },
    rateMetrics: { closeRate7d, lastGhostCloseRunCloseRate, lastLearningRepairRunCloseRate, closeRateFormula: 'closed7d/(closed7d+openRemaining)' as const, closed7d, openRemaining: open.openRemaining },
    metadataRepairStatus: { missingTargetStop: metadataRepairStatus.missingTargetStop, missingEntryPrice: metadataRepairStatus.missingEntryPrice, quarantined: metadataRepairStatus.quarantined },
    openResidue: { openRemaining: open.openRemaining, closeCandidates: open.closeCandidates, quarantined: open.quarantined, zeroCloseReasonTop3: open.zeroCloseReasonTop3 },
    attributionQuality: { samples7d: attr.samples7d, conditionCoverage: attr.conditionCoverage, overfitRisk: attr.overfitRisk, lowSampleConditions: attr.lowSampleConditions.length, unstableConditions: attr.unstableConditions.length },
    suggest: { suggestSignals7d: 0, diagnosticProposals7d: suggest.diagnosticProposals, autoApplied7d: 0, totalDiagnosticEvents7d: suggest.diagnosticProposals, blocker: suggest.blocker, status: 'DIAGNOSTIC_ONLY' as const, proposals: suggest.totalProposals, autoApply: false as const, counterfactualSampleSize: suggest.sampleSize },
    holdingOutlierStatus: { outlierCount: holding.outlierCount, excludedFromPromotion: holding.excludedFromPromotion },
    promotionMetricBasis: outcome.promotionMetricBasis,
    consistencyCheck,
    gemini: { nextScheduledAt: gemini?.nextScheduledAt, recommendationOnly: true as const },
    executionImpact: 'NONE' as const,
    brokerOrdersCreated: 0 as const,
    promotionAllowed: false as const,
  };
}

export function formatLearningOutcomeSummary(s: ReturnType<typeof collectLearningOutcomeSummary>): string { return [`📈 learning_outcome_summary`, `closedTotal=${s.closedTotal} finalizedTotal=${s.finalizedTotal} attributedTotal=${s.attributedTotal}`, `WIN=${s.WIN} LOSS=${s.LOSS} BREAKEVEN=${s.BREAKEVEN} EXPIRED=${s.EXPIRED} DATA_CORRUPTED=${s.DATA_CORRUPTED} QUARANTINED=${s.QUARANTINED}`, `VIRTUAL_TAKE_PROFIT=${s.VIRTUAL_TAKE_PROFIT} VIRTUAL_STOP_LOSS=${s.VIRTUAL_STOP_LOSS} VIRTUAL_TIME_EXIT=${s.VIRTUAL_TIME_EXIT} VIRTUAL_SESSION_END_EXIT=${s.VIRTUAL_SESSION_END_EXIT} VIRTUAL_DATA_STALE_EXIT=${s.VIRTUAL_DATA_STALE_EXIT}`, `avgReturnPct=${s.avgReturnPct} avgReturnR=${s.avgReturnR} expectancyR=${s.expectancyR}`, `avgHoldingMinutes=${s.avgHoldingMinutes} medianHoldingMinutes=${s.medianHoldingMinutes} maxWinR=${s.maxWinR} maxLossR=${s.maxLossR}`, `dataQualityScore=${s.dataQualityScore} sourceConfidenceBreakdown=${JSON.stringify(s.sourceConfidenceBreakdown)}`, `promotionAllowed=${s.promotionAllowed} autoApply=${s.autoApply} executionImpact=${s.executionImpact} guardBlockers=${s.guardBlockers.join(',') || 'none'}`].join('\n'); }
export function formatLearningOpenResidue(s: ReturnType<typeof collectLearningOpenResidue>): string { return [`🧩 learning_open_residue`, `openRemaining=${s.openRemaining} closeCandidates=${s.closeCandidates} notYetMatured=${s.notYetMatured}`, `missingEntryPrice=${s.missingEntryPrice} missingTargetStop=${s.missingTargetStop} missingPriceData=${s.missingPriceData} staleData=${s.staleData} quarantined=${s.quarantined}`, `oldestOpenAge=${s.oldestOpenAge} zeroCloseReasonTop3=${JSON.stringify(s.zeroCloseReasonTop3)}`, `nextAction=${s.nextAction}`, `executionImpact=${s.executionImpact} brokerOrdersCreated=${s.brokerOrdersCreated}`].join('\n'); }
export function formatLearningQuarantineReport(s: ReturnType<typeof collectLearningQuarantineReport>): string { return [`🚧 learning_quarantine_report`, `totalQuarantined=${s.totalQuarantined}`, `reasonBreakdown=${JSON.stringify(s.reasonBreakdown)}`, `examples=${JSON.stringify(s.examples)}`, `recoverableCount=${s.recoverableCount} unrecoverableCount=${s.unrecoverableCount}`, `recommendedFix=${s.recommendedFix}`, `executionImpact=${s.executionImpact}`].join('\n'); }
export function formatLearningAttributionQuality(s: ReturnType<typeof collectLearningAttributionQuality>): string { return [`🧬 learning_attribution_quality`, `samples7d=${s.samples7d} targetSamples=${s.targetSamples} starvation=${s.starvation}`, `processed=${s.processed} skipped=${s.skipped} conditionCoverage=${s.conditionCoverage}`, `learnedConditions=${JSON.stringify(s.learnedConditions)} unlearnedConditions=${JSON.stringify(s.unlearnedConditions)} lowSampleConditions=${JSON.stringify(s.lowSampleConditions)}`, `topPositiveConditions=${JSON.stringify(s.topPositiveConditions)} topNegativeConditions=${JSON.stringify(s.topNegativeConditions)}`, `unstableConditions=${JSON.stringify(s.unstableConditions)} dataLeakageSuspect=${s.dataLeakageSuspect} overfitRisk=${s.overfitRisk}`, `recommendationOnly=${s.recommendationOnly} autoApply=${s.autoApply} executionImpact=${s.executionImpact}`].join('\n'); }
export function formatLearningConditionReport(s: ReturnType<typeof collectLearningConditionReport>): string { return [`🧬 learning_condition_report`, ...s.map(r => `conditionId=${r.conditionId} samples=${r.samples} highSamples=${r.highSamples} lowSamples=${r.lowSamples} avgReturn=${r.avgReturn} effect=${r.effect} confidence=${r.confidence} minSamplePassed=${r.minSamplePassed} weightUpdateAllowed=${r.weightUpdateAllowed} overfitFlag=${r.overfitFlag} recommendation=${r.recommendation}`), `executionImpact=NONE recommendationOnly=true autoApply=false`].join('\n'); }
export function formatLearningSuggestReport(s: ReturnType<typeof collectLearningSuggestReport>): string { return [`💡 learning_suggest_report`, `totalProposals=${s.totalProposals} diagnosticProposals=${s.diagnosticProposals} autoApply=${s.autoApply}`, `channel=${s.channel} currentThreshold=${s.currentThreshold} observedScore=${s.observedScore} sampleSize=${s.sampleSize}`, `blocker=${s.blocker} recommendation=${s.recommendation}`, `riskLevel=${s.riskLevel} requiredAdditionalSamples=${s.requiredAdditionalSamples}`, `promotionAllowed=${s.promotionAllowed} executionImpact=${s.executionImpact}`].join('\n'); }
export function formatLearningPulseV3(s: ReturnType<typeof collectLearningPulseV3>): string { return [`🩺 Learning Pulse v4`, `Repair Runs:`, `- lastLearningRepairRun: closed=${s.repairRuns.lastLearningRepairRun.closed} outcomeFinalized=${s.repairRuns.lastLearningRepairRun.outcomeFinalized} attributionProcessed=${s.repairRuns.lastLearningRepairRun.attributionProcessed} diagnosticSuggest=${s.repairRuns.lastLearningRepairRun.diagnosticSuggest} criticalIntegrityEvents=${s.repairRuns.lastLearningRepairRun.criticalIntegrityEvents} brokerOrdersCreated=${s.repairRuns.lastLearningRepairRun.brokerOrdersCreated} runAt=${s.repairRuns.lastLearningRepairRun.runAt ?? 'N/A'}`, `- lastGhostCloseRun: scanned=${s.repairRuns.lastGhostCloseRun.scanned} closed=${s.repairRuns.lastGhostCloseRun.closed} pendingRetry=${s.repairRuns.lastGhostCloseRun.pendingRetry} quarantined=${s.repairRuns.lastGhostCloseRun.quarantined} runAt=${s.repairRuns.lastGhostCloseRun.runAt ?? 'N/A'}`, `- lastCohortBackfillRun: scanned=${s.repairRuns.lastCohortBackfillRun.scanned} updated=${s.repairRuns.lastCohortBackfillRun.updated} before=${JSON.stringify(s.repairRuns.lastCohortBackfillRun.before)} after=${JSON.stringify(s.repairRuns.lastCohortBackfillRun.after)} runAt=${s.repairRuns.lastCohortBackfillRun.runAt ?? 'N/A'}`, `Outcome Quality: win=${s.outcomeQuality.win} loss=${s.outcomeQuality.loss} expired=${s.outcomeQuality.expired} quarantined=${s.outcomeQuality.quarantined} expectancyR=${s.outcomeQuality.expectancyR} dataQualityScore=${s.outcomeQuality.dataQualityScore} promotionAllowed=${s.outcomeQuality.promotionAllowed}`, `Cohort Summary: Fresh Shadow sample count=${s.cohortSummary.freshShadowCount} Ghost repair sample count=${s.cohortSummary.ghostRepairCount} Backlog repair sample count=${s.cohortSummary.backlogRepairCount} Open unresolved sample count=${s.cohortSummary.openUnresolvedCount} Recovered metadata count=${s.cohortSummary.recoveredMetadataCount} Quarantined sample count=${s.cohortSummary.quarantinedCount} Counterfactual built count=${s.cohortSummary.counterfactualBuiltCount} Counterfactual candidate count=${s.cohortSummary.counterfactualCandidateCount} promotionEligibleSamples=${s.cohortSummary.promotionEligibleSamples} promotionExcludedSamples=${s.cohortSummary.promotionExcludedSamples}`, `Expectancy by cohort: freshShadowExpectancyR=${formatExpectancy(s.cohortSummary.freshShadowExpectancyR)} ghostRepairExpectancyR=${formatExpectancy(s.cohortSummary.ghostRepairExpectancyR)} backlogRepairExpectancyR=${formatExpectancy(s.cohortSummary.backlogRepairExpectancyR)} quarantinedExpectancyR=${formatExpectancy(s.cohortSummary.quarantinedExpectancyR)} promotionPrimaryExpectancyR=${formatExpectancy(s.cohortSummary.promotionPrimaryExpectancyR)}`, `Rate Metrics: closeRate7d ${(s.rateMetrics.closeRate7d*100).toFixed(1)}% / lastGhostCloseRunCloseRate ${typeof s.rateMetrics.lastGhostCloseRunCloseRate === 'number' ? `${(s.rateMetrics.lastGhostCloseRunCloseRate*100).toFixed(1)}%` : 'N/A'} / lastLearningRepairRunCloseRate ${typeof s.rateMetrics.lastLearningRepairRunCloseRate === 'number' ? `${(s.rateMetrics.lastLearningRepairRunCloseRate*100).toFixed(1)}%` : 'N/A'} / closeRateFormula=${s.rateMetrics.closeRateFormula}`, `Metadata repair status: missingTargetStop=${s.metadataRepairStatus.missingTargetStop} missingEntryPrice=${s.metadataRepairStatus.missingEntryPrice} quarantined=${s.metadataRepairStatus.quarantined}`,  `Open Residue: openRemaining=${s.openResidue.openRemaining} closeCandidates=${s.openResidue.closeCandidates} quarantined=${s.openResidue.quarantined} zeroCloseReasonTop3=${JSON.stringify(s.openResidue.zeroCloseReasonTop3)}`, `Attribution Quality: samples7d=${s.attributionQuality.samples7d} conditionCoverage=${s.attributionQuality.conditionCoverage} overfitRisk=${s.attributionQuality.overfitRisk} Condition min-sample status low=${s.attributionQuality.lowSampleConditions} unstable=${s.attributionQuality.unstableConditions}`, `Suggest Metrics: suggestSignals7d=${s.suggest.suggestSignals7d} diagnosticProposals7d=${s.suggest.diagnosticProposals7d} autoApplied7d=${s.suggest.autoApplied7d} totalDiagnosticEvents7d=${s.suggest.totalDiagnosticEvents7d} blocker=${s.suggest.blocker} status=${s.suggest.status}`, `Holding outlier status: outlierCount=${s.holdingOutlierStatus.outlierCount} excludedFromPromotion=${s.holdingOutlierStatus.excludedFromPromotion}`, `Promotion metric basis: ${s.promotionMetricBasis} promotionAllowed=${s.promotionAllowed}`,  `Gemini: nextScheduledAt=${s.gemini.nextScheduledAt ?? 'N/A'} recommendationOnly=${s.gemini.recommendationOnly}`, `Consistency Check: cohortBackfillApplied=${s.consistencyCheck.cohortBackfillApplied} cohortSumMatchesTotal=${s.consistencyCheck.cohortSumMatchesTotal} ghostRepairReflectedInPulse=${s.consistencyCheck.ghostRepairReflectedInPulse} repairRunSourceSeparated=${s.consistencyCheck.repairRunSourceSeparated} closeRateValid=${s.consistencyCheck.closeRateValid} starvationReasonConsistent=${s.consistencyCheck.starvationReasonConsistent} suggestMetricsConsistent=${s.consistencyCheck.suggestMetricsConsistent} promotionBasisConsistent=${s.consistencyCheck.promotionBasisConsistent} metricWarnings=${JSON.stringify(s.consistencyCheck.metricWarnings)}`, `executionImpact=${s.executionImpact} brokerOrdersCreated=${s.brokerOrdersCreated}`].join('\n'); }
