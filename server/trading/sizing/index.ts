/**
 * @responsibility server/trading/sizing 모듈 공개 API 배럴 — 포지션 사이징 엔진 진입점
 */

export {
  // 티어 SSOT
  ACCOUNT_SIZE_TIERS,
  TIER_THRESHOLDS,
  getAccountSizeTier,
  getBasePositionPct,
  getTierLabel,
  type AccountSizeTier,
  type AccountTierName,
  type SignalGrade,
} from './accountSizeTiers.js';

export {
  // 드로우다운
  getDrawdownMultiplier,
  evaluateDrawdown,
  type DrawdownState,
  type DrawdownResult,
} from './drawdownAdapter.js';

export {
  // 연속 손절 냉각
  getLossStreakMultiplier,
  recordLoss,
  recordWin,
  clearCoolOff,
  type LossStreakState,
  type LossStreakResult,
} from './coolingOffEngine.js';

export {
  // 유동성·섹터
  getLiquidityMultiplier,
  getSectorExposureMultiplier,
  checkUniverseEligibility,
  type LiquidityResult,
  type SectorExposureResult,
} from './liquidityAndSectorGuard.js';

export {
  // 티어 마이그레이션
  checkTierMigration,
  didCrossThreshold,
  type TierMigrationEvent,
  type TierMigrationCheck,
} from './tierMigrationDetector.js';

export {
  // 핵심 엔진
  computeFinalPosition,
  formatSizingResult,
  type PositionSizingInput,
  type PositionSizingResult,
} from './positionSizingEngine.js';

export {
  SHADOW_REGIME_SIZING_POLICIES,
  calculateShadowRegimeSizing,
  resolveShadowRegimeSizingLevel,
  type ShadowRegimeSizingLevel,
  type ShadowRegimeSizingPolicy,
  type ShadowRegimeSizingResult,
  type ShadowRegimeSizingBlockReason,
  type ShadowSizingSource,
} from './shadowRegimeSizingPolicy.js';
