// ─── stockService.ts — 순수 re-export 허브 ─────────────────────────────────
// 모든 구현은 src/services/stock/ 하위 모듈에 위치합니다.

import {
  BacktestResult,
  BacktestPosition,
  BacktestPortfolioState,
  BacktestDailyLog,
  Portfolio,
} from "../types/quant";

export type {
  BacktestResult,
  BacktestPosition,
  BacktestPortfolioState,
  BacktestDailyLog,
  Portfolio
};

export {
  type WalkForwardAnalysis,
  type NewsArticle,
  type ChartPattern,
  type StockRecommendation,
  type AdvancedAnalysisResult,
  type MarketDataPoint,
  type SnsSentiment,
  type EuphoriaSignal,
  type GlobalEtfMonitoring,
  type MarketOverview,
  type MarketContext,
  type MarketPhaseLog,
  type RecommendationResponse,
  type StockFilters,
} from './stock/types';

// ─── historicalData ────────────────────────────────────────────────────────
export { fetchHistoricalData, backtestPortfolio, runAdvancedAnalysis, performWalkForwardAnalysis } from './stock/historicalData';

// ─── enrichment / priceSync ────────────────────────────────────────────────
export { calculateTranchePlan, enrichStockWithRealData } from './stock/enrichment';
export { fetchCurrentPrice, syncStockPrice, syncStockPriceKIS } from './stock/priceSync';

// ─── stockSearch / reportUtils ────────────────────────────────────────────
export { clearSearchCache, searchStock } from './stock/stockSearch';
export { parsePortfolioFile, generateReportSummary } from './stock/reportUtils';

// ─── marketOverview ───────────────────────────────────────────────────────
export { syncMarketOverviewIndices, getMarketOverview, fetchMarketIndicators } from './stock/marketOverview';

// ─── recommendations ──────────────────────────────────────────────────────
export { getStockRecommendations } from './stock/recommendations';

// ─── quantScreener ────────────────────────────────────────────────────────
export { runQuantitativeScreening, scanDartDisclosures, detectSilentAccumulation } from './stock/quantScreener';

// ─── macroIntel ───────────────────────────────────────────────────────────
export {
  getEconomicRegime,
  getSmartMoneyFlow,
  getExportMomentum,
  getGeopoliticalRiskScore,
  getCreditSpreads,
  getExtendedEconomicRegime,
  fetchMacroEnvironment,
} from './stock/macroIntel';

// ─── globalIntel ──────────────────────────────────────────────────────────
export {
  trackThemeToKoreaValueChain,
  getGlobalCorrelationMatrix,
  getGlobalMultiSourceData,
  getNewsFrequencyScores,
  getSupplyChainIntelligence,
  getSectorOrderIntelligence,
  getFinancialStressIndex,
  getFomcSentimentAnalysis,
} from './stock/globalIntel';

// ─── batchIntel ───────────────────────────────────────────────────────────
export {
  type BatchGlobalIntelResult,
  type BatchSectorIntelResult,
  type BatchMarketIntelResult,
  getBatchGlobalIntel,
  getBatchSectorIntel,
  getBatchMarketIntel,
} from './stock/batchIntel';
