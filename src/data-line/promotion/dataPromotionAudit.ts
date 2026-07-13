/** @responsibility ADR-0493 pure Data Promotion Readiness Audit evaluator. */
import type {
  DataLineStage,
  DataPromotionAuditInput,
  DataPromotionAuditResult,
  PromotionAuditStatus,
  PromotionBlockReason,
  PromotionDecision,
} from '../../types/dataPromotion.types';
import { getPromotionRequirements } from './promotionRules';
import { calculateMissingRate, calculatePromotionScore } from './promotionScore';
import { defaultPromotionAuditStore, type PromotionAuditStore } from './promotionAuditStore';

export interface EvaluatePromotionReadinessOptions {
  auditedAt?: string;
  auditId?: string;
  store?: PromotionAuditStore | null;
}

const STAGE_ORDER: DataLineStage[] = ['OBSERVE', 'SHADOW_RAW', 'SHADOW_SCORE', 'ADVISORY', 'WEIGHTED', 'GATED', 'CORE'];

function uniqueReasons(reasons: PromotionBlockReason[]): PromotionBlockReason[] {
  return [...new Set(reasons)];
}

function sanitizeCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function isPositiveNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function makeAuditId(input: DataPromotionAuditInput, auditedAt: string): string {
  const safeLineId = input.dataLineId.trim().replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 64) || 'unknown-line';
  const compactTime = auditedAt.replace(/[^0-9]/g, '').slice(0, 17);
  return `adr0493-${safeLineId}-${compactTime}`;
}

function chooseStatus(blockReasons: readonly PromotionBlockReason[], warnings: readonly string[]): PromotionAuditStatus {
  if (blockReasons.includes('CORE_PROMOTION_NOT_ALLOWED')) return 'BLOCKED';
  if (blockReasons.includes('INSUFFICIENT_HISTORY')) return 'INSUFFICIENT_DATA';
  if (blockReasons.length > 0) return 'FAIL';
  return warnings.length > 0 ? 'WARN' : 'PASS';
}

function chooseDecision(status: PromotionAuditStatus, requestedNextStage: DataLineStage): PromotionDecision {
  if (requestedNextStage === 'CORE') return 'DENY_PROMOTION';
  if (status === 'PASS') return 'ALLOW_PROMOTION';
  if (status === 'WARN') return 'ALLOW_WITH_WARNING';
  if (status === 'INSUFFICIENT_DATA') return 'KEEP_CURRENT_STAGE';
  return 'DENY_PROMOTION';
}

function isForwardOneStage(currentStage: DataLineStage, requestedNextStage: DataLineStage): boolean {
  return STAGE_ORDER.indexOf(requestedNextStage) - STAGE_ORDER.indexOf(currentStage) === 1;
}

export function evaluatePromotionReadiness(input: DataPromotionAuditInput, options: EvaluatePromotionReadinessOptions = {}): DataPromotionAuditResult {
  const auditedAt = options.auditedAt ?? new Date().toISOString();
  const requirements = getPromotionRequirements(input.currentStage, input.requestedNextStage);
  const missingRate = calculateMissingRate(input);
  const scoreBreakdown = calculatePromotionScore(input, requirements);
  const warnings = [...scoreBreakdown.warnings];
  const blockReasons: PromotionBlockReason[] = [];
  const passedChecks = [...scoreBreakdown.passedChecks];

  const totalSnapshots = sanitizeCount(input.totalSnapshots);
  const staleMisclassificationCount = sanitizeCount(input.staleMisclassificationCount);
  const mixedCount = sanitizeCount(input.providerMarketSignalMixedCount);

  if (!isForwardOneStage(input.currentStage, input.requestedNextStage)) {
    blockReasons.push('UNKNOWN');
    warnings.push(`Unsupported promotion path ${input.currentStage} -> ${input.requestedNextStage}; ADR-0493 only audits adjacent forward stages.`);
  }

  if (totalSnapshots < requirements.minSnapshots) blockReasons.push('INSUFFICIENT_HISTORY');
  if (input.tradingDaysObserved < requirements.minTradingDays) blockReasons.push('INSUFFICIENT_HISTORY');
  if (requirements.maxMissingRate !== null && missingRate > requirements.maxMissingRate) blockReasons.push('HIGH_MISSING_RATE');
  if (requirements.maxStaleMisclassifications !== null && staleMisclassificationCount > requirements.maxStaleMisclassifications) blockReasons.push('STALE_MISCLASSIFICATION');
  if (requirements.requireProviderMarketSeparation && mixedCount > 0) blockReasons.push('PROVIDER_MARKET_SIGNAL_MIXED');
  if (requirements.requirePositiveShadowContribution && !isPositiveNumber(input.shadowContributionScore)) blockReasons.push('NEGATIVE_SHADOW_CONTRIBUTION');
  if (requirements.requireStablePositiveShadowContribution && !isPositiveNumber(input.shadowContributionScore)) blockReasons.push('NEGATIVE_SHADOW_CONTRIBUTION');
  if (requirements.requireLiveRegression && !input.liveRegressionPassed) blockReasons.push('LIVE_REGRESSION_RISK');
  if (requirements.requireNullZeroSeparation && !input.nullZeroSeparationPassed) blockReasons.push('NULL_ZERO_CONTAMINATION');
  if (requirements.requireHolidayFreshness && !input.holidayFreshnessPassed) blockReasons.push('HOLIDAY_FRESHNESS_MISCLASSIFIED');
  if (requirements.requireTestCoverage && !input.testCoveragePassed) blockReasons.push('MISSING_TEST_COVERAGE');
  if (requirements.requireExecutionImpactNonePassed && !input.executionImpactNonePassed) blockReasons.push('EXECUTION_IMPACT_NOT_NONE');
  if (input.latestExecutionImpact !== 'NONE') blockReasons.push('EXECUTION_IMPACT_NOT_NONE');
  if (input.requestedNextStage === 'CORE' || !requirements.automaticPromotionAllowed) blockReasons.push('CORE_PROMOTION_NOT_ALLOWED');

  if (requirements.requireProviderHealthField && input.providerHealthFieldPresent === false) blockReasons.push('UNKNOWN');
  else if (requirements.requireProviderHealthField) passedChecks.push('PROVIDER_HEALTH_FIELD_PRESENT');

  if (requirements.requireFreshnessField && input.freshnessFieldPresent === false) blockReasons.push('UNKNOWN');
  else if (requirements.requireFreshnessField) passedChecks.push('FRESHNESS_FIELD_PRESENT');

  const snapshotRecordable = input.snapshotRecordable ?? totalSnapshots > 0;
  if (requirements.requireSnapshotRecordable && !snapshotRecordable) blockReasons.push('INSUFFICIENT_HISTORY');
  else if (requirements.requireSnapshotRecordable) passedChecks.push('SNAPSHOT_RECORDABLE');

  if (sanitizeCount(input.providerFailureCount) > 0 && mixedCount === 0) {
    warnings.push('Provider failures were observed but remained separated from market signal classification.');
  }
  if (sanitizeCount(input.staleSnapshotCount) > 0 && staleMisclassificationCount === 0) {
    warnings.push('Stale snapshots were observed but not misclassified as market direction.');
  }

  const uniqueBlockReasons = uniqueReasons(blockReasons);
  if (scoreBreakdown.score < requirements.requiredScore && uniqueBlockReasons.length === 0) {
    warnings.push(`Promotion score ${scoreBreakdown.score} is below recommended score ${requirements.requiredScore}.`);
  }

  const status = chooseStatus(uniqueBlockReasons, warnings);
  const decision = chooseDecision(status, input.requestedNextStage);
  const canPromote = decision === 'ALLOW_PROMOTION' || decision === 'ALLOW_WITH_WARNING';
  const recommendedStage = canPromote ? input.requestedNextStage : input.currentStage;

  const result: DataPromotionAuditResult = {
    auditId: options.auditId ?? makeAuditId(input, auditedAt),
    dataLineId: input.dataLineId,
    auditedAt,
    currentStage: input.currentStage,
    requestedNextStage: input.requestedNextStage,
    status,
    decision,
    score: scoreBreakdown.score,
    requiredScore: requirements.requiredScore,
    passedChecks: [...new Set(passedChecks)],
    warnings,
    blockReasons: uniqueBlockReasons,
    canPromote,
    recommendedStage,
    executionImpact: 'NONE',
  };

  const store = options.store === undefined ? defaultPromotionAuditStore : options.store;
  store?.save(result);
  return result;
}

export { createInMemoryPromotionAuditStore } from './promotionAuditStore';
export type { DataPromotionAuditInput, DataPromotionAuditResult } from '../../types/dataPromotion.types';
