// @responsibility useQuantRecommendations React hook
import { useEffect, useMemo, useRef } from 'react';
import { useRecommendationStore, useSettingsStore } from '../stores';
import type { StockRecommendation } from '../services/stockService';
import { autoTradeApi } from '../api';

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
  const searchResultCodes = new Set((searchResults || []).map((s: StockRecommendation) => s.code));

  const filteredRecommendations = [...(recommendations || []), ...(searchResults || [])].filter((stock: StockRecommendation) => {
    const typeMatch = selectedType === 'ALL' || stock.type === selectedType;
    const patternMatch = selectedPattern === 'ALL' || (stock.patterns || []).includes(selectedPattern);
    const sentimentMatch = selectedSentiment === 'ALL' ||
      (selectedSentiment === 'RISK_ON' && (stock.marketSentiment?.iri ?? 0) < 2.0) ||
      (selectedSentiment === 'RISK_OFF' && (stock.marketSentiment?.iri ?? 0) >= 2.0);
    const checklistMatch = selectedChecklist.length === 0 ||
      selectedChecklist.every((item: string) => stock.checklist?.[item as keyof typeof stock.checklist]);
    const minP = minPrice === '' ? 0 : parseInt(minPrice);
    const maxP = maxPrice === '' ? Infinity : parseInt(maxPrice);
    const priceMatch = (stock.currentPrice ?? 0) >= minP && (stock.currentPrice ?? 0) <= maxP;
    const searchMatch = searchResultCodes.has(stock.code) || searchQuery === '' ||
      (stock.name?.toLowerCase().includes(searchQuery?.toLowerCase() || '') ?? false) ||
      (stock.code?.includes(searchQuery || '') ?? false);
    return typeMatch && patternMatch && sentimentMatch && checklistMatch && searchMatch && priceMatch;
  });

  const allPatterns: string[] = Array.from(new Set((recommendations || []).flatMap((r: StockRecommendation) => r.patterns ?? [])));

  const displayList = (() => {
    let list: StockRecommendation[] = [];
    if (view === 'DISCOVER') {
      list = filteredRecommendations;
    } else if (view === 'WATCHLIST') {
      list = (watchlist || []).filter((stock: StockRecommendation) =>
        (stock.name?.toLowerCase().includes(searchQuery?.toLowerCase() || '') ?? false) ||
        (stock.code?.includes(searchQuery || '') ?? false)
      );
    } else {
      return [];
    }
    return [...list].sort((a: StockRecommendation, b: StockRecommendation) => {
      if (sortBy === 'NAME') return (a.name || '').localeCompare(b.name || '');
      if (sortBy === 'CODE') return (a.code || '').localeCompare(b.code || '');
      if (sortBy === 'PERFORMANCE') {
        const getPerf = (s: StockRecommendation) => {
          if (s.currentPrice > 0 && s.entryPrice && s.entryPrice > 0) return (s.currentPrice / s.entryPrice) - 1;
          if (s.peakPrice > 0) return (s.currentPrice / s.peakPrice) - 1;
          return -Infinity;
        };
        return getPerf(b) - getPerf(a);
      }
      return 0;
    });
  })();

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
