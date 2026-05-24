// @responsibility ADR-0520 Gate3 runtime regression and LastTrigger closure diagnostics.

import { evaluateGate3LastTrigger } from './gate3LastTrigger.js';
import type { Gate2Status } from './gate2ConfluenceScore.js';

export type RrrClosureStatus =
  | 'RRR_STRONG'
  | 'RRR_ACCEPTABLE'
  | 'RRR_WEAK'
  | 'RRR_FAIL'
  | 'RRR_DATA_INCOMPLETE'
  | 'RRR_INVALID';

export type LastTriggerState =
  | 'NOT_EVALUATED'
  | 'SETUP_NOT_READY'
  | 'SETUP_READY'
  | 'TRIGGER_WAIT'
  | 'TRIGGERED'
  | 'TRIGGER_EXPIRED'
  | 'DATA_UNAVAILABLE'
  | 'INVALIDATED';

export type PriceConfirmationClosureStatus =
  | 'PRICE_CONFIRMED'
  | 'PRICE_WAIT'
  | 'PRICE_REJECTED'
  | 'PRICE_DATA_UNAVAILABLE';

export type VolumeConfirmationClosureStatus =
  | 'VOLUME_CONFIRMED'
  | 'VOLUME_WEAK'
  | 'VOLUME_DRYUP_WATCH'
  | 'VOLUME_DATA_UNAVAILABLE';

export type FalseBreakoutClosureStatus =
  | 'FALSE_BREAKOUT_PASS'
  | 'FALSE_BREAKOUT_WATCH'
  | 'FALSE_BREAKOUT_BLOCK'
  | 'FALSE_BREAKOUT_DATA_UNAVAILABLE';

export type Gate3RuntimeReadiness =
  | 'EXECUTION_READY'
  | 'SHADOW_READY'
  | 'TRIGGER_WAIT'
  | 'SETUP_READY'
  | 'DATA_INCOMPLETE'
  | 'TIMING_FAIL'
  | 'INVALIDATED'
  | 'SKIPPED';

export type Gate3CompletionLevel =
  | 'GATE3_READY'
  | 'GATE3_TRIGGER_WAIT'
  | 'GATE3_SETUP_WATCH'
  | 'GATE3_DATA_INCOMPLETE_OR_WEAK'
  | 'GATE3_FAIL';

export type EntryTimingSignal =
  | 'ENTRY_READY'
  | 'WAIT_TRIGGER'
  | 'WATCH_SETUP'
  | 'DO_NOT_ENTER'
  | 'DATA_INCOMPLETE';

export interface Gate3RuntimeEvaluationResult {
  symbol: string;
  name?: string;
  sourceSnapshotId: string;
  gate1Status: string;
  gate2Status: string;
  gate3Readiness: Gate3RuntimeReadiness;
  gate3ReadinessReason: string;
  completionScore: number | null;
  completionLevel: Gate3CompletionLevel;
  gate3ComponentScores: {
    rrrProfile: number;
    lastTrigger: number;
    priceConfirmation: number;
    volumeConfirmation: number;
    falseBreakoutGuard: number;
    dataFreshness: number;
  };
  gate3WeakestComponent: string;
  gate3MissingComponent: string | null;
  rrrStatus: RrrClosureStatus;
  rrrValue: number | null;
  rrrMissingReason?: string;
  rrrStopFallbackUsed: boolean;
  rrrTargetFallbackUsed: boolean;
  rrrExecutionReadinessImpact: 'NONE' | 'WAIT' | 'TIMING_FAIL' | 'DATA_INCOMPLETE';
  rrrDataIncompleteButObservable: boolean;
  lastTriggerState: LastTriggerState;
  lastTriggerReason?: string;
  lastTriggerWaitReason?: string;
  lastTriggerInvalidationReason?: string;
  lastTriggerAgeBars: number | null;
  priceConfirmationStatus: PriceConfirmationClosureStatus;
  priceFreshness: string;
  entryPrice: number | null;
  stopLossPrice: number | null;
  targetPrice: number | null;
  breakoutLevel: number | null;
  priceConfirmationBreakPoint: string;
  volumeConfirmationStatus: VolumeConfirmationClosureStatus;
  volume: number | null;
  volumeMA20: number | null;
  volumeRatio: number | null;
  vcpDryupDetected: boolean;
  volumeExpansionDetected: boolean;
  volumeConfirmationBreakPoint: string;
  falseBreakoutStatus: FalseBreakoutClosureStatus;
  falseBreakoutReason: string;
  falseBreakoutPenalty: number;
  falseBreakoutPositionSizeCap: number;
  entryTimingSignal: EntryTimingSignal;
  positionSizeCap: number;
  executionImpact: 'NONE';
  livePermissionNotEvaluatedHere: true;
  shadowLearning: true;
  counterfactualRecorded: boolean;
}

export interface Gate3RuntimeClosureSummary {
  sourceSnapshotId: string;
  totalCandidates: number;
  evaluated: number;
  gate3Ready: number;
  shadowReady: number;
  triggerWait: number;
  setupReady: number;
  dataIncomplete: number;
  timingFail: number;
  invalidated: number;
  skipped: number;
  rrrComputed: number;
  rrrMissing: number;
  rrrMissingReasonDistribution: Record<string, number>;
  rrrFallbackStopUsedCount: number;
  rrrFallbackTargetUsedCount: number;
  rrrInvalidRiskCount: number;
  rrrInvalidRewardCount: number;
  rrrInputCoverage: Record<string, number>;
  rrrBuilderBreakPointDistribution: Record<string, number>;
  lastTriggerTriggered: number;
  lastTriggerWait: number;
  lastTriggerSetupReadyCount: number;
  lastTriggerTriggeredCount: number;
  lastTriggerDataUnavailableCount: number;
  lastTriggerStateDistribution: Record<LastTriggerState, number>;
  priceConfirmed: number;
  priceConfirmationBreakPointDistribution: Record<string, number>;
  volumeConfirmed: number;
  volumeConfirmationBreakPointDistribution: Record<string, number>;
  falseBreakoutPass: number;
  falseBreakoutReasonDistribution: Record<string, number>;
  avgCompletionScore: number | null;
  gate3InputFromGate2PassStrong: number;
  gate3InputFromGate2PassWeak: number;
  gate3DiagnosticOnlyFromGate2Watch: number;
  gate3SkippedByGate2Fail: number;
  gate3SkippedByGate1HardFail: number;
  gate3TransitionBreakPointDistribution: Record<string, number>;
  outcomeSeedFieldsRecorded: number;
  results: Gate3RuntimeEvaluationResult[];
  executionImpact: 'NONE';
  marketSignal: false;
  shadowLearning: true;
  counterfactualRecorded: true;
}

type AnyRecord = Record<string, unknown>;

function recordOf(value: unknown): AnyRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as AnyRecord : null;
}

function getByPath(source: unknown, path: string): unknown {
  let current: unknown = source;
  for (const part of path.split('.')) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as AnyRecord)[part];
  }
  return current;
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

function upper(value: unknown, fallback = 'UNKNOWN'): string {
  return text(value, fallback).toUpperCase();
}

function numberOf(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value.replace(/,/g, ''));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function firstNumber(source: unknown, paths: readonly string[]): number | null {
  for (const path of paths) {
    const n = numberOf(getByPath(source, path));
    if (n != null) return n;
  }
  return null;
}

function increment<T extends string>(counts: Record<T, number>, key: T): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

function incrementAny(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function buildQuote(trace: AnyRecord): AnyRecord {
  return {
    ...recordOf(trace.quote),
    ...recordOf(trace.symbolFeatures),
    ...recordOf(trace.quoteFeatures),
    ...recordOf(trace.technicalIndicators),
    symbol: trace.symbol ?? getByPath(trace, 'quote.symbol'),
    price: trace.price ?? trace.currentPrice ?? getByPath(trace, 'quote.price'),
    currentPrice: trace.currentPrice ?? trace.price ?? getByPath(trace, 'quote.currentPrice') ?? getByPath(trace, 'quote.price'),
    priceFreshness: trace.priceFreshness ?? trace.quoteFreshness ?? getByPath(trace, 'quote.priceFreshness') ?? getByPath(trace, 'quote.quoteFreshness'),
    quoteFreshness: trace.quoteFreshness ?? trace.priceFreshness ?? getByPath(trace, 'quote.quoteFreshness') ?? getByPath(trace, 'quote.priceFreshness'),
    entryPriceAgeSec: trace.entryPriceAgeSec ?? getByPath(trace, 'quote.entryPriceAgeSec'),
    entryPriceSource: trace.entryPriceSource ?? getByPath(trace, 'quote.entryPriceSource'),
    rawEntryPrice: trace.rawEntryPrice ?? getByPath(trace, 'quote.rawEntryPrice'),
    adjustedEntryPrice: trace.adjustedEntryPrice ?? getByPath(trace, 'quote.adjustedEntryPrice'),
    driftPct: trace.driftPct ?? getByPath(trace, 'quote.driftPct'),
    stopLoss: trace.stopLoss ?? trace.stopLossPrice ?? getByPath(trace, 'quote.stopLoss') ?? getByPath(trace, 'quote.stopLossPrice'),
    stopLossPrice: trace.stopLossPrice ?? trace.stopLoss ?? getByPath(trace, 'quote.stopLossPrice') ?? getByPath(trace, 'quote.stopLoss'),
    targetPrice: trace.targetPrice ?? getByPath(trace, 'quote.targetPrice'),
    takeProfitPrice: trace.takeProfitPrice ?? getByPath(trace, 'quote.takeProfitPrice'),
    expectedTargetPrice: trace.expectedTargetPrice ?? getByPath(trace, 'quote.expectedTargetPrice'),
    recentSwingLow: trace.recentSwingLow ?? getByPath(trace, 'quote.recentSwingLow'),
    recentSwingHigh: trace.recentSwingHigh ?? getByPath(trace, 'quote.recentSwingHigh'),
    supportLevel: trace.supportLevel ?? getByPath(trace, 'quote.supportLevel'),
    resistanceLevel: trace.resistanceLevel ?? getByPath(trace, 'quote.resistanceLevel'),
    falseBreakoutRisk: trace.falseBreakoutRisk ?? trace.falseBreakoutStatus ?? getByPath(trace, 'quote.falseBreakoutRisk') ?? getByPath(trace, 'quote.falseBreakoutStatus'),
    falseBreakoutStatus: trace.falseBreakoutStatus ?? trace.falseBreakoutRisk ?? getByPath(trace, 'quote.falseBreakoutStatus') ?? getByPath(trace, 'quote.falseBreakoutRisk'),
    volume: trace.volume ?? getByPath(trace, 'quote.volume'),
    avgVolume: trace.avgVolume ?? getByPath(trace, 'quote.avgVolume'),
    avgVolume20d: trace.avgVolume20d ?? getByPath(trace, 'quote.avgVolume20d') ?? getByPath(trace, 'quote.vol20dAvg'),
    tradingValue: trace.tradingValue ?? getByPath(trace, 'quote.tradingValue'),
    avgTradingValue20d: trace.avgTradingValue20d ?? getByPath(trace, 'quote.avgTradingValue20d'),
    high5d: trace.high5d ?? getByPath(trace, 'quote.high5d'),
    high20d: trace.high20d ?? getByPath(trace, 'quote.high20d') ?? getByPath(trace, 'quote.high20'),
    high60d: trace.high60d ?? trace.high60 ?? getByPath(trace, 'quote.high60d') ?? getByPath(trace, 'quote.high60'),
    boxHigh: trace.boxHigh ?? trace.boxTop ?? trace.recentResistance ?? getByPath(trace, 'quote.boxHigh') ?? getByPath(trace, 'quote.boxTop') ?? getByPath(trace, 'quote.recentResistance'),
    ma20: trace.ma20 ?? getByPath(trace, 'quote.ma20') ?? getByPath(trace, 'symbolFeatures.ma20'),
    ma60: trace.ma60 ?? getByPath(trace, 'quote.ma60') ?? getByPath(trace, 'symbolFeatures.ma60'),
    rsi14: trace.rsi14 ?? getByPath(trace, 'quote.rsi14'),
    macdHistogram: trace.macdHistogram ?? getByPath(trace, 'quote.macdHistogram'),
    macd5dHistAgo: trace.macd5dHistAgo ?? getByPath(trace, 'quote.macd5dHistAgo'),
    atr14: trace.atr14 ?? trace.atr ?? getByPath(trace, 'quote.atr14') ?? getByPath(trace, 'quote.atr'),
  };
}

function resolveGate1Status(trace: AnyRecord): string {
  const explicit = upper(trace.gate1Status ?? getByPath(trace, 'gate1Trace.status'), '');
  if (explicit === 'FAIL_HARD' || explicit === 'HARD_FAIL' || explicit === 'SKIPPED_BY_GATE1') return 'FAIL_HARD';
  if (explicit === 'DATA_INCOMPLETE') return 'DATA_INCOMPLETE';
  if (trace.gate1Passed === true || getByPath(trace, 'gate1Trace.gate1Passed') === true) return 'PASS';
  const hardFailCount = numberOf(getByPath(trace, 'gate1Trace.hardFailCount')) ?? numberOf(trace.hardFailCount) ?? 0;
  const providerSoftened = getByPath(trace, 'gate1Trace.wouldPassIfProviderIssueSoftened') === true
    || trace.wouldPassIfProviderIssueSoftened === true;
  const supplyIgnored = getByPath(trace, 'gate1Trace.wouldPassIfSupplySampleIgnored') === true
    || trace.wouldPassIfSupplySampleIgnored === true;
  if (hardFailCount > 0 && !providerSoftened && !supplyIgnored) return 'FAIL_HARD';
  if (providerSoftened || supplyIgnored) return 'DEGRADED_PASS';
  return explicit || 'DIAGNOSTIC_ELIGIBLE';
}

function rrrStatus(value: number | null, legacyStatus: string, missingReason?: string): RrrClosureStatus {
  if (legacyStatus === 'MISSING') return missingReason?.includes('INVALID') ? 'RRR_INVALID' : 'RRR_DATA_INCOMPLETE';
  if (value == null) return 'RRR_DATA_INCOMPLETE';
  if (value >= 3) return 'RRR_STRONG';
  if (value >= 2) return 'RRR_ACCEPTABLE';
  if (value >= 1.5) return 'RRR_WEAK';
  return 'RRR_FAIL';
}

function priceStatus(raw: string): PriceConfirmationClosureStatus {
  if (raw === 'BREAKOUT_CONFIRMED' || raw === 'CONFIRMED') return 'PRICE_CONFIRMED';
  if (raw === 'NEAR_BREAKOUT' || raw === 'PULLBACK_ENTRY') return 'PRICE_WAIT';
  if (raw === 'DATA_UNAVAILABLE' || raw === 'MISSING' || raw === 'UNKNOWN') return 'PRICE_DATA_UNAVAILABLE';
  return 'PRICE_REJECTED';
}

function volumeStatus(raw: string): VolumeConfirmationClosureStatus {
  if (raw === 'CONFIRMED' || raw === 'PASS') return 'VOLUME_CONFIRMED';
  if (raw === 'DRY_UP' || raw === 'PARTIAL') return 'VOLUME_DRYUP_WATCH';
  if (raw === 'DATA_UNAVAILABLE' || raw === 'MISSING' || raw === 'UNKNOWN') return 'VOLUME_DATA_UNAVAILABLE';
  return 'VOLUME_WEAK';
}

function falseBreakoutStatus(raw: string): FalseBreakoutClosureStatus {
  if (raw === 'LOW' || raw === 'LOW_RISK' || raw === 'PASS' || raw === 'NONE') return 'FALSE_BREAKOUT_PASS';
  if (raw === 'HIGH' || raw === 'HIGH_RISK' || raw === 'BLOCK') return 'FALSE_BREAKOUT_BLOCK';
  if (raw === 'MISSING' || raw === 'DATA_UNAVAILABLE') return 'FALSE_BREAKOUT_DATA_UNAVAILABLE';
  return 'FALSE_BREAKOUT_WATCH';
}

function completionLevel(score: number | null): Gate3CompletionLevel {
  if (score == null) return 'GATE3_FAIL';
  if (score >= 85) return 'GATE3_READY';
  if (score >= 70) return 'GATE3_TRIGGER_WAIT';
  if (score >= 50) return 'GATE3_SETUP_WATCH';
  if (score >= 30) return 'GATE3_DATA_INCOMPLETE_OR_WEAK';
  return 'GATE3_FAIL';
}

function minComponent(components: Gate3RuntimeEvaluationResult['gate3ComponentScores']): string {
  const [entry] = Object.entries(components).sort((a, b) => a[1] - b[1]);
  return entry?.[0] ?? 'unknown';
}

function transitionFor(gate1Status: string, gate2Status: string): string {
  if (gate1Status === 'FAIL_HARD') return 'GATE1_HARD_FAIL_SKIP';
  if (gate2Status === 'GATE2_FAIL') return 'GATE2_FAIL_SKIP';
  if (gate2Status === 'GATE2_WATCH') return 'GATE2_WATCH_DIAGNOSTIC_ONLY';
  if (gate2Status === 'DATA_INCOMPLETE') return 'GATE2_DATA_INCOMPLETE_DIAGNOSTIC_ONLY';
  if (gate2Status === 'GATE2_PASS_STRONG') return 'GATE2_PASS_STRONG_FULL';
  if (gate2Status === 'GATE2_PASS_WEAK') return 'GATE2_PASS_WEAK_FULL_CAP_0_5';
  return 'GATE2_UNKNOWN_DIAGNOSTIC_ONLY';
}

function skippedResult(input: {
  trace: AnyRecord;
  sourceSnapshotId: string;
  gate1Status: string;
  gate2Status: string;
  reason: string;
}): Gate3RuntimeEvaluationResult {
  const symbol = text(input.trace.symbol ?? getByPath(input.trace, 'quote.symbol'), 'UNKNOWN');
  const name = text(input.trace.name, '');
  const components = { rrrProfile: 0, lastTrigger: 0, priceConfirmation: 0, volumeConfirmation: 0, falseBreakoutGuard: 0, dataFreshness: 0 };
  return {
    symbol,
    ...(name ? { name } : {}),
    sourceSnapshotId: input.sourceSnapshotId,
    gate1Status: input.gate1Status,
    gate2Status: input.gate2Status,
    gate3Readiness: 'SKIPPED',
    gate3ReadinessReason: input.reason,
    completionScore: null,
    completionLevel: 'GATE3_FAIL',
    gate3ComponentScores: components,
    gate3WeakestComponent: 'notEvaluated',
    gate3MissingComponent: 'all',
    rrrStatus: 'RRR_DATA_INCOMPLETE',
    rrrValue: null,
    rrrMissingReason: 'NOT_EVALUATED',
    rrrStopFallbackUsed: false,
    rrrTargetFallbackUsed: false,
    rrrExecutionReadinessImpact: 'DATA_INCOMPLETE',
    rrrDataIncompleteButObservable: true,
    lastTriggerState: 'NOT_EVALUATED',
    lastTriggerReason: input.reason,
    lastTriggerAgeBars: null,
    priceConfirmationStatus: 'PRICE_DATA_UNAVAILABLE',
    priceFreshness: 'MISSING',
    entryPrice: null,
    stopLossPrice: null,
    targetPrice: null,
    breakoutLevel: null,
    priceConfirmationBreakPoint: input.reason,
    volumeConfirmationStatus: 'VOLUME_DATA_UNAVAILABLE',
    volume: null,
    volumeMA20: null,
    volumeRatio: null,
    vcpDryupDetected: false,
    volumeExpansionDetected: false,
    volumeConfirmationBreakPoint: input.reason,
    falseBreakoutStatus: 'FALSE_BREAKOUT_DATA_UNAVAILABLE',
    falseBreakoutReason: input.reason,
    falseBreakoutPenalty: 0,
    falseBreakoutPositionSizeCap: 1,
    entryTimingSignal: 'DO_NOT_ENTER',
    positionSizeCap: 0,
    executionImpact: 'NONE',
    livePermissionNotEvaluatedHere: true,
    shadowLearning: true,
    counterfactualRecorded: true,
  };
}

export function buildGate3RuntimeEvaluation(input: {
  trace: Record<string, unknown>;
  sourceSnapshotId?: string | null;
  gate2Status?: Gate2Status | string | null;
  liveBlockedByPolicy?: boolean;
}): Gate3RuntimeEvaluationResult {
  const trace = input.trace as AnyRecord;
  const sourceSnapshotId = text(input.sourceSnapshotId, 'UNKNOWN_SOURCE_SNAPSHOT');
  const gate1Status = resolveGate1Status(trace);
  const gate2Status = text(trace.gate2Status ?? input.gate2Status ?? (trace.gate2Passed === true ? 'GATE2_PASS_WEAK' : 'DATA_INCOMPLETE'), 'DATA_INCOMPLETE');
  const transition = transitionFor(gate1Status, gate2Status);
  if (transition === 'GATE1_HARD_FAIL_SKIP' || transition === 'GATE2_FAIL_SKIP') {
    return skippedResult({ trace, sourceSnapshotId, gate1Status, gate2Status, reason: transition });
  }

  const quote = buildQuote(trace);
  const last = evaluateGate3LastTrigger({ quote });
  const rrr = last.rrrCheck;
  const rrrClosure = rrrStatus(rrr.rrr, rrr.status, rrr.missingReason);
  const priceClosure = priceStatus(last.priceConfirmation.status);
  const volumeClosure = volumeStatus(last.volumeConfirmationDetail.status);
  const falseClosure = falseBreakoutStatus(String(last.falseBreakoutRisk));
  const falseBlock = falseClosure === 'FALSE_BREAKOUT_BLOCK';
  const falseWatch = falseClosure === 'FALSE_BREAKOUT_WATCH' || falseClosure === 'FALSE_BREAKOUT_DATA_UNAVAILABLE';

  let lastTriggerState: LastTriggerState;
  if (last.status === 'FIRED') lastTriggerState = 'TRIGGERED';
  else if (last.status === 'DATA_UNAVAILABLE') lastTriggerState = 'DATA_UNAVAILABLE';
  else if (last.status === 'SANITY_REJECTED') lastTriggerState = 'INVALIDATED';
  else if (rrrClosure === 'RRR_FAIL' || rrrClosure === 'RRR_WEAK' || falseBlock) lastTriggerState = 'SETUP_NOT_READY';
  else if (priceClosure === 'PRICE_WAIT' || volumeClosure === 'VOLUME_DRYUP_WATCH') lastTriggerState = 'TRIGGER_WAIT';
  else if (priceClosure === 'PRICE_CONFIRMED' && volumeClosure !== 'VOLUME_CONFIRMED') lastTriggerState = 'SETUP_READY';
  else lastTriggerState = 'SETUP_NOT_READY';

  const dataIncomplete = rrrClosure === 'RRR_DATA_INCOMPLETE'
    || rrrClosure === 'RRR_INVALID'
    || lastTriggerState === 'DATA_UNAVAILABLE'
    || priceClosure === 'PRICE_DATA_UNAVAILABLE'
    || volumeClosure === 'VOLUME_DATA_UNAVAILABLE';
  let gate3Readiness: Gate3RuntimeReadiness;
  if (lastTriggerState === 'INVALIDATED') gate3Readiness = 'INVALIDATED';
  else if (dataIncomplete) gate3Readiness = 'DATA_INCOMPLETE';
  else if (lastTriggerState === 'TRIGGERED') gate3Readiness = input.liveBlockedByPolicy ? 'SHADOW_READY' : 'EXECUTION_READY';
  else if (lastTriggerState === 'TRIGGER_WAIT') gate3Readiness = 'TRIGGER_WAIT';
  else if (lastTriggerState === 'SETUP_READY') gate3Readiness = 'SETUP_READY';
  else gate3Readiness = 'TIMING_FAIL';

  const rrrScore = rrrClosure === 'RRR_STRONG' ? 30
    : rrrClosure === 'RRR_ACCEPTABLE' ? 26
      : rrrClosure === 'RRR_WEAK' ? 18
        : rrrClosure === 'RRR_DATA_INCOMPLETE' ? 10
          : rrrClosure === 'RRR_FAIL' ? 5
            : 0;
  const lastScore = lastTriggerState === 'TRIGGERED' ? 25
    : lastTriggerState === 'TRIGGER_WAIT' ? 18
      : lastTriggerState === 'SETUP_READY' ? 15
        : lastTriggerState === 'DATA_UNAVAILABLE' ? 5
          : lastTriggerState === 'SETUP_NOT_READY' ? 8
            : 0;
  const priceScore = priceClosure === 'PRICE_CONFIRMED' ? 15 : priceClosure === 'PRICE_WAIT' ? 10 : priceClosure === 'PRICE_REJECTED' ? 3 : 0;
  const volumeScore = volumeClosure === 'VOLUME_CONFIRMED' ? 15 : volumeClosure === 'VOLUME_DRYUP_WATCH' ? 9 : volumeClosure === 'VOLUME_WEAK' ? 2 : 0;
  const falseScore = falseClosure === 'FALSE_BREAKOUT_PASS' ? 10 : falseWatch ? 5 : 0;
  const freshScore = last.entryPriceGuard.priceFreshness === 'VERIFIED' || last.entryPriceGuard.priceFreshness === 'FRESH' ? 5 : 0;
  const components = {
    rrrProfile: rrrScore,
    lastTrigger: lastScore,
    priceConfirmation: priceScore,
    volumeConfirmation: volumeScore,
    falseBreakoutGuard: falseScore,
    dataFreshness: freshScore,
  };
  const completionScore = Object.values(components).reduce((sum, score) => sum + score, 0);
  const entryTimingSignal: EntryTimingSignal = gate3Readiness === 'EXECUTION_READY' || gate3Readiness === 'SHADOW_READY'
    ? 'ENTRY_READY'
    : gate3Readiness === 'TRIGGER_WAIT'
      ? 'WAIT_TRIGGER'
      : gate3Readiness === 'SETUP_READY'
        ? 'WATCH_SETUP'
        : gate3Readiness === 'DATA_INCOMPLETE'
          ? 'DATA_INCOMPLETE'
          : 'DO_NOT_ENTER';
  const symbol = text(trace.symbol ?? getByPath(trace, 'quote.symbol'), 'UNKNOWN');
  const name = text(trace.name, '');
  const missingReason = rrr.missingReason ?? (rrr.status === 'MISSING' ? 'RRR_DATA_INCOMPLETE' : undefined);

  return {
    symbol,
    ...(name ? { name } : {}),
    sourceSnapshotId,
    gate1Status,
    gate2Status,
    gate3Readiness,
    gate3ReadinessReason: last.reason ?? gate3Readiness,
    completionScore,
    completionLevel: completionLevel(completionScore),
    gate3ComponentScores: components,
    gate3WeakestComponent: minComponent(components),
    gate3MissingComponent: dataIncomplete
      ? missingReason ?? (priceClosure === 'PRICE_DATA_UNAVAILABLE' ? 'priceConfirmation' : 'volumeConfirmation')
      : null,
    rrrStatus: rrrClosure,
    rrrValue: rrr.rrr,
    ...(missingReason ? { rrrMissingReason: missingReason } : {}),
    rrrStopFallbackUsed: rrr.stopFallbackUsed,
    rrrTargetFallbackUsed: rrr.targetFallbackUsed,
    rrrExecutionReadinessImpact: rrrClosure === 'RRR_INVALID' || rrrClosure === 'RRR_DATA_INCOMPLETE'
      ? 'DATA_INCOMPLETE'
      : rrrClosure === 'RRR_FAIL'
        ? 'TIMING_FAIL'
        : rrrClosure === 'RRR_WEAK'
          ? 'WAIT'
          : 'NONE',
    rrrDataIncompleteButObservable: rrrClosure === 'RRR_DATA_INCOMPLETE' || rrrClosure === 'RRR_INVALID',
    lastTriggerState,
    lastTriggerReason: last.reason,
    ...(lastTriggerState === 'TRIGGER_WAIT' ? { lastTriggerWaitReason: last.reason } : {}),
    ...(lastTriggerState === 'INVALIDATED' ? { lastTriggerInvalidationReason: last.reason } : {}),
    lastTriggerAgeBars: numberOf(getByPath(trace, 'lastTriggerAgeBars')),
    priceConfirmationStatus: priceClosure,
    priceFreshness: last.entryPriceGuard.priceFreshness,
    entryPrice: rrr.entryPrice,
    stopLossPrice: rrr.stopLoss,
    targetPrice: rrr.targetPrice,
    breakoutLevel: last.priceConfirmation.boxHigh ?? last.priceConfirmation.high20d,
    priceConfirmationBreakPoint: last.priceConfirmation.missingFields[0] ?? last.priceConfirmation.status,
    volumeConfirmationStatus: volumeClosure,
    volume: last.volumeConfirmationDetail.volume,
    volumeMA20: last.volumeConfirmationDetail.avgVolume20d,
    volumeRatio: last.volumeConfirmationDetail.volumeRatio20d,
    vcpDryupDetected: last.volumeConfirmationDetail.status === 'DRY_UP',
    volumeExpansionDetected: last.volumeConfirmationDetail.status === 'CONFIRMED',
    volumeConfirmationBreakPoint: last.volumeConfirmationDetail.missingFields[0] ?? last.volumeConfirmationDetail.status,
    falseBreakoutStatus: falseClosure,
    falseBreakoutReason: String(last.falseBreakoutRisk),
    falseBreakoutPenalty: falseBlock ? 1 : falseWatch ? 0.5 : 0,
    falseBreakoutPositionSizeCap: falseBlock ? 0 : falseWatch ? 0.5 : 1,
    entryTimingSignal,
    positionSizeCap: gate2Status === 'GATE2_PASS_WEAK' || falseWatch ? 0.5 : 1,
    executionImpact: 'NONE',
    livePermissionNotEvaluatedHere: true,
    shadowLearning: true,
    counterfactualRecorded: true,
  };
}

export function buildGate3RuntimeClosureSummary(input: {
  traces: readonly Record<string, unknown>[];
  sourceSnapshotId?: string | null;
  gate2StatusBySymbol?: Map<string, Gate2Status | string>;
}): Gate3RuntimeClosureSummary {
  const sourceSnapshotId = text(input.sourceSnapshotId, 'UNKNOWN_SOURCE_SNAPSHOT');
  const results = input.traces.map(trace => buildGate3RuntimeEvaluation({
    trace,
    sourceSnapshotId,
    gate2Status: input.gate2StatusBySymbol?.get(text(trace.symbol)),
  }));
  const evaluated = results.filter(result => result.gate3Readiness !== 'SKIPPED');
  const scores = evaluated.map(result => result.completionScore).filter((score): score is number => score != null);
  const rrrMissingReasonDistribution: Record<string, number> = {};
  const rrrBuilderBreakPointDistribution: Record<string, number> = {};
  const rrrInputCoverage: Record<string, number> = {};
  const lastTriggerStateDistribution = {
    NOT_EVALUATED: 0,
    SETUP_NOT_READY: 0,
    SETUP_READY: 0,
    TRIGGER_WAIT: 0,
    TRIGGERED: 0,
    TRIGGER_EXPIRED: 0,
    DATA_UNAVAILABLE: 0,
    INVALIDATED: 0,
  } satisfies Record<LastTriggerState, number>;
  const priceConfirmationBreakPointDistribution: Record<string, number> = {};
  const volumeConfirmationBreakPointDistribution: Record<string, number> = {};
  const falseBreakoutReasonDistribution: Record<string, number> = {};
  const transitionDistribution: Record<string, number> = {};

  for (const result of results) {
    increment(lastTriggerStateDistribution, result.lastTriggerState);
    if (result.rrrMissingReason) incrementAny(rrrMissingReasonDistribution, result.rrrMissingReason);
    incrementAny(rrrBuilderBreakPointDistribution, result.rrrMissingReason ?? (result.rrrValue == null ? 'RRR_NOT_COMPUTED' : 'RRR_COMPUTED'));
    incrementAny(priceConfirmationBreakPointDistribution, result.priceConfirmationBreakPoint);
    incrementAny(volumeConfirmationBreakPointDistribution, result.volumeConfirmationBreakPoint);
    incrementAny(falseBreakoutReasonDistribution, result.falseBreakoutReason);
    incrementAny(transitionDistribution, transitionFor(result.gate1Status, result.gate2Status));
    if (result.entryPrice != null) incrementAny(rrrInputCoverage, 'entryPrice');
    if (result.stopLossPrice != null) incrementAny(rrrInputCoverage, 'stopLossPrice');
    if (result.targetPrice != null) incrementAny(rrrInputCoverage, 'targetPrice');
  }

  return {
    sourceSnapshotId,
    totalCandidates: results.length,
    evaluated: evaluated.length,
    gate3Ready: results.filter(result => result.gate3Readiness === 'EXECUTION_READY').length,
    shadowReady: results.filter(result => result.gate3Readiness === 'SHADOW_READY').length,
    triggerWait: results.filter(result => result.gate3Readiness === 'TRIGGER_WAIT').length,
    setupReady: results.filter(result => result.gate3Readiness === 'SETUP_READY').length,
    dataIncomplete: results.filter(result => result.gate3Readiness === 'DATA_INCOMPLETE').length,
    timingFail: results.filter(result => result.gate3Readiness === 'TIMING_FAIL').length,
    invalidated: results.filter(result => result.gate3Readiness === 'INVALIDATED').length,
    skipped: results.filter(result => result.gate3Readiness === 'SKIPPED').length,
    rrrComputed: results.filter(result => result.rrrValue != null).length,
    rrrMissing: results.filter(result => result.rrrValue == null).length,
    rrrMissingReasonDistribution,
    rrrFallbackStopUsedCount: results.filter(result => result.rrrStopFallbackUsed).length,
    rrrFallbackTargetUsedCount: results.filter(result => result.rrrTargetFallbackUsed).length,
    rrrInvalidRiskCount: results.filter(result => result.rrrMissingReason === 'RRR_INVALID_RISK').length,
    rrrInvalidRewardCount: results.filter(result => result.rrrMissingReason === 'RRR_INVALID_REWARD').length,
    rrrInputCoverage,
    rrrBuilderBreakPointDistribution,
    lastTriggerTriggered: results.filter(result => result.lastTriggerState === 'TRIGGERED').length,
    lastTriggerWait: results.filter(result => result.lastTriggerState === 'TRIGGER_WAIT').length,
    lastTriggerSetupReadyCount: results.filter(result => result.lastTriggerState === 'SETUP_READY').length,
    lastTriggerTriggeredCount: results.filter(result => result.lastTriggerState === 'TRIGGERED').length,
    lastTriggerDataUnavailableCount: results.filter(result => result.lastTriggerState === 'DATA_UNAVAILABLE').length,
    lastTriggerStateDistribution,
    priceConfirmed: results.filter(result => result.priceConfirmationStatus === 'PRICE_CONFIRMED').length,
    priceConfirmationBreakPointDistribution,
    volumeConfirmed: results.filter(result => result.volumeConfirmationStatus === 'VOLUME_CONFIRMED').length,
    volumeConfirmationBreakPointDistribution,
    falseBreakoutPass: results.filter(result => result.falseBreakoutStatus === 'FALSE_BREAKOUT_PASS').length,
    falseBreakoutReasonDistribution,
    avgCompletionScore: scores.length > 0 ? round1(scores.reduce((sum, score) => sum + score, 0) / scores.length) : null,
    gate3InputFromGate2PassStrong: results.filter(result => transitionFor(result.gate1Status, result.gate2Status) === 'GATE2_PASS_STRONG_FULL').length,
    gate3InputFromGate2PassWeak: results.filter(result => transitionFor(result.gate1Status, result.gate2Status) === 'GATE2_PASS_WEAK_FULL_CAP_0_5').length,
    gate3DiagnosticOnlyFromGate2Watch: results.filter(result => transitionFor(result.gate1Status, result.gate2Status) === 'GATE2_WATCH_DIAGNOSTIC_ONLY').length,
    gate3SkippedByGate2Fail: results.filter(result => transitionFor(result.gate1Status, result.gate2Status) === 'GATE2_FAIL_SKIP').length,
    gate3SkippedByGate1HardFail: results.filter(result => transitionFor(result.gate1Status, result.gate2Status) === 'GATE1_HARD_FAIL_SKIP').length,
    gate3TransitionBreakPointDistribution: transitionDistribution,
    outcomeSeedFieldsRecorded: results.length,
    results,
    executionImpact: 'NONE',
    marketSignal: false,
    shadowLearning: true,
    counterfactualRecorded: true,
  };
}

function countsText(counts: Record<string, number>): string {
  const entries = Object.entries(counts)
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1]);
  return entries.length > 0 ? entries.map(([key, value]) => `${key}:${value}`).join(',') : 'none';
}

export function formatGate3RuntimeClosureCompact(summary: Gate3RuntimeClosureSummary | null | undefined): string {
  if (!summary || summary.totalCandidates <= 0) {
    return [
      'Gate3 Regression & LastTrigger Closure',
      'evaluated: 0/0',
      'reason=GATE3_RUNTIME_CLOSURE_NOT_CARRIED',
      'executionImpact=NONE',
      'shadowLearning=true',
      'counterfactualRecorded=true',
    ].join('\n');
  }
  return [
    'Gate3 Regression & LastTrigger Closure',
    `sourceSnapshotId=${summary.sourceSnapshotId}`,
    `evaluated: ${summary.evaluated}/${summary.totalCandidates}`,
    `gate3Ready: ${summary.gate3Ready}`,
    `shadowReady: ${summary.shadowReady}`,
    `triggerWait: ${summary.triggerWait}`,
    `setupReady: ${summary.setupReady}`,
    `dataIncomplete: ${summary.dataIncomplete}`,
    `timingFail: ${summary.timingFail}`,
    `rrrComputed: ${summary.rrrComputed}/${summary.totalCandidates}`,
    `rrrMissing: ${summary.rrrMissing}/${summary.totalCandidates}`,
    `lastTriggerTriggered: ${summary.lastTriggerTriggered}`,
    `lastTriggerWait: ${summary.lastTriggerWait}`,
    `priceConfirmed: ${summary.priceConfirmed}`,
    `volumeConfirmed: ${summary.volumeConfirmed}`,
    `falseBreakoutPass: ${summary.falseBreakoutPass}`,
    `avgCompletionScore: ${summary.avgCompletionScore ?? 'null'}`,
    'executionImpact=NONE',
    'shadowLearning=true',
    'counterfactualRecorded=true',
  ].join('\n');
}

export function formatGate3RuntimeClosureFull(summary: Gate3RuntimeClosureSummary | null | undefined): string | null {
  if (!summary || summary.totalCandidates <= 0) return null;
  return [
    'Gate3 Runtime Closure Full Diagnostic',
    `RRR missing reasons: ${countsText(summary.rrrMissingReasonDistribution)}`,
    `RRR builder breakpoints: ${countsText(summary.rrrBuilderBreakPointDistribution)}`,
    `RRR input coverage: ${countsText(summary.rrrInputCoverage)}`,
    `RRR fallbackStopUsed: ${summary.rrrFallbackStopUsedCount}`,
    `RRR fallbackTargetUsed: ${summary.rrrFallbackTargetUsedCount}`,
    `RRR invalidRisk: ${summary.rrrInvalidRiskCount}`,
    `RRR invalidReward: ${summary.rrrInvalidRewardCount}`,
    `LastTrigger states: ${countsText(summary.lastTriggerStateDistribution)}`,
    `Price breakpoints: ${countsText(summary.priceConfirmationBreakPointDistribution)}`,
    `Volume breakpoints: ${countsText(summary.volumeConfirmationBreakPointDistribution)}`,
    `FalseBreakout reasons: ${countsText(summary.falseBreakoutReasonDistribution)}`,
    `Gate2ToGate3 transition: ${countsText(summary.gate3TransitionBreakPointDistribution)}`,
    `OutcomeSeedFieldsRecorded: ${summary.outcomeSeedFieldsRecorded}`,
    'SampleResults:',
    ...summary.results.slice(0, 8).map(result =>
      `- ${result.symbol} gate2=${result.gate2Status} readiness=${result.gate3Readiness} entryTimingSignal=${result.entryTimingSignal} rrr=${result.rrrValue ?? 'null'} ${result.rrrStatus}${result.rrrMissingReason ? ` reason=${result.rrrMissingReason}` : ''} lastTrigger=${result.lastTriggerState} price=${result.priceConfirmationStatus} volume=${result.volumeConfirmationStatus} completion=${result.completionScore ?? 'null'} livePermissionNotEvaluatedHere=${result.livePermissionNotEvaluatedHere}`,
    ),
    'marketSignal=false',
    'executionImpact=NONE',
  ].join('\n');
}
