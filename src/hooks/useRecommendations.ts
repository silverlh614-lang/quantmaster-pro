// @responsibility useRecommendations React hook
/**
 * useRecommendations — Phase 5-⑬ 리프 노드 분해 템플릿.
 *
 * useQuantRecommendations 가 수행하던 (i) 필터링 (ii) 정렬 (iii) 파생 리스트
 * 생성 로직을 순수 훅으로 추출. 사이드이펙트 없이 Zustand 스토어만 읽어서
 * 파생 상태를 반환한다.
 *
 * 테스트 용이성: 순수 파생 로직이므로 store 를 mocking 하거나 selectStore 를
 * 주입받아 단독 검증 가능. App.tsx 7,500 라인 분해 작업의 템플릿으로 사용한다.
 */

import { useMemo } from 'react';
import type { StockRecommendation } from '../services/stockService';

type RecommendationSort = 'NAME' | 'CODE' | 'PERFORMANCE' | 'NONE';
type RecommendationView = 'DISCOVER' | 'WATCHLIST' | string;

export interface RecommendationFilterInput {
  recommendations: StockRecommendation[];
  searchResults: StockRecommendation[];
  watchlist: StockRecommendation[];
  selectedType: string;
  selectedPattern: string;
  selectedSentiment: string;
  selectedChecklist: string[];
  searchQuery: string;
  /** 마지막 '시장 검색' 실행 검색어(trim). 미지정 시 '' 로 간주. */
  lastSearchedQuery?: string;
  minPrice: string | number;
  maxPrice: string | number;
  sortBy: RecommendationSort;
  view: RecommendationView;
}

function matchesFilters(
  stock: StockRecommendation,
  p: RecommendationFilterInput,
  searchResultCodes: Set<string>,
): boolean {
  const typeMatch = p.selectedType === 'ALL' || stock.type === p.selectedType;
  const patternMatch = p.selectedPattern === 'ALL' || (stock.patterns || []).includes(p.selectedPattern);
  const sentimentMatch = p.selectedSentiment === 'ALL' ||
    (p.selectedSentiment === 'RISK_ON' && (stock.marketSentiment?.iri ?? 0) < 2.0) ||
    (p.selectedSentiment === 'RISK_OFF' && (stock.marketSentiment?.iri ?? 0) >= 2.0);
  const checklistMatch = p.selectedChecklist.length === 0 ||
    p.selectedChecklist.every((item) => stock.checklist?.[item as keyof typeof stock.checklist]);
  const minP = typeof p.minPrice === 'string' ? (p.minPrice === '' ? 0 : parseInt(p.minPrice)) : p.minPrice;
  const maxP = typeof p.maxPrice === 'string' ? (p.maxPrice === '' ? Infinity : parseInt(p.maxPrice)) : p.maxPrice;
  const priceMatch = (stock.currentPrice ?? 0) >= minP && (stock.currentPrice ?? 0) <= maxP;
  // 검색어는 trim 후 비교 — 입력창 앞/뒤 공백("삼성전자 ")으로 매칭이 깨지던 버그 차단
  // (AI 시장검색은 query.trim() 사용하던 것과 일관화).
  const q = (p.searchQuery ?? '').trim();
  const ql = q.toLowerCase();
  const nameLower = stock.name?.toLowerCase() ?? '';
  const matchesText = q === '' || nameLower.includes(ql) || (stock.code?.includes(q) ?? false);
  // searchResults(시장검색 결과)는 '그 검색을 실행한 검색어' 그대로일 때만(또는 입력이 비었을 때만)
  // 텍스트 매칭을 우회해 노출 — 테마 검색(이름에 검색어가 없는 결과)을 보존하면서도,
  // 사용자가 입력창에 '다른' 검색어를 타이핑해 좁히면 결과에도 텍스트 필터가 적용되도록 한다.
  const lastQ = (p.lastSearchedQuery ?? '').trim();
  const isCurrentSearchResult = searchResultCodes.has(stock.code) && (q === '' || q === lastQ);
  const searchMatch = isCurrentSearchResult || matchesText;
  return typeMatch && patternMatch && sentimentMatch && checklistMatch && searchMatch && priceMatch;
}

function sortList(list: StockRecommendation[], sortBy: RecommendationSort): StockRecommendation[] {
  if (sortBy === 'NONE') return list;
  const arr = [...list];
  arr.sort((a, b) => {
    if (sortBy === 'NAME') return (a.name || '').localeCompare(b.name || '');
    if (sortBy === 'CODE') return (a.code || '').localeCompare(b.code || '');
    if (sortBy === 'PERFORMANCE') {
      const getPerf = (s: StockRecommendation): number => {
        if (s.currentPrice > 0 && s.entryPrice && s.entryPrice > 0) return (s.currentPrice / s.entryPrice) - 1;
        if (s.peakPrice > 0) return (s.currentPrice / s.peakPrice) - 1;
        return -Infinity;
      };
      return getPerf(b) - getPerf(a);
    }
    return 0;
  });
  return arr;
}

export interface UseRecommendationsResult {
  filteredRecommendations: StockRecommendation[];
  displayList: StockRecommendation[];
  allPatterns: string[];
}

/**
 * 단일 원장 — 필터/정렬/파생 리스트 계산의 SSOT. 사이드이펙트 없음.
 * useRecommendations(훅)·computeRecommendationsDerived(테스트)·useQuantRecommendations
 * 가 모두 이 함수를 거친다 — 과거 동일 로직이 3중 복제돼 searchMatch 규칙이 drift 하던
 * 문제를 차단(한 곳만 고치면 전 경로 반영).
 */
function deriveRecommendations(input: RecommendationFilterInput): UseRecommendationsResult {
  const searchResultCodes = new Set((input.searchResults || []).map((s) => s.code));
  const pool = [...(input.recommendations || []), ...(input.searchResults || [])];
  const filteredRecommendations = pool.filter((s) => matchesFilters(s, input, searchResultCodes));

  const allPatterns = Array.from(
    new Set((input.recommendations || []).flatMap((r) => r.patterns ?? [])),
  );

  let base: StockRecommendation[] = [];
  if (input.view === 'DISCOVER') {
    base = filteredRecommendations;
  } else if (input.view === 'WATCHLIST') {
    const wq = (input.searchQuery ?? '').trim();
    const wql = wq.toLowerCase();
    base = (input.watchlist || []).filter((s) =>
      (s.name?.toLowerCase().includes(wql) ?? false) ||
      (s.code?.includes(wq) ?? false),
    );
  }
  const displayList = sortList(base, input.sortBy);

  return { filteredRecommendations, displayList, allPatterns };
}

/**
 * 순수 파생 훅 — store 값 스냅샷을 입력받아 deriveRecommendations 를 useMemo 로 감싼다.
 * useQuantRecommendations 가 이 훅을 호출한다.
 */
export function useRecommendations(input: RecommendationFilterInput): UseRecommendationsResult {
  return useMemo(() => deriveRecommendations(input), [
    input.recommendations, input.searchResults, input.watchlist,
    input.selectedType, input.selectedPattern, input.selectedSentiment,
    input.selectedChecklist, input.searchQuery, input.lastSearchedQuery,
    input.minPrice, input.maxPrice,
    input.sortBy, input.view,
  ]);
}

/** 테스트 전용 — useMemo 없이 즉시 계산(동일 원장 deriveRecommendations 경유). */
export function computeRecommendationsDerived(input: RecommendationFilterInput): UseRecommendationsResult {
  return deriveRecommendations(input);
}
