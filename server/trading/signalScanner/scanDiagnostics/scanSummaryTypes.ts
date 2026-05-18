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
import type { GateLayerAuditSummary } from './gateLayerDiagnostics.js';

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
  r3NoiseDecision?: R3NoiseGovernorDecision;
  preBreakoutWaitSummary?: PreBreakoutWaitSummary;
  shadowNearBreakoutCreated?: number;
  shadowNearBreakoutBlocked?: number;
  shadowNearBreakoutBlockReasons?: Partial<Record<string, number>>;
  gateScoreHealth?: GateScoreHealthSummary;
  gateScoreCandidateBuckets?: GateScoreCandidateBucketSummary;
  gateLayerAudit?: GateLayerAuditSummary;
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
}
