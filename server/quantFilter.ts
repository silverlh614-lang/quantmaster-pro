// @responsibility quantFilter 서버 모듈
/**
 * quantFilter.ts — 서버사이드 경량 Gate 평가
 *
 * 전체 27조건 중 서버에서 평가 가능한 조건들을 실계산.
 * 나머지는 UI에서 수동 입력 시 반영되는 구조 유지.
 *
 * ADR-452: gateScore는 기존 live 의사결정 호환을 위해 raw score 그대로 유지하되,
 * DATA_UNAVAILABLE을 분모에서 제외한 availableMaxScore / normalizedGateScore를 진단용으로 노출한다.
 */

import type { YahooQuoteExtended } from './screener/stockScreener.js';
import type { DartFinancials } from './clients/dartFinancialClient.js';
import type { KisInvestorFlow } from './clients/kisClient.js';
import type { RegimeLevel } from '../src/types/core.js';
import { getVixConservativeMode } from './state.js';
import { isTradingHeld } from './learning/learningState.js';
import { getRegimeGateBand } from './trading/gateConfig.js';
import { defaultRegistry, calculateCompressionScore } from './quant/conditions/index.js';

export type GateLayerName = 'gate1' | 'gate2' | 'gate3';

export type GateFinalPath = 'LIVE_ELIGIBLE' | 'SHADOW_OBSERVABLE' | 'WATCHLIST_ONLY' | 'BLOCKED';

export interface GateLayerBucket {
  fired: string[];
  unavailable: string[];
  thresholdNotMet: string[];
  providerDegraded: string[];
  passed: boolean;
  score: number;
  availableMaxScore: number;
}

export interface GateLayerSummary {
  gate1: GateLayerBucket;
  gate2: GateLayerBucket;
  gate3: GateLayerBucket;
  finalPath: GateFinalPath;
  primaryBlockReason?: string;
}

export interface ServerGateResult {
  gateScore: number;                          // 기존 live 의사결정 호환 raw score (float, 최대 ~15)
  /** ADR-452 — gateScore와 동일한 원점수. 신규 호출자는 rawScore를 선호. */
  rawScore: number;
  /** ADR-452 — DATA_UNAVAILABLE 조건을 제외한 현재 평가 가능 최대점. */
  availableMaxScore: number;
  /** ADR-452 — rawScore / availableMaxScore, 진단 전용. live 기준 대체 금지. */
  normalizedGateScore: number;
  /** ADR-452 — 데이터가 없어 평가 불가였던 조건 키. */
  unavailableConditions: string[];
  /** ADR-452 — 데이터는 있었지만 임계 미달이었던 조건 키. */
  thresholdNotMetConditions: string[];
  /** ADR-452 — provider degraded로 점수 합산에서 제외/강등된 조건 키. */
  providerDegradedConditions?: string[];
  signalType: 'STRONG' | 'NORMAL' | 'SKIP';
  positionPct: number;                        // Kelly 기반 포지션 비율
  details: string[];                          // 통과한 조건 레이블
  conditionKeys: string[];                    // 통과한 조건 키 (Signal Calibrator용)
  compressionScore: number;                   // CS (0~1) — 변동성 압축도 정량화 지수
  mtas: number;                               // MTAS (0~10) — 멀티타임프레임 정렬도
  /**
   * ADR-0387 — 평가 outputs 배열 (status 분류 포함). recordGateAuditByStatus 입력.
   * ADR-0418 Phase 3 — `context` 옵셔널 필드 추가.
   */
  outputs?: Array<{
    key: string;
    output: { score: number; status?: string; detail?: string } | null;
    context?: {
      requiredData: string[];
      availableData: Record<string, boolean>;
      hadRequiredData: boolean;
    };
  }>;
  /**
   * Gate 1/2/3 layer summary is diagnostic-only. It must never replace gateScore/rawScore
   * or normalizedGateScore in live threshold decisions.
   */
  gateLayerSummary?: GateLayerSummary;
}

/** 조건 키 상수 — condition-weights.json의 키와 1:1 매핑 */
export const CONDITION_KEYS = {
  MOMENTUM:          'momentum',
  MA_ALIGNMENT:      'ma_alignment',
  VOLUME_BREAKOUT:   'volume_breakout',
  PER:               'per',
  TURTLE_HIGH:       'turtle_high',
  RELATIVE_STRENGTH: 'relative_strength',
  BREAKOUT_MOMENTUM: 'breakout_momentum',
  VCP:               'vcp',
  VOLUME_SURGE:      'volume_surge',
  RSI_ZONE:          'rsi_zone',
  MACD_BULL:         'macd_bull',
  PULLBACK:          'pullback',
  MA60_RISING:       'ma60_rising',
  WEEKLY_RSI_ZONE:   'weekly_rsi_zone',
  SUPPLY_CONFLUENCE: 'supply_confluence',
  EARNINGS_QUALITY:  'earnings_quality',
  TREND_ACCELERATION: 'trend_acceleration',
} as const;

export type ConditionKey = (typeof CONDITION_KEYS)[keyof typeof CONDITION_KEYS];

/** 조건별 가중치 — 기본값 1.0, 범위 0.1~2.0 */
export type ConditionWeights = Record<ConditionKey, number>;

export const DEFAULT_CONDITION_WEIGHTS: ConditionWeights = {
  momentum:          1.0,
  ma_alignment:      1.0,
  volume_breakout:   1.0,
  per:               1.0,
  turtle_high:       1.0,
  relative_strength: 1.0,
  breakout_momentum: 1.0,
  vcp:               1.0,
  volume_surge:      1.0,
  rsi_zone:          1.0,
  macd_bull:         1.0,
  pullback:          1.0,
  ma60_rising:       1.0,
  weekly_rsi_zone:   0.8,
  supply_confluence: 1.2,
  earnings_quality:  0.7,
  trend_acceleration: 1.0,
};

const CONDITION_WEIGHT_MIN = 0.1;
const CONDITION_WEIGHT_MAX = 2.0;

/** Gate condition → 3-layer diagnostic SSOT. Live thresholds/weights are not derived from this map. */
export const GATE_CONDITION_LAYER_MAP: Record<ConditionKey, GateLayerName> = {
  momentum: 'gate3',
  ma_alignment: 'gate1',
  volume_breakout: 'gate3',
  per: 'gate2',
  turtle_high: 'gate3',
  relative_strength: 'gate2',
  breakout_momentum: 'gate3',
  vcp: 'gate3',
  volume_surge: 'gate3',
  rsi_zone: 'gate3',
  macd_bull: 'gate3',
  pullback: 'gate3',
  ma60_rising: 'gate1',
  weekly_rsi_zone: 'gate1',
  supply_confluence: 'gate2',
  earnings_quality: 'gate2',
  trend_acceleration: 'gate2',
};

function emptyGateLayerBucket(): GateLayerBucket {
  return {
    fired: [],
    unavailable: [],
    thresholdNotMet: [],
    providerDegraded: [],
    passed: false,
    score: 0,
    availableMaxScore: 0,
  };
}

function layerForCondition(key: string): GateLayerName {
  return (GATE_CONDITION_LAYER_MAP as Record<string, GateLayerName>)[key] ?? 'gate3';
}

function buildGateLayerSummary(
  outputs: NonNullable<ServerGateResult['outputs']>,
  weights: ConditionWeights,
  signalType: ServerGateResult['signalType'],
): GateLayerSummary {
  const summary: GateLayerSummary = {
    gate1: emptyGateLayerBucket(),
    gate2: emptyGateLayerBucket(),
    gate3: emptyGateLayerBucket(),
    finalPath: 'WATCHLIST_ONLY',
  };

  for (const item of outputs) {
    const layer = summary[layerForCondition(item.key)];
    const status = inferOutputStatus(item.output, item.context?.hadRequiredData);
    const score = item.output && Number.isFinite(item.output.score) ? Math.max(0, item.output.score) : 0;
    const baseWeight = conditionWeightFor(weights, item.key);

    if (status === 'DATA_UNAVAILABLE' || status === 'ERROR') {
      layer.unavailable.push(item.key);
      continue;
    }

    layer.availableMaxScore += Math.max(baseWeight, score);
    if (status === 'PROVIDER_DEGRADED') {
      layer.providerDegraded.push(item.key);
    } else if (status === 'THRESHOLD_NOT_MET' || status === 'SKIPPED_BY_POLICY' || status === 'SANITY_REJECTED') {
      layer.thresholdNotMet.push(item.key);
    } else if (score > 0 || status === 'FIRED') {
      layer.fired.push(item.key);
      layer.score += score;
    }
  }

  for (const layer of [summary.gate1, summary.gate2, summary.gate3]) {
    layer.passed = layer.unavailable.length === 0 && layer.providerDegraded.length === 0 && layer.thresholdNotMet.length === 0 && layer.fired.length > 0;
  }

  const unavailable = [...summary.gate1.unavailable, ...summary.gate2.unavailable, ...summary.gate3.unavailable];
  const degraded = [...summary.gate1.providerDegraded, ...summary.gate2.providerDegraded, ...summary.gate3.providerDegraded];
  const thresholdMiss = [...summary.gate1.thresholdNotMet, ...summary.gate2.thresholdNotMet, ...summary.gate3.thresholdNotMet];

  if (signalType === 'SKIP') {
    summary.finalPath = 'BLOCKED';
    summary.primaryBlockReason = thresholdMiss[0] ? `THRESHOLD_NOT_MET:${thresholdMiss[0]}` : 'SIGNAL_SKIP';
  } else if (unavailable.length > 0) {
    summary.finalPath = 'SHADOW_OBSERVABLE';
    summary.primaryBlockReason = `DATA_UNAVAILABLE:${unavailable[0]}`;
  } else if (degraded.length > 0) {
    summary.finalPath = 'SHADOW_OBSERVABLE';
    summary.primaryBlockReason = `PROVIDER_DEGRADED:${degraded[0]}`;
  } else {
    summary.finalPath = 'LIVE_ELIGIBLE';
  }

  return summary;
}

type GateOutputStatus =
  | 'FIRED'
  | 'DATA_UNAVAILABLE'
  | 'THRESHOLD_NOT_MET'
  | 'PROVIDER_DEGRADED'
  | 'ERROR'
  | 'SKIPPED_BY_POLICY'
  | 'SANITY_REJECTED'
  | string;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function conditionWeightFor(weights: ConditionWeights, key: string): number {
  const raw = (weights as Record<string, number>)[key];
  if (typeof raw !== 'number' || Number.isNaN(raw)) return 1.0;
  return clamp(raw, CONDITION_WEIGHT_MIN, CONDITION_WEIGHT_MAX);
}

function inferOutputStatus(output: { score: number; status?: string } | null, hadRequiredData?: boolean): GateOutputStatus {
  if (output?.status) return output.status;
  if (output) return 'FIRED';
  return hadRequiredData === false ? 'DATA_UNAVAILABLE' : 'THRESHOLD_NOT_MET';
}

function computeGateScoreHealth(
  outputs: NonNullable<ServerGateResult['outputs']>,
  weights: ConditionWeights,
  rawScore: number,
): Pick<ServerGateResult,
  | 'rawScore'
  | 'availableMaxScore'
  | 'normalizedGateScore'
  | 'unavailableConditions'
  | 'thresholdNotMetConditions'
  | 'providerDegradedConditions'
> {
  let availableMaxScore = 0;
  const unavailableConditions: string[] = [];
  const thresholdNotMetConditions: string[] = [];
  const providerDegradedConditions: string[] = [];

  for (const item of outputs) {
    const key = item.key;
    const output = item.output;
    const status = inferOutputStatus(output, item.context?.hadRequiredData);
    const baseWeight = conditionWeightFor(weights, key);

    if (status === 'DATA_UNAVAILABLE') {
      unavailableConditions.push(key);
      continue;
    }

    if (status === 'ERROR') {
      unavailableConditions.push(key);
      continue;
    }

    // ADR-452: THRESHOLD_NOT_MET/PROVIDER_DEGRADED/FIRED는 평가 가능한 조건으로 분모에 남긴다.
    // FIRED 보너스 점수가 baseWeight보다 큰 경우 normalized>1 방지를 위해 실제 score를 상한 후보로 반영한다.
    const firedScore = output && Number.isFinite(output.score) ? Math.max(0, output.score) : 0;
    availableMaxScore += Math.max(baseWeight, firedScore);

    if (status === 'THRESHOLD_NOT_MET' || status === 'SKIPPED_BY_POLICY' || status === 'SANITY_REJECTED') {
      thresholdNotMetConditions.push(key);
    } else if (status === 'PROVIDER_DEGRADED') {
      providerDegradedConditions.push(key);
    }
  }

  const normalizedGateScore = availableMaxScore > 0
    ? clamp(rawScore / availableMaxScore, 0, 1)
    : 0;

  return {
    rawScore,
    availableMaxScore,
    normalizedGateScore,
    unavailableConditions,
    thresholdNotMetConditions,
    providerDegradedConditions,
  };
}

/**
 * Multi-Timeframe Alignment Score (MTAS) — 타임프레임 정렬도 수치화
 */
function calculateMTAS(quote: YahooQuoteExtended): { mtas: number; dataInsufficient: boolean } {
  let mtas = 0;

  if (quote.monthlyAboveEMA12 && quote.monthlyEMARising) {
    mtas += 3;
  }

  if (quote.weeklyAboveCloud) mtas += 1.5;
  if (quote.weeklyLaggingSpanUp) mtas += 1.5;

  let dailyScore = 0;
  if (quote.ma5 > 0 && quote.ma20 > 0 && quote.ma60 > 0 &&
      quote.ma5 > quote.ma20 && quote.ma20 > quote.ma60) {
    dailyScore += 1.5;
  }
  if (quote.atr20avg > 0 && quote.atr < quote.atr20avg * 0.7) {
    dailyScore += 1.5;
  }
  if (quote.dailyVolumeDrying) {
    dailyScore += 1;
  }
  mtas += dailyScore;

  const monthlyWeeklyScore = mtas - dailyScore;
  const dataInsufficient = monthlyWeeklyScore === 0 && dailyScore > 0 &&
    !quote.monthlyAboveEMA12 && !quote.weeklyAboveCloud && !quote.weeklyLaggingSpanUp;

  if (dataInsufficient && dailyScore > 0) {
    mtas = Math.max(4.0, (dailyScore / 4) * 7);
  }

  return { mtas, dataInsufficient };
}

/**
 * Yahoo Finance 확장 시세 데이터로 Gate 조건 평가.
 */
export function evaluateServerGate(
  quote: YahooQuoteExtended,
  weights: ConditionWeights = DEFAULT_CONDITION_WEIGHTS,
  kospi20dReturn?: number,
  dartFin?: DartFinancials | null,
  kisFlow?: KisInvestorFlow | null,
  regime?: RegimeLevel | string,
): ServerGateResult {
  const run = defaultRegistry.run({ quote, weights, kospi20dReturn, dartFin, kisFlow });
  let score = run.totalScore;
  const details = [...run.details];
  const conditionKeys = [...run.conditionKeys];
  const scoreHealth = computeGateScoreHealth(run.outputs, weights, score);

  const cs = calculateCompressionScore(quote);
  const { mtas, dataInsufficient } = calculateMTAS(quote);

  let signalType: 'STRONG' | 'NORMAL' | 'SKIP';
  let positionPct: number;

  if (mtas <= 3) {
    signalType = 'SKIP';
    positionPct = 0;
    details.push(`MTAS ${mtas.toFixed(1)}/10 진입금지`);
  } else {
    // ADR-452: live 의사결정은 기존 raw score(gateScore)를 그대로 사용한다. normalizedGateScore는 진단 전용.
    const band = getRegimeGateBand(regime);
    signalType = score >= band.strong ? 'STRONG' as const
               : score >= band.normal ? 'NORMAL' as const
               : 'SKIP' as const;
    if (regime && (band.strong !== 7 || band.normal !== 5)) {
      details.push(`레짐(${regime}) 밴드 S${band.strong}/N${band.normal}`);
    }

    positionPct = signalType === 'STRONG' ? 0.12
                : signalType === 'NORMAL' ? 0.08
                : 0.03;

    if (dataInsufficient) {
      positionPct *= 0.6;
      details.push(`MTAS ${mtas.toFixed(1)}/10 데이터부족-일봉평가(60%포지션)`);
    } else if (mtas === 10) {
      positionPct = Math.min(positionPct * 1.15, 0.15);
      details.push(`MTAS 10/10 최대포지션 (+15%)`);
    } else if (mtas >= 7) {
      details.push(`MTAS ${mtas.toFixed(1)}/10 표준`);
    } else if (mtas >= 5) {
      positionPct *= 0.5;
      details.push(`MTAS ${mtas.toFixed(1)}/10 50%포지션`);
    }
  }

  if (getVixConservativeMode()) {
    positionPct *= 0.80;
    if (signalType !== 'SKIP') {
      signalType = 'SKIP';
      details.push('VIX 보수모드 — 신규 진입 일시 중단');
    }
  }

  if (isTradingHeld()) {
    if (signalType !== 'SKIP') {
      signalType = 'SKIP';
      details.push('실시간 연속손절 홀드 — 신규 진입 차단 중');
    }
  }

  const gateLayerSummary = buildGateLayerSummary(run.outputs, weights, signalType);

  return {
    gateScore: score,
    ...scoreHealth,
    signalType,
    positionPct,
    details,
    conditionKeys,
    compressionScore: cs,
    mtas,
    outputs: run.outputs,
    gateLayerSummary,
  };
}
