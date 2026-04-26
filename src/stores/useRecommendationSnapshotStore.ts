/**
 * @responsibility RecommendationSnapshot zustand persist store — 추천 lifecycle SSOT
 *
 * ADR-0019 (PR-B). useStockSearch.fetchStocks 완료 시 captureSnapshots,
 * useTradeOps.recordTrade/closeTrade 가 markOpen/markClosed 호출.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { RecommendationSnapshot, SnapshotStats } from '../types/portfolio';
import type { StockRecommendation } from '../services/stockService';
import {
  captureSnapshots as captureSnapshotsImpl,
  markSnapshotOpen as markOpenImpl,
  markSnapshotClosed as markClosedImpl,
  expireStaleSnapshots as expireImpl,
  computeSnapshotStats,
  getRecentSnapshots,
} from '../services/quant/recommendationSnapshotRepo';

interface RecommendationSnapshotState {
  snapshots: RecommendationSnapshot[];

  /** 추천 결과 일괄 capture (PENDING 으로). 동일 stockCode active snapshot 있으면 무시. */
  captureFromRecommendations: (stocks: StockRecommendation[]) => void;
  /** stockCode 의 PENDING → OPEN 전이 + tradeId 연결. */
  markOpen: (stockCode: string, tradeId: string) => void;
  /** tradeId 매칭 OPEN → CLOSED 전이 + realizedReturnPct 기록. */
  markClosed: (tradeId: string, realizedReturnPct: number) => void;
  /** 30일 경과 PENDING 자동 EXPIRED 전이. */
  expireStale: () => void;

  /** 통계 (read-only — 매 호출 시 재계산). */
  getStats: () => SnapshotStats;
  /** UI 표시용 최근 N건. */
  getRecent: (limit?: number) => RecommendationSnapshot[];

  /** 테스트용 reset. */
  __resetForTests: () => void;
}

export const useRecommendationSnapshotStore = create<RecommendationSnapshotState>()(
  persist(
    (set, get) => ({
      snapshots: [],

      captureFromRecommendations: (stocks) =>
        set(state => ({
          snapshots: captureSnapshotsImpl(state.snapshots, stocks),
        })),

      markOpen: (stockCode, tradeId) =>
        set(state => ({
          snapshots: markOpenImpl(state.snapshots, stockCode, tradeId),
        })),

      markClosed: (tradeId, realizedReturnPct) =>
        set(state => ({
          snapshots: markClosedImpl(state.snapshots, tradeId, realizedReturnPct),
        })),

      expireStale: () =>
        set(state => ({
          snapshots: expireImpl(state.snapshots),
        })),

      getStats: () => computeSnapshotStats(get().snapshots),
      getRecent: (limit = 50) => getRecentSnapshots(get().snapshots, limit),

      __resetForTests: () => set({ snapshots: [] }),
    }),
    {
      name: 'k-stock-recommendation-snapshots-store',
      partialize: state => ({ snapshots: state.snapshots }),
    },
  ),
);
