// @responsibility sectorEnergy 도메인 타입 정의
// ─── 섹터 에너지 맵 & 로테이션 마스터 게이트 타입 ─────────────────────────────

/** KRX 12개 섹터 목록 */
type KrxSectorName =
  | '반도체'
  | '이차전지'
  | '바이오/헬스케어'
  | '인터넷/플랫폼'
  | '자동차'
  | '조선'
  | '방산'
  | '금융'
  | '유통/소비재'
  | '건설/부동산'
  | '에너지/화학'
  | '통신/유틸리티';

/** 계절성 가중치 보정 월 구분 */
export type SeasonMonth = 'JAN' | 'APR_MAY' | 'OCT_NOV' | 'OTHER';

type SectorEnergySourceTier =
  | 'KIS_OFFICIAL_INDEX'
  | 'KIS_OFFICIAL_DAILY'
  | 'KIS_STOCK_BASKET_DERIVED'
  | 'KIS_SECTOR_INDEX_DAILY_DRYRUN'
  | 'KRX_OFFICIAL_INDEX'
  | 'KRX_CODE'
  | 'CACHE'
  | 'YAHOO_GLOBAL_PROXY'
  | 'YAHOO_ETF'
  | 'INTERNAL_PROXY'
  | 'STOCK_DAILY'
  | 'MISSING'
  | 'FAILED';

type SectorEnergyLeadershipConfidence =
  | 'WEIGHTED'
  | 'READY_FOR_SHADOW'
  | 'PARTIAL'
  | 'GLOBAL_DIAGNOSTIC_ONLY'
  | 'DIAGNOSTIC_ONLY'
  | 'BLOCKED';

type SectorEnergyPromotionStage =
  | 'OBSERVE'
  | 'SHADOW_SCORE'
  | 'ADVISORY'
  | 'WEIGHTED'
  | 'GATED'
  | 'CORE';

/** 섹터 에너지 점수 입력 — 섹터별로 수집 */
export interface SectorEnergyInput {
  /** 섹터명 */
  name: KrxSectorName | string;
  /** 4주(20거래일) 수익률 (%) */
  return4w: number;
  /** 거래량 증가율 (%) — 현재 4주 평균 vs 직전 4주 평균 */
  volumeChangePct: number;
  /** 외국인 집중도 — 최근 4주 외국인 순매수 / 전체 거래대금 (0–100) */
  foreignConcentration: number;
  sourceTier?: SectorEnergySourceTier;
  sectorReturn5d?: number;
  sectorReturn20d?: number;
  turnoverAcceleration?: number;
  breadthAbove20ma?: number;
  foreignInstitutionFlowAlignment?: number;
  sectorRelativeStrengthVsKospi?: number;
  sectorRelativeStrengthVsKosdaq?: number;
  sectorVolumeSurge?: boolean;
  sectorBreadth?: number;
  leadingStockCount?: number;
  topConstituentMomentum?: number;
  turnoverRank?: number;
  leadershipPhase?: 'EARLY' | 'MID' | 'LATE' | 'UNKNOWN';
  constituentCount?: number;
  basketCodes?: string[];
}

/** 섹터 에너지 점수 계산 결과 */
export interface SectorEnergyScore {
  name: string;
  /** 원점수: 0~100 스케일로 정규화하기 전 가중합 */
  rawScore: number;
  /** 정규화 점수 0–100 */
  score: number;
  /** 4주 수익률 기여분 */
  returnContrib: number;
  /** 거래량 기여분 */
  volumeContrib: number;
  /** 외국인 집중도 기여분 */
  foreignContrib: number;
  /** 계절성 가중치 배수 */
  seasonalMultiplier: number;
  /** 최종 에너지 점수 (rawScore × seasonalMultiplier) */
  energyScore: number;
  sourceTier?: SectorEnergySourceTier;
  sectorReturn5d?: number;
  sectorReturn20d?: number;
  turnoverAcceleration?: number;
  breadthAbove20ma?: number;
  foreignInstitutionFlowAlignment?: number;
  sectorRelativeStrengthVsKospi?: number;
  sectorRelativeStrengthVsKosdaq?: number;
  sectorVolumeSurge?: boolean;
  sectorBreadth?: number;
  leadingStockCount?: number;
  topConstituentMomentum?: number;
  turnoverRank?: number;
  leadershipPhase?: 'EARLY' | 'MID' | 'LATE' | 'UNKNOWN';
}

/** 섹터 분류 결과 */
export type SectorTier = 'LEADING' | 'NEUTRAL' | 'LAGGING';

/** 섹터별 최종 티어 정보 */
export interface SectorTierResult {
  name: string;
  energyScore: number;
  tier: SectorTier;
  /** Gate 2 통과 기준 완화 (주도 섹터: -1) */
  gate2Adjustment: number;
  /** 포지션 사이즈 제한 (소외 섹터: 40%) */
  positionSizeLimit: number;
}

/** 섹터 에너지 맵 전체 결과 */
export interface SectorEnergyResult {
  /** 섹터별 에너지 점수 목록 (점수 내림차순) */
  scores: SectorEnergyScore[];
  /** 주도 섹터 Top 3 */
  leadingSectors: SectorTierResult[];
  /** 소외 섹터 Bottom 3 */
  laggingSectors: SectorTierResult[];
  /** 중립 섹터 */
  neutralSectors: SectorTierResult[];
  /** 적용된 계절성 구분 */
  currentSeason: SeasonMonth;
  /** 계산 기준 시각 */
  calculatedAt: string;
  /** 요약 메시지 */
  summary: string;
  sourceTier?: SectorEnergySourceTier;
  confidence?: number;
  leadershipConfidence?: SectorEnergyLeadershipConfidence;
  verifiedIndexCodeCoverage?: number;
  /** Production source tier only; dry-run candidate tiers must not be wired to live CORE/GATED/STRONG_BUY. */
  selectedProductionSourceTier?: SectorEnergySourceTier;
  productionOfficialCoverage?: number;
  productionBasketCoverage?: number;
  dryRunCandidateSourceTier?: Extract<SectorEnergySourceTier, 'KIS_SECTOR_INDEX_DAILY_DRYRUN'>;
  dryRunAttempted?: number;
  dryRunSucceeded?: number;
  dryRunFailed?: number;
  dryRunCandidateCoverage?: number;
  officialBenchmark?: boolean;
  promotionStage?: SectorEnergyPromotionStage;
  kisOfficialCoverage?: number;
  kisBasketCoverage?: number;
  internalProxyCoverage?: number;
  stockDailyFallbackCoverage?: number;
  liveExecutionAllowed?: false;
  executionImpact?: 'NONE';
}
