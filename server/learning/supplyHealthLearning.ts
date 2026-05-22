/**
 * @responsibility supply_health 상태를 매매 판단/Shadow/Replay 학습 피처로 승격하는 순수 정책 레이어
 */

export type TradingSignal =
  | 'STRONG_BUY'
  | 'BUY'
  | 'HOLD'
  | 'SELL'
  | 'WATCH'
  | 'NO_DECISION';

export type DataQualityBucket =
  | 'HIGH_CONFIDENCE'
  | 'MID_CONFIDENCE'
  | 'LOW_CONFIDENCE'
  | 'UNSAFE_CONFIDENCE';

export type ExecutionMode =
  | 'LIVE'
  | 'SHADOW'
  | 'WATCHLIST'
  | 'REPLAY'
  | 'BLOCKED';

export type WatchlistReason =
  | 'PENDING_SUPPLY_CONFIRMATION'
  | 'PENDING_MACRO_CONFIRMATION'
  | 'PENDING_PRICE_TRIGGER'
  | 'PENDING_VOLUME_BREAKOUT'
  | 'PENDING_DATA_RECOVERY';

export interface SourceHealth {
  // ADR-0421 — 'DATA_UNAVAILABLE' 신규 (success=0+missing>0 시점 NEUTRAL 폐기 정합).
  status:
    | 'OK'
    | 'NEUTRAL'
    | 'DEGRADED'
    | 'MISSING'
    | 'STALE'
    | 'ACCEPTED_EMPTY'
    | 'DATA_UNAVAILABLE';
  source:
    | 'KIS_API'
    | 'KRX'
    | 'NAVER'
    | 'CACHE'
    | 'FSS'
    | 'MACRO_STATE'
    | 'UNKNOWN';
  coverage?: string;
  success?: number;
  missing?: number;
  stale?: number;
  latest?: string;
  updatedAt?: string;
  reason?: string;
  providerTried?: string[];
}

export interface SupplyHealthSnapshot {
  summary: {
    ok: number;
    neutral: number;
    degraded: number;
    missing: number;
    stale: number;
    cacheStatus: 'fresh' | 'stale' | 'unknown';
    overallStatus: 'OK' | 'USABLE' | 'DEGRADED' | 'UNSAFE' | 'BROKEN';
  };
  coverage: {
    totalSources: number;
    okRatio: number;
    degradedRatio: number;
    missingRatio: number;
    minCriticalCoverage: number;
  };
  sources: {
    investorFlow?: SourceHealth;
    programTrading?: SourceHealth;
    marketProgramTrading?: SourceHealth;
    passiveActive?: SourceHealth;
    shortBalance?: SourceHealth;
    foreignerTrend?: SourceHealth;
    marginBalance?: SourceHealth;
  };
  providerTried: string[];
  providerFailed: string[];
  providerUsed: string[];
  criticalFlags: {
    investorFlowDegraded: boolean;
    programTradingMissing: boolean;
    foreignerTrendDegraded: boolean;
    zeroFilledSuspected: boolean;
    offHoursMode: boolean;
  };
}

export interface LearningSample {
  id: string;
  symbol: string;
  name?: string;
  market: 'KOSPI' | 'KOSDAQ' | 'ETF' | 'UNKNOWN';
  date: string;
  capturedAt: string;
  signal: TradingSignal;
  rawSignal: TradingSignal;
  finalSignal: TradingSignal;
  entryPrice?: number;
  closePrice?: number;
  futureReturn1d?: number;
  futureReturn5d?: number;
  futureReturn10d?: number;
  futureReturn20d?: number;
  futureReturn60d?: number;
  outcome5d?: 'WIN' | 'LOSS' | 'FLAT' | 'PENDING';
  outcome20d?: 'WIN' | 'LOSS' | 'FLAT' | 'PENDING';
  stage2Score?: number;
  technicalScore?: number;
  supplyScore?: number;
  macroScore?: number;
  rawScore?: number;
  finalScore?: number;
  supplyHealthSnapshot: SupplyHealthSnapshot;
  dataConfidence: number;
  dataQualityBucket: DataQualityBucket;
  wasDowngradedBySupplyHealth: boolean;
  downgradeReasons: string[];
  executionMode: ExecutionMode;
  includeInPerformanceLearning: boolean;
}

export interface ReplayFrame {
  replayId: string;
  capturedAt: string;
  symbol: string;
  decisionInput: {
    priceFeatures?: unknown;
    technicalFeatures?: unknown;
    supplyFeatures?: unknown;
    macroFeatures?: unknown;
  };
  supplyHealthSnapshot: SupplyHealthSnapshot;
  decisionOutput: {
    rawSignal: TradingSignal;
    finalSignal: TradingSignal;
    rawScore?: number;
    finalScore?: number;
    positionSizeBeforeHealth?: number;
    positionSizeAfterHealth?: number;
    downgradeReasons: string[];
  };
  providerDiagnostics: {
    providerTried: string[];
    providerSkipped: string[];
    providerFailed: string[];
    cacheKey?: string;
    cacheAgeMinutes?: number;
    offHoursMode: boolean;
  };
}

export interface SupplyHealthSignalDecision {
  finalSignal: TradingSignal;
  finalScore?: number;
  positionSizeAfterHealth?: number;
  dataConfidence: number;
  dataQualityBucket: DataQualityBucket;
  wasDowngradedBySupplyHealth: boolean;
  downgradeReasons: string[];
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function isBuySignal(signal: TradingSignal): boolean {
  return signal === 'BUY' || signal === 'STRONG_BUY';
}

function withOptionalNumber<T extends object>(
  object: T,
  key: string,
  value: number | undefined,
): T {
  if (value === undefined || !Number.isFinite(value)) return object;
  return { ...object, [key]: value };
}

export function calculateDataConfidence(snapshot: SupplyHealthSnapshot): number {
  if (snapshot.summary.overallStatus === 'BROKEN') return 0;

  let confidence =
    snapshot.coverage.okRatio * 0.55 +
    (1 - snapshot.coverage.degradedRatio) * 0.25 +
    (1 - snapshot.coverage.missingRatio) * 0.20;

  if (snapshot.summary.cacheStatus === 'fresh') confidence += 0.05;
  if (snapshot.summary.cacheStatus === 'stale') confidence -= 0.10;
  if (snapshot.criticalFlags.zeroFilledSuspected) confidence -= 0.30;
  if (snapshot.criticalFlags.investorFlowDegraded) confidence -= 0.10;
  if (snapshot.criticalFlags.foreignerTrendDegraded) confidence -= 0.10;
  if (snapshot.criticalFlags.programTradingMissing) confidence -= 0.08;

  if (snapshot.summary.overallStatus === 'UNSAFE') confidence = Math.min(confidence, 0.35);
  if (snapshot.summary.overallStatus === 'DEGRADED') confidence = Math.min(confidence, 0.60);

  return clamp01(confidence);
}

export function toDataQualityBucket(confidence: number): DataQualityBucket {
  if (confidence >= 0.8) return 'HIGH_CONFIDENCE';
  if (confidence >= 0.6) return 'MID_CONFIDENCE';
  if (confidence >= 0.4) return 'LOW_CONFIDENCE';
  return 'UNSAFE_CONFIDENCE';
}

export function positionMultiplier(confidence: number): number {
  if (confidence >= 0.8) return 1.0;
  if (confidence >= 0.6) return 0.7;
  if (confidence >= 0.4) return 0.5;
  return 0.0;
}

function scaledPosition(signal: TradingSignal, positionSize: number | undefined, confidence: number): number | undefined {
  if (positionSize === undefined || !Number.isFinite(positionSize)) return undefined;
  if (signal === 'SELL') return positionSize;
  return Math.max(0, positionSize * positionMultiplier(confidence));
}

export function applySupplyHealthToSignal(params: {
  rawSignal: TradingSignal;
  rawScore?: number;
  positionSize?: number;
  supplyHealthSnapshot: SupplyHealthSnapshot;
}): SupplyHealthSignalDecision {
  const { rawSignal, rawScore, positionSize, supplyHealthSnapshot } = params;
  const confidence = calculateDataConfidence(supplyHealthSnapshot);
  const bucket = toDataQualityBucket(confidence);
  const reasons: string[] = [];
  let finalSignal = rawSignal;
  let finalScore = rawScore;
  let positionSizeAfterHealth = scaledPosition(rawSignal, positionSize, confidence);

  const setSignal = (next: TradingSignal, reason: string): void => {
    if (finalSignal !== next) {
      finalSignal = next;
      reasons.push(reason);
    } else if (!reasons.includes(reason)) {
      reasons.push(reason);
    }
  };

  const status = supplyHealthSnapshot.summary.overallStatus;
  if (status === 'BROKEN') {
    setSignal('NO_DECISION', 'supply_health BROKEN');
    positionSizeAfterHealth = 0;
    finalScore = rawScore === undefined ? undefined : 0;
    return {
      finalSignal,
      finalScore,
      positionSizeAfterHealth,
      dataConfidence: confidence,
      dataQualityBucket: bucket,
      wasDowngradedBySupplyHealth: finalSignal !== rawSignal || positionSizeAfterHealth !== positionSize,
      downgradeReasons: reasons,
    };
  }

  if (rawSignal !== 'SELL' && supplyHealthSnapshot.criticalFlags.zeroFilledSuspected && isBuySignal(finalSignal)) {
    setSignal('WATCH', 'zero-filled suspected');
    positionSizeAfterHealth = 0;
  }

  if (status === 'UNSAFE' && rawSignal !== 'SELL' && isBuySignal(finalSignal)) {
    setSignal('WATCH', 'supply_health UNSAFE');
    positionSizeAfterHealth = 0;
  }

  // Step 4: high-conviction/legacy STRONG_BUY is a finalScore label only.
  // Supply health can affect data confidence and sizing, but it must not perform
  // STRONG_BUY-only BUY downgrades.

  if (rawSignal !== 'SELL' && positionSizeAfterHealth !== positionSize) {
    const reason = `position scaled by data confidence ${confidence.toFixed(2)}`;
    if (!reasons.includes(reason)) reasons.push(reason);
  }

  return {
    finalSignal,
    finalScore,
    positionSizeAfterHealth,
    dataConfidence: confidence,
    dataQualityBucket: bucket,
    wasDowngradedBySupplyHealth: finalSignal !== rawSignal || positionSizeAfterHealth !== positionSize,
    downgradeReasons: reasons,
  };
}

export function determineExecutionMode(params: {
  rawSignal: TradingSignal;
  finalSignal: TradingSignal;
  dataConfidence: number;
  overallStatus: SupplyHealthSnapshot['summary']['overallStatus'];
  wasDowngradedBySupplyHealth: boolean;
}): ExecutionMode {
  const { rawSignal, finalSignal, dataConfidence, overallStatus, wasDowngradedBySupplyHealth } = params;
  if (overallStatus === 'BROKEN') return 'BLOCKED';
  if (overallStatus === 'UNSAFE') return 'SHADOW';

  if (overallStatus === 'DEGRADED') {
    if (isBuySignal(rawSignal) && wasDowngradedBySupplyHealth) {
      return finalSignal === 'WATCH' ? 'WATCHLIST' : 'SHADOW';
    }
    if (finalSignal === 'WATCH' || finalSignal === 'HOLD') return 'WATCHLIST';
    if (finalSignal === 'SELL') return 'LIVE';
    return 'SHADOW';
  }

  if (isBuySignal(finalSignal) && dataConfidence >= 0.6) return 'LIVE';
  if (isBuySignal(finalSignal)) return 'SHADOW';
  if (finalSignal === 'SELL') return 'LIVE';
  return 'WATCHLIST';
}

export function deriveWatchlistReason(params: {
  rawSignal: TradingSignal;
  finalSignal: TradingSignal;
  wasDowngradedBySupplyHealth: boolean;
  snapshot: SupplyHealthSnapshot;
}): WatchlistReason | null {
  if (
    isBuySignal(params.rawSignal) &&
    params.finalSignal === 'WATCH' &&
    params.wasDowngradedBySupplyHealth
  ) {
    return params.snapshot.criticalFlags.investorFlowDegraded ||
      params.snapshot.criticalFlags.foreignerTrendDegraded ||
      params.snapshot.criticalFlags.programTradingMissing
      ? 'PENDING_SUPPLY_CONFIRMATION'
      : 'PENDING_DATA_RECOVERY';
  }
  return null;
}

export function createLearningSampleFromDecision(decision: {
  symbol: string;
  name?: string;
  market?: 'KOSPI' | 'KOSDAQ' | 'ETF' | 'UNKNOWN';
  date: string;
  currentPrice?: number;
  rawSignal: TradingSignal;
  rawScore?: number;
  stage2Score?: number;
  technicalScore?: number;
  supplyScore?: number;
  macroScore?: number;
  positionSize?: number;
  supplyHealthSnapshot: SupplyHealthSnapshot;
}): LearningSample {
  const healthDecision = applySupplyHealthToSignal({
    rawSignal: decision.rawSignal,
    rawScore: decision.rawScore,
    positionSize: decision.positionSize,
    supplyHealthSnapshot: decision.supplyHealthSnapshot,
  });
  const executionMode = determineExecutionMode({
    rawSignal: decision.rawSignal,
    finalSignal: healthDecision.finalSignal,
    dataConfidence: healthDecision.dataConfidence,
    overallStatus: decision.supplyHealthSnapshot.summary.overallStatus,
    wasDowngradedBySupplyHealth: healthDecision.wasDowngradedBySupplyHealth,
  });
  const capturedAt = new Date().toISOString();
  return {
    id: `${decision.date}:${decision.symbol}:${capturedAt}`,
    symbol: decision.symbol,
    name: decision.name,
    market: decision.market ?? 'UNKNOWN',
    date: decision.date,
    capturedAt,
    signal: healthDecision.finalSignal,
    rawSignal: decision.rawSignal,
    finalSignal: healthDecision.finalSignal,
    entryPrice: decision.currentPrice,
    outcome5d: 'PENDING',
    outcome20d: 'PENDING',
    stage2Score: decision.stage2Score,
    technicalScore: decision.technicalScore,
    supplyScore: decision.supplyScore,
    macroScore: decision.macroScore,
    rawScore: decision.rawScore,
    finalScore: healthDecision.finalScore,
    supplyHealthSnapshot: decision.supplyHealthSnapshot,
    dataConfidence: healthDecision.dataConfidence,
    dataQualityBucket: healthDecision.dataQualityBucket,
    wasDowngradedBySupplyHealth: healthDecision.wasDowngradedBySupplyHealth,
    downgradeReasons: healthDecision.downgradeReasons,
    executionMode,
    includeInPerformanceLearning: decision.supplyHealthSnapshot.summary.overallStatus !== 'BROKEN',
  };
}

function outcomeFromReturn(value: number | undefined): 'WIN' | 'LOSS' | 'FLAT' | 'PENDING' {
  if (value === undefined || !Number.isFinite(value)) return 'PENDING';
  if (value >= 3) return 'WIN';
  if (value <= -3) return 'LOSS';
  return 'FLAT';
}

function futureReturn(entryPrice: number | undefined, futurePrice: number | undefined): number | undefined {
  if (
    entryPrice === undefined ||
    futurePrice === undefined ||
    !Number.isFinite(entryPrice) ||
    !Number.isFinite(futurePrice) ||
    entryPrice <= 0
  ) {
    return undefined;
  }
  return Number((((futurePrice - entryPrice) / entryPrice) * 100).toFixed(6));
}

export function updateLearningSampleFutureReturns(params: {
  sample: LearningSample;
  price1d?: number;
  price5d?: number;
  price10d?: number;
  price20d?: number;
  price60d?: number;
}): LearningSample {
  const futureReturn1d = futureReturn(params.sample.entryPrice, params.price1d);
  const futureReturn5d = futureReturn(params.sample.entryPrice, params.price5d);
  const futureReturn10d = futureReturn(params.sample.entryPrice, params.price10d);
  const futureReturn20d = futureReturn(params.sample.entryPrice, params.price20d);
  const futureReturn60d = futureReturn(params.sample.entryPrice, params.price60d);

  return {
    ...params.sample,
    ...withOptionalNumber({}, 'futureReturn1d', futureReturn1d),
    ...withOptionalNumber({}, 'futureReturn5d', futureReturn5d),
    ...withOptionalNumber({}, 'futureReturn10d', futureReturn10d),
    ...withOptionalNumber({}, 'futureReturn20d', futureReturn20d),
    ...withOptionalNumber({}, 'futureReturn60d', futureReturn60d),
    outcome5d: outcomeFromReturn(futureReturn5d),
    outcome20d: outcomeFromReturn(futureReturn20d),
  };
}

function buyPerformanceSamples(samples: LearningSample[]): LearningSample[] {
  return samples.filter((s) =>
    s.includeInPerformanceLearning &&
    s.entryPrice !== undefined &&
    s.entryPrice > 0 &&
    (s.finalSignal === 'BUY' || s.finalSignal === 'STRONG_BUY')
  );
}

function finiteValues(values: Array<number | undefined>): number[] {
  return values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Number((values.reduce((sum, v) => sum + v, 0) / values.length).toFixed(6));
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? null;
  return Number((((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2).toFixed(6));
}

function winRate(outcomes: Array<'WIN' | 'LOSS' | 'FLAT' | 'PENDING' | undefined>): number | null {
  const resolved = outcomes.filter((o): o is 'WIN' | 'LOSS' | 'FLAT' => o === 'WIN' || o === 'LOSS' || o === 'FLAT');
  if (resolved.length === 0) return null;
  return Number((resolved.filter((o) => o === 'WIN').length / resolved.length).toFixed(6));
}

export function aggregatePerformanceByDataQuality(samples: LearningSample[]): {
  bucket: DataQualityBucket;
  count: number;
  winRate5d: number | null;
  winRate20d: number | null;
  avgReturn5d: number | null;
  avgReturn20d: number | null;
  medianReturn20d: number | null;
}[] {
  const eligible = buyPerformanceSamples(samples);
  const buckets: DataQualityBucket[] = [
    'HIGH_CONFIDENCE',
    'MID_CONFIDENCE',
    'LOW_CONFIDENCE',
    'UNSAFE_CONFIDENCE',
  ];
  return buckets.map((bucket) => {
    const rows = eligible.filter((s) => s.dataQualityBucket === bucket);
    const return5d = finiteValues(rows.map((s) => s.futureReturn5d));
    const return20d = finiteValues(rows.map((s) => s.futureReturn20d));
    return {
      bucket,
      count: rows.length,
      winRate5d: winRate(rows.map((s) => s.outcome5d)),
      winRate20d: winRate(rows.map((s) => s.outcome20d)),
      avgReturn5d: average(return5d),
      avgReturn20d: average(return20d),
      medianReturn20d: median(return20d),
    };
  });
}

export function aggregatePerformanceByCriticalFlag(samples: LearningSample[]): {
  flag: keyof SupplyHealthSnapshot['criticalFlags'];
  trueCount: number;
  falseCount: number;
  avgReturn20dWhenTrue: number | null;
  avgReturn20dWhenFalse: number | null;
  winRate20dWhenTrue: number | null;
  winRate20dWhenFalse: number | null;
}[] {
  const eligible = buyPerformanceSamples(samples);
  const flags: Array<keyof SupplyHealthSnapshot['criticalFlags']> = [
    'investorFlowDegraded',
    'programTradingMissing',
    'foreignerTrendDegraded',
    'zeroFilledSuspected',
    'offHoursMode',
  ];

  return flags.map((flag) => {
    const whenTrue = eligible.filter((s) => s.supplyHealthSnapshot.criticalFlags[flag]);
    const whenFalse = eligible.filter((s) => !s.supplyHealthSnapshot.criticalFlags[flag]);
    return {
      flag,
      trueCount: whenTrue.length,
      falseCount: whenFalse.length,
      avgReturn20dWhenTrue: average(finiteValues(whenTrue.map((s) => s.futureReturn20d))),
      avgReturn20dWhenFalse: average(finiteValues(whenFalse.map((s) => s.futureReturn20d))),
      winRate20dWhenTrue: winRate(whenTrue.map((s) => s.outcome20d)),
      winRate20dWhenFalse: winRate(whenFalse.map((s) => s.outcome20d)),
    };
  });
}

export function analyzeDowngradeEffectiveness(samples: LearningSample[]): {
  downgradedCount: number;
  notDowngradedCount: number;
  downgradedAvgReturn20d: number | null;
  notDowngradedAvgReturn20d: number | null;
  downgradedWinRate20d: number | null;
  notDowngradedWinRate20d: number | null;
  avoidedLossCount: number;
  missedGainCount: number;
  ruleEffectiveness: 'POSITIVE' | 'NEGATIVE' | 'INCONCLUSIVE';
} {
  const eligible = samples.filter((s) =>
    s.includeInPerformanceLearning &&
    s.entryPrice !== undefined &&
    s.entryPrice > 0 &&
    isBuySignal(s.rawSignal)
  );
  const downgraded = eligible.filter((s) => s.wasDowngradedBySupplyHealth);
  const notDowngraded = eligible.filter((s) => !s.wasDowngradedBySupplyHealth);
  const avoidedLossCount = downgraded.filter((s) => (s.futureReturn20d ?? Number.NaN) <= -3).length;
  const missedGainCount = downgraded.filter((s) => (s.futureReturn20d ?? Number.NaN) >= 5).length;
  const ruleEffectiveness =
    avoidedLossCount > missedGainCount * 1.2
      ? 'POSITIVE'
      : missedGainCount > avoidedLossCount * 1.2
        ? 'NEGATIVE'
        : 'INCONCLUSIVE';

  return {
    downgradedCount: downgraded.length,
    notDowngradedCount: notDowngraded.length,
    downgradedAvgReturn20d: average(finiteValues(downgraded.map((s) => s.futureReturn20d))),
    notDowngradedAvgReturn20d: average(finiteValues(notDowngraded.map((s) => s.futureReturn20d))),
    downgradedWinRate20d: winRate(downgraded.map((s) => s.outcome20d)),
    notDowngradedWinRate20d: winRate(notDowngraded.map((s) => s.outcome20d)),
    avoidedLossCount,
    missedGainCount,
    ruleEffectiveness,
  };
}

export function createReplayFrame(params: {
  replayId: string;
  capturedAt?: string;
  symbol: string;
  decisionInput?: ReplayFrame['decisionInput'];
  supplyHealthSnapshot: SupplyHealthSnapshot;
  rawSignal: TradingSignal;
  finalSignal: TradingSignal;
  rawScore?: number;
  finalScore?: number;
  positionSizeBeforeHealth?: number;
  positionSizeAfterHealth?: number;
  downgradeReasons: string[];
  providerSkipped?: string[];
  cacheKey?: string;
  cacheAgeMinutes?: number;
}): ReplayFrame {
  return {
    replayId: params.replayId,
    capturedAt: params.capturedAt ?? new Date().toISOString(),
    symbol: params.symbol,
    decisionInput: params.decisionInput ?? {},
    supplyHealthSnapshot: params.supplyHealthSnapshot,
    decisionOutput: {
      rawSignal: params.rawSignal,
      finalSignal: params.finalSignal,
      rawScore: params.rawScore,
      finalScore: params.finalScore,
      positionSizeBeforeHealth: params.positionSizeBeforeHealth,
      positionSizeAfterHealth: params.positionSizeAfterHealth,
      downgradeReasons: params.downgradeReasons,
    },
    providerDiagnostics: {
      providerTried: params.supplyHealthSnapshot.providerTried,
      providerSkipped: params.providerSkipped ?? [],
      providerFailed: params.supplyHealthSnapshot.providerFailed,
      cacheKey: params.cacheKey,
      cacheAgeMinutes: params.cacheAgeMinutes,
      offHoursMode: params.supplyHealthSnapshot.criticalFlags.offHoursMode,
    },
  };
}
