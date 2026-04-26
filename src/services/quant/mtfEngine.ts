// @responsibility quant mtfEngine 엔진 모듈
/**
 * mtfEngine.ts — 다중 시간 프레임 합치 스코어 (MTF Confluence Score)
 *
 * 핵심 개념: 월봉·주봉·일봉·60분봉의 4개 시간 프레임에서 동시에 신호가 정렬될 때만
 * 최고 점수를 부여하는 시간 계층 통합 엔진. 노이즈 필터링의 가장 강력한 도구.
 *
 * MTF_Score = Σ(Timeframe_Score × Weight)
 *   월봉 추세 정배열: Weight 0.35
 *   주봉 돌파/지지:   Weight 0.30
 *   일봉 Gate 신호:   Weight 0.25
 *   60분봉 타이밍:    Weight 0.10
 *
 * 신호 등급:
 *   ≥ 85 → STRONG_BUY  풀 포지션 (100%)
 *   75~84 → BUY         70% 포지션
 *   65~74 → WATCH        진입 보류
 *   < 65  → IDLE         관망
 */

import type {
  MTFConfluenceInput,
  MTFConfluenceResult,
  MTFTimeframeScore,
  MTFSignal,
} from '../../types/technical';

// ─── 가중치 상수 ──────────────────────────────────────────────────────────────

const WEIGHTS = {
  MONTHLY: 0.35,
  WEEKLY: 0.30,
  DAILY: 0.25,
  H60: 0.10,
} as const;

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function toSignal(score: number): MTFTimeframeScore['signal'] {
  if (score >= 65) return 'BULLISH';
  if (score >= 35) return 'NEUTRAL';
  return 'BEARISH';
}

// ─── 시간 프레임별 점수 계산 ──────────────────────────────────────────────────

/**
 * 월봉 — 거시 추세 정배열 (Weight 0.35)
 * MA60 상단 + MA60 우상향이면 완전 강세
 */
function calcMonthlyScore(input: MTFConfluenceInput): number {
  let score = 0;
  if (input.monthlyAboveMa60)   score += 60;  // MA60 위 — 장기 강세 전제
  if (input.monthlyMa60TrendUp) score += 40;  // MA60 상승 추세 — 정배열 확인
  return clamp(score, 0, 100);
}

/**
 * 주봉 — 돌파/지지 확인 (Weight 0.30)
 * RSI 40~70 건강구간 + MACD 히스토 양수 + 저항 돌파
 */
function calcWeeklyScore(input: MTFConfluenceInput): number {
  let score = 0;
  if (input.weeklyRsi >= 40 && input.weeklyRsi <= 70) score += 35;  // 건강구간
  else if (input.weeklyRsi > 70)                      score += 15;  // 과열 (감점)
  else                                                score += 0;   // 침체
  if (input.weeklyMacdHistogramPositive)              score += 35;  // MACD 모멘텀
  if (input.weeklyBreakoutConfirmed)                  score += 30;  // 돌파/지지 확인
  return clamp(score, 0, 100);
}

/**
 * 일봉 — Gate 신호 품질 (Weight 0.25)
 * 골든크로스 정배열 + RSI 건강 + Gate 통과
 */
function calcDailyScore(input: MTFConfluenceInput): number {
  let score = 0;
  if (input.dailyGoldenCross) score += 35;  // price > MA5 > MA20
  if (input.dailyRsiHealthy)  score += 30;  // RSI 40~70
  if (input.dailyGateSignal)  score += 35;  // Gate 1 or 2 통과
  return clamp(score, 0, 100);
}

/**
 * 60분봉 — 단기 타이밍 (Weight 0.10)
 * 모멘텀 상승 + 거래량 서지
 */
function calcH60Score(input: MTFConfluenceInput): number {
  let score = 0;
  if (input.h60MomentumUp)   score += 60;  // 상승 모멘텀
  if (input.h60VolumeSurge)  score += 40;  // 거래량 서지 동반
  return clamp(score, 0, 100);
}

// ─── 공개 API ─────────────────────────────────────────────────────────────────

/**
 * 4개 시간 프레임 합치 스코어 계산.
 *
 * 핵심 통찰: 일봉 신호가 아무리 완벽해도 주봉이 하락 추세라면 역방향 수영이다.
 * 이 계층적 필터로 허위 신호를 원천 차단한다.
 */
export function evaluateMTFConfluence(input: MTFConfluenceInput): MTFConfluenceResult {
  const monthlyRaw = calcMonthlyScore(input);
  const weeklyRaw  = calcWeeklyScore(input);
  const dailyRaw   = calcDailyScore(input);
  const h60Raw     = calcH60Score(input);

  const monthly: MTFTimeframeScore = {
    timeframe: 'MONTHLY',
    score: monthlyRaw,
    weight: WEIGHTS.MONTHLY,
    weightedScore: parseFloat((monthlyRaw * WEIGHTS.MONTHLY).toFixed(1)),
    signal: toSignal(monthlyRaw),
    detail: `MA60 ${input.monthlyAboveMa60 ? '상단' : '하단'} · 추세 ${input.monthlyMa60TrendUp ? '상승' : '하락/횡보'}`,
  };

  const weekly: MTFTimeframeScore = {
    timeframe: 'WEEKLY',
    score: weeklyRaw,
    weight: WEIGHTS.WEEKLY,
    weightedScore: parseFloat((weeklyRaw * WEIGHTS.WEEKLY).toFixed(1)),
    signal: toSignal(weeklyRaw),
    detail: `RSI ${input.weeklyRsi.toFixed(0)} · MACD ${input.weeklyMacdHistogramPositive ? '양수' : '음수'} · 돌파 ${input.weeklyBreakoutConfirmed ? '확인' : '미확인'}`,
  };

  const daily: MTFTimeframeScore = {
    timeframe: 'DAILY',
    score: dailyRaw,
    weight: WEIGHTS.DAILY,
    weightedScore: parseFloat((dailyRaw * WEIGHTS.DAILY).toFixed(1)),
    signal: toSignal(dailyRaw),
    detail: `정배열 ${input.dailyGoldenCross ? '확인' : '미확인'} · RSI ${input.dailyRsiHealthy ? '건강' : '이상'} · Gate ${input.dailyGateSignal ? '통과' : '미달'}`,
  };

  const h60: MTFTimeframeScore = {
    timeframe: 'H60',
    score: h60Raw,
    weight: WEIGHTS.H60,
    weightedScore: parseFloat((h60Raw * WEIGHTS.H60).toFixed(1)),
    signal: toSignal(h60Raw),
    detail: `모멘텀 ${input.h60MomentumUp ? '상승' : '하락'} · 거래량 ${input.h60VolumeSurge ? '서지' : '보통'}`,
  };

  // MTF_Score = Σ(Timeframe_Score × Weight) — 0~100
  const mtfScore = clamp(
    monthly.weightedScore + weekly.weightedScore + daily.weightedScore + h60.weightedScore,
    0,
    100,
  );

  let signal: MTFSignal;
  let positionRatio: number;

  if (mtfScore >= 85) {
    signal = 'STRONG_BUY';
    positionRatio = 1.0;
  } else if (mtfScore >= 75) {
    signal = 'BUY';
    positionRatio = 0.70;
  } else if (mtfScore >= 65) {
    signal = 'WATCH';
    positionRatio = 0;
  } else {
    signal = 'IDLE';
    positionRatio = 0;
  }

  const tfAlign = [monthly.signal, weekly.signal, daily.signal, h60.signal].filter(s => s === 'BULLISH').length;

  const summary =
    signal === 'STRONG_BUY' ? `MTF ${mtfScore.toFixed(0)}점 — 4개 시간프레임 정렬 완성, 풀 포지션 허용` :
    signal === 'BUY'        ? `MTF ${mtfScore.toFixed(0)}점 — ${tfAlign}/4 프레임 정렬, 70% 포지션` :
    signal === 'WATCH'      ? `MTF ${mtfScore.toFixed(0)}점 — 시간프레임 미정렬, 진입 보류` :
                              `MTF ${mtfScore.toFixed(0)}점 — 하위 레짐 필터 차단, 관망`;

  return {
    monthly, weekly, daily, h60,
    mtfScore: parseFloat(mtfScore.toFixed(1)),
    signal,
    positionRatio,
    summary,
  };
}
