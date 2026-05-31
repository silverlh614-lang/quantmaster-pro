// @responsibility Naver 일봉 차트/52주 peak 클라이언트 — KR 차트 정본 (Yahoo stale 대체)
/**
 * Naver 모바일 일봉(`/api/naver/daily`) 클라이언트.
 *
 * 한국 종목은 Yahoo 절대값이 stale 심함 → 차트 봉·52주 peak 의 정본 소스로 Naver 사용.
 * Naver 는 KIS 와 달리 **장외 시간에도 가용**하므로 off-hours 표시에 유리하다.
 * 응답은 Yahoo 호환 형태({timestamp, indicators.quote[0]})라 extractValidChartData 가 그대로 소비.
 *
 * 모듈 캐시(5분) — 같은 종목의 차트 fetch 와 peak fetch 가 1회 outbound 만 발생하도록 coalescing.
 * 실패(204/네트워크)는 null 로 흡수 → 호출자가 Yahoo fallback(차트) 또는 '—'(peak) 결정.
 */
import type { HistoricalDataResult } from './historicalData';

const TTL_MS = 5 * 60 * 1000;
const _cache = new Map<string, { result: HistoricalDataResult | null; expiresAt: number }>();

// 거래일 기준 대략치 (3mo≈66·6mo≈132·1y≈264). 52주 peak 은 '1y'.
const RANGE_TO_COUNT: Record<string, number> = { '3mo': 66, '6mo': 132, '1y': 264 };

function baseCodeOf(code: string): string | null {
  const base = String(code).split('.')[0];
  return /^\d{6}$/.test(base) ? base : null;
}

export async function fetchNaverDailyChart(code: string, range = '1y'): Promise<HistoricalDataResult | null> {
  const base = baseCodeOf(code);
  if (!base) return null;
  const count = RANGE_TO_COUNT[range] ?? 264;
  const key = `${base}:${count}`;
  const now = Date.now();
  const cached = _cache.get(key);
  if (cached && cached.expiresAt > now) return cached.result;

  let result: HistoricalDataResult | null = null;
  try {
    const res = await fetch(`/api/naver/daily?code=${base}&count=${count}`);
    if (res.ok) {
      const data = await res.json();
      result = Array.isArray(data?.timestamp) && data.timestamp.length > 0 ? { data, meta: {} } : null;
    }
    // 204(데이터 없음)·기타 → result=null → 호출자 fallback
  } catch {
    result = null;
  }
  _cache.set(key, { result, expiresAt: now + TTL_MS });
  return result;
}

/** 52주(1년) 최고가 — Naver 일봉 highs 의 최댓값. 장외에도 가용. 실패 시 null. */
export async function fetchNaverPeak(code: string): Promise<number | null> {
  const chart = await fetchNaverDailyChart(code, '1y');
  const highs: unknown = chart?.data?.indicators?.quote?.[0]?.high;
  if (!Array.isArray(highs)) return null;
  const valid = highs.filter((h): h is number => typeof h === 'number' && Number.isFinite(h) && h > 0);
  return valid.length > 0 ? Math.max(...valid) : null;
}

export interface NaverSupplyDetail {
  foreignNet: number;
  institutionNet: number;
  individualNet: number;
  foreignConsecutive: number;
  isPassiveAndActive: boolean;
  foreignerOwnRatio?: number;
  dataSource: 'NAVER';
}

/** 외국인/기관 5일 순매수 (Naver frgn.naver, 장외 가용). 실패 시 null → KIS fallback. */
export async function fetchNaverSupply(code: string): Promise<NaverSupplyDetail | null> {
  const base = baseCodeOf(code);
  if (!base) return null;
  try {
    const res = await fetch(`/api/naver/supply?code=${base}`);
    if (res.status === 204 || !res.ok) return null;
    const data = await res.json();
    return data && data.dataSource === 'NAVER' ? (data as NaverSupplyDetail) : null;
  } catch {
    return null;
  }
}

/** 테스트·진단용 캐시 초기화. */
export function resetNaverDailyCache(): void {
  _cache.clear();
}
