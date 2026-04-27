// @responsibility index API 클라이언트 모듈
export { apiFetch, apiFetchSafe, ApiError } from './client';
export type { ApiRequestOptions } from './client';

export {
  autoTradeApi,
  kisApi,
  systemApi,
  sessionApi,
  shadowApi,
  alertsApi,
} from './autoTradeClient';

export type {
  WatchlistEntry,
  WatchlistAddPayload,
  EngineStatus,
  EngineHeartbeat,
  EngineToggleResponse,
  EngineGuardsState,
  PendingApprovalEntry,
  PendingApprovalsResponse,
  GlobalSignalsResponse,
  BuyAuditData,
  GateAuditData,
  OcoOrderPair,
  OcoOrdersResponse,
  ReconcileSummary,
  ReconcileResponse,
  RecommendationStats,
  ConditionWeightsDebug,
  KillSwitchAssessmentDto,
  KillSwitchRecordDto,
  AlertFeedEntry,
  AlertFeedPriority,
  AlertFeedResponse,
  DartAlert,
  TradingSettings,
  ServerShadowTrade,
  PositionEvent,
  ShadowForceInputPatch,
  ShadowForceInputResponse,
  KisHolding,
  KisBalanceRaw,
  KisTokenStatus,
  SessionStateResponse,
} from './autoTradeClient';
