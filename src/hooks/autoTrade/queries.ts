/**
 * Auto-Trade TanStack Query Hooks
 *
 * 각 엔드포인트별 `useQuery` 래퍼. 정책은 `queryKeys.ts` 의
 * `AUTO_TRADE_POLICY` 에서 주입받아 일관성을 보장한다.
 *
 * 설계 원칙:
 *   - 훅은 "데이터와 상태"만 반환하고 UI 결정(렌더)은 하지 않는다.
 *   - 실패 시 throw 를 허용 — 호출부에서 isError 로 처리.
 *   - `enabled` 옵션으로 조건부 fetch 지원 (드로어 오픈 시 등).
 */

import { useQuery } from '@tanstack/react-query';
import {
  autoTradeApi,
  kisApi,
  systemApi,
  type EngineStatus,
  type BuyAuditData,
  type GateAuditData,
  type ConditionWeightsDebug,
  type OcoOrdersResponse,
  type ReconcileResponse,
  type RecommendationStats,
  type WatchlistEntry,
  type KisHolding,
  type ServerShadowTrade,
  type PositionEvent,
  type KisBalanceRaw,
} from '../../api';
import { AUTO_TRADE_KEYS, AUTO_TRADE_POLICY } from './queryKeys';

// ── 공통 옵션 빌더 ─────────────────────────────────────────────
// 각 policy 의 필드를 그대로 풀어 spread 해야 TanStack v5 가 useQuery 제네릭을
// 정확히 추론한다. (Pick<UseQueryOptions,...> 는 생성자 추론을 깨뜨림.)
type PolicyKey = keyof typeof AUTO_TRADE_POLICY;
function policyFor(key: PolicyKey) {
  const p = AUTO_TRADE_POLICY[key];
  return {
    staleTime: p.staleTime,
    refetchInterval: p.refetchInterval,
    refetchOnWindowFocus: false as const,
    retry: 1 as const,
  };
}

// ── Engine Status — 5초 주기 ────────────────────────────────────
export function useEngineStatusQuery() {
  return useQuery<EngineStatus>({
    queryKey: AUTO_TRADE_KEYS.engineStatus,
    queryFn: () => autoTradeApi.getEngineStatus(),
    ...policyFor('engineStatus'),
  });
}

// ── Shadow Trades — 30초 주기 ───────────────────────────────────
export function useShadowTradesQuery() {
  return useQuery<ServerShadowTrade[]>({
    queryKey: AUTO_TRADE_KEYS.shadowTrades,
    queryFn: () => autoTradeApi.getShadowTrades(),
    ...policyFor('shadowTrades'),
  });
}

// ── Watchlist — 60초 주기 ───────────────────────────────────────
export function useWatchlistQuery() {
  return useQuery<WatchlistEntry[]>({
    queryKey: AUTO_TRADE_KEYS.watchlist,
    queryFn: () => autoTradeApi.getWatchlist(),
    ...policyFor('watchlist'),
  });
}

// ── Holdings (KIS) — 60초 주기 ──────────────────────────────────
export function useHoldingsQuery() {
  return useQuery<KisHolding[]>({
    queryKey: AUTO_TRADE_KEYS.holdings,
    queryFn: async () => {
      const data = await kisApi.getHoldings();
      return Array.isArray(data) ? (data as KisHolding[]) : [];
    },
    ...policyFor('holdings'),
  });
}

// ── Buy Audit — 60초 주기 ───────────────────────────────────────
export function useBuyAuditQuery() {
  return useQuery<BuyAuditData>({
    queryKey: AUTO_TRADE_KEYS.buyAudit,
    queryFn: () => systemApi.getBuyAudit(),
    ...policyFor('buyAudit'),
  });
}

// ── Gate Audit — 2분 주기 ───────────────────────────────────────
export function useGateAuditQuery() {
  return useQuery<GateAuditData>({
    queryKey: AUTO_TRADE_KEYS.gateAudit,
    queryFn: () => systemApi.getGateAudit(),
    ...policyFor('gateAudit'),
  });
}

// ── Condition Weights — 저빈도 (수동 trigger) ───────────────────
export function useConditionWeightsQuery() {
  return useQuery<ConditionWeightsDebug>({
    queryKey: AUTO_TRADE_KEYS.conditionWeights,
    queryFn: () => autoTradeApi.getConditionWeightsDebug(),
    ...policyFor('conditionWeights'),
  });
}

// ── OCO Orders — 15초 주기 (치명적 리스크 경로) ─────────────────
export function useOcoOrdersQuery() {
  return useQuery<OcoOrdersResponse>({
    queryKey: AUTO_TRADE_KEYS.ocoOrders,
    queryFn: () => autoTradeApi.getOcoOrders(),
    placeholderData: { active: [], history: [] },
    ...policyFor('ocoOrders'),
  });
}

// ── Reconcile — 2분 주기 ────────────────────────────────────────
export function useReconcileQuery() {
  return useQuery<ReconcileResponse | null>({
    queryKey: AUTO_TRADE_KEYS.reconcile,
    queryFn: () => autoTradeApi.getReconcile(),
    ...policyFor('reconcile'),
  });
}

// ── Recommendation Stats — 5분 주기 ─────────────────────────────
export function useRecommendationStatsQuery() {
  return useQuery<RecommendationStats>({
    queryKey: AUTO_TRADE_KEYS.recommendationStats,
    queryFn: () => autoTradeApi.getRecommendationStats(),
    ...policyFor('recommendationStats'),
  });
}

// ── KIS Balance — 60초 주기 ─────────────────────────────────────
export function useBalanceQuery() {
  return useQuery<KisBalanceRaw>({
    queryKey: AUTO_TRADE_KEYS.balance,
    queryFn: () => kisApi.getBalance(),
    ...policyFor('balance'),
  });
}

// ── Position Events — on-demand (드로어에서만 fetch) ────────────
export function usePositionEventsQuery(positionId: string | null) {
  return useQuery<PositionEvent[]>({
    queryKey: AUTO_TRADE_KEYS.positionEvents(positionId ?? '__none__'),
    queryFn: async () => {
      if (!positionId) return [];
      const evts = await autoTradeApi.getPositionEvents(positionId);
      return Array.isArray(evts) ? evts : [];
    },
    enabled: Boolean(positionId),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}
