import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Use any for complex external types to avoid circular import issues
type MarketOverview = any;
type MarketContext = any;
type BacktestResult = any;
type WalkForwardAnalysis = any;
type Portfolio = any;

interface SyncStatus {
  isSyncing: boolean;
  progress: number;
  total: number;
  currentStock: string | null;
  lastSyncTime: string | null;
}

interface MarketState {
  // Market Overview
  marketOverview: MarketOverview | null;
  setMarketOverview: (data: MarketOverview | null) => void;
  marketContext: MarketContext | null;
  setMarketContext: (data: MarketContext | null) => void;
  loadingMarket: boolean;
  setLoadingMarket: (loading: boolean) => void;

  // Sync
  syncStatus: SyncStatus;
  setSyncStatus: (status: Partial<SyncStatus>) => void;
  syncingStock: string | null;
  setSyncingStock: (code: string | null) => void;
  nextSyncCountdown: number;
  setNextSyncCountdown: (seconds: number) => void;

  // Backtest
  backtestPortfolioItems: { name: string; code: string; weight: number }[];
  setBacktestPortfolioItems: (items: { name: string; code: string; weight: number }[]) => void;
  addToBacktest: (stock: { name: string; code: string }) => void;
  removeFromBacktest: (code: string) => void;
  updateWeight: (code: string, weight: number) => void;
  backtestResult: BacktestResult | null;
  setBacktestResult: (result: BacktestResult | null) => void;
  backtesting: boolean;
  setBacktesting: (backtesting: boolean) => void;
  initialEquity: number;
  setInitialEquity: (equity: number) => void;
  backtestYears: number;
  setBacktestYears: (years: number) => void;

  // Walk-Forward
  walkForwardAnalysis: WalkForwardAnalysis | null;
  setWalkForwardAnalysis: (analysis: WalkForwardAnalysis | null) => void;
  analyzingWalkForward: boolean;
  setAnalyzingWalkForward: (analyzing: boolean) => void;

  // Portfolios
  portfolios: Portfolio[];
  setPortfolios: (portfolios: Portfolio[]) => void;
  addPortfolio: (portfolio: Portfolio) => void;
  deletePortfolio: (id: string) => void;
  updatePortfolio: (id: string, updates: Partial<Portfolio>) => void;
  currentPortfolioId: string | null;
  setCurrentPortfolioId: (id: string | null) => void;
  comparingPortfolioIds: string[] | null;
  setComparingPortfolioIds: (ids: string[] | null) => void;

  // Loading states
  parsingFile: boolean;
  setParsingFile: (parsing: boolean) => void;
  isGeneratingPDF: boolean;
  setIsGeneratingPDF: (generating: boolean) => void;
  isExportingDeepAnalysis: boolean;
  setIsExportingDeepAnalysis: (exporting: boolean) => void;
  isSendingEmail: boolean;
  setIsSendingEmail: (sending: boolean) => void;
  isSummarizing: boolean;
  setIsSummarizing: (summarizing: boolean) => void;
  reportSummary: string | null;
  setReportSummary: (summary: string | null) => void;
}

export const useMarketStore = create<MarketState>()(
  persist(
    (set, get) => ({
      // Market Overview
      marketOverview: null,
      setMarketOverview: (marketOverview) => set({ marketOverview }),
      marketContext: null,
      setMarketContext: (marketContext) => set({ marketContext }),
      loadingMarket: false,
      setLoadingMarket: (loadingMarket) => set({ loadingMarket }),

      // Sync
      syncStatus: { isSyncing: false, progress: 0, total: 0, currentStock: null, lastSyncTime: null },
      setSyncStatus: (status) => set((state) => ({ syncStatus: { ...state.syncStatus, ...status } })),
      syncingStock: null,
      setSyncingStock: (syncingStock) => set({ syncingStock }),
      nextSyncCountdown: 60,
      setNextSyncCountdown: (nextSyncCountdown) => set({ nextSyncCountdown }),

      // Backtest
      backtestPortfolioItems: [],
      setBacktestPortfolioItems: (backtestPortfolioItems) => set({ backtestPortfolioItems }),
      addToBacktest: (stock) => set((state) => {
        if (state.backtestPortfolioItems.some(i => i.code === stock.code)) return state;
        const totalWeight = state.backtestPortfolioItems.reduce((s, i) => s + i.weight, 0);
        const remaining = Math.max(0, 100 - totalWeight);
        return {
          backtestPortfolioItems: [...state.backtestPortfolioItems, {
            name: stock.name, code: stock.code, weight: Math.min(20, remaining),
          }],
        };
      }),
      removeFromBacktest: (code) => set((state) => ({
        backtestPortfolioItems: state.backtestPortfolioItems.filter(i => i.code !== code),
      })),
      updateWeight: (code, weight) => set((state) => ({
        backtestPortfolioItems: state.backtestPortfolioItems.map(i =>
          i.code === code ? { ...i, weight } : i
        ),
      })),
      backtestResult: null,
      setBacktestResult: (backtestResult) => set({ backtestResult }),
      backtesting: false,
      setBacktesting: (backtesting) => set({ backtesting }),
      initialEquity: 100000000,
      setInitialEquity: (initialEquity) => set({ initialEquity }),
      backtestYears: 1,
      setBacktestYears: (backtestYears) => set({ backtestYears }),

      // Walk-Forward
      walkForwardAnalysis: null,
      setWalkForwardAnalysis: (walkForwardAnalysis) => set({ walkForwardAnalysis }),
      analyzingWalkForward: false,
      setAnalyzingWalkForward: (analyzingWalkForward) => set({ analyzingWalkForward }),

      // Portfolios
      portfolios: [],
      setPortfolios: (portfolios) => set({ portfolios }),
      addPortfolio: (portfolio) => set((state) => ({ portfolios: [...state.portfolios, portfolio] })),
      deletePortfolio: (id) => set((state) => ({
        portfolios: state.portfolios.filter((p: Portfolio) => p.id !== id),
        currentPortfolioId: state.currentPortfolioId === id ? null : state.currentPortfolioId,
      })),
      updatePortfolio: (id, updates) => set((state) => ({
        portfolios: state.portfolios.map((p: Portfolio) => p.id === id ? { ...p, ...updates } : p),
      })),
      currentPortfolioId: null,
      setCurrentPortfolioId: (currentPortfolioId) => set({ currentPortfolioId }),
      comparingPortfolioIds: null,
      setComparingPortfolioIds: (comparingPortfolioIds) => set({ comparingPortfolioIds }),

      // Loading states
      parsingFile: false,
      setParsingFile: (parsingFile) => set({ parsingFile }),
      isGeneratingPDF: false,
      setIsGeneratingPDF: (isGeneratingPDF) => set({ isGeneratingPDF }),
      isExportingDeepAnalysis: false,
      setIsExportingDeepAnalysis: (isExportingDeepAnalysis) => set({ isExportingDeepAnalysis }),
      isSendingEmail: false,
      setIsSendingEmail: (isSendingEmail) => set({ isSendingEmail }),
      isSummarizing: false,
      setIsSummarizing: (isSummarizing) => set({ isSummarizing }),
      reportSummary: null,
      setReportSummary: (reportSummary) => set({ reportSummary }),
    }),
    {
      name: 'k-stock-market-store',
      partialize: (state) => ({
        marketOverview: state.marketOverview,
        marketContext: state.marketContext,
        backtestPortfolioItems: state.backtestPortfolioItems,
        portfolios: state.portfolios,
        currentPortfolioId: state.currentPortfolioId,
      }),
    }
  )
);
