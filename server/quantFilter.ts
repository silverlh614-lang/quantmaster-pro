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
 *   조건 24: 상대강도 (종목−KOSPI > 1.0%p)
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
import { isPullbackSetup } from './screener/pipelineHelpers.js';
import { getVixConservativeMode } from './state.js';

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
  MOMENTUM:          'momentum',
  MA_ALIGNMENT:      'ma_alignment',
  VOLUME_BREAKOUT:   'volume_breakout',
  PER:               'per',
  TURTLE_HIGH:       'turtle_high',
  RELATIVE_STRENGTH: 'relative_strength',
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
 * @param quote          Yahoo 확장 시세 (필수)
 * @param weights        Signal Calibrator 자기학습 가중치 (기본값 DEFAULT_CONDITION_WEIGHTS)
 * @param kospiDayReturn KOSPI 당일 수익률 — 상대강도 실계산용 (미전달 시 절대 기준)
 * @param dartFin        DART 재무 데이터 — 제공 시 OCF 품질 조건 평가 (선택)
 * @param kisFlow        KIS 투자자 수급 — 제공 시 기관/외인 합치 조건 평가 (선택)
 */
export function evaluateServerGate(
  quote: YahooQuoteExtended,
  weights: ConditionWeights = DEFAULT_CONDITION_WEIGHTS,
  kospiDayReturn?: number,
  dartFin?: DartFinancials | null,
  kisFlow?: KisInvestorFlow | null,
): ServerGateResult {
  let score = 0;
  const details: string[] = [];
  const conditionKeys: string[] = [];

  const w = (key: ConditionKey): number =>
    Math.max(0.1, Math.min(2.0, weights[key] ?? DEFAULT_CONDITION_WEIGHTS[key] ?? 1.0));

  // 조건 2: 모멘텀 — 당일 상승률 또는 RSI 가속으로 충족 가능
  const rsiAccel = (quote.rsi14 - quote.rsi5dAgo) >= 3;
  if (quote.changePercent >= 2) {
    score += w('momentum');
    details.push(`모멘텀 +${quote.changePercent.toFixed(1)}%`);
    conditionKeys.push('momentum');
  } else if (quote.changePercent >= 0.5 && rsiAccel && quote.return5d < 8) {
    // 당일 소폭 상승이라도 RSI 가속 + 5일 과급등 아니면 모멘텀 인정
    score += w('momentum') * 0.7;
    details.push(`모멘텀(RSI가속) +${quote.changePercent.toFixed(1)}% RSI${quote.rsi14.toFixed(0)}`);
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

  // [신규] MACD 가속: 히스토그램 > 0 AND 5일 전보다 확대 (방향 + 가속 동시 확인)
  // 단순 양수(방향만)보다 가속이 더 강한 신호 — 기존 macd_bull에서 업그레이드
  if (quote.macdHistogram > 0 && quote.macdHistogram > quote.macd5dHistAgo) {
    score += w('macd_bull');
    details.push(`MACD가속 ${quote.macd5dHistAgo.toFixed(2)}→${quote.macdHistogram.toFixed(2)}`);
    conditionKeys.push('macd_bull');
  } else if (quote.macdHistogram > 0) {
    // 양수이나 가속 미확인 — 부분 점수
    score += w('macd_bull') * 0.5;
    details.push(`MACD+ ${quote.macdHistogram.toFixed(2)} (가속미확인)`);
    conditionKeys.push('macd_bull');
  }

  // [신규] 눌림목 셋업: 고점 대비 조정 + 변동성 축소 + 장기 추세 유지
  if (isPullbackSetup(quote)) {
    const drawdown = quote.high60d > 0 ? (quote.high60d - quote.price) / quote.high60d * 100 : 0;
    score += w('pullback');
    details.push(`눌림목 (고점대비 -${drawdown.toFixed(1)}%)`);
    conditionKeys.push('pullback');
  }

  // [신규] MA60 상승 추세: 현재 MA60 > 5일 전 MA60 (대세 하락 중 단기 반등 필터)
  // 정배열(MA5>MA20>MA60)이지만 MA60이 하락 중인 종목을 추가로 걸러낸다
  if (quote.ma60TrendUp) {
    score += w('ma60_rising');
    details.push('MA60 우상향');
    conditionKeys.push('ma60_rising');
  }

  // [신규] 주봉 RSI 건강구간: 40~70 (타임프레임 정렬 — 일봉 RSI와 독립 등록)
  if (quote.weeklyRSI >= 40 && quote.weeklyRSI <= 70) {
    score += w('weekly_rsi_zone');
    details.push(`주봉RSI ${quote.weeklyRSI.toFixed(0)}`);
    conditionKeys.push('weekly_rsi_zone');
  }

  // [선택] 수급 합치: KIS 기관/외인 순매수 — kisFlow 제공 시에만 평가
  // 신뢰도 HIGH — 허위신호 차단 효과 가장 큼
  if (kisFlow) {
    const instBuy  = kisFlow.institutionalNetBuy > 0;
    const foreiBuy = kisFlow.foreignNetBuy > 0;
    if (instBuy && foreiBuy) {
      score += w('supply_confluence');
      details.push(
        `수급합치 기관+${(kisFlow.institutionalNetBuy / 1000).toFixed(0)}천주 ` +
        `외인+${(kisFlow.foreignNetBuy / 1000).toFixed(0)}천주`
      );
      conditionKeys.push('supply_confluence');
    } else if (instBuy || foreiBuy) {
      score += w('supply_confluence') * 0.6;
      const label = instBuy
        ? `기관+${(kisFlow.institutionalNetBuy / 1000).toFixed(0)}천주`
        : `외인+${(kisFlow.foreignNetBuy / 1000).toFixed(0)}천주`;
      details.push(`수급단독 ${label}`);
      conditionKeys.push('supply_confluence');
    }
  }

  // [선택] OCF 품질: DART 영업현금흐름/매출 비율 — dartFin 제공 시에만 평가
  // 분기 데이터라 실시간성 없음 — 스크리닝 단계 필터로 사용
  if (dartFin?.ocfRatio != null) {
    if (dartFin.ocfRatio >= 5.0) {
      // OCF/Revenue >= 5%: 이익의 질 양호 (영업에서 실제 현금 창출)
      score += w('earnings_quality');
      details.push(`OCF품질 ${dartFin.ocfRatio.toFixed(1)}%`);
      conditionKeys.push('earnings_quality');
    } else if (dartFin.ocfRatio >= 1.0) {
      // OCF/Revenue 1~5%: 기본 충족
      score += w('earnings_quality') * 0.5;
      details.push(`OCF기본 ${dartFin.ocfRatio.toFixed(1)}%`);
      conditionKeys.push('earnings_quality');
    }
  }

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
    // 기존 점수 기반 분류 (최대 점수 ~15)
    signalType = score >= 7 ? 'STRONG' as const
               : score >= 5 ? 'NORMAL' as const
               : 'SKIP' as const;

    positionPct = score >= 7 ? 0.12
                : score >= 5 ? 0.08
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

  return { gateScore: score, signalType, positionPct, details, conditionKeys, compressionScore: cs, mtas };
}
