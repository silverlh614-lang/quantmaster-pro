// @responsibility Simplification Step 2 — regime-only position sizing policy.

export type RegimePositionPolicyKey =
  | 'R1_STRONG_BULL'
  | 'R2_BULL'
  | 'R3_EARLY'
  | 'R4_NEUTRAL'
  | 'R5_STABILIZING'
  | 'R6_DEFENSE';

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
};

export function normalizeRegimePositionPolicyKey(regime?: string | null): RegimePositionPolicyKey {
  const value = String(regime ?? '').toUpperCase();
  if (value.includes('R1')) return 'R1_STRONG_BULL';
  if (value.includes('R2')) return 'R2_BULL';
  if (value.includes('R3')) return 'R3_EARLY';
  if (value.includes('R4')) return 'R4_NEUTRAL';
  if (value.includes('R6')) return 'R6_DEFENSE';
  if (value.includes('R5')) return 'R5_STABILIZING';
  return 'R4_NEUTRAL';
}

export function getRegimePositionPolicy(regime?: string | null): RegimePositionPolicy {
  return REGIME_POSITION_POLICIES[normalizeRegimePositionPolicyKey(regime)];
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
