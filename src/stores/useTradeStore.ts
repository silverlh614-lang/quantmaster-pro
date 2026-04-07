import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { TradeRecord } from '../types/quant';

type StockRecommendation = any;
type Updater<T> = T | ((prev: T) => T);

interface TradeState {
  // Trade Records
  tradeRecords: TradeRecord[];
  setTradeRecords: (v: Updater<TradeRecord[]>) => void;
  recordTrade: (trade: TradeRecord) => void;
  closeTrade: (tradeId: string, sellPrice: number, sellReason: TradeRecord['sellReason']) => void;
  deleteTrade: (tradeId: string) => void;
  updateTradeMemo: (tradeId: string, memo: string) => void;

  // Trade Form
  tradeRecordStock: StockRecommendation | null;
  setTradeRecordStock: (stock: StockRecommendation | null) => void;
  tradeFormData: { buyPrice: string; quantity: string; positionSize: string; followedSystem: boolean };
  setTradeFormData: (v: Updater<{ buyPrice: string; quantity: string; positionSize: string; followedSystem: boolean }>) => void;
}

export const useTradeStore = create<TradeState>()(
  persist(
    (set) => ({
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
          return {
            ...t,
            sellDate: new Date().toISOString(),
            sellPrice,
            sellReason,
            returnPct: parseFloat(returnPct.toFixed(2)),
            holdingDays,
            status: 'CLOSED' as const,
          };
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
    }),
    {
      name: 'k-stock-trade-store',
      partialize: (state) => ({
        tradeRecords: state.tradeRecords,
      }),
    }
  )
);
