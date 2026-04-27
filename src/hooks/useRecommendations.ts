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

export type RecommendationSort = 'NAME' | 'CODE' | 'PERFORMANCE' | 'NONE';
export type RecommendationView = 'DISCOVER' | 'WATCHLIST' | string;

export interface RecommendationFilterInput {
  recommendations: StockRecommendation[];
  searchResults: StockRecommendation[];
  watchlist: StockRecommendation[];
  selectedType: string;
  selectedPattern: string;
  selectedSentiment: string;
  selectedChecklist: string[];
  searchQuery: string;
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
  const queryLower = (p.searchQuery ?? '').toLowerCase();
  const nameLower = stock.name?.toLowerCase() ?? '';
  const searchMatch = searchResultCodes.has(stock.code) || queryLower === '' ||
    nameLower.includes(queryLower) ||
    (stock.code?.includes(p.searchQuery) ?? false);
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
 * 순수 파생 훅 — sideeffect 없음. 입력은 store 값의 스냅샷.
 * useQuantRecommendations 가 이 훅을 호출해 filteredRecommendations/displayList/
 * allPatterns 를 생성한다. 페이지 수준 재사용 시에도 직접 호출 가능.
 */
export function useRecommendations(input: RecommendationFilterInput): UseRecommendationsResult {
  return useMemo(() => {
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
      const query = (input.searchQuery ?? '').toLowerCase();
      base = (input.watchlist || []).filter((s) =>
        (s.name?.toLowerCase().includes(query) ?? false) ||
        (s.code?.includes(input.searchQuery) ?? false),
      );
    }
    const displayList = sortList(base, input.sortBy);

    return { filteredRecommendations, displayList, allPatterns };
  }, [
    input.recommendations, input.searchResults, input.watchlist,
    input.selectedType, input.selectedPattern, input.selectedSentiment,
    input.selectedChecklist, input.searchQuery, input.minPrice, input.maxPrice,
    input.sortBy, input.view,
  ]);
}

/** 테스트 전용 — useMemo 없이 즉시 계산. */
export function computeRecommendationsDerived(input: RecommendationFilterInput): UseRecommendationsResult {
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
    const query = (input.searchQuery ?? '').toLowerCase();
    base = (input.watchlist || []).filter((s) =>
      (s.name?.toLowerCase().includes(query) ?? false) ||
      (s.code?.includes(input.searchQuery) ?? false),
    );
  }
  const displayList = sortList(base, input.sortBy);

  return { filteredRecommendations, displayList, allPatterns };
}
