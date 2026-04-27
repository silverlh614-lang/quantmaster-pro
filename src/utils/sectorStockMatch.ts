// @responsibility 섹터명 → 종목 리스트 매칭 순수 함수 (PR-K + ADR-0060)

import type { StockRecommendation } from '../services/stockService';

/**
 * 매칭 후보 — relatedSectors 다중 라벨 (StockRecommendation) 또는 sector 단일 라벨
 * (ShadowTrade-shaped). 두 축이 공존하며 우선순위는 relatedSectors 우선이다.
 */
type SectorMatchable =
  | (Partial<Pick<StockRecommendation, 'relatedSectors'>> & { sector?: unknown })
  | null
  | undefined;

function isCaseInsensitiveSectorMatch(candidate: string, target: string): boolean {
  const c = candidate.toLowerCase().trim();
  if (!c) return false;
  if (c === target) return true;
  if (c.includes(target)) return true;
  if (target.includes(c)) return true;
  return false;
}

/**
 * 종목의 섹터 매칭 — 양방향 fallback (ADR-0060 §3.1).
 *
 * 매칭 규칙 (우선순위):
 *   1. relatedSectors 배열 매칭 (정확 일치 + case-insensitive 부분 포함 양방향).
 *   2. fallback — stock.sector 단일 필드 (case-insensitive 정확/부분 포함 양방향).
 *
 * - 우선순위 1 가 매칭되면 즉시 true. relatedSectors 가 비어있거나 미매칭이면 fallback.
 * - ShadowTrade-shaped 객체는 relatedSectors 미보유 → 자연스럽게 sector 단일 fallback 만 사용.
 *
 * 빈 sectorName / null 종목 → 매칭 안 됨.
 */
export function stockMatchesSector(
  stock: SectorMatchable,
  sectorName: string,
): boolean {
  if (!stock || !sectorName) return false;
  const target = sectorName.toLowerCase().trim();
  if (!target) return false;

  // 1. relatedSectors 우선 매칭 (StockRecommendation AI 다중 라벨)
  const sectors = (stock as { relatedSectors?: unknown }).relatedSectors;
  if (Array.isArray(sectors) && sectors.length > 0) {
    for (const s of sectors) {
      if (typeof s !== 'string') continue;
      if (isCaseInsensitiveSectorMatch(s, target)) return true;
    }
  }

  // 2. fallback — stock.sector 단일 필드 (ShadowTrade-shaped, ADR-0060 박제값)
  const single = (stock as { sector?: unknown }).sector;
  if (typeof single === 'string' && single.length > 0) {
    if (isCaseInsensitiveSectorMatch(single, target)) return true;
  }

  return false;
}

/**
 * 종목 배열에서 sectorName 에 매칭되는 항목만 반환. dedupe (code 기준).
 *
 * StockRecommendation-shaped subset 도 허용 — code 가 있으면 dedupe 키로 사용한다
 * (예: ShadowTrade 를 카드 형태로 변환한 객체).
 */
export function filterStocksBySector<T extends { code?: string } & SectorMatchable>(
  stocks: ReadonlyArray<T>,
  sectorName: string,
): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const s of stocks) {
    if (!s?.code || seen.has(s.code)) continue;
    if (stockMatchesSector(s, sectorName)) {
      seen.add(s.code);
      result.push(s);
    }
  }
  return result;
}
