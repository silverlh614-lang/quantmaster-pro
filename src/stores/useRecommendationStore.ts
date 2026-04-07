import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { TradeRecord, ConditionId } from '../types/quant';

// Re-export StockRecommendation type from stockService
type StockRecommendation = any; // App uses the full type from stockService

interface StockFilters {
  mode: 'MOMENTUM' | 'EARLY_DETECT' | 'QUANT_SCREEN';
  minRoe?: number;
  maxPer?: number;
  maxDebtRatio?: number;
  minMarketCap?: number;
}

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

  // Deep Analysis
  deepAnalysisStock: StockRecommendation | null;
  setDeepAnalysisStock: (v: Updater<StockRecommendation | null>) => void;
  selectedDetailStock: StockRecommendation | null;
  setSelectedDetailStock: (stock: StockRecommendation | null) => void;
  analysisView: 'STANDARD' | 'QUANT';
  setAnalysisView: (view: 'STANDARD' | 'QUANT') => void;

  // Trade Journal
  tradeRecords: TradeRecord[];
  setTradeRecords: (v: Updater<TradeRecord[]>) => void;
  recordTrade: (trade: TradeRecord) => void;
  closeTrade: (tradeId: string, sellPrice: number, sellReason: TradeRecord['sellReason']) => void;
  deleteTrade: (tradeId: string) => void;
  updateTradeMemo: (tradeId: string, memo: string) => void;
  tradeRecordStock: StockRecommendation | null;
  setTradeRecordStock: (stock: StockRecommendation | null) => void;
  tradeFormData: { buyPrice: string; quantity: string; positionSize: string; followedSystem: boolean };
  setTradeFormData: (v: Updater<{ buyPrice: string; quantity: string; positionSize: string; followedSystem: boolean }>) => void;

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
        return {
          watchlist: [...state.watchlist, {
            ...stock,
            watchedPrice: stock.currentPrice,
            watchedAt: new Date().toLocaleDateString('ko-KR'),
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

      // Deep Analysis
      deepAnalysisStock: null,
      setDeepAnalysisStock: (v) => set((s) => ({ deepAnalysisStock: typeof v === 'function' ? v(s.deepAnalysisStock) : v })),
      selectedDetailStock: null,
      setSelectedDetailStock: (selectedDetailStock) => set({ selectedDetailStock }),
      analysisView: 'STANDARD',
      setAnalysisView: (analysisView) => set({ analysisView }),

      // Trade Journal
      tradeRecords: [],
      setTradeRecords: (v) => set((s) => ({ tradeRecords: typeof v === 'function' ? v(s.tradeRecords) : v })),
      recordTrade: (trade) => set((state) => ({
        tradeRecords: [...state.tradeRecords, trade],
      })),
      closeTrade: (tradeId, sellPrice, sellReason) => set((state) => ({
        tradeRecords: state.tradeRecords.map((t: TradeRecord) => {
          if (t.id !== tradeId) return t;
          const returnPct = ((sellPrice - t.buyPrice) / t.buyPrice) * 100;
          const holdingDays = Math.round((Date.now() - new Date(t.buyDate).getTime()) / (1000 * 60 * 60 * 24));
          return { ...t, sellDate: new Date().toISOString(), sellPrice, sellReason, returnPct: parseFloat(returnPct.toFixed(2)), holdingDays, status: 'CLOSED' as const };
        }),
      })),
      deleteTrade: (tradeId) => set((state) => ({
        tradeRecords: state.tradeRecords.filter((t: TradeRecord) => t.id !== tradeId),
      })),
      updateTradeMemo: (tradeId, memo) => set((state) => ({
        tradeRecords: state.tradeRecords.map((t: TradeRecord) => t.id === tradeId ? { ...t, memo } : t),
      })),
      tradeRecordStock: null,
      setTradeRecordStock: (tradeRecordStock) => set({ tradeRecordStock }),
      tradeFormData: { buyPrice: '', quantity: '', positionSize: '10', followedSystem: true },
      setTradeFormData: (v) => set((s) => ({ tradeFormData: typeof v === 'function' ? v(s.tradeFormData) : v })),

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
    }),
    {
      name: 'k-stock-recommendations-store',
      partialize: (state) => ({
        recommendations: state.recommendations,
        watchlist: state.watchlist,
        searchResults: state.searchResults,
        screenerRecommendations: state.screenerRecommendations,
        tradeRecords: state.tradeRecords,
        recommendationHistory: state.recommendationHistory,
        lastUpdated: state.lastUpdated,
        lastUsedMode: state.lastUsedMode,
      }),
    }
  )
);
