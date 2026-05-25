// @responsibility Simplification Step 2 — regime-only position sizing policy.

import type {
  PositionPolicyDecision,
  PositionPolicyMode,
  PositionPolicyTier,
} from '../gates/unifiedExecutionContract.js';

export type RegimePositionPolicyKey =
  | 'R1_STRONG_BULL'
  | 'R2_BULL'
  | 'R3_EARLY'
  | 'R4_NEUTRAL'
  | 'R5_STABILIZING'
  | 'R6_DEFENSE'
  | 'UNKNOWN';

export interface RegimePositionPolicy {
  regime: RegimePositionPolicyKey;
  maxPositions: number;
  maxGrossExposurePct: number;
  perPositionPct: number;
}

export interface PositionPolicySizingInput {
  totalEquity: number;
  currentPositions?: number;
  regime?: string | null;
}

export interface PositionPolicySizingResult {
  policy: RegimePositionPolicy;
  currentPositions: number;
  remainingSlots: number;
  positionSizePct: number;
  positionAmount: number;
  kellyDisabled: true;
  kellyIgnoredReason: 'REMOVED_BY_SIMPLIFICATION_POLICY';
}

export interface RegimeAdjustment {
  regime: RegimePositionPolicyKey;
  scoreAdjustment: number;
  confidenceAdjustment: number;
  riskTag: string;
  learningLabel: string;
  executionImpact: 'NONE';
}

const roundPct = (value: number): number => Number(value.toFixed(2));

const makePolicy = (
  regime: RegimePositionPolicyKey,
  maxPositions: number,
  maxGrossExposurePct: number,
): RegimePositionPolicy => ({
  regime,
  maxPositions,
  maxGrossExposurePct,
  perPositionPct: roundPct(maxGrossExposurePct / maxPositions),
});

export const REGIME_POSITION_POLICIES: Record<RegimePositionPolicyKey, RegimePositionPolicy> = {
  R1_STRONG_BULL: makePolicy('R1_STRONG_BULL', 8, 80),
  R2_BULL: makePolicy('R2_BULL', 6, 60),
  R3_EARLY: makePolicy('R3_EARLY', 5, 50),
  R4_NEUTRAL: makePolicy('R4_NEUTRAL', 4, 40),
  R5_STABILIZING: makePolicy('R5_STABILIZING', 3, 20),
  R6_DEFENSE: makePolicy('R6_DEFENSE', 3, 20),
  UNKNOWN: makePolicy('UNKNOWN', 3, 20),
};

export const REGIME_SCORE_ADJUSTMENTS: Record<RegimePositionPolicyKey, RegimeAdjustment> = {
  R1_STRONG_BULL: {
    regime: 'R1_STRONG_BULL',
    scoreAdjustment: 3,
    confidenceAdjustment: 0.05,
    riskTag: 'REGIME_STRONG_BULL',
    learningLabel: 'REGIME_R1',
    executionImpact: 'NONE',
  },
  R2_BULL: {
    regime: 'R2_BULL',
    scoreAdjustment: 2,
    confidenceAdjustment: 0.03,
    riskTag: 'REGIME_BULL',
    learningLabel: 'REGIME_R2',
    executionImpact: 'NONE',
  },
  R3_EARLY: {
    regime: 'R3_EARLY',
    scoreAdjustment: 1,
    confidenceAdjustment: 0.02,
    riskTag: 'REGIME_EARLY',
    learningLabel: 'REGIME_R3',
    executionImpact: 'NONE',
  },
  R4_NEUTRAL: {
    regime: 'R4_NEUTRAL',
    scoreAdjustment: 0,
    confidenceAdjustment: 0,
    riskTag: 'REGIME_NEUTRAL',
    learningLabel: 'REGIME_R4',
    executionImpact: 'NONE',
  },
  R5_STABILIZING: {
    regime: 'R5_STABILIZING',
    scoreAdjustment: -2,
    confidenceAdjustment: -0.05,
    riskTag: 'REGIME_STABILIZING',
    learningLabel: 'REGIME_R5',
    executionImpact: 'NONE',
  },
  R6_DEFENSE: {
    regime: 'R6_DEFENSE',
    scoreAdjustment: -5,
    confidenceAdjustment: -0.10,
    riskTag: 'REGIME_R6_CONTEXT',
    learningLabel: 'REGIME_R6_OBSERVED',
    executionImpact: 'NONE',
  },
  UNKNOWN: {
    regime: 'UNKNOWN',
    scoreAdjustment: -2,
    confidenceAdjustment: -0.05,
    riskTag: 'REGIME_UNKNOWN',
    learningLabel: 'REGIME_UNKNOWN',
    executionImpact: 'NONE',
  },
};

export function normalizeRegimePositionPolicyKey(regime?: string | null): RegimePositionPolicyKey {
  const value = String(regime ?? '').toUpperCase();
  if (value.includes('R1')) return 'R1_STRONG_BULL';
  if (value.includes('R2')) return 'R2_BULL';
  if (value.includes('R3')) return 'R3_EARLY';
  if (value.includes('R4')) return 'R4_NEUTRAL';
  if (value.includes('R6')) return 'R6_DEFENSE';
  if (value.includes('R5')) return 'R5_STABILIZING';
  return 'UNKNOWN';
}

export function getRegimePositionPolicy(regime?: string | null): RegimePositionPolicy {
  return REGIME_POSITION_POLICIES[normalizeRegimePositionPolicyKey(regime)];
}

export function getRegimeAdjustment(regime?: string | null): RegimeAdjustment {
  return REGIME_SCORE_ADJUSTMENTS[normalizeRegimePositionPolicyKey(regime)];
}

export function calculateRegimePositionSizing(input: PositionPolicySizingInput): PositionPolicySizingResult {
  const policy = getRegimePositionPolicy(input.regime);
  const currentPositions = Math.max(0, Math.floor(input.currentPositions ?? 0));
  const remainingSlots = Math.max(0, policy.maxPositions - currentPositions);
  const totalEquity = Number.isFinite(input.totalEquity) && input.totalEquity > 0 ? input.totalEquity : 0;
  const positionSizePct = policy.perPositionPct;
  const positionAmount = totalEquity * (positionSizePct / 100);
  return {
    policy,
    currentPositions,
    remainingSlots,
    positionSizePct,
    positionAmount,
    kellyDisabled: true,
    kellyIgnoredReason: 'REMOVED_BY_SIMPLIFICATION_POLICY',
  };
}

export function formatPositionPolicySimpleAppliedLog(input: {
  snapshotId?: string;
  symbol?: string;
  sizing: PositionPolicySizingResult;
}): string {
  const { policy } = input.sizing;
  return [
    '[POSITION_POLICY_SIMPLE_APPLIED]',
    `snapshotId=${input.snapshotId ?? 'NA'}`,
    `symbol=${input.symbol ?? 'NA'}`,
    `regime=${policy.regime}`,
    `maxPositions=${policy.maxPositions}`,
    `currentPositions=${input.sizing.currentPositions}`,
    `remainingSlots=${input.sizing.remainingSlots}`,
    `maxGrossExposurePct=${policy.maxGrossExposurePct}`,
    `perPositionPct=${policy.perPositionPct}`,
    `positionAmount=${Math.round(input.sizing.positionAmount)}`,
    'kellyDisabled=true',
    "executionImpact='NONE'",
  ].join(' ');
}

export function formatRegimePositionPolicyAppliedLog(input: {
  snapshotId?: string;
  symbol?: string;
  sizing: PositionPolicySizingResult;
}): string {
  const { policy } = input.sizing;
  return [
    '[REGIME_POSITION_POLICY_APPLIED]',
    `snapshotId=${input.snapshotId ?? 'NA'}`,
    `symbol=${input.symbol ?? 'NA'}`,
    `regime=${policy.regime}`,
    `maxPositions=${policy.maxPositions}`,
    `currentPositions=${input.sizing.currentPositions}`,
    `remainingSlots=${input.sizing.remainingSlots}`,
    `maxGrossExposurePct=${policy.maxGrossExposurePct}`,
    `perPositionPct=${policy.perPositionPct}`,
    `positionAmount=${Math.round(input.sizing.positionAmount)}`,
    "executionImpact='NONE'",
  ].join(' ');
}

export function formatRegimeAdjustmentAppliedLog(input: {
  snapshotId?: string;
  symbol?: string;
  adjustment: RegimeAdjustment;
}): string {
  return [
    '[REGIME_ADJUSTMENT_APPLIED]',
    `snapshotId=${input.snapshotId ?? 'NA'}`,
    `symbol=${input.symbol ?? 'NA'}`,
    `regime=${input.adjustment.regime}`,
    `scoreAdjustment=${input.adjustment.scoreAdjustment}`,
    `confidenceAdjustment=${input.adjustment.confidenceAdjustment}`,
    `riskTag=${input.adjustment.riskTag}`,
    `learningLabel=${input.adjustment.learningLabel}`,
    "executionImpact='NONE'",
  ].join(' ');
}

export function formatRegimeExecutionAuthorityRemovedLog(input: {
  snapshotId?: string;
  rawRegime?: string | null;
  detectedRegime?: string | null;
  effectiveRegime?: string | null;
  riskOverride?: string | null;
}): string {
  return [
    '[REGIME_EXECUTION_AUTHORITY_REMOVED]',
    `snapshotId=${input.snapshotId ?? 'NA'}`,
    `rawRegime=${input.rawRegime ?? 'NA'}`,
    `detectedRegime=${input.detectedRegime ?? 'NA'}`,
    `effectiveRegime=${input.effectiveRegime ?? 'NA'}`,
    `riskOverride=${input.riskOverride ?? 'NA'}`,
    "previousBehavior='EXECUTION_BLOCK_OR_MODE_SWITCH'",
    "newBehavior='POSITION_POLICY_AND_SCORE_ADJUSTMENT_ONLY'",
    "executionImpact='NONE'",
  ].join(' ');
}

/**
 * ADR-0527 — PositionPolicyDecision 정본 매핑.
 * calculateRegimePositionSizing 의 결과(RegimePositionPolicySizingResult)를 정본 형상으로
 * **명명·표본 매핑만** 한다. 사이징 계산 로직은 변경하지 않는다.
 * - tier: policy.regime (RegimePositionPolicyKey ⊆ PositionPolicyTier, 동일 리터럴).
 * - posPct: perPositionPct 정본(= sizing.positionSizePct = policy.perPositionPct).
 * - finalKelly: 현 정책상 Kelly 비활성(kellyDisabled=true) → null 고정.
 * - diagnosticVsLive: 호출 맥락으로 설정(기본 DIAGNOSTIC — formatter 표본 구분용).
 */
export function toPositionPolicyDecision(input: {
  sourceSnapshotId: string;
  symbol?: string;
  sizing: PositionPolicySizingResult;
  diagnosticVsLive?: PositionPolicyMode;
}): PositionPolicyDecision {
  const { policy } = input.sizing;
  return {
    sourceSnapshotId: input.sourceSnapshotId,
    ...(input.symbol ? { symbol: input.symbol } : {}),
    tier: policy.regime as PositionPolicyTier,
    posPct: input.sizing.positionSizePct,
    maxPositions: policy.maxPositions,
    maxGrossExposurePct: policy.maxGrossExposurePct,
    finalKelly: input.sizing.kellyDisabled ? null : null,
    diagnosticVsLive: input.diagnosticVsLive ?? 'DIAGNOSTIC',
    executionImpact: 'NONE',
  };
}

export function formatKellyRemovedIgnoredLog(input: {
  snapshotId?: string;
  symbol?: string;
  previousKellyValue?: number | null;
}): string {
  return [
    '[KELLY_REMOVED_IGNORED]',
    `snapshotId=${input.snapshotId ?? 'NA'}`,
    `symbol=${input.symbol ?? 'NA'}`,
    `previousKellyValue=${Number.isFinite(input.previousKellyValue ?? NaN) ? input.previousKellyValue : 'NA'}`,
    'kellyDisabled=true',
    "reason='KELLY_REMOVED_BY_SIMPLIFICATION_POLICY'",
    "executionImpact='NONE'",
  ].join(' ');
}
