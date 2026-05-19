// @responsibility client-only P4 warning 타입 정의 모듈

export type ClientWarnDomain =
  | 'UI'
  | 'PRICE_SYNC'
  | 'REPORT_RENDER'
  | 'MARKET_OVERVIEW_CACHE'
  | 'TIME_FILTER'
  | 'CLIENT_DEBUG'
  | 'CLIENT_DATA';

export type ClientWarnCode =
  | 'P4_CLIENT_DEBUG_WARN'
  | 'P4_CLIENT_SAFE_PCT_CHANGE_DEGRADED'
  | 'P4_PRICE_SYNC_DEGRADED'
  | 'P4_STOCK_REPORT_RENDER_DEGRADED'
  | 'P4_MARKET_OVERVIEW_CACHE_DEGRADED'
  | 'P4_CLIENT_TIME_FILTER_DEGRADED'
  | 'P4_CLIENT_DATA_STALE';

export type ClientWarnPayload = {
  priority: 'P4';
  domain: ClientWarnDomain;
  code: ClientWarnCode;
  message: string;
  clientOnly: true;
  executionImpact: 'NONE';
  serverImpact: 'NONE';
  telegramAlert: false;
  dedupKey: string;
  ttlSec: 1800;
  details?: Record<string, unknown>;
};

export type ClientWarnInput = {
  domain: ClientWarnDomain;
  code: ClientWarnCode;
  message: string;
  dedupKey?: string;
  ttlSec?: number;
  details?: Record<string, unknown>;
};
