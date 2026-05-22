// @responsibility Always-on counterfactual learning samples for every final trade decision.

import type {
  ConvictionLabel,
  SimpleTradeDecisionResult,
  TradeDecision,
} from './simpleDecision.js';
import type { CandidateExposureHistory } from '../candidateDiversityAdjustment.js';
import type { ProviderHealthSnapshot } from '../../diagnostics/providerMarketSignalIsolationStep16.js';

export type CounterfactualSampleType =
  | 'BUY_ALLOWED_COUNTERFACTUAL'
  | 'WATCH_COUNTERFACTUAL'
  | 'LOW_SCORE_COUNTERFACTUAL'
  | 'DATA_GAP_COUNTERFACTUAL'
  | 'PRICE_GAP_COUNTERFACTUAL'
  | 'RR_INSUFFICIENT_COUNTERFACTUAL'
  | 'TRADE_PLAN_INVALID_COUNTERFACTUAL'
  | 'SLOT_FULL_COUNTERFACTUAL';

export type CounterfactualOutcomeStatus =
  | 'PENDING'
  | 'WOULD_WIN'
  | 'WOULD_LOSS'
  | 'WOULD_BE'
  | 'DATA_STILL_INSUFFICIENT'
  | 'UNRESOLVED';

export interface CounterfactualSample {
  sampleId: string;
  snapshotId: string;
  tradingDate: string;
  asOf: string;
  symbol: string;
  name?: string;
  market?: string;
  decision: TradeDecision;
  label: ConvictionLabel;
  dataUsable: boolean;
  executionScore: number;
  adjustmentScore: number;
  finalScore: number;
  advisoryScore?: number;
  excludedAiScore?: number;
  entryPrice?: number | null;
  stopLoss?: number | null;
  targetPrice?: number | null;
  riskReward?: number | null;
  priceSnapshotId?: string;
  priceConfidence?: string;
  priceAgeSec?: number;
  tradePlanId?: string;
  initialStopLoss?: number | null;
  targetPrice1?: number | null;
  riskReward1?: number | null;
  tradePlanStatus?: string;
  invalidReasons?: string[];
  regime?: string;
  regimeAdjustment?: number;
  volumeClockPhase?: string;
  volumeClockAdjustment?: number;
  eventAdjustment?: number;
  candidateExposureHistory?: CandidateExposureHistory | null;
  freshnessPenalty?: number;
  discoveryBonus?: number;
  sectorDiversityAdjustment?: number;
  totalDiversityAdjustment?: number;
  positionPolicy?: {
    maxPositions: number;
    currentPositions: number;
    remainingSlots: number;
    maxGrossExposurePct: number;
    perPositionPct: number;
  };
  blockers?: string[];
  riskTags: string[];
  learningLabels: string[];
  missingFields?: string[];
  providerHealth?: string;
  providerHealthSnapshot?: ProviderHealthSnapshot;
  providerIssuePresent?: boolean;
  quoteStatus?: string;
  dataHealth?: string;
  excludedFeatures?: string[];
  aiEstimatedFeatureCount?: number;
  aiEvidencePresent?: boolean;
  aiExecutionImpact?: 'NONE';
  sampleType: CounterfactualSampleType;
  executionImpact: 'NONE';
  shadowLearning: true;
  outcomeStatus: CounterfactualOutcomeStatus;
}

export interface RecordCounterfactualInput {
  decision: SimpleTradeDecisionResult;
  sampleId?: string;
  snapshotId?: string;
  tradingDate?: string;
  asOf?: string;
  name?: string;
  market?: string;
  entryPrice?: number | null;
  stopLoss?: number | null;
  targetPrice?: number | null;
  riskReward?: number | null;
  priceSnapshotId?: string;
  priceConfidence?: string;
  priceAgeSec?: number;
  tradePlanId?: string;
  initialStopLoss?: number | null;
  targetPrice1?: number | null;
  riskReward1?: number | null;
  tradePlanStatus?: string;
  invalidReasons?: string[];
  volumeClockPhase?: string;
  volumeClockAdjustment?: number;
  eventAdjustment?: number;
  candidateExposureHistory?: CandidateExposureHistory | null;
  freshnessPenalty?: number;
  discoveryBonus?: number;
  sectorDiversityAdjustment?: number;
  totalDiversityAdjustment?: number;
  maxGrossExposurePct?: number;
  perPositionPct?: number;
  blockers?: string[];
  riskTags?: string[];
  learningLabels?: string[];
  missingFields?: string[];
  providerHealth?: string;
  providerHealthSnapshot?: ProviderHealthSnapshot;
  providerIssuePresent?: boolean;
  quoteStatus?: string;
  dataHealth?: string;
  excludedFeatures?: string[];
  aiEstimatedFeatureCount?: number;
  aiEvidencePresent?: boolean;
  dedupDuplicate?: boolean;
  dedupKey?: string;
  cooldownActive?: boolean;
  cooldownKey?: string;
  notificationSuppressed?: boolean;
}

export interface CounterfactualRecordResult {
  recorded: true;
  sample: CounterfactualSample;
  logs: string[];
  dedupDecisionImpact: 'NONE';
  cooldownDecisionImpact: 'NONE';
  notificationDecisionImpact: 'NONE';
  learningImpact: 'NONE';
}

const inMemoryCounterfactualSamples: CounterfactualSample[] = [];

function kv(key: string, value: unknown): string {
  return `${key}=${value === undefined || value === null ? 'none' : String(value)}`;
}

function tradingDateFromAsOf(asOf: string): string {
  return new Date(asOf).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
}

function sanitizeIdPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'none';
}

export function sampleTypeFromDecision(decision: TradeDecision): CounterfactualSampleType {
  switch (decision) {
    case 'BUY_ALLOWED':
      return 'BUY_ALLOWED_COUNTERFACTUAL';
    case 'WATCH':
      return 'WATCH_COUNTERFACTUAL';
    case 'REJECT_LOW_SCORE':
      return 'LOW_SCORE_COUNTERFACTUAL';
    case 'NO_TRADE_DATA_INCOMPLETE':
      return 'DATA_GAP_COUNTERFACTUAL';
    case 'WATCH_RR_INSUFFICIENT':
      return 'RR_INSUFFICIENT_COUNTERFACTUAL';
    case 'WATCH_SLOT_FULL':
      return 'SLOT_FULL_COUNTERFACTUAL';
  }
}

export function buildCounterfactualSample(input: RecordCounterfactualInput): CounterfactualSample {
  const decision = input.decision;
  const asOf = input.asOf ?? new Date().toISOString();
  const tradingDate = input.tradingDate ?? tradingDateFromAsOf(asOf);
  const snapshotId = input.snapshotId ?? decision.snapshotId ?? `decision_${tradingDate}`;
  const symbol = decision.symbol ?? 'UNKNOWN';
  const tradePlanInvalid = input.tradePlanStatus !== undefined
    && !['VALID', 'RR_INSUFFICIENT'].includes(input.tradePlanStatus);
  const sampleType = tradePlanInvalid
    ? 'TRADE_PLAN_INVALID_COUNTERFACTUAL'
    : (decision.decision === 'NO_TRADE_DATA_INCOMPLETE'
    && (input.missingFields ?? []).some((field) => field === 'priceSnapshot' || field === 'price'))
      ? 'PRICE_GAP_COUNTERFACTUAL'
      : sampleTypeFromDecision(decision.decision);
  const learningLabels = new Set<string>([
    decision.learningLabel,
    sampleType,
    ...(input.learningLabels ?? []),
  ]);
  if (input.aiEvidencePresent === true || decision.excludedAiScore > 0 || (input.aiEstimatedFeatureCount ?? 0) > 0) {
    learningLabels.add('AI_ESTIMATE_OBSERVED');
    learningLabels.add('AI_EXCLUDED_FROM_EXECUTION');
  }
  if (input.providerIssuePresent === true || input.providerHealthSnapshot?.isProviderIssue === true) {
    learningLabels.add('PROVIDER_ISSUE_OBSERVED');
  }
  if (input.providerHealthSnapshot?.status === 'EMPTY_VALID') {
    learningLabels.add('EMPTY_RESPONSE_OBSERVED');
  }
  if (input.dedupDuplicate === true) learningLabels.add('DEDUP_OBSERVED');
  if (input.cooldownActive === true) learningLabels.add('COOLDOWN_OBSERVED');
  if (input.notificationSuppressed === true) learningLabels.add('TELEGRAM_SUPPRESSED_OBSERVED');
  if (input.tradePlanStatus === 'RR_INSUFFICIENT') learningLabels.add('RR_INSUFFICIENT_OBSERVED');
  if (tradePlanInvalid) learningLabels.add('TRADE_PLAN_INVALID_OBSERVED');
  const totalDiversityAdjustment = input.totalDiversityAdjustment ?? decision.diversityAdjustment;
  const freshnessPenalty = input.freshnessPenalty ?? decision.freshnessPenalty;
  const discoveryBonus = input.discoveryBonus ?? decision.discoveryBonus;
  const sectorDiversityAdjustment = input.sectorDiversityAdjustment ?? decision.sectorDiversityAdjustment;
  if (freshnessPenalty < 0) learningLabels.add('REPEATED_CANDIDATE_OBSERVED');
  if (freshnessPenalty < 0) learningLabels.add('FRESHNESS_PENALTY_APPLIED');
  if (discoveryBonus > 0) learningLabels.add('DISCOVERY_BONUS_APPLIED');
  if (sectorDiversityAdjustment !== 0) learningLabels.add('SECTOR_DIVERSITY_ADJUSTMENT_APPLIED');

  const sampleId = input.sampleId ?? [
    'cf',
    sanitizeIdPart(snapshotId),
    sanitizeIdPart(symbol),
    sanitizeIdPart(decision.decision),
    sanitizeIdPart(asOf),
  ].join('_');

  return {
    sampleId,
    snapshotId,
    tradingDate,
    asOf,
    symbol,
    name: input.name,
    market: input.market,
    decision: decision.decision,
    label: decision.label,
    dataUsable: decision.dataUsable,
    executionScore: decision.executionScore,
    adjustmentScore: decision.adjustmentScore,
    finalScore: decision.finalScore,
    advisoryScore: decision.advisoryScore,
    excludedAiScore: decision.excludedAiScore,
    entryPrice: input.entryPrice,
    stopLoss: input.stopLoss,
    targetPrice: input.targetPrice,
    riskReward: input.riskReward,
    priceSnapshotId: input.priceSnapshotId,
    priceConfidence: input.priceConfidence,
    priceAgeSec: input.priceAgeSec,
    tradePlanId: input.tradePlanId,
    initialStopLoss: input.initialStopLoss,
    targetPrice1: input.targetPrice1,
    riskReward1: input.riskReward1,
    tradePlanStatus: input.tradePlanStatus,
    invalidReasons: input.invalidReasons,
    regime: decision.regime,
    regimeAdjustment: decision.regimeAdjustment,
    volumeClockPhase: input.volumeClockPhase,
    volumeClockAdjustment: input.volumeClockAdjustment,
    eventAdjustment: input.eventAdjustment,
    candidateExposureHistory: input.candidateExposureHistory,
    freshnessPenalty,
    discoveryBonus,
    sectorDiversityAdjustment,
    totalDiversityAdjustment,
    positionPolicy: {
      maxPositions: decision.maxPositions,
      currentPositions: decision.currentPositions,
      remainingSlots: decision.remainingSlots,
      maxGrossExposurePct: input.maxGrossExposurePct ?? 0,
      perPositionPct: input.perPositionPct ?? 0,
    },
    blockers: input.blockers ?? decision.blockReasons,
    riskTags: input.riskTags ?? [],
    learningLabels: [...learningLabels],
    missingFields: input.missingFields,
    providerHealth: input.providerHealth ?? input.providerHealthSnapshot?.status,
    providerHealthSnapshot: input.providerHealthSnapshot,
    providerIssuePresent: input.providerIssuePresent ?? input.providerHealthSnapshot?.isProviderIssue ?? false,
    quoteStatus: input.quoteStatus,
    dataHealth: input.dataHealth,
    excludedFeatures: input.excludedFeatures,
    aiEstimatedFeatureCount: input.aiEstimatedFeatureCount,
    aiEvidencePresent: input.aiEvidencePresent ?? decision.excludedAiScore > 0,
    aiExecutionImpact: 'NONE',
    sampleType,
    executionImpact: 'NONE',
    shadowLearning: true,
    outcomeStatus: 'PENDING',
  };
}

export function formatCounterfactualSampleRecordedLog(sample: CounterfactualSample): string {
  return [
    '[COUNTERFACTUAL_SAMPLE_RECORDED]',
    kv('sampleId', sample.sampleId),
    kv('snapshotId', sample.snapshotId),
    kv('symbol', sample.symbol),
    kv('decision', sample.decision),
    kv('label', sample.label),
    kv('sampleType', sample.sampleType),
    kv('finalScore', sample.finalScore),
    kv('dataUsable', sample.dataUsable),
    "executionImpact='NONE'",
    'shadowLearning=true',
    "outcomeStatus='PENDING'",
  ].join(' ');
}

export function formatCounterfactualAlwaysOnEnforcedLog(sample: CounterfactualSample): string {
  return [
    '[COUNTERFACTUAL_ALWAYS_ON_ENFORCED]',
    kv('snapshotId', sample.snapshotId),
    kv('symbol', sample.symbol),
    kv('decision', sample.decision),
    "reason='RECORDED_FOR_ALL_DECISIONS'",
    "executionImpact='NONE'",
  ].join(' ');
}

export function formatDataGapCounterfactualRecordedLog(sample: CounterfactualSample): string {
  return [
    '[DATA_GAP_COUNTERFACTUAL_RECORDED]',
    kv('sampleId', sample.sampleId),
    kv('symbol', sample.symbol),
    kv('missingFields', `[${sample.missingFields?.join(',') || 'none'}]`),
    kv('providerHealth', sample.providerHealth),
    "executionImpact='NONE'",
  ].join(' ');
}

export function formatSlotFullCounterfactualRecordedLog(sample: CounterfactualSample): string {
  return [
    '[SLOT_FULL_COUNTERFACTUAL_RECORDED]',
    kv('sampleId', sample.sampleId),
    kv('symbol', sample.symbol),
    kv('finalScore', sample.finalScore),
    kv('currentPositions', sample.positionPolicy?.currentPositions),
    kv('maxPositions', sample.positionPolicy?.maxPositions),
    "executionImpact='NONE'",
  ].join(' ');
}

export function formatCounterfactualRecordedDespiteDedupLog(input: {
  symbol: string;
  dedupKey?: string;
  sampleId: string;
}): string {
  return [
    '[COUNTERFACTUAL_RECORDED_DESPITE_DEDUP]',
    kv('symbol', input.symbol),
    kv('dedupKey', input.dedupKey),
    kv('sampleId', input.sampleId),
    "executionImpact='NONE'",
  ].join(' ');
}

export function formatCounterfactualRecordedDespiteCooldownLog(input: {
  symbol: string;
  cooldownKey?: string;
  sampleId: string;
}): string {
  return [
    '[COUNTERFACTUAL_RECORDED_DESPITE_COOLDOWN]',
    kv('symbol', input.symbol),
    kv('cooldownKey', input.cooldownKey),
    kv('sampleId', input.sampleId),
    "executionImpact='NONE'",
  ].join(' ');
}

export function recordCounterfactualForDecision(input: RecordCounterfactualInput): CounterfactualRecordResult {
  const sample = buildCounterfactualSample(input);
  inMemoryCounterfactualSamples.push(sample);

  const logs = [
    formatCounterfactualSampleRecordedLog(sample),
    formatCounterfactualAlwaysOnEnforcedLog(sample),
  ];
  if (sample.sampleType === 'DATA_GAP_COUNTERFACTUAL' || sample.sampleType === 'PRICE_GAP_COUNTERFACTUAL') {
    logs.push(formatDataGapCounterfactualRecordedLog(sample));
  }
  if (sample.sampleType === 'SLOT_FULL_COUNTERFACTUAL') logs.push(formatSlotFullCounterfactualRecordedLog(sample));
  if (input.dedupDuplicate === true) {
    logs.push(formatCounterfactualRecordedDespiteDedupLog({
      symbol: sample.symbol,
      dedupKey: input.dedupKey,
      sampleId: sample.sampleId,
    }));
  }
  if (input.cooldownActive === true) {
    logs.push(formatCounterfactualRecordedDespiteCooldownLog({
      symbol: sample.symbol,
      cooldownKey: input.cooldownKey,
      sampleId: sample.sampleId,
    }));
  }

  return {
    recorded: true,
    sample,
    logs,
    dedupDecisionImpact: 'NONE',
    cooldownDecisionImpact: 'NONE',
    notificationDecisionImpact: 'NONE',
    learningImpact: 'NONE',
  };
}

export function loadCounterfactualAlwaysOnSamples(): CounterfactualSample[] {
  return [...inMemoryCounterfactualSamples];
}

export function __resetCounterfactualAlwaysOnSamplesForTests(): void {
  inMemoryCounterfactualSamples.length = 0;
}
