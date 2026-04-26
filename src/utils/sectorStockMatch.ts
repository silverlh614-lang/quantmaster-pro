// @responsibility 섹터명 → 종목 리스트 매칭 순수 함수 (PR-K)

import type { StockRecommendation } from '../services/stockService';

/**
 * 종목의 relatedSectors 배열에서 섹터명 매칭 (정확 일치 + 대소문자 무시 부분 포함).
 *
 * 매칭 규칙 (우선순위):
 *   1. 정확 일치 (case-insensitive)
 *   2. relatedSectors 의 항목 중 sectorName 이 포함된 경우 (예: "조선" → "조선·해운")
 *
 * 빈 sectorName / null 종목 / 빈 relatedSectors → 매칭 안 됨.
 */
export function stockMatchesSector(
  stock: StockRecommendation | null | undefined,
  sectorName: string,
): boolean {
  if (!stock || !sectorName) return false;
  const sectors = stock.relatedSectors;
  if (!Array.isArray(sectors) || sectors.length === 0) return false;
  const target = sectorName.toLowerCase().trim();
  if (!target) return false;
  for (const s of sectors) {
    if (typeof s !== 'string') continue;
    const candidate = s.toLowerCase().trim();
    if (candidate === target) return true;
    if (candidate.includes(target)) return true;
    if (target.includes(candidate)) return true;
  }
  return false;
}

/**
 * 종목 배열에서 sectorName 에 매칭되는 항목만 반환. dedupe (code 기준).
 */
export function filterStocksBySector(
  stocks: ReadonlyArray<StockRecommendation>,
  sectorName: string,
): StockRecommendation[] {
  const seen = new Set<string>();
  const result: StockRecommendation[] = [];
  for (const s of stocks) {
    if (!s?.code || seen.has(s.code)) continue;
    if (stockMatchesSector(s, sectorName)) {
      seen.add(s.code);
      result.push(s);
    }
  }
  return result;
}
