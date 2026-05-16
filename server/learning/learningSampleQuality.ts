// @responsibility Learning sample quality metadata recovery diagnostics.
import fs from 'fs';
import { loadGhostPortfolio, saveGhostPortfolio } from '../persistence/reflectionRepo.js';
import { scanTraceFile } from '../persistence/paths.js';
import { buildCounterfactualKey, recordCounterfactualCase, loadCounterfactuals, saveCounterfactuals, type CounterfactualEntry } from './counterfactualShadow.js';
import { LEARNING_DEFAULT_MAX_HOLDING_MINUTES, LEARNING_DEFAULT_STOP_RETURN_PCT, LEARNING_DEFAULT_TARGET_RETURN_PCT } from './learningConstants.js';
import { appendJson, readJson, LEARNING_COHORT_BACKFILL_RUNS_FILE } from './learningStorage.js';
import type { LearningCohortType, LearningGhostCase, LearningRecoveryConfidence } from './learningTypes.js';

const COHORTS: LearningCohortType[] = ['FRESH_SHADOW', 'BACKLOG_REPAIR', 'GHOST_REPAIR', 'RECOVERED_METADATA', 'QUARANTINED', 'COUNTERFACTUAL_BLOCKED', 'COUNTERFACTUAL_MISSED_WIN', 'COUNTERFACTUAL_AVOIDED_LOSS', 'GHOST_REPAIR_PENDING', 'OPEN_UNRESOLVED'];
const OUTCOME_LABELS = ['WIN', 'LOSS', 'BREAKEVEN', 'EXPIRED', 'DATA_CORRUPTED', 'QUARANTINED', 'ACTIVE', 'MISSED_WIN', 'AVOIDED_LOSS', 'GOOD_BLOCK', 'BAD_BLOCK', 'NEUTRAL_BLOCK'] as const;
const COUNTERFACTUAL_LABELS = ['MISSED_WIN', 'AVOIDED_LOSS', 'GOOD_BLOCK', 'BAD_BLOCK', 'NEUTRAL_BLOCK', 'DATA_INSUFFICIENT', 'QUARANTINED', 'PENDING_OUTCOME'] as const;
type CounterfactualLabel = typeof COUNTERFACTUAL_LABELS[number];
type CounterfactualRecoverySource = NonNullable<CounterfactualEntry['recoverySource']>;
type CounterfactualRecoveryConfidence = NonNullable<CounterfactualEntry['recoveryConfidence']>;
const COUNTERFACTUAL_DEFAULT_TARGET_RETURN_PCT = 6;
const COUNTERFACTUAL_DEFAULT_STOP_RETURN_PCT = -3;
const COUNTERFACTUAL_ATR_TARGET_MULTIPLE = 3;
const COUNTERFACTUAL_ATR_STOP_MULTIPLE = 1.5;

type MaybeEntry = { stockCode?: string; stockName?: string; priceAtSignal?: number; gateScore?: number; regime?: string; conditionKeys?: string[]; skipReason?: string; label?: CounterfactualLabel; signalTime?: string; signalDate?: string };

function num(v: unknown): number | undefined { return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined; }
function avg(xs: number[]): number { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
function round(n: number, d = 4): number { return Number((Number.isFinite(n) ? n : 0).toFixed(d)); }
function ageMinutes(iso: string | undefined, now: Date): number { const t = iso ? new Date(iso).getTime() : NaN; return Number.isFinite(t) ? Math.max(0, Math.floor((now.getTime() - t) / 60000)) : 0; }
function holdMinutes(g: LearningGhostCase, now: Date): number { return (g as LearningGhostCase & { holdingMinutes?: number }).holdingMinutes ?? ageMinutes(g.entryAt ?? `${g.signalDate}T00:00:00.000Z`, g.closedAt ? new Date(g.closedAt) : now); }
export function learningEntryPrice(g: LearningGhostCase): number | undefined { return num(g.entryPrice) ?? num(g.signalPriceKrw); }
function finalReturnR(g: LearningGhostCase): number | undefined { return typeof g.returnR === 'number' && Number.isFinite(g.returnR) ? g.returnR : undefined; }
function isCounterfactualLabel(label: unknown): boolean { return ['MISSED_WIN', 'AVOIDED_LOSS', 'GOOD_BLOCK', 'BAD_BLOCK', 'NEUTRAL_BLOCK'].includes(String(label)); }
export function hasMissingLearningMetadata(g: LearningGhostCase): boolean { return !learningEntryPrice(g) || !num(g.targetPrice) || !num(g.stopPrice); }

function isClosedLifecycle(g: LearningGhostCase): boolean { return g.closed === true || !!g.closedAt || (!!g.closeReason && g.closeReason !== 'QUARANTINED_DATA_MISSING'); }
function isRepairLinked(g: LearningGhostCase): boolean { return !!g.repairRunId || String(g.id ?? '').includes('repair') || String(g.closeReason ?? '').startsWith('VIRTUAL_'); }
function isTrueQuarantine(g: LearningGhostCase): boolean { return !isClosedLifecycle(g) && (!learningEntryPrice(g) || g.dataQuality === 'QUARANTINED' || !!g.quarantinedReason); }
function usableExplicitCohort(g: LearningGhostCase): LearningCohortType | undefined {
  if (!g.cohortType) return undefined;
  if (g.cohortType === 'QUARANTINED' && (isClosedLifecycle(g) || ['WIN','LOSS','BREAKEVEN','EXPIRED'].includes(String(g.outcomeLabel)))) return undefined;
  return g.cohortType;
}
export function inferLearningCohort(g: LearningGhostCase): LearningCohortType {
  const explicit = usableExplicitCohort(g);
  if (explicit) return explicit;
  if (isCounterfactualLabel(g.outcomeLabel)) return g.outcomeLabel === 'MISSED_WIN' ? 'COUNTERFACTUAL_MISSED_WIN' : g.outcomeLabel === 'AVOIDED_LOSS' ? 'COUNTERFACTUAL_AVOIDED_LOSS' : 'COUNTERFACTUAL_BLOCKED';
  if (g.entryPriceRecovered || g.targetStopRecovered || g.priceDataRecovered || g.recoveryConfidence) return 'RECOVERED_METADATA';
  if (isClosedLifecycle(g)) {
    if (g.caseKind === 'ghost') return 'GHOST_REPAIR';
    if (g.caseKind === 'shadow' && !isRepairLinked(g)) return 'FRESH_SHADOW';
    return 'BACKLOG_REPAIR';
  }
  if (g.caseKind === 'shadow' && !hasMissingLearningMetadata(g)) return 'FRESH_SHADOW';
  if (isTrueQuarantine(g)) return 'QUARANTINED';
  if (g.caseKind === 'ghost' || g.pendingRetryReason) return 'GHOST_REPAIR_PENDING';
  return 'OPEN_UNRESOLVED';
}

function cohortStats(ghosts: LearningGhostCase[], now: Date) {
  const out: Record<string, { count: number; expectancyR: number | 'N/A'; winRate: number | 'N/A'; avgHoldingMinutes: number }> = {};
  for (const c of COHORTS) {
    const rows = ghosts.filter(g => inferLearningCohort(g) === c);
    const rs = rows.map(finalReturnR).filter((v): v is number => v !== undefined);
    const labeled = rows.filter(g => ['WIN', 'LOSS', 'BREAKEVEN', 'EXPIRED'].includes(String(g.outcomeLabel)));
    out[c] = { count: rows.length, expectancyR: c === 'QUARANTINED' || rs.length === 0 ? 'N/A' : round(avg(rs)), winRate: c === 'QUARANTINED' || labeled.length === 0 ? 'N/A' : round(rows.filter(g => g.outcomeLabel === 'WIN').length / labeled.length), avgHoldingMinutes: round(avg(rows.map(g => holdMinutes(g, now))), 2) };
  }
  return out;
}

export function collectLearningCohortSummary(now: Date = new Date()) {
  const ghosts = loadGhostPortfolio() as LearningGhostCase[];
  const byCohort = Object.fromEntries(COHORTS.map(c => [c, ghosts.filter(g => inferLearningCohort(g) === c).length])) as Record<LearningCohortType, number>;
  const closedOrFinalized = ghosts.filter(g => g.closed || !!g.outcomeLabel);
  const byOutcomeLabel = Object.fromEntries(OUTCOME_LABELS.map(label => [label, closedOrFinalized.filter(g => g.outcomeLabel === label).length]));
  const closedRepairCount = byCohort.BACKLOG_REPAIR + byCohort.GHOST_REPAIR;
  const counterfactualCount = byCohort.COUNTERFACTUAL_BLOCKED + byCohort.COUNTERFACTUAL_MISSED_WIN + byCohort.COUNTERFACTUAL_AVOIDED_LOSS;
  const promotionEligible = ghosts.filter(g => inferLearningCohort(g) === 'FRESH_SHADOW' && !isHoldingOutlier(g, now));
  const stats = cohortStats(ghosts, now);
  const metricExclusionReasonByCohort = { QUARANTINED: 'N/A: true data-quality defect cohort; WIN/LOSS expectancy is reported by outcomeLabel, not quarantine cohort' };
  return { totalSamples: ghosts.length, byCohort, byOutcomeLabel, outcomeLabelSampleCount: closedOrFinalized.length, openPendingCount: byCohort.GHOST_REPAIR_PENDING + byCohort.OPEN_UNRESOLVED, closedRepairCount, freshShadowCount: byCohort.FRESH_SHADOW, backlogRepairCount: byCohort.BACKLOG_REPAIR, ghostRepairCount: byCohort.GHOST_REPAIR, openUnresolvedCount: byCohort.OPEN_UNRESOLVED, recoveredMetadataCount: byCohort.RECOVERED_METADATA, trueQuarantinedCount: byCohort.QUARANTINED, quarantinedCount: byCohort.QUARANTINED, counterfactualCount, counterfactualBuiltCount: counterfactualCount, counterfactualCandidateCount: counterfactualCount, expectancyByCohort: Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, v.expectancyR])), winRateByCohort: Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, v.winRate])), metricExclusionReasonByCohort, avgHoldingMinutesByCohort: Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, v.avgHoldingMinutes])), promotionEligibleSamples: promotionEligible.length, promotionExcludedSamples: ghosts.length - promotionEligible.length, exclusionReason: 'promotion primary metric uses FRESH_SHADOW only; GHOST_REPAIR is displayed separately from BACKLOG_REPAIR and both are diagnostic-only', executionImpact: 'NONE' as const };
}

export function learningCohortBackfillRun(now: Date = new Date()) {
  const all = loadGhostPortfolio() as LearningGhostCase[];
  let updated = 0;
  const before: Record<string, number> = {};
  const after: Record<string, number> = {};
  for (const g of all) {
    const old = g.cohortType ?? 'UNSET';
    before[old] = (before[old] ?? 0) + 1;
    const next = inferLearningCohort({ ...g, cohortType: usableExplicitCohort(g) });
    after[next] = (after[next] ?? 0) + 1;
    if (g.cohortType !== next) { g.cohortType = next; g.cohortBackfilledAt = now.toISOString(); g.cohortBackfillReason = 'Learning Cohort Truth & Metric Consistency Patch v1; outcomeLabel preserved separately; executionImpact=NONE'; g.executionImpact = 'NONE'; updated++; }
  }
  if (updated > 0) saveGhostPortfolio(all);
  const result = { scanned: all.length, updated, before, after, runAt: now.toISOString(), executionImpact: 'NONE' as const, brokerOrdersCreated: 0 as const, promotionAllowed: false as const };
  appendJson(LEARNING_COHORT_BACKFILL_RUNS_FILE, result);
  return result;
}

export function collectLearningCohortConsistencyStatus(now: Date = new Date()) {
  const summary = collectLearningCohortSummary(now);
  const byCohortTotal = Object.values(summary.byCohort).reduce((s, n) => s + n, 0);
  const cohortSumMatchesTotal = byCohortTotal === summary.totalSamples;
  const runs = readJson<Array<{ runAt?: string; scanned?: number; after?: Record<string, number> }>>(LEARNING_COHORT_BACKFILL_RUNS_FILE, []);
  const last = runs.at(-1);
  const lastRunAt = last?.runAt;
  const lastRunMs = lastRunAt ? new Date(lastRunAt).getTime() : NaN;
  const ageHours = Number.isFinite(lastRunMs) ? Math.max(0, (now.getTime() - lastRunMs) / 3600000) : undefined;
  const lastAfterTotal = last?.after ? Object.values(last.after).reduce((s, n) => s + Number(n ?? 0), 0) : undefined;
  const lastSnapshotTotal = typeof last?.scanned === 'number' ? last.scanned : lastAfterTotal;
  const snapshotStale = !!last && (lastSnapshotTotal !== summary.totalSamples || (ageHours ?? 0) > 24);
  const snapshotStatus = !last ? 'COHORT_BACKFILL_SNAPSHOT_MISSING' : snapshotStale ? 'COHORT_BACKFILL_SNAPSHOT_STALE' : 'OK';
  return {
    totalSamples: summary.totalSamples,
    byCohortTotal,
    cohortSumMatchesTotal,
    ghostRepairReflectedInPulse: cohortSumMatchesTotal,
    lastCohortBackfillRunAt: lastRunAt,
    lastCohortBackfillSnapshotTotal: lastSnapshotTotal,
    snapshotStatus,
    metricWarnings: cohortSumMatchesTotal ? [] : ['COHORT_AGGREGATE_SUM_MISMATCH'],
    metricInfos: snapshotStatus === 'COHORT_BACKFILL_SNAPSHOT_STALE' ? ['COHORT_BACKFILL_SNAPSHOT_STALE'] : [],
    executionImpact: 'NONE' as const,
    brokerOrdersCreated: 0 as const,
    promotionAllowed: false as const,
  };
}

function recoverPlan(g: LearningGhostCase) {
  const entry = learningEntryPrice(g);
  const entryRecovered = !num(g.entryPrice) && !!num(g.signalPriceKrw);
  const targetStopRecovered = !!entry && (!num(g.targetPrice) || !num(g.stopPrice));
  const priceDataRecovered = !!entry && !num(g.exitPriceVirtual) && typeof g.currentReturnPct !== 'number';
  const unrecoverable = !entry && !entryRecovered;
  return { entry, entryRecovered, targetStopRecovered, priceDataRecovered, unrecoverable, source: entryRecovered ? 'signalPriceKrw_near_signal_timestamp' : targetStopRecovered ? 'default_R_rule_from_entry_price' : priceDataRecovered ? 'neutral_entry_price_snapshot' : 'none' };
}

export function learningMetadataRepairDryRun() {
  const ghosts = loadGhostPortfolio() as LearningGhostCase[];
  const open = ghosts.filter(g => !g.closed);
  let missingEntryPrice = 0, missingTargetStop = 0, missingPriceData = 0, recoverableEntry = 0, recoverableTargetStop = 0, unrecoverable = 0;
  const proposedRecoverySource: Record<string, number> = {};
  for (const g of open) {
    if (!learningEntryPrice(g)) missingEntryPrice++;
    if (!num(g.targetPrice) || !num(g.stopPrice)) missingTargetStop++;
    if (!num(g.exitPriceVirtual) && typeof g.currentReturnPct !== 'number') missingPriceData++;
    const p = recoverPlan(g);
    if (p.entryRecovered) recoverableEntry++;
    if (p.targetStopRecovered) recoverableTargetStop++;
    if (p.unrecoverable) unrecoverable++;
    if (p.source !== 'none') proposedRecoverySource[p.source] = (proposedRecoverySource[p.source] ?? 0) + 1;
  }
  return { scanned: open.length, missingEntryPrice, missingTargetStop, missingPriceData, recoverableEntry, recoverableTargetStop, unrecoverable, proposedRecoverySource, expectedCohortAfterRepair: 'RECOVERED_METADATA' as const, executionImpact: 'NONE' as const };
}

export function learningMetadataRepairRun(now: Date = new Date()) {
  const all = loadGhostPortfolio() as LearningGhostCase[];
  let entryRecovered = 0, targetStopRecovered = 0, priceDataRecovered = 0, movedToRecoveredMetadata = 0, stillQuarantined = 0, unrecoverable = 0;
  for (const g of all.filter(x => !x.closed)) {
    const p = recoverPlan(g);
    if (p.unrecoverable) { unrecoverable++; stillQuarantined++; continue; }
    const entry = p.entry ?? num(g.signalPriceKrw);
    let changed = false;
    if (p.entryRecovered && entry) { g.entryPrice = entry; g.entryPriceRecovered = true; entryRecovered++; changed = true; }
    if (p.targetStopRecovered && entry) { if (!num(g.targetPrice)) g.targetPrice = round(entry * (1 + LEARNING_DEFAULT_TARGET_RETURN_PCT / 100), 4); if (!num(g.stopPrice)) g.stopPrice = round(entry * (1 + LEARNING_DEFAULT_STOP_RETURN_PCT / 100), 4); g.targetStopRecovered = true; targetStopRecovered++; changed = true; }
    if (p.priceDataRecovered && entry) { g.exitPriceVirtual = entry; g.currentReturnPct = 0; g.priceDataRecovered = true; priceDataRecovered++; changed = true; }
    if (changed) { g.cohortType = 'RECOVERED_METADATA'; g.recoverySource = p.source; g.recoveryConfidence = p.entryRecovered ? 'RECOVERED' : 'MEDIUM'; g.sourceConfidence = g.recoveryConfidence; g.recoveredAt = now.toISOString(); g.recoveryReason = 'post-hoc metadata recovery; never VERIFIED; executionImpact=NONE'; g.dataQuality = hasMissingLearningMetadata(g) ? 'QUARANTINED' : 'OK'; if (g.dataQuality !== 'QUARANTINED') { delete g.quarantinedReason; movedToRecoveredMetadata++; } else stillQuarantined++; }
  }
  saveGhostPortfolio(all);
  return { scanned: all.filter(g => !g.closed).length, entryRecovered, targetStopRecovered, priceDataRecovered, movedToRecoveredMetadata, stillQuarantined, unrecoverable, executionImpact: 'NONE' as const, brokerOrdersCreated: 0 as const, livePositionTouched: false as const };
}

function readJsonArray(file: string): unknown[] { try { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')) as unknown[] : []; } catch { return []; } }
function todayTraceEntries(now: Date): MaybeEntry[] {
  return readJsonArray(scanTraceFile(now.toISOString().slice(0, 10))).map(x => x as Record<string, unknown>).filter(x => String(x.blockedReason ?? x.skipReason ?? x.reason ?? '').length > 0).map(x => ({ stockCode: String(x.stockCode ?? x.code ?? ''), stockName: String(x.stockName ?? x.name ?? 'N/A'), priceAtSignal: num(x.priceAtSignal) ?? num(x.price) ?? num(x.signalPriceKrw), gateScore: Number(x.gateScore ?? x.score ?? 0), regime: String(x.regime ?? 'UNKNOWN'), conditionKeys: Array.isArray(x.conditionKeys) ? x.conditionKeys.map(String) : [], skipReason: String(x.blockedReason ?? x.skipReason ?? x.reason ?? 'BLOCKED_TRACE'), signalTime: String(x.signalTime ?? x.at ?? now.toISOString()) }));
}
function ghostBlockedEntries(): MaybeEntry[] {
  return (loadGhostPortfolio() as LearningGhostCase[]).filter(g => !!(g as any).blockedReason || !!(g as any).rejectionReason || inferLearningCohort(g) === 'QUARANTINED').map(g => ({ stockCode: g.stockCode, stockName: g.stockName, priceAtSignal: learningEntryPrice(g), gateScore: Number((g as any).gateScore ?? 0), regime: String((g as any).regime ?? 'UNKNOWN'), conditionKeys: Object.keys(g.conditionScores ?? {}), skipReason: String((g as any).blockedReason ?? (g as any).rejectionReason ?? g.quarantinedReason ?? 'BLOCKED_BUY'), label: g.outcomeLabel === 'WIN' ? 'MISSED_WIN' : g.outcomeLabel === 'LOSS' ? 'AVOIDED_LOSS' : hasMissingLearningMetadata(g) ? 'DATA_INSUFFICIENT' : 'NEUTRAL_BLOCK', signalTime: g.entryAt ?? `${g.signalDate}T00:00:00.000Z` }));
}
function labelBreakdown(entries: MaybeEntry[]) { return Object.fromEntries(COUNTERFACTUAL_LABELS.map(l => [l, entries.filter(e => (e.label ?? 'NEUTRAL_BLOCK') === l).length])); }
function counterfactualSourceId(c: MaybeEntry, now: Date): string {
  const date = (c.signalTime ?? now.toISOString()).slice(0, 10);
  return `${c.stockCode}:${date}:${c.skipReason ?? 'BLOCKED_BUY'}`;
}
function candidateKey(c: MaybeEntry, now: Date): string {
  const tradingDate = (c.signalTime ?? now.toISOString()).slice(0, 10);
  return buildCounterfactualKey({ sourceCandidateId: counterfactualSourceId(c, now), stockCode: c.stockCode, tradingDate, blockedReason: c.skipReason ?? 'BLOCKED_BUY', hypotheticalSide: 'BUY', strategyId: 'default' });
}
function normalizeCounterfactuals(rows = loadCounterfactuals()): CounterfactualEntry[] {
  return rows.map((e) => ({
    ...e,
    counterfactualKey: e.counterfactualKey ?? buildCounterfactualKey({ sourceCandidateId: e.sourceCandidateId ?? `${e.stockCode}:${e.signalDate}:${e.blockedReason ?? e.skipReason}`, stockCode: e.stockCode, tradingDate: e.signalDate, blockedReason: e.blockedReason ?? e.skipReason, hypotheticalSide: e.hypotheticalSide ?? 'BUY', strategyId: e.strategyId ?? 'default' }),
    sourceCandidateId: e.sourceCandidateId ?? `${e.stockCode}:${e.signalDate}:${e.blockedReason ?? e.skipReason}`,
    symbol: e.symbol ?? e.stockCode,
    tradingDate: e.tradingDate ?? e.signalDate,
    blockedReason: e.blockedReason ?? e.skipReason,
    hypotheticalSide: e.hypotheticalSide ?? 'BUY',
    strategyId: e.strategyId ?? 'default',
    hypotheticalEntryPrice: e.hypotheticalEntryPrice ?? e.priceAtSignal,
    outcomeStatus: e.outcomeStatus ?? (e.outcomeLabel ? 'LABELED' : 'PENDING'),
  }));
}
function statusCounts(rows = normalizeCounterfactuals()) {
  const labeledCount = rows.filter((e) => e.outcomeStatus === 'LABELED' && !!e.outcomeLabel).length;
  const dataInsufficientCount = rows.filter((e) => e.outcomeStatus === 'DATA_INSUFFICIENT').length;
  const quarantinedCount = rows.filter((e) => e.outcomeStatus === 'QUARANTINED').length;
  const expiredCount = rows.filter((e) => e.outcomeStatus === 'EXPIRED').length;
  const unresolvedCount = rows.filter((e) => e.outcomeStatus === 'UNRESOLVED').length;
  const pendingOutcomeCount = rows.length - labeledCount - dataInsufficientCount - quarantinedCount - expiredCount - unresolvedCount;
  return { labeledCount, pendingOutcomeCount, dataInsufficientCount, quarantinedCount, expiredCount, unresolvedCount };
}
type CounterfactualDuplicateSuppressionStatus = 'OK' | 'DUPLICATE_GUARD_MISSING';
function counterfactualInvariant(base: {
  candidateCount: number;
  eligibleCount: number;
  builtUniqueCount: number;
  buildEventCount?: number;
  duplicateSuppressedCount?: number;
} & ReturnType<typeof statusCounts>) {
  const statusSum = base.labeledCount + base.pendingOutcomeCount + base.dataInsufficientCount + base.quarantinedCount + base.expiredCount + base.unresolvedCount;
  const countInvariantValid = base.builtUniqueCount === statusSum && base.builtUniqueCount <= base.eligibleCount && base.eligibleCount <= base.candidateCount;
  const metricWarnings: string[] = [];
  const metricInfos: string[] = [];
  let duplicateSuppressionStatus: CounterfactualDuplicateSuppressionStatus = 'OK';
  if (base.builtUniqueCount > base.candidateCount) metricWarnings.push('BUILT_UNIQUE_GT_CANDIDATE', 'COUNTERFACTUAL_BUILT_GT_CANDIDATE');
  if ((base.buildEventCount ?? 0) > base.candidateCount) {
    if ((base.duplicateSuppressedCount ?? 0) > 0) metricInfos.push(`COUNTERFACTUAL_DUPLICATE_SUPPRESSED:${base.duplicateSuppressedCount ?? 0}`);
    else {
      metricWarnings.push('DUPLICATE_GUARD_MISSING');
      duplicateSuppressionStatus = 'DUPLICATE_GUARD_MISSING';
    }
  }
  if (!countInvariantValid) metricWarnings.push('COUNTERFACTUAL_COUNT_INVARIANT_BROKEN');
  return { countInvariantValid, metricWarnings, metricInfos, duplicateSuppressionStatus };
}
export function counterfactualBuildDryRun(now: Date = new Date()) {
  const candidates = [...todayTraceEntries(now), ...ghostBlockedEntries()];
  const existing = normalizeCounterfactuals();
  const existingKeys = new Set(existing.map((e) => e.counterfactualKey));
  const validCandidates = candidates.filter(c => c.stockCode && num(c.priceAtSignal));
  const eligibleRows = validCandidates.filter(c => !existingKeys.has(candidateKey(c, now)));
  const duplicateSuppressedCount = validCandidates.length - eligibleRows.length;
  const counts = statusCounts(existing);
  const builtUniqueCount = existing.length;
  const candidateCount = Math.max(candidates.length, builtUniqueCount);
  const eligibleCount = Math.max(validCandidates.length, builtUniqueCount);
  const inv = counterfactualInvariant({ candidateCount, eligibleCount, buildEventCount: 0, builtUniqueCount, duplicateSuppressedCount, ...counts });
  return { candidateCount, eligibleCount, buildEventCount: 0, builtUniqueCount, duplicateSuppressedCount, ...counts, countInvariantValid: inv.countInvariantValid, metricWarnings: inv.metricWarnings, metricInfos: inv.metricInfos, duplicateSuppressionStatus: inv.duplicateSuppressionStatus, rawCandidateCount: candidates.length, blocker: eligibleRows.length === 0 ? 'NO_ELIGIBLE_BLOCKED_CANDIDATES' : 'NONE', scannedBlocked: candidates.length, eligible: eligibleCount, built: 0, pending: counts.pendingOutcomeCount, quarantined: candidates.length - validCandidates.length, labelBreakdown: labelBreakdown([]), sampleSize: builtUniqueCount, status: inv.metricWarnings.includes('BUILT_UNIQUE_GT_CANDIDATE') || inv.metricWarnings.includes('COUNTERFACTUAL_COUNT_INVARIANT_BROKEN') ? 'ERROR' : inv.metricWarnings.length ? 'WARN' : 'OK', executionImpact: 'NONE' as const, brokerOrdersCreated: 0 as const, promotionAllowed: false as const };
}
export function counterfactualBuildRun(now: Date = new Date()) {
  const candidates = [...todayTraceEntries(now), ...ghostBlockedEntries()];
  const dry = counterfactualBuildDryRun(now);
  let buildEventCount = 0;
  let duplicateSuppressedCount = 0;
  for (const c of candidates) {
    if (!c.stockCode || !num(c.priceAtSignal)) continue;
    buildEventCount++;
    const result = recordCounterfactualCase({ stockCode: c.stockCode, stockName: c.stockName ?? 'N/A', priceAtSignal: c.priceAtSignal!, gateScore: c.gateScore ?? 0, regime: c.regime ?? 'UNKNOWN', conditionKeys: c.conditionKeys ?? [], skipReason: c.skipReason ?? 'BLOCKED_BUY', blockedReason: c.skipReason ?? 'BLOCKED_BUY', sourceCandidateId: counterfactualSourceId(c, now), now: new Date(c.signalTime ?? now), hypotheticalTargetPrice: round(c.priceAtSignal! * (1 + LEARNING_DEFAULT_TARGET_RETURN_PCT / 100), 4), hypotheticalStopPrice: round(c.priceAtSignal! * (1 + LEARNING_DEFAULT_STOP_RETURN_PCT / 100), 4), maxHoldingMinutes: LEARNING_DEFAULT_MAX_HOLDING_MINUTES });
    if (result.duplicateSuppressed) duplicateSuppressedCount++;
  }
  const all = normalizeCounterfactuals();
  saveCounterfactuals(all);
  const counts = statusCounts(all);
  const builtUniqueCount = all.length;
  const totalDuplicateSuppressedCount = dry.duplicateSuppressedCount + duplicateSuppressedCount;
  const inv = counterfactualInvariant({ candidateCount: dry.candidateCount, eligibleCount: dry.eligibleCount, buildEventCount, builtUniqueCount, duplicateSuppressedCount: totalDuplicateSuppressedCount, ...counts });
  return { ...dry, buildEventCount, builtUniqueCount, duplicateSuppressedCount: totalDuplicateSuppressedCount, ...counts, countInvariantValid: inv.countInvariantValid, metricWarnings: inv.metricWarnings, metricInfos: inv.metricInfos, duplicateSuppressionStatus: inv.duplicateSuppressionStatus, blocker: buildEventCount === 0 ? dry.blocker : 'NONE', built: buildEventCount, pending: counts.pendingOutcomeCount, sampleSize: builtUniqueCount, status: inv.metricWarnings.includes('BUILT_UNIQUE_GT_CANDIDATE') || inv.metricWarnings.includes('COUNTERFACTUAL_COUNT_INVARIANT_BROKEN') ? 'ERROR' : inv.metricWarnings.length ? 'WARN' : 'OK', executionImpact: 'NONE' as const, brokerOrdersCreated: 0 as const, promotionAllowed: false as const };
}
export function collectCounterfactualStatus(now: Date = new Date()) {
  const dry = counterfactualBuildDryRun(now);
  const all = normalizeCounterfactuals();
  const counts = statusCounts(all);
  const builtUniqueCount = all.length;
  const buildEventCount = all.reduce((s, e) => s + 1 + (e.duplicateSuppressedCount ?? 0), 0);
  const duplicateSuppressedCount = all.reduce((s, e) => s + (e.duplicateSuppressedCount ?? 0), 0);
  const eligibleCount = Math.max(dry.eligibleCount, builtUniqueCount);
  const inv = counterfactualInvariant({ candidateCount: dry.candidateCount, eligibleCount, buildEventCount, builtUniqueCount, duplicateSuppressedCount, ...counts });
  return { ...dry, eligibleCount, buildEventCount, builtUniqueCount, duplicateSuppressedCount, ...counts, countInvariantValid: inv.countInvariantValid, metricWarnings: inv.metricWarnings, metricInfos: inv.metricInfos, duplicateSuppressionStatus: inv.duplicateSuppressionStatus, labelBreakdown: labelBreakdown([]), blocker: 'NONE', status: inv.metricWarnings.includes('BUILT_UNIQUE_GT_CANDIDATE') || inv.metricWarnings.includes('COUNTERFACTUAL_COUNT_INVARIANT_BROKEN') ? 'ERROR' : inv.metricWarnings.length ? 'WARN' : 'OK', executionImpact: 'NONE' as const, brokerOrdersCreated: 0 as const, promotionAllowed: false as const };
}

type CounterfactualTargetStopPlan = {
  target: number;
  stop: number;
  source: CounterfactualRecoverySource;
  confidence: CounterfactualRecoveryConfidence;
  ruleId: string;
  note: string;
};
function priceField(e: CounterfactualEntry, keys: string[]): number | undefined {
  const row = e as CounterfactualEntry & Record<string, unknown>;
  for (const key of keys) {
    const value = num(row[key]);
    if (value) return value;
  }
  return undefined;
}
function atrValue(e: CounterfactualEntry, entry: number): number | undefined {
  const raw = num(e.atr) ?? num((e as CounterfactualEntry & { volatility?: number; atrKrw?: number; volatilityKrw?: number }).atrKrw) ?? num((e as CounterfactualEntry & { volatilityKrw?: number }).volatilityKrw) ?? num(e.volatility);
  if (!raw) return undefined;
  return raw > 0 && raw < 1 ? round(entry * raw, 4) : raw;
}
function planFromPct(entry: number, side: 'BUY' | 'SELL', targetPct: number, stopPct: number) {
  return side === 'SELL'
    ? { target: round(entry * (1 - targetPct / 100), 4), stop: round(entry * (1 + Math.abs(stopPct) / 100), 4) }
    : { target: round(entry * (1 + targetPct / 100), 4), stop: round(entry * (1 + stopPct / 100), 4) };
}
function buildCounterfactualTargetStopPlan(e: CounterfactualEntry): CounterfactualTargetStopPlan | undefined {
  const entry = num(e.hypotheticalEntryPrice ?? e.priceAtSignal);
  if (!entry) return undefined;
  const side = e.hypotheticalSide ?? 'BUY';
  const existingTarget = num(e.hypotheticalTargetPrice);
  const existingStop = num(e.hypotheticalStopPrice);
  const originalTarget = priceField(e, ['originalTargetPrice', 'signalTargetPrice', 'targetPriceSnapshot', 'hypotheticalTargetPriceSnapshot', 'targetPrice', 'targetPriceVirtual']);
  const originalStop = priceField(e, ['originalStopPrice', 'signalStopPrice', 'stopPriceSnapshot', 'hypotheticalStopPriceSnapshot', 'stopPrice', 'stopPriceVirtual']);
  if ((originalTarget || existingTarget) && (originalStop || existingStop)) {
    return { target: originalTarget ?? existingTarget!, stop: originalStop ?? existingStop!, source: 'ORIGINAL_SIGNAL_SNAPSHOT', confidence: 'RECOVERED', ruleId: 'original-signal-target-stop-snapshot', note: 'Recovered from target/stop fields already present on the counterfactual source snapshot.' };
  }
  const strategyRuleId = e.riskRuleId ?? (e.strategyId && e.strategyId !== 'default' ? e.strategyId : undefined);
  if (strategyRuleId) {
    const prices = planFromPct(entry, side, LEARNING_DEFAULT_TARGET_RETURN_PCT, LEARNING_DEFAULT_STOP_RETURN_PCT);
    return { ...prices, source: 'STRATEGY_RISK_RULE', confidence: 'RECOVERED', ruleId: strategyRuleId, note: 'Recomputed from stored strategy/risk rule identity using learning default risk constants; diagnostic-only.' };
  }
  const atr = atrValue(e, entry);
  if (atr) {
    const target = side === 'SELL' ? entry - COUNTERFACTUAL_ATR_TARGET_MULTIPLE * atr : entry + COUNTERFACTUAL_ATR_TARGET_MULTIPLE * atr;
    const stop = side === 'SELL' ? entry + COUNTERFACTUAL_ATR_STOP_MULTIPLE * atr : entry - COUNTERFACTUAL_ATR_STOP_MULTIPLE * atr;
    return { target: round(target, 4), stop: round(stop, 4), source: 'ATR_FALLBACK', confidence: 'MEDIUM', ruleId: 'counterfactual-atr-fallback-v1', note: 'Recovered from ATR/volatility fallback; diagnostic-only and never VERIFIED.' };
  }
  const prices = planFromPct(entry, side, COUNTERFACTUAL_DEFAULT_TARGET_RETURN_PCT, COUNTERFACTUAL_DEFAULT_STOP_RETURN_PCT);
  return { ...prices, source: 'DEFAULT_R_MULTIPLE_FALLBACK', confidence: 'RECOVERED_LOW', ruleId: 'counterfactual-default-r-multiple-v1', note: 'Recovered from conservative default R-multiple fallback; diagnostic-only and excluded from promotion.' };
}
function recoveryBreakdowns(rows: CounterfactualEntry[]) {
  const recoverySourceBreakdown: Record<string, number> = {};
  const recoveryConfidenceBreakdown: Record<string, number> = {};
  for (const e of rows) {
    if (e.recoverySource) recoverySourceBreakdown[e.recoverySource] = (recoverySourceBreakdown[e.recoverySource] ?? 0) + 1;
    if (e.recoveryConfidence) recoveryConfidenceBreakdown[e.recoveryConfidence] = (recoveryConfidenceBreakdown[e.recoveryConfidence] ?? 0) + 1;
  }
  return { recoverySourceBreakdown, recoveryConfidenceBreakdown };
}
function mergeCounts(...records: Array<Record<string, number>>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const record of records) for (const [key, value] of Object.entries(record)) out[key] = (out[key] ?? 0) + value;
  return out;
}
export function counterfactualMetadataRepairDryRun(now: Date = new Date()) {
  const all = normalizeCounterfactuals();
  let missingTargetPrice = 0, missingStopPrice = 0, missingEntryPrice = 0, missingPricePath = 0, recoverableTargetStop = 0, unrecoverableTargetStop = 0;
  const plannedRows: CounterfactualEntry[] = [];
  for (const e of all) {
    const targetMissing = !num(e.hypotheticalTargetPrice);
    const stopMissing = !num(e.hypotheticalStopPrice);
    if (targetMissing) missingTargetPrice++;
    if (stopMissing) missingStopPrice++;
    if (!num(e.hypotheticalEntryPrice ?? e.priceAtSignal)) missingEntryPrice++;
    if (counterfactualPricePath(e).length === 0) missingPricePath++;
    if (!targetMissing && !stopMissing) continue;
    const plan = buildCounterfactualTargetStopPlan(e);
    if (plan) {
      recoverableTargetStop++;
      plannedRows.push({ ...e, recoverySource: plan.source, recoveryConfidence: plan.confidence });
    } else {
      unrecoverableTargetStop++;
    }
  }
  const existing = all.filter((e) => e.targetStopRecovered);
  const planned = recoveryBreakdowns(plannedRows);
  const existingBreakdowns = recoveryBreakdowns(existing);
  const expectedSourceConfidence = plannedRows.some((e) => e.recoveryConfidence === 'RECOVERED') ? 'RECOVERED' : plannedRows.some((e) => e.recoveryConfidence === 'MEDIUM') ? 'MEDIUM' : recoverableTargetStop > 0 ? 'RECOVERED_LOW' : 'N/A';
  const metadataRepairStatus = missingTargetPrice + missingStopPrice === 0 ? 'OK' : recoverableTargetStop > 0 ? 'READY_TO_REPAIR' : 'DATA_BLOCKED';
  return {
    metadataRepairStatus,
    scannedBuiltUnique: all.length,
    missingTargetPrice,
    missingStopPrice,
    recoverableTargetStop,
    unrecoverableTargetStop,
    missingEntryPrice,
    missingPricePath,
    targetStopRecoveredCount: existing.length,
    recoveryRuleAvailable: recoverableTargetStop > 0,
    defaultRiskRuleAvailable: true,
    atrRuleAvailable: plannedRows.some((e) => e.recoverySource === 'ATR_FALLBACK'),
    fallbackRMultipleRuleAvailable: true,
    expectedSourceConfidence,
    recoverySourceBreakdown: mergeCounts(existingBreakdowns.recoverySourceBreakdown, planned.recoverySourceBreakdown),
    recoveryConfidenceBreakdown: mergeCounts(existingBreakdowns.recoveryConfidenceBreakdown, planned.recoveryConfidenceBreakdown),
    executionImpact: 'NONE' as const,
    brokerOrdersCreated: 0 as const,
    promotionAllowed: false as const,
  };
}
export function counterfactualMetadataRepairRun(now: Date = new Date()) {
  const all = normalizeCounterfactuals();
  let targetRecovered = 0, stopRecovered = 0, bothRecovered = 0, unrecoverable = 0;
  for (const e of all) {
    const targetMissing = !num(e.hypotheticalTargetPrice);
    const stopMissing = !num(e.hypotheticalStopPrice);
    if (!targetMissing && !stopMissing) continue;
    const plan = buildCounterfactualTargetStopPlan(e);
    if (!plan) { unrecoverable++; continue; }
    if (targetMissing) { e.hypotheticalTargetPrice = plan.target; targetRecovered++; }
    if (stopMissing) { e.hypotheticalStopPrice = plan.stop; stopRecovered++; }
    if (num(e.hypotheticalTargetPrice) && num(e.hypotheticalStopPrice)) bothRecovered++;
    e.targetStopRecovered = true;
    e.recoverySource = plan.source;
    e.recoveryConfidence = plan.confidence;
    e.sourceConfidence = plan.confidence;
    e.recoveredAt = now.toISOString();
    e.recoveryRuleId = plan.ruleId;
    e.recoveryNote = plan.note;
    e.diagnosticOnly = true;
    e.promotionEligible = false;
    e.autoApply = false;
    if (e.outcomeStatus === 'QUARANTINED') {
      e.outcomeStatus = 'PENDING';
      delete e.outcomeLabel;
      delete e.outcomeResolvedAt;
    }
  }
  saveCounterfactuals(all);
  const repaired = all.filter((e) => e.targetStopRecovered);
  const breakdowns = recoveryBreakdowns(repaired);
  return {
    scannedBuiltUnique: all.length,
    targetRecovered,
    stopRecovered,
    bothRecovered,
    unrecoverable,
    targetStopRecoveredCount: repaired.length,
    recoverySourceBreakdown: breakdowns.recoverySourceBreakdown,
    recoveryConfidenceBreakdown: breakdowns.recoveryConfidenceBreakdown,
    executionImpact: 'NONE' as const,
    brokerOrdersCreated: 0 as const,
    promotionAllowed: false as const,
  };
}
export function counterfactualResolveDryRun(now: Date = new Date()) { return counterfactualResolve(now, false); }
export function counterfactualResolveRun(now: Date = new Date()) { return counterfactualResolve(now, true); }
function counterfactualCreatedAt(e: CounterfactualEntry): string | undefined {
  return e.signalTime ?? (e as CounterfactualEntry & { createdAt?: string }).createdAt ?? (e.signalDate ? `${e.signalDate}T00:00:00.000Z` : undefined);
}
function counterfactualPricePath(e: CounterfactualEntry): Array<{ at?: string; timestamp?: string; price?: number; high?: number; low?: number; close?: number }> {
  const raw = (e as CounterfactualEntry & { pricePath?: unknown; futurePricePath?: unknown; priceSnapshots?: unknown }).pricePath
    ?? (e as CounterfactualEntry & { futurePricePath?: unknown }).futurePricePath
    ?? (e as CounterfactualEntry & { priceSnapshots?: unknown }).priceSnapshots;
  return Array.isArray(raw) ? raw.filter((p): p is { at?: string; timestamp?: string; price?: number; high?: number; low?: number; close?: number } => typeof p === 'object' && p !== null) : [];
}
function pathTime(p: { at?: string; timestamp?: string }): number {
  const t = new Date(p.at ?? p.timestamp ?? '').getTime();
  return Number.isFinite(t) ? t : Number.MAX_SAFE_INTEGER;
}
function resolveCounterfactualHit(
  e: CounterfactualEntry,
  path: Array<{ at?: string; timestamp?: string; price?: number; high?: number; low?: number; close?: number }>,
  target: number,
  stop: number,
): CounterfactualLabel | undefined {
  const longSide = (e.hypotheticalSide ?? 'BUY') === 'BUY';
  for (const p of [...path].sort((a, b) => pathTime(a) - pathTime(b))) {
    const base = num(p.price) ?? num(p.close);
    const high = num(p.high) ?? base;
    const low = num(p.low) ?? base;
    if (!high || !low) continue;
    if (longSide) {
      if (high >= target) return 'MISSED_WIN';
      if (low <= stop) return 'AVOIDED_LOSS';
    } else {
      if (low <= target) return 'MISSED_WIN';
      if (high >= stop) return 'AVOIDED_LOSS';
    }
  }
  return undefined;
}
function counterfactualResolve(now: Date, write: boolean) {
  const all = normalizeCounterfactuals();
  let resolvableNow = 0, labeled = 0, waitingForHoldingPeriod = 0, dataInsufficient = 0, quarantined = 0;
  let missingEntryPrice = 0, missingTargetPrice = 0, missingStopPrice = 0, missingPricePath = 0, missingCreatedAt = 0;
  const labelBreakdown: Record<string, number> = { MISSED_WIN: 0, BAD_BLOCK: 0, AVOIDED_LOSS: 0, GOOD_BLOCK: 0, NEUTRAL_BLOCK: 0, DATA_INSUFFICIENT: 0, QUARANTINED: 0, PENDING_OUTCOME: 0 };
  const pendingRows = all.filter((e) => !['LABELED', 'DATA_INSUFFICIENT', 'QUARANTINED', 'EXPIRED', 'UNRESOLVED'].includes(String(e.outcomeStatus)));
  for (const e of all) {
    if (e.outcomeStatus === 'LABELED') continue;
    if (['DATA_INSUFFICIENT', 'QUARANTINED', 'EXPIRED', 'UNRESOLVED'].includes(String(e.outcomeStatus))) continue;
    const entry = num(e.hypotheticalEntryPrice ?? e.priceAtSignal);
    const target = num(e.hypotheticalTargetPrice);
    const stop = num(e.hypotheticalStopPrice);
    const createdAt = counterfactualCreatedAt(e);
    const createdMs = createdAt ? new Date(createdAt).getTime() : NaN;
    if (!entry) missingEntryPrice++;
    if (!target) missingTargetPrice++;
    if (!stop) missingStopPrice++;
    if (!Number.isFinite(createdMs)) missingCreatedAt++;
    if (!entry || !target || !stop) {
      quarantined++;
      labelBreakdown.QUARANTINED++;
      if (write) { e.outcomeStatus = 'QUARANTINED'; e.outcomeLabel = 'QUARANTINED'; e.outcomeResolvedAt = now.toISOString(); }
      continue;
    }
    if (!Number.isFinite(createdMs)) {
      dataInsufficient++;
      labelBreakdown.DATA_INSUFFICIENT++;
      if (write) { e.outcomeStatus = 'DATA_INSUFFICIENT'; e.outcomeLabel = 'DATA_INSUFFICIENT'; e.outcomeResolvedAt = now.toISOString(); }
      continue;
    }
    const elapsed = Math.floor((now.getTime() - createdMs) / 60000);
    const maxHold = e.maxHoldingMinutes ?? LEARNING_DEFAULT_MAX_HOLDING_MINUTES;
    if (elapsed < maxHold) {
      waitingForHoldingPeriod++;
      labelBreakdown.PENDING_OUTCOME++;
      if (write) e.outcomeStatus = 'PENDING';
      continue;
    }
    const path = counterfactualPricePath(e);
    if (path.length === 0) {
      missingPricePath++;
      dataInsufficient++;
      labelBreakdown.DATA_INSUFFICIENT++;
      if (write) { e.outcomeStatus = 'DATA_INSUFFICIENT'; e.outcomeLabel = 'DATA_INSUFFICIENT'; e.outcomeResolvedAt = now.toISOString(); }
      continue;
    }
    resolvableNow++;
    const label = resolveCounterfactualHit(e, path, target, stop) ?? 'NEUTRAL_BLOCK';
    labelBreakdown[label] = (labelBreakdown[label] ?? 0) + 1;
    labeled++;
    if (write) {
      e.outcomeLabel = label;
      e.outcomeStatus = 'LABELED';
      e.outcomeResolvedAt = now.toISOString();
      if (e.targetStopRecovered) {
        e.labelSource = 'RECOVERED_TARGET_STOP';
        e.diagnosticOnly = true;
        e.promotionEligible = false;
        e.autoApply = false;
      }
    }
  }
  if (write) saveCounterfactuals(all);
  const resolverStatus = labeled > 0 ? 'LABELED' : resolvableNow > 0 ? 'READY_TO_LABEL' : waitingForHoldingPeriod > 0 ? 'WAITING_FOR_HOLDING_PERIOD' : dataInsufficient > 0 || quarantined > 0 ? 'DATA_BLOCKED' : 'NO_PENDING_OUTCOME';
  return {
    scannedBuiltUnique: all.length,
    scannedBuilt: all.length,
    pendingOutcomeCount: pendingRows.length,
    resolvableNow,
    resolvable: resolvableNow,
    waitingForHoldingPeriod,
    missingEntryPrice,
    missingTargetPrice,
    missingStopPrice,
    missingPricePath,
    missingCreatedAt,
    dataInsufficient,
    quarantined,
    expectedLabelable: resolvableNow,
    expectedStillPending: waitingForHoldingPeriod,
    labeled,
    stillPending: waitingForHoldingPeriod,
    pending: waitingForHoldingPeriod,
    labelBreakdown,
    resolverStatus,
    executionImpact: 'NONE' as const,
    brokerOrdersCreated: 0 as const,
    promotionAllowed: false as const,
  };
}
export function formatCounterfactualBuild(s: ReturnType<typeof counterfactualBuildDryRun> | ReturnType<typeof counterfactualBuildRun> | ReturnType<typeof collectCounterfactualStatus>, title = 'counterfactual_build'): string { return [`🧪 ${title}`, `status=${s.status} candidateCount=${s.candidateCount} eligibleCount=${s.eligibleCount} buildEventCount=${s.buildEventCount}`, `builtUniqueCount=${s.builtUniqueCount} duplicateSuppressedCount=${s.duplicateSuppressedCount} duplicateSuppressionStatus=${s.duplicateSuppressionStatus}`, `labeledCount=${s.labeledCount} pendingOutcomeCount=${s.pendingOutcomeCount} dataInsufficientCount=${s.dataInsufficientCount} quarantinedCount=${s.quarantinedCount} expiredCount=${s.expiredCount} unresolvedCount=${s.unresolvedCount}`, `countInvariantValid=${s.countInvariantValid} metricWarnings=${JSON.stringify(s.metricWarnings)} metricInfos=${JSON.stringify(s.metricInfos)}`, `blocker=${s.blocker} executionImpact=${s.executionImpact} brokerOrdersCreated=${s.brokerOrdersCreated} promotionAllowed=${s.promotionAllowed}`].join('\n'); }
export function formatCounterfactualResolve(s: ReturnType<typeof counterfactualResolveDryRun>, title = 'counterfactual_resolve'): string { return [`🧪 ${title}`, `resolverStatus=${s.resolverStatus} scannedBuiltUnique=${s.scannedBuiltUnique} pendingOutcomeCount=${s.pendingOutcomeCount}`, `resolvableNow=${s.resolvableNow} waitingForHoldingPeriod=${s.waitingForHoldingPeriod} expectedLabelable=${s.expectedLabelable} expectedStillPending=${s.expectedStillPending}`, `missingEntryPrice=${s.missingEntryPrice} missingTargetPrice=${s.missingTargetPrice} missingStopPrice=${s.missingStopPrice} missingPricePath=${s.missingPricePath} missingCreatedAt=${s.missingCreatedAt}`, `labeled=${s.labeled} stillPending=${s.stillPending} dataInsufficient=${s.dataInsufficient} quarantined=${s.quarantined}`, `labelBreakdown=${JSON.stringify(s.labelBreakdown)}`, `executionImpact=${s.executionImpact} brokerOrdersCreated=${s.brokerOrdersCreated} promotionAllowed=${s.promotionAllowed}`].join('\n'); }
export function formatCounterfactualMetadataRepair(s: ReturnType<typeof counterfactualMetadataRepairDryRun> | ReturnType<typeof counterfactualMetadataRepairRun>, title = 'counterfactual_metadata_repair'): string {
  const common = [`🛠 ${title}`, `scannedBuiltUnique=${s.scannedBuiltUnique}`];
  if ('metadataRepairStatus' in s) common.push(`metadataRepairStatus=${s.metadataRepairStatus} missingTargetPrice=${s.missingTargetPrice} missingStopPrice=${s.missingStopPrice}`, `recoverableTargetStop=${s.recoverableTargetStop} unrecoverableTargetStop=${s.unrecoverableTargetStop} missingEntryPrice=${s.missingEntryPrice} missingPricePath=${s.missingPricePath}`, `recoveryRuleAvailable=${s.recoveryRuleAvailable} defaultRiskRuleAvailable=${s.defaultRiskRuleAvailable} atrRuleAvailable=${s.atrRuleAvailable} fallbackRMultipleRuleAvailable=${s.fallbackRMultipleRuleAvailable} expectedSourceConfidence=${s.expectedSourceConfidence}`);
  else common.push(`targetRecovered=${s.targetRecovered} stopRecovered=${s.stopRecovered} bothRecovered=${s.bothRecovered} unrecoverable=${s.unrecoverable} targetStopRecoveredCount=${s.targetStopRecoveredCount}`);
  common.push(`recoverySourceBreakdown=${JSON.stringify(s.recoverySourceBreakdown)}`, `recoveryConfidenceBreakdown=${JSON.stringify(s.recoveryConfidenceBreakdown)}`, `executionImpact=${s.executionImpact} brokerOrdersCreated=${s.brokerOrdersCreated} promotionAllowed=${s.promotionAllowed}`);
  return common.join('\n');
}

export function isHoldingOutlier(g: LearningGhostCase, now: Date = new Date()): boolean { return holdMinutes(g, now) >= (g.maxHoldingMinutes ?? LEARNING_DEFAULT_MAX_HOLDING_MINUTES) * 3; }
export function collectLearningHoldingOutliers(now: Date = new Date()) {
  const ghosts = loadGhostPortfolio() as LearningGhostCase[];
  const outliers = ghosts.filter(g => isHoldingOutlier(g, now));
  const fresh = ghosts.filter(g => inferLearningCohort(g) === 'FRESH_SHADOW');
  const backlog = ghosts.filter(g => ['BACKLOG_REPAIR', 'GHOST_REPAIR'].includes(inferLearningCohort(g)));
  return { total: ghosts.length, outlierCount: outliers.length, avgHoldingFresh: round(avg(fresh.map(g => holdMinutes(g, now))), 2), avgHoldingBacklog: round(avg(backlog.map(g => holdMinutes(g, now))), 2), maxHoldingMinutes: LEARNING_DEFAULT_MAX_HOLDING_MINUTES, excludedFromPromotion: outliers.filter(g => inferLearningCohort(g) === 'FRESH_SHADOW' || inferLearningCohort(g) === 'BACKLOG_REPAIR').length, examples: outliers.slice(0, 5).map(g => ({ id: g.id, stockCode: g.stockCode, holdingMinutes: holdMinutes(g, now), cohortType: inferLearningCohort(g), tag: 'OUTLIER_HOLDING_TIME' })), executionImpact: 'NONE' as const };
}

export function formatLearningCohortSummary(s: ReturnType<typeof collectLearningCohortSummary>): string { return [`🧱 learning_cohort_summary`, `totalSamples=${s.totalSamples} byCohort=${JSON.stringify(s.byCohort)}`, `byOutcomeLabel=${JSON.stringify(s.byOutcomeLabel)} outcomeLabelSampleCount=${s.outcomeLabelSampleCount}`, `openPendingCount=${s.openPendingCount} closedRepairCount=${s.closedRepairCount}`, `freshShadowCount=${s.freshShadowCount} backlogRepairCount=${s.backlogRepairCount} ghostRepairCount=${s.ghostRepairCount} recoveredMetadataCount=${s.recoveredMetadataCount} trueQuarantinedCount=${s.trueQuarantinedCount} counterfactualCount=${s.counterfactualCount}`, `expectancyByCohort=${JSON.stringify(s.expectancyByCohort)} winRateByCohort=${JSON.stringify(s.winRateByCohort)}`, `metricExclusionReasonByCohort=${JSON.stringify(s.metricExclusionReasonByCohort)}`, `avgHoldingMinutesByCohort=${JSON.stringify(s.avgHoldingMinutesByCohort)}`, `promotionEligibleSamples=${s.promotionEligibleSamples} promotionExcludedSamples=${s.promotionExcludedSamples}`, `exclusionReason=${s.exclusionReason}`, `executionImpact=${s.executionImpact}`].join('\n'); }
export function formatMetadataRepairDryRun(s: ReturnType<typeof learningMetadataRepairDryRun>): string { return [`🛠 learning_metadata_repair_dryrun`, `scanned=${s.scanned} missingEntryPrice=${s.missingEntryPrice} missingTargetStop=${s.missingTargetStop} missingPriceData=${s.missingPriceData}`, `recoverableEntry=${s.recoverableEntry} recoverableTargetStop=${s.recoverableTargetStop} unrecoverable=${s.unrecoverable}`, `proposedRecoverySource=${JSON.stringify(s.proposedRecoverySource)} expectedCohortAfterRepair=${s.expectedCohortAfterRepair}`, `executionImpact=${s.executionImpact}`].join('\n'); }
export function formatMetadataRepairRun(s: ReturnType<typeof learningMetadataRepairRun>): string { return [`🛠 learning_metadata_repair_run`, `scanned=${s.scanned} entryRecovered=${s.entryRecovered} targetStopRecovered=${s.targetStopRecovered} priceDataRecovered=${s.priceDataRecovered}`, `movedToRecoveredMetadata=${s.movedToRecoveredMetadata} stillQuarantined=${s.stillQuarantined} unrecoverable=${s.unrecoverable}`, `executionImpact=${s.executionImpact} brokerOrdersCreated=${s.brokerOrdersCreated} livePositionTouched=${s.livePositionTouched}`].join('\n'); }
export function formatLearningHoldingOutliers(s: ReturnType<typeof collectLearningHoldingOutliers>): string { return [`⏱ learning_holding_outliers`, `total=${s.total} outlierCount=${s.outlierCount} maxHoldingMinutes=${s.maxHoldingMinutes}`, `avgHoldingFresh=${s.avgHoldingFresh} avgHoldingBacklog=${s.avgHoldingBacklog}`, `excludedFromPromotion=${s.excludedFromPromotion} examples=${JSON.stringify(s.examples)}`, `executionImpact=${s.executionImpact}`].join('\n'); }

