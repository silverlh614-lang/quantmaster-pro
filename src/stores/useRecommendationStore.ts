import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { StockRecommendation, StockFilters } from '../services/stockService';

type Updater<T> = T | ((prev: T) => T);

interface RecommendationState {
  // Stock Data
  recommendations: StockRecommendation[];
  setRecommendations: (v: Updater<StockRecommendation[]>) => void;
  updateRecommendation: (code: string, updates: Partial<StockRecommendation>) => void;

  // Watchlist
  watchlist: StockRecommendation[];
  toggleWatchlist: (stock: StockRecommendation) => void;
  setWatchlist: (v: Updater<StockRecommendation[]>) => void;
  isWatched: (code: string) => boolean;

  // Search & Screener
  searchResults: StockRecommendation[];
  setSearchResults: (v: Updater<StockRecommendation[]>) => void;
  screenerRecommendations: StockRecommendation[];
  setScreenerRecommendations: (v: Updater<StockRecommendation[]>) => void;

  // Filters
  filters: StockFilters;
  setFilters: (v: Updater<StockFilters>) => void;
  selectedType: string;
  setSelectedType: (type: string) => void;
  selectedPattern: string;
  setSelectedPattern: (pattern: string) => void;
  selectedSentiment: string;
  setSelectedSentiment: (sentiment: string) => void;
  selectedChecklist: string[];
  setSelectedChecklist: (v: Updater<string[]>) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  minPrice: string;
  setMinPrice: (price: string) => void;
  maxPrice: string;
  setMaxPrice: (price: string) => void;
  sortBy: 'NAME' | 'CODE' | 'PERFORMANCE';
  setSortBy: (sort: 'NAME' | 'CODE' | 'PERFORMANCE') => void;
  lastUsedMode: 'MOMENTUM' | 'EARLY_DETECT' | 'QUANT_SCREEN';
  setLastUsedMode: (mode: 'MOMENTUM' | 'EARLY_DETECT' | 'QUANT_SCREEN') => void;

  // History
  recommendationHistory: { date: string; stocks: string[]; hitRate: number; strongBuyHitRate?: number }[];
  setRecommendationHistory: (v: Updater<{ date: string; stocks: string[]; hitRate: number; strongBuyHitRate?: number }[]>) => void;
  addHistoryEntry: (entry: { date: string; stocks: string[]; hitRate: number; strongBuyHitRate?: number }) => void;

  // Loading / metadata
  loading: boolean;
  setLoading: (loading: boolean) => void;
  lastUpdated: string | null;
  setLastUpdated: (date: string | null) => void;
  error: string | null;
  setError: (error: string | null) => void;
  searchingSpecific: boolean;
  setSearchingSpecific: (searching: boolean) => void;

  // AI 추천 universe 발굴 경고 — Google Search 미설정/예산초과/실패 시 사용자 안내.
  // toast 만으로는 사용자가 사라진 메시지를 못 보고 "버튼만 누르고 결과 없음" 으로
  // 인지하던 문제 해소 — 다음 분석 실행 시까지 배너로 영구 표시.
  recommendationWarnings: string[];
  setRecommendationWarnings: (warnings: string[]) => void;

  // ADR-0016 (PR-37) 5-Tier fallback sourceStatus — 배너 색상 분기에 사용.
  // 'GOOGLE_OK' 은 정상이라 배너 미표시. 미정시 undefined.
  recommendationSourceStatus?: string;
  setRecommendationSourceStatus: (status: string | undefined) => void;
}

export const useRecommendationStore = create<RecommendationState>()(
  persist(
    (set, get) => ({
      // Stock Data
      recommendations: [],
      setRecommendations: (v) => set((s) => ({ recommendations: typeof v === 'function' ? v(s.recommendations) : v })),
      updateRecommendation: (code, updates) => set((state) => ({
        recommendations: state.recommendations.map((s: StockRecommendation) =>
          s.code === code ? { ...s, ...updates } : s
        ),
      })),

      // Watchlist
      watchlist: [],
      toggleWatchlist: (stock) => set((state) => {
        const exists = state.watchlist.find((s: StockRecommendation) => s.code === stock.code);
        if (exists) return { watchlist: state.watchlist.filter((s: StockRecommendation) => s.code !== stock.code) };
        // PR-23: watchedPrice fallback chain — currentPrice → entryPrice → peakPrice.
        // 0 은 "값 없음" 으로 취급하여 undefined 로 저장 (UI 가 — 로 렌더).
        // watchedAt 은 ISO 문자열로 통일 (parseable by new Date()).
        const candidates = [stock.currentPrice, stock.entryPrice, (stock as unknown as { peakPrice?: number }).peakPrice];
        const watchedPrice = candidates.find((v): v is number => typeof v === 'number' && v > 0);
        return {
          watchlist: [...state.watchlist, {
            ...stock,
            watchedPrice,
            watchedAt: new Date().toISOString(),
          }],
        };
      }),
      setWatchlist: (v) => set((s) => ({ watchlist: typeof v === 'function' ? v(s.watchlist) : v })),
      isWatched: (code) => get().watchlist.some((s: StockRecommendation) => s.code === code),

      // Search & Screener
      searchResults: [],
      setSearchResults: (v) => set((s) => ({ searchResults: typeof v === 'function' ? v(s.searchResults) : v })),
      screenerRecommendations: [],
      setScreenerRecommendations: (v) => set((s) => ({ screenerRecommendations: typeof v === 'function' ? v(s.screenerRecommendations) : v })),

      // Filters
      filters: { mode: 'MOMENTUM' },
      setFilters: (v) => set((s) => ({ filters: typeof v === 'function' ? v(s.filters) : v })),
      selectedType: 'ALL',
      setSelectedType: (selectedType) => set({ selectedType }),
      selectedPattern: 'ALL',
      setSelectedPattern: (selectedPattern) => set({ selectedPattern }),
      selectedSentiment: 'ALL',
      setSelectedSentiment: (selectedSentiment) => set({ selectedSentiment }),
      selectedChecklist: [],
      setSelectedChecklist: (v) => set((s) => ({ selectedChecklist: typeof v === 'function' ? v(s.selectedChecklist) : v })),
      searchQuery: '',
      setSearchQuery: (searchQuery) => set({ searchQuery }),
      minPrice: '',
      setMinPrice: (minPrice) => set({ minPrice }),
      maxPrice: '',
      setMaxPrice: (maxPrice) => set({ maxPrice }),
      sortBy: 'NAME',
      setSortBy: (sortBy) => set({ sortBy }),
      lastUsedMode: 'MOMENTUM',
      setLastUsedMode: (lastUsedMode) => set({ lastUsedMode }),

      // History
      recommendationHistory: [],
      setRecommendationHistory: (v) => set((s) => ({ recommendationHistory: typeof v === 'function' ? v(s.recommendationHistory) : v })),
      addHistoryEntry: (entry) => set((state) => ({
        recommendationHistory: [...state.recommendationHistory.slice(-29), entry],
      })),

      // Loading / metadata
      loading: false,
      setLoading: (loading) => set({ loading }),
      lastUpdated: null,
      setLastUpdated: (lastUpdated) => set({ lastUpdated }),
      error: null,
      setError: (error) => set({ error }),
      searchingSpecific: false,
      setSearchingSpecific: (searchingSpecific) => set({ searchingSpecific }),

      recommendationWarnings: [],
      setRecommendationWarnings: (recommendationWarnings) => set({ recommendationWarnings }),
      recommendationSourceStatus: undefined,
      setRecommendationSourceStatus: (recommendationSourceStatus) => set({ recommendationSourceStatus }),
    }),
    {
      name: 'k-stock-recommendations-store',
      partialize: (state) => ({
        recommendations: state.recommendations,
        watchlist: state.watchlist,
        screenerRecommendations: state.screenerRecommendations,
        recommendationHistory: state.recommendationHistory,
        lastUpdated: state.lastUpdated,
        lastUsedMode: state.lastUsedMode,
      }),
    }
  )
);
