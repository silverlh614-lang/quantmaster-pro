/**
 * quantFilter.ts — 서버사이드 경량 Gate 평가
 *
 * 전체 27조건 중 Yahoo Finance 데이터만으로 평가 가능한 8개 조건을 서버에서 계산.
 * 나머지 19개는 UI에서 수동 입력 시 반영되는 구조 유지.
 *
 * 아이디어 6: ConditionWeights — 자기학습 피드백으로 조건별 가중치 조정 지원.
 */

import type { YahooQuoteExtended } from './screener/stockScreener.js';

export interface ServerGateResult {
  gateScore: number;                          // 가중치 적용 점수 (float, 최대 ~10)
  signalType: 'STRONG' | 'NORMAL' | 'SKIP';
  positionPct: number;                        // Kelly 기반 포지션 비율
  details: string[];                          // 통과한 조건 레이블
  conditionKeys: string[];                    // 통과한 조건 키 (Signal Calibrator용)
  compressionScore: number;                   // CS (0~1) — 변동성 압축도 정량화 지수
  mtas: number;                               // MTAS (0~10) — 멀티타임프레임 정렬도
}

/** 조건 키 상수 — condition-weights.json의 키와 1:1 매핑 */
export const CONDITION_KEYS = {
  MOMENTUM:          'momentum',
  MA_ALIGNMENT:      'ma_alignment',
  VOLUME_BREAKOUT:   'volume_breakout',
  PER:               'per',
  TURTLE_HIGH:       'turtle_high',
  RELATIVE_STRENGTH: 'relative_strength',
  VCP:               'vcp',
  VOLUME_SURGE:      'volume_surge',
  RSI_ZONE:          'rsi_zone',   // RSI(14) 40~70 건강구간 (실계산)
  MACD_BULL:         'macd_bull',  // MACD 히스토그램 > 0 (실계산)
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
  vcp:               1.0,
  volume_surge:      1.0,
  rsi_zone:          1.0,
  macd_bull:         1.0,
};

/**
 * Compression Score (CS) — 변동성 압축도 정량화 지수
 *
 * CS = (1 - BB폭현재/BB폭20일평균) × 0.4
 *    + (1 - 거래량5일평균/거래량20일평균) × 0.4
 *    + (1 - ATR5일/ATR20일) × 0.2
 *
 * 범위: 0~1 (1에 가까울수록 강한 압축)
 * CS ≥ 0.6: 강한 압축 (최대 포지션)
 * CS 0.4~0.6: 중간 압축 (절반 포지션)
 * CS < 0.4: 압축 미완 (진입 보류)
 */
function calculateCompressionScore(quote: YahooQuoteExtended): number {
  const bbRatio = quote.bbWidth20dAvg > 0
    ? quote.bbWidthCurrent / quote.bbWidth20dAvg
    : 1;
  const volRatio = quote.vol20dAvg > 0
    ? quote.vol5dAvg / quote.vol20dAvg
    : 1;
  const atrRatio = quote.atr20avg > 0
    ? quote.atr5d / quote.atr20avg
    : 1;

  const cs = (1 - bbRatio) * 0.4
           + (1 - volRatio) * 0.4
           + (1 - atrRatio) * 0.2;

  return Math.max(0, Math.min(1, cs));
}

/**
 * Multi-Timeframe Alignment Score (MTAS) — 타임프레임 정렬도 수치화
 *
 * 월봉: 주가 > 12개월 EMA이고 우상향 → +3점
 * 주봉: 일목균형표 구름대 위 (+1.5) + 후행스팬 상향 (+1.5) → +3점
 * 일봉: 정배열 (+1.5) + VCP (+1.5) + 거래량 마름 (+1) → +4점 (최대)
 *
 * 범위: 0~10
 * MTAS 10: 최대 포지션 (Gate 3 추가 가중 +15%)
 * MTAS 7~9: 표준 포지션
 * MTAS 5~6: 50% 포지션
 * MTAS ≤ 4: 진입 금지
 */
function calculateMTAS(quote: YahooQuoteExtended): number {
  let mtas = 0;

  // 월봉 판단 (+3점): 주가 > 12개월 EMA이고 우상향
  if (quote.monthlyAboveEMA12 && quote.monthlyEMARising) {
    mtas += 3;
  }

  // 주봉 판단 (+3점): 일목균형표 구름대 위 + 후행스팬 상향
  if (quote.weeklyAboveCloud) mtas += 1.5;
  if (quote.weeklyLaggingSpanUp) mtas += 1.5;

  // 일봉 판단 (+4점): 정배열 + VCP + 거래량 마름
  if (quote.ma5 > 0 && quote.ma20 > 0 && quote.ma60 > 0 &&
      quote.ma5 > quote.ma20 && quote.ma20 > quote.ma60) {
    mtas += 1.5;  // 정배열
  }
  if (quote.atr20avg > 0 && quote.atr < quote.atr20avg * 0.7) {
    mtas += 1.5;  // VCP 변동성 축소
  }
  if (quote.dailyVolumeDrying) {
    mtas += 1;    // 거래량 마름
  }

  return mtas;
}

/**
 * Yahoo Finance 확장 시세 데이터로 10개 Gate 조건 평가.
 * weights 인수로 아이디어 6(Signal Calibrator) 자기학습 가중치를 반영.
 * kospiDayReturn 인수로 상대강도를 실계산 (미전달 시 절대 기준 1.5% 사용).
 *
 * 조건 2:  모멘텀 (+2% 이상)
 * 조건 10: 정배열 (5일선 > 20일선 > 60일선)
 * 조건 11: 거래량 돌파 (5일 평균 2배 이상)
 * 조건 13: PER 밸류에이션 (< 20)
 * 조건 18: 터틀 돌파 (20일 신고가)
 * 조건 24: 상대강도 (종목 일간 수익 − KOSPI 당일 수익 > 1.0%p, 실계산)
 * 조건 25: VCP 변동성 축소 (ATR < 20일 ATR 평균의 70%)
 * 조건 27: 거래량 급증 + 상승 (거래량 3배 이상 & +1% 이상)
 * [신규] RSI(14) 건강구간 40~70 (실계산)
 * [신규] MACD 히스토그램 > 0 (실계산)
 */
export function evaluateServerGate(
  quote: YahooQuoteExtended,
  weights: ConditionWeights = DEFAULT_CONDITION_WEIGHTS,
  kospiDayReturn?: number,   // 실계산 상대강도용 — undefined 시 절대 기준 사용
): ServerGateResult {
  let score = 0;
  const details: string[] = [];
  const conditionKeys: string[] = [];

  const w = (key: ConditionKey): number =>
    Math.max(0.1, Math.min(2.0, weights[key] ?? 1.0));

  // 조건 2: 모멘텀 (+2% 이상)
  if (quote.changePercent >= 2) {
    score += w('momentum');
    details.push(`모멘텀 +${quote.changePercent.toFixed(1)}%`);
    conditionKeys.push('momentum');
  }

  // 조건 10: 정배열 (5일선 > 20일선 > 60일선)
  if (quote.ma5 > 0 && quote.ma20 > 0 && quote.ma60 > 0 &&
      quote.ma5 > quote.ma20 && quote.ma20 > quote.ma60) {
    score += w('ma_alignment');
    details.push('정배열 (MA5>MA20>MA60)');
    conditionKeys.push('ma_alignment');
  }

  // 조건 11: 거래량 돌파 (5일 평균 2배 이상)
  if (quote.avgVolume > 0 && quote.volume >= quote.avgVolume * 2) {
    score += w('volume_breakout');
    details.push(`거래량 ${(quote.volume / quote.avgVolume).toFixed(1)}배`);
    conditionKeys.push('volume_breakout');
  }

  // 조건 13: PER 밸류에이션 (0 < PER < 20)
  if (quote.per > 0 && quote.per < 20) {
    score += w('per');
    details.push(`PER ${quote.per.toFixed(1)}`);
    conditionKeys.push('per');
  }

  // 조건 18: 터틀 돌파 (20일 신고가)
  if (quote.high20d > 0 && quote.price >= quote.high20d) {
    score += w('turtle_high');
    details.push('20일 신고가 돌파');
    conditionKeys.push('turtle_high');
  }

  // 조건 24: 상대강도 — kospiDayReturn 제공 시 실계산, 미제공 시 절대 기준
  const relStrengthGap = quote.changePercent - (kospiDayReturn ?? 0);
  const relStrengthThreshold = kospiDayReturn !== undefined ? 1.0 : 1.5;
  if (relStrengthGap > relStrengthThreshold) {
    score += w('relative_strength');
    details.push(
      kospiDayReturn !== undefined
        ? `상대강도 +${relStrengthGap.toFixed(1)}%p (KOSPI ${kospiDayReturn.toFixed(1)}%)`
        : `상대강도 +${quote.changePercent.toFixed(1)}%`
    );
    conditionKeys.push('relative_strength');
  }

  // 조건 25: VCP — Compression Score 기반 정량 평가
  // '박스권이다' 정성 판단 → '압축도 0.73 강한 에너지 응축' 정량 판단으로 업그레이드
  const cs = calculateCompressionScore(quote);
  if (cs >= 0.6) {
    score += w('vcp');
    details.push(`VCP 강한압축 (CS=${cs.toFixed(2)})`);
    conditionKeys.push('vcp');
  } else if (cs >= 0.4) {
    score += w('vcp') * 0.5;
    details.push(`VCP 중간압축 (CS=${cs.toFixed(2)})`);
    conditionKeys.push('vcp');
  }
  // CS < 0.4: 압축 미완 — VCP 미통과

  // 조건 27: 거래량 급증 + 상승 (거래량 3배 이상 & +1% 이상)
  if (quote.avgVolume > 0 && quote.volume >= quote.avgVolume * 3 && quote.changePercent >= 1) {
    score += w('volume_surge');
    details.push('거래량 급증+상승');
    conditionKeys.push('volume_surge');
  }

  // [신규] RSI(14) 건강구간: 40~70 (과매도 탈출 후 과매수 미달 — 실계산)
  if (quote.rsi14 >= 40 && quote.rsi14 <= 70) {
    score += w('rsi_zone');
    details.push(`RSI ${quote.rsi14.toFixed(0)}`);
    conditionKeys.push('rsi_zone');
  }

  // [신규] MACD 상승압력: 히스토그램 > 0 (실계산)
  if (quote.macdHistogram > 0) {
    score += w('macd_bull');
    details.push(`MACD +${quote.macdHistogram.toFixed(2)}`);
    conditionKeys.push('macd_bull');
  }

  // MTAS — 멀티타임프레임 정렬도 (타임프레임 불일치 역방향 진입 구조적 차단)
  const mtas = calculateMTAS(quote);

  // 신호 분류 및 포지션 사이징
  let signalType: 'STRONG' | 'NORMAL' | 'SKIP';
  let positionPct: number;

  if (mtas <= 4) {
    // MTAS ≤ 4: 진입 금지 — 타임프레임 불일치
    signalType = 'SKIP';
    positionPct = 0;
    details.push(`MTAS ${mtas.toFixed(1)}/10 진입금지`);
  } else {
    // 기존 점수 기반 분류 (최대 점수 ~10)
    signalType = score >= 7 ? 'STRONG' as const
               : score >= 5 ? 'NORMAL' as const
               : 'SKIP' as const;

    positionPct = score >= 7 ? 0.12
                : score >= 5 ? 0.08
                : 0.03;

    // MTAS 기반 포지션 조정
    if (mtas === 10) {
      positionPct = Math.min(positionPct * 1.15, 0.15);
      details.push(`MTAS 10/10 최대포지션 (+15%)`);
    } else if (mtas >= 7) {
      details.push(`MTAS ${mtas.toFixed(1)}/10 표준`);
    } else if (mtas >= 5) {
      positionPct *= 0.5;
      details.push(`MTAS ${mtas.toFixed(1)}/10 50%포지션`);
    }
  }

  return { gateScore: score, signalType, positionPct, details, conditionKeys, compressionScore: cs, mtas };
}
