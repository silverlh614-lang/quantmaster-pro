/**
 * @responsibility 섹터 지수 커버리지를 평가해 부스트·승격·실행 허용 진단 결과를 산출한다.
 */

export type SectorEnergySourceTier =
  | 'OFFICIAL_KRX_SECTOR_INDEX'
  | 'OFFICIAL_KIS_SECTOR_INDEX'
  | 'INTERNAL_GROUPED_SNAPSHOT'
  | 'KIS_STOCK_BASKET_DERIVED'
  | 'NONE';

export type LeadershipConfidence = 'VERIFIED' | 'PARTIAL' | 'SHADOW_ONLY' | 'BLOCKED';

export interface SectorIndexCoverageDiag {
  officialIndexCoverage: number;
  selectedPromotionMetric?: string;
  safeOfficialVerifiedCoverage?: number;
  decisionUsesSafeOfficialOnly?: boolean;
  internalProxyCoverage: number;
  stockBasketCoverage: number;
  missingIndexCodeCount: number;
  aliasResolvedCount: number;
  unsafeAliasCount: number;
  topMissingSectorNames: string[];
  selectedSectorEnergySourceTier: SectorEnergySourceTier;
  sectorBoostAllowed: boolean;
  strongBuyAllowed: boolean;
  shadowLeadershipAllowed: boolean;
  counterfactualAllowed: boolean;
  promotionAllowed: boolean;
  executionImpact: 'NONE' | 'NEW_BUY_BLOCKED_ONLY' | 'LIVE_ORDER_BLOCKED' | 'UNKNOWN';
  leadershipConfidence: LeadershipConfidence;
  reasonCodes: string[];
}

export function evaluateCoverageDiagnostics(input: {
  totalSectorCount: number;
  officialCoveredCount: number;
  safeOfficialVerifiedCount?: number;
  safeOfficialTargetCount?: number;
  internalProxyCount: number;
  stockBasketCount: number;
  missingIndexCodeCount: number;
  aliasResolvedCount: number;
  unsafeAliasCount: number;
  topMissingSectorNames: string[];
  selectedSectorEnergySourceTier: SectorEnergySourceTier;
  officialIndexApiSucceeded: boolean;
  containsUnsafeAliasInPromotionTarget: boolean;
  dataHealthMissing: boolean;
  stale: boolean;
}): SectorIndexCoverageDiag {
  const n = input.totalSectorCount > 0 ? input.totalSectorCount : 1;
  const officialIndexCoverage = input.officialCoveredCount / n;
  const safeOfficialTargetCount = Number.isFinite(input.safeOfficialTargetCount) && (input.safeOfficialTargetCount ?? 0) > 0
    ? Number(input.safeOfficialTargetCount)
    : input.totalSectorCount;
  const safeOfficialVerifiedCoverage = Number.isFinite(input.safeOfficialVerifiedCount) && safeOfficialTargetCount > 0
    ? Number(input.safeOfficialVerifiedCount) / safeOfficialTargetCount
    : officialIndexCoverage;
  const decisionUsesSafeOfficialOnly = Number.isFinite(input.safeOfficialVerifiedCount) && Number.isFinite(input.safeOfficialTargetCount);
  const decisionCoverage = decisionUsesSafeOfficialOnly ? safeOfficialVerifiedCoverage : officialIndexCoverage;
  const internalProxyCoverage = input.internalProxyCount / n;
  const stockBasketCoverage = input.stockBasketCount / n;

  let leadershipConfidence: LeadershipConfidence = 'BLOCKED';
  let promotionAllowed = false;
  let sectorBoostAllowed = false;
  let strongBuyAllowed = false;
  let shadowLeadershipAllowed = false;
  const counterfactualAllowed = true;
  const reasonCodes: string[] = [];

  const unsafeAliasBlocksPromotion = input.containsUnsafeAliasInPromotionTarget && !decisionUsesSafeOfficialOnly;
  const basePromotionConstraintsMet =
    input.officialIndexApiSucceeded &&
    !unsafeAliasBlocksPromotion &&
    !input.dataHealthMissing &&
    !input.stale;

  if (decisionCoverage >= 0.8 && basePromotionConstraintsMet) {
    leadershipConfidence = 'VERIFIED';
    promotionAllowed = true;
    sectorBoostAllowed = true;
    strongBuyAllowed = true;
    shadowLeadershipAllowed = true;
    reasonCodes.push('OFFICIAL_INDEX_MASTER_LOADED');
    reasonCodes.push('OFFICIAL_INDEX_VERIFIED_COVERAGE');
  } else if (officialIndexCoverage > 0 || decisionCoverage > 0) {
    leadershipConfidence = 'PARTIAL';
    shadowLeadershipAllowed = true;
    reasonCodes.push('OFFICIAL_INDEX_MASTER_LOADED');
    reasonCodes.push('OFFICIAL_INDEX_COVERAGE_BELOW_THRESHOLD');
    reasonCodes.push('PROMOTION_DISABLED_COVERAGE_BELOW_80');
  } else if (internalProxyCoverage > 0 || stockBasketCoverage > 0) {
    leadershipConfidence = 'SHADOW_ONLY';
    shadowLeadershipAllowed = true;
    reasonCodes.push('OFFICIAL_INDEX_COVERAGE_ZERO');
    if (internalProxyCoverage > 0) reasonCodes.push('INTERNAL_PROXY_AVAILABLE');
    if (stockBasketCoverage > 0) reasonCodes.push('KIS_BASKET_DERIVED_SHADOW_ONLY');
    reasonCodes.push('PROMOTION_DISABLED_COVERAGE_BELOW_80');
    reasonCodes.push('SHADOW_LEADERSHIP_RECORDED');
  } else {
    leadershipConfidence = 'BLOCKED';
    reasonCodes.push('SECTOR_LEADERSHIP_BLOCKED');
  }

  if (!input.officialIndexApiSucceeded) reasonCodes.push('OFFICIAL_INDEX_PROVIDER_FAILURE');
  if (input.containsUnsafeAliasInPromotionTarget) reasonCodes.push('UNSAFE_ALIAS_EXCLUDED_FROM_PROMOTION');
  if (input.dataHealthMissing) reasonCodes.push('DATA_HEALTH_MISSING_PROMOTION_DISABLED');
  if (input.stale) reasonCodes.push('STALE_PROMOTION_DISABLED');
  reasonCodes.push('EXECUTION_IMPACT_NONE_CONFIRMED');

  return {
    officialIndexCoverage,
    selectedPromotionMetric: decisionUsesSafeOfficialOnly ? 'SAFE_OFFICIAL_VERIFIED_COVERAGE' : 'officialTargetVerifiedCoverage',
    safeOfficialVerifiedCoverage,
    decisionUsesSafeOfficialOnly,
    internalProxyCoverage,
    stockBasketCoverage,
    missingIndexCodeCount: input.missingIndexCodeCount,
    aliasResolvedCount: input.aliasResolvedCount,
    unsafeAliasCount: input.unsafeAliasCount,
    topMissingSectorNames: input.topMissingSectorNames,
    selectedSectorEnergySourceTier: input.selectedSectorEnergySourceTier,
    sectorBoostAllowed,
    strongBuyAllowed,
    shadowLeadershipAllowed,
    counterfactualAllowed,
    promotionAllowed,
    executionImpact: 'NONE',
    leadershipConfidence,
    reasonCodes,
  };
}
