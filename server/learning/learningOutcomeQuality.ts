// @responsibility Learning Outcome Quality Patch v1 — read-only outcome/open/quarantine/attribution/suggest diagnostics with promotion safety guards
import { loadGhostPortfolio } from '../persistence/reflectionRepo.js';
import { loadConditionWeights } from '../persistence/conditionWeightsRepo.js';
import { loadCurrentSchemaRecords } from '../persistence/attributionRepo.js';
import { readJson, LEARNING_REPAIR_RUNS_FILE } from './learningStorage.js';
import { analyzeSampleStarvation } from './sampleStarvationGuard.js';
import { getGeminiLearningRuns } from './geminiUtilizationScheduler.js';
import { loadSuggestDiagnosticProposals } from './suggestThresholdCalibrator.js';
import { LEARNING_ATTRIBUTION_TARGET_7D, LEARNING_DEFAULT_MAX_HOLDING_MINUTES, LEARNING_DEFAULT_STOP_RETURN_PCT, LEARNING_DEFAULT_TARGET_RETURN_PCT } from './learningConstants.js';
import type { LearningCloseReason, LearningGhostCase, LearningOutcomeLabel } from './learningTypes.js';

const OUTCOMES: LearningOutcomeLabel[] = ['WIN', 'LOSS', 'BREAKEVEN', 'EXPIRED', 'DATA_CORRUPTED', 'QUARANTINED'];
const CLOSE_REASONS: LearningCloseReason[] = ['VIRTUAL_TAKE_PROFIT', 'VIRTUAL_STOP_LOSS', 'VIRTUAL_TIME_EXIT', 'VIRTUAL_SESSION_END_EXIT', 'VIRTUAL_DATA_STALE_EXIT'];
const QUARANTINE_REASONS = ['MISSING_ENTRY_PRICE', 'MISSING_TARGET_STOP', 'MISSING_PRICE_DATA', 'INVALID_TIMESTAMP', 'SYMBOL_NOT_FOUND', 'PRICE_PROVIDER_FAILED', 'DATA_STALE', 'STATUS_ENUM_MISMATCH', 'DUPLICATE_CASE', 'UNKNOWN'] as const;
const DEFAULT_CONDITION_COUNT = 27;

type QuarantineReason = typeof QUARANTINE_REASONS[number];
type ConfidenceBucket = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';

type LastRepair = { close?: { closed?: number; brokerOrdersCreated?: number }; outcome?: { finalized?: number }; attr?: { processedCount?: number; skippedCount?: number }; suggest?: { proposals?: unknown[] }; gemini?: { nextScheduledAt?: string }; criticalIntegrityEvents?: number; brokerOrdersCreated?: number };

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
  const sourceConfidenceBreakdown: Record<ConfidenceBucket, number> = { HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 };
  for (const g of closed) sourceConfidenceBreakdown[bucketConfidence(g.sourceConfidence)]++;
  const lowSourceRate = closed.length ? sourceConfidenceBreakdown.LOW / closed.length : 0;
  const quarantinedRate = closed.length ? outcomeCounts.QUARANTINED / closed.length : 0;
  const dataQualityScore = closed.length ? qualityOk / closed.length : 0;
  const overfitRisk = collectLearningAttributionQuality(now).overfitRisk;
  const guardBlockers = [
    closed.length < 100 ? 'closedTotal<100' : '',
    avg(returnR) <= 0 ? 'expectancyR<=0' : '',
    dataQualityScore < 0.8 ? 'dataQualityScore<0.8' : '',
    overfitRisk === 'HIGH' ? 'overfitRisk=HIGH' : '',
    lowSourceRate > 0.3 ? 'sourceConfidenceLOW>30%' : '',
    quarantinedRate > 0.1 ? 'quarantinedRate>10%' : '',
    winLossImbalanced(outcomeCounts.WIN, outcomeCounts.LOSS) ? 'WIN_LOSS_IMBALANCE' : '',
    concentrationRisk(closed) ? 'SYMBOL_SECTOR_CONCENTRATION' : '',
  ].filter(Boolean);
  return { closedTotal: closed.length, finalizedTotal: closed.filter(g => !!g.outcomeLabel).length, attributedTotal: attributed.length, ...outcomeCounts, ...closeReasonCounts, avgReturnPct: round(avg(returnPct)), avgReturnR: round(avg(returnR)), expectancyR: round(avg(returnR)), avgHoldingMinutes: round(avg(holds), 2), medianHoldingMinutes: round(median(holds), 2), maxWinR: round(returnR.length ? Math.max(...returnR) : 0), maxLossR: round(returnR.length ? Math.min(...returnR) : 0), dataQualityScore: round(dataQualityScore, 4), sourceConfidenceBreakdown, promotionAllowed: false as const, guardBlockers, autoApply: false as const, executionImpact: 'NONE' as const };
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
  const learned = stats.filter(s => s.samples >= 5 && Math.abs(s.effect) > 0.1);
  const lowSample = stats.filter(s => s.samples > 0 && s.samples < 5).map(s => s.conditionId);
  const unstable = stats.filter(s => s.samples < 10 || (s.highSamples < 3 && s.lowSamples < 3)).map(s => s.conditionId);
  const dataLeakageSuspect = records.some(r => r.tradeId.includes('future') || Object.keys(r.conditionScores ?? {}).some(k => Number(k) > 1000));
  const concentration = records.length ? Math.max(...Object.values(records.reduce<Record<string, number>>((acc, r) => { acc[r.stockCode] = (acc[r.stockCode] ?? 0) + 1; return acc; }, {}))) / records.length : 0;
  const overfitRisk = records.length < LEARNING_ATTRIBUTION_TARGET_7D || covered.length / Math.max(1, conditionIds.size) < 0.5 || concentration > 0.35 ? 'HIGH' : unstable.length > conditionIds.size * 0.35 ? 'MEDIUM' : 'LOW';
  return { samples7d: recent7.length, targetSamples: LEARNING_ATTRIBUTION_TARGET_7D, starvation: starvation.starvationFlag, processed: records.length, skipped: starvation.reasons.data_quarantine_too_many + starvation.reasons.close_without_label + starvation.reasons.label_without_attribution, conditionCoverage: round(covered.length / Math.max(1, conditionIds.size), 4), learnedConditions: learned.map(s => s.conditionId), unlearnedConditions: stats.filter(s => s.samples === 0).map(s => s.conditionId), lowSampleConditions: lowSample, topPositiveConditions: [...stats].sort((a, b) => b.effect - a.effect).slice(0, 5), topNegativeConditions: [...stats].sort((a, b) => a.effect - b.effect).slice(0, 5), unstableConditions: unstable, dataLeakageSuspect, overfitRisk, recommendationOnly: true as const, autoApply: false as const, executionImpact: 'NONE' as const };
}

export function collectLearningSuggestReport(now: Date = new Date()) {
  const proposals = loadSuggestDiagnosticProposals();
  const diagnostic = proposals.filter(p => p.autoApply === false);
  const latest = diagnostic.at(-1);
  return { totalProposals: proposals.length, diagnosticProposals: diagnostic.length, autoApply: false as const, channel: latest?.channel ?? 'N/A', currentThreshold: latest?.currentThreshold ?? 0, observedScore: latest?.observedScore ?? 0, sampleSize: latest?.sampleSize ?? 0, blocker: latest?.blocker ?? 'NO_DIAGNOSTIC_PROPOSAL', recommendation: latest?.recommendation ?? 'run /suggest_diagnostics to create observe-only proposal', riskLevel: latest?.riskLevel ?? 'LOW', requiredAdditionalSamples: Math.max(0, LEARNING_ATTRIBUTION_TARGET_7D - collectLearningAttributionQuality(now).samples7d), promotionAllowed: false as const, executionImpact: 'NONE' as const };
}

export function collectLearningPulseV3(now: Date = new Date()) {
  const last = lastRepairRun();
  const outcome = collectLearningOutcomeSummary(now);
  const open = collectLearningOpenResidue(now);
  const attr = collectLearningAttributionQuality(now);
  const suggest = collectLearningSuggestReport(now);
  const gemini = getGeminiLearningRuns().at(-1);
  return { repairLastRun: { closed: last?.close?.closed ?? 0, outcomeFinalized: last?.outcome?.finalized ?? 0, attributionProcessed: last?.attr?.processedCount ?? 0, diagnosticSuggest: last?.suggest?.proposals?.length ?? 0, criticalIntegrityEvents: last?.criticalIntegrityEvents ?? 0, brokerOrdersCreated: last?.brokerOrdersCreated ?? last?.close?.brokerOrdersCreated ?? 0 }, outcomeQuality: { win: outcome.WIN, loss: outcome.LOSS, expired: outcome.EXPIRED, quarantined: outcome.QUARANTINED, expectancyR: outcome.expectancyR, dataQualityScore: outcome.dataQualityScore }, openResidue: { openRemaining: open.openRemaining, closeCandidates: open.closeCandidates, quarantined: open.quarantined, zeroCloseReasonTop3: open.zeroCloseReasonTop3 }, attributionQuality: { samples7d: attr.samples7d, conditionCoverage: attr.conditionCoverage, overfitRisk: attr.overfitRisk }, suggest: { proposals: suggest.totalProposals, autoApply: false as const }, gemini: { nextScheduledAt: gemini?.nextScheduledAt, recommendationOnly: true as const }, executionImpact: 'NONE' as const };
}

export function formatLearningOutcomeSummary(s: ReturnType<typeof collectLearningOutcomeSummary>): string { return [`📈 learning_outcome_summary`, `closedTotal=${s.closedTotal} finalizedTotal=${s.finalizedTotal} attributedTotal=${s.attributedTotal}`, `WIN=${s.WIN} LOSS=${s.LOSS} BREAKEVEN=${s.BREAKEVEN} EXPIRED=${s.EXPIRED} DATA_CORRUPTED=${s.DATA_CORRUPTED} QUARANTINED=${s.QUARANTINED}`, `VIRTUAL_TAKE_PROFIT=${s.VIRTUAL_TAKE_PROFIT} VIRTUAL_STOP_LOSS=${s.VIRTUAL_STOP_LOSS} VIRTUAL_TIME_EXIT=${s.VIRTUAL_TIME_EXIT} VIRTUAL_SESSION_END_EXIT=${s.VIRTUAL_SESSION_END_EXIT} VIRTUAL_DATA_STALE_EXIT=${s.VIRTUAL_DATA_STALE_EXIT}`, `avgReturnPct=${s.avgReturnPct} avgReturnR=${s.avgReturnR} expectancyR=${s.expectancyR}`, `avgHoldingMinutes=${s.avgHoldingMinutes} medianHoldingMinutes=${s.medianHoldingMinutes} maxWinR=${s.maxWinR} maxLossR=${s.maxLossR}`, `dataQualityScore=${s.dataQualityScore} sourceConfidenceBreakdown=${JSON.stringify(s.sourceConfidenceBreakdown)}`, `promotionAllowed=${s.promotionAllowed} autoApply=${s.autoApply} executionImpact=${s.executionImpact} guardBlockers=${s.guardBlockers.join(',') || 'none'}`].join('\n'); }
export function formatLearningOpenResidue(s: ReturnType<typeof collectLearningOpenResidue>): string { return [`🧩 learning_open_residue`, `openRemaining=${s.openRemaining} closeCandidates=${s.closeCandidates} notYetMatured=${s.notYetMatured}`, `missingEntryPrice=${s.missingEntryPrice} missingTargetStop=${s.missingTargetStop} missingPriceData=${s.missingPriceData} staleData=${s.staleData} quarantined=${s.quarantined}`, `oldestOpenAge=${s.oldestOpenAge} zeroCloseReasonTop3=${JSON.stringify(s.zeroCloseReasonTop3)}`, `nextAction=${s.nextAction}`, `executionImpact=${s.executionImpact} brokerOrdersCreated=${s.brokerOrdersCreated}`].join('\n'); }
export function formatLearningQuarantineReport(s: ReturnType<typeof collectLearningQuarantineReport>): string { return [`🚧 learning_quarantine_report`, `totalQuarantined=${s.totalQuarantined}`, `reasonBreakdown=${JSON.stringify(s.reasonBreakdown)}`, `examples=${JSON.stringify(s.examples)}`, `recoverableCount=${s.recoverableCount} unrecoverableCount=${s.unrecoverableCount}`, `recommendedFix=${s.recommendedFix}`, `executionImpact=${s.executionImpact}`].join('\n'); }
export function formatLearningAttributionQuality(s: ReturnType<typeof collectLearningAttributionQuality>): string { return [`🧬 learning_attribution_quality`, `samples7d=${s.samples7d} targetSamples=${s.targetSamples} starvation=${s.starvation}`, `processed=${s.processed} skipped=${s.skipped} conditionCoverage=${s.conditionCoverage}`, `learnedConditions=${JSON.stringify(s.learnedConditions)} unlearnedConditions=${JSON.stringify(s.unlearnedConditions)} lowSampleConditions=${JSON.stringify(s.lowSampleConditions)}`, `topPositiveConditions=${JSON.stringify(s.topPositiveConditions)} topNegativeConditions=${JSON.stringify(s.topNegativeConditions)}`, `unstableConditions=${JSON.stringify(s.unstableConditions)} dataLeakageSuspect=${s.dataLeakageSuspect} overfitRisk=${s.overfitRisk}`, `recommendationOnly=${s.recommendationOnly} autoApply=${s.autoApply} executionImpact=${s.executionImpact}`].join('\n'); }
export function formatLearningSuggestReport(s: ReturnType<typeof collectLearningSuggestReport>): string { return [`💡 learning_suggest_report`, `totalProposals=${s.totalProposals} diagnosticProposals=${s.diagnosticProposals} autoApply=${s.autoApply}`, `channel=${s.channel} currentThreshold=${s.currentThreshold} observedScore=${s.observedScore} sampleSize=${s.sampleSize}`, `blocker=${s.blocker} recommendation=${s.recommendation}`, `riskLevel=${s.riskLevel} requiredAdditionalSamples=${s.requiredAdditionalSamples}`, `promotionAllowed=${s.promotionAllowed} executionImpact=${s.executionImpact}`].join('\n'); }
export function formatLearningPulseV3(s: ReturnType<typeof collectLearningPulseV3>): string { return [`🩺 Learning Pulse v3`, `Repair Last Run: closed=${s.repairLastRun.closed} outcomeFinalized=${s.repairLastRun.outcomeFinalized} attributionProcessed=${s.repairLastRun.attributionProcessed} diagnosticSuggest=${s.repairLastRun.diagnosticSuggest} criticalIntegrityEvents=${s.repairLastRun.criticalIntegrityEvents} brokerOrdersCreated=${s.repairLastRun.brokerOrdersCreated}`, `Outcome Quality: win=${s.outcomeQuality.win} loss=${s.outcomeQuality.loss} expired=${s.outcomeQuality.expired} quarantined=${s.outcomeQuality.quarantined} expectancyR=${s.outcomeQuality.expectancyR} dataQualityScore=${s.outcomeQuality.dataQualityScore}`, `Open Residue: openRemaining=${s.openResidue.openRemaining} closeCandidates=${s.openResidue.closeCandidates} quarantined=${s.openResidue.quarantined} zeroCloseReasonTop3=${JSON.stringify(s.openResidue.zeroCloseReasonTop3)}`, `Attribution Quality: samples7d=${s.attributionQuality.samples7d} conditionCoverage=${s.attributionQuality.conditionCoverage} overfitRisk=${s.attributionQuality.overfitRisk}`, `Suggest: proposals=${s.suggest.proposals} autoApply=${s.suggest.autoApply}`, `Gemini: nextScheduledAt=${s.gemini.nextScheduledAt ?? 'N/A'} recommendationOnly=${s.gemini.recommendationOnly}`, `executionImpact=${s.executionImpact}`].join('\n'); }
