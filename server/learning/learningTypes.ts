// @responsibility Learning Flow Unclog Patch v1 shared types — Ghost/Shadow virtual close, outcome, attribution, diagnostics
import type { ExecutionImpact } from '../runtime/engineRuntimePolicy.js';
import type { GhostPosition } from './reflectionTypes.js';
import type { RegimePhase } from '../shadow/regimeContext.js';

type LearningCaseKind = 'ghost' | 'shadow';
export type LearningCloseReason =
  | 'VIRTUAL_TAKE_PROFIT'
  | 'VIRTUAL_STOP_LOSS'
  | 'VIRTUAL_TRAILING_STOP'
  | 'VIRTUAL_TIME_EXIT'
  | 'VIRTUAL_SESSION_END_EXIT'
  | 'VIRTUAL_DATA_STALE_EXIT'
  | 'VIRTUAL_MANUAL_RECONCILE'
  | 'QUARANTINED_DATA_MISSING';
export type LearningOutcomeLabel = 'WIN' | 'LOSS' | 'BREAKEVEN' | 'ACTIVE' | 'EXPIRED' | 'DATA_CORRUPTED' | 'QUARANTINED' | 'MISSED_WIN' | 'AVOIDED_LOSS' | 'GOOD_BLOCK' | 'BAD_BLOCK' | 'NEUTRAL_BLOCK';
type LearningDataQuality = 'OK' | 'STALE' | 'MISSING' | 'CORRUPTED' | 'QUARANTINED';
export type LearningCohortType =
  | 'FRESH_SHADOW'
  | 'BACKLOG_REPAIR'
  | 'GHOST_REPAIR'
  | 'RECOVERED_METADATA'
  | 'QUARANTINED'
  | 'COUNTERFACTUAL_BLOCKED'
  | 'COUNTERFACTUAL_MISSED_WIN'
  | 'COUNTERFACTUAL_AVOIDED_LOSS'
  | 'GHOST_REPAIR_PENDING'
  | 'OPEN_UNRESOLVED';
export type LearningRecoveryConfidence = 'RECOVERED' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
export type RegimeRecoverySource =
  | 'STORED_CASE_REGIME'
  | 'MACRO_SNAPSHOT_BY_TIMESTAMP'
  | 'NEAREST_MACRO_SNAPSHOT'
  | 'INTRADAY_NEAREST_60M'
  | 'SAME_DAY_DAILY_REGIME'
  | 'PREVIOUS_TRADING_DAY_CLOSE'
  | 'PULSE_ARCHIVE_SAME_DATE'
  | 'RECONSTRUCTED_DAILY_REGIME'
  | 'REGIME_TRANSITION_STATE_BY_TIMESTAMP'
  | 'TRADING_DAY_REGIME'
  | 'R6_TRIGGER_BY_TIMESTAMP'
  | 'MARKET_SESSION_PHASE'
  | 'UNKNOWN_FALLBACK';
export type RegimeRecoveryConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
type IntegritySeverity = 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';
export type StarvationReason =
  | 'no_close'
  | 'close_without_label'
  | 'label_without_attribution'
  | 'attribution_threshold_too_high'
  | 'data_quarantine_too_many'
  | 'duplicate_suppression_too_strict'
  | 'none'
  | 'resolved';

export interface LearningGhostCase extends GhostPosition {
  id?: string;
  caseKind?: LearningCaseKind;
  entryAt?: string;
  entryPrice?: number;
  stopPrice?: number;
  targetPrice?: number;
  maxHoldingMinutes?: number;
  closeReason?: LearningCloseReason;
  closedAt?: string;
  exitPriceVirtual?: number;
  finalReturnPct?: number;
  returnR?: number;
  mfe?: number;
  mae?: number;
  outcomeLabel?: LearningOutcomeLabel;
  labelConfidence?: number;
  dataQuality?: LearningDataQuality;
  sourceConfidence?: number | LearningRecoveryConfidence | 'HIGH';
  attributionProcessed?: boolean;
  cohortType?: LearningCohortType;
  repairRunId?: string;
  cohortBackfilledAt?: string;
  cohortBackfillReason?: string;
  entryPriceRecovered?: boolean;
  targetStopRecovered?: boolean;
  priceDataRecovered?: boolean;
  recoverySource?: string;
  recoveryConfidence?: LearningRecoveryConfidence;
  recoveredAt?: string;
  recoveryReason?: string;
  holdingOutlierTag?: 'OUTLIER_HOLDING_TIME';
  executionImpact?: ExecutionImpact;
  pendingRetryReason?: string;
  quarantinedReason?: string;
  conditionScores?: Record<number, number>;
  rawRegime?: string;
  effectiveRegime?: string;
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
}

export interface PriceSnapshot {
  price?: number | null;
  high?: number | null;
  low?: number | null;
  close?: number | null;
  at?: string;
  stale?: boolean;
}

export interface GhostCloseResolverResult {
  runId: string;
  lastRunAt: string;
  candidatesScanned: number;
  closed: number;
  pendingRetry: number;
  quarantined: number;
  closedIds: string[];
  brokerOrdersCreated: 0;
}

export interface OutcomeFinalizerResult {
  scanned: number;
  finalized: number;
  skipped: number;
  warnings: string[];
  conditionWeightsChanged: 0;
}

export interface AttributionBackfillResult {
  runId: string;
  processedCount: number;
  skippedCount: number;
  skipReasons: Record<string, number>;
  attributionSamples7d: number;
  attributionSamples14d: number;
  attributionSamples30d: number;
  targetSampleCount: number;
  starvationFlag: boolean;
}

export interface StarvationAnalysis {
  starvationFlag: boolean;
  targetSampleCount: number;
  samples7d: number;
  reasons: Record<StarvationReason, number>;
  primaryReason: StarvationReason;
  previousStarvationReason?: StarvationReason;
  recommendedAction: string;
}

export interface SuggestDiagnosticProposal {
  id: string;
  createdAt: string;
  channel: string;
  currentThreshold: number;
  observedScore: number;
  sampleSize: number;
  blocker: string;
  recommendation: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  autoApply: false;
}

export interface GeminiLearningSchedule {
  callsThisMonth: number;
  tradingDaysThisMonth: number;
  utilizationRate: number;
  lastCallAt?: string;
  nextScheduledAt?: string;
  retryScheduledAt?: string;
  diagnostic?: string;
  recommendationOnly: true;
  conditionWeightsChanged: 0;
}

export interface LearningIntegrityEvent {
  id: string;
  at: string;
  check: string;
  severity: IntegritySeverity;
  message: string;
  caseId?: string;
}
