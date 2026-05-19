// @responsibility Regime learning bank public diagnostic data shapes.
import type { CounterfactualShadowLearningLedgerEntry } from '../persistence/counterfactualShadowLearningRepo.js';
import type { ServerAttributionRecord } from '../persistence/attributionRepo.js';
import type { ShadowCaseLedgerStore } from '../shadow/shadowCaseLedger.js';
import type { ShadowCase } from '../shadow/shadowTypes.js';
import type { RegimePhase } from '../shadow/regimeContext.js';
import type { CounterfactualEntry } from './counterfactualShadow.js';
import type { LearningGhostCase } from './learningTypes.js';
import type {
  DailyRegimeFallbackStatus,
  RegimeDailySnapshot,
  RegimeSnapshotReconstructionLogEntry,
  RegimeSourceInventoryAuditStatus,
  RegimeSourceInventoryRow,
  PriorityDateReconstructionStatus,
  RegimeSnapshotCoverage,
} from './regimeLearningBackfill.js';

export { type RegimePhase } from '../shadow/regimeContext.js';

export const REGIME_LEARNING_PHASES: RegimePhase[] = [
  'R1_RECOVERY',
  'R2_EARLY',
  'R3_EXPANSION',
  'R4_NEUTRAL',
  'R5_CAUTION',
  'R6_DEFENSE',
  'SELL_ONLY',
  'HARD_BLOCK',
  'SHADOW_ONLY',
  'OBSERVE_ONLY',
  'MARKET_CLOSED',
  'UNKNOWN',
];

export type OverfitRisk = 'LOW' | 'MEDIUM' | 'HIGH';
export type RegimeLearningQualityStatus =
  | 'NO_SAMPLE'
  | 'LOW_SAMPLE'
  | 'LOW_RESOLVED_SAMPLE'
  | 'PENDING_DOMINATED'
  | 'LOW_CONFIDENCE'
  | 'ATTRIBUTION_INSUFFICIENT'
  | 'LEARNING'
  | 'DIAGNOSTIC_READY'
  | 'STABLE_CANDIDATE'
  | 'OVERFIT_RISK'
  | 'DATA_QUALITY_LOW';

export type RegimeExpectancyConfidence = 'N/A' | 'VERY_LOW' | 'LOW' | 'MEDIUM' | 'HIGH';
export type RegimeAttributionConfidence = 'INSUFFICIENT' | 'LOW' | 'ENOUGH_FOR_REVIEW';

export type RegimeConditionDirection =
  | 'ALPHA_DRIVER'
  | 'RISK_PROTECTOR'
  | 'FALSE_COMFORT'
  | 'NOISE'
  | 'INSUFFICIENT_SAMPLE';

export interface RegimeConditionAttribution {
  conditionId: string;
  conditionName: string;
  regimePhase: RegimePhase;
  samples: number;
  highSamples: number;
  lowSamples: number;
  winRate: number;
  expectancyR: number;
  effect: number | 'N/A';
  avgReturnR: number;
  confidence: 'LOW_SAMPLE' | 'LOW_CONFIDENCE' | 'ENOUGH_FOR_REVIEW';
  minSamplePassed: boolean;
  overfitFlag: boolean;
  direction: RegimeConditionDirection;
  recommendation: string;
}

export interface RegimeSourceFamilyStats {
  sampleSize: number;
  closedCount: number;
  expectancyR: number;
}

export interface RegimeLearningQuality {
  regimePhase: RegimePhase;
  sampleSize: number;
  totalSampleSize: number;
  resolvedSampleSize: number;
  closedOutcomeCount: number;
  pendingCounterfactualCount: number;
  pendingShadowCount: number;
  pendingOpenCount: number;
  quarantinedCount: number;
  attributableSampleSize: number;
  unresolvedRatio: number;
  resolvedRatio: number;
  pendingRatio: number;
  closedSampleCount: number;
  labelCompletionRate: number;
  sourceConfidenceHighRatio: number;
  unknownRatio: number;
  dataQualityScore: number;
  conditionCoverage: number;
  counterfactualCoverage: number;
  freshShadowCoverage: number;
  overfitRisk: OverfitRisk;
  qualityStatus: RegimeLearningQualityStatus;
}

export interface RegimeLearningStats {
  regimePhase: RegimePhase;
  sampleSize: number;
  totalSampleSize: number;
  resolvedSampleSize: number;
  closedOutcomeCount: number;
  pendingCounterfactualCount: number;
  pendingShadowCount: number;
  pendingOpenCount: number;
  quarantinedCount: number;
  attributableSampleSize: number;
  unresolvedRatio: number;
  resolvedRatio: number;
  pendingRatio: number;
  freshShadowCount: number;
  counterfactualCount: number;
  ghostRepairCount: number;
  closedCount: number;
  winCount: number;
  lossCount: number;
  breakevenCount: number;
  winRate: number;
  avgReturnR: number;
  expectancyR: number;
  avgMFE: number;
  avgMAE: number;
  avgHoldingMinutes: number;
  labelCompletionRate: number;
  dataQualityScore: number;
  sourceConfidenceHighRatio: number;
  unknownRatio: number;
  conditionCoverage: number;
  counterfactualCoverage: number;
  freshShadowCoverage: number;
  overfitRisk: OverfitRisk;
  qualityStatus: RegimeLearningQualityStatus;
  expectancyConfidence: RegimeExpectancyConfidence;
  attributionConfidence: RegimeAttributionConfidence;
  expectancyReason?: 'NO_RESOLVED_SAMPLE';
  whyNotReliable: string;
  reliabilityWarning?: string;
  quality: RegimeLearningQuality;
  promotionStage: 'SHADOW_SCORE' | 'ADVISORY';
  promotionAllowed: false;
  diagnosticOnly: true;
  recommendationOnly: true;
  topCondition?: string;
  worstCondition?: string;
  bestSector?: string;
  worstSector?: string;
  topSector?: string;
  topPositiveConditions: RegimeConditionAttribution[];
  topNegativeConditions: RegimeConditionAttribution[];
  lowSampleConditions: RegimeConditionAttribution[];
  unstableConditions: RegimeConditionAttribution[];
  conditionAttributions: RegimeConditionAttribution[];
  topSectors: Array<{ sector: string; samples: number; expectancyR: number }>;
  worstSectors: Array<{ sector: string; samples: number; expectancyR: number }>;
  bestSymbols: Array<{ symbol: string; name: string; returnR: number }>;
  worstSymbols: Array<{ symbol: string; name: string; returnR: number }>;
  commonFailureReasons: Array<{ reason: string; count: number }>;
  counterfactualLabelBreakdown: Record<string, number>;
  bestConditionCombo?: string;
  worstConditionCombo?: string;
  bestPattern?: string;
  worstPattern?: string;
  bestTimeWindow?: string;
  worstTimeWindow?: string;
  bestMarketSession?: string;
  commonFailureReason?: string;
  survivorPattern?: string;
  earlyLeaderPattern?: string;
  volumeAccumulationPattern?: string;
  firstBreakoutPattern?: string;
  falseStartRisk?: string;
  trendContinuationPattern?: string;
  vcpBreakoutPattern?: string;
  pullbackBuyPattern?: string;
  overheatBreakoutRisk?: string;
  breakoutPattern?: string;
  reversalPattern?: string;
  chopAvoidancePattern?: string;
  drawdownDefensePattern?: string;
  recoverySpeedPattern?: string;
  supplyRetentionPattern?: string;
  deadCatBounceRisk?: string;
  sourceConfidenceBreakdown: Record<string, number>;
  freshShadowStats: RegimeSourceFamilyStats;
  ghostRepairStats: RegimeSourceFamilyStats;
  counterfactualStats: RegimeSourceFamilyStats;
  outcomeStats: RegimeSourceFamilyStats;
  attributionStats: RegimeSourceFamilyStats;
  nextLearningNeed: string;
  blocker?: string;
}

export interface RegimeLearningBank {
  activeRegime: string;
  rawRegime: string;
  effectiveRegime: string;
  shadowLearningAllowed: true;
  stats: RegimeLearningStats[];
  bestRegimeByExpectancy?: RegimePhase;
  worstRegimeByExpectancy?: RegimePhase;
  activeRegimePhase: RegimePhase;
  activeRegimeSampleSize: number;
  activeRegimeTotalSampleSize: number;
  activeRegimeResolvedSampleSize: number;
  activeRegimePendingCounterfactualCount: number;
  activeRegimeAttributableSampleSize: number;
  activeRegimeExpectancyR: number;
  activeRegimeTopPattern: string;
  activeRegimeLearningNeed: string;
  activeRegimeWhyNotReliable: string;
  regimeLearningSampleSize: number;
  regimeAssignedCount: number;
  unknownRegimeCount: number;
  recoveredLowConfidenceRegimeCount: number;
  trueUnknownRegimeCount: number;
  unknownRatio: number;
  unknownRatioRaw: number;
  recoveredLowConfidenceRegimeRatio: number;
  recoveredFromOriginalUnknownCount: number;
  recoveredFromAdditionalRepairLaneCount: number;
  recoveredTotalCount: number;
  trueUnknownRatio: number;
  regimeRatioDenominator: 'regimeLearningSampleSize';
  regimeRatioDenominatorValue: number;
  activeRegimeQualityStatus: RegimeLearningQualityStatus;
  regimeBankConsistency: 'OK' | 'MISMATCH';
  duplicateCaseCount: number;
  regimeDuplicateCandidates: number;
  regimeDuplicateSuppressed: number;
  regimeDuplicatePreventedAtSource: number;
  regimeDuplicateSuppressedAfterInsert: number;
  regimeDedupStatus: 'NONE' | 'ACTIVE';
  regimeBackfillTargetUnknownCount: number;
  regimeBackfillAttemptedTotal: number;
  regimeBackfillAttemptedUnique: number;
  regimeBackfillAttemptedDuplicates: number;
  attemptedOverTargetReason: string;
  regimeBackfillAttempted: number;
  regimeBackfillRecovered: number;
  regimeBackfillFailed: number;
  regimeBackfillFailedPromotionEligibleCount: number;
  regimeBackfillFailedExcludedCount: number;
  regimeBackfillFailedExcludedByLane: Record<string, number>;
  regimeBackfillFailedExcludedReason: string;
  regimeBackfillWindowMinutes: number;
  regimeBackfillRecoveredBySource: Record<string, number>;
  regimeBackfillRecoveredByConfidence: Record<string, number>;
  regimeBackfillFailedAfterDailyFallback: number;
  regimeBackfillFailureTopReasonsAfterDailyFallback: string[];
  regimeBackfillFailureTopReasons: string[];
  regimeBackfillFailureBySourceLane: Record<string, number>;
  regimeBackfillFailureByTimestampSource: Record<string, number>;
  regimeBackfillFailureByTradingDate: Record<string, number>;
  regimeSnapshotCoverageByTradingDate: Record<string, RegimeSnapshotCoverage>;
  missingRegimeSnapshotDates: string[];
  dailyRegimeFallbackStatus: DailyRegimeFallbackStatus;
  regimeSnapshotReconstructionAttemptedDates: string[];
  regimeSnapshotReconstructionSucceededDates: string[];
  regimeSnapshotReconstructionFailedDates: string[];
  regimeSnapshotReconstructionSourceBreakdown: Record<string, number>;
  regimeSnapshotReconstructionConfidenceBreakdown: Record<string, number>;
  regimeSourceInventoryByDate: Record<string, RegimeSourceInventoryRow>;
  regimeSourceInventoryTopAvailable: string[];
  regimeSourceInventoryMissingSources: Record<string, string[]>;
  regimeSourceInventoryAuditStatus: RegimeSourceInventoryAuditStatus;
  regimeSnapshotReconstructionPriorityDate: string;
  priorityDateReconstructionStatus: PriorityDateReconstructionStatus;
  priorityDateRecoveredSampleCount: number;
  priorityDateFailureReason: string;
  postReconstructionTrueUnknownRatio: number;
  regimePromotionStillBlocked: boolean;
  regimePromotionBlockReason: string;
  regimePromotionAllowedForDiagnostic: boolean;
  regimePromotionAllowedForAdvisory: boolean;
  corePromotionAllowed: boolean;
  corePromotionBlocker: string;
  suggestPromotionBlocker: string;
  primaryLearningBlocker: string;
  secondaryLearningBlockers: string[];
  nextRequiredEvent: string;
  regimeBackfillFailureSampleKeys: string[];
  regimeDuplicateSourceTop3: string[];
  regimeDuplicateKeySample: string[];
  regimeDuplicateRootCause: string;
  sourceCounts: {
    freshShadow: number;
    ghostRepair: number;
    counterfactual: number;
    outcome: number;
    attribution: number;
  };
  byConfidence: Record<string, number>;
  R1QualityStatus: RegimeLearningQualityStatus;
  R2QualityStatus: RegimeLearningQualityStatus;
  R3QualityStatus: RegimeLearningQualityStatus;
  R4QualityStatus: RegimeLearningQualityStatus;
  R5QualityStatus: RegimeLearningQualityStatus;
  R6QualityStatus: RegimeLearningQualityStatus;
  R2ResolvedSampleSize: number;
  R3ResolvedSampleSize: number;
  R6ResolvedSampleSize: number;
  R6ResolvedPromotionMin: number;
  R6PromotionGateSatisfied: boolean;
  R6PromotionBlocker: string;
  R2PendingCounterfactualCount: number;
  R3PendingCounterfactualCount: number;
  R6PendingCounterfactualCount: number;
  nextRegimeMaturityAt?: string;
  regimesNeedingAttributionRecalc: string[];
  regimeLearningNextAction: string;
  nextRegimeLearningAction: string;
  unknownReductionNeeded: boolean;
  recommendationOnly: true;
  promotionAllowed: false;
  executionImpact: 'NONE';
  brokerOrdersCreated: 0;
}

export interface CollectRegimeLearningInput {
  now?: Date;
  ledger?: ShadowCaseLedgerStore;
  shadowCases?: ShadowCase[];
  counterfactualEntries?: CounterfactualShadowLearningLedgerEntry[];
  legacyCounterfactualEntries?: CounterfactualEntry[];
  ghostCases?: LearningGhostCase[];
  attributionRecords?: ServerAttributionRecord[];
  dailyRegimeSnapshots?: RegimeDailySnapshot[];
  pulseArchiveSnapshots?: RegimeDailySnapshot[];
  pulseArchiveRegimeSnapshots?: RegimeDailySnapshot[];
  reconstructionLogEntries?: RegimeSnapshotReconstructionLogEntry[];
  includePersistedSources?: boolean;
  rawRegime?: string;
  effectiveRegime?: string;
}

export interface RegimeLearningConsistency {
  totalLearningCases: number;
  regimeLearningSampleSize: number;
  regimeAssignedCount: number;
  unknownRegimeCount: number;
  unknownRatio: number;
  trueUnknownRatio: number;
  regimeBankSampleCount: number;
  ghostRepairCountInBank: number;
  counterfactualCountInBank: number;
  outcomeCountInBank: number;
  attributionCountInBank: number;
  duplicateCaseCount: number;
  regimeSumMatchesTotal: boolean;
  byRegime: Record<string, number>;
  byConfidence: Record<string, number>;
  metricWarnings: string[];
  nextAction: string;
  executionImpact: 'NONE';
  brokerOrdersCreated: 0;
  promotionAllowed: false;
}

export interface RegimeMaturityByRegime {
  regimePhase: RegimePhase;
  pendingOutcomeCount: number;
  maturedNowCount: number;
  dueToday: number;
  dueNextTradingDay: number;
  dueIn2to3CalendarDays: number;
  dueIn4to7CalendarDays: number;
  dueIn8to14CalendarDays: number;
  dueAfter14CalendarDays: number;
  nearestMaturityAt?: string;
  largestMaturityBucket: string;
}

export interface RegimeResolvedStatusRow {
  regimePhase: RegimePhase;
  totalSampleSize: number;
  resolvedSampleSize: number;
  pendingCounterfactualCount: number;
  pendingMaturityCount: number;
  dueWithin1d: number;
  dueWithin3d: number;
  dueWithin7d: number;
  nextMaturityAt?: string;
  nextResolveAt?: string;
  attributableSampleSize: number;
  qualityStatus: RegimeLearningQualityStatus;
  nextAction: string;
}

export interface RegimeResolvedStatus {
  rows: RegimeResolvedStatusRow[];
  maturityByRegime: RegimeMaturityByRegime[];
  nextRegimeMaturityAt?: string;
  nextResolveAt?: string;
  executionImpact: 'NONE';
  brokerOrdersCreated: 0;
  promotionAllowed: false;
  recommendationOnly: true;
}

export interface RegimeAttributionRecalcResult {
  regimesNeedingRecalc: string[];
  resolvedDeltaByRegime: Record<string, number>;
  attributableSampleSizeByRegime: Record<string, number>;
  stillInsufficientRegimes: string[];
  expectedConditionUpdates: number;
  recalculatedRegimes?: string[];
  skippedLowSampleRegimes?: string[];
  conditionAttributionUpdated?: number;
  noWeightUpdate?: true;
  recommendationOnly: true;
  executionImpact: 'NONE';
  brokerOrdersCreated: 0;
  promotionAllowed: false;
}

export type RegimeCounterfactualEntry = CounterfactualShadowLearningLedgerEntry | {
  label?: string;
  outcomeLabel?: string;
  outcomeStatus?: string;
  createdAt?: string;
  createdAtKst?: string;
  signalTime?: string;
  signalDate?: string;
  maxHoldingMinutes?: number;
  maturityAt?: string;
  blockedBy?: string[];
  regime?: string;
  rawRegime?: string;
  effectiveRegime?: string;
  regimePhase?: RegimePhase;
  originalRegimePhase?: RegimePhase;
  regimeAtSignal?: RegimePhase | string;
  regimeAtEntry?: RegimePhase | string;
  regimeAtExit?: RegimePhase | string;
  regimeAtOutcome?: RegimePhase | string;
  entryRegime?: string;
  entryEffectiveState?: string;
  exitRegime?: string;
  resolvedAfterRegimeTransition?: boolean;
  transitionPath?: string[];
  r6LatchDecayAtEntry?: number | string;
  mhsAtEntry?: number;
  biasAtEntry?: string;
  supplyScoreAtEntry?: number;
  programFlowAtEntry?: number;
  outcomeR?: number;
  maturityWindow?: string;
  resolvedAt?: string;
  engineMode?: string;
  marketSession?: string;
  sellOnlyActive?: boolean;
  hardBlockActive?: boolean;
  blockedReason?: string;
  skipReason?: string;
  sourceFreshness?: string;
  regimeConfidence?: string;
  regimeRecoveryConfidence?: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
  regimeRecoverySource?: string;
  symbol?: string;
  stockCode?: string;
  stockName?: string;
  counterfactualKey?: string;
  id?: string;
};
