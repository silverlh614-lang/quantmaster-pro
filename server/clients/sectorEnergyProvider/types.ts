// @responsibility ADR-0579 sectorEnergyProvider type declarations (extracted for ACMA 1500-line limit; type-only, byte-equivalent)

export type StrategicSector =
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

export interface SectorEnergyInput {
  name: StrategicSector | string;
  return4w: number;
  volumeChangePct: number;
  foreignConcentration: number;
  sourceTier?: SectorEnergySourceTierForDiag;
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

// ADR-0396 (= 사용자 명시 ADR-0371): 5단계 union 격상 — DEGRADED 신규 (심각한 부족, 보조 신호로만).
export type SectorEnergyDataQuality = 'OK' | 'PARTIAL' | 'STALE' | 'DEGRADED' | 'FAILED';

export interface SymmetryValidationResult {
  valid: boolean;
  todayCodeFillRatio: number;
  pastCodeFillRatio: number;
  reasons: string[];
  /**
   * ADR-0423: today rows 절대 카운트 (옵셔널, 후방호환).
   * `validateIndexResponseSymmetry` 호출자가 quality diagnostic 합성 시 사용.
   * 부재 시 호출자 측 default = expectedSectorCount (12) 폴백.
   */
  todayRowsTotal?: number;
  /** ADR-0423: today rows 중 indexCode 보유 row 수 (옵셔널, 후방호환). */
  todayRowsWithIndexCode?: number;
  /**
   * ADR-0424: indexName → SECTOR_INDEX_MASTER 역변환 backfill 발생 횟수 (옵셔널, 후방호환).
   *
   * `backfillIndexCodes` 가 raw KRX 응답에서 indexCode 가 비어있는 row 를 NAME_LOOKUP 으로
   * 회복했을 때 채워짐. 정상 KRX 경로에서는 0. backfilledCount > 0 이면 KRX 데이터 결손
   * (data-dbg fallback 등) 운영자 인지 가능.
   */
  backfilledCount?: number;
}

/**
 * ADR-0399 (= 사용자 명시 ADR-0374): KRX 원천 복구 진단 메타 SSOT.
 *
 * sectorEnergy build 결과에 옵셔널 부착 — 호출자가 macroState 로 영속화하면
 * `/sector_energy_diag` 텔레그램 명령에서 *어느 layer 가 작동했는지* 즉시 추적.
 *
 * 사용자 명시 9 핵심 원칙 #9 — fallback 작동 시 UI 와 diagnostics 에 반드시 표시.
 */
export type SectorEnergySourceTierForDiag =
  | 'KIS_OFFICIAL_INDEX'
  | 'KIS_OFFICIAL_DAILY'
  | 'KIS_STOCK_BASKET_DERIVED'
  | 'KRX_OFFICIAL_INDEX'
  | 'KRX_CODE'
  | 'STOCK_DAILY'
  | 'CACHE'
  | 'YAHOO_GLOBAL_PROXY'
  | 'YAHOO_ETF'
  | 'INTERNAL_PROXY'
  | 'MISSING'
  | 'FAILED';

type SectorEnergyLeadershipConfidenceForDiag =
  | 'WEIGHTED'
  | 'READY_FOR_SHADOW'
  | 'PARTIAL'
  | 'GLOBAL_DIAGNOSTIC_ONLY'
  | 'DIAGNOSTIC_ONLY'
  | 'BLOCKED';

interface SectorEnergyCoverageBreakdownForDiag {
  totalSectors: number;
  verifiedIndexCodeCount: number;
  verifiedIndexCodeCoverage: number;
  kisOfficialCount: number;
  kisOfficialCoverage: number;
  kisBasketCount: number;
  kisBasketCoverage: number;
  internalProxyCount: number;
  internalProxyCoverage: number;
  stockDailyFallbackCount: number;
  stockDailyFallbackCoverage: number;
  yahooGlobalProxyCount: number;
  yahooGlobalProxyCoverage: number;
}

export interface SectorEnergyDiagnosticsMeta {
  /** T → T-1 → T-2 → T-3 → T-5 시도한 날짜 후보 (yyyymmdd 또는 'default'). */
  candidateDates: string[];
  /** 4-tier 별 시도 결과 (시도 순서대로). */
  sourceTierAttempts: Array<{
    tier: SectorEnergySourceTierForDiag;
    validCount: number;
    reason?: string;
  }>;
  /** 최종 채택 tier. */
  finalSourceTier: SectorEnergySourceTierForDiag;
  /** ADR-0396 합성 confidence (sourceWeight × freshnessWeight × coverage, 0~1). */
  confidence: number;
  /** L4 (Yahoo ETF) 도달 사유 등. */
  fallbackReason?: string;
  coverageBreakdown?: SectorEnergyCoverageBreakdownForDiag;
  leadershipConfidence?: SectorEnergyLeadershipConfidenceForDiag;
  selectedSectors?: string[];
  providerIssue?: boolean;
  marketSignal?: false;
  liveExecutionAllowed?: false;
  executionImpact?: 'NONE';
}

export interface SectorEnergyBuildResult {
  inputs: SectorEnergyInput[];
  dataQuality: SectorEnergyDataQuality;
  validSectorCount: number;
  totalSectorCount: number;
  symmetryValidation?: SymmetryValidationResult;
  reasons: string[];
  /**
   * ADR-0399: 채택된 sourceTier (옵셔널 — 후방호환).
   * L1 KRX_CODE / L2 STOCK_DAILY / L3 CACHE / L4 YAHOO_ETF / FAILED.
   */
  sourceTier?: SectorEnergySourceTierForDiag;
  /**
   * ADR-0399: 진단 메타 (옵셔널 — 후방호환).
   * `buildSectorEnergyInputsWithMetaWithFallback` 진입점에서만 채워짐.
   */
  diagnostics?: SectorEnergyDiagnosticsMeta;
  /**
   * ADR-0423: SectorEnergy 데이터 진실성 진단 (옵셔널, 후방호환).
   *
   * indexCodeCoverage / symmetryValidationPassed / fallbackUsed / 12-value reason union 분해.
   * marketDataRefresh.ts 가 이 필드를 macroState 로 영속 → /sector_energy_diag + /scan_blockers.
   */
  qualityDiagnostic?: import('../sectorEnergyQualityDiagnostic.js').SectorEnergyQualityDiagnostic;
  sectorCoverageBreakdown?: import('../sectorEnergyQualityDiagnostic.js').SectorEnergyCoverageBreakdown;
  recoveryAudit?: import('../sectorEnergyQualityDiagnostic.js').KisRepresentativeBasketAudit;
  coverageBreakdown?: SectorEnergyCoverageBreakdownForDiag;
  leadershipConfidence?: SectorEnergyLeadershipConfidenceForDiag;
  selectedSectors?: string[];
  providerIssue?: boolean;
  marketSignal?: false;
  liveExecutionAllowed?: false;
  executionImpact?: 'NONE';
}
