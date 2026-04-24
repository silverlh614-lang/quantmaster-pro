/**
 * @responsibility Naver Finance 모바일 API 단일 통로 — AI 추천 enrichment 무비용 소스 (ADR-0011, PR-25-A)
 *
 * 비공식이지만 m.stock.naver.com 모바일 앱이 사용하는 안정 endpoint. KIS/KRX
 * 자동매매 quota 침범 없이 종목 현재가·PER/PBR·시총·외인비율을 무료로 조회한다.
 * 자동매매 경로는 호출 금지 — 이 모듈은 AI 추천 경로 전용.
 */

import { tryConsume } from '../persistence/aiCallBudgetRepo.js';

const NAVER_BASE = 'https://m.stock.naver.com/api/stock';
const TIMEOUT_MS = 6000;

export interface NaverStockSnapshot {
  code: string;
  name: string;
  closePrice: number;
  changeRate: number;
  marketCap: number;
  per: number;
  pbr: number;
  eps: number;
  bps: number;
  dividendYield: number;
  foreignerOwnRatio: number;
  source: 'NAVER_MOBILE';
}

const HEADERS = {
  'Accept': 'application/json',
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  'Referer': 'https://m.stock.naver.com/',
};

function parseNumber(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const cleaned = v.replace(/,/g, '').replace(/%$/, '').trim();
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/**
 * 종목 단건 스냅샷. 6자리 코드 검증 + 예산 가드.
 * 실패 시 null 반환 (호출자가 fallback 결정).
 */
export async function fetchNaverStockSnapshot(code: string): Promise<NaverStockSnapshot | null> {
  if (!/^\d{6}$/.test(code)) return null;
  if (!tryConsume('naver_finance', 1)) return null;

  const url = `${NAVER_BASE}/${code}/integration`;
  try {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) {
      if (res.status !== 404) {
        console.warn(`[NaverFinance] HTTP ${res.status} for ${code}`);
      }
      return null;
    }
    const data = await res.json() as Record<string, any>;
    const stockEnd = data.stockEndType ?? '';
    const dealTrendInfos = data.dealTrendInfos?.[0] ?? {};
    const totalInfos = data.totalInfos ?? [];
    const findInfo = (key: string): unknown => {
      const hit = totalInfos.find((t: any) => t?.code === key);
      return hit?.value ?? null;
    };

    return {
      code,
      name: data.stockName ?? '',
      closePrice: parseNumber(data.closePrice ?? dealTrendInfos.closePrice),
      changeRate: parseNumber(data.fluctuationsRatio ?? dealTrendInfos.fluctuationsRatio),
      marketCap: parseNumber(findInfo('marketValue')),
      per: parseNumber(findInfo('per')),
      pbr: parseNumber(findInfo('pbr')),
      eps: parseNumber(findInfo('eps')),
      bps: parseNumber(findInfo('bps')),
      dividendYield: parseNumber(findInfo('dividendRatio')),
      foreignerOwnRatio: parseNumber(findInfo('foreignerOwnRatio')),
      source: 'NAVER_MOBILE',
    };
    void stockEnd;
  } catch (e) {
    console.warn(`[NaverFinance] fetch 실패 ${code}: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

/**
 * 다중 종목 enrichment — 병렬 4건 제한.
 */
export async function fetchNaverStockSnapshots(codes: string[]): Promise<Map<string, NaverStockSnapshot>> {
  const out = new Map<string, NaverStockSnapshot>();
  const queue = codes.filter((c) => /^\d{6}$/.test(c));
  const CONCURRENCY = 4;
  async function worker(): Promise<void> {
    while (queue.length > 0) {
      const code = queue.shift();
      if (!code) return;
      const snap = await fetchNaverStockSnapshot(code);
      if (snap) out.set(code, snap);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  return out;
}

// 테스트 전용 — parseNumber 검증
export const __testOnly = {
  parseNumber,
};
