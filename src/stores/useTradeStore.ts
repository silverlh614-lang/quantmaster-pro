import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { TradeRecord, LossReason } from '../types/quant';
import type { StockRecommendation } from '../services/stockService';
import { safePctChange } from '../utils/safePctChange';
type Updater<T> = T | ((prev: T) => T);

/**
 * 영속된 레거시 TradeRecord 를 렌더링 안전한 형태로 정규화한다.
 *
 * 과거 버전에서 `parseFloat('') || undefined` 경로 등으로 수치 필드에
 * `undefined` 가 저장된 케이스가 있었고, 그 레코드가 TradeJournal 에서
 * `.toLocaleString()` · `.toFixed()` 호출 시 TypeError 를 내며
 * 카드 전체(수량/매수가) 가 렌더되지 않던 원인을 여기서 차단한다.
 */
function sanitizeTradeRecord(raw: unknown): TradeRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Record<string, unknown>;
  if (typeof t.id !== 'string' || typeof t.stockCode !== 'string') return null;

  const num = (v: unknown, fallback = 0): number => {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : fallback;
  };

  // ADR-0018: schemaVersion 미설정 레코드는 v1 (자기학습 데이터 무결성 보강 이전) 으로
  // 표시한다. v1 레코드의 conditionScores 는 빈 객체일 가능성이 높아 학습에서
  // 자연스럽게 배제된다 (feedbackLoopEngine 의 ≥5 필터가 통과 안 됨).
  const schemaVersionRaw = t.schemaVersion;
  const schemaVersion =
    typeof schemaVersionRaw === 'number' && Number.isFinite(schemaVersionRaw)
      ? schemaVersionRaw
      : 1;

  return {
    ...(t as unknown as TradeRecord),
    buyPrice: num(t.buyPrice),
    quantity: Math.max(0, Math.floor(num(t.quantity))),
    positionSize: num(t.positionSize, 10),
    gate1Score: num(t.gate1Score),
    gate2Score: num(t.gate2Score),
    gate3Score: num(t.gate3Score),
    finalScore: num(t.finalScore),
    // 선택적 필드는 값이 있을 때만 유한한지 확인, 아니면 undefined 로 정리
    sellPrice: t.sellPrice != null && Number.isFinite(Number(t.sellPrice)) ? Number(t.sellPrice) : undefined,
    currentPrice: t.currentPrice != null && Number.isFinite(Number(t.currentPrice)) ? Number(t.currentPrice) : undefined,
    returnPct: t.returnPct != null && Number.isFinite(Number(t.returnPct)) ? Number(t.returnPct) : undefined,
    holdingDays: t.holdingDays != null && Number.isFinite(Number(t.holdingDays)) ? Number(t.holdingDays) : undefined,
    buyDate: typeof t.buyDate === 'string' ? t.buyDate : new Date().toISOString(),
    schemaVersion,
  } as TradeRecord;
}

interface TradeState {
  // Trade Records
  tradeRecords: TradeRecord[];
  setTradeRecords: (v: Updater<TradeRecord[]>) => void;
  recordTrade: (trade: TradeRecord) => void;
  closeTrade: (tradeId: string, sellPrice: number, sellReason: TradeRecord['sellReason']) => void;
  deleteTrade: (tradeId: string) => void;
  updateTradeMemo: (tradeId: string, memo: string) => void;
  // ADR-0025 (PR-H): 사용자 수동 lossReason 입력. null=자동 분류 모드 복원
  setLossReason: (tradeId: string, reason: LossReason | null) => void;

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
          // ADR-0028: stale buyPrice 시 0 fallback — TradeRecord 영속 학습 입력 보호.
          const returnPct = safePctChange(sellPrice, t.buyPrice, {
            label: `useTradeStore.closeTrade:${t.stockCode}`,
          }) ?? 0;
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

      // ADR-0025 (PR-H): 사용자 수동 lossReason 입력. lossReasonAuto=false 로 표기해
      // PR-D 의 closeTrade 자동 분류가 덮어쓰지 않도록 보호. null = 수동 분류 해제.
      setLossReason: (tradeId, reason) => set((state) => ({
        tradeRecords: state.tradeRecords.map((t: TradeRecord) => {
          if (t.id !== tradeId) return t;
          if (reason === null) {
            const { lossReason, lossReasonAuto, lossReasonClassifiedAt, ...rest } = t;
            void lossReason; void lossReasonAuto; void lossReasonClassifiedAt;
            return rest as TradeRecord;
          }
          return {
            ...t,
            lossReason: reason,
            lossReasonAuto: false,
            lossReasonClassifiedAt: new Date().toISOString(),
          };
        }),
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
      // 영속된 레코드 위생처리 — undefined 수치 필드로 인한 렌더 크래시 차단.
      // rehydrate 시점에만 돌리므로 런타임 오버헤드는 무시 가능.
      onRehydrateStorage: () => (state) => {
        if (!state?.tradeRecords) return;
        const cleaned = state.tradeRecords
          .map(sanitizeTradeRecord)
          .filter((t): t is TradeRecord => t !== null);
        if (cleaned.length !== state.tradeRecords.length ||
            cleaned.some((t, i) => t !== state.tradeRecords[i])) {
          state.tradeRecords = cleaned;
        }
      },
    }
  )
);
