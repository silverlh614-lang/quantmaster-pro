/**
 * @responsibility Google Custom Search JSON API 단일 통로 — 도메인 화이트리스트 + 예산 가드 (ADR-0011, PR-25-A)
 *
 * AI 추천 universe 발굴 전용. 자동매매 경로는 호출 금지. 도메인 화이트리스트로
 * 한국 금융 공식 출처만 제한. aiCallBudgetRepo `google_search` bucket 으로
 * 일일 호출 한도(기본 80) 가드.
 */

import { tryConsume, getRemaining } from '../persistence/aiCallBudgetRepo.js';

export const KOREAN_FINANCE_WHITELIST = [
  'm.stock.naver.com',
  'finance.naver.com',
  'hankyung.com',
  'mk.co.kr',
  'sedaily.com',
  'infostock.co.kr',
];

export interface GoogleSearchItem {
  title: string;
  link: string;
  snippet: string;
  displayLink: string;
}

export interface GoogleSearchResponse {
  items: GoogleSearchItem[];
  totalResults: number;
  source: 'GOOGLE_CSE' | 'BUDGET_EXCEEDED' | 'NOT_CONFIGURED' | 'ERROR';
}

const API_ENDPOINT = 'https://customsearch.googleapis.com/customsearch/v1';

function isConfigured(): boolean {
  return Boolean(process.env.GOOGLE_SEARCH_API_KEY && process.env.GOOGLE_SEARCH_CX);
}

/**
 * 도메인 화이트리스트를 `siteSearch` 가 아닌 OR 쿼리로 강제.
 * (siteSearch 는 단일 도메인만 허용 — 화이트리스트 다중 도메인을 위해 쿼리 OR 사용.)
 */
function buildWhitelistQuery(query: string, whitelist: string[]): string {
  const sites = whitelist.map((d) => `site:${d}`).join(' OR ');
  return `${query} (${sites})`;
}

/**
 * Google Custom Search 호출 — 예산 가드·도메인 화이트리스트 적용.
 *
 * @param query 한국어 검색 쿼리 (예: "오늘 급등주", "2차전지 주도주")
 * @param options.num 결과 개수 (기본 5, 최대 10)
 * @param options.whitelist 도메인 화이트리스트 (기본 KOREAN_FINANCE_WHITELIST)
 */
export async function googleSearch(
  query: string,
  options: { num?: number; whitelist?: string[] } = {},
): Promise<GoogleSearchResponse> {
  const num = Math.min(Math.max(options.num ?? 5, 1), 10);
  const whitelist = options.whitelist ?? KOREAN_FINANCE_WHITELIST;

  if (!isConfigured()) {
    return { items: [], totalResults: 0, source: 'NOT_CONFIGURED' };
  }

  if (!tryConsume('google_search', 1)) {
    console.warn(`[GoogleSearch] 일일 예산 초과 — query 차단: "${query.slice(0, 40)}"`);
    return { items: [], totalResults: 0, source: 'BUDGET_EXCEEDED' };
  }

  const url = new URL(API_ENDPOINT);
  url.searchParams.set('key', process.env.GOOGLE_SEARCH_API_KEY!);
  url.searchParams.set('cx', process.env.GOOGLE_SEARCH_CX!);
  url.searchParams.set('q', buildWhitelistQuery(query, whitelist));
  url.searchParams.set('num', String(num));
  url.searchParams.set('hl', 'ko');
  url.searchParams.set('gl', 'kr');

  try {
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      console.warn(`[GoogleSearch] HTTP ${res.status} — query: "${query.slice(0, 40)}"`);
      return { items: [], totalResults: 0, source: 'ERROR' };
    }
    const data = await res.json() as {
      items?: Array<{ title: string; link: string; snippet: string; displayLink: string }>;
      searchInformation?: { totalResults?: string };
    };
    const items: GoogleSearchItem[] = (data.items ?? []).map((it) => ({
      title: it.title ?? '',
      link: it.link ?? '',
      snippet: it.snippet ?? '',
      displayLink: it.displayLink ?? '',
    }));
    const totalResults = Number(data.searchInformation?.totalResults ?? items.length) || items.length;
    return { items, totalResults, source: 'GOOGLE_CSE' };
  } catch (e) {
    console.warn(`[GoogleSearch] fetch 실패: ${e instanceof Error ? e.message : e}`);
    return { items: [], totalResults: 0, source: 'ERROR' };
  }
}

/**
 * 디버깅용 — 현재 google_search bucket 의 잔여 호출 수.
 */
export function getRemainingGoogleSearchQuota(): number {
  return getRemaining('google_search');
}

// 테스트 전용 — 화이트리스트 쿼리 빌더 검증
export const __testOnly = {
  buildWhitelistQuery,
  isConfigured,
};
