// @responsibility Final score based trade decision labels. Gate remains scoring/diagnostic input only.

import {
  resolveQualityDecisionFromGate,
  type GateScoreBreakdown,
  type QualityDecision,
} from './gateSoftEvaluation.js';

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
  diversityAdjustment?: number;
  freshnessPenalty?: number;
  discoveryBonus?: number;
  sectorDiversityAdjustment?: number;
  volumeClockAdjustment?: number;
  eventAdjustment?: number;
  riskPenalty?: number;
  executionScore?: number;
  advisoryScore?: number;
  aiNarrativeScore?: number;
  excludedAiScore?: number;
  finalScore: number;
  buyThreshold?: number;
  watchThreshold?: number;
  diagnosticEvidence?: string[];
  gateScoreBreakdown?: GateScoreBreakdown;
  qualityDecision?: QualityDecision;
  regime?: string;
  regimeAdjustment?: number;
  maxPositions?: number;
  currentPositions?: number;
  remainingSlots?: number;
  priceSnapshotId?: string;
  currentPrice?: number | null;
  priceConfidence?: string;
  priceAgeSec?: number;
  orderIntentStatus?: 'READY' | 'WAIT_PRICE_VALID' | 'WAIT_PRICE_REBUILD';
  tradePlanValid?: boolean;
}

export interface SimpleTradeDecisionResult {
  snapshotId?: string;
  symbol?: string;
  dataUsable: boolean;
  riskRewardOk: boolean;
  slotAvailable: boolean;
  baseScore: number;
  scoreAdjustment: number;
  diversityAdjustment: number;
  freshnessPenalty: number;
  discoveryBonus: number;
  sectorDiversityAdjustment: number;
  volumeClockAdjustment: number;
  eventAdjustment: number;
  riskPenalty: number;
  executionScore: number;
  adjustmentScore: number;
  advisoryScore: number;
  aiNarrativeScore: number;
  excludedAiScore: number;
  finalScore: number;
  dataGateUsable: boolean;
  gateTotalScore: number;
  qualityDecision: QualityDecision;
  hardFailReasons: string[];
  softFailReasons: string[];
  regime: string;
  regimeAdjustment: number;
  maxPositions: number;
  currentPositions: number;
  remainingSlots: number;
  priceSnapshotId?: string;
  currentPrice?: number | null;
  priceConfidence?: string;
  priceAgeSec?: number;
  orderIntentStatus?: 'READY' | 'WAIT_PRICE_VALID' | 'WAIT_PRICE_REBUILD';
  tradePlanValid?: boolean;
  buyThreshold: number;
  watchThreshold: number;
  decision: TradeDecision;
  label: ConvictionLabel;
  learningLabel: LearningLabel;
  blockReasons: string[];
  diagnosticEvidence: string[];
  strongBuyAsLabelOnly: true;
  shadowLearning: true;
  aiExecutionImpact: 'NONE';
  dataConfidencePolicy: 'VERIFIED_COMPUTED_ONLY_FOR_EXECUTION';
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
  const rawScoreAdjustment = finiteOrZero(input.scoreAdjustment);
  const diversityAdjustment = finiteOrZero(input.diversityAdjustment);
  const freshnessPenalty = finiteOrZero(input.freshnessPenalty);
  const discoveryBonus = finiteOrZero(input.discoveryBonus);
  const sectorDiversityAdjustment = finiteOrZero(input.sectorDiversityAdjustment);
  const volumeClockAdjustment = finiteOrZero(input.volumeClockAdjustment);
  const eventAdjustment = finiteOrZero(input.eventAdjustment);
  const riskPenalty = finiteOrZero(input.riskPenalty);
  const scoreAdjustment = rawScoreAdjustment + diversityAdjustment;
  const executionScore = finiteOrZero(input.executionScore ?? input.baseScore);
  const advisoryScore = finiteOrZero(input.advisoryScore);
  const aiNarrativeScore = finiteOrZero(input.aiNarrativeScore);
  const excludedAiScore = finiteOrZero(input.excludedAiScore);
  const finalScore = input.executionScore === undefined
    ? input.finalScore
    : executionScore + scoreAdjustment;
  const regimeAdjustment = finiteOrZero(input.regimeAdjustment);
  const dataGateUsable = input.gateScoreBreakdown?.dataGateUsable ?? input.dataUsable;
  const label = dataGateUsable ? labelFromFinalScore(finalScore) : 'DATA_INCOMPLETE';
  const qualityDecision = input.qualityDecision ?? (input.gateScoreBreakdown
    ? resolveQualityDecisionFromGate({
        gateScoreBreakdown: input.gateScoreBreakdown,
        finalScore,
        buyThreshold,
        riskRewardOk,
        slotAvailable,
      })
    : !dataGateUsable ? 'DATA_INCOMPLETE'
      : !riskRewardOk || !slotAvailable || finalScore < buyThreshold ? 'WATCH_READY'
      : 'TRADE_READY');

  let decision: TradeDecision;
  const blockReasons: string[] = [];

  if (!dataGateUsable) {
    decision = 'NO_TRADE_DATA_INCOMPLETE';
    blockReasons.push('DATA_INCOMPLETE');
  } else if (!riskRewardOk) {
    decision = 'WATCH_RR_INSUFFICIENT';
    blockReasons.push('RR_INSUFFICIENT');
  } else if (!slotAvailable) {
    decision = 'WATCH_SLOT_FULL';
    blockReasons.push('SLOT_FULL');
  } else if (finalScore >= buyThreshold) {
    decision = 'BUY_ALLOWED';
  } else if (finalScore >= watchThreshold) {
    decision = 'WATCH';
  } else {
    decision = 'REJECT_LOW_SCORE';
    blockReasons.push('LOW_SCORE');
  }

  return {
    snapshotId: input.snapshotId,
    symbol: input.symbol,
    dataUsable: input.dataUsable,
    dataGateUsable,
    riskRewardOk,
    slotAvailable,
    baseScore,
    scoreAdjustment,
    diversityAdjustment,
    freshnessPenalty,
    discoveryBonus,
    sectorDiversityAdjustment,
    volumeClockAdjustment,
    eventAdjustment,
    riskPenalty,
    executionScore,
    adjustmentScore: scoreAdjustment,
    advisoryScore,
    aiNarrativeScore,
    excludedAiScore,
    finalScore,
    gateTotalScore: input.gateScoreBreakdown?.gateTotalScore ?? 0,
    qualityDecision,
    hardFailReasons: input.gateScoreBreakdown?.hardFailReasons ?? [],
    softFailReasons: input.gateScoreBreakdown?.softFailReasons ?? [],
    regime: input.regime ?? 'UNKNOWN',
    regimeAdjustment,
    maxPositions: Math.max(0, Math.floor(input.maxPositions ?? 0)),
    currentPositions: Math.max(0, Math.floor(input.currentPositions ?? 0)),
    remainingSlots: Math.max(0, Math.floor(input.remainingSlots ?? 0)),
    priceSnapshotId: input.priceSnapshotId,
    currentPrice: input.currentPrice,
    priceConfidence: input.priceConfidence,
    priceAgeSec: input.priceAgeSec,
    orderIntentStatus: input.orderIntentStatus,
    tradePlanValid: input.tradePlanValid,
    buyThreshold,
    watchThreshold,
    decision,
    label,
    learningLabel: learningLabelFromConvictionLabel(label),
    blockReasons,
    diagnosticEvidence: input.diagnosticEvidence ?? [],
    strongBuyAsLabelOnly: true,
    shadowLearning: true,
    aiExecutionImpact: 'NONE',
    dataConfidencePolicy: 'VERIFIED_COMPUTED_ONLY_FOR_EXECUTION',
    executionImpact: 'NONE',
  };
}

export function formatSimpleDecisionFinalLog(result: SimpleTradeDecisionResult): string {
  return [
    '[SIMPLE_DECISION_FINAL]',
    kv('snapshotId', result.snapshotId),
    kv('symbol', result.symbol),
    kv('dataUsable', result.dataUsable),
    kv('dataGateUsable', result.dataGateUsable),
    kv('gateTotalScore', result.gateTotalScore),
    kv('baseScore', result.baseScore),
    kv('executionScore', result.executionScore),
    kv('adjustmentScore', result.adjustmentScore),
    kv('advisoryScore', result.advisoryScore),
    kv('aiNarrativeScore', result.aiNarrativeScore),
    kv('excludedAiScore', result.excludedAiScore),
    kv('regimeAdjustment', result.regimeAdjustment),
    kv('volumeClockAdjustment', result.volumeClockAdjustment),
    kv('eventAdjustment', result.eventAdjustment),
    kv('riskPenalty', result.riskPenalty),
    kv('diversityAdjustment', result.diversityAdjustment),
    kv('freshnessPenalty', result.freshnessPenalty),
    kv('discoveryBonus', result.discoveryBonus),
    kv('sectorDiversityAdjustment', result.sectorDiversityAdjustment),
    kv('scoreAdjustment', result.scoreAdjustment),
    kv('finalScore', result.finalScore),
    kv('buyThreshold', result.buyThreshold),
    kv('watchThreshold', result.watchThreshold),
    kv('decision', result.decision),
    kv('qualityDecision', result.qualityDecision),
    kv('hardFailReasons', `[${result.hardFailReasons.join(',') || 'none'}]`),
    kv('softFailReasons', `[${result.softFailReasons.join(',') || 'none'}]`),
    kv('label', result.label),
    kv('regime', result.regime),
    kv('maxPositions', result.maxPositions),
    kv('currentPositions', result.currentPositions),
    kv('remainingSlots', result.remainingSlots),
    kv('priceSnapshotId', result.priceSnapshotId),
    kv('currentPrice', result.currentPrice),
    kv('priceConfidence', result.priceConfidence),
    kv('priceAgeSec', result.priceAgeSec),
    kv('orderIntentStatus', result.orderIntentStatus),
    kv('tradePlanValid', result.tradePlanValid),
    kv('aiExecutionImpact', result.aiExecutionImpact),
    kv('dataConfidencePolicy', result.dataConfidencePolicy),
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
