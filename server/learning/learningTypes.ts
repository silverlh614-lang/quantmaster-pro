// @responsibility Learning Flow Unclog Patch v1 shared types — Ghost/Shadow virtual close, outcome, attribution, diagnostics
import type { GhostPosition } from './reflectionTypes.js';

export type LearningCaseKind = 'ghost' | 'shadow';
export type ExecutionImpact = 'NONE' | 'PAPER' | 'LIVE';
export type LearningCloseReason =
  | 'VIRTUAL_TAKE_PROFIT'
  | 'VIRTUAL_STOP_LOSS'
  | 'VIRTUAL_TRAILING_STOP'
  | 'VIRTUAL_TIME_EXIT'
  | 'VIRTUAL_SESSION_END_EXIT'
  | 'VIRTUAL_DATA_STALE_EXIT'
  | 'VIRTUAL_MANUAL_RECONCILE'
  | 'QUARANTINED_DATA_MISSING';
export type LearningOutcomeLabel = 'WIN' | 'LOSS' | 'BREAKEVEN' | 'ACTIVE' | 'EXPIRED' | 'DATA_CORRUPTED' | 'QUARANTINED';
export type LearningDataQuality = 'OK' | 'STALE' | 'MISSING' | 'CORRUPTED' | 'QUARANTINED';
export type IntegritySeverity = 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';
export type StarvationReason =
  | 'no_close'
  | 'close_without_label'
  | 'label_without_attribution'
  | 'attribution_threshold_too_high'
  | 'data_quarantine_too_many'
  | 'duplicate_suppression_too_strict'
  | 'none';

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
  sourceConfidence?: number;
  attributionProcessed?: boolean;
  executionImpact?: ExecutionImpact;
  pendingRetryReason?: string;
  quarantinedReason?: string;
  conditionScores?: Record<number, number>;
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
