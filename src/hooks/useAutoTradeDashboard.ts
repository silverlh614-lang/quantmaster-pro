/**
 * useAutoTradeDashboard — 자동매매 대시보드에 필요한 모든 원격 상태·액션을
 *                        단일 훅으로 제공한다.
 *
 * 이전에는 `AutoTradePage` 안쪽에 12개 fetch 호출이 섞인 200+줄 짜리
 * useEffect 가 있어 컴포넌트를 비대화시키고 테스트를 막았다. 이 훅은:
 *   - 모든 원격 상태를 `useState` 로 보유하고,
 *   - `usePolledFetch` 로 통일된 폴링 규칙(장중·가시 + 60s)을 적용하며,
 *   - KIS 잔고 응답 → AccountSummary 가공을 포함한 파생 로직도 캡슐화한다.
 *
 * 컴포넌트는 반환값을 구조분해하여 렌더링에만 집중한다.
 */

import { useCallback, useState } from 'react';
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
} from '../api';
import { usePolledFetch } from './usePolledFetch';

export interface AccountSummary {
  totalEvalAmt: number;
  totalPnlAmt: number;
  totalPnlRate: number;
  availableCash: number;
}

const STARTING_CAPITAL = 100_000_000;

function deriveAccountSummary(
  balance: Awaited<ReturnType<typeof kisApi.getBalance>>,
): AccountSummary | null {
  const summary = balance?.output2?.[0];
  if (!summary) return null;
  const totalEvalAmt = Number(summary.tot_evlu_amt ?? 0);
  const availableCash = Number(summary.dnca_tot_amt ?? summary.prvs_rcdl_excc_amt ?? 0);
  const totalPnlAmt = totalEvalAmt - STARTING_CAPITAL;
  const totalPnlRate = (totalPnlAmt / STARTING_CAPITAL) * 100;
  return { totalEvalAmt, totalPnlAmt, totalPnlRate, availableCash };
}

export interface UseAutoTradeDashboardReturn {
  // ── remote state ─────────────────────────────────────────────
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

  // ── actions ──────────────────────────────────────────────────
  /** 엔진 ON/OFF 토글 (낙관적 업데이트 포함). */
  toggleEngine: () => Promise<void>;
  engineToggling: boolean;

  /** 수동 reconciliation 실행. */
  runReconcile: () => Promise<void>;
  reconcileRunning: boolean;

  /** 특정 포지션의 이벤트 타임라인 로드 (감사 트레일 모달용). */
  loadPositionEvents: (positionId: string) => Promise<PositionEvent[]>;

  /** 모든 원격 상태를 즉시 재조회 (강제 입력 후 동기화 등). */
  refetchAll: () => void;
}

export function useAutoTradeDashboard(): UseAutoTradeDashboardReturn {
  const [engineStatus, setEngineStatus] = useState<EngineStatus | null>(null);
  const [serverShadowTrades, setServerShadowTrades] = useState<ServerShadowTrade[]>([]);
  const [serverRecStats, setServerRecStats] = useState<RecommendationStats | null>(null);
  const [watchlist, setWatchlist] = useState<WatchlistEntry[]>([]);
  const [holdings, setHoldings] = useState<KisHolding[]>([]);
  const [buyAudit, setBuyAudit] = useState<BuyAuditData | null>(null);
  const [gateAudit, setGateAudit] = useState<GateAuditData | null>(null);
  const [conditionDebug, setConditionDebug] = useState<ConditionWeightsDebug | null>(null);
  const [ocoOrders, setOcoOrders] = useState<OcoOrdersResponse>({ active: [], history: [] });
  const [reconcileData, setReconcileData] = useState<ReconcileResponse | null>(null);
  const [accountSummary, setAccountSummary] = useState<AccountSummary | null>(null);

  const [engineToggling, setEngineToggling] = useState(false);
  const [reconcileRunning, setReconcileRunning] = useState(false);

  // ── 통합 fetch — 실패한 엔드포인트는 해당 위젯만 비우고 전체는 계속 동작 ──
  const fetchAll = useCallback(() => {
    autoTradeApi.getShadowTrades().then(setServerShadowTrades)
      .catch((err) => console.error('[auto-trade] shadow-trades 조회 실패:', err));
    autoTradeApi.getRecommendationStats().then(setServerRecStats)
      .catch((err) => console.error('[auto-trade] recommendation stats 조회 실패:', err));
    autoTradeApi.getWatchlist().then(setWatchlist)
      .catch((err) => console.error('[auto-trade] 워치리스트 조회 실패:', err));
    kisApi.getHoldings().then((data) => {
      if (Array.isArray(data)) setHoldings(data as KisHolding[]);
    }).catch((err) => console.error('[auto-trade] 보유종목 조회 실패:', err));
    systemApi.getBuyAudit().then(setBuyAudit)
      .catch((err) => console.error('[auto-trade] buy-audit 조회 실패:', err));
    systemApi.getGateAudit().then(setGateAudit)
      .catch((err) => console.error('[auto-trade] gate-audit 조회 실패:', err));
    autoTradeApi.getConditionWeightsDebug().then(setConditionDebug)
      .catch((err) => console.error('[auto-trade] condition-weights 조회 실패:', err));
    autoTradeApi.getEngineStatus().then(setEngineStatus)
      .catch((err) => console.error('[auto-trade] engine/status 조회 실패:', err));
    autoTradeApi.getOcoOrders().then(setOcoOrders).catch(() => {});
    autoTradeApi.getReconcile().then((d) => { if (d) setReconcileData(d); }).catch(() => {});
    kisApi.getBalance().then((data) => {
      const s = deriveAccountSummary(data);
      if (s) setAccountSummary(s);
    }).catch((err) => console.error('[auto-trade] KIS 잔고 조회 실패:', err));
  }, []);

  usePolledFetch(fetchAll);

  // ── 액션 ──────────────────────────────────────────────────────
  const toggleEngine = useCallback(async () => {
    if (engineToggling) return;
    setEngineToggling(true);
    try {
      const data = await autoTradeApi.toggleEngine();
      setEngineStatus((prev) =>
        prev ? { ...prev, running: data.running, emergencyStop: data.emergencyStop } : prev,
      );
    } catch (err) {
      console.error('[auto-trade] 엔진 토글 실패:', err);
    } finally {
      setEngineToggling(false);
    }
  }, [engineToggling]);

  const runReconcile = useCallback(async () => {
    setReconcileRunning(true);
    try {
      const d = await autoTradeApi.runReconcile();
      setReconcileData({ last: d, dataIntegrityBlocked: d.dataIntegrityBlocked });
    } catch (err) {
      console.error('[auto-trade] reconcile 실행 실패:', err);
    } finally {
      setReconcileRunning(false);
    }
  }, []);

  const loadPositionEvents = useCallback(async (positionId: string): Promise<PositionEvent[]> => {
    try {
      const evts = await autoTradeApi.getPositionEvents(positionId);
      return Array.isArray(evts) ? evts : [];
    } catch (err) {
      console.error('[auto-trade] position events 조회 실패:', err);
      return [];
    }
  }, []);

  return {
    engineStatus,
    serverShadowTrades,
    serverRecStats,
    watchlist,
    holdings,
    buyAudit,
    gateAudit,
    conditionDebug,
    ocoOrders,
    reconcileData,
    accountSummary,
    toggleEngine,
    engineToggling,
    runReconcile,
    reconcileRunning,
    loadPositionEvents,
    refetchAll: fetchAll,
  };
}
