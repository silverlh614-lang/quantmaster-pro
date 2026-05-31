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

/**
 * 단기 negative cache — Naver 가 특정 종목코드에 대해 4xx(409 throttle, 404 없음, 410 폐지)
 * 를 반환하면 5분간 재시도 차단. 일일 예산이 같은 실패 코드로 반복 소진되는 것을 방지하고
 * 스케줄러 cron 의 매 호출 사이클에서 동일 실패를 누적하지 않도록 한다.
 */
const NEGATIVE_TTL_MS = 5 * 60 * 1000;
const _negativeCache = new Map<string, number>();

function isNegativelyCached(code: string): boolean {
  const expiresAt = _negativeCache.get(code);
  if (!expiresAt) return false;
  if (expiresAt <= Date.now()) {
    _negativeCache.delete(code);
    return false;
  }
  return true;
}

function recordNegative(code: string): void {
  _negativeCache.set(code, Date.now() + NEGATIVE_TTL_MS);
  // 메모리 가드 — 200건 초과 시 만료된 것 정리
  if (_negativeCache.size > 200) {
    const now = Date.now();
    for (const [k, v] of _negativeCache.entries()) {
      if (v <= now) _negativeCache.delete(k);
    }
  }
}

/** 테스트 전용 — negative cache 초기화. */
export function resetNaverNegativeCache(): void {
  _negativeCache.clear();
}

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
 * 종목 단건 스냅샷. 6자리 코드 검증 + 예산 가드 + 5분 negative cache.
 * 실패 시 null 반환 (호출자가 fallback 결정).
 */
export async function fetchNaverStockSnapshot(code: string): Promise<NaverStockSnapshot | null> {
  if (!/^\d{6}$/.test(code)) return null;
  // 직전 4xx 실패가 5분 이내면 outbound 자체 스킵 — 예산 보존.
  if (isNegativelyCached(code)) return null;
  if (!tryConsume('naver_finance', 1)) return null;

  const url = `${NAVER_BASE}/${code}/integration`;
  try {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) {
      // 4xx 는 종목 자체 문제(폐지/잘못된 코드/throttle) 일 가능성이 높아 negative cache 적용.
      // 5xx 는 일시 장애로 판단하여 캐시하지 않음.
      if (res.status >= 400 && res.status < 500) {
        recordNegative(code);
      }
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

    // closePrice 필드 우선순위 — dealTrendInfos[0] (최근 거래일별 record) 가
    // 권위 있는 값. top-level `data.closePrice` 는 기준가/예전값 의미가 모호해
    // 종목별로 stale 가능 (SK하이닉스 000660 ₩1.86M vs 실제 5/29 종가 ₩2.33M
    // 케이스 — 사용자 보고). top-level 은 dealTrendInfos 부재 시 fallback 만.
    const dealCp = parseNumber(dealTrendInfos.closePrice);
    const topCp = parseNumber(data.closePrice);
    const closePrice = dealCp > 0 ? dealCp : topCp;
    const dealCr = parseNumber(dealTrendInfos.fluctuationsRatio);
    const topCr = parseNumber(data.fluctuationsRatio);
    const changeRate = dealCp > 0 ? dealCr : topCr; // closePrice 동일 출처 정합
    // 두 필드 동시 존재 + 5% 이상 괴리 시 진단 로그 (Naver 측 캐시·필드 의미 변경 감지)
    if (dealCp > 0 && topCp > 0 && Math.abs(dealCp - topCp) / dealCp > 0.05) {
      console.warn(`[NaverFinance] closePrice 괴리 ${code}: dealTrendInfos=${dealCp} top=${topCp} (dealTrendInfos 채택)`);
    }

    return {
      code,
      name: data.stockName ?? '',
      closePrice,
      changeRate,
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
