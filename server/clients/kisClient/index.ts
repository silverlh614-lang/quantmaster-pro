/**
 * @responsibility kisClient 디렉토리 barrel — 분해된 9 모듈 단일 진입점
 *
 * ADR-0135 (PR-Refactor-3) — kisClient.ts 분해 후 외부 import 경로 호환 유지용.
 * server/clients/kisClient.ts (얇은 barrel) 가 본 파일을 경유 re-export.
 */

// ─── 외부 모듈 직접 re-export (rate limiter, mode guard) ────────────────────
export { getRateLimiterStats } from '../kisRateLimiter.js';
export type { KisApiPriority } from '../kisRateLimiter.js';
export { ModeIncompatibleError, assertModeCompatible } from '../kisModeGuard.js';

// ─── 도메인 타입 SSOT ──────────────────────────────────────────────────────
export type {
  KisPostIdempotency,
  KisPostOptions,
  KisInvestorFlow,
  KisStockProgramTrade,
  PrevClose,
  KisHolding,
  SellOrderOutcome,
  SellOrderResult,
  KisClientOverrides,
} from './types.js';

// ─── constants ─────────────────────────────────────────────────────────────
export {
  KIS_IS_REAL,
  KIS_BASE,
  BUY_TR_ID,
  SELL_TR_ID,
  CCLD_TR_ID,
  HAS_REAL_DATA_CLIENT,
  getKisBase,
} from './constants.js';

// ─── auth ──────────────────────────────────────────────────────────────────
export {
  refreshKisToken,
  getKisToken,
  getKisTokenRemainingHours,
  invalidateKisToken,
  getRealDataTokenRemainingHours,
  forceRefreshKisTokens,
} from './auth.js';

// ─── resilience ────────────────────────────────────────────────────────────
export {
  __testOnly,
  getCircuitBreakerStats,
  resetKisCircuits,
} from './resilience.js';

// ─── overrides ─────────────────────────────────────────────────────────────
export {
  setKisClientOverrides,
  hasKisClientOverrides,
} from './overrides.js';

// ─── http ──────────────────────────────────────────────────────────────────
export { kisGet, kisPost, realDataKisGet } from './http.js';

// ─── query (시세 조회) ─────────────────────────────────────────────────────
export {
  fetchKisInvestorFlow,
  fetchKisMarketSupply,
  fetchKisStockProgramTrade,
  fetchCurrentPrice,
  fetchKisPrevClose,
  fetchStockName,
} from './query.js';

// ─── holdings (잔고 조회) ──────────────────────────────────────────────────
export {
  isKisBalanceQueryAllowed,
  fetchAccountBalance,
  fetchKisHoldings,
} from './holdings.js';

// ─── orders (실주문 발송) ──────────────────────────────────────────────────
export {
  placeKisMarketBuyOrder,
  placeKisSellOrder,
  placeKisStopLossLimitOrder,
  placeKisTakeProfitLimitOrder,
  cancelKisOrder,
} from './orders.js';
