// @responsibility Final score based trade decision labels. Gate remains scoring/diagnostic input only.

export type TradeDecision =
  | 'BUY_ALLOWED'
  | 'WATCH'
  | 'REJECT_LOW_SCORE'
  | 'NO_TRADE_DATA_INCOMPLETE'
  | 'WATCH_RR_INSUFFICIENT'
  | 'WATCH_SLOT_FULL';

export type ConvictionLabel =
  | 'HIGH_CONVICTION'
  | 'BUY'
  | 'WATCH'
  | 'LOW_SCORE'
  | 'DATA_INCOMPLETE';

export type LearningLabel =
  | 'LABEL_HIGH_CONVICTION'
  | 'LABEL_BUY'
  | 'LABEL_WATCH'
  | 'LABEL_LOW_SCORE'
  | 'LABEL_DATA_INCOMPLETE';

export interface SimpleTradeDecisionInput {
  snapshotId?: string;
  symbol?: string;
  dataUsable: boolean;
  riskRewardOk?: boolean;
  slotAvailable?: boolean;
  baseScore?: number;
  scoreAdjustment?: number;
  finalScore: number;
  buyThreshold?: number;
  watchThreshold?: number;
  diagnosticEvidence?: string[];
}

export interface SimpleTradeDecisionResult {
  snapshotId?: string;
  symbol?: string;
  dataUsable: boolean;
  riskRewardOk: boolean;
  slotAvailable: boolean;
  baseScore: number;
  scoreAdjustment: number;
  finalScore: number;
  buyThreshold: number;
  watchThreshold: number;
  decision: TradeDecision;
  label: ConvictionLabel;
  learningLabel: LearningLabel;
  blockReasons: string[];
  diagnosticEvidence: string[];
  strongBuyAsLabelOnly: true;
  shadowLearning: true;
  executionImpact: 'NONE';
}

export interface StrongBuyConditionDowngradedLogInput {
  snapshotId?: string;
  symbol?: string;
  conditionName: string;
  scoreImpact?: number;
}

export interface LegacyStrongBuyBlockerIgnoredLogInput {
  snapshotId?: string;
  symbol?: string;
  blockerName: string;
}

const DEFAULT_BUY_THRESHOLD = 70;
const DEFAULT_WATCH_THRESHOLD = 55;

function finiteOrZero(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function kv(key: string, value: unknown): string {
  return `${key}=${value === undefined || value === null ? 'none' : String(value)}`;
}

export function labelFromFinalScore(finalScore: number): ConvictionLabel {
  if (!Number.isFinite(finalScore)) return 'DATA_INCOMPLETE';
  if (finalScore >= 85) return 'HIGH_CONVICTION';
  if (finalScore >= 70) return 'BUY';
  if (finalScore >= 55) return 'WATCH';
  return 'LOW_SCORE';
}

export function learningLabelFromConvictionLabel(label: ConvictionLabel): LearningLabel {
  switch (label) {
    case 'HIGH_CONVICTION':
      return 'LABEL_HIGH_CONVICTION';
    case 'BUY':
      return 'LABEL_BUY';
    case 'WATCH':
      return 'LABEL_WATCH';
    case 'LOW_SCORE':
      return 'LABEL_LOW_SCORE';
    case 'DATA_INCOMPLETE':
      return 'LABEL_DATA_INCOMPLETE';
  }
}

export function resolveSimpleTradeDecision(
  input: SimpleTradeDecisionInput,
): SimpleTradeDecisionResult {
  const buyThreshold = input.buyThreshold ?? DEFAULT_BUY_THRESHOLD;
  const watchThreshold = input.watchThreshold ?? DEFAULT_WATCH_THRESHOLD;
  const riskRewardOk = input.riskRewardOk ?? true;
  const slotAvailable = input.slotAvailable ?? true;
  const baseScore = finiteOrZero(input.baseScore);
  const scoreAdjustment = finiteOrZero(input.scoreAdjustment);
  const label = input.dataUsable ? labelFromFinalScore(input.finalScore) : 'DATA_INCOMPLETE';

  let decision: TradeDecision;
  const blockReasons: string[] = [];

  if (!input.dataUsable) {
    decision = 'NO_TRADE_DATA_INCOMPLETE';
    blockReasons.push('DATA_INCOMPLETE');
  } else if (!riskRewardOk) {
    decision = 'WATCH_RR_INSUFFICIENT';
    blockReasons.push('RR_INSUFFICIENT');
  } else if (!slotAvailable) {
    decision = 'WATCH_SLOT_FULL';
    blockReasons.push('SLOT_FULL');
  } else if (input.finalScore >= buyThreshold) {
    decision = 'BUY_ALLOWED';
  } else if (input.finalScore >= watchThreshold) {
    decision = 'WATCH';
  } else {
    decision = 'REJECT_LOW_SCORE';
    blockReasons.push('LOW_SCORE');
  }

  return {
    snapshotId: input.snapshotId,
    symbol: input.symbol,
    dataUsable: input.dataUsable,
    riskRewardOk,
    slotAvailable,
    baseScore,
    scoreAdjustment,
    finalScore: input.finalScore,
    buyThreshold,
    watchThreshold,
    decision,
    label,
    learningLabel: learningLabelFromConvictionLabel(label),
    blockReasons,
    diagnosticEvidence: input.diagnosticEvidence ?? [],
    strongBuyAsLabelOnly: true,
    shadowLearning: true,
    executionImpact: 'NONE',
  };
}

export function formatSimpleDecisionFinalLog(result: SimpleTradeDecisionResult): string {
  return [
    '[SIMPLE_DECISION_FINAL]',
    kv('snapshotId', result.snapshotId),
    kv('symbol', result.symbol),
    kv('dataUsable', result.dataUsable),
    kv('baseScore', result.baseScore),
    kv('scoreAdjustment', result.scoreAdjustment),
    kv('finalScore', result.finalScore),
    kv('buyThreshold', result.buyThreshold),
    kv('watchThreshold', result.watchThreshold),
    kv('decision', result.decision),
    kv('label', result.label),
    kv('strongBuyAsLabelOnly', result.strongBuyAsLabelOnly),
    kv('shadowLearning', result.shadowLearning),
    "executionImpact='NONE'",
  ].join(' ');
}

export function formatStrongBuyConditionDowngradedLog(
  input: StrongBuyConditionDowngradedLogInput,
): string {
  return [
    '[STRONG_BUY_CONDITION_DOWNGRADED]',
    kv('snapshotId', input.snapshotId),
    kv('symbol', input.symbol),
    kv('conditionName', input.conditionName),
    "previousRole='REQUIRED_FOR_STRONG_BUY'",
    "newRole='SCORE_OR_DIAGNOSTIC_ONLY'",
    kv('scoreImpact', input.scoreImpact ?? 0),
    "executionImpact='NONE'",
  ].join(' ');
}

export function formatLegacyStrongBuyBlockerIgnoredLog(
  input: LegacyStrongBuyBlockerIgnoredLogInput,
): string {
  return [
    '[LEGACY_STRONG_BUY_BLOCKER_IGNORED]',
    kv('snapshotId', input.snapshotId),
    kv('symbol', input.symbol),
    kv('blockerName', input.blockerName),
    "previousBehavior='BUY_BLOCK_OR_DOWNGRADE'",
    "newBehavior='LABEL_ONLY_OR_SCORE_ADJUSTMENT'",
    "executionImpact='NONE'",
  ].join(' ');
}
