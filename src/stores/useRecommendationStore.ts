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

interface RecommendationState {
  // Stock Data
  recommendations: StockRecommendation[];
  setRecommendations: (stocks: StockRecommendation[]) => void;
  updateRecommendation: (code: string, updates: Partial<StockRecommendation>) => void;

  // Watchlist
  watchlist: StockRecommendation[];
  toggleWatchlist: (stock: StockRecommendation) => void;
  setWatchlist: (stocks: StockRecommendation[]) => void;
  isWatched: (code: string) => boolean;

  // Search & Screener
  searchResults: StockRecommendation[];
  setSearchResults: (results: StockRecommendation[]) => void;
  screenerRecommendations: StockRecommendation[];
  setScreenerRecommendations: (results: StockRecommendation[]) => void;

  // Filters
  filters: StockFilters;
  setFilters: (filters: StockFilters) => void;
  selectedType: string;
  setSelectedType: (type: string) => void;
  selectedPattern: string;
  setSelectedPattern: (pattern: string) => void;
  selectedSentiment: string;
  setSelectedSentiment: (sentiment: string) => void;
  selectedChecklist: string[];
  setSelectedChecklist: (checklist: string[]) => void;
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
  setDeepAnalysisStock: (stock: StockRecommendation | null) => void;
  selectedDetailStock: StockRecommendation | null;
  setSelectedDetailStock: (stock: StockRecommendation | null) => void;
  analysisView: 'STANDARD' | 'QUANT';
  setAnalysisView: (view: 'STANDARD' | 'QUANT') => void;

  // Trade Journal
  tradeRecords: TradeRecord[];
  setTradeRecords: (records: TradeRecord[]) => void;
  recordTrade: (trade: TradeRecord) => void;
  closeTrade: (tradeId: string, sellPrice: number, sellReason: TradeRecord['sellReason']) => void;
  deleteTrade: (tradeId: string) => void;
  updateTradeMemo: (tradeId: string, memo: string) => void;
  tradeRecordStock: StockRecommendation | null;
  setTradeRecordStock: (stock: StockRecommendation | null) => void;
  tradeFormData: { buyPrice: string; quantity: string; positionSize: string; followedSystem: boolean };
  setTradeFormData: (data: { buyPrice: string; quantity: string; positionSize: string; followedSystem: boolean }) => void;

  // History
  recommendationHistory: { date: string; stocks: number; hitRate: number; strongBuyHitRate: number }[];
  addHistoryEntry: (entry: { date: string; stocks: number; hitRate: number; strongBuyHitRate: number }) => void;

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
      setRecommendations: (recommendations) => set({ recommendations }),
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
      setWatchlist: (watchlist) => set({ watchlist }),
      isWatched: (code) => get().watchlist.some((s: StockRecommendation) => s.code === code),

      // Search & Screener
      searchResults: [],
      setSearchResults: (searchResults) => set({ searchResults }),
      screenerRecommendations: [],
      setScreenerRecommendations: (screenerRecommendations) => set({ screenerRecommendations }),

      // Filters
      filters: { mode: 'MOMENTUM' },
      setFilters: (filters) => set({ filters }),
      selectedType: 'ALL',
      setSelectedType: (selectedType) => set({ selectedType }),
      selectedPattern: 'ALL',
      setSelectedPattern: (selectedPattern) => set({ selectedPattern }),
      selectedSentiment: 'ALL',
      setSelectedSentiment: (selectedSentiment) => set({ selectedSentiment }),
      selectedChecklist: [],
      setSelectedChecklist: (selectedChecklist) => set({ selectedChecklist }),
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
      setDeepAnalysisStock: (deepAnalysisStock) => set({ deepAnalysisStock }),
      selectedDetailStock: null,
      setSelectedDetailStock: (selectedDetailStock) => set({ selectedDetailStock }),
      analysisView: 'STANDARD',
      setAnalysisView: (analysisView) => set({ analysisView }),

      // Trade Journal
      tradeRecords: [],
      setTradeRecords: (tradeRecords) => set({ tradeRecords }),
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
      setTradeFormData: (tradeFormData) => set({ tradeFormData }),

      // History
      recommendationHistory: [],
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
