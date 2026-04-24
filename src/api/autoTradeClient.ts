/**
 * Auto-Trade REST 클라이언트 — `/api/auto-trade/*` 와 그에 준하는
 * 자동매매 도메인 엔드포인트를 타입 있는 함수로 노출한다.
 *
 * 호출부(AutoTradePage, hooks, components)는 fetch 시그니처·URL을 직접
 * 다루지 않고, 이 모듈의 도메인 메서드만 사용해야 한다.
 */

import { apiFetch, apiFetchSafe } from './client';

// ─── 공용 타입 (UI/서버 공유 스키마 미러) ───────────────────────────────────

export interface WatchlistEntry {
  code: string;
  name: string;
  entryPrice: number;
  stopLoss: number;
  targetPrice: number;
  addedAt: string;
  gateScore?: number;
  addedBy: 'AUTO' | 'MANUAL' | 'DART';
  isFocus?: boolean;
  rrr?: number;
  sector?: string;
}

export interface WatchlistAddPayload {
  code: string;
  name: string;
  entryPrice: number;
  stopLoss: number;
  targetPrice: number;
}

export interface EngineHeartbeat {
  at: string | null;
  source: string;
  ageMs: number | null;
}

export interface KillSwitchAssessmentDto {
  shouldDowngrade: boolean;
  triggers: string[];
  details: {
    dailyLossPct: number;
    ocoCancelFails: number;
    kisTokenFailRecent: boolean;
    vkospiSurgePct: number;
  };
}

export interface KillSwitchRecordDto {
  at: string;
  from: string;
  to: string;
  reason: string;
  triggers: string[];
}

export interface EngineStatus {
  running: boolean;
  autoTradeEnabled: boolean;
  emergencyStop: boolean;
  /**
   * KIS 실시간 호가 WebSocket 연결 상태.
   * UI "브로커 연결" 판정의 진실 소스. 서버의 buildEngineStatusSnapshot 가 내려준다.
   */
  kisStreamConnected?: boolean;
  mode: string;
  currentState: string;
  lastRun: string | null;
  lastScanAt: string | null;
  lastBuySignalAt: string | null;
  /** Phase 3: 스케줄러 tick heartbeat — null 이면 아직 1회도 돌지 않음. */
  heartbeat?: EngineHeartbeat;
  /** Phase 3: Kill Switch — 최근 강등 기록 + 현재 평가. */
  killSwitch?: {
    last: KillSwitchRecordDto | null;
    current: KillSwitchAssessmentDto;
  };
  todayStats: { scans: number; buys: number; exits: number };
}

export interface EngineToggleResponse {
  running: boolean;
  emergencyStop: boolean;
}

export interface EngineGuardsState {
  blockNewBuy: boolean;
  autoTradingPaused: boolean;
  manageOnly: boolean;
  emergencyStop: boolean;
}

export interface PendingApprovalEntry {
  tradeId: string;
  stockCode: string;
  stockName: string;
  currentPrice: number;
  quantity: number;
  stopLoss: number;
  targetPrice: number;
  createdAt: number;
  ageMs: number;
}

export interface PendingApprovalsResponse {
  entries: PendingApprovalEntry[];
}

/**
 * 글로벌 에이전트별 최근 스냅샷. 타입이 에이전트마다 상이해 unknown 으로 수신.
 * UI 는 표시할 필드를 가드 로 방어적으로 읽는다(형식 변경에 강한 렌더링).
 */
export interface GlobalSignalsResponse {
  adrGap: {
    lastSentAt: string;
    lastGaps: Record<string, number>;
  } | null;
  preMarket: {
    createdAt: string;
    trigger: string;
    biasScore: number;
    biasDirection: 'BULL' | 'BEAR' | 'NEUTRAL';
    snapshots: Array<{
      symbol: string;
      label: string;
      last: number | null;
      changePct: number | null;
      weight: number;
    }>;
  } | null;
  dxy: {
    createdAt: string;
    direction: 'STRENGTH' | 'WEAKNESS';
    severity: 'CONFIRMED' | 'PRELIMINARY';
    flowBias: 'FOREIGN_OUTFLOW' | 'FOREIGN_INFLOW' | 'UNCLEAR';
    reading: {
      last: number;
      change1d: number;
      change5d: number;
      krwChange: number | null;
      ewyChange: number | null;
    };
  } | null;
  sectorEtf: {
    createdAt: string;
    topBullish: { symbol: string; label: string; composite: number | null } | null;
    topBearish: { symbol: string; label: string; composite: number | null } | null;
    momentums?: Array<{ symbol: string; label: string; composite: number | null }>;
  } | null;
  fetchedAt: string;
}

export interface BuyAuditData {
  watchlistCount: number;
  focusCount: number;
  buyListCount: number;
  regime: string;
  vixGating: { noNewEntry: boolean; kellyMultiplier: number; reason: string };
  fomcGating: {
    noNewEntry: boolean; phase: string; kellyMultiplier: number; description: string;
    nextFomcDate?: string | null; unblockAt?: string | null;
  };
  emergencyStop: boolean;
  lastScanAt: string | null;
  rejectedStocks: { code: string; name: string; reason: string }[];
}

export type GateAuditData = Record<string, { passed: number; failed: number }>;

export interface OcoOrderPair {
  id: string;
  stockCode: string;
  stockName: string;
  quantity: number;
  entryPrice: number;
  stopPrice: number;
  stopStatus: 'PENDING' | 'FILLED' | 'CANCELLED' | 'FAILED';
  profitPrice: number;
  profitStatus: 'PENDING' | 'FILLED' | 'CANCELLED' | 'FAILED';
  createdAt: string;
  resolvedAt?: string;
  status: 'ACTIVE' | 'STOP_FILLED' | 'PROFIT_FILLED' | 'BOTH_CANCELLED' | 'ERROR';
}

export interface OcoOrdersResponse {
  active: OcoOrderPair[];
  history: OcoOrderPair[];
}

export interface ReconcileSummary {
  date: string;
  ranAt: string;
  shadowLogCloses: number;
  tradeEventCloses: number;
  shadowTradeCloses: number;
  notificationsLogged: number;
  mismatchCount: number;
  mismatches: { positionId: string; stockCode: string; stockName?: string; issue: string }[];
  integrityOk: boolean;
  dataIntegrityBlocked?: boolean;
}

export interface ReconcileResponse {
  last: ReconcileSummary | null;
  dataIntegrityBlocked: boolean;
}

export interface RecommendationStats {
  month?: string;
  winRate?: number;
  avgReturn?: number;
  strongBuyWinRate?: number;
  total?: number;
  trades?: {
    month: string;
    startingCapital: number;
    total: number;
    wins: number;
    losses: number;
    winRate: number;
    totalRealizedPnl: number;
    totalReturnPct: number;
    avgReturnPct: number;
  };
}

export interface ConditionWeightsDebug {
  globalWeights: Record<string, number>;
  defaults: Record<string, number>;
  conditionStats30d: Record<
    string,
    { totalAppearances: number; wins: number; losses: number; hitRate: number; avgReturn: number }
  >;
  recentRecordsCount: number;
  period: { from: string; to: string };
}

export interface DartAlert {
  corp_name: string;
  stock_code: string;
  report_nm: string;
  rcept_dt: string;
  sentiment: string;
}

export interface TradingSettings {
  buyCondition: { gatePassRequired: boolean; minScoreThreshold: number };
  autoStopLoss: { enabled: boolean; level1: number; level2: number; level3: number };
  positionLimit: { enabled: boolean; maxSingleStockPercent: number };
  tradingHours: { enabled: boolean; startTime: string; endTime: string };
  ocoAutoRegister: { enabled: boolean };
  updatedAt: string;
}

// ServerShadowTrade — 서버가 돌려주는 shadow trade 레코드의 브라우저측 미러.
// 일부 필드는 서버 버전에 따라 누락될 수 있으므로 optional 로 선언한다.
// (세부 fills 구조는 호출부에서 필요에 따라 좁힌다.)
export interface ServerShadowTrade {
  id?: string;
  stockCode: string;
  stockName: string;
  status: 'PENDING' | 'ACTIVE' | 'HIT_TARGET' | 'HIT_STOP' | 'REJECTED' | string;
  signalTime: string;
  signalPrice?: number;
  shadowEntryPrice?: number;
  quantity?: number;
  originalQuantity?: number;
  stopLoss?: number;
  targetPrice?: number;
  exitPrice?: number;
  exitTime?: string;
  resolvedAt?: string;
  returnPct?: number;
  fills?: Array<{
    id?: string;
    type: 'BUY' | 'SELL';
    subType?: string;
    qty: number;
    price?: number;
    pnl?: number;
    pnlPct?: number;
    reason?: string;
    exitRuleTag?: string;
    timestamp: string;
  }>;
  /** Phase 3 — 진입 시점 Kelly 의사결정 스냅샷 (레거시 포지션은 undefined). */
  entryKellySnapshot?: {
    tier: 'CONVICTION' | 'STANDARD' | 'PROBING';
    signalGrade: 'STRONG_BUY' | 'BUY' | 'HOLD' | 'PROBING';
    rawKellyMultiplier: number;
    effectiveKelly: number;
    fractionalCap: number;
    ipsAtEntry: number;
    regimeAtEntry: string;
    accountRiskBudgetPctAtEntry: number;
    confidenceModifier: number;
    snapshotAt: string;
  };
  [extra: string]: unknown;
}

export type PositionEvent = Record<string, unknown>;

export interface ShadowForceInputPatch {
  quantity?: number;
  shadowEntryPrice?: number;
  signalPrice?: number;
  stopLoss?: number;
  targetPrice?: number;
  reason?: string;
}

export interface ShadowForceInputResponse {
  ok: boolean;
  changed: boolean;
  applied?: Record<string, { before: number; after: number }>;
  trade?: ServerShadowTrade;
}

// ─── API 메서드 ─────────────────────────────────────────────────────────────

export const autoTradeApi = {
  // Engine
  getEngineStatus: () =>
    apiFetch<EngineStatus>('/api/auto-trade/engine/status'),
  toggleEngine: () =>
    apiFetch<EngineToggleResponse>('/api/auto-trade/engine/toggle', { method: 'POST' }),
  /**
   * 비상정지 강제 발동 (멱등). `toggleEngine` 과 달리 이미 정지 상태여도
   * 재개되지 않는다 — 사고 방지용 단방향 액션.
   */
  emergencyStop: () =>
    apiFetch<EngineToggleResponse>('/api/auto-trade/engine/emergency-stop', { method: 'POST' }),

  /** EmergencyActionsPanel 가드 상태 — 신규매수 차단·일시정지·보유만 관리. */
  getEngineGuards: () =>
    apiFetchSafe<EngineGuardsState>(
      '/api/auto-trade/engine/guards',
      {},
      { blockNewBuy: false, autoTradingPaused: false, manageOnly: false, emergencyStop: false },
    ),
  setBlockNewBuy: (enabled: boolean) =>
    apiFetch<{ blockNewBuy: boolean }>(
      '/api/auto-trade/engine/block-new-buy',
      { method: 'POST', json: { enabled } },
    ),
  setPauseAutoTrading: (enabled: boolean) =>
    apiFetch<{ autoTradingPaused: boolean }>(
      '/api/auto-trade/engine/pause',
      { method: 'POST', json: { enabled } },
    ),
  setManageOnly: (enabled: boolean) =>
    apiFetch<{ manageOnly: boolean; blockNewBuy: boolean }>(
      '/api/auto-trade/engine/manage-only',
      { method: 'POST', json: { enabled } },
    ),

  // Signals — UI-side approval / reject
  getPendingApprovals: () =>
    apiFetchSafe<PendingApprovalsResponse>(
      '/api/auto-trade/signals/pending',
      {},
      { entries: [] },
    ),
  approveSignal: (tradeId: string) =>
    apiFetch<{ ok: boolean; action: 'APPROVE'; tradeId: string }>(
      `/api/auto-trade/signals/${encodeURIComponent(tradeId)}/approve`,
      { method: 'POST' },
    ),
  rejectSignal: (tradeId: string, reason: string) =>
    apiFetch<{ ok: boolean; action: 'REJECT'; tradeId: string; reason: string }>(
      `/api/auto-trade/signals/${encodeURIComponent(tradeId)}/reject`,
      { method: 'POST', json: { reason } },
    ),

  /** 오늘의 글로벌 신호 요약 — 진단 탭 하단 카드용. 실패해도 전체 null 로 안전 복귀. */
  getGlobalSignals: () =>
    apiFetchSafe<GlobalSignalsResponse>(
      '/api/alerts/global-signals',
      {},
      {
        adrGap: null,
        preMarket: null,
        dxy: null,
        sectorEtf: null,
        fetchedAt: new Date().toISOString(),
      },
    ),

  // Watchlist
  getWatchlist: () =>
    apiFetch<WatchlistEntry[]>('/api/auto-trade/watchlist'),
  addToWatchlist: (entry: WatchlistAddPayload) =>
    apiFetch<void>('/api/auto-trade/watchlist', { method: 'POST', json: entry }),
  removeFromWatchlist: (code: string) =>
    apiFetch<void>(`/api/auto-trade/watchlist/${encodeURIComponent(code)}`, { method: 'DELETE' }),

  // Shadow trades
  getShadowTrades: () =>
    apiFetch<ServerShadowTrade[]>('/api/auto-trade/shadow-trades'),
  syncShadowTrade: (trade: unknown) =>
    apiFetch<void>('/api/auto-trade/shadow-trades', { method: 'POST', json: trade }),
  /**
   * Shadow 불일치 상황에서 수량·가격 등을 강제 입력하여 서버 레코드와
   * 동기화한다. 허용 필드: quantity, shadowEntryPrice, signalPrice,
   * stopLoss, targetPrice.
   */
  forceUpdateShadowTrade: (
    id: string,
    patch: ShadowForceInputPatch,
  ) =>
    apiFetch<ShadowForceInputResponse>(
      `/api/auto-trade/shadow-trades/${encodeURIComponent(id)}/force`,
      { method: 'PATCH', json: patch },
    ),

  // Recommendations
  getRecommendationStats: () =>
    apiFetch<RecommendationStats>('/api/auto-trade/recommendations/stats'),

  // OCO & Reconciliation
  getOcoOrders: () =>
    apiFetchSafe<OcoOrdersResponse>(
      '/api/auto-trade/oco-orders',
      {},
      { active: [], history: [] },
    ),
  getReconcile: () =>
    apiFetchSafe<ReconcileResponse | null>('/api/auto-trade/reconcile', {}, null),
  runReconcile: () =>
    apiFetch<ReconcileSummary & { dataIntegrityBlocked: boolean }>(
      '/api/auto-trade/reconcile', { method: 'POST' },
    ),

  // Diagnostics
  getConditionWeightsDebug: () =>
    apiFetch<ConditionWeightsDebug>('/api/auto-trade/condition-weights/debug'),
  getDartAlerts: () =>
    apiFetch<DartAlert[]>('/api/auto-trade/dart-alerts'),
  getPositionEvents: (positionId: string) =>
    apiFetch<PositionEvent[]>(
      `/api/auto-trade/positions/${encodeURIComponent(positionId)}/events`,
    ),

  // Settings
  getTradingSettings: () =>
    apiFetch<Partial<TradingSettings>>('/api/auto-trade/trading-settings'),
  saveTradingSettings: (settings: TradingSettings) =>
    apiFetch<void>('/api/auto-trade/trading-settings', { method: 'POST', json: settings }),
};

// ─── 인접 도메인 (UI에서 자동매매와 함께 쓰이는 엔드포인트) ─────────────────

export interface KisHolding {
  pdno: string;
  prdt_name: string;
  hldg_qty: string;
  pchs_avg_pric: string;
  prpr: string;
  evlu_pfls_rt: string;
  evlu_pfls_amt: string;
}

export interface KisBalanceRaw {
  output1?: KisHolding[];
  output2?: Array<{
    tot_evlu_amt?: string | number;
    dnca_tot_amt?: string | number;
    prvs_rcdl_excc_amt?: string | number;
  }>;
  output?: { dnca_tot_amt?: string | number };
}

export interface KisTokenStatus {
  valid: boolean;
  expiresIn?: string;
  reason?: string;
}

export interface BuyAuditResponse extends BuyAuditData {}

export const kisApi = {
  getBalance: () => apiFetch<KisBalanceRaw>('/api/kis/balance'),
  getHoldings: () => apiFetch<KisHolding[] | unknown>('/api/kis/holdings'),
  getTokenStatus: () => apiFetch<KisTokenStatus>('/api/kis/token-status'),
  getPrice: (code: string) =>
    apiFetch<{ output?: { stck_prpr?: string } }>('/api/kis/price', { query: { code } }),
  testOrder: () =>
    apiFetch<{
      rt_cd: string; msg1?: string; error?: string;
      output?: { ORD_NO?: string }; currentPrice?: number;
    }>('/api/kis/order/test', { method: 'POST' }),
  getTodayFills: (code: string) =>
    apiFetch<unknown>('/api/kis/fills/today', { query: { code } }),
};

export const systemApi = {
  getBuyAudit: () => apiFetch<BuyAuditData>('/api/system/buy-audit'),
  getGateAudit: () => apiFetch<GateAuditData>('/api/system/gate-audit'),
};

export interface SessionStateResponse {
  restored: boolean;
  savedAt?: string;
  gateWeights?: Record<string, number>;
  universeSelection?: string[];
  initialInvestment?: number;
}

export const sessionApi = {
  get: () => apiFetch<SessionStateResponse>('/api/session-state'),
  save: (state: unknown) =>
    apiFetch<void>('/api/session-state', { method: 'POST', json: state }),
};

// Shadow account 는 `/api/shadow/account` 경로 — 자동매매 UI 의 주요 의존처.
export const shadowApi = {
  getAccount: <T = unknown>() => apiFetch<T>('/api/shadow/account'),
};

// ─── Phase 5: Alerts Feed (텔레그램 ↔ UI 동기화) ──────────────────────────

export type AlertFeedPriority = 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW' | 'INFO';

export interface AlertFeedEntry {
  id: string;
  at: string;
  priority: AlertFeedPriority;
  text: string;
  dedupeKey?: string;
}

export interface AlertFeedResponse {
  entries: AlertFeedEntry[];
  unread: number;
}

export const alertsApi = {
  getFeed: (opts: { sinceId?: string; limit?: number; priority?: AlertFeedPriority[] } = {}) =>
    apiFetch<AlertFeedResponse>('/api/alerts/feed', {
      query: {
        ...(opts.sinceId ? { sinceId: opts.sinceId } : {}),
        ...(opts.limit ? { limit: String(opts.limit) } : {}),
        ...(opts.priority?.length ? { priority: opts.priority.join(',') } : {}),
      },
    }),
};

// ─── 사용자 관심종목 (프론트 Zustand ↔ 서버 동기화) ──────────────────────
// 자동매매 워치리스트(`autoTradeApi.getWatchlist`) 와 분리된 경량 북마크 저장소.
// 기기 간 동일 관심종목이 보이도록 서버에 영속화한다.

export interface UserWatchlistItem {
  code: string;
  name: string;
  watchedAt: string;
  watchedPrice?: number;
  currentPrice?: number;
  signalType?: string;
  sector?: string;
  gateScore?: number;
  [extra: string]: unknown;
}

export interface UserWatchlistResponse {
  items: UserWatchlistItem[];
}

export const userWatchlistApi = {
  getAll: () =>
    apiFetchSafe<UserWatchlistResponse>(
      '/api/user-watchlist',
      {},
      { items: [] },
    ),
  replaceAll: (items: UserWatchlistItem[]) =>
    apiFetch<{ ok: boolean; count: number; items: UserWatchlistItem[] }>(
      '/api/user-watchlist',
      { method: 'PUT', json: { items } },
    ),
  toggle: (item: UserWatchlistItem) =>
    apiFetch<{ ok: boolean; action: 'ADDED' | 'REMOVED'; items: UserWatchlistItem[] }>(
      '/api/user-watchlist/toggle',
      { method: 'POST', json: item },
    ),
  remove: (code: string) =>
    apiFetch<{ ok: boolean; items: UserWatchlistItem[] }>(
      `/api/user-watchlist/${encodeURIComponent(code)}`,
      { method: 'DELETE' },
    ),
};
