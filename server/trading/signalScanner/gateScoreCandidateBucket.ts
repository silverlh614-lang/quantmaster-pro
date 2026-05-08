// @responsibility ADR-452d Gate score candidate bucket diagnostic classifier

export type GateScoreCandidateBucket =
  | 'EXECUTABLE'
  | 'DATA_BLOCKED_NEAR_MISS'
  | 'PROBING'
  | 'SHADOW_ONLY'
  | 'REJECTED';

export interface GateScoreCandidateBucketInput {
  gateScore: number;
  rawScore?: number;
  availableMaxScore?: number;
  normalizedGateScore?: number;
  unavailableConditions?: readonly string[];
  thresholdNotMetConditions?: readonly string[];
  providerDegradedConditions?: readonly string[];
  normalThreshold: number;
}

export interface GateScoreCandidateBucketDecision {
  bucket: GateScoreCandidateBucket;
  reason: string;
  executionImpact: 'NONE';
}

const NEAR_MISS_BAND = 0.5;

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * ADR-452d diagnostic-only candidate bucket classifier.
 *
 * This function must never be used for live buy decisions. It only preserves near-miss
 * candidates in ScanSummary and /scan_blockers with `executionImpact: 'NONE'`.
 */
export function classifyGateScoreCandidateBucket(
  input: GateScoreCandidateBucketInput,
): GateScoreCandidateBucketDecision {
  const raw = finiteOr(input.rawScore, input.gateScore);
  const normalized = finiteOr(input.normalizedGateScore, 0);
  const unavailableCount = input.unavailableConditions?.length ?? 0;

  if (raw >= input.normalThreshold) {
    return {
      bucket: 'EXECUTABLE',
      reason: `raw ${raw.toFixed(2)} >= normal ${input.normalThreshold.toFixed(2)}`,
      executionImpact: 'NONE',
    };
  }

  if (
    raw >= input.normalThreshold - NEAR_MISS_BAND &&
    normalized >= 0.65 &&
    unavailableCount > 0
  ) {
    return {
      bucket: 'DATA_BLOCKED_NEAR_MISS',
      reason:
        `raw ${raw.toFixed(2)} near normal ${input.normalThreshold.toFixed(2)}, ` +
        `normalized ${(normalized * 100).toFixed(1)}%, unavailable=${unavailableCount}`,
      executionImpact: 'NONE',
    };
  }

  if (raw >= input.normalThreshold - NEAR_MISS_BAND || normalized >= 0.6) {
    return {
      bucket: 'PROBING',
      reason: `raw ${raw.toFixed(2)} / normalized ${(normalized * 100).toFixed(1)}% near watch zone`,
      executionImpact: 'NONE',
    };
  }

  if (normalized >= 0.45) {
    return {
      bucket: 'SHADOW_ONLY',
      reason: `normalized ${(normalized * 100).toFixed(1)}% shadow observable`,
      executionImpact: 'NONE',
    };
  }

  return {
    bucket: 'REJECTED',
    reason: `raw ${raw.toFixed(2)} and normalized ${(normalized * 100).toFixed(1)}% below diagnostic bands`,
    executionImpact: 'NONE',
  };
}
