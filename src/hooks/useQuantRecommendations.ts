// @responsibility useQuantRecommendations React hook
import { useEffect, useMemo, useRef } from 'react';
import { useRecommendationStore, useSettingsStore } from '../stores';
import type { StockRecommendation } from '../services/stockService';
import { autoTradeApi } from '../api';
import { useRecommendations } from './useRecommendations';

type HistoryEntry = { date: string; stocks: string[]; hitRate: number; strongBuyHitRate?: number };

/**
 * 워치리스트 → 자동매매 엔진 미러링 델타 계산 (순수).
 *
 * `prevCodes === null` (최초 관측: 마운트/동기 prime) 은 baseline 으로만 기록하고
 * 빈 델타를 반환한다 — 기존 워치리스트 전체를 "신규 추가"로 오인해 매 마운트마다
 * 서버로 재미러링하던 churn 을 차단한다(147760 피엠티: 엔진이 +99.6% drift 로 제거 →
 * 클라이언트가 재등록 → 반복 편입 알림). 이후의 실제 사용자 추가/제거 델타만 동기화.
 */
export function diffWatchlistSync(
  prevCodes: string[] | null,
  currentCodes: string[],
): { added: string[]; removed: string[] } {
  if (prevCodes === null) return { added: [], removed: [] };
  return {
    added: currentCodes.filter((c) => !prevCodes.includes(c)),
    removed: prevCodes.filter((c) => !currentCodes.includes(c)),
  };
}

export function useQuantRecommendations() {
  const {
    recommendations,
    watchlist,
    searchResults,
    filters,
    selectedType,
    selectedPattern,
    selectedSentiment,
    selectedChecklist,
    searchQuery, setSearchQuery,
    lastSearchedQuery,
    minPrice,
    maxPrice,
    sortBy,
    recommendationHistory,
    loading: loadingRec,
    lastUpdated,
    setRecommendations,
  } = useRecommendationStore();

  const { view } = useSettingsStore();

  // ── Stale Recommendation Cleanup (clear previous-day data) ──────────────
  useEffect(() => {
    if (lastUpdated) {
      const lastDate = new Date(lastUpdated).toDateString();
      const today = new Date().toDateString();
      if (lastDate !== today) {
        setRecommendations([]);
      }
    }
  }, []);

  // ── Watchlist Sync ──────────────────────────────────────────────────────
  // null = 아직 미관측 — 최초 관측(마운트/동기 prime)은 baseline 으로만 기록(델타 0).
  const prevWatchlistCodesRef = useRef<string[] | null>(null);
  useEffect(() => {
    const currentCodes = (watchlist || []).map((s: StockRecommendation) => s.code);
    const { added: addedCodes, removed } = diffWatchlistSync(prevWatchlistCodesRef.current, currentCodes);
    prevWatchlistCodesRef.current = currentCodes;

    const addedSet = new Set(addedCodes);
    for (const stock of (watchlist || []).filter((s: StockRecommendation) => addedSet.has(s.code))) {
      autoTradeApi.addToWatchlist({
        code: stock.code,
        name: stock.name,
        entryPrice: stock.entryPrice ?? stock.currentPrice ?? 0,
        stopLoss: stock.stopLoss ?? 0,
        targetPrice: stock.targetPrice ?? 0,
      }).catch((err) => console.error('[ERROR] 워치리스트 동기화 실패:', err));
    }

    for (const code of removed) {
      autoTradeApi.removeFromWatchlist(code).catch((err) => console.error('[ERROR] 워치리스트 삭제 실패:', err));
    }
  }, [watchlist]);

  // ── Computed Hit Rates ──────────────────────────────────────────────────
  const averageHitRate = useMemo(() => {
    if (recommendationHistory.length === 0) return 0;
    return Math.round(recommendationHistory.reduce((acc: number, curr: HistoryEntry) => acc + curr.hitRate, 0) / recommendationHistory.length);
  }, [recommendationHistory]);

  const strongBuyHitRate = useMemo(() => {
    if (recommendationHistory.length === 0) return 68;
    const itemsWithStrongBuy = (recommendationHistory || []).filter((item: HistoryEntry) => item.strongBuyHitRate !== undefined);
    if (itemsWithStrongBuy.length === 0) return 68;
    return Math.max(0, Math.round((itemsWithStrongBuy.reduce((acc: number, curr: HistoryEntry) => acc + (curr.strongBuyHitRate || 0), 0) / itemsWithStrongBuy.length) * 0.95));
  }, [recommendationHistory]);

  // ── Filtered & Sorted Display List ──────────────────────────────────────
  // 단일 원장(useRecommendations) 위임 — 과거 이 자리에 복제돼 있던 인라인 필터/정렬
  // 로직을 제거하고 순수 훅으로 통합한다. 검색 매칭/정렬 규칙은 useRecommendations.ts
  // 한 곳에서만 관리(SSOT)해 두 구현 간 drift(예: searchMatch 규칙 불일치)를 차단.
  const { filteredRecommendations, displayList, allPatterns } = useRecommendations({
    recommendations,
    searchResults,
    watchlist,
    selectedType,
    selectedPattern,
    selectedSentiment,
    selectedChecklist,
    searchQuery,
    lastSearchedQuery,
    minPrice,
    maxPrice,
    sortBy,
    view,
  });

  return {
    recommendations,
    loadingRec,
    watchlist,
    searchResults,
    filters,
    selectedType,
    selectedPattern,
    selectedSentiment,
    selectedChecklist,
    searchQuery, setSearchQuery,
    minPrice,
    maxPrice,
    sortBy,
    recommendationHistory,
    lastUpdated,
    averageHitRate,
    strongBuyHitRate,
    filteredRecommendations,
    displayList,
    allPatterns,
  };
}
