/**
 * Auto-Trade Query Keys & Polling Policies — 단일 진실 소스
 *
 * 자동매매 대시보드의 모든 TanStack Query 쿼리 키와 폴링 정책을
 * 한 곳에 정의한다. 이 파일을 수정하면 전체 데이터 계층의
 * 주기·stale 시간이 일관되게 바뀐다.
 *
 * 정책 분리 근거:
 *   - engine/status → 실매매 심장박동. 5초 간격으로 빠른 UI 반영.
 *   - oco-orders   → 체결 시 반대 주문 취소 필요 → 15초 고빈도.
 *   - shadow-trades, holdings, buy-audit → 30~60초 중간 빈도.
 *   - condition-weights, rec-stats → 10분 저빈도 (분석 데이터).
 *
 * refetchInterval 은 함수형으로 호출 — 장외/문서 비활성 시 false 반환하여
 * 불필요한 네트워크 호출을 차단 (기존 usePolledFetch 규칙 계승).
 */

import { isMarketOpen } from '../../utils/marketTime';

export const AUTO_TRADE_KEYS = {
  all: ['auto-trade'] as const,
  engineStatus: ['auto-trade', 'engine-status'] as const,
  shadowTrades: ['auto-trade', 'shadow-trades'] as const,
  watchlist: ['auto-trade', 'watchlist'] as const,
  holdings: ['auto-trade', 'holdings'] as const,
  buyAudit: ['auto-trade', 'buy-audit'] as const,
  gateAudit: ['auto-trade', 'gate-audit'] as const,
  conditionWeights: ['auto-trade', 'condition-weights'] as const,
  ocoOrders: ['auto-trade', 'oco-orders'] as const,
  reconcile: ['auto-trade', 'reconcile'] as const,
  recommendationStats: ['auto-trade', 'rec-stats'] as const,
  balance: ['auto-trade', 'balance'] as const,
  engineGuards: ['auto-trade', 'engine-guards'] as const,
  positionEvents: (positionId: string) =>
    ['auto-trade', 'position-events', positionId] as const,
} as const;

const SECOND = 1_000;
const MINUTE = 60 * SECOND;

/**
 * 장중·문서 가시 상태일 때만 주기 폴링을 허용.
 * 장외/백그라운드에서는 false → TanStack이 타이머를 정지.
 */
function intervalIfActive(ms: number): number | false {
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return false;
  if (!isMarketOpen()) return false;
  return ms;
}

export const AUTO_TRADE_POLICY = {
  engineStatus: {
    staleTime: 3 * SECOND,
    refetchInterval: () => intervalIfActive(5 * SECOND),
  },
  ocoOrders: {
    staleTime: 10 * SECOND,
    refetchInterval: () => intervalIfActive(15 * SECOND),
  },
  shadowTrades: {
    staleTime: 15 * SECOND,
    refetchInterval: () => intervalIfActive(30 * SECOND),
  },
  buyAudit: {
    staleTime: 30 * SECOND,
    refetchInterval: () => intervalIfActive(60 * SECOND),
  },
  holdings: {
    staleTime: 30 * SECOND,
    refetchInterval: () => intervalIfActive(60 * SECOND),
  },
  balance: {
    staleTime: 30 * SECOND,
    refetchInterval: () => intervalIfActive(60 * SECOND),
  },
  watchlist: {
    staleTime: 60 * SECOND,
    refetchInterval: () => intervalIfActive(60 * SECOND),
  },
  gateAudit: {
    staleTime: 60 * SECOND,
    refetchInterval: () => intervalIfActive(2 * MINUTE),
  },
  reconcile: {
    staleTime: 60 * SECOND,
    refetchInterval: () => intervalIfActive(2 * MINUTE),
  },
  recommendationStats: {
    staleTime: 5 * MINUTE,
    refetchInterval: () => intervalIfActive(5 * MINUTE),
  },
  conditionWeights: {
    staleTime: 10 * MINUTE,
    refetchInterval: false as const,
  },
  engineGuards: {
    staleTime: 5 * SECOND,
    refetchInterval: () => intervalIfActive(10 * SECOND),
  },
} as const;
