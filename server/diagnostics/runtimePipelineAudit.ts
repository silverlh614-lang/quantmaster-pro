/**
 * @responsibility ADR-461 Post-Rollout Runtime Pipeline Audit.
 *
 * Read-only diagnostic snapshot for ADR-450~459 rollout verification. It does not implement
 * ADR-460/Live Overlay and does not call external APIs or order modules.
 */
import { getEmergencyStop, getExecutionMode } from '../state.js';
import { getLastScanSummary } from '../trading/signalScanner/scanDiagnostics.js';
import { loadWatchlist } from '../persistence/watchlistRepo.js';
import { getLastInvestorFlowProviderHealth } from '../supply/investorFlowProviderHealth.js';
import { getAllNearMissOutcomes } from '../persistence/nearMissOutcomeLedger.js';
import { loadGateReclassificationDryRunRecords } from '../persistence/gateReclassificationDryRunRepo.js';
import { loadGateReclassificationRolloutPlan } from '../persistence/gateReclassificationRolloutRepo.js';
import { runLivePathSafetyAudit } from './livePathSafetyAudit.js';
import { getGate1DryRunObservationLedgerCount } from '../trading/signalScanner/gate1DryRunObservationLedgerAdr0476.js';

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
  | 'NO_GATE_SAMPLES'
  | 'NO_NEAR_MISS_SAMPLES'
  | 'NO_APPROVED_RECLASSIFICATION_ITEMS'
  | 'NO_DRY_RUN_RECORDS'
  | 'NO_ROLLOUT_ITEMS'
  | 'ADR_460_NOT_INSTALLED'
  | 'UNKNOWN';

export interface RuntimePipelineAuditSnapshot {
  generatedAt: string;
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
  gateScoreHealthSamples: number;
  nearMissBucketSamples: number;
  nearMissOutcomeLedgerCount: number;
  dryRunRecordCount: number;
  rolloutItemCount: number;
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
  buyListLoopEntered: boolean;
  gateSamples: number;
  nearMissSamples: number;
  outcomeCount: number;
  dryRunCount: number;
  rolloutCount: number;
}): RuntimePipelineStage {
  if (!input.summary) return 'NOT_RUN';
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
}): string {
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
  const blockedBy: RuntimePipelineBlockReason[] = [];
  const gateSamples = summary?.gateScoreHealth?.samples ?? 0;
  const scanNearMissSamples = countNearMissBuckets(summary);
  const observationNearMissSamples = summary?.gate1DryRunObservationLedger?.sources?.GATE1_NEAR_MISS ?? 0;
  const nearMissSamples = scanNearMissSamples + observationNearMissSamples;
  const candidateSummaryCount = summary ? summary.candidates : 0;
  const buyListLoopEntered = Boolean(summary && (gateSamples > 0 || nearMissSamples > 0 || (summary.gatePassDistribution?.gate1Pass ?? 0) > 0));
  const scanSummaryPersisted = Boolean(summary);
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
    buyListLoopEntered,
    gateSamples,
    nearMissSamples,
    outcomeCount: nearMissOutcomeLedgerCount,
    dryRunCount: dryRunRecordCount,
    rolloutCount: rolloutItemCount,
  });

  if (!summary) addReason(blockedBy, 'BUYLIST_NOT_REACHED');
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
  if (sectorEnergyHealth.dataQuality && sectorEnergyHealth.dataQuality !== 'OK') addReason(blockedBy, 'SECTOR_ENERGY_DEGRADED');
  if (sectorEnergyHealth.leadershipConfidence === 'BLOCKED') addReason(blockedBy, 'SECTOR_ENERGY_LEADERSHIP_BLOCKED');

  const livePath = runLivePathSafetyAudit();

  return {
    generatedAt: new Date().toISOString(),
    lastScanAt: summary?.time ?? null,
    marketSession: inferMarketSession(summary),
    engineMode: getExecutionMode(),
    autoTradeEnabled,
    sellOnlyActive,
    emergencyStop: summary?.macroGateState?.emergencyStop ?? getEmergencyStop(),
    latestStage,
    blockedBy,
    candidateSummaryCount,
    watchlistCount,
    buyListLoopEntered,
    scanSummaryPersisted,
    gateScoreHealthSamples: gateSamples,
    nearMissBucketSamples: nearMissSamples,
    nearMissOutcomeLedgerCount,
    dryRunRecordCount,
    rolloutItemCount,
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
    }),
  };
}

export function formatRuntimePipelineAuditSection(snapshot: RuntimePipelineAuditSnapshot): string {
  return [
    '📍 <b>Runtime Pipeline Audit (ADR-461)</b>',
    `  • latestStage: <code>${snapshot.latestStage}</code>`,
    `  • blockedBy: <code>${snapshot.blockedBy.join(', ') || 'none'}</code>`,
    `  • buyListLoopEntered: <code>${snapshot.buyListLoopEntered ? 'true' : 'false'}</code>`,
    `  • scanSummaryPersisted: <code>${snapshot.scanSummaryPersisted ? 'true' : 'false'}</code>`,
    `  • gateScoreHealthSamples: <code>${snapshot.gateScoreHealthSamples}</code>`,
    `  • nearMissBucketSamples: <code>${snapshot.nearMissBucketSamples}</code>`,
    `  • nearMissOutcomeLedger: <code>${snapshot.nearMissOutcomeLedgerCount}</code>`,
    `  • dryRunRecords: <code>${snapshot.dryRunRecordCount}</code>`,
    `  • rolloutItems: <code>${snapshot.rolloutItemCount}</code>`,
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
    `  • Safety: <code>${snapshot.livePathSafety.passed ? 'PASS' : 'FAIL'}</code>`,
  ].join('\n');
}

export function formatRuntimePipelineAuditDetails(snapshot: RuntimePipelineAuditSnapshot): string {
  const findings = snapshot.livePathSafety.findings.length > 0
    ? snapshot.livePathSafety.findings.map((finding) => `  • ${finding}`).join('\n')
    : '  • none';
  return [
    '📍 <b>Runtime Pipeline Audit (ADR-461)</b>',
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
    `  • gateScoreHealthSamples: <code>${snapshot.gateScoreHealthSamples}</code>`,
    `  • nearMissBucketSamples: <code>${snapshot.nearMissBucketSamples}</code>`,
    `  • nearMissOutcomeLedgerCount: <code>${snapshot.nearMissOutcomeLedgerCount}</code>`,
    `  • dryRunRecordCount: <code>${snapshot.dryRunRecordCount}</code>`,
    `  • rolloutItemCount: <code>${snapshot.rolloutItemCount}</code>`,
    '  • ADR-460: <code>not installed</code>',
    `  • supplyProvider: ${snapshot.supplyProviderHealth.message}`,
    `  • sectorEnergy: ${snapshot.sectorEnergyHealth.message}`,
    `  • livePathSafety: <code>${snapshot.livePathSafety.passed ? 'PASS' : 'FAIL'}</code>`,
    findings,
    `  • operatorMessage: ${snapshot.operatorMessage}`,
  ].join('\n');
}
