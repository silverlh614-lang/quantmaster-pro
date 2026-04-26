// @responsibility usePortfolioStore Zustand store
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Portfolio } from '../types/quant';
type Updater<T> = T | ((prev: T) => T);

interface PortfolioState {
  portfolios: Portfolio[];
  setPortfolios: (v: Updater<Portfolio[]>) => void;
  addPortfolio: (portfolio: Portfolio) => void;
  deletePortfolio: (id: string) => void;
  updatePortfolio: (id: string, updates: Partial<Portfolio>) => void;
  currentPortfolioId: string | null;
  setCurrentPortfolioId: (id: string | null) => void;
  comparingPortfolioIds: string[] | null;
  setComparingPortfolioIds: (ids: string[] | null) => void;
}

export const usePortfolioStore = create<PortfolioState>()(
  persist(
    (set) => ({
      portfolios: [],
      setPortfolios: (v) => set((s) => ({ portfolios: typeof v === 'function' ? v(s.portfolios) : v })),
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
    }),
    {
      name: 'k-stock-portfolio-store',
      partialize: (state) => ({
        portfolios: state.portfolios,
        currentPortfolioId: state.currentPortfolioId,
      }),
    }
  )
);
