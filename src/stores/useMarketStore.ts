// @responsibility useMarketStore Zustand store
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { MarketOverview, MarketContext, WalkForwardAnalysis } from '../services/stockService';
import type { BacktestResult } from '../types/quant';

interface SyncStatus {
  isSyncing: boolean;
  progress: number;
  total: number;
  currentStock: string | null;
  lastSyncTime: string | null;
}

type Updater<T> = T | ((prev: T) => T);

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
  setBacktestPortfolioItems: (v: Updater<{ name: string; code: string; weight: number }[]>) => void;
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
  commissionFee: number;
  setCommissionFee: (fee: number) => void;

  // Walk-Forward
  walkForwardAnalysis: WalkForwardAnalysis | null;
  setWalkForwardAnalysis: (analysis: WalkForwardAnalysis | null) => void;
  analyzingWalkForward: boolean;
  setAnalyzingWalkForward: (analyzing: boolean) => void;

  // Loading states
  parsingFile: boolean;
  setParsingFile: (parsing: boolean) => void;
}

export const useMarketStore = create<MarketState>()(
  persist(
    (set) => ({
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
      setBacktestPortfolioItems: (v) => set((s) => ({ backtestPortfolioItems: typeof v === 'function' ? v(s.backtestPortfolioItems) : v })),
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
      commissionFee: 0.05,
      setCommissionFee: (commissionFee) => set({ commissionFee }),

      // Walk-Forward
      walkForwardAnalysis: null,
      setWalkForwardAnalysis: (walkForwardAnalysis) => set({ walkForwardAnalysis }),
      analyzingWalkForward: false,
      setAnalyzingWalkForward: (analyzingWalkForward) => set({ analyzingWalkForward }),

      // Loading states
      parsingFile: false,
      setParsingFile: (parsingFile) => set({ parsingFile }),
    }),
    {
      name: 'k-stock-market-store',
      partialize: (state) => ({
        marketOverview: state.marketOverview,
        marketContext: state.marketContext,
        backtestPortfolioItems: state.backtestPortfolioItems,
      }),
    }
  )
);
