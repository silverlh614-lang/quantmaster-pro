// @responsibility Yahoo 심볼 후보 + 가격·RSI 히스토리 비동기 조회 헬퍼
/**
 * exitEngine/helpers/priceHistory.ts — Yahoo 심볼 후보 + 가격/RSI 히스토리 (ADR-0028).
 *
 * ADR-0444 — yahooSymbolCandidates 의 `${c}.KS` / `${c}.KQ` direct concat 은
 * brute-force 양 시장 후보 배열 (KRX 마스터 미커버 종목 호환). yahooSymbolResolver
 * SSOT 위임 후속 ADR scope (historical fetcher 시그니처 부적합 — exitEngine 의
 * fetchCloses 가 양 시장 후보 자동 처리).
 */

import { fetchCloses } from '../../marketDataRefresh.js';
import { rsiSeries } from './rsiSeries.js';

/** stockCode → Yahoo Finance 심볼 후보 배열. */
export function yahooSymbolCandidates(stockCode: string): string[] {
  const c = stockCode.padStart(6, '0');
  // ADR-0444: brute-force 양 시장 후보 (마스터 부재 종목 그레이스 fallback).
  return [`${c}.KS`, `${c}.KQ`];
}

/** 최근 N일 종가와 그에 정렬된 RSI 시계열을 반환. 실패 시 null. */
export async function fetchPriceAndRsiHistory(
  stockCode: string,
  bars: number = 10,
): Promise<{ prices: number[]; rsi: number[] } | null> {
  // RSI 14 Wilder 평활화를 안정화하려면 최소 14 + bars 관측이 필요.
  const minNeeded = 14 + bars;
  for (const sym of yahooSymbolCandidates(stockCode)) {
    const closes = await fetchCloses(sym, '60d').catch(() => null);
    if (!closes || closes.length < minNeeded) continue;
    const fullRsi = rsiSeries(closes, 14);
    if (fullRsi.length < bars) continue;
    const prices = closes.slice(-bars);
    const rsi    = fullRsi.slice(-bars);
    return { prices, rsi };
  }
  return null;
}
