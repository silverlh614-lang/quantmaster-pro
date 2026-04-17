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

export interface EngineStatus {
  running: boolean;
  autoTradeEnabled: boolean;
  emergencyStop: boolean;
  mode: string;
  currentState: string;
  lastRun: string | null;
  lastScanAt: string | null;
  lastBuySignalAt: string | null;
  todayStats: { scans: number; buys: number; exits: number };
}

export interface EngineToggleResponse {
  running: boolean;
  emergencyStop: boolean;
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
  [extra: string]: unknown;
}

export type PositionEvent = Record<string, unknown>;

// ─── API 메서드 ─────────────────────────────────────────────────────────────

export const autoTradeApi = {
  // Engine
  getEngineStatus: () =>
    apiFetch<EngineStatus>('/api/auto-trade/engine/status'),
  toggleEngine: () =>
    apiFetch<EngineToggleResponse>('/api/auto-trade/engine/toggle', { method: 'POST' }),

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
