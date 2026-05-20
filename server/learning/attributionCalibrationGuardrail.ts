export type CalibrationDecision =
  | 'NO_CHANGE'
  | 'PROBATION_ONLY'
  | 'ADVISORY_DOWNWEIGHT'
  | 'CORE_DOWNWEIGHT_CANDIDATE'
  | 'CORE_DOWNWEIGHT_APPROVED'
  | 'SUSPEND_CANDIDATE'
  | 'SUSPEND_APPROVED';

export type CalibrationSource = 'LIVE' | 'SHADOW' | 'COUNTERFACTUAL' | 'MIXED';

export type DataConfidence = 'VERIFIED' | 'DEGRADED' | 'STALE' | 'MISSING' | 'AI_ESTIMATED' | 'UNKNOWN';

export type EngineMode = 'NORMAL' | 'DEGRADED' | 'SELL_ONLY' | 'SHADOW_ONLY' | 'OBSERVE_ONLY' | 'R6_DEFENSE';

export interface AttributionGuardrailInput {
  conditionKey: string;
  regime: string;
  sampleSize: number;
  winRate: number;
  sharpe: number;
  monthsUnderperforming: number;
  dataConfidence: DataConfidence;
  executionMode: EngineMode;
  source: CalibrationSource;
  currentWeight: number;
  proposedWeight: number;
  operatorApprovedSuspend?: boolean;
}

export interface AttributionGuardrailResult {
  decision: CalibrationDecision;
  approvedWeight: number;
  proposedWeight: number;
  maxDeltaApplied: number;
  blockedReasons: string[];
  advisoryOnly: boolean;
  coreWritable: boolean;
  candidateWritable: boolean;
}

const CORE_FLOOR = 0.30;
const CRITICAL_KEYS = new Set(['momentum', 'technical', 'rs', 'volume', 'supply']);

export function applyAttributionCalibrationGuardrail(input: AttributionGuardrailInput): AttributionGuardrailResult {
  const blockedReasons: string[] = [];
  const sample = input.sampleSize;
  const maxDelta = sample < 30 ? 0 : sample < 100 ? 0.1 : sample < 300 ? 0.2 : 0.3;
  const coreWritableBySample = sample >= 100;

  let decision: CalibrationDecision = 'NO_CHANGE';
  let coreWritable = coreWritableBySample;
  let candidateWritable = true;

  if (input.dataConfidence !== 'VERIFIED') {
    blockedReasons.push(`DATA_CONFIDENCE_${input.dataConfidence}`);
    coreWritable = false;
    decision = input.proposedWeight < input.currentWeight ? 'ADVISORY_DOWNWEIGHT' : 'PROBATION_ONLY';
  }
  if (input.source === 'MIXED') {
    blockedReasons.push('LIVE_SHADOW_COUNTERFACTUAL_MIXED');
    coreWritable = false;
    decision = 'PROBATION_ONLY';
  } else if (input.source === 'SHADOW' || input.source === 'COUNTERFACTUAL') {
    blockedReasons.push(`NON_LIVE_SOURCE_${input.source}`);
    coreWritable = false;
    if (decision === 'NO_CHANGE') decision = 'ADVISORY_DOWNWEIGHT';
  }
  if (['SELL_ONLY', 'SHADOW_ONLY', 'OBSERVE_ONLY', 'R6_DEFENSE'].includes(input.executionMode)) {
    blockedReasons.push('NON_CORE_EXECUTION_MODE');
    coreWritable = false;
    decision = 'ADVISORY_DOWNWEIGHT';
  }
  if (sample < 30) {
    blockedReasons.push('INSUFFICIENT_SAMPLE_LT_30');
    coreWritable = false;
    decision = 'PROBATION_ONLY';
  } else if (sample < 100) {
    blockedReasons.push('CORE_WRITE_BLOCKED_SAMPLE_LT_100');
    coreWritable = false;
    if (decision === 'NO_CHANGE') decision = 'CORE_DOWNWEIGHT_CANDIDATE';
  }

  if (input.monthsUnderperforming <= 1) {
    if (decision === 'NO_CHANGE') decision = 'PROBATION_ONLY';
  } else if (input.monthsUnderperforming === 2) {
    if (decision === 'NO_CHANGE') decision = 'CORE_DOWNWEIGHT_CANDIDATE';
  } else if (input.monthsUnderperforming >= 3 && input.winRate < 25 && input.sharpe < -0.3) {
    decision = input.operatorApprovedSuspend ? 'SUSPEND_APPROVED' : 'SUSPEND_CANDIDATE';
    if (!input.operatorApprovedSuspend) coreWritable = false;
  }

  if (sample < 30) {
    return { decision, approvedWeight: input.currentWeight, proposedWeight: input.proposedWeight, maxDeltaApplied: 0, blockedReasons, advisoryOnly: true, coreWritable: false, candidateWritable };
  }

  const delta = input.proposedWeight - input.currentWeight;
  const clamped = Math.max(input.currentWeight - maxDelta, Math.min(input.currentWeight + maxDelta, input.proposedWeight));
  let approved = clamped;

  if (approved < CORE_FLOOR && decision !== 'SUSPEND_APPROVED') {
    blockedReasons.push('CORE_WEIGHT_FLOOR_0_30');
    approved = CORE_FLOOR;
  }
  if (CRITICAL_KEYS.has(input.conditionKey.toLowerCase()) && input.monthsUnderperforming <= 1 && approved <= 0.1) {
    blockedReasons.push('CRITICAL_CONDITION_ONE_MONTH_NO_HARD_DROP');
    approved = Math.max(approved, CORE_FLOOR);
  }

  if (coreWritable && decision === 'CORE_DOWNWEIGHT_CANDIDATE') decision = 'CORE_DOWNWEIGHT_APPROVED';

  const maxDeltaApplied = Math.abs(approved - input.currentWeight);
  console.log('[ATTRIBUTION_GUARDRAIL_DECISION]', {
    conditionKey: input.conditionKey,
    regime: input.regime,
    sampleSize: input.sampleSize,
    winRate: input.winRate,
    sharpe: input.sharpe,
    source: input.source,
    executionMode: input.executionMode,
    dataConfidence: input.dataConfidence,
    currentWeight: input.currentWeight,
    proposedWeight: input.proposedWeight,
    approvedWeight: approved,
    decision,
    coreWritable,
    candidateWritable,
    blockedReasons,
  });

  return {
    decision,
    approvedWeight: Number(approved.toFixed(2)),
    proposedWeight: Number(input.proposedWeight.toFixed(2)),
    maxDeltaApplied: Number(maxDeltaApplied.toFixed(2)),
    blockedReasons,
    advisoryOnly: !coreWritable,
    coreWritable,
    candidateWritable,
  };
}
