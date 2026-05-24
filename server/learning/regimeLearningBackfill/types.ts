// @responsibility Regime Learning Bank backfill diagnostic type/interface contracts.
import type { RegimePhase } from '../../shadow/regimeContext.js';
import type {
  RegimeRecoveryConfidence,
  RegimeRecoverySource,
} from '../learningTypes.js';
import type { ServerAttributionRecord } from '../../persistence/attributionRepo.js';
import type { CounterfactualEntry } from '../counterfactualShadow.js';
import type { LearningGhostCase } from '../learningTypes.js';

export type RegimeLearningBackfillTarget =
  | 'GHOST_REPAIR'
  | 'BACKLOG_REPAIR'
  | 'FRESH_SHADOW'
  | 'COUNTERFACTUAL'
  | 'OUTCOME'
  | 'ATTRIBUTION'
  | 'OPEN_UNRESOLVED'
  | 'QUARANTINED';

export type RegimeWritableRow = {
  id?: string;
  caseId?: string;
  signalId?: string;
  tradeId?: string;
  counterfactualKey?: string;
  symbol?: string;
  stockCode?: string;
  cohortType?: string;
  sourceType?: string;
  rawRegime?: string;
  effectiveRegime?: string;
  regime?: string;
  entryRegime?: string;
  regimePhase?: RegimePhase;
  originalRegimePhase?: RegimePhase;
  regimeAtSignal?: RegimePhase | string;
  regimeAtEntry?: RegimePhase | string;
  regimeAtExit?: RegimePhase | string;
  regimeAtOutcome?: RegimePhase | string;
  r6Trigger?: string;
  engineMode?: string;
  marketSession?: string;
  sellOnlyActive?: boolean;
  hardBlockActive?: boolean;
  sourceFreshness?: string;
  regimeConfidence?: string;
  regimeRecovered?: boolean;
  regimeRecoverySource?: RegimeRecoverySource;
  regimeRecoveryConfidence?: RegimeRecoveryConfidence;
  regimeRecoveredAt?: string;
  blockedReason?: string;
  rejectionReason?: string;
  skipReason?: string;
  closeReason?: string;
  outcomeLabel?: string;
  closed?: boolean;
  closedAt?: string;
  createdAt?: string;
  detectedAt?: string;
  updatedAt?: string;
  entryAt?: string;
  entryPrice?: number;
  entryPriceVirtual?: number;
  hypotheticalEntryPrice?: number;
  priceAtSignal?: number;
  signalTime?: string;
  signalDate?: string;
  lastUpdatedAt?: string;
  quarantinedReason?: string;
};

export interface RegimeLearningBackfillInput {
  ghosts?: LearningGhostCase[];
  counterfactuals?: CounterfactualEntry[];
  attributionRecords?: ServerAttributionRecord[];
  macroSnapshots?: RegimeTimestampSnapshot[];
  transitionSnapshots?: RegimeTimestampSnapshot[];
  dailyRegimeSnapshots?: RegimeDailySnapshot[];
  pulseArchiveSnapshots?: RegimeDailySnapshot[];
  pulseArchiveRegimeSnapshots?: RegimeDailySnapshot[];
  reconstructionLogEntries?: RegimeSnapshotReconstructionLogEntry[];
  shadowCases?: RegimeWritableRow[];
  now?: Date;
  write?: boolean;
}

export type RegimeBackfillFailureReason =
  | 'NO_SNAPSHOT_IN_WINDOW'
  | 'NO_RECONSTRUCTION_SOURCE_FOR_DATE'
  | 'MISSING_SAMPLE_TIMESTAMP'
  | 'SNAPSHOT_REPO_EMPTY'
  | 'TIMEZONE_MISMATCH_SUSPECT'
  | 'INVALID_TIMESTAMP'
  | 'DUPLICATE_SUPPRESSED_BEFORE_BACKFILL'
  | 'SOURCE_LANE_EXCLUDED'
  | 'UNKNOWN_ERROR';

export type RegimeBackfillTimestampSource =
  | 'SIGNAL_TIME'
  | 'ENTRY_AT'
  | 'DETECTED_AT'
  | 'CREATED_AT'
  | 'CLOSED_AT'
  | 'UPDATED_AT'
  | 'LAST_UPDATED_AT'
  | 'SIGNAL_DATE'
  | 'MISSING';

export type RegimeUnknownReason =
  | 'MISSING_CREATED_AT'
  | 'NO_MACRO_SNAPSHOT'
  | 'NO_TRANSITION_STATE'
  | 'PRE_REGIME_TRACKING_SAMPLE'
  | 'AMBIGUOUS_SESSION'
  | 'CORRUPTED_TIMESTAMP'
  | 'CASE_TYPE_NOT_SUPPORTED'
  | 'UNKNOWN_FALLBACK_USED';

export interface RegimeTimestampSnapshot {
  at: string;
  rawRegime: string;
  effectiveRegime?: string;
}

export interface RegimeDailySnapshot {
  tradingDate?: string;
  date?: string;
  at?: string;
  rawRegime: string;
  effectiveRegime?: string;
  riskOverride?: string;
  source?: string;
  confidence?: RegimeSnapshotReconstructionConfidence;
  reconstructed?: boolean;
  reconstructedAt?: string;
  executionImpact?: 'NONE';
}

export interface RegimeSnapshotCoverage {
  intradayNearest60m: number;
  sameDayDaily: number;
  previousTradingDayClose: number;
  pulseArchiveSameDate: number;
  reconstructedDaily: number;
}

export type RegimeSnapshotReconstructionSource =
  | 'TELEGRAM_PULSE_ARCHIVE'
  | 'REGIME_RESOLVER_DECISION_LOG'
  | 'MARKET_MACRO_SNAPSHOT_LOG'
  | 'R6_TRIGGER_LOG'
  | 'RISK_OVERRIDE_EVENT_LOG'
  | 'EFFECTIVE_REGIME_TRANSITION_LOG'
  | 'EXECUTION_POLICY_SNAPSHOT_LOG'
  | 'LEARNING_PULSE_ARCHIVE'
  | 'RAILWAY_APP_LOG_ARCHIVE';

export type RegimeSnapshotReconstructionConfidence = 'RECOVERED_LOW' | 'RECOVERED_MEDIUM';
export type RegimeSourceInventoryAuditStatus =
  | 'NO_MISSING_DATES'
  | 'PRIORITY_SOURCE_AVAILABLE'
  | 'PRIORITY_SOURCE_MISSING'
  | 'PARTIAL_SOURCE_AVAILABLE'
  | 'NO_SOURCES_AVAILABLE';

export type PriorityDateReconstructionStatus = 'SUCCESS' | 'FAILED' | 'UNRECOVERABLE' | 'NOT_ATTEMPTED';

export interface RegimeSourceInventoryRow {
  telegramPulseArchive: number;
  regimeResolverDecisionLog: number;
  marketMacroSnapshotLog: number;
  riskOverrideEventLog: number;
  r6TriggerLog: number;
  effectiveRegimeTransitionLog: number;
  executionPolicySnapshotLog: number;
  learningPulseArchive: number;
  railwayAppLogArchive: number;
}

export interface RegimeSnapshotReconstructionLogEntry {
  tradingDate?: string;
  at?: string;
  message?: string;
  rawRegime?: string;
  effectiveRegime?: string;
  riskOverride?: string;
  source?: string;
}

export type DailyRegimeFallbackStatus =
  | 'NO_UNKNOWN_SAMPLES'
  | 'OK'
  | 'USED_DAILY_FALLBACK'
  | 'NO_DAILY_SNAPSHOT_FOR_DATE';

export interface RegimeUnknownAnalysisResult {
  unknownTotal: number;
  unknownBySource: Record<string, number>;
  unknownByCaseType: Record<string, number>;
  unknownByDate: Record<string, number>;
  unknownReasonBreakdown: Record<RegimeUnknownReason, number>;
  missingTimestampCount: number;
  missingMacroSnapshotCount: number;
  missingTransitionStateCount: number;
  recoverableByNearestSnapshot: number;
  recoverableByTradingDayRegime: number;
  recoverableByR6Trigger: number;
  unrecoverableCount: number;
  recommendedFix: string;
  executionImpact: 'NONE';
  brokerOrdersCreated: 0;
  promotionAllowed: false;
}

export interface RegimeUnknownRepairResult {
  scannedUnknown: number;
  attemptedUnique: number;
  attemptedDuplicates: number;
  repaired: number;
  stillUnknown: number;
  byRecoveredRegime: Record<string, number>;
  recoverySourceBreakdown: Record<string, number>;
  recoveryConfidenceBreakdown: Record<string, number>;
  recoveredBySource: Record<string, number>;
  recoveredByConfidence: Record<string, number>;
  failedAfterDailyFallback: number;
  failureReasonBreakdownAfterDailyFallback: Record<RegimeBackfillFailureReason, number>;
  failureReasonBreakdown: Record<RegimeBackfillFailureReason, number>;
  failureBySourceLane: Record<string, number>;
  failureByTimestampSource: Record<RegimeBackfillTimestampSource, number>;
  failureByTradingDate: Record<string, number>;
  snapshotCoverageByTradingDate: Record<string, RegimeSnapshotCoverage>;
  missingRegimeSnapshotDates: string[];
  dailyRegimeFallbackStatus: DailyRegimeFallbackStatus;
  snapshotReconstructionAttemptedDates: string[];
  snapshotReconstructionSucceededDates: string[];
  snapshotReconstructionFailedDates: string[];
  snapshotReconstructionSourceBreakdown: Record<string, number>;
  snapshotReconstructionConfidenceBreakdown: Record<string, number>;
  reconstructedDailySnapshots: RegimeDailySnapshot[];
  sourceInventoryByDate: Record<string, RegimeSourceInventoryRow>;
  sourceInventoryTopAvailable: string[];
  sourceInventoryMissingSources: Record<string, string[]>;
  sourceInventoryAuditStatus: RegimeSourceInventoryAuditStatus;
  snapshotReconstructionPriorityDate: string;
  priorityDateReconstructionStatus: PriorityDateReconstructionStatus;
  priorityDateRecoveredSampleCount: number;
  priorityDateFailureReason: string;
  telegramArchiveCountByDate: Record<string, number>;
  telegramArchiveRegimePatternMatchedByDate: Record<string, number>;
  telegramArchiveEffectiveRegimeExtractedByDate: Record<string, number>;
  telegramArchiveRejectedNoRegimeByDate: Record<string, number>;
  telegramArchiveParseFailureTopReasons: string[];
  priorityDateTelegramArchiveCount: number;
  priorityDateRegimePatternMatched: number;
  priorityDateEffectiveRegimeExtracted: number;
  priorityDateTelegramParseFailureReason: string;
  failureSampleKeys: string[];
  executionImpact: 'NONE';
  brokerOrdersCreated: 0;
  promotionAllowed: false;
}

export interface RegimeLearningBackfillDryRunResult {
  scannedTotal: number;
  missingRegimePhase: number;
  recoverableByStoredSnapshot: number;
  recoverableByTimestampMacroState: number;
  recoverableByRegimeTransitionState: number;
  recoverableByR6Trigger: number;
  recoverableByCurrentRegimeFallback: 0;
  unrecoverable: number;
  expectedByRegime: Record<string, number>;
  expectedUnknown: number;
  executionImpact: 'NONE';
  brokerOrdersCreated: 0;
}

export interface RegimeLearningBackfillRunResult extends RegimeLearningBackfillDryRunResult {
  updated: number;
  byRegime: Record<string, number>;
  unknownCount: number;
  recoverySourceBreakdown: Record<string, number>;
  recoveryConfidenceBreakdown: Record<string, number>;
  promotionAllowed: false;
}
