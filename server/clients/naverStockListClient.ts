/**
 * @responsibility Naver 모바일 시총 상위 fetch — Tier 2 fallback (ADR-0013)
 *
 * KRX CSV 가 검증 실패할 때 KOSPI/KOSDAQ 시총 상위 200개를 보강용 universe 로
 * 사용한다. m.stock.naver.com/api/stocks/marketValue 비공식 endpoint. AI 추천
 * quota 와 별개 — 본 모듈은 multiSourceStockMaster 만 호출한다.
 */

import type { StockMasterEntry } from '../persistence/krxStockMasterRepo.js';

const NAVER_BASE = 'https://m.stock.naver.com/api/stocks';
const TIMEOUT_MS = 7000;
const PAGE_SIZE = 100;
const MAX_PAGES_PER_MARKET = 2;

const HEADERS = {
  'Accept': 'application/json',
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  'Referer': 'https://m.stock.naver.com/',
};

interface NaverMarketStock {
  itemCode?: string;
  reutersCode?: string;
  stockName?: string;
  stockNameEng?: string;
}

async function fetchPage(market: 'KOSPI' | 'KOSDAQ', page: number): Promise<NaverMarketStock[]> {
  const url = `${NAVER_BASE}/marketValue/${market}?page=${page}&pageSize=${PAGE_SIZE}`;
  try {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) {
      console.warn(`[NaverStockList] HTTP ${res.status} for ${market} page=${page}`);
      return [];
    }
    const data = await res.json() as { stocks?: NaverMarketStock[] } | NaverMarketStock[];
    if (Array.isArray(data)) return data;
    return data.stocks ?? [];
  } catch (e) {
    console.warn(`[NaverStockList] fetch 실패 ${market} page=${page}: ${e instanceof Error ? e.message : e}`);
    return [];
  }
}

function normalizeCode(raw: string | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/^[A-Z]+/, '').trim();
  return /^\d{6}$/.test(cleaned) ? cleaned : null;
}

/**
 * KOSPI + KOSDAQ 시총 상위 fetch.
 * 한 시장당 PAGE_SIZE × MAX_PAGES_PER_MARKET = 200건. 두 시장 합 약 400건.
 * 응답이 비어있거나 검증 실패하면 빈 배열 반환 (호출자가 다음 tier 로 폴백).
 */
export async function fetchNaverMarketLeaders(): Promise<StockMasterEntry[]> {
  const out: StockMasterEntry[] = [];
  const seen = new Set<string>();

  for (const market of ['KOSPI', 'KOSDAQ'] as const) {
    for (let page = 1; page <= MAX_PAGES_PER_MARKET; page++) {
      const items = await fetchPage(market, page);
      if (items.length === 0) break;
      for (const it of items) {
        const code = normalizeCode(it.itemCode ?? it.reutersCode);
        const name = (it.stockName ?? '').trim();
        if (!code || !name) continue;
        if (seen.has(code)) continue;
        seen.add(code);
        out.push({ code, name, market });
      }
    }
  }

  return out;
}

export const __testOnly = {
  normalizeCode,
  PAGE_SIZE,
  MAX_PAGES_PER_MARKET,
};
