/**
 * @responsibility ADR-0493 Data Promotion Readiness Audit shared types.
 *
 * These types describe audit-only readiness evaluation for Fresh Data Supply
 * Layer data lines. They intentionally contain no collection, scheduler, order,
 * or live-gate mutation contracts.
 */
export type DataLineStage =
  | 'OBSERVE'
  | 'SHADOW_RAW'
  | 'SHADOW_SCORE'
  | 'ADVISORY'
  | 'WEIGHTED'
  | 'GATED'
  | 'CORE';

export type PromotionAuditStatus =
  | 'PASS'
  | 'FAIL'
  | 'WARN'
  | 'BLOCKED'
  | 'INSUFFICIENT_DATA';

export type PromotionDecision =
  | 'ALLOW_PROMOTION'
  | 'DENY_PROMOTION'
  | 'ALLOW_WITH_WARNING'
  | 'KEEP_CURRENT_STAGE'
  | 'DEMOTE';

export type PromotionBlockReason =
  | 'INSUFFICIENT_HISTORY'
  | 'HIGH_MISSING_RATE'
  | 'STALE_MISCLASSIFICATION'
  | 'PROVIDER_MARKET_SIGNAL_MIXED'
  | 'NEGATIVE_SHADOW_CONTRIBUTION'
  | 'LIVE_REGRESSION_RISK'
  | 'EXECUTION_IMPACT_NOT_NONE'
  | 'NULL_ZERO_CONTAMINATION'
  | 'HOLIDAY_FRESHNESS_MISCLASSIFIED'
  | 'MISSING_TEST_COVERAGE'
  | 'CORE_PROMOTION_NOT_ALLOWED'
  | 'UNKNOWN';

export type DataPromotionSourceType =
  | 'SECTOR_ENERGY'
  | 'INVESTOR_FLOW'
  | 'PROGRAM_TRADING'
  | 'SUPPLY_SNAPSHOT'
  | 'FRESH_DATA_SCHEDULER'
  | 'MACRO'
  | 'NEWS'
  | 'UNKNOWN';

export type ExecutionImpact = 'NONE' | 'DIAGNOSTIC_ONLY' | 'ADVISORY_ONLY' | 'SCORING_ONLY' | 'ORDER' | 'GATE' | 'BLOCK' | 'UNKNOWN';

export interface DataPromotionAuditInput {
  dataLineId: string;
  dataLineName: string;
  sourceType: DataPromotionSourceType;

  currentStage: DataLineStage;
  requestedNextStage: DataLineStage;

  tradingDaysObserved: number;
  totalSnapshots: number;
  missingSnapshotCount: number;
  staleSnapshotCount: number;
  staleMisclassificationCount: number;

  providerFailureCount: number;
  providerMarketSignalMixedCount: number;

  shadowWinRate?: number | null;
  shadowAverageReturn?: number | null;
  shadowContributionScore?: number | null;

  liveRegressionPassed: boolean;
  nullZeroSeparationPassed: boolean;
  holidayFreshnessPassed: boolean;
  executionImpactNonePassed: boolean;
  testCoveragePassed: boolean;

  latestExecutionImpact: ExecutionImpact;

  /** Optional schema evidence for OBSERVE → SHADOW_RAW audits. Defaults to true for legacy snapshots. */
  providerHealthFieldPresent?: boolean;
  /** Optional schema evidence for OBSERVE → SHADOW_RAW audits. Defaults to true for legacy snapshots. */
  freshnessFieldPresent?: boolean;
  /** Optional persistence evidence for snapshot replay/readiness. Defaults to totalSnapshots > 0. */
  snapshotRecordable?: boolean;
  /** Optional manual approval marker for future stages. ADR-0493 still blocks CORE by default. */
  manualApprovalRecorded?: boolean;
}

export interface DataPromotionRequirements {
  currentStage: DataLineStage;
  requestedNextStage: DataLineStage;
  minTradingDays: number;
  maxMissingRate: number | null;
  maxStaleMisclassifications: number | null;
  minSnapshots: number;
  requireProviderHealthField: boolean;
  requireFreshnessField: boolean;
  requireSnapshotRecordable: boolean;
  requireProviderMarketSeparation: boolean;
  requirePositiveShadowContribution: boolean;
  requireStablePositiveShadowContribution: boolean;
  requireLiveRegression: boolean;
  requireNullZeroSeparation: boolean;
  requireHolidayFreshness: boolean;
  requireExecutionImpactNonePassed: boolean;
  requireTestCoverage: boolean;
  automaticPromotionAllowed: boolean;
  requiredScore: number;
  description: string;
}

export interface DataPromotionAuditResult {
  auditId: string;
  dataLineId: string;
  auditedAt: string;

  currentStage: DataLineStage;
  requestedNextStage: DataLineStage;

  status: PromotionAuditStatus;
  decision: PromotionDecision;

  score: number;
  requiredScore: number;

  passedChecks: string[];
  warnings: string[];
  blockReasons: PromotionBlockReason[];

  canPromote: boolean;
  recommendedStage: DataLineStage;

  executionImpact: 'NONE';
}

export interface StoredPromotionAuditRecord {
  auditId: string;
  dataLineId: string;
  currentStage: DataLineStage;
  requestedNextStage: DataLineStage;
  status: PromotionAuditStatus;
  decision: PromotionDecision;
  score: number;
  blockReasons: PromotionBlockReason[];
  warnings: string[];
  auditedAt: string;
}
