// @responsibility ADR-0522 outcome label closure for the gate attribution learning dataset. No live execution; no provider fetch.

import type {
  ExecutionPermissionDecision,
  FinalDecisionResolverRuntimeInput,
} from '../trading/gates/finalDecisionResolver.js';

export type OutcomeDecisionType =
  | 'LIVE_EXECUTED'
  | 'SHADOW_EXECUTED'
  | 'LIVE_BLOCKED'
  | 'SHADOW_BLOCKED'
  | 'OBSERVE_ONLY'
  | 'COUNTERFACTUAL_ONLY'
  | 'NO_ACTION';

export type OutcomeStatus =
  | 'PENDING'
  | 'LABELED'
  | 'EXPIRED'
  | 'DATA_INSUFFICIENT'
  | 'QUARANTINED';

export type OutcomeLabel =
  | 'WIN'
  | 'LOSS'
  | 'BREAKEVEN'
  | 'PARTIAL_WIN'
  | 'MISSED_WIN'
  | 'AVOIDED_LOSS'
  | 'FALSE_POSITIVE'
  | 'TRUE_NEGATIVE'
  | 'WAIT_VALIDATED'
  | 'WAIT_FAILED'
  | 'DATA_INSUFFICIENT'
  | 'EXPIRED'
  | 'QUARANTINED';

export type ForwardHorizon = '1D' | '3D' | '5D' | '10D' | '20D';
export type PriceDataHealth = 'VERIFIED' | 'STALE' | 'MISSING' | 'DEGRADED';

export interface OutcomeSeed {
  seedId: string;
  dedupKey: string;
  sourceSnapshotId: string;
  symbol: string;
  tradeDate: string;
  createdAt: string;
  decisionType: OutcomeDecisionType;
  requestedSide: 'BUY' | 'SELL' | 'NONE';
  gate1Status: string;
  gate2Status: string;
  gate3Readiness: string;
  entryTimingSignal: string;
  finalAction: string;
  gate1Score?: number | null;
  gate2Score?: number | null;
  gate3CompletionScore?: number | null;
  gate2AxisScores?: Record<string, number | null>;
  gate3ComponentScores?: Record<string, number | null>;
  entryPrice: number | null;
  stopLossPrice: number | null;
  targetPrice: number | null;
  rrrValue: number | null;
  engineMode: string;
  marketSession: string;
  effectiveRegime: string;
  riskOverride?: string;
  liveStrategyVersionId?: string;
  shadowStrategyVersionId?: string;
  canaryStrategyVersionId?: string;
  configHash?: string;
  blockReasons: string[];
  advisoryReasons: string[];
  dataConfidenceCeiling: 'HIGH' | 'MEDIUM' | 'LOW';
  providerIssue: boolean;
  marketSignal: boolean;
  learningTags: string[];
  outcomeStatus: OutcomeStatus;
  labelDueDates: Record<'d1' | 'd3' | 'd5' | 'd10', string>;
  quarantineReason?: string;
  quarantineRecoverable?: boolean;
  quarantineAction?: string;
  forwardReturns?: Partial<Record<ForwardHorizon, ForwardReturnSnapshot>>;
  outcomeLabel?: OutcomeLabel;
  finalLearningLabel?: OutcomeLabel;
  tradeLifecycleOutcome?: string;
  counterfactualOutcomeLabel?: OutcomeLabel;
  learningOutcomeLabel?: OutcomeLabel;
}

export interface ForwardReturnSnapshot {
  seedId: string;
  symbol: string;
  horizon: ForwardHorizon;
  asOf: string;
  entryPrice: number;
  closePrice: number | null;
  highPrice: number | null;
  lowPrice: number | null;
  returnPct: number | null;
  mfePct: number | null;
  maePct: number | null;
  targetHit: boolean;
  stopHit: boolean;
  targetHitAt?: string;
  stopHitAt?: string;
  priceDataHealth: PriceDataHealth;
  labelReady: boolean;
}

export interface GateAttribution {
  seedId: string;
  symbol: string;
  finalLearningLabel: OutcomeLabel;
  gate1Contribution: {
    score: number | null;
    positiveFactors: string[];
    negativeFactors: string[];
    missingFactors: string[];
  };
  gate2Contribution: {
    score: number | null;
    positiveAxes: string[];
    negativeAxes: string[];
    missingAxes: string[];
    strongestAxis?: string;
    weakestAxis?: string;
  };
  gate3Contribution: {
    completionScore: number | null;
    rrrContribution: 'POSITIVE' | 'NEGATIVE' | 'MISSING';
    lastTriggerContribution: 'POSITIVE' | 'NEGATIVE' | 'MISSING';
    priceConfirmationContribution: 'POSITIVE' | 'NEGATIVE' | 'MISSING';
    volumeContribution: 'POSITIVE' | 'NEGATIVE' | 'MISSING';
    falseBreakoutContribution: 'POSITIVE' | 'NEGATIVE' | 'MISSING';
  };
  policyContribution: {
    wasBlocked: boolean;
    blockReason?: string;
    blockOutcome: 'MISSED_WIN' | 'AVOIDED_LOSS' | 'NEUTRAL' | 'UNKNOWN';
  };
  confidenceContribution: {
    dataConfidenceCeiling: string;
    providerIssue: boolean;
    providerIssueAffectedOutcome: boolean;
  };
}

export interface WeightFeedbackSample {
  seedId: string;
  symbol: string;
  factorName: string;
  factorGroup: 'GATE1' | 'GATE2' | 'GATE3' | 'POLICY' | 'CONFIDENCE';
  factorValue: number | string | boolean | null;
  finalLearningLabel: OutcomeLabel;
  return10d: number | null;
  mfe10d: number | null;
  mae10d: number | null;
  suggestedWeightAction: 'INCREASE' | 'DECREASE' | 'KEEP' | 'QUARANTINE' | 'INSUFFICIENT_SAMPLE';
  reason: string;
}

export interface LearningOutcomesSummary {
  outcomeSeedsCreated: number;
  pendingOutcomeCount: number;
  labeledOutcomeCount: number;
  expiredOutcomeCount: number;
  dataInsufficientOutcomeCount: number;
  quarantinedOutcomeCount: number;
  liveExecutedLabeled: number;
  shadowExecutedLabeled: number;
  blockedDecisionLabeled: number;
  observeOnlyLabeled: number;
  counterfactualOnlyLabeled: number;
  missedWinCount: number;
  avoidedLossCount: number;
  falsePositiveCount: number;
  trueNegativeCount: number;
  avgReturn1D: number | null;
  avgReturn3D: number | null;
  avgReturn5D: number | null;
  avgReturn10D: number | null;
  avgMFE10D: number | null;
  avgMAE10D: number | null;
  topPositiveGate2Axis: string;
  topFalsePositiveAxis: string;
  topOverBlockingReason: string;
  topAvoidedLossReason: string;
  duplicateSeedSuppressedCount: number;
  executionImpact: 'NONE';
  shadowLearning: true;
}

function safeKey(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80) || 'UNKNOWN';
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function positive(value: unknown): number | null {
  const n = finite(value);
  return n !== null && n > 0 ? n : null;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function decisionTypeFor(decision: ExecutionPermissionDecision): OutcomeDecisionType {
  if (decision.finalAction === 'LIVE_BUY_ALLOWED' || decision.finalAction === 'LIVE_SELL_ALLOWED') return 'LIVE_EXECUTED';
  if (decision.finalAction === 'SHADOW_BUY_ALLOWED' || decision.finalAction === 'SHADOW_SELL_ALLOWED') {
    const policyLiveBlock = decision.blockReasons.some((reason) => reason !== 'SHADOW_ONLY_LIVE_BLOCKED');
    return policyLiveBlock ? 'LIVE_BLOCKED' : 'SHADOW_EXECUTED';
  }
  if (decision.finalAction === 'OBSERVE_ONLY') return 'OBSERVE_ONLY';
  if (decision.finalAction === 'BLOCKED' && decision.blockReasons.length > 0) return 'COUNTERFACTUAL_ONLY';
  if (decision.decisionTrace.gateDecision === 'ENTRY_READY' && !decision.liveBuyAllowed) return 'LIVE_BLOCKED';
  if (decision.finalAction === 'WAIT') return 'NO_ACTION';
  return 'NO_ACTION';
}

export function buildOutcomeDedupKey(input: {
  sourceSnapshotId: string;
  symbol: string;
  entryTimingSignal: string;
  finalAction: string;
  tradeDate: string;
}): string {
  return [
    input.sourceSnapshotId,
    input.symbol,
    input.entryTimingSignal,
    input.finalAction,
    input.tradeDate,
  ].map(safeKey).join('|');
}

export function buildOutcomeSeed(input: {
  decision: ExecutionPermissionDecision;
  runtimeInput: FinalDecisionResolverRuntimeInput;
  tradeDate?: string;
  gate1Score?: number | null;
  gate2Score?: number | null;
  gate3CompletionScore?: number | null;
  gate2AxisScores?: Record<string, number | null>;
  gate3ComponentScores?: Record<string, number | null>;
  entryPrice?: number | null;
  stopLossPrice?: number | null;
  targetPrice?: number | null;
  rrrValue?: number | null;
  liveStrategyVersionId?: string;
  shadowStrategyVersionId?: string;
  canaryStrategyVersionId?: string;
  configHash?: string;
}): OutcomeSeed {
  const createdAt = input.runtimeInput.asOf ?? '1970-01-01T00:00:00.000Z';
  const tradeDate = input.tradeDate ?? createdAt.slice(0, 10);
  const entryPrice = positive(input.entryPrice);
  const dedupKey = buildOutcomeDedupKey({
    sourceSnapshotId: input.runtimeInput.sourceSnapshotId,
    symbol: input.runtimeInput.symbol,
    entryTimingSignal: input.runtimeInput.entryTimingSignal,
    finalAction: input.decision.finalAction,
    tradeDate,
  });
  const learningTags = input.decision.blockedLearningCase
    ? [input.decision.blockedLearningCase.learningTag]
    : ['CASE_DECISION_OUTCOME_SEED_CREATED'];
  const seed: OutcomeSeed = {
    seedId: `outcome:${dedupKey}`,
    dedupKey,
    sourceSnapshotId: input.runtimeInput.sourceSnapshotId,
    symbol: input.runtimeInput.symbol,
    tradeDate,
    createdAt,
    decisionType: decisionTypeFor(input.decision),
    requestedSide: input.runtimeInput.requestedSide,
    gate1Status: input.runtimeInput.gate1Status,
    gate2Status: input.runtimeInput.gate2Status,
    gate3Readiness: input.runtimeInput.gate3Readiness,
    entryTimingSignal: input.runtimeInput.entryTimingSignal,
    finalAction: input.decision.finalAction,
    gate1Score: input.gate1Score ?? null,
    gate2Score: input.gate2Score ?? null,
    gate3CompletionScore: input.gate3CompletionScore ?? null,
    gate2AxisScores: input.gate2AxisScores ?? {},
    gate3ComponentScores: input.gate3ComponentScores ?? {},
    entryPrice,
    stopLossPrice: positive(input.stopLossPrice),
    targetPrice: positive(input.targetPrice),
    rrrValue: finite(input.rrrValue),
    engineMode: input.runtimeInput.engineMode,
    marketSession: input.runtimeInput.marketSession,
    effectiveRegime: input.runtimeInput.effectiveRegime,
    riskOverride: input.runtimeInput.riskOverride,
    liveStrategyVersionId: input.liveStrategyVersionId,
    shadowStrategyVersionId: input.shadowStrategyVersionId,
    canaryStrategyVersionId: input.canaryStrategyVersionId,
    configHash: input.configHash,
    blockReasons: input.decision.blockReasons,
    advisoryReasons: input.decision.advisoryReasons,
    dataConfidenceCeiling: input.runtimeInput.dataConfidenceCeiling,
    providerIssue: input.runtimeInput.providerIssue,
    marketSignal: false,
    learningTags,
    outcomeStatus: entryPrice === null ? 'DATA_INSUFFICIENT' : 'PENDING',
    labelDueDates: {
      d1: addDays(tradeDate, 1),
      d3: addDays(tradeDate, 3),
      d5: addDays(tradeDate, 5),
      d10: addDays(tradeDate, 10),
    },
    forwardReturns: {},
  };
  if (entryPrice === null) {
    seed.quarantineReason = 'ENTRY_PRICE_MISSING';
    seed.quarantineRecoverable = true;
    seed.quarantineAction = 'WAIT_FOR_ENTRY_REFERENCE';
  }
  return seed;
}

export function buildForwardReturnSnapshot(input: {
  seed: OutcomeSeed;
  horizon: ForwardHorizon;
  asOf: string;
  closePrice: number | null;
  highPrice: number | null;
  lowPrice: number | null;
  priceDataHealth?: PriceDataHealth;
  targetHitAt?: string;
  stopHitAt?: string;
}): ForwardReturnSnapshot {
  const entryPrice = positive(input.seed.entryPrice);
  if (entryPrice === null) {
    throw new Error('ENTRY_PRICE_REQUIRED_FOR_FORWARD_RETURN');
  }
  const closePrice = positive(input.closePrice);
  const highPrice = positive(input.highPrice);
  const lowPrice = positive(input.lowPrice);
  const returnPct = closePrice === null ? null : round4(((closePrice / entryPrice) - 1) * 100);
  const mfePct = highPrice === null ? null : round4(((highPrice / entryPrice) - 1) * 100);
  const maePct = lowPrice === null ? null : round4(((lowPrice / entryPrice) - 1) * 100);
  const targetHit = input.seed.targetPrice !== null && highPrice !== null && highPrice >= input.seed.targetPrice;
  const stopHit = input.seed.stopLossPrice !== null && lowPrice !== null && lowPrice <= input.seed.stopLossPrice;
  const priceDataHealth = input.priceDataHealth ?? (closePrice === null || highPrice === null || lowPrice === null ? 'MISSING' : 'VERIFIED');
  return {
    seedId: input.seed.seedId,
    symbol: input.seed.symbol,
    horizon: input.horizon,
    asOf: input.asOf,
    entryPrice,
    closePrice,
    highPrice,
    lowPrice,
    returnPct,
    mfePct,
    maePct,
    targetHit,
    stopHit,
    ...(targetHit && input.targetHitAt ? { targetHitAt: input.targetHitAt } : {}),
    ...(stopHit && input.stopHitAt ? { stopHitAt: input.stopHitAt } : {}),
    priceDataHealth,
    labelReady: priceDataHealth === 'VERIFIED' && returnPct !== null,
  };
}

function horizon(seed: OutcomeSeed, h: ForwardHorizon): ForwardReturnSnapshot | undefined {
  return seed.forwardReturns?.[h];
}

function finalReturn(seed: OutcomeSeed): number | null {
  return horizon(seed, '10D')?.returnPct
    ?? horizon(seed, '5D')?.returnPct
    ?? horizon(seed, '3D')?.returnPct
    ?? horizon(seed, '1D')?.returnPct
    ?? null;
}

function firstHitLabel(seed: OutcomeSeed): OutcomeLabel | null {
  const snapshots = Object.values(seed.forwardReturns ?? {});
  const targetAt = snapshots.map(s => s?.targetHitAt).filter((v): v is string => !!v).sort()[0];
  const stopAt = snapshots.map(s => s?.stopHitAt).filter((v): v is string => !!v).sort()[0];
  if (targetAt && stopAt) return targetAt <= stopAt ? 'WIN' : 'LOSS';
  if (targetAt) return 'WIN';
  if (stopAt) return 'LOSS';
  if (snapshots.some(s => s?.targetHit)) return 'WIN';
  if (snapshots.some(s => s?.stopHit)) return 'LOSS';
  return null;
}

function isExecuted(seed: OutcomeSeed): boolean {
  return seed.decisionType === 'LIVE_EXECUTED' || seed.decisionType === 'SHADOW_EXECUTED';
}

function isBlockedLike(seed: OutcomeSeed): boolean {
  return seed.decisionType === 'LIVE_BLOCKED'
    || seed.decisionType === 'SHADOW_BLOCKED'
    || seed.decisionType === 'OBSERVE_ONLY'
    || seed.decisionType === 'COUNTERFACTUAL_ONLY';
}

export function closeOutcomeLabel(seed: OutcomeSeed): OutcomeSeed {
  if (seed.outcomeStatus === 'QUARANTINED') return { ...seed, outcomeLabel: 'QUARANTINED', finalLearningLabel: 'QUARANTINED' };
  if (seed.entryPrice === null) return { ...seed, outcomeStatus: 'DATA_INSUFFICIENT', outcomeLabel: 'DATA_INSUFFICIENT', finalLearningLabel: 'DATA_INSUFFICIENT' };
  if (Object.values(seed.forwardReturns ?? {}).some(s => s?.priceDataHealth === 'STALE' || s?.priceDataHealth === 'DEGRADED')) {
    return { ...seed, outcomeStatus: 'QUARANTINED', outcomeLabel: 'QUARANTINED', finalLearningLabel: 'QUARANTINED', quarantineReason: 'PRICE_DATA_NOT_VERIFIED', quarantineRecoverable: true, quarantineAction: 'RETRY_VERIFIED_PRICE_SERIES' };
  }
  if (Object.keys(seed.forwardReturns ?? {}).length === 0) return { ...seed, outcomeStatus: 'PENDING' };
  if (Object.values(seed.forwardReturns ?? {}).every(s => !s?.labelReady)) {
    return { ...seed, outcomeStatus: 'DATA_INSUFFICIENT', outcomeLabel: 'DATA_INSUFFICIENT', finalLearningLabel: 'DATA_INSUFFICIENT' };
  }
  if (seed.tradeLifecycleOutcome?.includes('TP1_THEN_BREAKEVEN')) {
    return { ...seed, outcomeStatus: 'LABELED', outcomeLabel: 'PARTIAL_WIN', finalLearningLabel: 'PARTIAL_WIN', learningOutcomeLabel: 'PARTIAL_WIN' };
  }

  const hit = firstHitLabel(seed);
  const ret = finalReturn(seed);
  let label: OutcomeLabel;
  if (isExecuted(seed)) {
    if (hit) label = hit;
    else if ((ret ?? 0) >= 3) label = 'WIN';
    else if ((ret ?? 0) <= -3) label = 'LOSS';
    else if (Math.abs(ret ?? 0) <= 0.5) label = 'BREAKEVEN';
    else label = (ret ?? 0) > 0 ? 'PARTIAL_WIN' : 'FALSE_POSITIVE';
  } else if (seed.entryTimingSignal === 'WAIT_TRIGGER' || seed.entryTimingSignal === 'WATCH_SETUP') {
    if ((ret ?? 0) >= 5) label = 'MISSED_WIN';
    else if ((ret ?? 0) <= 0) label = 'WAIT_VALIDATED';
    else label = 'EXPIRED';
  } else if (isBlockedLike(seed)) {
    if (hit === 'WIN' || (ret ?? 0) >= 5) label = 'MISSED_WIN';
    else if (hit === 'LOSS' || (ret ?? 0) <= -5) label = 'AVOIDED_LOSS';
    else label = 'TRUE_NEGATIVE';
  } else {
    label = ret === null ? 'EXPIRED' : 'TRUE_NEGATIVE';
  }
  return {
    ...seed,
    outcomeStatus: label === 'EXPIRED' ? 'EXPIRED' : 'LABELED',
    outcomeLabel: label,
    counterfactualOutcomeLabel: isBlockedLike(seed) ? label : seed.counterfactualOutcomeLabel,
    learningOutcomeLabel: label,
    finalLearningLabel: label,
  };
}

export function attachForwardReturn(seed: OutcomeSeed, snapshot: ForwardReturnSnapshot): OutcomeSeed {
  return {
    ...seed,
    forwardReturns: {
      ...(seed.forwardReturns ?? {}),
      [snapshot.horizon]: snapshot,
    },
  };
}

function contributionFromValue(value: number | null | undefined, label: OutcomeLabel): 'POSITIVE' | 'NEGATIVE' | 'MISSING' {
  if (value === null || value === undefined) return 'MISSING';
  if (label === 'WIN' || label === 'MISSED_WIN' || label === 'PARTIAL_WIN') return value >= 60 ? 'POSITIVE' : 'NEGATIVE';
  if (label === 'LOSS' || label === 'FALSE_POSITIVE') return value >= 60 ? 'NEGATIVE' : 'POSITIVE';
  return 'MISSING';
}

export function buildGateAttribution(seed: OutcomeSeed): GateAttribution | null {
  const label = seed.finalLearningLabel ?? seed.outcomeLabel;
  if (!label || label === 'DATA_INSUFFICIENT' || label === 'QUARANTINED') return null;
  const gate2Entries = Object.entries(seed.gate2AxisScores ?? {});
  const sorted = [...gate2Entries].sort((a, b) => (b[1] ?? -Infinity) - (a[1] ?? -Infinity));
  const positiveAxes = gate2Entries.filter(([, v]) => (v ?? 0) >= 70).map(([k]) => k);
  const negativeAxes = gate2Entries.filter(([, v]) => (v ?? 100) < 50).map(([k]) => k);
  const missingAxes = gate2Entries.filter(([, v]) => v === null).map(([k]) => k);
  const blockReason = seed.blockReasons[0];
  const policyOutcome = label === 'MISSED_WIN' ? 'MISSED_WIN'
    : label === 'AVOIDED_LOSS' ? 'AVOIDED_LOSS'
      : label === 'TRUE_NEGATIVE' || label === 'BREAKEVEN' ? 'NEUTRAL'
        : 'UNKNOWN';

  return {
    seedId: seed.seedId,
    symbol: seed.symbol,
    finalLearningLabel: label,
    gate1Contribution: {
      score: seed.gate1Score ?? null,
      positiveFactors: (seed.gate1Score ?? 0) >= 70 ? ['GATE1_SURVIVAL_SCORE'] : [],
      negativeFactors: (seed.gate1Score ?? 100) < 50 ? ['GATE1_WEAK_SURVIVAL_SCORE'] : [],
      missingFactors: seed.gate1Score == null ? ['GATE1_SCORE_MISSING'] : [],
    },
    gate2Contribution: {
      score: seed.gate2Score ?? null,
      positiveAxes: label === 'LOSS' || label === 'FALSE_POSITIVE' ? [] : positiveAxes,
      negativeAxes: label === 'LOSS' || label === 'FALSE_POSITIVE' ? positiveAxes : negativeAxes,
      missingAxes,
      strongestAxis: sorted[0]?.[0],
      weakestAxis: [...gate2Entries].sort((a, b) => (a[1] ?? Infinity) - (b[1] ?? Infinity))[0]?.[0],
    },
    gate3Contribution: {
      completionScore: seed.gate3CompletionScore ?? null,
      rrrContribution: contributionFromValue(seed.rrrValue !== null ? seed.rrrValue * 25 : null, label),
      lastTriggerContribution: contributionFromValue(seed.gate3ComponentScores?.lastTrigger, label),
      priceConfirmationContribution: contributionFromValue(seed.gate3ComponentScores?.priceConfirmation, label),
      volumeContribution: contributionFromValue(seed.gate3ComponentScores?.volumeConfirmation, label),
      falseBreakoutContribution: contributionFromValue(seed.gate3ComponentScores?.falseBreakoutGuard, label),
    },
    policyContribution: {
      wasBlocked: seed.blockReasons.length > 0 || isBlockedLike(seed),
      ...(blockReason ? { blockReason } : {}),
      blockOutcome: policyOutcome,
    },
    confidenceContribution: {
      dataConfidenceCeiling: seed.dataConfidenceCeiling,
      providerIssue: seed.providerIssue,
      providerIssueAffectedOutcome: false,
    },
  };
}

export function buildWeightFeedbackSamples(
  attribution: GateAttribution,
  seed: OutcomeSeed,
  options: { sampleSize?: number } = {},
): WeightFeedbackSample[] {
  const sampleSize = options.sampleSize ?? 1;
  const return10d = horizon(seed, '10D')?.returnPct ?? null;
  const mfe10d = horizon(seed, '10D')?.mfePct ?? null;
  const mae10d = horizon(seed, '10D')?.maePct ?? null;
  const action = (positive: boolean): WeightFeedbackSample['suggestedWeightAction'] => {
    if (sampleSize < 30) return 'INSUFFICIENT_SAMPLE';
    if (seed.finalLearningLabel === 'QUARANTINED') return 'QUARANTINE';
    return positive ? 'INCREASE' : 'DECREASE';
  };
  const samples: WeightFeedbackSample[] = [];
  for (const axis of attribution.gate2Contribution.positiveAxes) {
    samples.push({
      seedId: seed.seedId,
      symbol: seed.symbol,
      factorName: axis,
      factorGroup: 'GATE2',
      factorValue: seed.gate2AxisScores?.[axis] ?? null,
      finalLearningLabel: attribution.finalLearningLabel,
      return10d,
      mfe10d,
      mae10d,
      suggestedWeightAction: action(true),
      reason: sampleSize < 30 ? 'MIN_SAMPLE_NOT_MET' : 'POSITIVE_ATTRIBUTION',
    });
  }
  if (attribution.policyContribution.wasBlocked && attribution.policyContribution.blockReason) {
    samples.push({
      seedId: seed.seedId,
      symbol: seed.symbol,
      factorName: attribution.policyContribution.blockReason,
      factorGroup: 'POLICY',
      factorValue: attribution.policyContribution.blockOutcome,
      finalLearningLabel: attribution.finalLearningLabel,
      return10d,
      mfe10d,
      mae10d,
      suggestedWeightAction: action(attribution.policyContribution.blockOutcome === 'AVOIDED_LOSS'),
      reason: attribution.policyContribution.blockOutcome === 'MISSED_WIN' ? 'OVER_BLOCK_CANDIDATE' : 'POLICY_ATTRIBUTION',
    });
  }
  return samples;
}

export interface CreateSeedResult {
  seed: OutcomeSeed;
  created: boolean;
  duplicateSuppressed: boolean;
  reason: string;
}

export class OutcomeClosureMemoryRepo {
  private readonly seeds = new Map<string, OutcomeSeed>();
  private readonly forwards = new Map<string, ForwardReturnSnapshot[]>();
  private readonly attributions = new Map<string, GateAttribution>();
  private readonly feedback = new Map<string, WeightFeedbackSample[]>();
  duplicateSeedSuppressedCount = 0;
  duplicateSeedReasonDistribution: Record<string, number> = {};

  createSeedIfNotExists(seed: OutcomeSeed): CreateSeedResult {
    const existing = this.seeds.get(seed.dedupKey);
    if (existing) {
      this.duplicateSeedSuppressedCount += 1;
      this.duplicateSeedReasonDistribution.DEDUP_KEY_MATCH = (this.duplicateSeedReasonDistribution.DEDUP_KEY_MATCH ?? 0) + 1;
      return { seed: existing, created: false, duplicateSuppressed: true, reason: 'DEDUP_KEY_MATCH' };
    }
    this.seeds.set(seed.dedupKey, seed);
    return { seed, created: true, duplicateSuppressed: false, reason: 'CREATED' };
  }

  attachForwardReturn(seedId: string, snapshot: ForwardReturnSnapshot): OutcomeSeed | null {
    const seed = this.findBySeedId(seedId);
    if (!seed) return null;
    const updated = attachForwardReturn(seed, snapshot);
    this.seeds.set(updated.dedupKey, updated);
    this.forwards.set(seedId, [...(this.forwards.get(seedId) ?? []), snapshot]);
    return updated;
  }

  closeLabelIfReady(seedId: string): OutcomeSeed | null {
    const seed = this.findBySeedId(seedId);
    if (!seed) return null;
    const closed = closeOutcomeLabel(seed);
    this.seeds.set(closed.dedupKey, closed);
    const attribution = buildGateAttribution(closed);
    if (attribution) {
      this.attributions.set(seedId, attribution);
      this.feedback.set(seedId, buildWeightFeedbackSamples(attribution, closed));
    }
    return closed;
  }

  quarantineSeed(seedId: string, reason: string): OutcomeSeed | null {
    const seed = this.findBySeedId(seedId);
    if (!seed) return null;
    const quarantined = {
      ...seed,
      outcomeStatus: 'QUARANTINED' as const,
      outcomeLabel: 'QUARANTINED' as const,
      finalLearningLabel: 'QUARANTINED' as const,
      quarantineReason: reason,
      quarantineRecoverable: true,
      quarantineAction: 'REVIEW_AND_REBUILD_SEED',
    };
    this.seeds.set(quarantined.dedupKey, quarantined);
    return quarantined;
  }

  findPendingDueSeeds(): OutcomeSeed[] {
    return [...this.seeds.values()].filter(seed => seed.outcomeStatus === 'PENDING');
  }

  findBySymbolAndSnapshot(symbol: string, sourceSnapshotId: string): OutcomeSeed[] {
    return [...this.seeds.values()].filter(seed => seed.symbol === symbol && seed.sourceSnapshotId === sourceSnapshotId);
  }

  summarizeLearningOutcomes(): LearningOutcomesSummary {
    return summarizeLearningOutcomes([...this.seeds.values()], [...this.attributions.values()], this.duplicateSeedSuppressedCount);
  }

  summarizeAttribution(): GateAttribution[] {
    return [...this.attributions.values()];
  }

  listSeeds(): OutcomeSeed[] {
    return [...this.seeds.values()];
  }

  reset(): void {
    this.seeds.clear();
    this.forwards.clear();
    this.attributions.clear();
    this.feedback.clear();
    this.duplicateSeedSuppressedCount = 0;
    this.duplicateSeedReasonDistribution = {};
  }

  private findBySeedId(seedId: string): OutcomeSeed | null {
    return [...this.seeds.values()].find(seed => seed.seedId === seedId) ?? null;
  }
}

function avg(values: Array<number | null | undefined>): number | null {
  const nums = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (nums.length === 0) return null;
  return round4(nums.reduce((sum, value) => sum + value, 0) / nums.length);
}

function top(counts: Record<string, number>): string {
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'none';
}

function inc(counts: Record<string, number>, key: string | undefined): void {
  if (!key) return;
  counts[key] = (counts[key] ?? 0) + 1;
}

export function summarizeLearningOutcomes(
  seeds: readonly OutcomeSeed[],
  attributions: readonly GateAttribution[] = seeds.map(seed => buildGateAttribution(seed)).filter((a): a is GateAttribution => a !== null),
  duplicateSeedSuppressedCount = 0,
): LearningOutcomesSummary {
  const label = (name: OutcomeLabel) => seeds.filter(seed => seed.finalLearningLabel === name || seed.outcomeLabel === name).length;
  const labeled = seeds.filter(seed => seed.outcomeStatus === 'LABELED');
  const gate2Positive: Record<string, number> = {};
  const falsePositiveAxis: Record<string, number> = {};
  const overBlock: Record<string, number> = {};
  const avoided: Record<string, number> = {};
  for (const attr of attributions) {
    for (const axis of attr.gate2Contribution.positiveAxes) inc(gate2Positive, axis);
    if (attr.finalLearningLabel === 'LOSS' || attr.finalLearningLabel === 'FALSE_POSITIVE') {
      for (const axis of attr.gate2Contribution.negativeAxes) inc(falsePositiveAxis, axis);
    }
    if (attr.policyContribution.blockOutcome === 'MISSED_WIN') inc(overBlock, attr.policyContribution.blockReason);
    if (attr.policyContribution.blockOutcome === 'AVOIDED_LOSS') inc(avoided, attr.policyContribution.blockReason);
  }
  return {
    outcomeSeedsCreated: seeds.length,
    pendingOutcomeCount: seeds.filter(seed => seed.outcomeStatus === 'PENDING').length,
    labeledOutcomeCount: labeled.length,
    expiredOutcomeCount: seeds.filter(seed => seed.outcomeStatus === 'EXPIRED').length,
    dataInsufficientOutcomeCount: seeds.filter(seed => seed.outcomeStatus === 'DATA_INSUFFICIENT').length,
    quarantinedOutcomeCount: seeds.filter(seed => seed.outcomeStatus === 'QUARANTINED').length,
    liveExecutedLabeled: labeled.filter(seed => seed.decisionType === 'LIVE_EXECUTED').length,
    shadowExecutedLabeled: labeled.filter(seed => seed.decisionType === 'SHADOW_EXECUTED').length,
    blockedDecisionLabeled: labeled.filter(seed => seed.decisionType === 'LIVE_BLOCKED' || seed.decisionType === 'COUNTERFACTUAL_ONLY').length,
    observeOnlyLabeled: labeled.filter(seed => seed.decisionType === 'OBSERVE_ONLY').length,
    counterfactualOnlyLabeled: labeled.filter(seed => seed.decisionType === 'COUNTERFACTUAL_ONLY').length,
    missedWinCount: label('MISSED_WIN'),
    avoidedLossCount: label('AVOIDED_LOSS'),
    falsePositiveCount: label('FALSE_POSITIVE'),
    trueNegativeCount: label('TRUE_NEGATIVE'),
    avgReturn1D: avg(seeds.map(seed => horizon(seed, '1D')?.returnPct)),
    avgReturn3D: avg(seeds.map(seed => horizon(seed, '3D')?.returnPct)),
    avgReturn5D: avg(seeds.map(seed => horizon(seed, '5D')?.returnPct)),
    avgReturn10D: avg(seeds.map(seed => horizon(seed, '10D')?.returnPct)),
    avgMFE10D: avg(seeds.map(seed => horizon(seed, '10D')?.mfePct)),
    avgMAE10D: avg(seeds.map(seed => horizon(seed, '10D')?.maePct)),
    topPositiveGate2Axis: top(gate2Positive),
    topFalsePositiveAxis: top(falsePositiveAxis),
    topOverBlockingReason: top(overBlock),
    topAvoidedLossReason: top(avoided),
    duplicateSeedSuppressedCount,
    executionImpact: 'NONE',
    shadowLearning: true,
  };
}

export function formatLearningOutcomesSummary(summary: LearningOutcomesSummary): string {
  return [
    '[Learning Outcomes]',
    `Seeds: created ${summary.outcomeSeedsCreated} / pending ${summary.pendingOutcomeCount} / labeled ${summary.labeledOutcomeCount}`,
    `Labels: MISSED_WIN ${summary.missedWinCount} / AVOIDED_LOSS ${summary.avoidedLossCount} / DATA_INSUFFICIENT ${summary.dataInsufficientOutcomeCount} / QUARANTINED ${summary.quarantinedOutcomeCount}`,
    `Blocked: MISSED_WIN ${summary.missedWinCount} / AVOIDED_LOSS ${summary.avoidedLossCount}`,
    `Shadow: labeled ${summary.shadowExecutedLabeled}`,
    `Returns: 1D ${summary.avgReturn1D ?? 'N/A'} / 3D ${summary.avgReturn3D ?? 'N/A'} / 5D ${summary.avgReturn5D ?? 'N/A'} / 10D ${summary.avgReturn10D ?? 'N/A'}`,
    `MFE/MAE 10D: ${summary.avgMFE10D ?? 'N/A'} / ${summary.avgMAE10D ?? 'N/A'}`,
    `Top Positive Axis: ${summary.topPositiveGate2Axis}`,
    `Top False Positive Axis: ${summary.topFalsePositiveAxis}`,
    `Top OverBlock: ${summary.topOverBlockingReason}`,
    `Top AvoidedLoss: ${summary.topAvoidedLossReason}`,
    `duplicateSeedSuppressed: ${summary.duplicateSeedSuppressedCount}`,
    'ExecutionImpact: NONE for learning',
    'ShadowLearning: true',
  ].join('\n');
}

export const outcomeClosureRepo = new OutcomeClosureMemoryRepo();
