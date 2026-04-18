/**
 * useAutoTradeEngine — 자동매매 페이지를 위한 집계 훅.
 *
 * 내부적으로 11개의 TanStack Query 훅을 호출하고, 페이지 컴포넌트가
 * 필요로 하는 "표시용 상태 + 액션" 을 하나의 객체로 반환한다.
 *
 * 페이지 컴포넌트는 fetch/폴링 지식 없이 이 훅 하나만 구조분해한다:
 *
 *   const { engineStatus, ocoOrders, toggleEngine, isLoading } = useAutoTradeEngine();
 *
 * (21번 보고서 원칙 9 — UI/로직 분리 — 을 만족.)
 *
 * **AccountSummary 파생**:
 *   KIS 잔고(`/api/kis/balance`) 응답 → `AccountSummary` 객체로 가공하는 로직은
 *   서버 응답 형태에 종속적이라 이 훅에서만 유지한다. 다른 훅(예: 리포트)에서도
 *   같은 파생이 필요하면 `deriveAccountSummary` 를 별도 util 로 승격할 것.
 */

import { useCallback, useMemo } from 'react';
import type {
  EngineStatus,
  BuyAuditData,
  GateAuditData,
  ConditionWeightsDebug,
  OcoOrdersResponse,
  ReconcileResponse,
  RecommendationStats,
  WatchlistEntry,
  KisHolding,
  ServerShadowTrade,
  PositionEvent,
  KisBalanceRaw,
} from '../../api';
import { autoTradeApi } from '../../api';
import { useQueryClient } from '@tanstack/react-query';
import { AUTO_TRADE_KEYS } from './queryKeys';
import {
  useEngineStatusQuery,
  useShadowTradesQuery,
  useRecommendationStatsQuery,
  useWatchlistQuery,
  useHoldingsQuery,
  useBuyAuditQuery,
  useGateAuditQuery,
  useConditionWeightsQuery,
  useOcoOrdersQuery,
  useReconcileQuery,
  useBalanceQuery,
} from './queries';
import {
  useToggleEngineMutation,
  useRunReconcileMutation,
} from './mutations';

// ── AccountSummary 파생 ─────────────────────────────────────────
export interface AccountSummary {
  totalEvalAmt: number;
  totalPnlAmt: number;
  totalPnlRate: number;
  availableCash: number;
}

const STARTING_CAPITAL = 100_000_000;

export function deriveAccountSummary(balance: KisBalanceRaw | undefined): AccountSummary | null {
  const summary = balance?.output2?.[0];
  if (!summary) return null;
  const totalEvalAmt = Number(summary.tot_evlu_amt ?? 0);
  const availableCash = Number(summary.dnca_tot_amt ?? summary.prvs_rcdl_excc_amt ?? 0);
  const totalPnlAmt = totalEvalAmt - STARTING_CAPITAL;
  const totalPnlRate = (totalPnlAmt / STARTING_CAPITAL) * 100;
  return { totalEvalAmt, totalPnlAmt, totalPnlRate, availableCash };
}

// ── 반환 타입 ───────────────────────────────────────────────────
export interface UseAutoTradeEngineReturn {
  // 원격 상태
  engineStatus: EngineStatus | null;
  serverShadowTrades: ServerShadowTrade[];
  serverRecStats: RecommendationStats | null;
  watchlist: WatchlistEntry[];
  holdings: KisHolding[];
  buyAudit: BuyAuditData | null;
  gateAudit: GateAuditData | null;
  conditionDebug: ConditionWeightsDebug | null;
  ocoOrders: OcoOrdersResponse;
  reconcileData: ReconcileResponse | null;
  accountSummary: AccountSummary | null;

  // 메타 상태
  /** 모든 필수 쿼리 중 하나라도 첫 로드 중이면 true. */
  isLoading: boolean;
  /** 초기 로드 중인지 (data=null and isLoading). */
  isInitialLoading: boolean;
  /** 필수 쿼리의 에러 (최초 1개). 없으면 null. */
  error: Error | null;

  // 액션
  toggleEngine: () => Promise<void>;
  engineToggling: boolean;

  runReconcile: () => Promise<void>;
  reconcileRunning: boolean;

  loadPositionEvents: (positionId: string) => Promise<PositionEvent[]>;

  /** 모든 쿼리를 즉시 재조회 (화면 수동 새로고침 버튼용). */
  refetchAll: () => void;
}

export function useAutoTradeEngine(): UseAutoTradeEngineReturn {
  const qc = useQueryClient();

  const engineStatusQ = useEngineStatusQuery();
  const shadowTradesQ = useShadowTradesQuery();
  const recStatsQ = useRecommendationStatsQuery();
  const watchlistQ = useWatchlistQuery();
  const holdingsQ = useHoldingsQuery();
  const buyAuditQ = useBuyAuditQuery();
  const gateAuditQ = useGateAuditQuery();
  const conditionWeightsQ = useConditionWeightsQuery();
  const ocoOrdersQ = useOcoOrdersQuery();
  const reconcileQ = useReconcileQuery();
  const balanceQ = useBalanceQuery();

  const toggleMut = useToggleEngineMutation();
  const reconcileMut = useRunReconcileMutation();

  const accountSummary = useMemo(
    () => deriveAccountSummary(balanceQ.data),
    [balanceQ.data],
  );

  // ── 에러 우선순위: 엔진 상태 > 잔고 > 기타 ─────────────────────
  const error = useMemo<Error | null>(() => {
    const queries = [engineStatusQ, balanceQ, shadowTradesQ, watchlistQ, holdingsQ, buyAuditQ];
    for (const q of queries) {
      if (q.isError && q.error) return q.error as Error;
    }
    return null;
  }, [
    engineStatusQ.isError, engineStatusQ.error,
    balanceQ.isError, balanceQ.error,
    shadowTradesQ.isError, shadowTradesQ.error,
    watchlistQ.isError, watchlistQ.error,
    holdingsQ.isError, holdingsQ.error,
    buyAuditQ.isError, buyAuditQ.error,
  ]);

  const isLoading =
    engineStatusQ.isLoading ||
    shadowTradesQ.isLoading ||
    holdingsQ.isLoading ||
    buyAuditQ.isLoading;

  const isInitialLoading =
    engineStatusQ.isPending && shadowTradesQ.isPending && holdingsQ.isPending;

  // ── 액션 ─────────────────────────────────────────────────────
  // mutation 의 onError 에서 이미 toast.error 를 표시하지만, 호출부(특히
  // Arming 게이트)가 실패 여부로 분기할 수 있도록 에러는 다시 throw 한다.
  const toggleEngine = useCallback(async () => {
    await toggleMut.mutateAsync();
  }, [toggleMut]);

  const runReconcile = useCallback(async () => {
    try {
      await reconcileMut.mutateAsync();
    } catch (err) {
      console.error('[auto-trade] reconcile 실행 실패:', err);
    }
  }, [reconcileMut]);

  const loadPositionEvents = useCallback(
    async (positionId: string): Promise<PositionEvent[]> => {
      try {
        const evts = await autoTradeApi.getPositionEvents(positionId);
        return Array.isArray(evts) ? evts : [];
      } catch (err) {
        console.error('[auto-trade] position events 조회 실패:', err);
        return [];
      }
    },
    [],
  );

  const refetchAll = useCallback(() => {
    void qc.invalidateQueries({ queryKey: AUTO_TRADE_KEYS.all });
  }, [qc]);

  return {
    engineStatus: engineStatusQ.data ?? null,
    serverShadowTrades: shadowTradesQ.data ?? [],
    serverRecStats: recStatsQ.data ?? null,
    watchlist: watchlistQ.data ?? [],
    holdings: holdingsQ.data ?? [],
    buyAudit: buyAuditQ.data ?? null,
    gateAudit: gateAuditQ.data ?? null,
    conditionDebug: conditionWeightsQ.data ?? null,
    ocoOrders: ocoOrdersQ.data ?? { active: [], history: [] },
    reconcileData: reconcileQ.data ?? null,
    accountSummary,

    isLoading,
    isInitialLoading,
    error,

    toggleEngine,
    engineToggling: toggleMut.isPending,
    runReconcile,
    reconcileRunning: reconcileMut.isPending,
    loadPositionEvents,
    refetchAll,
  };
}
