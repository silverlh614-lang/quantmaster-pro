/** @responsibility ADR-0493 deterministic promotion score calculation. */
import type { DataPromotionAuditInput, DataPromotionRequirements } from '../../types/dataPromotion.types';

export interface PromotionScoreBreakdown {
  score: number;
  passedChecks: string[];
  warnings: string[];
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function calculateMissingRate(input: Pick<DataPromotionAuditInput, 'missingSnapshotCount' | 'totalSnapshots'>): number {
  const denominator = finiteNonNegative(input.totalSnapshots);
  if (denominator === 0) return 1;
  const missing = Math.max(0, Number.isFinite(input.missingSnapshotCount) ? input.missingSnapshotCount : denominator);
  return Math.min(1, missing / denominator);
}

export function calculatePromotionScore(input: DataPromotionAuditInput, requirements?: DataPromotionRequirements): PromotionScoreBreakdown {
  const missingRate = calculateMissingRate(input);
  const passedChecks: string[] = [];
  const warnings: string[] = [];
  let score = 0;

  if (input.tradingDaysObserved >= (requirements?.minTradingDays ?? 1)) {
    score += 20;
    passedChecks.push('SUFFICIENT_OBSERVATION_HISTORY');
  }

  if (requirements?.maxMissingRate === null || missingRate <= (requirements?.maxMissingRate ?? 0.20)) {
    score += 15;
    passedChecks.push('MISSING_RATE_WITHIN_LIMIT');
  }

  if (requirements?.maxStaleMisclassifications === null || input.staleMisclassificationCount <= (requirements?.maxStaleMisclassifications ?? 3)) {
    score += 10;
    passedChecks.push('STALE_MISCLASSIFICATION_WITHIN_LIMIT');
  }

  if (input.providerMarketSignalMixedCount === 0) {
    score += 15;
    passedChecks.push('PROVIDER_MARKET_SIGNAL_SEPARATED');
  }

  if (typeof input.shadowContributionScore === 'number' && Number.isFinite(input.shadowContributionScore) && input.shadowContributionScore > 0) {
    score += 15;
    passedChecks.push('POSITIVE_SHADOW_CONTRIBUTION');
  } else if (requirements?.requirePositiveShadowContribution || requirements?.requireStablePositiveShadowContribution) {
    warnings.push('Shadow contribution is not positive; missing/null contribution is audit evidence, not a bearish market signal.');
  }

  if (input.liveRegressionPassed) {
    score += 15;
    passedChecks.push('LIVE_REGRESSION_PASSED');
  }

  if (input.nullZeroSeparationPassed) {
    score += 10;
    passedChecks.push('NULL_ZERO_SEPARATION_PASSED');
  }

  return { score: Math.min(100, score), passedChecks, warnings };
}
