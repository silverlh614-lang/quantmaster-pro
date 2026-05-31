/**
 * @responsibility ADR-461 Post-Rollout Runtime Pipeline Audit.
 *
 * Read-only diagnostic snapshot for ADR-450~459 rollout verification. It does not implement
 * ADR-460/Live Overlay and does not call external APIs or order modules.
 */
import { getEmergencyStop, getExecutionMode } from '../state.js';
import {
  DEFAULT_DATA_PROMOTION_STATUS,
  getLastScanSummary,
  type DataPromotionStatus,
  type PipelineStageDropoffSummary,
} from '../trading/signalScanner/scanDiagnostics.js';
import { loadWatchlist } from '../persistence/watchlistRepo.js';
// ADR-0367: buyListLoop 진입 전 preflight 차단 진단 SSOT.
import {
  getLastPreflightBlockedScanSummary,
  type PreflightBlockedScanSummary,
} from '../trading/signalScanner/preflightBlockedScanSummary.js';
import { getLastInvestorFlowProviderHealth } from '../supply/investorFlowProviderHealth.js';
import { getAllNearMissOutcomes } from '../persistence/nearMissOutcomeLedger.js';
import { loadGateReclassificationDryRunRecords } from '../persistence/gateReclassificationDryRunRepo.js';
import { loadGateReclassificationRolloutPlan } from '../persistence/gateReclassificationRolloutRepo.js';
import { runLivePathSafetyAudit } from './livePathSafetyAudit.js';
import {
  collectOperatorActionSourcesFromScanSummaryAdr0480,
  safeBuildOperatorActionQueueAdr0480,
  formatRuntimePipelineDiagnosticEvidenceLineAdr0480,
} from '../trading/signalScanner/operatorActionRouterAdr0480.js';
import { formatRuntimePipelineReadinessEvidenceLineAdr0485 } from '../trading/signalScanner/supplyAdvisoryReadinessAdr0485.js';
import { formatRuntimePipelineMountEvidenceLineAdr0486 } from '../trading/signalScanner/supplyRecoveryRuntimeMountAdr0486.js';
import { formatRuntimePipelineFreshDataEvidenceLineAdr0487 } from '../trading/signalScanner/freshDataSupplyLayerAdr0487.js';
import { formatRuntimePipelineAdr0488EvidenceLine } from '../trading/signalScanner/sectorEnergyMasterSupplyUnknownPolicyAdr0488.js';
import { getGate1DryRunObservationLedgerCount } from '../trading/signalScanner/gate1DryRunObservationLedgerAdr0476.js';
import { formatSupplySnapshotDetailAdr0491 } from '../trading/signalScanner/supplySnapshotStoreReplayAdr0491.js';
import {
  buildPromotionAuditInputForDataLineAdr0494,
  evaluateFreshDataPromotionAuditsAdr0494,
  summarizeFreshDataPromotionAuditsAdr0494,
} from '../trading/signalScanner/freshDataPromotionAuditWiringAdr0494.js';
import {
  mapRuntimeFreshDataSummaryToStatusInputsAdr0498,
  safeBuildFreshDataStatusSectionAdr0498,
  type FreshDataStatusViewModelInputAdr0498,
} from './freshDataStatusViewModelWiringAdr0498.js';
import type { FreshDataStatusViewModelAdr0497 } from './diagnosticTaxonomyAdr0497.js';
import {
  buildEmptyScanRootCauseEventsFromStringsAdr0500,
  formatEmptyScanRootCauseCompactAdr0500,
  safeBuildEmptyScanRootCauseDashboardAdr0500,
  type EmptyScanRootCauseDashboardAdr0500,
} from './emptyScanRootCauseDashboardAdr0500.js';
import {
  buildWeekendReplayRecordsFromStringsAdr0501,
  formatWeekendReplayCompactAdr0501,
  safeBuildWeekendReplaySummaryAdr0501,
  type WeekendReplaySummaryAdr0501,
} from './weekendReplayAdr0501.js';

export type RuntimePipelineStage =
  | 'NOT_RUN'
  | 'SCAN_REQUESTED'
  | 'PREFLIGHT'
  | 'BEFORE_BUYLIST_LOOP'
  | 'BUYLIST_LOOP_ENTERED'
  | 'GATE_EVALUATED'
  | 'NEAR_MISS_BUCKETED'
  | 'OUTCOME_LEDGER_WRITTEN'
  | 'DRY_RUN_EVALUATED'
  | 'ROLLOUT_EVALUATED'
  | 'SCAN_SUMMARY_PERSISTED'
  | 'UNKNOWN';

export type RuntimePipelineBlockReason =
  | 'SELL_ONLY_SESSION'
  | 'AUTO_TRADE_DISABLED'
  | 'POSITION_FULL'
  | 'WATCHLIST_EMPTY'
  | 'HARD_BLOCK'
  | 'SUPPLY_PROVIDER_NO_SAMPLE'
  | 'SECTOR_ENERGY_DEGRADED'
  | 'SECTOR_ENERGY_LEADERSHIP_BLOCKED'
  | 'MACRO_RISK_BLOCK'
  | 'MARKET_CLOSED'
  | 'BUYLIST_NOT_REACHED'
  | 'BUYLIST_NOT_REACHED_PRE_FLIGHT_BLOCKED'
  | 'NO_GATE_SAMPLES'
  | 'NO_NEAR_MISS_SAMPLES'
  | 'NO_APPROVED_RECLASSIFICATION_ITEMS'
  | 'NO_DRY_RUN_RECORDS'
  | 'NO_ROLLOUT_ITEMS'
  | 'ADR_460_NOT_INSTALLED'
  | 'UNKNOWN';

export interface RuntimePipelineAuditSnapshot {
  generatedAt: string;
  // ADR-0528 carry: canonical sourceSnapshotId of the cycle this audit reflects so that
  // preflight-blocked current cycle is not confused with past dry-run/aggregate state.
  sourceSnapshotId: string;
  lastScanAt?: string | null;
  marketSession: string;
  engineMode: string;
  autoTradeEnabled: boolean | null;
  sellOnlyActive: boolean;
  emergencyStop: boolean | null;
  latestStage: RuntimePipelineStage;
  blockedBy: RuntimePipelineBlockReason[];
  candidateSummaryCount: number;
  watchlistCount: number | null;
  buyListLoopEntered: boolean;
  scanSummaryPersisted: boolean;
  preflightSummaryPersisted: boolean;
  gateScoreHealthSamples: number;
  gate1PassCount: number;
  gate2PassCount: number;
  gate3PassCount: number;
  liveEligibleCount: number;
  shadowObservableCount: number;
  dataUnavailableBlockCount: number;
  providerDegradedBlockCount: number;
  strongBuySuppressedByDataUnavailableCount: number;
  topGate1BlockReasons: Array<{ reason: string; count: number }>;
  topGate2BlockReasons: Array<{ reason: string; count: number }>;
  topGate3BlockReasons: Array<{ reason: string; count: number }>;
  dataPromotionStatus: DataPromotionStatus;
  perStageDropoffSummary: PipelineStageDropoffSummary[];
  nearMissBucketSamples: number;
  nearMissOutcomeLedgerCount: number;
  dryRunRecordCount: number;
  rolloutItemCount: number;
  operatorActionEvidenceCount: number;
  operatorActionDiagnosticLine: string;
  supplyAdvisoryReadinessDiagnosticLine: string;
  supplyRecoveryMountDiagnosticLine: string;
  freshDataSupplyDiagnosticLine: string;
  sectorEnergySupplyUnknownDiagnosticLine: string;
  supplySnapshotStoreDiagnosticLine: string;
  promotionAuditSummary: string;
  promotionAuditBlockers: string[];
  promotionAuditReadyLines: string[];
  promotionAuditBlockedLines: string[];
  freshDataStatusViewModels?: FreshDataStatusViewModelAdr0497[];
  freshDataStatusCompactLines?: string[];
  freshDataStatusNormalizedCount?: number;
  emptyScanRootCause?: EmptyScanRootCauseDashboardAdr0500;
  emptyScanRootCauseCompact?: string;
  weekendReplaySummary?: WeekendReplaySummaryAdr0501;
  weekendReplayCompact?: string;
  adr460Installed: false;
  supplyProviderHealth: { hasRecentSample: boolean; message: string };
  sectorEnergyHealth: {
    dataQuality?: string;
    indexCodeCoverage?: number;
    missingIndexCodeCount?: number;
    leadershipConfidence?: string;
    executionHardBlock?: boolean;
    message: string;
  };
  livePathSafety: {
    kisOrderImportDetected: boolean;
    normalizedGateScoreLiveDecisionDetected: boolean;
    createLiveOrderTrueDetected: boolean;
    executionImpactFullOrPartialDetected: boolean;
    gateThresholdMutationDetected: boolean;
    kellyMutationDetected: boolean;
    coreRolloutDetected: boolean;
    passed: boolean;
    findings: string[];
  };
  operatorMessage: string;
}

export function isRuntimePipelineAuditDisabled(): boolean {
  return process.env.RUNTIME_PIPELINE_AUDIT_DISABLED === 'true';
}

function addReason(reasons: RuntimePipelineBlockReason[], reason: RuntimePipelineBlockReason): void {
  if (!reasons.includes(reason)) reasons.push(reason);
}

// ADR-0528 carry: same canonical resolution order as runtimeResolverTraceStep26.sourceSnapshotIdOf,
// extended with the preflight-blocked summary so a buyListLoop-preflight-blocked current cycle still
// carries its own scanId instead of falling back to NO_SCAN_SUMMARY (display-only, executionImpact=NONE).
function resolveCanonicalSourceSnapshotId(
  summary: ReturnType<typeof getLastScanSummary>,
  preflightBlocked: PreflightBlockedScanSummary | null,
): string {
  return (
    summary?.snapshotId ??
    summary?.scanEvaluation?.scanId ??
    (summary?.time ? `scan-summary:${summary.time}` : undefined) ??
    preflightBlocked?.scanEvaluation?.scanId ??
    preflightBlocked?.scanId ??
    'NO_SCAN_SUMMARY'
  );
}

function inferMarketSession(summary: ReturnType<typeof getLastScanSummary>): string {
  if (!summary) return 'UNKNOWN';
  if (summary.macroGateState?.sellOnlyMode) return 'SELL_ONLY';
  return 'UNKNOWN';
}

function countNearMissBuckets(summary: ReturnType<typeof getLastScanSummary>): number {
  const buckets = summary?.gateScoreCandidateBuckets;
  if (!buckets) return 0;
  if (Number.isFinite(buckets.totalNearMissLike)) return buckets.totalNearMissLike;
  return Object.entries(buckets.counts ?? {})
    .filter(([bucket]) => bucket === 'DATA_BLOCKED_NEAR_MISS' || bucket === 'PROBING' || bucket === 'SHADOW_ONLY')
    .reduce((sum, [, count]) => sum + (Number.isFinite(count) ? count : 0), 0);
}

function buildSupplyProviderHealth(): { hasRecentSample: boolean; message: string } {
  try {
    const samples = getLastInvestorFlowProviderHealth();
    const hasRecentSample = samples.length > 0;
    return {
      hasRecentSample,
      message: hasRecentSample
        ? `provider health samples=${samples.length}; diagnostic only.`
        : 'provider sample missing, not market bearish signal',
    };
  } catch {
    return { hasRecentSample: false, message: 'provider sample missing, not market bearish signal' };
  }
}

function buildSectorEnergyHealth(summary: ReturnType<typeof getLastScanSummary>): RuntimePipelineAuditSnapshot['sectorEnergyHealth'] {
  const diag = summary?.sectorEnergyQualityDiagnostic;
  if (diag) {
    const leadershipConfidence = diag.shouldBlockLeadershipConfidence ? 'BLOCKED' : 'OK';
    return {
      dataQuality: diag.dataQuality,
      indexCodeCoverage: diag.indexCodeCoverage,
      missingIndexCodeCount: diag.missingIndexCodeCount,
      leadershipConfidence,
      executionHardBlock: false,
      message: diag.dataQuality === 'OK'
        ? 'SectorEnergy dataQuality OK; diagnostic only.'
        : 'SectorEnergy DEGRADED/STALE/BLOCKED diagnostic only, not engine hard block',
    };
  }
  if (summary?.sectorEnergyQuality) {
    return {
      dataQuality: summary.sectorEnergyQuality,
      executionHardBlock: false,
      message: summary.sectorEnergyQuality === 'OK'
        ? 'SectorEnergy quality OK; diagnostic only.'
        : 'SectorEnergy DEGRADED/STALE/BLOCKED diagnostic only, not engine hard block',
    };
  }
  return { executionHardBlock: false, message: 'SectorEnergy sample unavailable; diagnostic only, not engine hard block' };
}

function deriveStage(input: {
  summary: ReturnType<typeof getLastScanSummary>;
  preflightBlocked: PreflightBlockedScanSummary | null;
  buyListLoopEntered: boolean;
  gateSamples: number;
  nearMissSamples: number;
  outcomeCount: number;
  dryRunCount: number;
  rolloutCount: number;
}): RuntimePipelineStage {
  // ADR-0367: summary 가 없어도 직전 스캔이 preflight 차단됐으면 BEFORE_BUYLIST_LOOP 로 표시.
  if (!input.summary) return input.preflightBlocked ? 'BEFORE_BUYLIST_LOOP' : 'NOT_RUN';
  if (!input.buyListLoopEntered) return 'BEFORE_BUYLIST_LOOP';
  if (input.rolloutCount > 0) return 'ROLLOUT_EVALUATED';
  if (input.dryRunCount > 0) return 'DRY_RUN_EVALUATED';
  if (input.outcomeCount > 0) return 'OUTCOME_LEDGER_WRITTEN';
  if (input.nearMissSamples > 0) return 'NEAR_MISS_BUCKETED';
  if (input.gateSamples > 0) return 'GATE_EVALUATED';
  return 'BUYLIST_LOOP_ENTERED';
}

function buildOperatorMessage(input: {
  latestStage: RuntimePipelineStage;
  sellOnlyActive: boolean;
  gateSamples: number;
  nearMissSamples: number;
  dryRunCount: number;
  rolloutCount: number;
  summaryExists: boolean;
  preflightBlocked: PreflightBlockedScanSummary | null;
}): string {
  // ADR-0367: summary 없이 preflight 차단된 경우 — "스캔 미실행" 이 아니라 "buyListLoop 진입 전 차단".
  if (!input.summaryExists && input.preflightBlocked) {
    const pb = input.preflightBlocked;
    return `buyListLoop 진입 전 preflight 단계에서 차단되었습니다 (BUYLIST_NOT_REACHED_PRE_FLIGHT_BLOCKED, blockedBy=${pb.blockedBy}). ` +
      `후보 universe snapshot (candidateSummaryCount=${pb.candidateSummaryCount}) 과 counterfactual learning 은 정상 기록되었습니다. ` +
      'Gate Score Health 와 Near-Miss Bucket 은 buyListLoop 이후 생성되므로 현재 표시되지 않습니다. ADR-460 Live Overlay는 설치되어 있지 않습니다.';
  }
  if (!input.summaryExists) {
    return '최근 스캔 summary 없음. /scan 강제 실행 또는 정규장 스캔 후 재확인 필요. ADR-460 Live Overlay는 설치되어 있지 않습니다.';
  }
  if (input.sellOnlyActive) {
    return '현재는 장외/SELL_ONLY 구간입니다. buyListLoop 진입 차단은 정상일 수 있습니다. 정규 BUY_ALLOWED 시간에 재검증하십시오. ADR-460 Live Overlay는 설치되어 있지 않습니다.';
  }
  if (input.latestStage === 'BEFORE_BUYLIST_LOOP') {
    return '후보 universe는 존재하지만 buyListLoop 이전 preflight에서 차단되었습니다. Gate Score Health와 Near-Miss Bucket은 buyListLoop 이후 생성되므로 현재 표시되지 않습니다. ADR-460 Live Overlay는 설치되어 있지 않습니다.';
  }
  if (input.gateSamples <= 0) {
    return 'Gate Score Health sample이 0입니다. evaluateServerGate가 실행되지 않았거나 buyListLoop 내부 후보 평가가 발생하지 않았습니다. ADR-460 Live Overlay는 설치되어 있지 않습니다.';
  }
  if (input.nearMissSamples <= 0 || input.dryRunCount <= 0 || input.rolloutCount <= 0) {
    return 'ADR-459 Rollout 진단 단계까지 확인합니다. Near-Miss/Dry-Run/Rollout 섹션은 해당 ledger 또는 plan 샘플이 있을 때 표시됩니다. ADR-460 Live Overlay는 설치되어 있지 않습니다.';
  }
  return 'Runtime Pipeline Audit completed. ADR-460 Live Overlay는 설치되어 있지 않습니다. 현재 시스템은 ADR-459 Rollout 진단 단계까지입니다.';
}

export function buildRuntimePipelineAuditSnapshot(): RuntimePipelineAuditSnapshot {
  const summary = getLastScanSummary();
  // ADR-0367: 직전 스캔이 buyListLoop 진입 전 preflight 차단된 경우의 진단 SSOT.
  const preflightBlocked = getLastPreflightBlockedScanSummary();
  const blockedBy: RuntimePipelineBlockReason[] = [];
  const gateSamples = summary?.gateScoreHealth?.samples ?? 0;
  const scanNearMissSamples = countNearMissBuckets(summary);
  const observationNearMissSamples = summary?.gate1DryRunObservationLedger?.sources?.GATE1_NEAR_MISS ?? 0;
  const nearMissSamples = scanNearMissSamples + observationNearMissSamples;
  const candidateSummaryCount = summary ? summary.candidates : (preflightBlocked?.candidateSummaryCount ?? 0);
  const buyListLoopEntered = Boolean(summary && (gateSamples > 0 || nearMissSamples > 0 || (summary.gatePassDistribution?.gate1Pass ?? 0) > 0));
  const scanSummaryPersisted = Boolean(summary);
  const preflightSummaryPersisted = Boolean(preflightBlocked);
  const sellOnlyActive = Boolean(summary?.macroGateState?.sellOnlyMode);
  const autoTradeEnabled = process.env.AUTO_TRADE_ENABLED === undefined ? null : process.env.AUTO_TRADE_ENABLED === 'true';

  let watchlistCount: number | null = null;
  try { watchlistCount = loadWatchlist().length; } catch { watchlistCount = null; }

  let nearMissOutcomeLedgerCount = 0;
  try { nearMissOutcomeLedgerCount = getAllNearMissOutcomes().length; } catch { nearMissOutcomeLedgerCount = 0; }
  let dryRunRecordCount = 0;
  try { dryRunRecordCount = loadGateReclassificationDryRunRecords().length; } catch { dryRunRecordCount = 0; }
  let gate1ObservationLedgerCount = 0;
  try {
    gate1ObservationLedgerCount = summary?.gate1DryRunObservationLedger?.totalRows
      ?? summary?.gate1DryRunObservationLedger?.rowsCreated
      ?? getGate1DryRunObservationLedgerCount();
  } catch {
    gate1ObservationLedgerCount = 0;
  }
  dryRunRecordCount += gate1ObservationLedgerCount;
  let rolloutItemCount = 0;
  try { rolloutItemCount = loadGateReclassificationRolloutPlan()?.items.length ?? 0; } catch { rolloutItemCount = 0; }

  const latestStage = deriveStage({
    summary,
    preflightBlocked,
    buyListLoopEntered,
    gateSamples,
    nearMissSamples,
    outcomeCount: nearMissOutcomeLedgerCount,
    dryRunCount: dryRunRecordCount,
    rolloutCount: rolloutItemCount,
  });

  if (!summary) addReason(blockedBy, 'BUYLIST_NOT_REACHED');
  // ADR-0367: summary 없이 preflight 차단된 경우 — 전용 reason + HARD_BLOCK 매핑.
  if (!summary && preflightBlocked) {
    addReason(blockedBy, 'BUYLIST_NOT_REACHED_PRE_FLIGHT_BLOCKED');
    if (preflightBlocked.blockedBy === 'HARD_BLOCK') addReason(blockedBy, 'HARD_BLOCK');
  }
  if (sellOnlyActive) addReason(blockedBy, 'SELL_ONLY_SESSION');
  if (summary?.macroGateState?.watchlistEmpty || watchlistCount === 0) addReason(blockedBy, 'WATCHLIST_EMPTY');
  if (summary?.macroGateState?.emergencyStop) addReason(blockedBy, 'HARD_BLOCK');
  if (autoTradeEnabled === false) addReason(blockedBy, 'AUTO_TRADE_DISABLED');
  if (summary?.macroGateState?.bearDefenseMode || summary?.macroGateState?.vixGatingActive || summary?.macroGateState?.mhsBelow30) addReason(blockedBy, 'MACRO_RISK_BLOCK');
  if (!buyListLoopEntered) addReason(blockedBy, 'BUYLIST_NOT_REACHED');
  if (gateSamples <= 0) addReason(blockedBy, 'NO_GATE_SAMPLES');
  if (nearMissSamples <= 0 && gate1ObservationLedgerCount <= 0) addReason(blockedBy, 'NO_NEAR_MISS_SAMPLES');
  if (nearMissOutcomeLedgerCount <= 0) addReason(blockedBy, 'NO_APPROVED_RECLASSIFICATION_ITEMS');
  if (dryRunRecordCount <= 0) addReason(blockedBy, 'NO_DRY_RUN_RECORDS');
  if (rolloutItemCount <= 0) addReason(blockedBy, 'NO_ROLLOUT_ITEMS');
  addReason(blockedBy, 'ADR_460_NOT_INSTALLED');

  const supplyProviderHealth = buildSupplyProviderHealth();
  if (!supplyProviderHealth.hasRecentSample) addReason(blockedBy, 'SUPPLY_PROVIDER_NO_SAMPLE');
  const sectorEnergyHealth = buildSectorEnergyHealth(summary);
  // ADR-0534 follow-up (Invariant 9): canonical PASS 면 legacy dataQuality(PARTIAL) 로 SECTOR_ENERGY_DEGRADED 를 활성 blocker 로 올리지 않는다.
  const sectorEnergyCanonical = summary?.sectorEnergySupplyUnknownAdr0488?.sectorEnergyCanonicalState;
  const sectorEnergyCanonicalHealthy =
    sectorEnergyCanonical?.promotionCoveragePass === true
    && sectorEnergyCanonical?.verifiedOfficialSectorCount === 11
    && sectorEnergyCanonical?.dataQuality === 'VERIFIED';
  // ADR-0544 follow-up (GAP-C): 휴일/세션닫힘 verify-skip 은 소스 결함(DEGRADED)이 아니라
  // SESSION_NOT_VERIFIABLE 이다 (불변식 #6: providerIssue≠bearish). canonical resolver/operator
  // action/KIS status 표시는 ADR-0544 가 이미 분리했으나 runtime pipeline audit blockedBy 산출만
  // 누락되어 SECTOR_ENERGY_DEGRADED + legacy promotion 토큰(HIGH_MISSING_RATE 등)이 잔존했다.
  // session-closed 면 healthy 와 동일하게 promotion blocker 억제 — 게이팅(promotionCoveragePass)
  // 은 읽지도 쓰지도 않으므로 promotion 은 어차피 disabled 그대로. executionImpact=NONE.
  const sectorEnergySessionClosed =
    sectorEnergyCanonical?.dataQuality === 'SESSION_NOT_VERIFIABLE'
    || sectorEnergyCanonical?.sectorIndexVerifyMode === 'VERIFY_SKIPPED_SESSION_CLOSED';
  const sectorEnergyPromotionBlockerSuppressed = sectorEnergyCanonicalHealthy || sectorEnergySessionClosed;
  if (!sectorEnergyPromotionBlockerSuppressed && sectorEnergyHealth.dataQuality && sectorEnergyHealth.dataQuality !== 'OK') addReason(blockedBy, 'SECTOR_ENERGY_DEGRADED');
  if (!sectorEnergyPromotionBlockerSuppressed && sectorEnergyHealth.leadershipConfidence === 'BLOCKED') addReason(blockedBy, 'SECTOR_ENERGY_LEADERSHIP_BLOCKED');

  const promotionAuditInputs = [
    ...(summary?.investorFlowSampleAdr0489 ? [buildPromotionAuditInputForDataLineAdr0494({
      sourceType: 'INVESTOR_FLOW',
      report: summary.investorFlowSampleAdr0489,
    })] : []),
    ...(summary?.sectorEnergySupplyUnknownAdr0488 ? [buildPromotionAuditInputForDataLineAdr0494({
      sourceType: 'SECTOR_ENERGY',
      report: summary.sectorEnergySupplyUnknownAdr0488,
    })] : []),
    ...(summary?.supplySnapshotStoreAdr0491 ? [buildPromotionAuditInputForDataLineAdr0494({
      sourceType: 'SUPPLY_SNAPSHOT',
      report: summary.supplySnapshotStoreAdr0491,
    })] : []),
  ];
  const promotionAudits = evaluateFreshDataPromotionAuditsAdr0494(promotionAuditInputs, { store: null });
  const promotionAuditSummary = summarizeFreshDataPromotionAuditsAdr0494(promotionAudits);
  const sectorEnergyLegacyPromotionTokens = ['SECTOR_ENERGY_DEGRADED', 'SECTOR_ENERGY_UNOBSERVABLE', 'SECTOR_ENERGY_DIAGNOSTIC_ONLY', 'sectorEnergy:INSUFFICIENT_HISTORY', 'sectorEnergy:HIGH_MISSING_RATE'];
  const promotionAuditBlockedLines = sectorEnergyPromotionBlockerSuppressed
    ? promotionAuditSummary.promotionAuditBlockedLines.filter((line) => !sectorEnergyLegacyPromotionTokens.some((token) => line.includes(token)))
    : promotionAuditSummary.promotionAuditBlockedLines;
  const promotionAuditBlockers = sectorEnergyPromotionBlockerSuppressed
    ? promotionAuditSummary.promotionAuditBlockers.filter((line) => !sectorEnergyLegacyPromotionTokens.some((token) => line.includes(token)))
    : promotionAuditSummary.promotionAuditBlockers;

  let freshDataStatusInputsAdr0498: FreshDataStatusViewModelInputAdr0498[] = [];
  let freshDataStatusSectionAdr0498 = safeBuildFreshDataStatusSectionAdr0498([], { maxLines: 4 });
  try {
    freshDataStatusInputsAdr0498 = mapRuntimeFreshDataSummaryToStatusInputsAdr0498(summary as unknown as Record<string, unknown> | null | undefined);
    freshDataStatusSectionAdr0498 = safeBuildFreshDataStatusSectionAdr0498(freshDataStatusInputsAdr0498, { maxLines: 4 });
  } catch {
    freshDataStatusInputsAdr0498 = [];
    freshDataStatusSectionAdr0498 = safeBuildFreshDataStatusSectionAdr0498([], { maxLines: 4 });
  }

  const livePath = runLivePathSafetyAudit();
  const operatorActionQueue = safeBuildOperatorActionQueueAdr0480({
    sources: collectOperatorActionSourcesFromScanSummaryAdr0480(summary),
    supplyRecoveryRuntimeMountAdr0486: summary?.supplyRecoveryRuntimeMountAdr0486 ?? null,
    freshDataSupplyAdr0487: summary?.freshDataSupplyAdr0487 ?? null,
    sectorEnergySupplyUnknownAdr0488: summary?.sectorEnergySupplyUnknownAdr0488 ?? null,
  });
  const operatorActionEvidenceCount = operatorActionQueue.allActions.reduce((sum, action) => sum + action.evidenceCount, 0);

  let emptyScanRootCause: EmptyScanRootCauseDashboardAdr0500 | undefined;
  let emptyScanRootCauseCompact: string | undefined;
  let weekendReplaySummary: WeekendReplaySummaryAdr0501 | undefined;
  let weekendReplayCompact: string | undefined;
  try {
    emptyScanRootCause = summary?.emptyScanRootCause ?? safeBuildEmptyScanRootCauseDashboardAdr0500({
      scanId: summary?.time ? `runtime-${summary.time}` : undefined,
      events: buildEmptyScanRootCauseEventsFromStringsAdr0500(blockedBy.map((reason) => ({
        source: 'RUNTIME_PIPELINE_AUDIT' as const,
        reason,
        count: 1,
      }))),
      totalEmptyScans: (summary?.entries ?? 0) === 0 ? 1 : 0,
    });
    emptyScanRootCauseCompact = formatEmptyScanRootCauseCompactAdr0500(emptyScanRootCause, { maxBuckets: 3 });
    weekendReplaySummary = summary?.weekendReplaySummaryAdr0501 ?? safeBuildWeekendReplaySummaryAdr0501({
      records: buildWeekendReplayRecordsFromStringsAdr0501(blockedBy.map((reason) => ({
        source: 'RUNTIME_PIPELINE_AUDIT' as const,
        reason,
        replayMode: 'LATEST' as const,
      }))),
      replayMode: 'LATEST',
      totalScans: summary ? 1 : 0,
      totalSymbols: candidateSummaryCount,
    });
    weekendReplayCompact = formatWeekendReplayCompactAdr0501(weekendReplaySummary, { maxCauses: 3 });
  } catch {
    emptyScanRootCause = undefined;
    emptyScanRootCauseCompact = undefined;
    weekendReplaySummary = undefined;
    weekendReplayCompact = undefined;
  }

  return {
    generatedAt: new Date().toISOString(),
    sourceSnapshotId: resolveCanonicalSourceSnapshotId(summary, preflightBlocked),
    lastScanAt: summary?.time ?? null,
    marketSession: inferMarketSession(summary),
    engineMode: getExecutionMode(),
    autoTradeEnabled,
    sellOnlyActive,
    emergencyStop: summary?.macroGateState?.emergencyStop ?? getEmergencyStop(),
    latestStage,
    blockedBy: sectorEnergyPromotionBlockerSuppressed
      ? blockedBy.filter((reason) => !['SECTOR_ENERGY_DEGRADED', 'SECTOR_ENERGY_UNOBSERVABLE', 'SECTOR_ENERGY_DIAGNOSTIC_ONLY'].includes(reason))
      : blockedBy,
    candidateSummaryCount,
    watchlistCount,
    buyListLoopEntered,
    scanSummaryPersisted,
    preflightSummaryPersisted,
    gateScoreHealthSamples: gateSamples,
    gate1PassCount: summary?.gateLayerAudit?.gate1PassCount ?? summary?.gatePassDistribution?.gate1Pass ?? 0,
    gate2PassCount: summary?.gateLayerAudit?.gate2PassCount ?? summary?.gatePassDistribution?.gate2Pass ?? 0,
    gate3PassCount: summary?.gateLayerAudit?.gate3PassCount ?? summary?.gatePassDistribution?.gate3Pass ?? 0,
    liveEligibleCount: summary?.liveEligibleCount ?? 0,
    shadowObservableCount: summary?.shadowObservableCount ?? 0,
    dataUnavailableBlockCount: summary?.dataUnavailableBlockedCount ?? 0,
    providerDegradedBlockCount: summary?.providerDegradedObservableCount ?? 0,
    strongBuySuppressedByDataUnavailableCount: summary?.gateLayerAudit?.strongBuySuppressedByDataUnavailableCount ?? 0,
    topGate1BlockReasons: summary?.gateLayerAudit?.topGate1BlockReasons ?? [],
    topGate2BlockReasons: summary?.gateLayerAudit?.topGate2BlockReasons ?? [],
    topGate3BlockReasons: summary?.gateLayerAudit?.topGate3BlockReasons ?? [],
    dataPromotionStatus: summary?.dataPromotionStatus ?? DEFAULT_DATA_PROMOTION_STATUS,
    perStageDropoffSummary: summary?.perStageDropoffSummary ?? [],
    nearMissBucketSamples: nearMissSamples,
    nearMissOutcomeLedgerCount,
    dryRunRecordCount,
    rolloutItemCount,
    operatorActionEvidenceCount,
    operatorActionDiagnosticLine: formatRuntimePipelineDiagnosticEvidenceLineAdr0480(operatorActionQueue),
    supplyAdvisoryReadinessDiagnosticLine: `${formatRuntimePipelineReadinessEvidenceLineAdr0485(summary?.supplyAdvisoryReadinessAdr0485)} | supplyRecoveryMount: ${formatRuntimePipelineMountEvidenceLineAdr0486(summary?.supplyRecoveryRuntimeMountAdr0486)} | freshDataSupply: ${formatRuntimePipelineFreshDataEvidenceLineAdr0487(summary?.freshDataSupplyAdr0487)} | adr0496Coverage=${summary?.investorFlowSampleAdr0489?.adr0496SupplyCoverage.coverageAfter ?? 0} | adr0488: ${formatRuntimePipelineAdr0488EvidenceLine(summary?.sectorEnergySupplyUnknownAdr0488)}`,
    supplyRecoveryMountDiagnosticLine: formatRuntimePipelineMountEvidenceLineAdr0486(summary?.supplyRecoveryRuntimeMountAdr0486),
    freshDataSupplyDiagnosticLine: formatRuntimePipelineFreshDataEvidenceLineAdr0487(summary?.freshDataSupplyAdr0487),
    sectorEnergySupplyUnknownDiagnosticLine: formatRuntimePipelineAdr0488EvidenceLine(summary?.sectorEnergySupplyUnknownAdr0488),
    supplySnapshotStoreDiagnosticLine: formatSupplySnapshotDetailAdr0491(summary?.supplySnapshotStoreAdr0491 ?? { status: 'EMPTY', mode: 'LATEST', snapshots: [], retained: 0, replayAvailable: false, diagnosticOnly: true, executionImpact: 'NONE', liveExecutionAllowed: false, policyPromotionMode: 'SHADOW_ONLY', operatorApprovalRequired: true, diagnostics: [] }),
    promotionAuditSummary: promotionAuditSummary.promotionAuditSummary,
    promotionAuditBlockers,
    promotionAuditReadyLines: promotionAuditSummary.promotionAuditReadyLines,
    promotionAuditBlockedLines,
    freshDataStatusViewModels: freshDataStatusSectionAdr0498.viewModels,
    freshDataStatusCompactLines: freshDataStatusSectionAdr0498.lines,
    freshDataStatusNormalizedCount: freshDataStatusSectionAdr0498.viewModels.length,
    ...(emptyScanRootCause ? { emptyScanRootCause } : {}),
    ...(emptyScanRootCauseCompact ? { emptyScanRootCauseCompact } : {}),
    ...(weekendReplaySummary ? { weekendReplaySummary } : {}),
    ...(weekendReplayCompact ? { weekendReplayCompact } : {}),
    adr460Installed: false,
    supplyProviderHealth,
    sectorEnergyHealth,
    livePathSafety: {
      kisOrderImportDetected: livePath.kisOrderImportDetected,
      normalizedGateScoreLiveDecisionDetected: livePath.normalizedGateScoreLiveDecisionDetected,
      createLiveOrderTrueDetected: livePath.createLiveOrderTrueDetected,
      executionImpactFullOrPartialDetected: livePath.executionImpactFullOrPartialDetected,
      gateThresholdMutationDetected: livePath.gateThresholdMutationDetected,
      kellyMutationDetected: livePath.kellyMutationDetected,
      coreRolloutDetected: livePath.coreRolloutDetected,
      passed: livePath.passed,
      findings: livePath.findings,
    },
    operatorMessage: buildOperatorMessage({
      latestStage,
      sellOnlyActive,
      gateSamples,
      nearMissSamples,
      dryRunCount: dryRunRecordCount,
      rolloutCount: rolloutItemCount,
      summaryExists: Boolean(summary),
      preflightBlocked,
    }),
  };
}

export function formatRuntimePipelineAuditSection(snapshot: RuntimePipelineAuditSnapshot): string {
  return [
    '📍 <b>Runtime Pipeline Audit (ADR-461)</b>',
    `  • sourceSnapshotId: <code>${snapshot.sourceSnapshotId}</code>`,
    `  • latestStage: <code>${snapshot.latestStage}</code>`,
    `  • blockedBy: <code>${snapshot.blockedBy.join(', ') || 'none'}</code>`,
    `  • buyListLoopEntered: <code>${snapshot.buyListLoopEntered ? 'true' : 'false'}</code>`,
    `  • scanSummaryPersisted: <code>${snapshot.scanSummaryPersisted ? 'true' : 'false'}</code>`,
    `  • preflightSummaryPersisted: <code>${snapshot.preflightSummaryPersisted ? 'true' : 'false'}</code>`,
    `  • gateScoreHealthSamples: <code>${snapshot.gateScoreHealthSamples}</code>`,
    `  • nearMissBucketSamples: <code>${snapshot.nearMissBucketSamples}</code>`,
    `  • nearMissOutcomeLedger: <code>${snapshot.nearMissOutcomeLedgerCount}</code>`,
    `  • dryRunRecords: <code>${snapshot.dryRunRecordCount}</code>`,
    `  • rolloutItems: <code>${snapshot.rolloutItemCount}</code>`,
    `  • operatorActionEvidence: <code>${snapshot.operatorActionEvidenceCount}</code>`,
    `  • supplyReadiness: <code>${snapshot.supplyAdvisoryReadinessDiagnosticLine}</code>`,
    `  • freshDataSupply: <code>${snapshot.freshDataSupplyDiagnosticLine}</code>`,
    `  • adr0488: <code>${snapshot.sectorEnergySupplyUnknownDiagnosticLine}</code>`,
    `  • supplySnapshotStore: <code>${snapshot.supplySnapshotStoreDiagnosticLine}</code>`,
    `  • promotionAudit: <code>${snapshot.promotionAuditSummary}</code>`,
    `  • adr0498FreshDataStatus: <code>${snapshot.freshDataStatusCompactLines?.join(' | ') ?? 'none'}</code>`,
    `  • adr0500EmptyScanRootCause: <code>${snapshot.emptyScanRootCauseCompact ?? 'none'}</code>`,
    `  • adr0501WeekendReplay: <code>${snapshot.weekendReplayCompact ?? 'none'}</code>`,
    `  • promotionAuditBlockers: <code>${snapshot.promotionAuditBlockers.join(', ') || 'none'}</code>`,
    '  • ADR-460: <code>not installed</code>',
    `  • reason: ${snapshot.operatorMessage}`,
    `  • livePathSafety: <code>${snapshot.livePathSafety.passed ? 'PASS' : 'FAIL'}</code>`,
  ].join('\n');
}

export function formatRuntimePipelineAuditCompactLine(snapshot: RuntimePipelineAuditSnapshot): string {
  return [
    '🧭 <b>Runtime Audit (ADR-461)</b>',
    `  • stage: <code>${snapshot.latestStage}</code>`,
    `  • buyListLoop: <code>${snapshot.buyListLoopEntered ? 'yes' : 'no'}</code>`,
    `  • Gate samples: <code>${snapshot.gateScoreHealthSamples}</code>`,
    `  • NearMiss: <code>${snapshot.nearMissBucketSamples}</code>`,
    `  • OutcomeLedger: <code>${snapshot.nearMissOutcomeLedgerCount}</code>`,
    `  • DryRun: <code>${snapshot.dryRunRecordCount}</code>`,
    `  • Rollout: <code>${snapshot.rolloutItemCount}</code>`,
    '  • ADR-460: <code>not installed</code>',
    `  • PromotionAudit: <code>${snapshot.promotionAuditSummary}</code>`,
    `  • ADR-0498 FreshDataStatus: <code>${snapshot.freshDataStatusNormalizedCount ?? 0}</code>`,
    `  • ADR-0500 EmptyScan: <code>${snapshot.emptyScanRootCause?.topCause ?? 'NONE'}</code>`,
    `  • ADR-0501 WeekendReplay: <code>${snapshot.weekendReplaySummary?.operatorSummary ?? 'none'}</code>`,
    `  • Safety: <code>${snapshot.livePathSafety.passed ? 'PASS' : 'FAIL'}</code>`,
  ].join('\n');
}

export function formatRuntimePipelineAuditDetails(snapshot: RuntimePipelineAuditSnapshot): string {
  const findings = snapshot.livePathSafety.findings.length > 0
    ? snapshot.livePathSafety.findings.map((finding) => `  • ${finding}`).join('\n')
    : '  • none';
  return [
    '📍 <b>Runtime Pipeline Audit (ADR-461)</b>',
    `  • sourceSnapshotId: <code>${snapshot.sourceSnapshotId}</code>`,
    `  • generatedAt: <code>${snapshot.generatedAt}</code>`,
    `  • lastScanAt: <code>${snapshot.lastScanAt ?? 'none'}</code>`,
    `  • latestStage: <code>${snapshot.latestStage}</code>`,
    `  • blockedBy: <code>${snapshot.blockedBy.join(', ') || 'none'}</code>`,
    `  • marketSession: <code>${snapshot.marketSession}</code>`,
    `  • engineMode: <code>${snapshot.engineMode}</code>`,
    `  • autoTradeEnabled: <code>${snapshot.autoTradeEnabled === null ? 'unknown' : snapshot.autoTradeEnabled}</code>`,
    `  • sellOnlyActive: <code>${snapshot.sellOnlyActive}</code>`,
    `  • emergencyStop: <code>${snapshot.emergencyStop === null ? 'unknown' : snapshot.emergencyStop}</code>`,
    `  • candidateSummaryCount: <code>${snapshot.candidateSummaryCount}</code>`,
    `  • watchlistCount: <code>${snapshot.watchlistCount ?? 'unknown'}</code>`,
    `  • buyListLoopEntered: <code>${snapshot.buyListLoopEntered}</code>`,
    `  • scanSummaryPersisted: <code>${snapshot.scanSummaryPersisted}</code>`,
    `  • preflightSummaryPersisted: <code>${snapshot.preflightSummaryPersisted}</code>`,
    `  • gateScoreHealthSamples: <code>${snapshot.gateScoreHealthSamples}</code>`,
    `  • nearMissBucketSamples: <code>${snapshot.nearMissBucketSamples}</code>`,
    `  • nearMissOutcomeLedgerCount: <code>${snapshot.nearMissOutcomeLedgerCount}</code>`,
    `  • dryRunRecordCount: <code>${snapshot.dryRunRecordCount}</code>`,
    `  • rolloutItemCount: <code>${snapshot.rolloutItemCount}</code>`,
    `  • operatorActionEvidenceCount: <code>${snapshot.operatorActionEvidenceCount}</code>`,
    `  • operatorActionDiagnostic: ${snapshot.operatorActionDiagnosticLine}`,
    `  • supplyReadinessDiagnostic: ${snapshot.supplyAdvisoryReadinessDiagnosticLine}`,
    `  • freshDataSupplyDiagnostic: ${snapshot.freshDataSupplyDiagnosticLine}`,
    `  • adr0488Diagnostic: ${snapshot.sectorEnergySupplyUnknownDiagnosticLine}`,
    `  • supplySnapshotStoreDiagnostic: ${snapshot.supplySnapshotStoreDiagnosticLine}`,
    `  • promotionAuditSummary: ${snapshot.promotionAuditSummary}`,
    `  • promotionAuditReadyLines: <code>${snapshot.promotionAuditReadyLines.join(', ') || 'none'}</code>`,
    `  • promotionAuditBlockedLines: <code>${snapshot.promotionAuditBlockedLines.join(', ') || 'none'}</code>`,
    `  • adr0498FreshDataStatusLines: <code>${snapshot.freshDataStatusCompactLines?.join(' | ') ?? 'none'}</code>`,
    `  • adr0500EmptyScanRootCause: <code>${snapshot.emptyScanRootCauseCompact ?? 'none'}</code>`,
    `  • adr0501WeekendReplay: <code>${snapshot.weekendReplayCompact ?? 'none'}</code>`,
    `  • promotionAuditBlockers: <code>${snapshot.promotionAuditBlockers.join(', ') || 'none'}</code>`,
    '  • ADR-460: <code>not installed</code>',
    `  • supplyProvider: ${snapshot.supplyProviderHealth.message}`,
    `  • sectorEnergy: ${snapshot.sectorEnergyHealth.message}`,
    `  • livePathSafety: <code>${snapshot.livePathSafety.passed ? 'PASS' : 'FAIL'}</code>`,
    findings,
    `  • operatorMessage: ${snapshot.operatorMessage}`,
  ].join('\n');
}
