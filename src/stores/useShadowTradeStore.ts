// @responsibility useShadowTradeStore Zustand store
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ShadowTrade } from '../types/quant';
import { autoTradeApi, type ServerShadowTrade } from '../api';

/**
 * Shadow Trade 스토어 — "서버가 단일 진실 원천, 클라이언트는 read-mostly 캐시" 모델.
 *
 * 이전에는:
 *   - `addShadowTrade` 를 호출자 측에서 래핑해 POST 하는 패턴이었고,
 *   - `useShadowTradeStore` 를 래퍼 없이 직접 쓰는 곳(DeepAnalysisModal,
 *     useWatchlistData 를 통한 DiscoverWatchlistPage 등)은 로컬에만
 *     쌓고 서버에는 반영되지 않아 UI ↔ 자동매매 간 drift 의 원인이었다.
 *
 * 지금은:
 *   - `addShadowTrade` 가 스토어 내부에서 즉시 optimistic 로컬 업데이트 →
 *     서버 POST → 실패 시 자동 롤백. 어떤 호출자가 쓰든 서버 동기화가 보장된다.
 *   - `hydrateFromServer` 가 서버 상태를 권위 있는 스냅샷으로 반영한다.
 *     (폴링은 호출부에서 `usePolledFetch` 로 주기 호출.)
 */

interface ShadowTradeState {
  shadowTrades: ShadowTrade[];
  /** 로컬 + 서버 동기화. 서버 실패 시 로컬에서 자동 롤백. */
  addShadowTrade: (trade: ShadowTrade) => Promise<void>;
  /** 서버 상태로 로컬 캐시 덮어쓰기. */
  hydrateFromServer: () => Promise<void>;
  /**
   * 로컬 전용 패치 (서버 스케줄러가 결정권자). 낙관적 UI 갱신에만 쓰고,
   * 다음 hydrate 에서 서버 상태로 덮여씀. 외부 호출 시 쓰임이 거의 없지만
   * 하위 호환을 위해 남겨둔다.
   */
  updateShadowTrade: (id: string, updates: Partial<ShadowTrade>) => void;
  deleteShadowTrade: (id: string) => void;
  clearAll: () => void;
}

function mapServerToClient(s: ServerShadowTrade): ShadowTrade {
  // 서버 status 중 RESTOCK/REJECTED 등 미지원 값은 ACTIVE 로 안전 캐스팅.
  const allowedStatus: ShadowTrade['status'][] = ['PENDING', 'ACTIVE', 'HIT_TARGET', 'HIT_STOP'];
  const status = allowedStatus.includes(s.status as ShadowTrade['status'])
    ? (s.status as ShadowTrade['status'])
    : 'ACTIVE';
  const kellyRaw = (s as Record<string, unknown>).kellyFraction;
  const kellyFraction = typeof kellyRaw === 'number' ? kellyRaw : 0;
  return {
    id: s.id ?? `${s.stockCode}-${s.signalTime}`,
    signalTime: s.signalTime,
    stockCode: s.stockCode,
    stockName: s.stockName,
    signalPrice: s.signalPrice ?? 0,
    shadowEntryPrice: s.shadowEntryPrice ?? s.signalPrice ?? 0,
    quantity: s.quantity ?? 0,
    kellyFraction,
    stopLoss: s.stopLoss ?? 0,
    targetPrice: s.targetPrice ?? 0,
    status,
    exitPrice: s.exitPrice,
    exitTime: s.exitTime,
    returnPct: s.returnPct,
  };
}

export const useShadowTradeStore = create<ShadowTradeState>()(
  persist(
    (set, get) => ({
      shadowTrades: [],

      addShadowTrade: async (trade) => {
        set((s) => ({ shadowTrades: [...s.shadowTrades, trade] }));
        try {
          await autoTradeApi.syncShadowTrade(trade);
        } catch (err) {
          console.error('[Shadow] 서버 동기화 실패 — 로컬에서 롤백:', err);
          set((s) => ({ shadowTrades: s.shadowTrades.filter((t) => t.id !== trade.id) }));
          throw err;
        }
      },

      hydrateFromServer: async () => {
        try {
          const server = await autoTradeApi.getShadowTrades();
          const mapped = server.map(mapServerToClient);
          set({ shadowTrades: mapped });
        } catch (err) {
          console.error('[Shadow] hydrate 실패 — 로컬 캐시 유지:', err);
        }
      },

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

      // get 은 미래 확장용 (선택자 / 파생값) — 린트 억제.
      _get: get,
    } as ShadowTradeState & { _get?: unknown }),
    {
      name: 'quantmaster-shadow-trades',
      partialize: (state) => ({ shadowTrades: state.shadowTrades }),
    }
  )
);

/** 적중률 (HIT_TARGET / 결산 건수) — 값으로 반환 */
export function useShadowWinRate(): number {
  return useShadowTradeStore((s) => {
    const closed = s.shadowTrades.filter(
      (t) => t.status === 'HIT_TARGET' || t.status === 'HIT_STOP'
    );
    if (closed.length === 0) return 0;
    const wins = closed.filter((t) => t.status === 'HIT_TARGET').length;
    return Math.round((wins / closed.length) * 100);
  });
}

/** 평균 수익률 — 값으로 반환 */
export function useShadowAvgReturn(): number {
  return useShadowTradeStore((s) => {
    const closed = s.shadowTrades.filter(
      (t) =>
        (t.status === 'HIT_TARGET' || t.status === 'HIT_STOP') &&
        t.returnPct !== undefined
    );
    if (closed.length === 0) return 0;
    const sum = closed.reduce((acc, t) => acc + (t.returnPct ?? 0), 0);
    return parseFloat((sum / closed.length).toFixed(2));
  });
}
