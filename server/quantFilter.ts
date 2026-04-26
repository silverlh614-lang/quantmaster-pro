// @responsibility quantFilter 서버 모듈
/**
 * quantFilter.ts — 서버사이드 경량 Gate 평가
 *
 * 전체 27조건 중 서버에서 평가 가능한 조건들을 실계산.
 * 나머지는 UI에서 수동 입력 시 반영되는 구조 유지.
 *
 * 아이디어 6: ConditionWeights — 자기학습 피드백으로 조건별 가중치 조정 지원.
 *
 * 현재 평가 조건 (11개 Yahoo 기반 + 2개 데이터 연동 선택적):
 *   조건 2:  모멘텀 (+2% 이상 또는 RSI 가속)
 *   조건 10: 정배열 (MA5 > MA20 > MA60)
 *   조건 11: 거래량 돌파 (5일 평균 2배 이상)
 *   조건 13: PER 밸류에이션 (0 < PER < 20)
 *   조건 18: 터틀 돌파 (20일 신고가)
 *   조건 24: 상대강도 (종목20d − KOSPI20d > 3.0%p)
 *   조건 25: VCP 변동성 축소 (Compression Score 기반)
 *   조건 27: 거래량 급증+상승 (3배 & +1%)
 *   RSI(14) 건강구간 40~70
 *   MACD 가속 (히스토그램 > 0 AND > 5일 전)
 *   눌림목 셋업
 *   MA60 상승 추세 (ma60TrendUp)
 *   주봉 RSI 건강구간 40~70
 *   [선택] 수급 합치 — KIS 기관/외인 순매수 (kisFlow 제공 시)
 *   [선택] OCF 품질 — DART 영업현금흐름 비율 (dartFin 제공 시)
 */

import type { YahooQuoteExtended } from './screener/stockScreener.js';
import type { DartFinancials } from './clients/dartFinancialClient.js';
import type { KisInvestorFlow } from './clients/kisClient.js';
import type { RegimeLevel } from '../src/types/core.js';
import { getVixConservativeMode } from './state.js';
import { isTradingHeld } from './learning/learningState.js';
import { getRegimeGateBand } from './trading/gateConfig.js';
import { defaultRegistry, calculateCompressionScore } from './quant/conditions/index.js';

export interface ServerGateResult {
  gateScore: number;                          // 가중치 적용 점수 (float, 최대 ~15)
  signalType: 'STRONG' | 'NORMAL' | 'SKIP';
  positionPct: number;                        // Kelly 기반 포지션 비율
  details: string[];                          // 통과한 조건 레이블
  conditionKeys: string[];                    // 통과한 조건 키 (Signal Calibrator용)
  compressionScore: number;                   // CS (0~1) — 변동성 압축도 정량화 지수
  mtas: number;                               // MTAS (0~10) — 멀티타임프레임 정렬도
}

/** 조건 키 상수 — condition-weights.json의 키와 1:1 매핑 */
export const CONDITION_KEYS = {
  MOMENTUM:          'momentum',            // Gate 2 — intraday price change (+2% OR 0.5% + RSI 가속)
  MA_ALIGNMENT:      'ma_alignment',
  VOLUME_BREAKOUT:   'volume_breakout',
  PER:               'per',
  TURTLE_HIGH:       'turtle_high',
  // Gate 24 의미 분리 (B3 → 20d): momentum(당일 +2%) 과 시간축 분리.
  // relative_strength 는 종목 20일 누적 − KOSPI 20일 누적 > 3%p 기준이다.
  // kospi20dReturn 미제공 시 발화하지 않는다(공선성 차단).
  RELATIVE_STRENGTH: 'relative_strength',
  // Gate 24 새 의미 — 5일 고점 대비 위치 + 거래량 조건. momentum 과 독립 입력을 사용한다.
  BREAKOUT_MOMENTUM: 'breakout_momentum',
  VCP:               'vcp',
  VOLUME_SURGE:      'volume_surge',
  RSI_ZONE:          'rsi_zone',          // RSI(14) 40~70 건강구간 (실계산)
  MACD_BULL:         'macd_bull',         // MACD 히스토그램 > 0 AND 가속 (실계산)
  PULLBACK:          'pullback',          // 눌림목 셋업
  MA60_RISING:       'ma60_rising',       // MA60 우상향 추세 (장기 추세 필터)
  WEEKLY_RSI_ZONE:   'weekly_rsi_zone',   // 주봉 RSI 40~70 (타임프레임 정렬)
  SUPPLY_CONFLUENCE: 'supply_confluence', // KIS 기관/외인 수급 합치 (신뢰도 HIGH)
  EARNINGS_QUALITY:  'earnings_quality',  // DART OCF 품질 (분기 데이터)
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
  breakout_momentum: 1.0,  // Gate 24 새 의미 — 5일 고점 위치 + 거래량 (momentum과 독립 입력)
  vcp:               1.0,
  volume_surge:      1.0,
  rsi_zone:          1.0,
  macd_bull:         1.0,
  pullback:          1.0,
  ma60_rising:       1.0,
  weekly_rsi_zone:   0.8,  // 일봉보다 낮은 가중치 (타임프레임 보조)
  supply_confluence: 1.2,  // 허위신호 차단 효과 최대 (신뢰도 HIGH)
  earnings_quality:  0.7,  // 분기 데이터라 실시간성 없음 — 스크리닝 보조용
};

/**
 * Compression Score (CS) 계산은 server/quant/conditions/evaluators.ts 로 이전.
 * orchestrator 가 result.compressionScore 채우려면 동일 함수가 필요해 re-export.
 */

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
function calculateMTAS(quote: YahooQuoteExtended): { mtas: number; dataInsufficient: boolean } {
  let mtas = 0;

  // 월봉 판단 (+3점): 주가 > 12개월 EMA이고 우상향
  if (quote.monthlyAboveEMA12 && quote.monthlyEMARising) {
    mtas += 3;
  }

  // 주봉 판단 (+3점): 일목균형표 구름대 위 + 후행스팬 상향
  if (quote.weeklyAboveCloud) mtas += 1.5;
  if (quote.weeklyLaggingSpanUp) mtas += 1.5;

  // 일봉 판단 (+4점): 정배열 + VCP + 거래량 마름
  let dailyScore = 0;
  if (quote.ma5 > 0 && quote.ma20 > 0 && quote.ma60 > 0 &&
      quote.ma5 > quote.ma20 && quote.ma20 > quote.ma60) {
    dailyScore += 1.5;  // 정배열
  }
  if (quote.atr20avg > 0 && quote.atr < quote.atr20avg * 0.7) {
    dailyScore += 1.5;  // VCP 변동성 축소
  }
  if (quote.dailyVolumeDrying) {
    dailyScore += 1;    // 거래량 마름
  }
  mtas += dailyScore;

  // 데이터 부족 판단: 월봉/주봉 조건이 모두 false인데 일봉에서만 점수가 있으면
  // Yahoo 히스토리 미충족일 가능성이 높다.
  const monthlyWeeklyScore = mtas - dailyScore;
  const dataInsufficient = monthlyWeeklyScore === 0 && dailyScore > 0 &&
    !quote.monthlyAboveEMA12 && !quote.weeklyAboveCloud && !quote.weeklyLaggingSpanUp;

  // 데이터 부족 시 일봉 점수를 10점 만점으로 스케일 (4점 → 10점 스케일)
  // 일봉만으로 평가: dailyScore/4 × 7 (월봉/주봉 중립 가정, 최대 7점)
  // 최소 4.0 보장: 데이터 부족으로 인한 과도한 진입 차단(mtas<=3 SKIP) 방지
  if (dataInsufficient && dailyScore > 0) {
    mtas = Math.max(4.0, (dailyScore / 4) * 7);
  }

  return { mtas, dataInsufficient };
}

/**
 * Yahoo Finance 확장 시세 데이터로 Gate 조건 평가.
 *
 * @param quote           Yahoo 확장 시세 (필수)
 * @param weights         Signal Calibrator 자기학습 가중치 (기본값 DEFAULT_CONDITION_WEIGHTS)
 * @param kospi20dReturn  KOSPI 20거래일 누적 수익률 (%) — relative_strength 벤치마크.
 *                        미제공 시 relative_strength 조건은 발화하지 않는다(공선성 차단).
 * @param dartFin         DART 재무 데이터 — 제공 시 OCF 품질 조건 평가 (선택)
 * @param kisFlow         KIS 투자자 수급 — 제공 시 기관/외인 합치 조건 평가 (선택)
 */
export function evaluateServerGate(
  quote: YahooQuoteExtended,
  weights: ConditionWeights = DEFAULT_CONDITION_WEIGHTS,
  kospi20dReturn?: number,
  dartFin?: DartFinancials | null,
  kisFlow?: KisInvestorFlow | null,
  regime?: RegimeLevel | string,
): ServerGateResult {
  // 14개 ConditionEvaluator 를 defaultRegistry 가 일괄 실행하고 합산.
  // 신규 조건 추가는 conditions/index.ts 에서 한 줄 register 만으로 끝난다(Open-Closed).
  const run = defaultRegistry.run({ quote, weights, kospi20dReturn, dartFin, kisFlow });
  let score = run.totalScore;
  const details = [...run.details];
  const conditionKeys = [...run.conditionKeys];

  // CS 는 vcpEvaluator 내부에서도 사용하지만 결과 객체(ServerGateResult.compressionScore)에
  // 그대로 노출하기 위해 한 번 더 계산. 동일 입력 → 동일 결과(순수 함수).
  const cs = calculateCompressionScore(quote);

  // MTAS — 멀티타임프레임 정렬도 (타임프레임 불일치 역방향 진입 구조적 차단)
  const { mtas, dataInsufficient } = calculateMTAS(quote);

  // 신호 분류 및 포지션 사이징
  let signalType: 'STRONG' | 'NORMAL' | 'SKIP';
  let positionPct: number;

  if (mtas <= 3) {
    // MTAS ≤ 3: 진입 금지 — 타임프레임 불일치 (기존 4 → 3으로 완화)
    signalType = 'SKIP';
    positionPct = 0;
    details.push(`MTAS ${mtas.toFixed(1)}/10 진입금지`);
  } else {
    // 레짐별 STRONG/NORMAL 밴드 — RISK_ON_EARLY(R1/R3)에서는 NORMAL 4.0 완화,
    // RISK_OFF_CORRECTION(R5)에서는 6.0 강화 (src/constants/gateConfig.ts).
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

    // 데이터 부족 시 포지션 축소 (월봉/주봉 없이 일봉만으로 평가한 경우)
    if (dataInsufficient) {
      positionPct *= 0.6;
      details.push(`MTAS ${mtas.toFixed(1)}/10 데이터부족-일봉평가(60%포지션)`);
    // MTAS 기반 포지션 조정
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

  // ── VIX 장중 급등 보수 모드: positionPct 20% 축소 + 신규 진입 차단 ──────────
  // macroSectorSync.ts가 장중 VIX +3% 급등 감지 시 활성화.
  // 인과 역전 방지: 거시 악화에도 시스템이 매수 신호를 내는 상황을 차단.
  if (getVixConservativeMode()) {
    positionPct *= 0.80; // 20% 축소
    if (signalType !== 'SKIP') {
      signalType = 'SKIP';
      details.push('VIX 보수모드 — 신규 진입 일시 중단');
    }
  }

  // ── 아이디어 3 — 실시간 연속 LOSS 거래 홀드 ─────────────────────────────────
  // 장중 2건 이상 연속 손절 감지 시 30분간 신규 진입 차단.
  if (isTradingHeld()) {
    if (signalType !== 'SKIP') {
      signalType = 'SKIP';
      details.push('실시간 연속손절 홀드 — 신규 진입 차단 중');
    }
  }

  return { gateScore: score, signalType, positionPct, details, conditionKeys, compressionScore: cs, mtas };
}
