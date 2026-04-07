import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AttributionEntry, ConditionId } from '../types/quant';

interface AttributionState {
  entries: Record<ConditionId, AttributionEntry>;
  /** 거래 종료 시 conditionScores 스냅샷으로 귀인 데이터 누적 */
  accumulate: (conditionScores: Record<ConditionId, number>, isWin: boolean) => void;
  clearAll: () => void;
  /** 수익 기여도 상위 N개 조건 반환 */
  topWinConditions: (n?: number) => AttributionEntry[];
  /** 허위신호(손실 기여도) 상위 N개 조건 반환 */
  topLossConditions: (n?: number) => AttributionEntry[];
}

export const useAttributionStore = create<AttributionState>()(
  persist(
    (set, get) => ({
      entries: {} as Record<ConditionId, AttributionEntry>,

      accumulate: (conditionScores, isWin) =>
        set((s) => {
          const next = { ...s.entries };
          for (const [rawId, score] of Object.entries(conditionScores)) {
            const id = Number(rawId) as ConditionId;
            const existing = next[id] ?? { conditionId: id, winContrib: 0, lossContrib: 0, count: 0 };
            next[id] = {
              ...existing,
              winContrib: existing.winContrib + (isWin ? score : 0),
              lossContrib: existing.lossContrib + (isWin ? 0 : score),
              count: existing.count + 1,
            };
          }
          return { entries: next };
        }),

      clearAll: () => set({ entries: {} }),

      topWinConditions: (n = 5) =>
        Object.values(get().entries)
          .filter((e) => e.count > 0)
          .sort((a, b) => b.winContrib - a.winContrib)
          .slice(0, n),

      topLossConditions: (n = 5) =>
        Object.values(get().entries)
          .filter((e) => e.count > 0)
          .sort((a, b) => b.lossContrib - a.lossContrib)
          .slice(0, n),
    }),
    {
      name: 'quantmaster-attribution',
      partialize: (state) => ({ entries: state.entries }),
    }
  )
);
