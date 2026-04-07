import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SlippageRecord } from '../types/quant';

interface SlippageState {
  records: SlippageRecord[];
  addRecord: (r: SlippageRecord) => void;
  clearAll: () => void;
  averageSlippage: () => number;        // 전체 평균 슬리피지
  averageByType: (type: 'MARKET' | 'LIMIT') => number;
}

export const useSlippageStore = create<SlippageState>()(
  persist(
    (set, get) => ({
      records: [],

      addRecord: (r) => set((s) => ({ records: [...s.records, r] })),

      clearAll: () => set({ records: [] }),

      averageSlippage: () => {
        const { records } = get();
        if (records.length === 0) return 0;
        return records.reduce((sum, r) => sum + r.slippagePct, 0) / records.length;
      },

      averageByType: (type) => {
        const filtered = get().records.filter((r) => r.orderType === type);
        if (filtered.length === 0) return 0;
        return filtered.reduce((sum, r) => sum + r.slippagePct, 0) / filtered.length;
      },
    }),
    {
      name: 'quantmaster-slippage',
      partialize: (state) => ({ records: state.records }),
    }
  )
);
