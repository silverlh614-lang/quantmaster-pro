// @responsibility /learning_pulse — LearningPulseDiagnostics v2 + legacy 7영역 snapshot compatibility
import fs from 'fs';
import { collectLearningPulseV2 } from '../../../learning/learningPulseDiagnostics.js';
import { collectCounterfactualMaturityStatus, collectCounterfactualStatus, collectLearningCohortConsistencyStatus, collectLearningCohortSummary, counterfactualMetadataRepairDryRun, counterfactualMetadataRepairRun, counterfactualResolveDryRun, learningCohortBackfillRun } from '../../../learning/learningSampleQuality.js';
import { collectFreshOnlyPromotion, collectFreshShadowInletStatus, collectFreshShadowStatus } from '../../../shadow/freshShadowLifecycle.js';
import { shadowCaseLedger } from '../../../shadow/shadowCaseLedger.js';
import { ensureGeminiLearningScheduleFresh } from '../../../learning/geminiUtilizationScheduler.js';
import { collectLearningPulseV3 } from '../../../learning/learningOutcomeQuality.js';
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
import { appendLearningPulseArchive, collectLearningPulseArchiveStatus, loadReflectionInjectionBusState, type LearningPulseArchiveStatus } from '../../../learning/reflectionInjectionBusState.js';
import { buildGate3LearningFinalization, formatGate3LearningFinalizationSection, normalizeGate3LearningDisplay } from '../../../quant/gate3CompletionScore.js';
import { formatGate3EvidenceWarmupSection } from '../../../quant/gate3EvidenceWarmup.js';
import { getLastGate3FinalizationSummary, getLastValidGate3Snapshot } from '../../../quant/gate3FinalizationState.js';
export const PULSE_THRESHOLDS = { GHOST_OPEN_BLOCKER_MIN: 100, GHOST_CLOSE_RATIO_THRESHOLD: 0.1, ATTRIBUTION_TARGET_7D: LEARNING_ATTRIBUTION_TARGET_7D, SUGGEST_SILENCE_THRESHOLD: 1, GEMINI_USE_RATIO_TARGET: LEARNING_GEMINI_UTILIZATION_TARGET, GEMINI_BUSINESS_DAYS_PER_MONTH: LEARNING_TRADING_DAYS_PER_MONTH } as const;
export const SUGGEST_MODULES = LEARNING_SUGGEST_CHANNELS;
type SuggestModule = typeof SUGGEST_MODULES[number];
export function computeGeminiUseRatio(callCount: number): number { return Number.isFinite(callCount) && callCount > 0 ? Math.max(0, Math.min(1, callCount / LEARNING_TRADING_DAYS_PER_MONTH)) : 0; }
function readF2W(errors: string[]) { try { if (!fs.existsSync(F2W_AUDIT_FILE)) return null; const log = JSON.parse(fs.readFileSync(F2W_AUDIT_FILE, 'utf-8')) as any[]; return Array.isArray(log) ? log.at(-1) : null; } catch (e) { errors.push(`f2w:${e instanceof Error ? e.message : String(e)}`); return null; } }
function readBudgetFor(now: Date) { try { if (fs.existsSync(REFLECTION_BUDGET_FILE)) { const b = JSON.parse(fs.readFileSync(REFLECTION_BUDGET_FILE, 'utf-8')) as any; if (b?.month === now.toISOString().slice(0,7)) return b; } } catch { /* fallback below */ } return loadReflectionBudget(); }
function recent(iso: string | undefined, days: number, now: Date) { const t = iso ? new Date(iso).getTime() : NaN; return Number.isFinite(t) && t >= now.getTime() - days * 86400000; }
const activeStates = new Set(['PROPOSED','AUTO_STARTED','AWAIT_APPROVAL','RUNNING']);
type CohortSnapshotRefreshFailureReason = 'COHORT_REPO_UNAVAILABLE' | 'BACKFILL_JOB_NOT_RUN' | 'SNAPSHOT_WRITE_FAILED' | 'READ_AFTER_WRITE_MISMATCH' | 'LOCK_HELD' | 'UNKNOWN_ERROR';
type Phase3AStatus = 'ACTIVE' | 'INACTIVE';
interface Phase3APulseStatus {
  safetyGate: { enabled: boolean; sampleSize: number; status: Phase3AStatus; lastRunAt?: string };
  shadowLiveDelta: { enabled: boolean; sampleSize: number; status: Phase3AStatus; lastRunAt?: string };
  freshnessGuard: { enabled: boolean; decayedCount: number; status: Phase3AStatus; lastRunAt?: string };
  pulseArchive: LearningPulseArchiveStatus;
}
function envFlag(name: string): boolean { return process.env[name] === 'true'; }
function phase3AStatus(enabled: boolean, lastRunAt?: string, status?: string): Phase3AStatus {
  if (!enabled) return 'INACTIVE';
  if (status === 'ERROR') return 'INACTIVE';
  return lastRunAt ? 'ACTIVE' : 'INACTIVE';
}
function collectPhase3APulseStatus(now: Date): Phase3APulseStatus {
  const state = loadReflectionInjectionBusState();
  const safetyGateEnabled = envFlag('SAFETY_GATE_ATTRIBUTION_ENABLED');
  const shadowLiveDeltaEnabled = envFlag('SHADOW_LIVE_DELTA_REPORT_ENABLED');
  const freshnessGuardEnabled = envFlag('LEARNING_FRESHNESS_GUARD_ENABLED');
  return {
    safetyGate: {
      enabled: safetyGateEnabled,
      sampleSize: state.safetyGate?.sampleSize ?? 0,
      status: phase3AStatus(safetyGateEnabled, state.safetyGate?.lastRunAt, state.safetyGate?.status),
      lastRunAt: state.safetyGate?.lastRunAt,
    },
    shadowLiveDelta: {
      enabled: shadowLiveDeltaEnabled,
      sampleSize: state.shadowLiveDelta?.sampleSize ?? 0,
      status: phase3AStatus(shadowLiveDeltaEnabled, state.shadowLiveDelta?.lastRunAt, state.shadowLiveDelta?.status),
      lastRunAt: state.shadowLiveDelta?.lastRunAt,
    },
    freshnessGuard: {
      enabled: freshnessGuardEnabled,
      decayedCount: state.freshnessGuard?.decayedCount ?? 0,
      status: phase3AStatus(freshnessGuardEnabled, state.freshnessGuard?.lastRunAt, state.freshnessGuard?.status),
      lastRunAt: state.freshnessGuard?.lastRunAt,
    },
    pulseArchive: collectLearningPulseArchiveStatus(now),
  };
}
function cohortSnapshotAgeSec(runAt: string | undefined, now: Date): number | null {
  const t = runAt ? new Date(runAt).getTime() : NaN;
  return Number.isFinite(t) ? Math.max(0, Math.floor((now.getTime() - t) / 1000)) : null;
}
function classifyCohortRefreshFailure(error: unknown): CohortSnapshotRefreshFailureReason {
  const msg = error instanceof Error ? error.message.toUpperCase() : String(error ?? '').toUpperCase();
  if (msg.includes('LOCK')) return 'LOCK_HELD';
  if (msg.includes('WRITE') || msg.includes('EACCES') || msg.includes('EPERM')) return 'SNAPSHOT_WRITE_FAILED';
  if (msg.includes('ENOENT') || msg.includes('REPO')) return 'COHORT_REPO_UNAVAILABLE';
  return 'UNKNOWN_ERROR';
}
function counterfactualMetadataMissingCount(repair: ReturnType<typeof counterfactualMetadataRepairDryRun> | ReturnType<typeof counterfactualMetadataRepairRun>): number {
  return Math.max(repair.missingEntryPrice, repair.missingTargetPrice, repair.missingStopPrice);
}
function splitCounterfactualSuggestBlockers(input: {
  builtButUnlabeled: number;
  labeledInputSamples: number;
  pendingOutcomeCount: number;
  metadataMissingCount: number;
  maturedNowCount: number;
  resolverDataBlocked: boolean;
  legacyBlocker: string;
  trueUnknownRatio: number;
  recoveredLowConfidenceRegimeRatio: number;
  activeRegimeResolvedSampleSize: number;
}) {
  const secondaryBlockers: string[] = [];
  const unknownThreshold = 0.3;
  if (input.metadataMissingCount > 0) secondaryBlockers.push(`COUNTERFACTUAL_METADATA_MISSING_${input.metadataMissingCount}`);
  if (input.labeledInputSamples === 0) secondaryBlockers.push('NO_LABELED_COUNTERFACTUAL');
  if (input.pendingOutcomeCount > 0 && input.maturedNowCount === 0) secondaryBlockers.push('WAITING_FOR_COUNTERFACTUAL_MATURITY');
  if (input.activeRegimeResolvedSampleSize < 20) secondaryBlockers.push('LOW_RESOLVED_REGIME_SAMPLE');
  if (input.trueUnknownRatio > unknownThreshold) secondaryBlockers.push('UNKNOWN_RATIO_HIGH');
  if (input.recoveredLowConfidenceRegimeRatio > 0) secondaryBlockers.push('LOW_CONFIDENCE_REGIME_BACKFILL');
  if (input.labeledInputSamples === 0 && input.builtButUnlabeled === 0) secondaryBlockers.push('NO_FRESH_SAMPLE');
  const unique = [...new Set(secondaryBlockers)];
  const prioritized = ['NO_LABELED_COUNTERFACTUAL', 'NO_FRESH_SAMPLE', 'WAITING_FOR_COUNTERFACTUAL_MATURITY', 'LOW_CONFIDENCE_REGIME_BACKFILL', 'UNKNOWN_RATIO_HIGH'];
  const ordered = [...prioritized.filter((b) => unique.includes(b)), ...unique.filter((b) => !prioritized.includes(b))];
  if (!ordered.length && input.legacyBlocker !== 'NONE') ordered.push('UNKNOWN_BLOCKER_FALLBACK');
  const primaryBlocker = ordered[0] ?? 'NONE';
  return { primaryBlocker, secondaryBlockers: ordered.filter((b) => b !== primaryBlocker) };
}
function counterfactualLearningLane(input: {
  activeRegime: string;
  pendingOutcomeCount: number;
  labeledCount: number;
  r6PendingCount: number;
}): string {
  if (input.activeRegime === 'R6_DEFENSE' && (input.r6PendingCount > 0 || input.pendingOutcomeCount > 0 || input.labeledCount > 0)) return 'R6_COUNTERFACTUAL_ENTRY_ACTIVE';
  if (input.pendingOutcomeCount > 0 || input.labeledCount > 0) return 'COUNTERFACTUAL_ENTRY_ACTIVE';
  return 'FRESH_SHADOW_ONLY';
}
function deriveNoFreshReason(input: {
  freshSampleSize: number;
  activeRegime: string;
  r6PendingCount: number;
  pendingOutcomeCount: number;
  labeledCount: number;
  maturedNowCount: number;
  metadataMissingCount: number;
  freshInletBlocker: string;
  todayFreshCandidates: number;
}): string {
  if (input.freshSampleSize > 0) return 'N/A';
  if (input.activeRegime === 'R6_DEFENSE' && input.r6PendingCount > 0 && input.maturedNowCount === 0) return 'R6_COUNTERFACTUAL_PENDING_MATURITY';
  if (input.activeRegime === 'R6_DEFENSE' && input.r6PendingCount > 0 && input.maturedNowCount > 0) return 'R6_COUNTERFACTUAL_MATURED_RESOLVE_DUE';
  if (input.metadataMissingCount > 0) return 'COUNTERFACTUAL_METADATA_REPAIR_REQUIRED_ENTRY_TARGET_STOP';
  if (input.pendingOutcomeCount > 0) return 'COUNTERFACTUAL_PENDING_OUTCOME';
  if (input.labeledCount > 0) return 'COUNTERFACTUAL_LABELED_INPUT_AVAILABLE';
  if (input.todayFreshCandidates === 0) return 'NO_FRESH_SHADOW_CANDIDATES_TODAY';
  if (input.freshInletBlocker && input.freshInletBlocker !== 'FRESH_SHADOW_INLET_ACTIVE') return input.freshInletBlocker;
  return 'FRESH_SHADOW_SAMPLE_ZERO_UNKNOWN';
}
function deriveFreshShadowStatus(input: {
  freshSampleSize: number;
  marketSession: string;
  noFreshReason: string;
}): 'ACTIVE' | 'ZERO_WAITING_MARKET_OPEN' | 'ZERO_NO_CANDIDATE' | 'ZERO_R6_COUNTERFACTUAL_PENDING' | 'ZERO_PIPELINE_BROKEN' {
  if (input.freshSampleSize > 0) return 'ACTIVE';
  if (input.noFreshReason === 'R6_COUNTERFACTUAL_PENDING_MATURITY') return 'ZERO_R6_COUNTERFACTUAL_PENDING';
  if (input.marketSession === 'CLOSED') return 'ZERO_WAITING_MARKET_OPEN';
  if (input.noFreshReason === 'NO_FRESH_SHADOW_CANDIDATES_TODAY') return 'ZERO_NO_CANDIDATE';
  return 'ZERO_PIPELINE_BROKEN';
}
function derivePromotionReadinessStatus(input: {
  freshSampleSize: number;
  counterfactualPendingCount: number;
  counterfactualMaturityStatus: string;
  labeledCount: number;
}): 'CORE_READY' | 'ADVISORY_READY' | 'DIAGNOSTIC_ONLY' | 'BLOCKED_NO_FRESH_SAMPLE' | 'BLOCKED_NO_LABELED_COUNTERFACTUAL' | 'WAITING_COUNTERFACTUAL_MATURITY' {
  if (input.freshSampleSize >= 100) return 'CORE_READY';
  if (input.freshSampleSize === 0 && input.counterfactualPendingCount > 0 && input.counterfactualMaturityStatus === 'WAITING_NORMAL') return 'WAITING_COUNTERFACTUAL_MATURITY';
  if (input.labeledCount > 0) return 'ADVISORY_READY';
  if (input.freshSampleSize === 0) return 'BLOCKED_NO_FRESH_SAMPLE';
  if (input.labeledCount === 0) return 'BLOCKED_NO_LABELED_COUNTERFACTUAL';
  return 'DIAGNOSTIC_ONLY';
}

export function deriveFreshShadowDisplay(input: {
  marketSession: string;
  freshSampleSize: number;
  queuedNextOpenShadowScan: boolean;
  shadowScanLifecycleStatus?: string;
  lastShadowScanResult?: string;
}) {
  if (input.shadowScanLifecycleStatus === 'FAILED') return { status: 'SCAN_FAILED', severity: 'ERROR', reason: 'SHADOW_SCAN_PIPELINE_FAILED', operatorAction: 'CHECK_SHADOW_SCAN_PIPELINE', blocker: 'SHADOW_SCAN_FAILED' as string | null };
  if (input.marketSession === 'CLOSED' && input.queuedNextOpenShadowScan && input.freshSampleSize === 0) return { status: 'WAITING_NEXT_OPEN', severity: 'INFO', reason: 'MARKET_CLOSED_WAITING_NEXT_SHADOW_SCAN', operatorAction: 'WAIT_NEXT_OPEN', blocker: null as string | null };
  if (input.marketSession === 'REGULAR' && input.freshSampleSize === 0 && input.lastShadowScanResult !== 'SHADOW_SCAN_SCHEDULED') return { status: 'ZERO_DURING_MARKET', severity: 'WARN', reason: 'NO_FRESH_SAMPLE_DURING_MARKET', operatorAction: 'CHECK_SCAN_INPUT_OR_GATE_BLOCKERS', blocker: 'NO_FRESH_SAMPLE_DURING_MARKET' as string | null };
  return { status: input.freshSampleSize > 0 ? 'ACTIVE' : 'WAITING_NEXT_OPEN', severity: 'INFO', reason: 'FRESH_SHADOW_INLET_ACTIVE', operatorAction: 'MONITOR', blocker: null as string | null };
}

export function deriveCounterfactualDisplay(input: {
  nearestMaturityAt?: string;
  labeledCount: number;
  resolvableNow: number;
}) {
  const nearestTs = input.nearestMaturityAt ? new Date(input.nearestMaturityAt).getTime() : NaN;
  const matured = Number.isFinite(nearestTs) && Date.now() > nearestTs;
  if (matured && input.resolvableNow > 0 && input.labeledCount === 0) return { status: 'WAITING_MATURITY', severity: 'ERROR', blocker: 'COUNTERFACTUAL_RESOLVER_NOT_LABELING_AFTER_MATURITY', operatorAction: 'CHECK_COUNTERFACTUAL_RESOLVER' };
  return { status: 'WAITING_MATURITY', severity: 'INFO', blocker: 'NO_LABELED_COUNTERFACTUAL', operatorAction: 'WAIT_COUNTERFACTUAL_MATURITY' };
}

// Promotion top-line blocker normalizer — surfaces the real bottleneck (labeled counterfactual)
// instead of a market-closed fresh-sample zero, which is a normal waiting state.
export function normalizePromotionBlocker(input: {
  promotionAllowed: boolean;
  counterfactualLabeledInputSamples: number;
  counterfactualBuiltButUnlabeled: number;
  counterfactualMaturityStatus?: string;
  freshDisplayStatus: string;
  marketSession: string;
  rawBlockers?: string[];
}): { displayBlocker: string; severity: 'INFO' | 'WARN' | 'ERROR'; displayReason: string } {
  if (input.promotionAllowed) return { displayBlocker: 'NONE', severity: 'INFO', displayReason: 'PROMOTION_ALLOWED' };
  if (input.counterfactualLabeledInputSamples === 0 && input.counterfactualBuiltButUnlabeled > 0) return { displayBlocker: 'NO_LABELED_COUNTERFACTUAL', severity: 'INFO', displayReason: 'WAITING_FOR_FIRST_COUNTERFACTUAL_LABELS' };
  if (input.counterfactualMaturityStatus === 'WAITING_NORMAL') return { displayBlocker: 'WAITING_COUNTERFACTUAL_MATURITY', severity: 'INFO', displayReason: 'COUNTERFACTUAL_OUTCOMES_NOT_MATURED_YET' };
  if (input.freshDisplayStatus === 'ZERO_DURING_MARKET') return { displayBlocker: 'NO_FRESH_SAMPLE_DURING_MARKET', severity: 'WARN', displayReason: 'FRESH_SHADOW_ZERO_DURING_MARKET' };
  if (input.freshDisplayStatus === 'WAITING_NEXT_OPEN') return { displayBlocker: 'MARKET_CLOSED_WAITING_NEXT_SHADOW_SCAN', severity: 'INFO', displayReason: 'MARKET_CLOSED_AND_NEXT_SHADOW_SCAN_SCHEDULED' };
  return { displayBlocker: 'LOW_SAMPLE_SIZE', severity: 'INFO', displayReason: 'PROMOTION_SAMPLE_NOT_READY' };
}

type DisplaySeverity = 'INFO' | 'WARN' | 'ERROR';
type RegimePromotionBlocker =
  | 'NO_LABELED_COUNTERFACTUAL'
  | 'WAITING_COUNTERFACTUAL_MATURITY'
  | 'NO_FRESH_SAMPLE_DURING_MARKET'
  | 'MARKET_CLOSED_WAITING_NEXT_SHADOW_SCAN'
  | 'LOW_CONFIDENCE_REGIME_BACKFILL'
  | 'LOW_RESOLVED_REGIME_SAMPLE'
  | 'R6_LOW_SAMPLE'
  | 'LOW_SAMPLE_SIZE'
  | 'NONE';
type NormalizedRegimePromotionSplit = {
  regimePromotionAllowedForDiagnostic: boolean;
  regimePromotionAllowedForAdvisory: boolean;
  corePromotionAllowed: boolean;
  corePromotionBlocker: RegimePromotionBlocker;
  corePromotionBlockerReason: string;
  corePromotionSeverity: DisplaySeverity;
  suggestPromotionBlocker: RegimePromotionBlocker;
  primaryLearningBlocker: RegimePromotionBlocker;
  secondaryLearningBlockers: RegimePromotionBlocker[];
  displayOnlyBlockers: RegimePromotionBlocker[];
  advisoryOnlyBlockers: RegimePromotionBlocker[];
  rawDiagnosticBlockers: string[];
  freshShadowDisplayStatus?: string;
  freshShadowSeverity?: DisplaySeverity;
  executionImpact: string;
};

// Regime Promotion Split blocker normalizer — keeps the detail section aligned with the
// normalized top-line: the real core bottleneck (NO_LABELED_COUNTERFACTUAL) is primary, while a
// market-closed fresh-sample zero is demoted to a display-only waiting state. Raw blockers are
// preserved under rawDiagnosticBlockers (never surfaced as the core blocker).
export function normalizeRegimePromotionSplit(input: {
  corePromotionAllowed: boolean;
  regimePromotionAllowedForDiagnostic: boolean;
  regimePromotionAllowedForAdvisory: boolean;
  counterfactualBuiltButUnlabeled: number;
  counterfactualLabeledInputSamples: number;
  counterfactualWaitingForMaturity: number;
  counterfactualMaturityStatus?: string;
  freshShadowDisplayStatus?: string;
  freshShadowSeverity?: DisplaySeverity;
  activeRegime?: string;
  activeRegimeResolvedSampleSize?: number;
  requiredResolvedSampleSize?: number;
  activeRegimePendingCounterfactualCount?: number;
  metricWarnings?: string[];
  rawCorePromotionBlocker?: string;
  rawSecondaryLearningBlockers?: string[];
  executionImpact?: string;
}): NormalizedRegimePromotionSplit {
  const secondaryLearningBlockers: RegimePromotionBlocker[] = [];
  const displayOnlyBlockers: RegimePromotionBlocker[] = [];
  const advisoryOnlyBlockers: RegimePromotionBlocker[] = [];
  const rawDiagnosticBlockers: string[] = [];

  let corePromotionBlocker: RegimePromotionBlocker = 'NONE';
  let corePromotionBlockerReason = 'PROMOTION_ALLOWED_OR_NO_CORE_BLOCKER';
  let corePromotionSeverity: DisplaySeverity = 'INFO';

  if (!input.corePromotionAllowed) {
    if (input.counterfactualBuiltButUnlabeled > 0 && input.counterfactualLabeledInputSamples === 0) {
      // Labeled counterfactual sample is the real promotion input bottleneck — outranks fresh-shadow zero.
      corePromotionBlocker = 'NO_LABELED_COUNTERFACTUAL';
      corePromotionBlockerReason = 'WAITING_FOR_FIRST_COUNTERFACTUAL_LABELS';
      corePromotionSeverity = 'INFO';
    } else if (input.freshShadowDisplayStatus === 'ZERO_DURING_MARKET') {
      corePromotionBlocker = 'NO_FRESH_SAMPLE_DURING_MARKET';
      corePromotionBlockerReason = 'FRESH_SHADOW_ZERO_DURING_MARKET';
      corePromotionSeverity = 'WARN';
    } else {
      corePromotionBlocker = 'LOW_SAMPLE_SIZE';
      corePromotionBlockerReason = 'PROMOTION_SAMPLE_NOT_READY';
      corePromotionSeverity = 'INFO';
    }
  }

  if (input.counterfactualWaitingForMaturity > 0 || input.counterfactualMaturityStatus === 'WAITING_NORMAL') {
    secondaryLearningBlockers.push('WAITING_COUNTERFACTUAL_MATURITY');
  }

  if (input.freshShadowDisplayStatus === 'WAITING_NEXT_OPEN') {
    displayOnlyBlockers.push('MARKET_CLOSED_WAITING_NEXT_SHADOW_SCAN');
  }

  if (input.activeRegime === 'R6_DEFENSE' && (input.activeRegimeResolvedSampleSize ?? 0) < (input.requiredResolvedSampleSize ?? 100)) {
    if ((input.activeRegimePendingCounterfactualCount ?? 0) > 0) {
      displayOnlyBlockers.push('R6_LOW_SAMPLE');
    } else {
      advisoryOnlyBlockers.push('LOW_RESOLVED_REGIME_SAMPLE');
    }
  }

  if (input.metricWarnings?.includes('LOW_CONFIDENCE_REGIME_BACKFILL')) {
    advisoryOnlyBlockers.push('LOW_CONFIDENCE_REGIME_BACKFILL');
  }

  for (const raw of [input.rawCorePromotionBlocker, ...(input.rawSecondaryLearningBlockers ?? [])]) {
    if (raw === 'NO_FRESH_SAMPLE') rawDiagnosticBlockers.push('NO_FRESH_SAMPLE');
  }

  const suggestPromotionBlocker: RegimePromotionBlocker =
    input.counterfactualLabeledInputSamples === 0 ? 'NO_LABELED_COUNTERFACTUAL' : corePromotionBlocker;

  return {
    regimePromotionAllowedForDiagnostic: input.regimePromotionAllowedForDiagnostic,
    regimePromotionAllowedForAdvisory: input.regimePromotionAllowedForAdvisory,
    corePromotionAllowed: input.corePromotionAllowed,
    corePromotionBlocker,
    corePromotionBlockerReason,
    corePromotionSeverity,
    suggestPromotionBlocker,
    primaryLearningBlocker: corePromotionBlocker,
    secondaryLearningBlockers: [...new Set(secondaryLearningBlockers)],
    displayOnlyBlockers: [...new Set(displayOnlyBlockers)],
    advisoryOnlyBlockers: [...new Set(advisoryOnlyBlockers)],
    rawDiagnosticBlockers: [...new Set(rawDiagnosticBlockers)],
    freshShadowDisplayStatus: input.freshShadowDisplayStatus,
    freshShadowSeverity: input.freshShadowSeverity,
    executionImpact: input.executionImpact ?? 'NONE',
  };
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
  if (useRatio < PULSE_THRESHOLDS.GEMINI_USE_RATIO_TARGET) flags.push(`gemini_scheduler_warning (호출률 ${(useRatio * 100).toFixed(0)}% < 80%, executionImpact=NONE, promotionImpact=NONE)`);
  const freshShadow = collectFreshShadowStatus(shadowCaseLedger, now);
  const freshShadowInlet = collectFreshShadowInletStatus(shadowCaseLedger, now);
  const freshPromotion = collectFreshOnlyPromotion(shadowCaseLedger);
  const counterfactual = collectCounterfactualStatus(now);
  const freshShadowInletForPulse = {
    ...(freshShadowInlet as any),
    lastShadowScanResult: ((freshShadowInlet as any).lastShadowScanResult === 'NO_SHADOW_RESULT' && (counterfactual.buildEventCount > 0 || counterfactual.builtUniqueCount > 0))
      ? 'SHADOW_COUNTERFACTUAL_CREATED'
      : (freshShadowInlet as any).lastShadowScanResult,
    nextOpenShadowScanLogEvents: [
      ...(((freshShadowInlet as any).nextOpenShadowScanLogEvents ?? []) as string[]),
      ((freshShadowInlet as any).lastShadowScanResult === 'NO_SHADOW_RESULT' && (counterfactual.buildEventCount > 0 || counterfactual.builtUniqueCount > 0)) ? 'SHADOW_COUNTERFACTUAL_CREATED' : undefined,
    ].filter((value): value is string => !!value),
  };
  const initialCounterfactualMetadataRepair = counterfactualMetadataRepairDryRun(now);
  const counterfactualMetadataRepair = initialCounterfactualMetadataRepair.metadataRepairStatus === 'READY_TO_REPAIR'
    ? counterfactualMetadataRepairRun(now)
    : initialCounterfactualMetadataRepair;
  const counterfactualMaturity = collectCounterfactualMaturityStatus(now);
  const counterfactualResolver = counterfactualResolveDryRun(now);
  let cohorts = collectLearningCohortSummary(now);
  let cohortConsistency = collectLearningCohortConsistencyStatus(now);
  const cohortSnapshotMaxAgeSec = 24 * 3600;
  let cohortSnapshotRefreshedAt = cohortConsistency.lastCohortBackfillRunAt;
  let cohortSnapshotAge = cohortSnapshotAgeSec(cohortSnapshotRefreshedAt, now);
  let cohortSnapshotRefreshStatus = cohortSnapshotAge === null ? 'BACKFILL_JOB_NOT_RUN' : cohortSnapshotAge > cohortSnapshotMaxAgeSec ? 'STALE' : 'OK';
  let cohortSnapshotRefreshFailureReason: CohortSnapshotRefreshFailureReason | undefined;
  if (cohortSnapshotAge === null || cohortSnapshotAge > cohortSnapshotMaxAgeSec) {
    try {
      const refreshed = learningCohortBackfillRun(now);
      cohorts = collectLearningCohortSummary(now);
      cohortConsistency = collectLearningCohortConsistencyStatus(now);
      cohortSnapshotRefreshedAt = cohortConsistency.lastCohortBackfillRunAt ?? refreshed.runAt;
      cohortSnapshotAge = cohortSnapshotAgeSec(cohortSnapshotRefreshedAt, now);
      if (!cohortSnapshotRefreshedAt) {
        cohortSnapshotRefreshStatus = 'REFRESH_FAILED';
        cohortSnapshotRefreshFailureReason = 'BACKFILL_JOB_NOT_RUN';
      } else if ((cohortSnapshotAge ?? cohortSnapshotMaxAgeSec + 1) > cohortSnapshotMaxAgeSec || cohortConsistency.snapshotStatus !== 'OK') {
        cohortSnapshotRefreshStatus = 'REFRESH_FAILED';
        cohortSnapshotRefreshFailureReason = 'READ_AFTER_WRITE_MISMATCH';
      } else {
        cohortSnapshotRefreshStatus = 'REFRESHED';
      }
    } catch (e) {
      cohortSnapshotRefreshStatus = 'REFRESH_FAILED';
      cohortSnapshotRefreshFailureReason = classifyCohortRefreshFailure(e);
      console.warn('[LearningPulse] cohort snapshot refresh failed (non-fatal):', e);
    }
  }
  const geminiScheduler = ensureGeminiLearningScheduleFresh(now);
  const regimeLearning = collectRegimeLearningBank();
  const regimeLearningConsistency = collectRegimeLearningConsistency(regimeLearning);
  const counterfactualBuiltButUnlabeled = counterfactual.pendingOutcomeCount + counterfactual.dataInsufficientCount + counterfactual.quarantinedCount + counterfactual.expiredCount + counterfactual.unresolvedCount;
  const counterfactualLabeledInputSamples = counterfactual.labeledCount;
  const suggestInputSamples = counterfactualLabeledInputSamples;
  const counterfactualMetadataMissing = counterfactualMetadataMissingCount(counterfactualMetadataRepair);
  const pendingOutcomeTotalCount = counterfactual.pendingOutcomeCount;
  const quarantinedPendingCount = counterfactual.quarantinedCount;
  const pendingOutcomeEligibleCount = Math.max(0, pendingOutcomeTotalCount - quarantinedPendingCount);
  const createdToday = Math.max(0, counterfactual.buildEventCount - counterfactual.duplicateSuppressedCount);
  const shadowScanEvents = Array.isArray((freshShadowInletForPulse as any).nextOpenShadowScanLogEvents)
    ? (freshShadowInletForPulse as any).nextOpenShadowScanLogEvents
    : [];
  const firstEventTimestamp = (eventType: string): string | undefined => {
    const hit = shadowScanEvents.find((e: any) => e?.event === eventType && typeof e?.timestamp === 'string');
    return typeof hit?.timestamp === 'string' ? hit.timestamp : undefined;
  };
  const shadowScanStartedFromEvent = firstEventTimestamp('SHADOW_SCAN_STARTED');
  const shadowCandidatesScannedFromEvent = firstEventTimestamp('SHADOW_CANDIDATES_SCANNED');
  const firstBuildEventAt = (counterfactualMaturity as any).firstBuildEventAt as string | undefined;
  const firstCounterfactualCreatedAt = (counterfactualMaturity as any).firstCounterfactualCreatedAt as string | undefined;
  const inferredShadowStartedAt = (freshShadowInletForPulse as any).lastShadowScanStartedAt
    ?? shadowScanStartedFromEvent
    ?? shadowCandidatesScannedFromEvent
    ?? firstBuildEventAt
    ?? firstCounterfactualCreatedAt
    ?? now.toISOString();
  const shadowScanStartedAtSource = (freshShadowInletForPulse as any).lastShadowScanStartedAt ? 'FRESH_SHADOW_INLET_LAST_SCAN'
    : shadowScanStartedFromEvent ? 'SHADOW_SCAN_STARTED'
      : shadowCandidatesScannedFromEvent ? 'SHADOW_CANDIDATES_SCANNED'
        : firstBuildEventAt ? 'FIRST_BUILD_EVENT_AT'
          : firstCounterfactualCreatedAt ? 'FIRST_COUNTERFACTUAL_CREATED_AT'
            : 'NOW_FALLBACK';
  const nextResolveAt = (counterfactualMaturity as any).nextResolveAt as string | undefined;
  const inferredShadowCandidates = ((freshShadowInletForPulse as any).lastShadowScanCandidateCount ?? 0) > 0
    ? (freshShadowInletForPulse as any).lastShadowScanCandidateCount
    : Math.max(counterfactual.candidateCount, createdToday);
  const inferredNextOpenShadowScanStatus = (freshShadowInletForPulse as any).lastShadowScanResult === 'SHADOW_COUNTERFACTUAL_CREATED'
    ? 'COMPLETED_WITH_COUNTERFACTUAL'
    : (freshShadowInletForPulse as any).nextOpenShadowScanStatus;
  const shadowScanLifecycleStatus = (freshShadowInletForPulse as any).lastShadowScanResult === 'SHADOW_COUNTERFACTUAL_CREATED'
    ? 'COMPLETED_WITH_COUNTERFACTUAL'
    : ((freshShadowInletForPulse as any).nextOpenShadowScanStatus ?? 'SCHEDULED');
  const counterfactualWaitingForMaturity = counterfactualMaturity.waitingCount;
  const shadowLearningLane = counterfactualLearningLane({
    activeRegime: regimeLearning.activeRegime,
    pendingOutcomeCount: counterfactual.pendingOutcomeCount,
    labeledCount: counterfactual.labeledCount,
    r6PendingCount: regimeLearning.R6PendingCounterfactualCount,
  });
  const noFreshReason = deriveNoFreshReason({
    freshSampleSize: freshPromotion.freshSampleSize,
    activeRegime: regimeLearning.activeRegime,
    r6PendingCount: regimeLearning.R6PendingCounterfactualCount,
    pendingOutcomeCount: counterfactual.pendingOutcomeCount,
    labeledCount: counterfactual.labeledCount,
    maturedNowCount: counterfactualMaturity.maturedNowCount,
    metadataMissingCount: counterfactualMetadataMissing,
    freshInletBlocker: freshShadowInlet.blocker,
    todayFreshCandidates: freshShadow.todayFreshCandidates,
  });
  const freshShadowStatus = deriveFreshShadowStatus({
    freshSampleSize: freshPromotion.freshSampleSize,
    marketSession: (freshShadowInletForPulse as any).marketSession ?? ((freshShadowInletForPulse as any).marketOpen === false ? 'CLOSED' : 'OPEN'),
    noFreshReason,
  });
  const counterfactualMaturityStatus = counterfactualMaturity.maturityStatus;
  const promotionReadinessStatus = derivePromotionReadinessStatus({
    freshSampleSize: freshPromotion.freshSampleSize,
    counterfactualPendingCount: counterfactual.pendingOutcomeCount,
    counterfactualMaturityStatus,
    labeledCount: counterfactual.labeledCount,
  });
  const systemHealth = freshPromotion.freshSampleSize === 0
    && counterfactual.pendingOutcomeCount > 0
    && counterfactualMaturityStatus === 'WAITING_NORMAL'
    ? 'NORMAL_WAITING_MATURITY'
    : freshPromotion.freshSampleSize === 0
      && counterfactual.pendingOutcomeCount === 0
      && ((freshShadowInletForPulse as any).nextOpenShadowScanStatus === 'NONE' || !(freshShadowInletForPulse as any).queuedNextOpenShadowScan)
      ? 'PIPELINE_ATTENTION_REQUIRED'
      : 'NORMAL';
  const operatorAction = systemHealth === 'NORMAL_WAITING_MATURITY'
    ? 'WAIT_COUNTERFACTUAL_MATURITY'
    : systemHealth === 'PIPELINE_ATTENTION_REQUIRED'
      ? 'CHECK_SHADOW_INLET'
      : 'MONITOR';
  const blockerSplit = splitCounterfactualSuggestBlockers({
    builtButUnlabeled: counterfactualBuiltButUnlabeled,
    labeledInputSamples: counterfactualLabeledInputSamples,
    pendingOutcomeCount: counterfactual.pendingOutcomeCount,
    metadataMissingCount: counterfactualMetadataMissing,
    maturedNowCount: counterfactualMaturity.maturedNowCount,
    resolverDataBlocked: counterfactualResolver.dataInsufficient > 0 || counterfactualResolver.quarantined > 0,
    legacyBlocker: v2.suggest.blocker,
    trueUnknownRatio: regimeLearning.trueUnknownRatio,
    recoveredLowConfidenceRegimeRatio: regimeLearning.recoveredLowConfidenceRegimeRatio,
    activeRegimeResolvedSampleSize: regimeLearning.activeRegimeResolvedSampleSize,
  });
  const suggest = { ...v2.suggest, counterfactualBuiltButUnlabeled, counterfactualLabeledInputSamples, counterfactualWaitingForMaturity, counterfactualMetadataMissing, suggestInputSamples, primaryBlocker: blockerSplit.primaryBlocker, secondaryBlockers: blockerSplit.secondaryBlockers, blocker: blockerSplit.primaryBlocker, status: 'DIAGNOSTIC_ONLY', autoApply: false };
  const consistencyCheck = { ...(v2 as any).consistencyCheck, counterfactualCountInvariantValid: counterfactual.countInvariantValid, counterfactualUniqueNotGreaterThanCandidate: counterfactual.builtUniqueCount <= counterfactual.candidateCount, freshMetricNAWhenNoSample: freshPromotion.freshSampleSize > 0 || freshPromotion.freshExpectancyR === 'N/A', counterfactualLabelingConnected: counterfactual.labeledCount > 0 || counterfactual.pendingOutcomeCount + counterfactual.dataInsufficientCount + counterfactual.quarantinedCount > 0, counterfactualDuplicateGuardActive: counterfactual.duplicateSuppressionStatus === 'OK', cohortSumMatchesTotal: cohortConsistency.cohortSumMatchesTotal, ghostRepairReflectedInPulse: cohortConsistency.ghostRepairReflectedInPulse, regimeSumMatchesTotal: regimeLearningConsistency.regimeSumMatchesTotal };
  const metricWarnings = [...(counterfactual.metricWarnings ?? []).filter((w) => w !== 'WAITING_FOR_HOLDING_PERIOD' && w !== 'WAITING_NORMAL'), ...cohortConsistency.metricWarnings, ...regimeLearningConsistency.metricWarnings];
  const metricInfos = [...(counterfactual.metricInfos ?? []), ...cohortConsistency.metricInfos];
  const warningDemotionToInfo = counterfactual.pendingOutcomeCount > 0 && counterfactualMaturityStatus === 'WAITING_NORMAL' && (freshShadowInletForPulse as any).nextOpenShadowScanStatus === 'SCHEDULED';
  const dedupAuditInfo = ((regimeLearning as any).regimeDedupStatus === 'ACTIVE' || counterfactual.duplicateSuppressionStatus === 'OK') && counterfactual.countInvariantValid;
  const normalizedWarnings = metricWarnings.filter((warning) => {
    if (warning === 'FRESH_SHADOW_ZERO' && warningDemotionToInfo) {
      metricInfos.push('FRESH_SHADOW_ZERO:WAITING_MATURITY_AND_MARKET_CLOSED');
      return false;
    }
    if (warning === 'REGIME_SAMPLE_DUPLICATION_SUSPECT' && dedupAuditInfo) {
      metricInfos.push('REGIME_SAMPLE_DUPLICATION_SUSPECT:AUDIT_INFO');
      return false;
    }
    return true;
  });
  if (!consistencyCheck.counterfactualLabelingConnected) metricWarnings.push('COUNTERFACTUAL_LABELING_DISCONNECTED');
  if (!consistencyCheck.freshMetricNAWhenNoSample) metricWarnings.push('FRESH_EXPECTANCY_ZERO_SAMPLE_SHOWN_AS_ZERO');
  if (!consistencyCheck.counterfactualDuplicateGuardActive) metricWarnings.push('COUNTERFACTUAL_DUPLICATE_GUARD_MISSING');
  if (inferredShadowStartedAt === nextResolveAt && typeof nextResolveAt === 'string') metricWarnings.push('SHADOW_SCAN_TIMESTAMP_SUSPECT_MATURITY_TIME_REUSED');
  if ((freshShadowInletForPulse as any).warning) metricWarnings.push(String((freshShadowInletForPulse as any).warning));
  if (cohortSnapshotRefreshStatus === 'REFRESH_FAILED') metricWarnings.push(`COHORT_SNAPSHOT_REFRESH_FAILED:${cohortSnapshotRefreshFailureReason ?? 'UNKNOWN_ERROR'}`);
  const phase3A = collectPhase3APulseStatus(now);
  const gate3LearningFinalization = buildGate3LearningFinalization(getLastGate3FinalizationSummary());
  const gate3LearningDisplay = normalizeGate3LearningDisplay({
    current: gate3LearningFinalization,
    lastValid: getLastValidGate3Snapshot(),
    cohortSnapshotStatus: cohortConsistency.snapshotStatus,
    evidenceSnapshotAgeSec: cohortSnapshotAge ?? undefined,
    evidenceSnapshotMaxAgeSec: cohortSnapshotMaxAgeSec,
  });
  return { ...v2, suggest, consistencyCheck, metricWarnings: normalizedWarnings, metricInfos, v3: collectLearningPulseV3(now), phase3A, gate3LearningDisplay, freshShadow, freshShadowInlet: { ...(freshShadowInletForPulse as any), nextOpenShadowScanStatus: inferredNextOpenShadowScanStatus, lastShadowScanStartedAt: inferredShadowStartedAt, shadowScanStartedAtSource, lastShadowScanCandidateCount: inferredShadowCandidates }, freshPromotion, noFreshReason, freshShadowStatus, counterfactualMaturityStatus, promotionReadinessStatus, systemHealth, operatorAction, shadowLearningLane, counterfactual, counterfactualMetadataRepair, counterfactualMaturity, counterfactualResolver, regimeLearning, regimeLearningConsistency, cohorts, cohortConsistency, cohortSnapshotStatus: cohortConsistency.snapshotStatus, cohortSnapshotAgeSec: cohortSnapshotAge, cohortSnapshotMaxAgeSec, cohortSnapshotRefreshedAt, cohortSnapshotRefreshStatus, cohortSnapshotRefreshFailureReason, counterfactualBuiltButUnlabeled, counterfactualLabeledInputSamples, counterfactualWaitingForMaturity, counterfactualMetadataMissing, pendingOutcomeTotalCount, pendingOutcomeEligibleCount, quarantinedPendingCount, shadowScanLifecycleStatus, counterfactualCreatedToday: createdToday, evaluatedCandidateCount: counterfactual.candidateCount, r6BlockedButCounterfactualCreatedCount: regimeLearning.activeRegime === 'R6_DEFENSE' ? createdToday : 0, suggestInputSamples, firstCounterfactualCreatedAt, firstBuildEventAt, counterfactualMaturityAt: (counterfactualMaturity as any).nearestMaturityAt, nextResolveAt, gate3LearningFinalization, todayKst: new Date(now.getTime() + 9 * 3600000).toISOString().slice(0,10), ghost: { ...v2.ghost, closedRecent7d, closeRatio }, attribution7d: { count: attribution7dCount, target: LEARNING_ATTRIBUTION_TARGET_7D }, weights: { changedFromDefault, sunsetCount, untouched, lastF2WRanAt: f2wTail?.ranAt, lastF2WSkipCount: f2wTail ? f2wTail.adjustments.filter((a: any) => a.action === 'NONE').length : 0, lastF2WTotalRecords: f2wTail?.totalRecords ?? 0 }, suggest7d, diagnosticProposals7d, experimentsActive, gemini: { ...v2.gemini, month: budget.month, callCount: budget.callCount, tokensUsed: budget.tokensUsed, useRatio, schedulerStatus: geminiScheduler.schedulerStatus, lastScheduledAt: geminiScheduler.lastScheduledAt, lastRunAt: geminiScheduler.lastRunAt, nextScheduledAt: geminiScheduler.nextScheduledAt, missedCount: geminiScheduler.missedCount, recommendationOnly: geminiScheduler.recommendationOnly }, geminiScheduler, flags, partialFailure: errors.length > 0 };
}
function formatLearningPulseMessageBase(s: ReturnType<typeof collectLearningPulse>, freshShadowDisplay: ReturnType<typeof deriveFreshShadowDisplay>, promotionBlocker: ReturnType<typeof normalizePromotionBlocker>): string {
  const suggestSignals7d = Object.values(s.suggest7d).reduce((a,b)=>a+b,0);
  const totalSuggest = Math.max(suggestSignals7d + s.diagnosticProposals7d, s.suggest.total7d);
  return [`🩺 Learning Pulse v5 (${s.todayKst})`, `Legacy Pulse v4: operational=false / status=LEGACY_SNAPSHOT`, `🌱 Fresh Shadow: todayFreshCandidates ${s.freshShadow.todayFreshCandidates} / freshOpen ${s.freshShadow.freshShadowOpen} / freshClosed7d ${s.freshShadow.freshShadowClosed7d} / freshSampleSize ${s.freshPromotion.freshSampleSize} / freshExpectancyR ${typeof s.freshPromotion.freshExpectancyR === 'number' ? s.freshPromotion.freshExpectancyR.toFixed(4) : 'N/A'} / status ${freshShadowDisplay.status} / reason ${freshShadowDisplay.reason} / severity ${freshShadowDisplay.severity} / operatorAction ${freshShadowDisplay.operatorAction}${freshShadowDisplay.blocker ? ` / blocker ${freshShadowDisplay.blocker}` : ''}`, `🧪 Counterfactual: candidateCount ${s.counterfactual.candidateCount} / eligibleCount ${s.counterfactual.eligibleCount} / buildEventCount ${s.counterfactual.buildEventCount} / builtUniqueCount ${s.counterfactual.builtUniqueCount} / duplicateSuppressedCount ${s.counterfactual.duplicateSuppressedCount} / labeledCount ${s.counterfactual.labeledCount} / pendingOutcomeCount ${s.counterfactual.pendingOutcomeCount} / dataInsufficientCount ${s.counterfactual.dataInsufficientCount} / quarantinedCount ${s.counterfactual.quarantinedCount} / expiredCount ${s.counterfactual.expiredCount} / unresolvedCount ${s.counterfactual.unresolvedCount} / countInvariantValid ${s.counterfactual.countInvariantValid} / blocker ${s.counterfactual.blocker}`, `🚦 Promotion: basis=${s.freshPromotion.basis} / promotionTier=${s.freshPromotion.promotionTier} / freshSampleSize=${s.freshPromotion.freshSampleSize} / requiredFreshSamples=${s.freshPromotion.requiredFreshSamples} / promotionAllowed=${s.freshPromotion.promotionAllowed} / blocker=${promotionBlocker.displayBlocker} / reason=${promotionBlocker.displayReason} / severity ${promotionBlocker.severity}`, `👻 Ghost Portfolio: OPEN ${s.ghost.open} / 7일 close ${s.ghost.closedRecent7d} / closeRate7d ${(s.ghost.closeRate7d*100).toFixed(1)}%`, `📊 Attribution: ${s.attribution7d.count}/${s.attribution7d.target} (7d) / starvationReason ${s.attribution.starvationReason}${s.attribution.previousStarvationReason ? ` / previousStarvationReason ${s.attribution.previousStarvationReason}` : ''}`, `⚖️ Condition Weights: changed ${s.weights.changedFromDefault} / untouched ${s.weights.untouched} / sunset ${s.weights.sunsetCount}`, `🔔 Suggest Metrics: suggestSignals7d ${suggestSignals7d} / diagnosticProposals7d ${s.diagnosticProposals7d} / counterfactualBuiltButUnlabeled ${s.counterfactualBuiltButUnlabeled} / counterfactualLabeledInputSamples ${s.counterfactualLabeledInputSamples} / suggestInputSamples ${s.suggestInputSamples} / autoApplied7d 0 / totalDiagnosticEvents7d ${s.diagnosticProposals7d} / blocker ${s.suggest.blocker} / status DIAGNOSTIC_ONLY / legacyTotal7d ${totalSuggest}`, `🧪 Experiment Proposal: active=${s.experimentsActive} / diagnosticProposals7d=${s.diagnosticProposals7d} / autoApply=false / executionImpact=NONE`, `🤖 Gemini: month=${s.gemini.month} / callCount=${s.gemini.callCount} / tokensUsed=${s.gemini.tokensUsed} / useRatio=${s.gemini.useRatio} / schedulerStatus=${s.gemini.schedulerStatus} / recommendationOnly=${s.gemini.recommendationOnly}`, s.metricWarnings.length ? `⚠️ metricWarnings=${JSON.stringify(s.metricWarnings)}` : '', s.flags.length ? `🚩 진단 플래그: ${s.flags.join(', ')}` : '✅ 모든 채널 정상', s.partialFailure ? '⚠️ 데이터 일부 미확인 — 손상/누락 저장소가 있어 가능한 영역만 표시' : ''].filter(Boolean).join('\n');
}
export function formatLearningPulseMessage(s: ReturnType<typeof collectLearningPulse>): string {
  const freshShadowDisplay = deriveFreshShadowDisplay({
    marketSession: (s.freshShadowInlet as any).marketSession ?? 'CLOSED',
    freshSampleSize: s.freshPromotion.freshSampleSize,
    queuedNextOpenShadowScan: Boolean((s.freshShadowInlet as any).queuedNextOpenShadowScan),
    shadowScanLifecycleStatus: (s as any).shadowScanLifecycleStatus,
    lastShadowScanResult: (s.freshShadowInlet as any).lastShadowScanResult,
  });
  const counterfactualDisplay = deriveCounterfactualDisplay({
    nearestMaturityAt: s.counterfactualMaturity.nearestMaturityAt ?? undefined,
    labeledCount: s.counterfactual.labeledCount,
    resolvableNow: s.counterfactualResolver.resolvableNow,
  });
  const promotionBlocker = normalizePromotionBlocker({
    promotionAllowed: s.freshPromotion.promotionAllowed,
    counterfactualLabeledInputSamples: s.counterfactualLabeledInputSamples,
    counterfactualBuiltButUnlabeled: s.counterfactualBuiltButUnlabeled,
    counterfactualMaturityStatus: (s as any).counterfactualMaturityStatus,
    freshDisplayStatus: freshShadowDisplay.status,
    marketSession: (s.freshShadowInlet as any).marketSession ?? 'CLOSED',
    rawBlockers: s.freshPromotion.blockers,
  });
  const regimePromotionSplit = normalizeRegimePromotionSplit({
    corePromotionAllowed: (s.regimeLearning as any).corePromotionAllowed ?? false,
    regimePromotionAllowedForDiagnostic: (s.regimeLearning as any).regimePromotionAllowedForDiagnostic ?? true,
    regimePromotionAllowedForAdvisory: (s.regimeLearning as any).regimePromotionAllowedForAdvisory ?? true,
    counterfactualBuiltButUnlabeled: s.counterfactualBuiltButUnlabeled,
    counterfactualLabeledInputSamples: s.counterfactualLabeledInputSamples,
    counterfactualWaitingForMaturity: s.counterfactualWaitingForMaturity,
    counterfactualMaturityStatus: (s as any).counterfactualMaturityStatus,
    freshShadowDisplayStatus: freshShadowDisplay.status,
    freshShadowSeverity: freshShadowDisplay.severity as DisplaySeverity,
    activeRegime: s.regimeLearning.activeRegime,
    activeRegimeResolvedSampleSize: s.regimeLearning.activeRegimeResolvedSampleSize,
    requiredResolvedSampleSize: 100,
    activeRegimePendingCounterfactualCount: s.regimeLearning.activeRegimePendingCounterfactualCount,
    metricWarnings: s.metricWarnings,
    rawCorePromotionBlocker: (s.regimeLearning as any).corePromotionBlocker,
    rawSecondaryLearningBlockers: (s.regimeLearning as any).secondaryLearningBlockers,
    executionImpact: 'NONE',
  });
  const runtimePolicy = resolveEngineRuntimePolicy({
    engineMode: 'OBSERVE_ONLY',
    liveBuyGateAllowed: false,
    reasonCodes: ['LEARNING_PULSE_DIAGNOSTIC'],
  });
  const activeRegimeExpectancyR = s.regimeLearning.activeRegimeResolvedSampleSize === 0
    ? 'N/A'
    : String(s.regimeLearning.activeRegimeExpectancyR);
  const extra = [
    '1. Overall Learning Core',
    `status=${counterfactualDisplay.severity === 'ERROR' ? 'RESOLVER_ATTENTION_REQUIRED' : 'NORMAL_WAITING_MATURITY'} / executionImpact=NONE / operatorAction=${counterfactualDisplay.operatorAction}`,
    '2. Execution Policy',
    `finalExecutionPolicy=SHADOW_AND_DIAGNOSTIC_ONLY / liveEntryAllowed=false / shadowLearningAllowed=true / counterfactualAllowed=true / brokerOrderAllowed=false / reason=OBSERVE_ONLY_MODE`,
    '3. Fresh Shadow',
    `status=${freshShadowDisplay.status} / sampleSize=${s.freshPromotion.freshSampleSize} / reason=${freshShadowDisplay.reason} / severity=${freshShadowDisplay.severity} / operatorAction=${freshShadowDisplay.operatorAction}`,
    '4. Counterfactual',
    `built=${s.counterfactual.builtUniqueCount} / pending=${s.counterfactual.pendingOutcomeCount} / labelableNow=${s.counterfactualResolver.resolvableNow} / labeled=${s.counterfactual.labeledCount} / status=${counterfactualDisplay.status} / severity=${counterfactualDisplay.severity} / promotionBlocker=${counterfactualDisplay.blocker}`,
    '5. Gate Learning',
    `Gate3 status=${s.gate3LearningDisplay.displayStatus} / currentEvidenceStatus=${s.gate3LearningDisplay.currentEvidenceStatus} / lastValidCompletionScore=${s.gate3LearningDisplay.lastValidCompletionScore ?? 'N/A'} / lastValidLabeled=${s.gate3LearningDisplay.lastValidLabeled ?? 'N/A'} / currentCompletionScore=${s.gate3LearningDisplay.currentCompletionScore} / currentLabeled=${s.gate3LearningDisplay.currentLabeled} / lastValidSnapshotAvailable=${s.gate3LearningDisplay.lastValidSnapshotAvailable} / severity=${s.gate3LearningDisplay.displaySeverity} / operatorAction=${s.gate3LearningDisplay.operatorAction} / executionImpact=${s.gate3LearningDisplay.executionImpact}`,
    '6. Regime Learning',
    `activeRegime=${s.regimeLearning.activeRegime} / status=COLLECTING_PENDING_OUTCOMES / resolved=${s.regimeLearning.activeRegimeResolvedSampleSize}/100 / pending=${s.regimeLearning.activeRegimePendingCounterfactualCount} / severity=INFO`,
    '7. Promotion Readiness',
    `corePromotionAllowed=false / reason=NO_LABELED_COUNTERFACTUAL / advisoryPromotionAllowed=false / diagnosticAllowed=true`,
    '8. Advisory / Optional Warnings',
    `LOW_CONFIDENCE_REGIME_BACKFILL=display-only / GeminiScheduler=${s.geminiScheduler.schedulerStatus} recommendationOnly=${s.geminiScheduler.recommendationOnly}`,
    formatEngineRuntimePolicy(runtimePolicy),
    `🛡️ SafetyGate: enabled=${s.phase3A.safetyGate.enabled} / sampleSize=${s.phase3A.safetyGate.sampleSize} / status=${s.phase3A.safetyGate.status}`,
    `📐 ShadowLiveDelta: enabled=${s.phase3A.shadowLiveDelta.enabled} / lastRunAt=${s.phase3A.shadowLiveDelta.lastRunAt ?? 'N/A'} / status=${s.phase3A.shadowLiveDelta.status}`,
    `🌿 FreshnessGuard: enabled=${s.phase3A.freshnessGuard.enabled} / decayedCount=${s.phase3A.freshnessGuard.decayedCount} / status=${s.phase3A.freshnessGuard.status}`,
    `💾 PulseArchive: lastSavedAt=${s.phase3A.pulseArchive.lastSavedAt ?? 'N/A'} / todayCount=${s.phase3A.pulseArchive.todayCount}`,
    `Fresh Shadow Inlet: status=${(s.freshShadowInlet as any).marketSession === 'CLOSED' && (s.freshShadowInlet as any).queuedNextOpenShadowScan ? 'SCHEDULED_NEXT_OPEN' : ((s.freshShadowInlet as any).shadowInletStatus ?? s.freshShadowInlet.nextAction)} / marketSession=${(s.freshShadowInlet as any).marketSession ?? ((s.freshShadowInlet as any).marketOpen === false ? 'CLOSED' : 'OPEN')} / liveBlocker=${s.freshShadowInlet.liveBlocker ?? 'NONE'} / queuedNextOpenShadowScan=${String((s.freshShadowInlet as any).queuedNextOpenShadowScan ?? false)} / nextShadowScanAt=${(s.freshShadowInlet as any).nextShadowScanAt ?? 'N/A'} / nextOpenShadowScanStatus=${(s.freshShadowInlet as any).nextOpenShadowScanStatus ?? 'N/A'} / shadowScanLifecycleStatus=${(s as any).shadowScanLifecycleStatus ?? 'N/A'} / lastShadowScanCandidateCount=${(s.freshShadowInlet as any).lastShadowScanCandidateCount ?? 0} / lastShadowScanResult=${(s.freshShadowInlet as any).lastShadowScanResult ?? 'N/A'} / interpretation=${(s.freshShadowInlet as any).marketSession === 'CLOSED' && (s.freshShadowInlet as any).queuedNextOpenShadowScan ? 'Market is closed; next fresh shadow scan is scheduled' : 'Inlet active'} / executionImpact=${s.freshShadowInlet.executionImpact}`,
    `Fresh Shadow Raw Diagnostic: freshExpectancyRawReason=${s.freshPromotion.freshExpectancyReason ?? 'OK'} / freshLifecycleBreaks=${s.freshShadow.lifecycleBreaks} / rawPromotionBlocker=${s.freshPromotion.blocker} / rawPromotionBlockers=${JSON.stringify(s.freshPromotion.blockers)}`,
    `Fresh Shadow Zero Detail: freshSampleSize=${s.freshPromotion.freshSampleSize} / noFreshReason=${s.noFreshReason} / shadowLearningLane=${s.shadowLearningLane} / R6CounterfactualPending=${s.regimeLearning.R6PendingCounterfactualCount} / R6ResolvedSampleGate=${s.regimeLearning.R6ResolvedSampleSize}/${s.regimeLearning.R6ResolvedPromotionMin} / R6PromotionBlocker=${s.regimeLearning.R6PromotionBlocker}`,
    `Status Split: freshShadowStatus=${(s as any).freshShadowStatus} / counterfactualMaturityStatus=${(s as any).counterfactualMaturityStatus} / promotionReadinessStatus=${(s as any).promotionReadinessStatus} / systemHealth=${(s as any).systemHealth} / operatorAction=${(s as any).operatorAction} / executionImpact=NONE`,
    `Regime Learning v6: activeRegime=${s.regimeLearning.activeRegime} / rawRegime=${s.regimeLearning.rawRegime} / effectiveRegime=${s.regimeLearning.effectiveRegime} / shadowLearningAllowed=${s.regimeLearning.shadowLearningAllowed} / regimeLearningSampleSize=${s.regimeLearning.regimeLearningSampleSize} / regimeAssignedCount=${s.regimeLearning.regimeAssignedCount} / unknownRegimeCount=${s.regimeLearning.unknownRegimeCount} / unknownRatioRaw=${(s.regimeLearning as any).unknownRatioRaw ?? s.regimeLearning.unknownRatio} / recoveredLowConfidenceRegimeCount=${(s.regimeLearning as any).recoveredLowConfidenceRegimeCount ?? 0} / recoveredLowConfidenceRegimeRatio=${(s.regimeLearning as any).recoveredLowConfidenceRegimeRatio ?? 0} / trueUnknownRegimeCount=${(s.regimeLearning as any).trueUnknownRegimeCount ?? s.regimeLearning.unknownRegimeCount} / trueUnknownRatio=${(s.regimeLearning as any).trueUnknownRatio ?? s.regimeLearning.unknownRatio} / regimeRatioDenominator=${(s.regimeLearning as any).regimeRatioDenominator ?? 'regimeLearningSampleSize'} / regimeRatioDenominatorValue=${(s.regimeLearning as any).regimeRatioDenominatorValue ?? s.regimeLearning.regimeLearningSampleSize} / unknownRatio=${s.regimeLearning.unknownRatio} / regimeDuplicateCandidates=${(s.regimeLearning as any).regimeDuplicateCandidates ?? 0} / regimeDuplicateSuppressed=${(s.regimeLearning as any).regimeDuplicateSuppressed ?? 0} / regimeDuplicatePreventedAtSource=${(s.regimeLearning as any).regimeDuplicatePreventedAtSource ?? 0} / regimeDuplicateSuppressedAfterInsert=${(s.regimeLearning as any).regimeDuplicateSuppressedAfterInsert ?? 0} / regimeDedupStatus=${(s.regimeLearning as any).regimeDedupStatus ?? 'NONE'} / bestRegimeByExpectancy=${s.regimeLearning.bestRegimeByExpectancy ?? 'N/A'} / worstRegimeByExpectancy=${s.regimeLearning.worstRegimeByExpectancy ?? 'N/A'} / activeRegimeSampleSize=${s.regimeLearning.activeRegimeSampleSize} / activeRegimeTotalSampleSize=${s.regimeLearning.activeRegimeTotalSampleSize} / activeRegimeResolvedSampleSize=${s.regimeLearning.activeRegimeResolvedSampleSize} / activeRegimePendingCounterfactualCount=${s.regimeLearning.activeRegimePendingCounterfactualCount} / activeRegimeAttributableSampleSize=${s.regimeLearning.activeRegimeAttributableSampleSize} / activeRegimeExpectancyR=${activeRegimeExpectancyR} / activeRegimeQualityStatus=${s.regimeLearning.activeRegimeQualityStatus} / activeRegimeWhyNotReliable=${s.regimeLearning.activeRegimeWhyNotReliable} / activeRegimeTopPattern=${s.regimeLearning.activeRegimeTopPattern} / activeRegimeLearningNeed=${s.regimeLearning.activeRegimeLearningNeed} / R2ResolvedSampleSize=${s.regimeLearning.R2ResolvedSampleSize} / R2PendingCounterfactual=${s.regimeLearning.R2PendingCounterfactualCount} / R3ResolvedSampleSize=${s.regimeLearning.R3ResolvedSampleSize} / R3PendingCounterfactual=${s.regimeLearning.R3PendingCounterfactualCount} / R6ResolvedSampleSize=${s.regimeLearning.R6ResolvedSampleSize} / R6PendingCounterfactual=${s.regimeLearning.R6PendingCounterfactualCount} / regimeBackfillTargetUnknownCount=${(s.regimeLearning as any).regimeBackfillTargetUnknownCount ?? s.regimeLearning.unknownRegimeCount} / regimeBackfillAttemptedTotal=${(s.regimeLearning as any).regimeBackfillAttemptedTotal ?? (s.regimeLearning as any).regimeBackfillAttempted ?? 0} / regimeBackfillAttemptedUnique=${(s.regimeLearning as any).regimeBackfillAttemptedUnique ?? 0} / regimeBackfillAttemptedDuplicates=${(s.regimeLearning as any).regimeBackfillAttemptedDuplicates ?? 0} / attemptedOverTargetReason=${(s.regimeLearning as any).attemptedOverTargetReason ?? 'NONE'} / regimeBackfillAttempted=${(s.regimeLearning as any).regimeBackfillAttempted ?? 0} / regimeBackfillRecovered=${(s.regimeLearning as any).regimeBackfillRecovered ?? 0} / regimeBackfillFailed=${(s.regimeLearning as any).regimeBackfillFailed ?? 0} / regimeBackfillWindowMinutes=${(s.regimeLearning as any).regimeBackfillWindowMinutes ?? 60} / regimeBackfillRecoveredBySource=${JSON.stringify((s.regimeLearning as any).regimeBackfillRecoveredBySource ?? {})} / regimeBackfillRecoveredByConfidence=${JSON.stringify((s.regimeLearning as any).regimeBackfillRecoveredByConfidence ?? {})} / regimeBackfillFailedAfterDailyFallback=${(s.regimeLearning as any).regimeBackfillFailedAfterDailyFallback ?? (s.regimeLearning as any).regimeBackfillFailed ?? 0} / regimeBackfillFailureTopReasonsAfterDailyFallback=${JSON.stringify((s.regimeLearning as any).regimeBackfillFailureTopReasonsAfterDailyFallback ?? [])} / regimeBackfillFailureTopReasons=${JSON.stringify((s.regimeLearning as any).regimeBackfillFailureTopReasons ?? [])} / regimeBackfillFailureBySourceLane=${JSON.stringify((s.regimeLearning as any).regimeBackfillFailureBySourceLane ?? {})} / regimeBackfillFailureByTimestampSource=${JSON.stringify((s.regimeLearning as any).regimeBackfillFailureByTimestampSource ?? {})} / regimeBackfillFailureByTradingDate=${JSON.stringify((s.regimeLearning as any).regimeBackfillFailureByTradingDate ?? {})} / regimeSnapshotCoverageByTradingDate=${JSON.stringify((s.regimeLearning as any).regimeSnapshotCoverageByTradingDate ?? {})} / missingRegimeSnapshotDates=${JSON.stringify((s.regimeLearning as any).missingRegimeSnapshotDates ?? [])} / dailyRegimeFallbackStatus=${(s.regimeLearning as any).dailyRegimeFallbackStatus ?? 'OK'} / regimeBackfillFailureSampleKeys=${JSON.stringify((s.regimeLearning as any).regimeBackfillFailureSampleKeys ?? [])} / regimeDuplicateSourceTop3=${JSON.stringify((s.regimeLearning as any).regimeDuplicateSourceTop3 ?? [])} / regimeDuplicateKeySample=${JSON.stringify((s.regimeLearning as any).regimeDuplicateKeySample ?? [])} / regimeDuplicateRootCause=${(s.regimeLearning as any).regimeDuplicateRootCause ?? 'NONE'} / nextRegimeMaturityAt=${s.regimeLearning.nextRegimeMaturityAt ?? 'N/A'} / regimesNeedingAttributionRecalc=${JSON.stringify(s.regimeLearning.regimesNeedingAttributionRecalc ?? [])} / regimeLearningNextAction=${s.regimeLearning.regimeLearningNextAction} / nextRegimeLearningAction=${s.regimeLearning.nextRegimeLearningAction}`,
    `Regime Snapshot Reconstruction: regimeSnapshotReconstructionAttemptedDates=${JSON.stringify((s.regimeLearning as any).regimeSnapshotReconstructionAttemptedDates ?? [])} / regimeSnapshotReconstructionSucceededDates=${JSON.stringify((s.regimeLearning as any).regimeSnapshotReconstructionSucceededDates ?? [])} / regimeSnapshotReconstructionFailedDates=${JSON.stringify((s.regimeLearning as any).regimeSnapshotReconstructionFailedDates ?? [])} / regimeSnapshotReconstructionSourceBreakdown=${JSON.stringify((s.regimeLearning as any).regimeSnapshotReconstructionSourceBreakdown ?? {})} / regimeSnapshotReconstructionConfidenceBreakdown=${JSON.stringify((s.regimeLearning as any).regimeSnapshotReconstructionConfidenceBreakdown ?? {})}`,
    `Regime Source Inventory: regimeSourceInventoryByDate=${JSON.stringify((s.regimeLearning as any).regimeSourceInventoryByDate ?? {})} / regimeSourceInventoryTopAvailable=${JSON.stringify((s.regimeLearning as any).regimeSourceInventoryTopAvailable ?? [])} / regimeSourceInventoryMissingSources=${JSON.stringify((s.regimeLearning as any).regimeSourceInventoryMissingSources ?? {})} / regimeSourceInventoryAuditStatus=${(s.regimeLearning as any).regimeSourceInventoryAuditStatus ?? 'NO_MISSING_DATES'} / regimeSnapshotReconstructionPriorityDate=${(s.regimeLearning as any).regimeSnapshotReconstructionPriorityDate ?? '2026-05-13'} / priorityDateReconstructionStatus=${(s.regimeLearning as any).priorityDateReconstructionStatus ?? 'NOT_ATTEMPTED'} / priorityDateRecoveredSampleCount=${(s.regimeLearning as any).priorityDateRecoveredSampleCount ?? 0} / priorityDateFailureReason=${(s.regimeLearning as any).priorityDateFailureReason ?? 'NOT_ATTEMPTED'} / postReconstructionTrueUnknownRatio=${(s.regimeLearning as any).postReconstructionTrueUnknownRatio ?? (s.regimeLearning as any).trueUnknownRatio ?? s.regimeLearning.unknownRatio} / regimePromotionStillBlocked=${(s.regimeLearning as any).regimePromotionStillBlocked ?? true} / regimePromotionBlockReason=${(s.regimeLearning as any).regimePromotionBlockReason ?? 'REGIME_PROMOTION_BLOCKED_TRUE_UNKNOWN_RATIO_HIGH'}`,
    `Regime Promotion Split: regimePromotionAllowedForDiagnostic=${regimePromotionSplit.regimePromotionAllowedForDiagnostic} / regimePromotionAllowedForAdvisory=${regimePromotionSplit.regimePromotionAllowedForAdvisory} / corePromotionAllowed=${regimePromotionSplit.corePromotionAllowed} / corePromotionBlocker=${regimePromotionSplit.corePromotionBlocker} / corePromotionBlockerReason=${regimePromotionSplit.corePromotionBlockerReason} / corePromotionSeverity=${regimePromotionSplit.corePromotionSeverity} / suggestPromotionBlocker=${regimePromotionSplit.suggestPromotionBlocker} / primaryLearningBlocker=${regimePromotionSplit.primaryLearningBlocker} / secondaryLearningBlockers=${JSON.stringify(regimePromotionSplit.secondaryLearningBlockers)} / displayOnlyBlockers=${JSON.stringify(regimePromotionSplit.displayOnlyBlockers)} / advisoryOnlyBlockers=${JSON.stringify(regimePromotionSplit.advisoryOnlyBlockers)} / rawDiagnosticBlockers=${JSON.stringify(regimePromotionSplit.rawDiagnosticBlockers)} / freshShadowDisplayStatus=${regimePromotionSplit.freshShadowDisplayStatus} / freshShadowSeverity=${regimePromotionSplit.freshShadowSeverity} / executionImpact=${regimePromotionSplit.executionImpact} / nextRequiredEvent=${(s.regimeLearning as any).nextRequiredEvent ?? 'COUNTERFACTUAL_MATURITY_OR_NEXT_OPEN_SHADOW_SCAN'}`,
    `Regime Backfill Explain: regimeBackfillFailedPromotionEligibleCount=${(s.regimeLearning as any).regimeBackfillFailedPromotionEligibleCount ?? 0} / regimeBackfillFailedExcludedCount=${(s.regimeLearning as any).regimeBackfillFailedExcludedCount ?? 0} / regimeBackfillFailedExcludedByLane=${JSON.stringify((s.regimeLearning as any).regimeBackfillFailedExcludedByLane ?? {})} / regimeBackfillFailedExcludedReason=${(s.regimeLearning as any).regimeBackfillFailedExcludedReason ?? 'NONE'} / recoveredFromOriginalUnknownCount=${(s.regimeLearning as any).recoveredFromOriginalUnknownCount ?? 0} / recoveredFromAdditionalRepairLaneCount=${(s.regimeLearning as any).recoveredFromAdditionalRepairLaneCount ?? 0} / recoveredTotalCount=${(s.regimeLearning as any).recoveredTotalCount ?? 0}`,
    `Counterfactual Metadata Repair: metadataRepairStatus=${(s.counterfactualMetadataRepair as any).metadataRepairStatus ?? (s.counterfactualMetadataRepair as any).incrementalRepairStatus} / recoverySourceBreakdown=${JSON.stringify(s.counterfactualMetadataRepair.recoverySourceBreakdown)} / recoveryConfidenceBreakdown=${JSON.stringify(s.counterfactualMetadataRepair.recoveryConfidenceBreakdown)} / counterfactualMetadataMissingByField=${JSON.stringify((s.counterfactualMetadataRepair as any).counterfactualMetadataMissingByField ?? {})} / counterfactualMetadataMissingBySourceLane=${JSON.stringify((s.counterfactualMetadataRepair as any).counterfactualMetadataMissingBySourceLane ?? {})} / counterfactualMetadataMissingSampleKeys=${JSON.stringify((s.counterfactualMetadataRepair as any).counterfactualMetadataMissingSampleKeys ?? [])} / counterfactualMetadataMissingFirstSeenAt=${(s.counterfactualMetadataRepair as any).counterfactualMetadataMissingFirstSeenAt ?? 'N/A'} / recoveredLowCount=${s.counterfactualMetadataRepair.recoveryConfidenceBreakdown.RECOVERED_LOW ?? 0} / coreEligibleRecoveredLowCount=0 / advisoryEligibleRecoveredLowCount=${s.counterfactualMetadataRepair.recoveryConfidenceBreakdown.RECOVERED_LOW ?? 0} / metadataConfidenceHaircutApplied=true`,
    `Suggest Blockers: counterfactualBuiltButUnlabeled=${s.counterfactualBuiltButUnlabeled} / counterfactualLabeledInputSamples=${s.counterfactualLabeledInputSamples} / counterfactualWaitingForMaturity=${s.counterfactualWaitingForMaturity} / counterfactualMetadataMissing=${s.counterfactualMetadataMissing} / suggestInputSamples=${s.suggestInputSamples} / primaryBlocker=${s.suggest.primaryBlocker} / secondaryBlockers=${JSON.stringify(s.suggest.secondaryBlockers)} / status=${s.suggest.status}`,
    `Counterfactual Maturity: maturityStatus=${s.counterfactualMaturity.maturityStatus} / maturedNowCount=${s.counterfactualMaturity.maturedNowCount} / waitingForHoldingPeriod=${s.counterfactualMaturity.waitingCount} / overdueCount=${s.counterfactualMaturity.overdueCount} / nearestMaturityBucket=${s.counterfactualMaturity.nearestMaturityBucket} / nearestMaturityAt=${s.counterfactualMaturity.nearestMaturityAt ?? 'N/A'} / firstBuildEventAt=${(s as any).firstBuildEventAt ?? 'N/A'} / firstCounterfactualCreatedAt=${(s as any).firstCounterfactualCreatedAt ?? 'N/A'} / counterfactualMaturityAt=${(s as any).counterfactualMaturityAt ?? 'N/A'} / nextResolveAt=${(s as any).nextResolveAt ?? s.counterfactualMaturity.nextResolveAt ?? 'N/A'} / remainingCalendarDays=${s.counterfactualMaturity.remainingCalendarDaysToNearestMaturity ?? 'N/A'} / remainingTradingDays=${s.counterfactualMaturity.remainingTradingDaysToNearestMaturity ?? 'N/A'} / largestMaturityBucket=${s.counterfactualMaturity.largestMaturityBucket} / largestMaturityBucketCount=${s.counterfactualMaturity.largestMaturityBucketCount} / bucketSumMatchesPending=${s.counterfactualMaturity.bucketSumMatchesPending} / resolverSchedulerStatus=${s.counterfactualMaturity.schedulerStatus}`,
    `Counterfactual Resolver: resolverStatus=${s.counterfactualResolver.resolverStatus} / scannedBuiltUnique=${s.counterfactualResolver.scannedBuiltUnique} / pendingOutcomeCount=${s.counterfactualResolver.pendingOutcomeCount} / pendingOutcomeTotalCount=${(s as any).pendingOutcomeTotalCount} / pendingOutcomeEligibleCount=${(s as any).pendingOutcomeEligibleCount} / quarantinedPendingCount=${(s as any).quarantinedPendingCount} / resolvableNow=${s.counterfactualResolver.resolvableNow} / expectedLabelable=${s.counterfactualResolver.expectedLabelable} / expectedStillPending=${s.counterfactualResolver.expectedStillPending} / labelBreakdown=${JSON.stringify(s.counterfactualResolver.labelBreakdown)} / executionImpact=${s.counterfactualResolver.executionImpact}`,
    `Counterfactual Metrics: duplicateSuppressionStatus=${s.counterfactual.duplicateSuppressionStatus} / metricInfos=${JSON.stringify(s.metricInfos)} / metricWarnings=${JSON.stringify(s.metricWarnings)}`,
    `Cohort Snapshot: snapshotStatus=${s.cohortSnapshotStatus} / cohortSumMatchesTotal=${s.cohortConsistency.cohortSumMatchesTotal} / ghostRepairReflectedInPulse=${s.cohortConsistency.ghostRepairReflectedInPulse} / cohortSnapshotAgeSec=${(s as any).cohortSnapshotAgeSec ?? 'N/A'} / cohortSnapshotMaxAgeSec=${(s as any).cohortSnapshotMaxAgeSec ?? 'N/A'} / cohortSnapshotRefreshedAt=${(s as any).cohortSnapshotRefreshedAt ?? 'N/A'} / cohortSnapshotRefreshStatus=${(s as any).cohortSnapshotRefreshStatus ?? 'N/A'} / cohortSnapshotRefreshFailureReason=${(s as any).cohortSnapshotRefreshFailureReason ?? 'N/A'}`,
    `Gemini Scheduler: advisorySchedulerStatus=${s.geminiScheduler.schedulerStatus} / advisorySchedulerWarning=missedCount:${s.geminiScheduler.missedCount} / learningCoreImpact=NONE / executionImpact=NONE / promotionImpact=NONE / lastScheduledAt=${s.geminiScheduler.lastScheduledAt ?? 'N/A'} / lastRunAt=${s.geminiScheduler.lastRunAt ?? 'N/A'} / nextScheduledAt=${s.geminiScheduler.nextScheduledAt ?? 'N/A'} / recommendationOnly=${s.geminiScheduler.recommendationOnly}`,
    formatGate3LearningFinalizationSection(s.gate3LearningFinalization) ?? '',
    `Gate3 Evidence Fallback: displayStatus=${s.gate3LearningDisplay.displayStatus} / currentEvidenceStatus=${s.gate3LearningDisplay.currentEvidenceStatus} / currentOutcomeSeeds=${s.gate3LearningDisplay.currentOutcomeSeeds} / currentLabeled=${s.gate3LearningDisplay.currentLabeled} / currentPending=${s.gate3LearningDisplay.currentPending} / currentThresholdEvidenceSampleSize=${s.gate3LearningDisplay.currentThresholdEvidenceSampleSize} / currentCompletionScore=${s.gate3LearningDisplay.currentCompletionScore} / lastValidSnapshotAvailable=${s.gate3LearningDisplay.lastValidSnapshotAvailable} / lastValidSnapshotId=${s.gate3LearningDisplay.lastValidSnapshotId ?? 'N/A'} / lastValidAt=${s.gate3LearningDisplay.lastValidAt ?? 'N/A'} / lastValidOutcomeSeeds=${s.gate3LearningDisplay.lastValidOutcomeSeeds ?? 'N/A'} / lastValidLabeled=${s.gate3LearningDisplay.lastValidLabeled ?? 'N/A'} / lastValidPending=${s.gate3LearningDisplay.lastValidPending ?? 'N/A'} / lastValidThresholdEvidenceSampleSize=${s.gate3LearningDisplay.lastValidThresholdEvidenceSampleSize ?? 'N/A'} / lastValidCompletionScore=${s.gate3LearningDisplay.lastValidCompletionScore ?? 'N/A'} / lastValidStatus=${s.gate3LearningDisplay.lastValidStatus ?? 'N/A'} / evidenceReady=${s.gate3LearningDisplay.evidenceReady} / displaySeverity=${s.gate3LearningDisplay.displaySeverity} / operatorAction=${s.gate3LearningDisplay.operatorAction} / executionImpact=${s.gate3LearningDisplay.executionImpact} / rawCurrentStatus=${s.gate3LearningDisplay.rawCurrentStatus ?? 'N/A'} / rawWarnings=${JSON.stringify(s.gate3LearningDisplay.rawWarnings ?? [])}`,
    formatGate3EvidenceWarmupSection(s.gate3LearningFinalization.evidenceWarmup) ?? '',
  ].join('\n');
  return `${formatLearningPulseMessageBase(s, freshShadowDisplay, promotionBlocker)}\n${extra}`;
}
const learningPulse: TelegramCommand = { name: '/learning_pulse', aliases: ['/lp'], category: 'LRN', visibility: 'ADMIN', riskLevel: 0, description: '학습 루프 v5 진단 (fresh/counterfactual/fresh-only promotion)', async execute({ reply }) { try { const pulseResult = collectLearningPulse(); let pulseArchive = pulseResult.phase3A.pulseArchive; try { pulseArchive = appendLearningPulseArchive(pulseResult); } catch (e) { console.warn('[LearningPulse] archive 저장 실패 (비치명적):', e); } await reply(formatLearningPulseMessage({ ...pulseResult, phase3A: { ...pulseResult.phase3A, pulseArchive } })); } catch (e) { await reply(`⚠️ /learning_pulse 실패: ${e instanceof Error ? e.message : String(e)}`); } } };
commandRegistry.register(learningPulse);
export default learningPulse;
