/**
 * confluenceEngine.ts — Phase 2 컨플루언스 스코어링 엔진
 *
 * "조건 수 많다 ≠ 신뢰도 높다" 문제를 해결하는 4축 독립 평가 시스템.
 *
 * 4개 독립 축 (각 0~100, BULLISH ≥ 70):
 *   - Technical  : RSI·MACD·MA 정배열·거래량·VCP·가속도
 *   - Supply     : 외국인/기관 순매수 (KIS) 또는 기술적 대리지표
 *   - Fundamental: ROE·OPM·부채비율·OCF (DART)
 *   - Macro      : 레짐·VKOSPI·MHS·주봉 RSI
 *
 * 최종 신호:
 *   4 BULLISH → CONFIRMED_STRONG_BUY
 *   3 BULLISH → BUY
 *   ≤ 2       → HOLD (파이프라인에서 제외)
 */

import type { YahooQuoteExtended } from '../screener/stockScreener.js';
import type { MacroState } from '../persistence/macroStateRepo.js';
import type { RegimeLevel } from '../../src/types/core.js';

// ── 공개 타입 ─────────────────────────────────────────────────────────────────

export type AxisStatus = 'BULLISH' | 'NEUTRAL' | 'BEARISH';
export type CyclePosition = 'EARLY' | 'MID' | 'LATE';
export type CatalystGrade = 'A' | 'B' | 'C';
export type ConfluenceSignal = 'CONFIRMED_STRONG_BUY' | 'BUY' | 'HOLD';

export interface AxisScore {
  score:   number;      // 0~100
  status:  AxisStatus;  // BULLISH ≥ 70, NEUTRAL 50~69, BEARISH ≤ 49
  factors: string[];    // 기여 요소 레이블
}

export interface ConfluenceResult {
  technicalAxis:   AxisScore;
  supplyAxis:      AxisScore;
  fundamentalAxis: AxisScore;
  macroAxis:       AxisScore;
  bullishAxes:     number;          // BULLISH 판정 축 수 (0~4)
  signal:          ConfluenceSignal;
  cyclePosition:   CyclePosition;
  catalystGrade:   CatalystGrade;
  mtfScore:        number;          // 0~100 (멀티타임프레임 정렬도)
  confluenceScore: number;          // 0~100 가중 합산 (최종 순위용)
  summary:         string;          // 한 줄 요약
}

// ── 내부 유틸 ─────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function axisStatus(score: number): AxisStatus {
  if (score >= 70) return 'BULLISH';
  if (score >= 50) return 'NEUTRAL';
  return 'BEARISH';
}

// ── 축 1: 기술적 분석 (0~100) ────────────────────────────────────────────────

function calcTechnicalScore(q: YahooQuoteExtended): AxisScore {
  const factors: string[] = [];
  let score = 0;

  // RSI(14) 건강 구간 40~70: +20
  if (q.rsi14 >= 40 && q.rsi14 <= 70) {
    score += 20;
    factors.push(`RSI${q.rsi14.toFixed(0)} 건강구간`);
  } else if (q.rsi14 > 70) {
    score += 5; // 과열이지만 모멘텀 존재
    factors.push(`RSI${q.rsi14.toFixed(0)} 과열`);
  }

  // RSI 가속도 (5일 전 대비 +5pt 이상 상승): +15 (EARLY 사이클 핵심 신호)
  const rsiAccel = q.rsi14 - q.rsi5dAgo;
  if (rsiAccel >= 5) {
    score += 15;
    factors.push(`RSI가속+${rsiAccel.toFixed(1)}`);
  } else if (rsiAccel >= 2) {
    score += 7;
    factors.push(`RSI가속+${rsiAccel.toFixed(1)}`);
  }

  // MACD 히스토그램 > 0: +15
  if (q.macdHistogram > 0) {
    score += 15;
    factors.push('MACD↑');
  }

  // MACD 가속도 (히스토그램이 5일 전보다 확대): +15
  if (q.macdHistogram > q.macd5dHistAgo && q.macdHistogram > 0) {
    score += 15;
    factors.push('MACD가속');
  } else if (q.macdHistogram > q.macd5dHistAgo) {
    score += 5; // 음수 영역에서 개선
    factors.push('MACD개선');
  }

  // MA 정배열 (price > ma5 > ma20): +15
  if (q.price > q.ma5 && q.ma5 > q.ma20) {
    score += 15;
    factors.push('정배열');
  } else if (q.price > q.ma20) {
    score += 6;
    factors.push('MA20위');
  }

  // 거래량 돌파 (1.5× 이상): +10
  if (q.volume >= q.avgVolume * 1.5) {
    score += 10;
    factors.push('거래량돌파');
  } else if (q.volume >= q.avgVolume * 1.2) {
    score += 5;
    factors.push('거래량증가');
  }

  // VCP (변동성 수축): +10
  if (q.atr > 0 && q.atr20avg > 0 && q.atr < q.atr20avg * 0.7) {
    score += 10;
    factors.push('VCP수축');
  }

  // MA60 상승 추세: 보너스 +5 (항상)
  if (q.ma60TrendUp) {
    score += 5;
    factors.push('MA60상승');
  }

  return { score: clamp(score, 0, 100), status: axisStatus(score), factors };
}

// ── 축 2: 수급 분석 (0~100) ──────────────────────────────────────────────────

interface KisFlowInput {
  foreignNetBuy: number;
  institutionalNetBuy: number;
}

function calcSupplyScore(
  kisFlow: KisFlowInput | null | undefined,
  q: YahooQuoteExtended,
  kospiDayReturn?: number,
): AxisScore {
  const factors: string[] = [];
  let score = 0;

  if (kisFlow) {
    // KIS 실데이터 기반
    const { foreignNetBuy: fNB, institutionalNetBuy: iNB } = kisFlow;

    // 외국인 순매수: +40 (대규모 +50k주 이상) / +25 (소규모 > 0)
    if (fNB > 50000) {
      score += 40;
      factors.push(`외인+${(fNB / 1000).toFixed(0)}천주`);
    } else if (fNB > 0) {
      score += 25;
      factors.push(`외인+${(fNB / 1000).toFixed(0)}천주`);
    } else if (fNB < 0) {
      score -= 10;
      factors.push(`외인${(fNB / 1000).toFixed(0)}천주`);
    }

    // 기관 순매수: +30 (대규모) / +18 (소규모)
    if (iNB > 30000) {
      score += 30;
      factors.push(`기관+${(iNB / 1000).toFixed(0)}천주`);
    } else if (iNB > 0) {
      score += 18;
      factors.push(`기관+${(iNB / 1000).toFixed(0)}천주`);
    } else if (iNB < 0) {
      score -= 5;
    }

    // 외인+기관 동반 순매수 보너스: +10
    if (fNB > 0 && iNB > 0) {
      score += 10;
      factors.push('외인기관동반');
    }

    // KIS 데이터 없는 경우를 위한 기본 베이스라인 없음
  } else {
    // KIS 데이터 없음 → 기술적 대리지표
    const relStr = q.changePercent - (kospiDayReturn ?? 0);
    if (relStr > 2.0) {
      score += 40;
      factors.push(`상대강도+${relStr.toFixed(1)}%p`);
    } else if (relStr > 1.0) {
      score += 25;
      factors.push(`상대강도+${relStr.toFixed(1)}%p`);
    } else if (relStr > 0) {
      score += 12;
      factors.push(`상대강도+${relStr.toFixed(1)}%p`);
    }

    if (q.volume >= q.avgVolume * 2.0) {
      score += 30;
      factors.push('거래량2배');
    } else if (q.volume >= q.avgVolume * 1.5) {
      score += 18;
      factors.push('거래량1.5배');
    }

    // 데이터 없음 베이스라인 — 중립값 보정
    score = Math.max(score, 30); // KIS 미수집이라도 다른 조건 통과 시 불이익 방지
    if (score === 30) factors.push('KIS미수집(기술대리)');
  }

  return { score: clamp(score, 0, 100), status: axisStatus(score), factors };
}

// ── 축 3: 펀더멘털 (0~100) ───────────────────────────────────────────────────

interface DartFinInput {
  roe: number | null;
  opm: number | null;
  debtRatio: number | null;
  ocfRatio: number | null;
}

function calcFundamentalScore(
  dartFin: DartFinInput | null | undefined,
  per: number,
  regime: RegimeLevel,
): AxisScore {
  const factors: string[] = [];
  let score = 0;

  if (!dartFin) {
    // DART 미수집 → 중립
    return { score: 50, status: 'NEUTRAL', factors: ['DART미수집(중립)'] };
  }

  // ROE: +30/+20/+10
  if (dartFin.roe !== null) {
    if (dartFin.roe >= 15) {
      score += 30;
      factors.push(`ROE${dartFin.roe.toFixed(1)}%`);
    } else if (dartFin.roe >= 10) {
      score += 20;
      factors.push(`ROE${dartFin.roe.toFixed(1)}%`);
    } else if (dartFin.roe >= 5) {
      score += 10;
      factors.push(`ROE${dartFin.roe.toFixed(1)}%`);
    } else if (dartFin.roe < 0) {
      score -= 15;
      factors.push(`ROE적자`);
    }
  }

  // OPM (영업이익률): +25/+15, 적자: -20
  if (dartFin.opm !== null) {
    if (dartFin.opm >= 10) {
      score += 25;
      factors.push(`OPM${dartFin.opm.toFixed(1)}%`);
    } else if (dartFin.opm >= 5) {
      score += 15;
      factors.push(`OPM${dartFin.opm.toFixed(1)}%`);
    } else if (dartFin.opm >= 0) {
      score += 5;
    } else {
      score -= 20;
      factors.push('OPM적자');
    }
  }

  // 부채비율: +20/+10, 고부채: -10
  if (dartFin.debtRatio !== null) {
    if (dartFin.debtRatio <= 100) {
      score += 20;
      factors.push(`부채비${dartFin.debtRatio.toFixed(0)}%`);
    } else if (dartFin.debtRatio <= 150) {
      score += 10;
      factors.push(`부채비${dartFin.debtRatio.toFixed(0)}%`);
    } else if (dartFin.debtRatio > 200) {
      score -= 10;
      factors.push(`고부채${dartFin.debtRatio.toFixed(0)}%`);
    }
  }

  // OCF 비율: +15
  if (dartFin.ocfRatio !== null && dartFin.ocfRatio >= 1.0) {
    score += 15;
    factors.push('OCF양호');
  }

  // PER 밸류에이션 점수: +10/+5
  if (per > 0 && per <= 15) {
    score += 10;
    factors.push(`PER${per.toFixed(0)}`);
  } else if (per > 0 && per <= 25) {
    score += 5;
    factors.push(`PER${per.toFixed(0)}`);
  }

  // 레짐-펀더 융합: R6 방어 레짐에서 고배당·저부채 우대
  if ((regime === 'R5_CAUTION' || regime === 'R6_DEFENSE') && dartFin.debtRatio !== null && dartFin.debtRatio <= 100) {
    score += 10;
    factors.push('방어레짐적합');
  }

  return { score: clamp(score, 0, 100), status: axisStatus(score), factors };
}

// ── 축 4: 매크로 (0~100) ─────────────────────────────────────────────────────

const REGIME_BASE: Record<string, number> = {
  R1_TURBO:   90,
  R2_BULL:    75,
  R3_EARLY:   65,
  R4_NEUTRAL: 50,
  R5_CAUTION: 30,
  R6_DEFENSE: 15,
};

function calcMacroScore(macroState: MacroState | null, regime: RegimeLevel): AxisScore {
  const factors: string[] = [];
  let score = REGIME_BASE[regime] ?? 50;
  factors.push(`레짐${regime}`);

  if (!macroState) {
    return { score: clamp(score, 0, 100), status: axisStatus(score), factors: [...factors, 'MacroState없음'] };
  }

  // VKOSPI 보정
  if (macroState.vkospi !== undefined) {
    if (macroState.vkospi < 18) {
      score += 8;
      factors.push(`VKOSPI${macroState.vkospi.toFixed(0)}저점`);
    } else if (macroState.vkospi < 22) {
      score += 4;
    } else if (macroState.vkospi > 30) {
      score -= 12;
      factors.push(`VKOSPI${macroState.vkospi.toFixed(0)}고점`);
    } else if (macroState.vkospi > 25) {
      score -= 6;
    }
  }

  // MHS 보정
  if (macroState.mhs !== undefined) {
    if (macroState.mhs >= 70) {
      score += 8;
      factors.push(`MHS${macroState.mhs}GREEN`);
    } else if (macroState.mhs >= 55) {
      score += 3;
    } else if (macroState.mhs < 40) {
      score -= 15;
      factors.push(`MHS${macroState.mhs}RED`);
    }
  }

  // 외국인 선물 순매도 연속: 위험 신호
  if (macroState.foreignFuturesSellDays !== undefined && macroState.foreignFuturesSellDays >= 5) {
    score -= 10;
    factors.push(`선물매도${macroState.foreignFuturesSellDays}일`);
  }

  return { score: clamp(score, 0, 100), status: axisStatus(score), factors };
}

// ── 사이클 포지션 분류 ────────────────────────────────────────────────────────

function classifyCyclePosition(q: YahooQuoteExtended): CyclePosition {
  const rsiAccel = q.rsi14 - q.rsi5dAgo;

  // LATE: RSI 과열 또는 신고가 5% 초과
  if (q.rsi14 > 72 || (q.high20d > 0 && q.price > q.high20d * 1.05)) {
    return 'LATE';
  }

  // EARLY: RSI가 저점에서 가속 상승 중 (가장 유리한 진입)
  if (q.rsi14 >= 38 && q.rsi14 <= 58 && rsiAccel >= 4 && q.rsi5dAgo < 52) {
    return 'EARLY';
  }

  return 'MID';
}

// ── 촉매 등급 ─────────────────────────────────────────────────────────────────

function gradeCatalyst(
  technicalScore: number,
  dartFin: DartFinInput | null | undefined,
  kisFlow: KisFlowInput | null | undefined,
  gateScore: number,
): CatalystGrade {
  // A: 기술 강력 + 펀더 양호 + 수급 외국인 순매수
  const hasFundamental = dartFin && (dartFin.roe ?? 0) >= 10 && (dartFin.opm ?? 0) >= 5;
  const hasForeignBuy  = kisFlow && kisFlow.foreignNetBuy > 0;

  if (technicalScore >= 75 && (hasFundamental || hasForeignBuy) && gateScore >= 7) {
    return 'A';
  }

  // B: 기술 양호 또는 게이트 충분
  if (technicalScore >= 55 || gateScore >= 5) {
    return 'B';
  }

  return 'C';
}

// ── 멀티타임프레임 점수 (0~100) ───────────────────────────────────────────────

function calcMTFScore(q: YahooQuoteExtended): number {
  let score = 0;

  // 월봉 (MA60 대리): MA60 위이고 상승 추세
  if (q.price > q.ma60 && q.ma60TrendUp) score += 33;
  else if (q.price > q.ma60)             score += 20;

  // 주봉 (weeklyRSI 40~70 + MACD 히스토 양수)
  if (q.weeklyRSI >= 40 && q.weeklyRSI <= 70) score += 20;
  if (q.macdHistogram > 0)                     score += 14;

  // 일봉 (정배열 + RSI 건강구간)
  if (q.price > q.ma5 && q.ma5 > q.ma20) score += 20;
  if (q.rsi14 >= 40 && q.rsi14 <= 70)    score += 13;

  return clamp(score, 0, 100);
}

// ── 공개 API ─────────────────────────────────────────────────────────────────

export interface ConfluenceInput {
  quote:     YahooQuoteExtended;
  kisFlow?:  KisFlowInput | null;
  dartFin?:  DartFinInput | null;
  macroState?: MacroState | null;
  regime:    RegimeLevel;
  gateScore: number;
  kospiDayReturn?: number;
}

/**
 * 4축 컨플루언스 스코어링 실행.
 * Stage 2 통과 후 Stage 3 Gemini 전에 실행하여 HOLD 종목 사전 제거.
 */
export function runConfluenceEngine(input: ConfluenceInput): ConfluenceResult {
  const { quote: q, kisFlow, dartFin, macroState, regime, gateScore, kospiDayReturn } = input;

  const technicalAxis   = calcTechnicalScore(q);
  const supplyAxis      = calcSupplyScore(kisFlow, q, kospiDayReturn);
  const fundamentalAxis = calcFundamentalScore(dartFin, q.per, regime);
  const macroAxis       = calcMacroScore(macroState ?? null, regime);

  const axes = [technicalAxis, supplyAxis, fundamentalAxis, macroAxis];
  const bullishAxes = axes.filter(a => a.status === 'BULLISH').length;

  let signal: ConfluenceSignal;
  if (bullishAxes >= 4)      signal = 'CONFIRMED_STRONG_BUY';
  else if (bullishAxes >= 3) signal = 'BUY';
  else                       signal = 'HOLD';

  const cyclePosition = classifyCyclePosition(q);
  const catalystGrade = gradeCatalyst(technicalAxis.score, dartFin, kisFlow, gateScore);
  const mtfScore      = calcMTFScore(q);

  // 컨플루언스 최종 점수: 4축 가중 합산 (기술 30, 수급 30, 펀더 20, 매크로 20)
  const confluenceScore = clamp(
    technicalAxis.score   * 0.30 +
    supplyAxis.score      * 0.30 +
    fundamentalAxis.score * 0.20 +
    macroAxis.score       * 0.20,
    0, 100,
  );

  const cycleEmoji = cyclePosition === 'EARLY' ? '🌱' : cyclePosition === 'MID' ? '📈' : '⚠️';
  const signalLabel = signal === 'CONFIRMED_STRONG_BUY' ? 'STRONG_BUY' : signal;
  const summary =
    `${signalLabel} ${bullishAxes}/4축 | ` +
    `기술${technicalAxis.score}·수급${supplyAxis.score}·펀더${fundamentalAxis.score}·매크로${macroAxis.score} | ` +
    `${cycleEmoji}${cyclePosition} | 촉매${catalystGrade} | MTF${mtfScore}`;

  return {
    technicalAxis, supplyAxis, fundamentalAxis, macroAxis,
    bullishAxes, signal, cyclePosition, catalystGrade,
    mtfScore, confluenceScore: parseFloat(confluenceScore.toFixed(1)),
    summary,
  };
}
