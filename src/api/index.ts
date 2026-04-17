export { apiFetch, apiFetchSafe, ApiError } from './client';
export type { ApiRequestOptions } from './client';

export {
  autoTradeApi,
  kisApi,
  systemApi,
  sessionApi,
  shadowApi,
} from './autoTradeClient';

export type {
  WatchlistEntry,
  WatchlistAddPayload,
  EngineStatus,
  EngineToggleResponse,
  BuyAuditData,
  GateAuditData,
  OcoOrderPair,
  OcoOrdersResponse,
  ReconcileSummary,
  ReconcileResponse,
  RecommendationStats,
  ConditionWeightsDebug,
  DartAlert,
  TradingSettings,
  ServerShadowTrade,
  PositionEvent,
  KisHolding,
  KisBalanceRaw,
  KisTokenStatus,
  SessionStateResponse,
} from './autoTradeClient';
