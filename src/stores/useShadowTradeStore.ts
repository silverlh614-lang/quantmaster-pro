import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ShadowTrade } from '../types/quant';

type Updater<T> = T | ((prev: T) => T);

interface ShadowTradeState {
  shadowTrades: ShadowTrade[];
  addShadowTrade: (trade: ShadowTrade) => void;
  updateShadowTrade: (id: string, updates: Partial<ShadowTrade>) => void;
  deleteShadowTrade: (id: string) => void;
  clearAll: () => void;

  // 통계 조회 (derived)
  winRate: () => number;          // 적중률 (HIT_TARGET / 결산 건수)
  avgReturn: () => number;        // 평균 수익률
}

export const useShadowTradeStore = create<ShadowTradeState>()(
  persist(
    (set, get) => ({
      shadowTrades: [],

      addShadowTrade: (trade) =>
        set((s) => ({ shadowTrades: [...s.shadowTrades, trade] })),

      updateShadowTrade: (id, updates) =>
        set((s) => ({
          shadowTrades: s.shadowTrades.map((t) =>
            t.id === id ? { ...t, ...updates } : t
          ),
        })),

      deleteShadowTrade: (id) =>
        set((s) => ({
          shadowTrades: s.shadowTrades.filter((t) => t.id !== id),
        })),

      clearAll: () => set({ shadowTrades: [] }),

      winRate: () => {
        const closed = get().shadowTrades.filter(
          (t) => t.status === 'HIT_TARGET' || t.status === 'HIT_STOP'
        );
        if (closed.length === 0) return 0;
        const wins = closed.filter((t) => t.status === 'HIT_TARGET').length;
        return Math.round((wins / closed.length) * 100);
      },

      avgReturn: () => {
        const closed = get().shadowTrades.filter(
          (t) =>
            (t.status === 'HIT_TARGET' || t.status === 'HIT_STOP') &&
            t.returnPct !== undefined
        );
        if (closed.length === 0) return 0;
        const sum = closed.reduce((acc, t) => acc + (t.returnPct ?? 0), 0);
        return parseFloat((sum / closed.length).toFixed(2));
      },
    }),
    {
      name: 'quantmaster-shadow-trades',
      partialize: (state) => ({ shadowTrades: state.shadowTrades }),
    }
  )
);
