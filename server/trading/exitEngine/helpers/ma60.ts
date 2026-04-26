// @responsibility MA20·MA60 역배열 판정 + 영업일 계산 + Yahoo 종가 조회 헬퍼
/**
 * exitEngine/helpers/ma60.ts — 60일선 죽음 판정 + KST 영업일 + 120일 종가 fetch (ADR-0028).
 */

import { fetchCloses } from '../../marketDataRefresh.js';
import { yahooSymbolCandidates } from './priceHistory.js';

/**
 * 60일선 "죽음" 판정 — 현재가 < MA20 < MA60 (역배열 완성).
 * "주도주 사이클 종료" 신호로, 좀비 포지션을 장기 보유하지 않기 위한 강제 청산 트리거.
 *
 * @returns 역배열 완성 시 true
 */
export function isMA60Death(ma20: number, ma60: number, currentPrice: number): boolean {
  return currentPrice < ma20 && ma20 < ma60;
}

/** 단순이동평균. closes.length < period 이면 null. */
function simpleMA(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  return slice.reduce((s, v) => s + v, 0) / period;
}

/** KST 기준 N영업일(토·일 제외) 이후의 날짜 YYYY-MM-DD 반환. */
export function kstBusinessDateStr(offsetBusinessDays: number): string {
  const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
  let daysLeft = offsetBusinessDays;
  let cursor = new Date(Date.now() + KST_OFFSET_MS);
  while (daysLeft > 0) {
    cursor = new Date(cursor.getTime() + 86_400_000);
    const dow = cursor.getUTCDay(); // KST offset 이미 반영됨
    if (dow !== 0 && dow !== 6) daysLeft -= 1;
  }
  return cursor.toISOString().slice(0, 10);
}

/** stockCode → MA20·MA60 계산에 충분한 120일 종가 조회 후 (ma20, ma60) 반환. */
export async function fetchMaFromCloses(stockCode: string): Promise<{ ma20: number; ma60: number } | null> {
  for (const sym of yahooSymbolCandidates(stockCode)) {
    const closes = await fetchCloses(sym, '120d').catch(() => null);
    if (!closes || closes.length < 60) continue;
    const ma20 = simpleMA(closes, 20);
    const ma60 = simpleMA(closes, 60);
    if (ma20 !== null && ma60 !== null) return { ma20, ma60 };
  }
  return null;
}
