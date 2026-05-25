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
  KisCreditBalanceRankingRow,
  KisDailyCreditBalance,
  KisDailyLoanTransaction,
  KisDailyShortSale,
  KisForeignInstitutionTotal,
  KisInvestorDailyByMarket,
  KisInvestorTimeByMarket,
  KisInvestorTradeByStockDaily,
  KisInvestorTrendEstimate,
  KisInvestorFlow,
  KisInvestorFlowActualRowCarrier,
  KisInvestorFlowRawRow,
  KisStockProgramTrade,
  KisMarketProgramTrade,
  KisShortSaleRankingRow,
  KisSectorIndexDaily,
  KisSectorIndexDailyRow,
  KisIndexQuoteClientStatus,
  KisSectorIndexVerifyMode,
  KisSectorIndexVerifyTransportStage,
  KisSectorIndexVerifyVariantPolicy,
  KisSectorIndexCurrentPriceProbeAttempt,
  KisSectorIndexCurrentPriceProbeResult,
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
export { kisGet, kisPost, realDataKisGet, isKisChartCooldownActive, getKisChartCooldownRemainingMs } from './http.js';

// ─── query (시세 조회) ─────────────────────────────────────────────────────
export { fetchKisInvestorFlow } from './investorFlowStrict.js';

// ─── investor flow → supplyProviderHealth bridge SSOT (ADR-0517) ──────────
export {
  buildSupplyProviderHealthFromKisFlow,
  applySupplyProviderHealthFromKisFlow,
  isKisForensicFlowWiringDisabled,
} from './investorFlowSupplyHealthBridge.js';
export type { SupplyProviderHealthFromKisFlow } from './investorFlowSupplyHealthBridge.js';
export {
  fetchKisMarketSupply,
  fetchKisStockProgramTrade,
  fetchKisMarketProgramTrade,
  fetchKisDailyShortSale,
  fetchKisShortSaleRanking,
  fetchKisDailyLoanTransaction,
  fetchKisDailyCreditBalance,
  fetchKisCreditBalanceRanking,
  fetchKisInvestorTradeByStockDaily,
  fetchKisForeignInstitutionTotal,
  fetchKisInvestorTrendEstimate,
  fetchKisInvestorDailyByMarket,
  fetchKisInvestorTimeByMarket,
  fetchCurrentPrice,
  fetchKisPrevClose,
  fetchStockName,
  fetchKisStockFullQuote,
  fetchKisStockDailyBars,
  fetchKisSectorIndexDaily,
  fetchKisSectorIndexCurrentPrice,
  fetchKisSectorIndexCurrentPriceProbe,
  isKisSectorIndexDailyDisabled,
  isKisSectorIndexCurrentDisabled,
  getKisSectorIndexVerifyMode,
  KIS_SECTOR_INDEX_ISCD,
  KIS_SECTOR_ISCD_MAP,
} from './query.js';
export type { KisSectorIscdMapRow, KisStockFullQuote, KisStockDailyBar } from './query.js';

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

export {
  submitBuyOrder,
  submitSellOrder,
  submitOcoOrder,
  cancelOrder,
  queryOrderStatus,
} from './orderGateway/kisOrderGateway.js';
export type {
  OrderGatewayResult,
  KisBuyOrderIntent,
  KisSellOrderIntent,
  KisOcoOrderIntent,
  KisCancelOrderIntent,
  KisOrderStatusQueryIntent,
} from './orderGateway/kisOrderTypes.js';

export { kisHttpClient } from './core/kisHttpClient.js';
export type { KisCoreResult } from './core/kisCoreResultNormalizer.js';
export {
  classifyKisRequest,
  isCoreKisPriority,
  isDiagnosticKisPriority,
} from './core/kisRequestClassifier.js';
export type { KisRequestPriority, KisRequestClassification } from './core/kisRequestClassifier.js';
export { getKisProviderHealthSnapshot } from './core/kisProviderHealth.js';

// ─── 배치 시세 조회 (ADR-0519 Phase 5) ────────────────────────────────────────
export { fetchKisMultiStockQuote } from './queryMultiPrice.js';

// ─── 거래량순위 유니버스 스캔 (ADR-0519 Phase 5) ───────────────────────────────
export { fetchKisVolumeRanking } from './queryVolumeRanking.js';
export type { KisVolumeRankEntry } from './queryVolumeRanking.js';
