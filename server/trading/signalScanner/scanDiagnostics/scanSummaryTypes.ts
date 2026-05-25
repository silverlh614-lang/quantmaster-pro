// @responsibility Scan summary public type contracts.

import type { EmptyScanRootCauseDashboardAdr0500 } from '../../../diagnostics/emptyScanRootCauseDashboardAdr0500.js';
import type { WeekendReplaySummaryAdr0501 } from '../../../diagnostics/weekendReplayAdr0501.js';
import type { GateReclassificationDryRunSummary } from '../../../learning/gateReclassificationDryRun.js';
import type { SectorEnergyQualityDiagnostic } from '../../../clients/sectorEnergyQualityDiagnostic.js';
import type { ShadowCandidateScanTrigger } from '../../marketStateResolver.js';
import type { EmptyScanReason } from '../emptyScanClassifier.js';
import type { GateDecisionRouterResult } from '../gateDecisionRouter.js';
import type { Gate1MinimumSignalForensicSummaryAdr0505 } from '../gate1MinimumSignalForensicAuditAdr0505.js';
import type { CounterfactualShadowSectionInput } from '../counterfactualShadowLearningLane.js';
import type { EntryFilterDecomposition } from '../entryFilterDecomposition.js';
import type { FinalGate1CalibrationAuditReport } from '../gate1FinalCalibration.js';
import type { PenaltyDeduplicationReport } from '../gate1PenaltyDeduplication.js';
import type { Gate1PositiveSourceWiringReport } from '../gate1PositiveSourceWiringAdr0475.js';
import type { Gate1ScoreCeilingRepairReport } from '../gate1ScoreCeilingRepair.js';
import type { Gate1ScoringAlignmentReport } from '../gate1ScoringAlignmentAdr0472.js';
import type { Gate1DryRunObservationSummary } from '../gate1DryRunObservationLedgerAdr0476.js';
import type { RiskDoubleCountAuditReport } from '../gate1RiskDoubleCount.js';
import type { PositiveScoreStarvationReport } from '../gate1PositiveScoreStarvation.js';
import type { InvestorFlowProviderRouteResult } from '../investorFlowProviderRouterAdr0477.js';
import type { NaverInvestorTrendCollectorResult } from '../naverInvestorTrendCollectorAdr0481.js';
import type { FrozenQuoteResult } from '../frozenQuoteDetector.js';
import type { PerSymbolSupplyInjectionStats } from '../injectPerSymbolSupplyContext.js';
import type { PreBreakoutWaitSummary } from '../preBreakoutWaitPolicy.js';
import type { PriceCorrectionType } from '../priceCorrectionEngine.js';
import type { PriceIntegrityStatus } from '../priceIntegrityChecker.js';
import type { ProvisionalShadowSectionInput } from '../provisionalShadowLane.js';
import type { R3NoiseGovernorDecision } from '../r3NoiseGovernor.js';
import type { R3ViolationStateResult } from '../r3ViolationStateMachine.js';
import type { R6ShadowEntryPolicySummary } from '../r6ShadowCounterfactualEntryPolicy.js';
import type { SemanticNetBuyNormalizationReportAdr0482 } from '../semanticNetBuyNormalizerAdr0482.js';
import type { SupplyAdvisoryReadinessReportAdr0485 } from '../supplyAdvisoryReadinessAdr0485.js';
import type { SupplyCoverageRecoveryObservationReportAdr0484 } from '../supplyCoverageRecoveryObservationAdr0484.js';
import type { SupplyRecoveryRuntimeMountReportAdr0486 } from '../supplyRecoveryRuntimeMountAdr0486.js';
import type { FreshDataSupplyReportAdr0487 } from '../freshDataSupplyLayerAdr0487.js';
import type { InvestorFlowSampleAcquisitionReportAdr0489 } from '../investorFlowSampleAcquisitionAdr0489.js';
import type { SectorEnergyAndSupplyUnknownPolicyReportAdr0488 } from '../sectorEnergyMasterSupplyUnknownPolicyAdr0488.js';
import type { SupplySnapshotReplayResultAdr0491 } from '../supplySnapshotStoreReplayAdr0491.js';
import type { StreakSkipReason } from '../r3StreakSkipPolicy.js';
import type {
  GateScoreCandidateBucketSummary,
  GateScoreHealthSummary,
} from './gateScoreDiagnostics.js';
import type { GateDiagnosticCarrySummary, GateLayerAuditSummary } from './gateLayerDiagnostics.js';
import type { ScanEvaluationResult } from '../state/scanEvaluationState.js';
import type { SourceSnapshotDataHealth } from '../../sourceSnapshot/sourceSnapshotDataHealth.js';
import type { SnapshotForensicAlert } from '../../sourceSnapshot/snapshotMismatchDetector.js';
import type { ScoreBreakdown } from '../../gates/aiExecutionIsolation.js';
import type { CanonicalRuntimeResolutionStep27 } from '../runtimeResolverTraceStep26.js';
import type { CandidatePoolResult } from '../../candidatePoolBuilder.js';
import type {
  CandidateGateEvaluationView,
  CandidateGateEvaluationAggregate,
} from './candidateGateEvaluationView.js';
import type { Gate2ConfluenceSummary } from '../../../quant/gate2ConfluenceScore.js';
import type { Gate3RuntimeClosureSummary } from '../../../quant/gate3RuntimeClosure.js';
import type {
  UnifiedExecutionPermissionResolution,
  UnifiedExecutionPermissionAggregate,
} from '../../gates/unifiedExecutionContract.js';

export interface WaitDistribution {
  dataHold: number;
  preBreakout: number;
  gateFail: number;
  sizingBlocked: number;
  driftRemove: number;
  corpAction: number;
  volumeDrop: number;
  other: number;
}

export interface GatePassDistribution {
  gate1Pass: number;
  gate2Pass: number;
  gate3Pass: number;
  lastTriggerPass: number;
  gate1Unknown?: number;
}

export interface MacroGateState {
  emergencyStop: boolean;
  autoTradeEnabled: boolean;
  regime: string;
  kellyMultiplierFromRegime: number;
  fomcPhase: string;
  fomcKellyMultiplier: number;
  finalKellyMultiplier: number;
  vixGatingActive: boolean;
  bearDefenseMode: boolean;
  mhsBelow30: boolean;
  watchlistEmpty: boolean;
  sellOnlyMode: boolean;
  kospi20dReturn?: number;
  macroEntryOverrideActive?: boolean;
  macroEntryOverrideTargets?: string[];
  diagnosticLiveEntryBlocked?: boolean;
  liveEntryBlockedReason?: string;
  macroRegimeRaw?: string;
  macroRegimeEffective?: string;
  regimeSnapshotId?: string;
  regimeSnapshotAsOf?: string;
  regimeSnapshotTtlSec?: number;
  displayRegime?: string;
  riskOverride?: string;
  engineMode?: string;
  sourceHealth?: string;
  regimeConflicts?: string[];
  r6RecoveryStatus?: string;
  activeR6Triggers?: string[];
  r6ShockLatch?: boolean;
  latchDecayPercent?: number;
  mhs?: number;
  recoveryBlockedReason?: string;
  liveEntryAllowed?: boolean;
  liveExitAllowed?: boolean;
  shadowBuyAllowed?: boolean;
  shadowSellAllowed?: boolean;
  shadowLearningAllowed?: boolean;
  counterfactualAllowed?: boolean;
  diagnosticAllowed?: boolean;
  brokerOrderAllowed?: boolean;
  canonicalSession?: string;
  displaySession?: string;
  brokerRouteAlive?: boolean;
  brokerLiveOrderAllowed?: boolean;
  brokerExitOrderAllowed?: boolean;
  paperOrderAllowed?: boolean;
  shadowAllowed?: boolean;
}

export type DataPromotionLevel = 'OBSERVE' | 'SHADOW_SCORE' | 'ADVISORY' | 'WEIGHTED' | 'GATED' | 'CORE';

export interface DataPromotionStatus {
  kisInvestorFlow: DataPromotionLevel;
  sectorEnergy: DataPromotionLevel;
  dartFinancials: DataPromotionLevel;
  yahooPrice: DataPromotionLevel;
}

export type PipelineStageName =
  | 'PRICE_FETCH'
  | 'DRIFT_CHECK'
  | 'DATA_HOLD_CHECK'
  | 'SERVER_GATE_EVALUATED'
  | 'GATE_LAYER_SUMMARY_BUILT'
  | 'GATE_ELIGIBILITY_CLASSIFIED'
  | 'RRR_CHECK'
  | 'SECTOR_EXPOSURE_CHECK'
  | 'POSITION_SLOT_CHECK'
  | 'COOLDOWN_CHECK'
  | 'ENEMY_CHECK'
  | 'APPROVAL_REQUESTED'
  | 'SHADOW_RECORDED'
  | 'LIVE_ORDER_REQUESTED'
  | 'LIVE_ORDER_BLOCKED'
  | 'LIVE_ORDER_SUBMITTED';

export type PipelineStageStatus = 'PASS' | 'FAIL' | 'BLOCKED' | 'SKIPPED' | 'SHADOW_ONLY' | 'DATA_UNAVAILABLE' | 'PROVIDER_DEGRADED';

export interface PipelineStageDropoffSummary {
  stage: PipelineStageName;
  pass: number;
  fail: number;
  blocked: number;
  skipped: number;
  shadowOnly: number;
  dataUnavailable: number;
  providerDegraded: number;
}

export const DEFAULT_DATA_PROMOTION_STATUS: DataPromotionStatus = {
  kisInvestorFlow: 'WEIGHTED',
  sectorEnergy: 'WEIGHTED',
  dartFinancials: 'ADVISORY',
  yahooPrice: 'GATED',
};

export interface EntryLaneSplitCounts {
  liveCandidates?: number;
  liveOrderCreated?: number;
  liveCreatedDeprecated?: number;
  liveBlockedByPolicy?: number;
  shadowDiagnosticCreated?: number;
  shadowOrderCreated?: number;
  paperExecutableCreated?: number;
  paperObservationalCreated?: number;
  counterfactualCreated?: number;
  watchOnlyPreserved?: number;
}

export interface ScanSummary {
  time: string;
  candidates: number;
  trackB: number;
  swing: number;
  catalyst: number;
  momentum: number;
  yahooFails: number;
  gateMisses: number;
  rrrMisses: number;
  entries: number;
  candidateScanTrigger?: ShadowCandidateScanTrigger;
  waitDistribution?: WaitDistribution;
  macroGateState?: MacroGateState;
  scanEvaluation?: ScanEvaluationResult;
  snapshotId?: string;
  sourceSnapshotDataHealth?: SourceSnapshotDataHealth;
  scoreConfidenceSplit?: ScoreBreakdown;
  snapshotForensics?: SnapshotForensicAlert[];
  emptyScanReason?: EmptyScanReason;
  emptyScanRootCause?: EmptyScanRootCauseDashboardAdr0500;
  weekendReplaySummaryAdr0501?: WeekendReplaySummaryAdr0501;
  gatePassDistribution?: GatePassDistribution;
  sectorEnergyQuality?: 'OK' | 'PARTIAL' | 'STALE' | 'DEGRADED' | 'FAILED';
  validSectorCount?: number;
  sectorEnergyReasons?: string[];
  r3ViolationState?: R3ViolationStateResult;
  frozenQuote?: FrozenQuoteResult;
  r3StreakSkipped?: { skipped: boolean; reason?: StreakSkipReason };
  freshConditionAttribution?: import('../freshScanBlockerAttribution.js').FreshScanBlockerAttribution;
  freshGate2Attribution?: import('../gate2LeadershipAttribution.js').Gate2FreshAttribution;
  sectorEnergyQualityDiagnostic?: SectorEnergyQualityDiagnostic;
  gate1MinimumSignalForensicAdr0505?: Gate1MinimumSignalForensicSummaryAdr0505;
  gateDecisionRouter?: GateDecisionRouterResult;
  provisionalShadowLane?: ProvisionalShadowSectionInput;
  counterfactualShadowLearning?: CounterfactualShadowSectionInput;
  r6ShadowEntryPolicy?: R6ShadowEntryPolicySummary;
  entryFilterDecomposition?: EntryFilterDecomposition;
  perSymbolSupplyInjection?: PerSymbolSupplyInjectionStats;
  priceIntegrity?: {
    totalSamples: number;
    statusCounts: Record<PriceIntegrityStatus, number>;
    topAffected: Array<{ symbol: string; status: PriceIntegrityStatus }>;
  };
  priceCorrection?: {
    totalSamples: number;
    correctionTypeCounts: Record<PriceCorrectionType, number>;
    averageConfidence: number;
    dropGapCalculationCount: number;
    shadowOnlySuggestedCount: number;
  };
  liveEligibleCount?: number;
  shadowObservableCount?: number;
  dataUnavailableBlockedCount?: number;
  providerDegradedObservableCount?: number;
  trueGateFailCount?: number;
  hardRiskBlockedCount?: number;
  gate2SoftLeadershipLane?: {
    gate1HardSurvivors: number;
    minSignalLivePass: number;
    gate2PendingPreserved: number;
    labels: string[];
    shadowObservablePreserved: boolean;
    watchPreserved: boolean;
    counterfactualRecorded: boolean;
    executionImpact: 'NONE';
  };
  r3NoiseDecision?: R3NoiseGovernorDecision;
  preBreakoutWaitSummary?: PreBreakoutWaitSummary;
  shadowNearBreakoutCreated?: number;
  shadowNearBreakoutBlocked?: number;
  shadowNearBreakoutBlockReasons?: Partial<Record<string, number>>;
  gateScoreHealth?: GateScoreHealthSummary;
  gateScoreCandidateBuckets?: GateScoreCandidateBucketSummary;
  gateLayerAudit?: GateLayerAuditSummary;
  gateDiagnostics?: GateDiagnosticCarrySummary;
  dataPromotionStatus?: DataPromotionStatus;
  perStageDropoffSummary?: PipelineStageDropoffSummary[];
  gateReclassificationDryRun?: GateReclassificationDryRunSummary;
  positiveScoreStarvation?: PositiveScoreStarvationReport;
  scoreCeilingRepair?: Gate1ScoreCeilingRepairReport;
  penaltyDeduplication?: PenaltyDeduplicationReport;
  riskDoubleCount?: RiskDoubleCountAuditReport;
  finalGate1Calibration?: FinalGate1CalibrationAuditReport;
  gate1ScoringAlignment?: Gate1ScoringAlignmentReport;
  gate1PositiveSourceWiring?: Gate1PositiveSourceWiringReport;
  gate1DryRunObservationLedger?: Gate1DryRunObservationSummary;
  investorFlowProviderRouter?: InvestorFlowProviderRouteResult;
  naverInvestorTrendAdr0481?: NaverInvestorTrendCollectorResult;
  semanticNetBuyNormalizationAdr0482?: SemanticNetBuyNormalizationReportAdr0482;
  supplySourceFreshnessAdr0483?: import('../supplySourceFreshnessAdr0483.js').SupplySourceFreshnessReportAdr0483;
  supplyCoverageRecoveryAdr0484?: SupplyCoverageRecoveryObservationReportAdr0484;
  supplyAdvisoryReadinessAdr0485?: SupplyAdvisoryReadinessReportAdr0485;
  supplyRecoveryRuntimeMountAdr0486?: SupplyRecoveryRuntimeMountReportAdr0486;
  freshDataSupplyAdr0487?: FreshDataSupplyReportAdr0487;
  sectorEnergySupplyUnknownAdr0488?: SectorEnergyAndSupplyUnknownPolicyReportAdr0488;
  investorFlowSampleAdr0489?: InvestorFlowSampleAcquisitionReportAdr0489;
  supplySnapshotStoreAdr0491?: SupplySnapshotReplayResultAdr0491;
  canonicalRuntimeResolution?: CanonicalRuntimeResolutionStep27;
  candidatePool?: CandidatePoolResult;
  paperEntryForensic?: PaperEntryForensicSummary;
  // ADR-0526 Phase 1a — per-candidate Gate0/1/2/3 판단 정본 (가산만, 기존 필드 무변경).
  // 생산자(persistScanResults)가 도출·영속. 소비자(formatter)는 1b 에서 read 로 재바인딩.
  candidateGateViews?: CandidateGateEvaluationView[];
  candidateGateAggregate?: CandidateGateEvaluationAggregate;
  // ADR-0526 Phase 1b — gate2 confluence 정본 스냅샷(스캔-시점, gate2 캐시 미사용 → 결정론).
  // formatter(scanBlockersGate2/Gate3)가 buildGate2ConfluenceSummary 를 재실행하지 않고 본 필드를 read.
  candidateGate2Confluence?: Gate2ConfluenceSummary;
  // ADR-0526 Phase 1b — gate3 runtime closure 정본 스냅샷(스캔-시점, gate2 캐시 미사용 → 결정론).
  // formatter(scanBlockersGate3)가 buildGate3RuntimeClosureSummary 를 재실행하지 않고 본 필드를 read.
  candidateGate3Closure?: Gate3RuntimeClosureSummary;
  // ADR-0527 Phase 2a — per-candidate 통합 실행허가 정본(A resolveExecutionPermission byte-equivalent + B 라벨 병합).
  // 스캔-시점(실제 asOf, 더미 1970 의존 0) 도출·영속. 소비자(formatter)는 Phase 2b 전까지 0 — 화면 무변화.
  candidateExecutionResolutions?: UnifiedExecutionPermissionResolution[];
  // ADR-0527 Phase 2a — 위 per-candidate 정본의 roll-up. permission(boolean)과 count(*Count/*Created) 명명 분리.
  executionResolutionAggregate?: UnifiedExecutionPermissionAggregate;
  // main(71e3c29) "split scan blocker entry lanes" — 진입 레인 분리 count.
  entryLaneSplit?: EntryLaneSplitCounts;
}

export type PaperEntryDecision = 'CREATED' | 'SKIPPED' | 'BLOCKED' | 'ERROR';

export type PaperEntryKind =
  | 'EXECUTABLE_PAPER_ENTRY'
  | 'OBSERVATIONAL_PAPER_ENTRY'
  | 'PRE_BREAKOUT_WATCH_ENTRY'
  | 'COUNTERFACTUAL_ENTRY';

export type PaperEntrySkipReason =
  | 'NONE'
  | 'INVALID_SYMBOL'
  | 'PRICE_MISSING'
  | 'NO_REFERENCE_PRICE'
  | 'DUPLICATE_PENDING_ORDER'
  | 'DUPLICATE_OPEN_POSITION'
  | 'COOLDOWN_ACTIVE'
  | 'BLACKLISTED'
  | 'PRICE_UNRESOLVED'
  | 'STALE_PRICE'
  | 'INVALID_ENTRY_PRICE'
  | 'SIZING_ZERO'
  | 'SIZING_ADVISORY_ONLY'
  | 'SESSION_POLICY_BLOCKED'
  | 'EXECUTION_PERMISSION_BLOCKED'
  | 'GATE2_PENDING_OBSERVE_ONLY'
  | 'PRE_BREAKOUT_WAIT_COOLDOWN'
  | 'PAPER_ENGINE_DISABLED'
  | 'PAPER_LEDGER_WRITE_FAILED'
  | 'POSITION_REGISTRY_WRITE_FAILED'
  | 'MISSING_SKIP_REASON_EMISSION'
  | 'FORENSIC_CARRY_BROKEN'
  | 'UNKNOWN_BUG';

export type PaperEntryDecisionStage =
  | 'CANDIDATE_SELECTED'
  | 'ELIGIBILITY_CHECK'
  | 'PRICE_RESOLUTION'
  | 'DUPLICATE_CHECK'
  | 'SIZING_CHECK'
  | 'ORDER_CREATION'
  | 'LEDGER_WRITE'
  | 'POSITION_REGISTRY_WRITE';

export interface PaperEntryCandidateForensic {
  symbol: string;
  name?: string;
  sourceSnapshotId?: string;
  candidateSetId?: string;
  gateScoreInputSnapshotId?: string;
  gate1HardSurvivor: boolean;
  minSignalLivePass: boolean;
  gate2PendingPreserved: boolean;
  shadowObservableStrict: boolean;
  shadowObservableSoft: boolean;
  paperEntryEligible: boolean;
  paperEntryDecision: PaperEntryDecision;
  paperEntrySkipReason?: PaperEntrySkipReason;
  paperEntrySkipStage?: string;
  duplicateKey?: string;
  existingOpenShadowPosition: boolean;
  existingPendingPaperOrder: boolean;
  resolvedEntryPrice?: number;
  priceSource?: string;
  quoteFreshness?: string;
  sizingAllowed: boolean;
  sizingReason?: string;
  executionPermission?: string;
  sessionPolicy?: string;
  paperEntryKind?: PaperEntryKind;
  paperExecutable?: boolean;
  promotionAllowed?: boolean;
  learningAllowed?: boolean;
}

export interface PaperEntryForensicSummary {
  decisionRecords?: PaperEntryDecisionRecord[];
  candidates?: PaperEntryCandidateForensic[];
  candidateSymbols?: string[];
  createdSymbols?: string[];
  skippedSymbols?: string[];
  skipReasonDistribution?: Record<string, number>;
  executionImpact?: 'NONE' | 'SHADOW_ONLY' | 'LIVE_BLOCKED';
  topSkipReason?: string;
}

export interface PaperEntryDecisionRecord {
  symbol: string;
  name?: string;
  sourceSnapshotId: string;
  candidateSetId: string;
  gateScoreInputSnapshotId: string;
  scanId: string;
  decision: PaperEntryDecision;
  stage: PaperEntryDecisionStage;
  skipReason: PaperEntrySkipReason;
  gate1HardSurvivor: boolean;
  minSignalLivePass: boolean;
  gate2PendingPreserved: boolean;
  shadowObservableStrict: boolean;
  shadowObservableSoft: boolean;
  paperEntryEligible: boolean;
  duplicateKey?: string;
  existingOpenShadowPosition: boolean;
  existingPendingPaperOrder: boolean;
  resolvedEntryPrice?: number;
  priceSource?: string;
  quoteFreshness?: string;
  sizingAllowed: boolean;
  sizingReason?: string;
  executionPermission: string;
  paperEntryKind?: PaperEntryKind;
  paperExecutable?: boolean;
  promotionAllowed?: boolean;
  learningAllowed?: boolean;
  createdOrderId?: string;
  ledgerRecordId?: string;
}
