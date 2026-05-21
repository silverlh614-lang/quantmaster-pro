// @responsibility Source Snapshot forensic mismatch detector. Alerts never affect execution.

export type SnapshotForensicReason =
  | 'GATE_POLICY_POLLUTION'
  | 'COMMON_GATE_SESSION_LEAKAGE'
  | 'FEATURE_COMPUTED_BUT_GATE_MAPPING_DROPPED'
  | 'QUOTE_VERIFIED_BUT_TECHNICAL_LAYER_NOT_READY'
  | 'SNAPSHOT_MISMATCH_GATE_POLICY'
  | 'SNAPSHOT_MISMATCH_TELEGRAM_DECISION';

export interface SnapshotForensicAlert {
  reason: SnapshotForensicReason;
  executionImpact: 'NONE';
  detail: string;
}

const COMMON_GATE_FORBIDDEN_KEYS = new Set([
  'marketSession',
  'displaySession',
  'entryBlockMode',
  'R6_DEFENSE',
  'SELL_ONLY',
  'liveBuyAllowed',
  'realOrderAllowed',
]);

export function detectSnapshotMismatches(input: {
  gate1DiagText?: string | null;
  commonGateReadKeys?: string[];
  featureTechnicalIndicatorsStatus?: string | null;
  gateTechnicalTrendMissing?: boolean;
  quoteStatus?: string | null;
  gateResultSnapshotId?: string | null;
  policyResultSnapshotId?: string | null;
  telegramSummarySnapshotId?: string | null;
  decisionContextSnapshotId?: string | null;
}): SnapshotForensicAlert[] {
  const alerts: SnapshotForensicAlert[] = [];
  if (String(input.gate1DiagText ?? '').includes('LIVE_BLOCKED_ONLY')) {
    alerts.push({
      reason: 'GATE_POLICY_POLLUTION',
      executionImpact: 'NONE',
      detail: 'Gate1Diag contains LIVE_BLOCKED_ONLY policy status.',
    });
  }

  const leakedKey = input.commonGateReadKeys?.find((key) => COMMON_GATE_FORBIDDEN_KEYS.has(key));
  if (leakedKey) {
    alerts.push({
      reason: 'COMMON_GATE_SESSION_LEAKAGE',
      executionImpact: 'NONE',
      detail: `CommonGateResult read forbidden key ${leakedKey}.`,
    });
  }

  if (input.featureTechnicalIndicatorsStatus === 'COMPUTED' && input.gateTechnicalTrendMissing === true) {
    alerts.push({
      reason: 'FEATURE_COMPUTED_BUT_GATE_MAPPING_DROPPED',
      executionImpact: 'NONE',
      detail: 'FeatureSnapshot technicalIndicators are computed but gate reports technicalTrendMissing.',
    });
  }

  if (input.quoteStatus === 'VERIFIED' && input.featureTechnicalIndicatorsStatus === 'MISSING') {
    alerts.push({
      reason: 'QUOTE_VERIFIED_BUT_TECHNICAL_LAYER_NOT_READY',
      executionImpact: 'NONE',
      detail: 'KIS quote is verified but technical indicator layer is missing.',
    });
  }

  if (input.gateResultSnapshotId && input.policyResultSnapshotId && input.gateResultSnapshotId !== input.policyResultSnapshotId) {
    alerts.push({
      reason: 'SNAPSHOT_MISMATCH_GATE_POLICY',
      executionImpact: 'NONE',
      detail: `${input.gateResultSnapshotId} !== ${input.policyResultSnapshotId}`,
    });
  }

  if (
    input.telegramSummarySnapshotId
    && input.decisionContextSnapshotId
    && input.telegramSummarySnapshotId !== input.decisionContextSnapshotId
  ) {
    alerts.push({
      reason: 'SNAPSHOT_MISMATCH_TELEGRAM_DECISION',
      executionImpact: 'NONE',
      detail: `${input.telegramSummarySnapshotId} !== ${input.decisionContextSnapshotId}`,
    });
  }

  return alerts;
}
