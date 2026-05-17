// @responsibility /learning_pulse — LearningPulseDiagnostics v2 + legacy 7영역 snapshot compatibility
import fs from 'fs';
import { collectLearningPulseV2 } from '../../../learning/learningPulseDiagnostics.js';
import { collectCounterfactualMaturityStatus, collectCounterfactualStatus, collectLearningCohortConsistencyStatus, collectLearningCohortSummary, counterfactualMetadataRepairDryRun, counterfactualResolveDryRun } from '../../../learning/learningSampleQuality.js';
import { collectFreshOnlyPromotion, collectFreshShadowInletStatus, collectFreshShadowStatus } from '../../../shadow/freshShadowLifecycle.js';
import { shadowCaseLedger } from '../../../shadow/shadowCaseLedger.js';
import { ensureGeminiLearningScheduleFresh } from '../../../learning/geminiUtilizationScheduler.js';
import { collectLearningPulseV3, formatLearningPulseV3 } from '../../../learning/learningOutcomeQuality.js';
import { loadSuggestDiagnosticProposals } from '../../../learning/suggestThresholdCalibrator.js';
import { LEARNING_ATTRIBUTION_TARGET_7D, LEARNING_GEMINI_UTILIZATION_TARGET, LEARNING_SUGGEST_CHANNELS, LEARNING_TRADING_DAYS_PER_MONTH } from '../../../learning/learningConstants.js';
import { loadGhostPortfolio, loadExperimentProposals, loadReflectionBudget } from '../../../persistence/reflectionRepo.js';
import { loadCurrentSchemaRecords } from '../../../persistence/attributionRepo.js';
import { loadConditionWeights } from '../../../persistence/conditionWeightsRepo.js';
import { F2W_AUDIT_FILE, REFLECTION_BUDGET_FILE } from '../../../persistence/paths.js';
import { getRecentAlertHistory } from '../../../persistence/alertHistoryRepo.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';
import { formatEngineRuntimePolicy, resolveEngineRuntimePolicy } from '../../../runtime/engineRuntimePolicy.js';
import { collectRegimeLearningBank, collectRegimeLearningConsistency } from '../../../learning/regimeLearningBank.js';
export const PULSE_THRESHOLDS = { GHOST_OPEN_BLOCKER_MIN: 100, GHOST_CLOSE_RATIO_THRESHOLD: 0.1, ATTRIBUTION_TARGET_7D: LEARNING_ATTRIBUTION_TARGET_7D, SUGGEST_SILENCE_THRESHOLD: 1, GEMINI_USE_RATIO_TARGET: LEARNING_GEMINI_UTILIZATION_TARGET, GEMINI_BUSINESS_DAYS_PER_MONTH: LEARNING_TRADING_DAYS_PER_MONTH } as const;
export const SUGGEST_MODULES = LEARNING_SUGGEST_CHANNELS;
type SuggestModule = typeof SUGGEST_MODULES[number];
export function computeGeminiUseRatio(callCount: number): number { return Number.isFinite(callCount) && callCount > 0 ? Math.max(0, Math.min(1, callCount / LEARNING_TRADING_DAYS_PER_MONTH)) : 0; }
function readF2W(errors: string[]) { try { if (!fs.existsSync(F2W_AUDIT_FILE)) return null; const log = JSON.parse(fs.readFileSync(F2W_AUDIT_FILE, 'utf-8')) as any[]; return Array.isArray(log) ? log.at(-1) : null; } catch (e) { errors.push(`f2w:${e instanceof Error ? e.message : String(e)}`); return null; } }
function readBudgetFor(now: Date) { try { if (fs.existsSync(REFLECTION_BUDGET_FILE)) { const b = JSON.parse(fs.readFileSync(REFLECTION_BUDGET_FILE, 'utf-8')) as any; if (b?.month === now.toISOString().slice(0,7)) return b; } } catch { /* fallback below */ } return loadReflectionBudget(); }
function recent(iso: string | undefined, days: number, now: Date) { const t = iso ? new Date(iso).getTime() : NaN; return Number.isFinite(t) && t >= now.getTime() - days * 86400000; }
const activeStates = new Set(['PROPOSED','AUTO_STARTED','AWAIT_APPROVAL','RUNNING']);
function counterfactualMetadataMissingCount(repair: ReturnType<typeof counterfactualMetadataRepairDryRun>): number {
  return Math.max(repair.missingTargetPrice, repair.missingStopPrice);
}
function splitCounterfactualSuggestBlockers(input: {
  builtButUnlabeled: number;
  labeledInputSamples: number;
  pendingOutcomeCount: number;
  metadataMissingCount: number;
  maturedNowCount: number;
  resolverDataBlocked: boolean;
  legacyBlocker: string;
}) {
  const secondaryBlockers: string[] = [];
  if (input.metadataMissingCount > 0) secondaryBlockers.push(`COUNTERFACTUAL_METADATA_MISSING_${input.metadataMissingCount}`);
  const metadataMostlyMissing = input.builtButUnlabeled > 0 && input.metadataMissingCount / input.builtButUnlabeled >= 0.5;
  let primaryBlocker = 'NONE';
  if (input.metadataMissingCount > 0 && metadataMostlyMissing) primaryBlocker = 'COUNTERFACTUAL_METADATA_MISSING';
  else if (input.pendingOutcomeCount > 0 && input.labeledInputSamples === 0 && input.maturedNowCount === 0) primaryBlocker = 'WAITING_FOR_COUNTERFACTUAL_MATURITY';
  else if (input.maturedNowCount > 0 && input.labeledInputSamples === 0) primaryBlocker = input.resolverDataBlocked ? 'DATA_BLOCKED' : 'COUNTERFACTUAL_RESOLVE_NOT_RUN';
  else if (input.labeledInputSamples === 0) primaryBlocker = 'NO_LABELED_COUNTERFACTUAL_INPUT';
  else if (input.legacyBlocker !== 'NONE') primaryBlocker = 'BELOW_STRATEGY_THRESHOLD';
  return { primaryBlocker, secondaryBlockers };
}
export function collectLearningPulse(now: Date = new Date()) {
  const errors: string[] = [];
  const v2 = collectLearningPulseV2(now);
  const ghosts = loadGhostPortfolio() as any[];
  const open = ghosts.filter(g => !g.closed).length;
  const closedRecent7d = ghosts.filter(g => g.closed && recent(g.closedAt ?? g.lastUpdatedAt, 7, now)).length;
  const closeRatio = (closedRecent7d + open) > 0 ? closedRecent7d / (closedRecent7d + open) : 0;
  const attr = loadCurrentSchemaRecords();
  const attribution7dCount = attr.filter(r => recent(r.closedAt, 7, now)).length;
  const weightsRaw = loadConditionWeights();
  const vals = Object.values(weightsRaw ?? {}).filter((v): v is number => typeof v === 'number');
  const changedFromDefault = vals.filter(v => v !== 1).length;
  const sunsetCount = vals.filter(v => v <= 0.1).length;
  const untouched = vals.filter(v => v === 1).length;
  const f2wTail = readF2W(errors);
  const recentAlerts = getRecentAlertHistory(500);
  const suggest7d: Record<SuggestModule, number> = { counterfactual: 0, ledger: 0, kellySurface: 0, regime: 0 };
  for (const a of recentAlerts as any[]) {
    if (!recent(a.at, 7, now) || !a.success || !String(a.message).includes('학습 모듈 Suggest')) continue;
    for (const m of SUGGEST_MODULES) if (String(a.message).includes(`Suggest — ${m}`)) { suggest7d[m]++; break; }
  }
  const proposals = loadExperimentProposals();
  const diagnosticProposals7d = loadSuggestDiagnosticProposals().filter(p => recent(p.createdAt, 7, now)).length;
  const experimentsActive = proposals.filter(p => activeStates.has(p.state)).length;
  const budget = readBudgetFor(now);
  const useRatio = computeGeminiUseRatio(budget.callCount);
  const flags: string[] = [];
  if (open >= PULSE_THRESHOLDS.GHOST_OPEN_BLOCKER_MIN && closeRatio < PULSE_THRESHOLDS.GHOST_CLOSE_RATIO_THRESHOLD) flags.push(`ghost_close_blocker (${open}건 적체)`);
  if (attribution7dCount < PULSE_THRESHOLDS.ATTRIBUTION_TARGET_7D) flags.push(`sample_starvation (attribution ${attribution7dCount}/${PULSE_THRESHOLDS.ATTRIBUTION_TARGET_7D}/7d)`);
  if (Object.values(suggest7d).reduce((a,b)=>a+b,0) + diagnosticProposals7d < PULSE_THRESHOLDS.SUGGEST_SILENCE_THRESHOLD) flags.push('suggest_silence (4 채널 모두 7일 0건)');
  if (useRatio < PULSE_THRESHOLDS.GEMINI_USE_RATIO_TARGET) flags.push(`gemini_underuse (호출률 ${(useRatio * 100).toFixed(0)}% < 80%)`);
  const freshShadow = collectFreshShadowStatus(shadowCaseLedger, now);
  const freshShadowInlet = collectFreshShadowInletStatus(shadowCaseLedger, now);
  const freshPromotion = collectFreshOnlyPromotion(shadowCaseLedger);
  const counterfactual = collectCounterfactualStatus(now);
  const counterfactualMetadataRepair = counterfactualMetadataRepairDryRun(now);
  const counterfactualMaturity = collectCounterfactualMaturityStatus(now);
  const counterfactualResolver = counterfactualResolveDryRun(now);
  const cohorts = collectLearningCohortSummary(now);
  const cohortConsistency = collectLearningCohortConsistencyStatus(now);
  const geminiScheduler = ensureGeminiLearningScheduleFresh(now);
  const regimeLearning = collectRegimeLearningBank();
  const regimeLearningConsistency = collectRegimeLearningConsistency(regimeLearning);
  const counterfactualBuiltButUnlabeled = counterfactual.pendingOutcomeCount + counterfactual.dataInsufficientCount + counterfactual.quarantinedCount + counterfactual.expiredCount + counterfactual.unresolvedCount;
  const counterfactualLabeledInputSamples = counterfactual.labeledCount;
  const suggestInputSamples = counterfactualLabeledInputSamples;
  const counterfactualMetadataMissing = counterfactualMetadataMissingCount(counterfactualMetadataRepair);
  const counterfactualWaitingForMaturity = counterfactualMaturity.waitingCount;
  const blockerSplit = splitCounterfactualSuggestBlockers({
    builtButUnlabeled: counterfactualBuiltButUnlabeled,
    labeledInputSamples: counterfactualLabeledInputSamples,
    pendingOutcomeCount: counterfactual.pendingOutcomeCount,
    metadataMissingCount: counterfactualMetadataMissing,
    maturedNowCount: counterfactualMaturity.maturedNowCount,
    resolverDataBlocked: counterfactualResolver.dataInsufficient > 0 || counterfactualResolver.quarantined > 0,
    legacyBlocker: v2.suggest.blocker,
  });
  const suggest = { ...v2.suggest, counterfactualBuiltButUnlabeled, counterfactualLabeledInputSamples, counterfactualWaitingForMaturity, counterfactualMetadataMissing, suggestInputSamples, primaryBlocker: blockerSplit.primaryBlocker, secondaryBlockers: blockerSplit.secondaryBlockers, blocker: blockerSplit.primaryBlocker, status: 'DIAGNOSTIC_ONLY', autoApply: false };
  const consistencyCheck = { ...(v2 as any).consistencyCheck, counterfactualCountInvariantValid: counterfactual.countInvariantValid, counterfactualUniqueNotGreaterThanCandidate: counterfactual.builtUniqueCount <= counterfactual.candidateCount, freshMetricNAWhenNoSample: freshPromotion.freshSampleSize > 0 || freshPromotion.freshExpectancyR === 'N/A', counterfactualLabelingConnected: counterfactual.labeledCount > 0 || counterfactual.pendingOutcomeCount + counterfactual.dataInsufficientCount + counterfactual.quarantinedCount > 0, counterfactualDuplicateGuardActive: counterfactual.duplicateSuppressionStatus === 'OK', cohortSumMatchesTotal: cohortConsistency.cohortSumMatchesTotal, ghostRepairReflectedInPulse: cohortConsistency.ghostRepairReflectedInPulse, regimeSumMatchesTotal: regimeLearningConsistency.regimeSumMatchesTotal };
  const metricWarnings = [...(counterfactual.metricWarnings ?? []), ...cohortConsistency.metricWarnings, ...regimeLearningConsistency.metricWarnings];
  const metricInfos = [...(counterfactual.metricInfos ?? []), ...cohortConsistency.metricInfos];
  if (!consistencyCheck.counterfactualLabelingConnected) metricWarnings.push('COUNTERFACTUAL_LABELING_DISCONNECTED');
  if (!consistencyCheck.freshMetricNAWhenNoSample) metricWarnings.push('FRESH_EXPECTANCY_ZERO_SAMPLE_SHOWN_AS_ZERO');
  if (!consistencyCheck.counterfactualDuplicateGuardActive) metricWarnings.push('COUNTERFACTUAL_DUPLICATE_GUARD_MISSING');
  return { ...v2, suggest, consistencyCheck, metricWarnings, metricInfos, v3: collectLearningPulseV3(now), freshShadow, freshShadowInlet, freshPromotion, counterfactual, counterfactualMetadataRepair, counterfactualMaturity, counterfactualResolver, regimeLearning, regimeLearningConsistency, cohorts, cohortConsistency, cohortSnapshotStatus: cohortConsistency.snapshotStatus, counterfactualBuiltButUnlabeled, counterfactualLabeledInputSamples, counterfactualWaitingForMaturity, counterfactualMetadataMissing, suggestInputSamples, todayKst: new Date(now.getTime() + 9 * 3600000).toISOString().slice(0,10), ghost: { ...v2.ghost, closedRecent7d, closeRatio }, attribution7d: { count: attribution7dCount, target: LEARNING_ATTRIBUTION_TARGET_7D }, weights: { changedFromDefault, sunsetCount, untouched, lastF2WRanAt: f2wTail?.ranAt, lastF2WSkipCount: f2wTail ? f2wTail.adjustments.filter((a: any) => a.action === 'NONE').length : 0, lastF2WTotalRecords: f2wTail?.totalRecords ?? 0 }, suggest7d, diagnosticProposals7d, experimentsActive, gemini: { ...v2.gemini, month: budget.month, callCount: budget.callCount, tokensUsed: budget.tokensUsed, useRatio, schedulerStatus: geminiScheduler.schedulerStatus, lastScheduledAt: geminiScheduler.lastScheduledAt, lastRunAt: geminiScheduler.lastRunAt, nextScheduledAt: geminiScheduler.nextScheduledAt, missedCount: geminiScheduler.missedCount, recommendationOnly: geminiScheduler.recommendationOnly }, geminiScheduler, flags, partialFailure: errors.length > 0 };
}
function formatLearningPulseMessageBase(s: ReturnType<typeof collectLearningPulse>): string {
  const suggestSignals7d = Object.values(s.suggest7d).reduce((a,b)=>a+b,0);
  const totalSuggest = Math.max(suggestSignals7d + s.diagnosticProposals7d, s.suggest.total7d);
  return [formatLearningPulseV3(s.v3), `🩺 Learning Pulse v5 (${s.todayKst})`, `🌱 Fresh Shadow: todayFreshCandidates ${s.freshShadow.todayFreshCandidates} / freshOpen ${s.freshShadow.freshShadowOpen} / freshClosed7d ${s.freshShadow.freshShadowClosed7d} / freshSampleSize ${s.freshPromotion.freshSampleSize} / freshExpectancyR ${typeof s.freshPromotion.freshExpectancyR === 'number' ? s.freshPromotion.freshExpectancyR.toFixed(4) : 'N/A'} / reason ${s.freshPromotion.freshExpectancyReason ?? 'OK'} / freshLifecycleBreaks ${s.freshShadow.lifecycleBreaks} / blocker ${s.freshPromotion.blocker}`, `🧪 Counterfactual: candidateCount ${s.counterfactual.candidateCount} / eligibleCount ${s.counterfactual.eligibleCount} / buildEventCount ${s.counterfactual.buildEventCount} / builtUniqueCount ${s.counterfactual.builtUniqueCount} / duplicateSuppressedCount ${s.counterfactual.duplicateSuppressedCount} / labeledCount ${s.counterfactual.labeledCount} / pendingOutcomeCount ${s.counterfactual.pendingOutcomeCount} / dataInsufficientCount ${s.counterfactual.dataInsufficientCount} / quarantinedCount ${s.counterfactual.quarantinedCount} / expiredCount ${s.counterfactual.expiredCount} / unresolvedCount ${s.counterfactual.unresolvedCount} / countInvariantValid ${s.counterfactual.countInvariantValid} / blocker ${s.counterfactual.blocker}`, `🚦 Promotion: basis=${s.freshPromotion.basis} / freshSampleSize=${s.freshPromotion.freshSampleSize} / requiredFreshSamples=${s.freshPromotion.requiredFreshSamples} / promotionAllowed=${s.freshPromotion.promotionAllowed} / blockers=${s.freshPromotion.blockers.join(', ') || s.freshPromotion.blocker}`, `👻 Ghost Repair: ghostRepairCount=${s.cohorts.ghostRepairCount} / ghostRepairExpectancyR=${String(s.cohorts.expectancyByCohort.GHOST_REPAIR ?? 'N/A')} / diagnosticOnly=true`, `👻 Ghost Portfolio: OPEN ${s.ghost.open} / 7일 close ${s.ghost.closedRecent7d} / closeRate7d ${(s.ghost.closeRate7d*100).toFixed(1)}% / lastGhostCloseRunCloseRate ${typeof s.v3.rateMetrics.lastGhostCloseRunCloseRate === 'number' ? `${(s.v3.rateMetrics.lastGhostCloseRunCloseRate*100).toFixed(1)}%` : 'N/A'} / lastLearningRepairRunCloseRate ${typeof s.v3.rateMetrics.lastLearningRepairRunCloseRate === 'number' ? `${(s.v3.rateMetrics.lastLearningRepairRunCloseRate*100).toFixed(1)}%` : 'N/A'} / closeRateFormula=${s.v3.rateMetrics.closeRateFormula} / staleOpenCount ${s.ghost.staleOpenCount}`, `📊 Attribution: ${s.attribution7d.count}/${s.attribution7d.target} (7d) / starvationReason ${s.attribution.starvationReason}${s.attribution.previousStarvationReason ? ` / previousStarvationReason ${s.attribution.previousStarvationReason}` : ''}`, `⚖️ Condition Weights: changed ${s.weights.changedFromDefault} / untouched ${s.weights.untouched} / sunset ${s.weights.sunsetCount}`, `🔔 Suggest Metrics: suggestSignals7d ${suggestSignals7d} / diagnosticProposals7d ${s.diagnosticProposals7d} / counterfactualBuiltButUnlabeled ${s.counterfactualBuiltButUnlabeled} / counterfactualLabeledInputSamples ${s.counterfactualLabeledInputSamples} / suggestInputSamples ${s.suggestInputSamples} / autoApplied7d 0 / totalDiagnosticEvents7d ${s.diagnosticProposals7d} / blocker ${s.suggest.blocker} / status DIAGNOSTIC_ONLY / legacyTotal7d ${totalSuggest}`, `🧪 Experiment Proposal: active ${s.experimentsActive}`, `🤖 Gemini: 호출 ${s.gemini.callCount}회 / ~${LEARNING_TRADING_DAYS_PER_MONTH}영업일 → 호출률 ${(s.gemini.useRatio*100).toFixed(0)}% / nextScheduledAt ${s.gemini.nextScheduledAt ?? 'N/A'} / recommendationOnly=true`, `✅ Consistency Check: counterfactualCountInvariantValid=${s.consistencyCheck.counterfactualCountInvariantValid} / counterfactualUniqueNotGreaterThanCandidate=${s.consistencyCheck.counterfactualUniqueNotGreaterThanCandidate} / freshMetricNAWhenNoSample=${s.consistencyCheck.freshMetricNAWhenNoSample} / counterfactualLabelingConnected=${s.consistencyCheck.counterfactualLabelingConnected} / counterfactualDuplicateGuardActive=${s.consistencyCheck.counterfactualDuplicateGuardActive}`, s.metricWarnings.length ? `⚠️ metricWarnings=${JSON.stringify(s.metricWarnings)}` : '', s.flags.length ? `🚩 진단 플래그: ${s.flags.join(', ')}` : '✅ 모든 채널 정상', s.partialFailure ? '⚠️ 데이터 일부 미확인 — 손상/누락 저장소가 있어 가능한 영역만 표시' : ''].filter(Boolean).join('\n');
}
export function formatLearningPulseMessage(s: ReturnType<typeof collectLearningPulse>): string {
  const runtimePolicy = resolveEngineRuntimePolicy({
    engineMode: 'OBSERVE_ONLY',
    liveBuyGateAllowed: false,
    reasonCodes: ['LEARNING_PULSE_DIAGNOSTIC'],
  });
  const extra = [
    formatEngineRuntimePolicy(runtimePolicy),
    `Fresh Shadow Inlet: blocker=${s.freshShadowInlet.blocker} / nextAction=${s.freshShadowInlet.nextAction} / scanCandidatesToday=${s.freshShadowInlet.scanCandidatesToday} / shadowSignalsToday=${s.freshShadowInlet.shadowSignalsToday} / shadowApprovedToday=${s.freshShadowInlet.shadowApprovedToday} / shadowOrdersCreatedToday=${s.freshShadowInlet.shadowOrdersCreatedToday} / paperFilledToday=${s.freshShadowInlet.paperFilledToday} / executionImpact=${s.freshShadowInlet.executionImpact}`,
    `Regime Learning v6: activeRegime=${s.regimeLearning.activeRegime} / rawRegime=${s.regimeLearning.rawRegime} / effectiveRegime=${s.regimeLearning.effectiveRegime} / shadowLearningAllowed=${s.regimeLearning.shadowLearningAllowed} / regimeLearningSampleSize=${s.regimeLearning.regimeLearningSampleSize} / regimeAssignedCount=${s.regimeLearning.regimeAssignedCount} / unknownRegimeCount=${s.regimeLearning.unknownRegimeCount} / unknownRatio=${s.regimeLearning.unknownRatio} / bestRegimeByExpectancy=${s.regimeLearning.bestRegimeByExpectancy ?? 'N/A'} / worstRegimeByExpectancy=${s.regimeLearning.worstRegimeByExpectancy ?? 'N/A'} / activeRegimeSampleSize=${s.regimeLearning.activeRegimeSampleSize} / activeRegimeExpectancyR=${s.regimeLearning.activeRegimeExpectancyR} / activeRegimeQualityStatus=${s.regimeLearning.activeRegimeQualityStatus} / activeRegimeTopPattern=${s.regimeLearning.activeRegimeTopPattern} / activeRegimeLearningNeed=${s.regimeLearning.activeRegimeLearningNeed} / R1QualityStatus=${s.regimeLearning.R1QualityStatus} / R2QualityStatus=${s.regimeLearning.R2QualityStatus} / R3QualityStatus=${s.regimeLearning.R3QualityStatus} / R4QualityStatus=${s.regimeLearning.R4QualityStatus} / R5QualityStatus=${s.regimeLearning.R5QualityStatus} / R6QualityStatus=${s.regimeLearning.R6QualityStatus} / unknownReductionNeeded=${s.regimeLearning.unknownReductionNeeded} / regimeBankConsistency=${s.regimeLearning.regimeBankConsistency} / recommendationOnly=${s.regimeLearning.recommendationOnly} / promotionAllowed=${s.regimeLearning.promotionAllowed}`,
    `Counterfactual Metadata Repair: metadataRepairStatus=${s.counterfactualMetadataRepair.metadataRepairStatus} / missingTargetPrice=${s.counterfactualMetadataRepair.missingTargetPrice} / missingStopPrice=${s.counterfactualMetadataRepair.missingStopPrice} / totalTargetStopRecovered=${s.counterfactualMetadataRepair.totalTargetStopRecovered} / targetStopRecoveredCount=${s.counterfactualMetadataRepair.targetStopRecoveredCount} / cumulativeRecovered=${s.counterfactualMetadataRepair.cumulativeRecovered} / lastRunScannedMissing=${s.counterfactualMetadataRepair.lastRunScannedMissing} / lastRunRecovered=${s.counterfactualMetadataRepair.lastRunRecovered} / missingAfterRun=${s.counterfactualMetadataRepair.missingAfterRun} / incrementalRepairStatus=${s.counterfactualMetadataRepair.incrementalRepairStatus} / recoverySourceBreakdown=${JSON.stringify(s.counterfactualMetadataRepair.recoverySourceBreakdown)} / recoveryConfidenceBreakdown=${JSON.stringify(s.counterfactualMetadataRepair.recoveryConfidenceBreakdown)}`,
    `Suggest Blockers: counterfactualBuiltButUnlabeled=${s.counterfactualBuiltButUnlabeled} / counterfactualLabeledInputSamples=${s.counterfactualLabeledInputSamples} / counterfactualWaitingForMaturity=${s.counterfactualWaitingForMaturity} / counterfactualMetadataMissing=${s.counterfactualMetadataMissing} / suggestInputSamples=${s.suggestInputSamples} / primaryBlocker=${s.suggest.primaryBlocker} / secondaryBlockers=${JSON.stringify(s.suggest.secondaryBlockers)} / status=${s.suggest.status}`,
    `Counterfactual Maturity: maturityStatus=${s.counterfactualMaturity.maturityStatus} / maturedNowCount=${s.counterfactualMaturity.maturedNowCount} / waitingForHoldingPeriod=${s.counterfactualMaturity.waitingCount} / overdueCount=${s.counterfactualMaturity.overdueCount} / nearestMaturityBucket=${s.counterfactualMaturity.nearestMaturityBucket} / nearestMaturityAt=${s.counterfactualMaturity.nearestMaturityAt ?? 'N/A'} / remainingCalendarDays=${s.counterfactualMaturity.remainingCalendarDaysToNearestMaturity ?? 'N/A'} / remainingTradingDays=${s.counterfactualMaturity.remainingTradingDaysToNearestMaturity ?? 'N/A'} / largestMaturityBucket=${s.counterfactualMaturity.largestMaturityBucket} / largestMaturityBucketCount=${s.counterfactualMaturity.largestMaturityBucketCount} / nextResolveAt=${s.counterfactualMaturity.nextResolveAt ?? 'N/A'} / bucketSumMatchesPending=${s.counterfactualMaturity.bucketSumMatchesPending} / resolverSchedulerStatus=${s.counterfactualMaturity.schedulerStatus}`,
    `Counterfactual Resolver: resolverStatus=${s.counterfactualResolver.resolverStatus} / scannedBuiltUnique=${s.counterfactualResolver.scannedBuiltUnique} / pendingOutcomeCount=${s.counterfactualResolver.pendingOutcomeCount} / resolvableNow=${s.counterfactualResolver.resolvableNow} / expectedLabelable=${s.counterfactualResolver.expectedLabelable} / expectedStillPending=${s.counterfactualResolver.expectedStillPending} / labelBreakdown=${JSON.stringify(s.counterfactualResolver.labelBreakdown)} / executionImpact=${s.counterfactualResolver.executionImpact}`,
    `Counterfactual Metrics: duplicateSuppressionStatus=${s.counterfactual.duplicateSuppressionStatus} / metricInfos=${JSON.stringify(s.metricInfos)} / metricWarnings=${JSON.stringify(s.metricWarnings)}`,
    `Cohort Snapshot: snapshotStatus=${s.cohortSnapshotStatus} / cohortSumMatchesTotal=${s.cohortConsistency.cohortSumMatchesTotal} / ghostRepairReflectedInPulse=${s.cohortConsistency.ghostRepairReflectedInPulse}`,
    `Gemini Scheduler: schedulerStatus=${s.geminiScheduler.schedulerStatus} / lastScheduledAt=${s.geminiScheduler.lastScheduledAt ?? 'N/A'} / lastRunAt=${s.geminiScheduler.lastRunAt ?? 'N/A'} / nextScheduledAt=${s.geminiScheduler.nextScheduledAt ?? 'N/A'} / missedCount=${s.geminiScheduler.missedCount} / recommendationOnly=${s.geminiScheduler.recommendationOnly}`,
  ].join('\n');
  return `${formatLearningPulseMessageBase(s)}\n${extra}`;
}
const learningPulse: TelegramCommand = { name: '/learning_pulse', aliases: ['/lp'], category: 'LRN', visibility: 'ADMIN', riskLevel: 0, description: '학습 루프 v5 진단 (fresh/counterfactual/fresh-only promotion)', async execute({ reply }) { try { await reply(formatLearningPulseMessage(collectLearningPulse())); } catch (e) { await reply(`⚠️ /learning_pulse 실패: ${e instanceof Error ? e.message : String(e)}`); } } };
commandRegistry.register(learningPulse);
export default learningPulse;
