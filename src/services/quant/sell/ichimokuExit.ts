/**
 * sell/ichimokuExit.ts — L5 일목균형표 이탈 감지기
 *
 * 3개 독립 서브 트리거 중 가장 강한 신호 하나만 반환:
 *   ① 구름대 하단을 2거래일 연속 이탈          → 30%
 *   ② 후행스팬이 26봉 전 종가를 하향 돌파       → 50%
 *   ③ 기준선·전환선 데드크로스 + 구름대 이탈    → 전량
 *
 * 입력: 최소 52봉의 OHLC 캔들.
 */

import type { ActivePosition, OHLCCandle, SellSignal } from '../../../types/sell';

interface IchimokuSeries {
  tenkan: readonly number[];
  kijun: readonly number[];
  senkouA: readonly number[];
  senkouB: readonly number[];
  closes: readonly number[];
}

function periodHighLow(candles: readonly OHLCCandle[], period: number): number[] {
  if (candles.length < period) return [];
  const out: number[] = [];
  for (let i = period - 1; i < candles.length; i++) {
    let hi = -Infinity;
    let lo = +Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (candles[j].high > hi) hi = candles[j].high;
      if (candles[j].low  < lo) lo = candles[j].low;
    }
    out.push((hi + lo) / 2);
  }
  return out;
}

/**
 * 현재 시점 기준으로 정렬된 일목 시계열을 반환.
 * senkouA/B는 26봉 전 계산값이 현재로 투영된 값이므로, 초반 25봉은 NaN.
 */
export function computeIchimokuSeries(candles: readonly OHLCCandle[]): IchimokuSeries | null {
  if (candles.length < 52) return null;

  const tenkanAll  = periodHighLow(candles, 9);   // index 0 = candles[8]
  const kijunAll   = periodHighLow(candles, 26);  // index 0 = candles[25]
  const senkouBAll = periodHighLow(candles, 52);  // index 0 = candles[51]
  const closes = candles.map(c => c.close);

  const seriesLen = senkouBAll.length;
  const senkouA: number[] = [];
  const senkouB: number[] = [];
  for (let i = 0; i < seriesLen; i++) {
    const projectedIdx = (i + 51) - 26;
    if (projectedIdx < 25) { senkouA.push(NaN); senkouB.push(NaN); continue; }
    const tenkanVal  = tenkanAll[projectedIdx - 8];
    const kijunVal   = kijunAll[projectedIdx - 25];
    const senkouBVal = senkouBAll[projectedIdx - 51];
    senkouA.push((tenkanVal + kijunVal) / 2);
    senkouB.push(senkouBVal);
  }

  return {
    tenkan:  tenkanAll.slice(-seriesLen),
    kijun:   kijunAll.slice(-seriesLen),
    senkouA,
    senkouB,
    closes:  closes.slice(-seriesLen),
  };
}

// ─── 독립 서브 트리거 ─────────────────────────────────────────────────────────

/** ① 마지막 2봉의 종가가 모두 구름대 하단(min(spanA,spanB)) 아래. */
export function detectCloudBreakdown(series: IchimokuSeries): boolean {
  const n = series.closes.length;
  if (n < 2) return false;
  for (let i = n - 2; i <= n - 1; i++) {
    const spanA = series.senkouA[i];
    const spanB = series.senkouB[i];
    if (!Number.isFinite(spanA) || !Number.isFinite(spanB)) return false;
    if (series.closes[i] >= Math.min(spanA, spanB)) return false;
  }
  return true;
}

/**
 * ② 후행스팬(현재 종가)이 26봉 전 종가를 새로 하향 돌파한 상태.
 * 전일에는 chikou_prev ≥ close_{-27}였는데 오늘 chikou_now < close_{-26}이면 신선 돌파.
 */
export function detectChikouBreakdown(series: IchimokuSeries): boolean {
  const n = series.closes.length;
  if (n < 28) return false;
  const chikouNow   = series.closes[n - 1];
  const close26Ago  = series.closes[n - 27];
  const chikouPrev  = series.closes[n - 2];
  const close27Ago  = series.closes[n - 28];
  return chikouPrev >= close27Ago && chikouNow < close26Ago;
}

/** ③ 전환선이 기준선을 하향 돌파 + 종가가 구름대 아래. */
export function detectTkDeathWithCloudExit(series: IchimokuSeries): boolean {
  const n = series.closes.length;
  if (n < 2) return false;
  const deathCross = series.tenkan[n - 2] >= series.kijun[n - 2]
                  && series.tenkan[n - 1] <  series.kijun[n - 1];

  const spanA = series.senkouA[n - 1];
  const spanB = series.senkouB[n - 1];
  if (!Number.isFinite(spanA) || !Number.isFinite(spanB)) return false;
  const belowCloud = series.closes[n - 1] < Math.min(spanA, spanB);
  return deathCross && belowCloud;
}

// ─── 통합 Exit 판정 ──────────────────────────────────────────────────────────

export function evaluateIchimokuExit(
  position: ActivePosition,
  candles: readonly OHLCCandle[] | undefined,
): SellSignal | null {
  if (!candles || candles.length < 52) return null;
  const series = computeIchimokuSeries(candles);
  if (!series) return null;

  if (detectTkDeathWithCloudExit(series)) {
    return {
      action: 'ICHIMOKU_EXIT',
      ratio: 1.0,
      orderType: 'MARKET',
      severity: 'CRITICAL',
      reason: '일목 데드크로스 + 구름대 하단 이탈 동시 발생. 전량 청산.',
    };
  }

  if (detectChikouBreakdown(series)) {
    return {
      action: 'ICHIMOKU_EXIT',
      ratio: 0.50,
      orderType: 'LIMIT',
      price: position.currentPrice,
      severity: 'HIGH',
      reason: '후행스팬이 26봉 전 종가를 하향 돌파. 50% 매도.',
    };
  }

  if (detectCloudBreakdown(series)) {
    return {
      action: 'ICHIMOKU_EXIT',
      ratio: 0.30,
      orderType: 'LIMIT',
      price: position.currentPrice,
      severity: 'MEDIUM',
      reason: '종가가 구름대 하단을 2거래일 연속 이탈. 30% 매도.',
    };
  }

  return null;
}
