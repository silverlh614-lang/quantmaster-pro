/**
 * @responsibility 서버 측 자기학습 시리즈 (PR-L~O) 통합 barrel — drift 차단 진입점
 *
 * ADR-0032 (PR-P): PR-L (Rejection Tracker) / PR-M (Twin Portfolio) / PR-N
 * (Latent Signal Scorer) / PR-O (Order Type Optimizer + Slippage History)
 * 의 핵심 export 를 단일 진입점으로 re-export. 새 로직 0 — re-export 만.
 *
 * 클라이언트 측 PR-A~K 는 src/services/quant/selfLearning.ts 별도 barrel.
 */

// ─── PR-L Rejection Universe Tracker ────────────────────────────────────────
export {
  recordRejection,
  refreshRejectionShadow,
  summarizeRejectionShadow,
  getAllRejectionShadow,
  addBusinessDays,
  REJECTION_NEAR_MISS_MIN,
  REJECTION_NEAR_MISS_MAX,
  REJECTION_GATE_THRESHOLD,
  TRACK_BUSINESS_DAYS,
  REJECTION_SHADOW_MAX,
  type RejectionShadowEntry,
  type RejectionRecordInput,
  type RejectionShadowSummary,
} from './rejectionShadowTracker.js';

// ─── PR-M Counterfactual Twin Portfolio ─────────────────────────────────────
export {
  recordTwinEntries,
  refreshTwinPortfolio,
  compareTwinsVsReal,
  detectPromotion,
  getAllTwinEntries,
  TWIN_POLICIES,
  ALL_TWIN_KEYS,
  TWIN_HORIZON_DAYS,
  TWIN_EQUAL_WEIGHT,
  TWIN_PORTFOLIO_MAX,
  PROMOTION_CONSECUTIVE_WEEKS,
  type TwinKey,
  type TwinPolicy,
  type TwinEntry,
  type TwinCandidateInput,
  type TwinStats,
  type TwinComparisonResult,
} from './counterfactualTwinPortfolio.js';

// ─── PR-N Latent Signal Scorer (server/screener) ────────────────────────────
export {
  computeVcpScore,
  computeLatentCatalystScore,
  combinedSignalGrade,
  VCP_RS_THRESHOLD,
  LATENT_CATALYST_THRESHOLD,
  WEAK_SIGNAL_THRESHOLD,
  type VcpInput,
  type VcpScoreResult,
  type LatentCatalystInput,
  type LatentCatalystResult,
  type CombinedSignalGrade,
} from '../screener/latentSignalScorer.js';

// ─── PR-O Order Type Optimizer + Slippage History ──────────────────────────
export {
  decideOrderType,
  requiresUnsafeIdempotency,
  STRONG_BREAKOUT_VOLUME_Z,
  STRONG_BREAKOUT_PRICE_MOMENTUM_PCT,
  HIGH_SLIPPAGE_THRESHOLD,
  SLIPPAGE_MIN_SAMPLE,
  AGGRESSIVE_LIMIT_OFFSET_TICKS,
  CHASE_WAIT_SECONDS,
  CHASE_PRICE_DELTA_PCT,
  type OrderDecisionInput,
  type OrderDecision,
  type ChasePolicy,
} from '../trading/orderTypeOptimizer.js';

export {
  recordSlippageEntry,
  loadSlippageHistory,
  getSlippageStats,
  SLIPPAGE_HISTORY_MAX,
  type SlippageHistoryEntry,
  type SlippageOrderType,
  type RecordSlippageInput,
  type SlippageStats,
} from '../persistence/slippageHistoryRepo.js';
