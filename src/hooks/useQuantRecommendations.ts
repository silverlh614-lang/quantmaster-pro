import { useEffect, useMemo, useRef } from 'react';
import { useRecommendationStore, useSettingsStore } from '../stores';
import type { StockRecommendation } from '../services/stockService';

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
    const { lastUpdated: lu, setRecommendations: setRec } = useRecommendationStore.getState();
    if (lu) {
      const lastDate = new Date(lu).toDateString();
      const today = new Date().toDateString();
      if (lastDate !== today) {
        setRec([]);
      }
    }
  }, []);

  // ── Watchlist Sync ──────────────────────────────────────────────────────
  const prevWatchlistCodesRef = useRef<string[]>([]);
  useEffect(() => {
    const currentCodes = (watchlist || []).map((s: StockRecommendation) => s.code);
    const prevCodes = prevWatchlistCodesRef.current;
    prevWatchlistCodesRef.current = currentCodes;

    const added = (watchlist || []).filter((s: StockRecommendation) => !prevCodes.includes(s.code));
    for (const stock of added) {
      fetch('/api/auto-trade/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: stock.code, name: stock.name,
          entryPrice: stock.entryPrice ?? stock.currentPrice ?? 0,
          stopLoss: stock.stopLoss ?? 0, targetPrice: stock.targetPrice ?? 0,
        }),
      }).catch((err) => console.error('[ERROR] 워치리스트 동기화 실패:', err));
    }

    const removed = prevCodes.filter((code: string) => !currentCodes.includes(code));
    for (const code of removed) {
      fetch(`/api/auto-trade/watchlist/${code}`, { method: 'DELETE' }).catch((err) => console.error('[ERROR] 워치리스트 삭제 실패:', err));
    }
  }, [watchlist]);

  // ── Computed Hit Rates ──────────────────────────────────────────────────
  const averageHitRate = useMemo(() => {
    if (recommendationHistory.length === 0) return 0;
    return Math.round(recommendationHistory.reduce((acc: number, curr: any) => acc + curr.hitRate, 0) / recommendationHistory.length);
  }, [recommendationHistory]);

  const strongBuyHitRate = useMemo(() => {
    if (recommendationHistory.length === 0) return 68;
    const itemsWithStrongBuy = (recommendationHistory || []).filter((item: any) => item.strongBuyHitRate !== undefined);
    if (itemsWithStrongBuy.length === 0) return 68;
    return Math.max(0, Math.round((itemsWithStrongBuy.reduce((acc: number, curr: any) => acc + (curr.strongBuyHitRate || 0), 0) / itemsWithStrongBuy.length) * 0.95));
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
