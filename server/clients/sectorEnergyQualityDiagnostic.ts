/**
 * @responsibility ADR-0423 SectorEnergy 데이터 진실성 진단 SSOT — indexCode coverage / symmetry / fallback 분해
 *
 * ADR-0423:
 * SectorEnergy leadership confidence depends on semantic sector-index integrity.
 * Fresh-looking sector data is not sufficient when indexCode coverage is zero,
 * symmetry validation fails, or stock-daily fallback replaces sector-index mapping.
 *
 * STALE / DEGRADED SectorEnergy must not be treated as true leadership absence.
 * This module must not change gate thresholds, weights, or trading policy.
 * It only repairs SectorEnergy data-quality diagnostics and classification.
 *
 * 사용자 명시 핵심 불변식:
 *   1. SectorEnergy STALE 은 정상 데이터가 아니다.
 *   2. indexCode missing 을 숨기고 leadership OK 로 처리하면 안 된다.
 *   3. stock-daily fallback 은 정상 sector-index 기반 leadership 과 동급이 아니다.
 *   4. symmetry validation failed 는 단순 warning 이 아니라 dataQuality 를 낮추는 원인이다.
 *   5. Gate2 완화보다 SectorEnergy 데이터 진실성 복구가 먼저다.
 *   6. Gate threshold / weight / 매매 정책 절대 변경 금지.
 *
 * SSOT 재사용:
 *   - dataQuality 5-state enum: ADR-0396 `SectorEnergyDataQuality5` 그대로 사용.
 *   - sourceTier / freshness / coverage / confidence: ADR-0396 4-axis SSOT 그대로.
 *   - 본 모듈은 *quality reason 분해 + leadershipConfidence 차단 결정* 만 추가.
 *
 * 외부 의존성: sectorEnergyDataQuality.ts (ADR-0396 type re-export 만).
 */

import type { SectorEnergyDataQuality5 } from './sectorEnergyDataQuality.js';
import type {
  SectorIndexCodeRecoveryDiagnostic,
  KrxSectorIndexRawDiagnostic,
} from './sectorEnergyIndexCodeRecoveryDiagnostic.js';
import type { SectorEnergySanityViolationDiagnostic } from './sectorEnergySanityViolationDiagnostic.js';
import { formatGroupedSectorEnergyDiagnosticSection, type GroupedSectorEnergySnapshot } from './groupedSectorEnergyProvider.js';

// ─── ENV gate SSOT (호출자 측 inline 검사 0건) ──────────────────────────────

/**
 * ADR-0423: ENV `SECTOR_ENERGY_QUALITY_DIAGNOSTIC_DISABLED=true` 시 본 모듈
 * 진단 layer 비활성 (회귀 시 1줄 즉시 롤백). 정확 비교 (`=== 'true'`) — ADR-0157 의무 정합.
 */
export function isSectorEnergyQualityDiagnosticDisabled(): boolean {
  return process.env.SECTOR_ENERGY_QUALITY_DIAGNOSTIC_DISABLED === 'true';
}

// ─── 타입 SSOT (ADR-0423 §B 사용자 명시 정합) ──────────────────────────────

/**
 * Quality reason 분해 — 단순 `reasons: string[]` 의 *구조화* 격상.
 *
 * 사용자 명시 §B — 12 reason value:
 *   OK / INDEX_CODE_MISSING / INDEX_CODE_COVERAGE_ZERO / INDEX_CODE_COVERAGE_LOW
 *   / SYMMETRY_VALIDATION_FAILED / VALID_SECTOR_COUNT_LOW / STOCK_DAILY_FALLBACK_USED
 *   / ETF_FALLBACK_USED / CACHE_STALE / SOURCE_EMPTY / SCHEMA_MISMATCH / UNKNOWN
 */
export type SectorEnergyQualityReason =
  | 'OK'
  | 'INDEX_CODE_MISSING'
  | 'INDEX_CODE_COVERAGE_ZERO'
  | 'INDEX_CODE_COVERAGE_LOW'
  | 'SYMMETRY_VALIDATION_FAILED'
  | 'VALID_SECTOR_COUNT_LOW'
  | 'STOCK_DAILY_FALLBACK_USED'
  | 'ETF_FALLBACK_USED'
  | 'CACHE_STALE'
  | 'SOURCE_EMPTY'
  | 'SCHEMA_MISMATCH'
  | 'KIS_BASKET_DERIVED_SHADOW'
  | 'UNKNOWN';

/**
 * fallback 사용 여부 — *어느 fallback layer 가 작동했는지* 명시.
 *
 * 사용자 명시 §E — STOCK_DAILY/ETF 는 정상 sector-index leadership 과 동급이 아니다.
 *   NONE: 정상 KRX_CODE / STOCK_DAILY: synthetic sector / ETF: Yahoo proxy / CACHE: 영속 cache.
 */
export type SectorEnergyFallbackUsed = 'NONE' | 'STOCK_DAILY' | 'ETF' | 'CACHE';


export type SectorEnergyCoverageFreshness = 'FRESH' | 'STALE' | 'MISSING' | 'PARTIAL';
export type SectorEnergyCoverageReason =
  | 'OK'
  | 'NO_REPRESENTATIVE_SYMBOLS'
  | 'PRICE_ROWS_MISSING'
  | 'PRICE_ROWS_STALE'
  | 'SECTOR_CODE_MISSING'
  | 'KIS_BASKET_DERIVED_ONLY'
  | 'UNKNOWN';

export interface SectorEnergyCoverageBreakdown {
  expectedSectorCount: number;
  validSectorCount: number;
  /** Full-quality sectors with complete fresh production basket rows. */
  fullQualitySectorCount?: number;
  /** Partial-quality sectors with usable but incomplete production basket rows. */
  partialQualitySectorCount?: number;
  staleSectorCount: number;
  missingSectorCount: number;
  partialSectorCount: number;
  sectorRows: Array<{
    sectorName: string;
    sectorCode?: string | null;
    representativeSymbols: string[];
    representativeSymbolCount: number;
    priceRowsFound: number;
    priceRowsMissing: number;
    latestPriceDate?: string | null;
    ageTradingDays?: number | null;
    freshness: SectorEnergyCoverageFreshness;
    reason: SectorEnergyCoverageReason;
    /** Production basket row completeness after targeted missing-price refresh. */
    rowLevelStatus?: 'COMPLETE' | 'PARTIAL' | 'MISSING' | 'STALE';
    /** Sector-level production basket quality after targeted missing-price refresh. */
    sectorLevelStatus?: 'FULL_QUALITY' | 'PARTIAL' | 'MISSING' | 'STALE';
    /** Structured recovery problem type, when the sector row is not full quality. */
    problemType?: 'PRICE_ROWS_MISSING' | 'PRICE_ROWS_STALE' | 'NO_REPRESENTATIVE_SYMBOLS' | 'RESOLVED' | 'UNKNOWN';
  }>;
  executionImpact: 'NONE';
}

export type KisRepresentativeBasketBreakPoint =
  | 'OFFICIAL_SECTOR_INDEX_UNAVAILABLE'
  | 'REPRESENTATIVE_SYMBOLS_MISSING'
  | 'REPRESENTATIVE_PRICE_ROWS_MISSING'
  | 'REPRESENTATIVE_PRICE_ROWS_STALE'
  | 'BASKET_ROWS_BELOW_MINIMUM'
  | 'DATE_ALIGNMENT_FAILED'
  | 'CACHE_STALE'
  | 'UNKNOWN';

export interface KisRepresentativeBasketAudit {
  officialSectorIndexAvailable: boolean;
  usingKisRepresentativeBasket: boolean;
  representativeBasketExpectedRows: number;
  representativeBasketActualRows: number;
  representativeBasketMissingRows: number;
  representativeSymbolsResolved: number;
  representativeSymbolsMissing: number;
  priceRowsFetched: number;
  priceRowsFresh: number;
  priceRowsStale: number;
  latestAvailableDate?: string | null;
  previousTradingDate?: string | null;
  staleThresholdTradingDays: number;
  breakPoint: KisRepresentativeBasketBreakPoint;
  nextAction: string;
  sectorBoostAllowed: false;
  strongBuyAllowed: false;
  executionHardBlock: false;
  executionImpact: 'NONE';
}

/**
 * ADR-0423 quality 진단 SSOT — 단일 sector-energy build 결과의 *데이터 진실성* 분해.
 *
 * 호출자 (sectorEnergyProvider build / scanDiagnostics persistScanResults / gate2LeadershipAttribution
 * formatGate2AttributionSection / sectorEnergyDiag.cmd.ts) 가 동일 SSOT 를 read.
 *
 * 사용자 §B 명시 schema 기반 (필드명 보존). 기존 `SymmetryValidationResult` (sectorEnergyProvider)
 * + `SectorEnergyDiagnostic` (gate2LeadershipAttribution) 와 *책임 분리* — 본 모듈은 *원인 분해 + 차단 결정* 만.
 */
export interface SectorEnergyQualityDiagnostic {
  /** ADR-0396 5-state union 그대로. */
  dataQuality: SectorEnergyDataQuality5;
  /** 원인 분해 — 다중 이유 동시 포함 가능 (예: INDEX_CODE_COVERAGE_ZERO + STOCK_DAILY_FALLBACK_USED). */
  reasons: SectorEnergyQualityReason[];
  /** 유효 섹터 수 (returns 채워진 섹터). */
  validSectorCount: number;
  /** 전체 섹터 수 (default 12). */
  expectedSectorCount: number;
  /** rowsWithIndexCode / totalSectorRows (0~1 clamp). */
  indexCodeCoverage: number;
  /** indexCode 부재 row 수. */
  missingIndexCodeCount: number;
  /** 전체 row 수 (today rows 기준). */
  totalSectorRows: number;
  /** ADR-0396 sourceTier (옵셔널 — caller 측에서 4-axis composite 분리 수행 시 부착). */
  sourceTier?: string;
  /** 어느 fallback layer 가 작동했는지 명시. */
  fallbackUsed: SectorEnergyFallbackUsed;
  /** symmetry validation 통과 여부. */
  symmetryValidationPassed: boolean;
  /**
   * 사용자 명시 §H — leadership confidence 차단 결정 SSOT.
   * Gate2/NO_LEADERSHIP 분기에서 *Gate2 완화 권고 차단* 입력.
   */
  shouldBlockLeadershipConfidence: boolean;
  /** 운영자 메시지 (한국어/영문 mixed — 텔레그램 메시지 그대로 사용 가능). */
  operatorMessage: string;
  /**
   * ADR-0424: indexCode 백필로 회복된 row 수 (옵셔널, 후방호환).
   *
   * `> 0` 이면 KRX 가 IDX_IND_CD 누락 응답을 보냈고 SECTOR_INDEX_MASTER 역변환으로 회복됨.
   * 운영자 진단 — 운영 중 KRX 데이터 결손 (data-dbg fallback 등) 빈도 추적용.
   * 부재 시 caller 측 default = 0.
   */
  indexCodeBackfilledCount?: number;
  /**
   * ADR-0424: 수리 상태 분류 (옵셔널, 후방호환).
   *
   * `RECOVERED`     — backfill 로 indexCodeCoverage 회복 + symmetry pass + sourceTier=KRX_CODE.
   * `PARTIAL`       — backfill 일부 회복 (coverage > 0 이나 symmetry 미통과 또는 fallback 활성).
   * `STILL_STALE`   — backfill 후에도 coverage = 0 또는 fallback 우세 — provider 본체 복구 필요.
   * `NOT_NEEDED`    — raw KRX 정상 (backfill 0 + dataQuality OK).
   */
  repairStatus?: 'RECOVERED' | 'PARTIAL' | 'STILL_STALE' | 'NOT_NEEDED';
  /**
   * ADR-0446 Phase 2: indexCode recovery 분해 (옵셔널, 후방호환).
   *
   * `backfillIndexCodes` (ADR-0424) 위에서 *missing row 의 진짜 원인* 을 row 단위로 분해.
   * 11-value `SectorIndexCodeMissingReason` union + sourceTier breakdown + recoveryStatus
   * 결정 + leadershipConfidence 차단 결정.
   *
   * 부재 시 caller (Phase 1 호출자) 무영향 — Phase 2 진단 layer 만 미노출.
   */
  sectorIndexRecovery?: SectorIndexCodeRecoveryDiagnostic;
  /**
   * KRX-SECTOR-INDEXCODE-RAW-DIAGNOSTIC-001 — KRX 섹터 indexCode raw 입력 부검 (옵셔널, 후방호환).
   *
   * `verifiedIndexCodeCoverage=0%` 의 정확한 break point — KRX raw row 가 IDX_IND_CD /
   * indexName 을 갖는지, alias lookup 이 왜 실패하는지, backfill 호출 여부, sourceTier 가
   * 왜 KIS_STOCK_BASKET_DERIVED 로 떨어지는지를 row 단위로 분해. 진단 전용 — 매매 영향 0.
   *
   * 부재 시 caller 무영향 — 진단 layer 만 미노출.
   */
  krxSectorIndexRaw?: KrxSectorIndexRawDiagnostic;
  /**
   * ADR-0446 sanity violation 진단 (옵셔널, 후방호환).
   *
   * 단순 console.warn 로그였던 sanity violation 을 *구조화된 진단* 으로 집계.
   * 7-value `SectorEnergySanityViolationKind` union + sector vs stock-level 분리 +
   * topViolatingSectors/Stocks + confidenceImpact 결정.
   *
   * 부재 시 caller (Phase 1 호출자) 무영향.
   */
  sanityViolation?: SectorEnergySanityViolationDiagnostic;


  /** Patch-SECTOR-ENERGY-STALE-RECOVERY-001 — diagnostic-only coverage decomposition. */
  coverageBreakdown?: SectorEnergyCoverageBreakdown;
  /** Patch-SECTOR-ENERGY-STALE-RECOVERY-001 — KIS representative basket construction audit. */
  representativeBasketAudit?: KisRepresentativeBasketAudit;
  /** SECTOR-CLASSIFICATION-SNAPSHOT — internal grouped energy, shadow/advisory only. */
  groupedSectorEnergy?: GroupedSectorEnergySnapshot;

  /**
   * ADR-0447: alias 확장으로 backfill 된 row 수 (옵셔널 후방호환).
   *
   * Provider 가 normalize 후 alias 매칭으로 indexCode 회복 시 카운트.
   * `sectorIndexRecovery.aliasExpansionRecovered` 와 동일 값 — top-level 격상은 잡음 차단.
   */
  aliasExpansionRecovered?: number;

  /**
   * ADR-0447: aggregate row 자동 분리 카운트 (옵셔널 후방호환).
   *
   * 시장 종합 row (코스피/코스닥/전체/합계) 가 sector alias 등록 후보로 잘못 분류되지
   * 않았는지 운영자 즉시 확인용. `sectorIndexRecovery.nonSectorAggregateIgnored` 와 동일.
   */
  nonSectorAggregateIgnored?: number;

  /**
   * ADR-0447: alias 확장으로 새로 매칭된 alias Top N (옵셔널 후방호환).
   *
   * raw 값 / token / private metadata 영속 절대 금지 — schema 5 필드만.
   */
  topRecoveredAliases?: Array<{
    indexName: string;
    normalizedName: string;
    sectorKey: string;
    displayName: string;
    count: number;
  }>;
  officialIndexCoverage?: number;
  internalProxyCoverage?: number;
  stockBasketCoverage?: number;
  leadershipConfidence?: 'VERIFIED' | 'PARTIAL' | 'SHADOW_ONLY' | 'BLOCKED';
  promotionAllowed?: boolean;
  shadowLeadershipAllowed?: boolean;
  counterfactualAllowed?: boolean;
  selectedSectorEnergySourceTier?: string;
  reasonCodes?: string[];
}

// ─── SSOT 입력 타입 ──────────────────────────────────────────────────────

/**
 * `evaluateSectorEnergyQualityDiagnostic` 의 입력. 모든 필드 옵셔널 — caller 측 partial 정보 호환.
 *
 * 호출자 (sectorEnergyProvider build site) 가 다음 정보 수집 후 전달:
 *   - validSectorCount (returns.length>0 인 섹터 수)
 *   - expectedSectorCount (default 12)
 *   - totalSectorRows (today index rows length)
 *   - rowsWithIndexCode (today rows 중 indexCode 있는 row 수)
 *   - symmetryValidationPassed (validateIndexResponseSymmetry().valid)
 *   - fallbackUsed (build path 가 fallback 채택했는지)
 *   - sourceTier (옵셔널, ADR-0396 4-axis 분리 수행 시)
 *   - cacheAgeMs (옵셔널, CACHE fallback path 만)
 */
export interface EvaluateSectorEnergyQualityInput {
  validSectorCount: number;
  expectedSectorCount?: number;
  totalSectorRows: number;
  rowsWithIndexCode: number;
  symmetryValidationPassed: boolean;
  fallbackUsed?: SectorEnergyFallbackUsed;
  sourceTier?: string;
  cacheAgeMs?: number;
  /**
   * ADR-0424: indexCode 백필로 회복된 row 수 (옵셔널).
   *
   * Provider 의 `backfillIndexCodes` 가 KRX 응답에서 IDX_IND_CD 누락 row 를 SECTOR_INDEX_MASTER
   * 역변환으로 회복했을 때 caller 가 전달. evaluator 는 repairStatus 분류 입력으로만 사용 — 분류
   * 로직 자체는 변경 없음 (backfill 후 indexCodeCoverage 가 자동으로 회복된 값으로 입력됨).
   */
  indexCodeBackfilledCount?: number;
  /**
   * ADR-0446 Phase 2: indexCode recovery 진단 (옵셔널, 후방호환).
   *
   * Provider 가 `evaluateIndexCodeRecovery` SSOT 로 합성 후 전달.
   */
  sectorIndexRecovery?: SectorIndexCodeRecoveryDiagnostic;
  /**
   * KRX-SECTOR-INDEXCODE-RAW-DIAGNOSTIC-001 — KRX 섹터 indexCode raw 입력 부검 (옵셔널, 후방호환).
   *
   * Provider 가 `evaluateKrxSectorIndexRawDiagnostic` SSOT 로 합성 후 전달. evaluator 는
   * propagate 만 — 분류 로직 자체는 변경 없음. 진단 전용 — 매매 영향 0.
   */
  krxSectorIndexRaw?: KrxSectorIndexRawDiagnostic;
  /**
   * ADR-0446 sanity violation 진단 (옵셔널, 후방호환).
   *
   * Provider 가 `finalizeSanityDiagnostic` SSOT 로 합성 후 전달.
   */
  sanityViolation?: SectorEnergySanityViolationDiagnostic;


  /** Patch-SECTOR-ENERGY-STALE-RECOVERY-001 — diagnostic-only coverage decomposition. */
  coverageBreakdown?: SectorEnergyCoverageBreakdown;
  /** Patch-SECTOR-ENERGY-STALE-RECOVERY-001 — KIS representative basket construction audit. */
  representativeBasketAudit?: KisRepresentativeBasketAudit;
  /** SECTOR-CLASSIFICATION-SNAPSHOT — internal grouped energy, shadow/advisory only. */
  groupedSectorEnergy?: GroupedSectorEnergySnapshot;

  /**
   * ADR-0447: alias 확장 카운트 (옵셔널 후방호환).
   *
   * Provider 가 명시 전달 시 top-level 격상. 미전달 시 sectorIndexRecovery.aliasExpansionRecovered
   * 그대로 사용 (자동 propagate).
   */
  aliasExpansionRecovered?: number;
  nonSectorAggregateIgnored?: number;
  topRecoveredAliases?: Array<{
    indexName: string;
    normalizedName: string;
    sectorKey: string;
    displayName: string;
    count: number;
  }>;
  officialIndexCoverage?: number;
  internalProxyCoverage?: number;
  stockBasketCoverage?: number;
}

// ─── 임계 SSOT (ADR-0423 §C 사용자 명시 정합 — 절대 변경 금지) ──────────────

/**
 * 사용자 §C 권장 분류 임계.
 *
 * 절대 변경 금지: 본 임계는 *진단 분류만* 결정 — 매매 결정 무관.
 *
 * - INDEX_CODE_COVERAGE_LOW_THRESHOLD: 0.8 미만 → DEGRADED 분류 (사용자 §C 명시).
 * - VALID_SECTOR_COUNT_LOW_THRESHOLD: 9 미만 → reasons 에 VALID_SECTOR_COUNT_LOW 첨부 (ADR-0396 PARTIAL_MIN 정합).
 * - CACHE_STALE_THRESHOLD_MS: 4h 초과 → CACHE_STALE 첨부 (ADR-0396 EXPIRED 정합).
 */
export const SECTOR_ENERGY_QUALITY_THRESHOLDS = Object.freeze({
  INDEX_CODE_COVERAGE_LOW_THRESHOLD: 0.8,
  VALID_SECTOR_COUNT_LOW_THRESHOLD: 9,
  CACHE_STALE_THRESHOLD_MS: 4 * 60 * 60 * 1000, // 4h — ADR-0396 EXPIRED 정합
} as const);

// ─── 헬퍼 SSOT ────────────────────────────────────────────────────────────

/**
 * indexCodeCoverage = rowsWithIndexCode / totalSectorRows, clamp [0, 1].
 *
 * 사용자 §C 명시 — totalSectorRows === 0 → 0 (DATA_UNAVAILABLE 분기 caller 측 처리).
 * NaN/Infinity/음수 → 0 안전 fallback.
 */
export function computeIndexCodeCoverage(rowsWithIndexCode: number, totalSectorRows: number): number {
  if (!Number.isFinite(rowsWithIndexCode) || rowsWithIndexCode < 0) return 0;
  if (!Number.isFinite(totalSectorRows) || totalSectorRows <= 0) return 0;
  const ratio = rowsWithIndexCode / totalSectorRows;
  if (!Number.isFinite(ratio)) return 0;
  return Math.max(0, Math.min(1, ratio));
}

/** missingIndexCodeCount = max(0, totalSectorRows - rowsWithIndexCode). */
export function computeMissingIndexCodeCount(rowsWithIndexCode: number, totalSectorRows: number): number {
  if (!Number.isFinite(totalSectorRows) || totalSectorRows < 0) return 0;
  if (!Number.isFinite(rowsWithIndexCode) || rowsWithIndexCode < 0) return Math.floor(totalSectorRows);
  return Math.max(0, Math.floor(totalSectorRows - rowsWithIndexCode));
}

/**
 * ADR-0424: 수리 상태 분류 SSOT.
 *
 * 우선순위 결정 트리 (절대 변경 금지):
 *   1. fallbackUsed='NONE' + dataQuality='OK' + backfilled=0 → 'NOT_NEEDED'
 *   2. fallbackUsed='NONE' + symmetryPassed + indexCodeCoverage>=0.8 + backfilled>0 → 'RECOVERED'
 *   3. indexCodeCoverage>0 + (fallbackUsed≠'NONE' || !symmetryPassed) → 'PARTIAL'
 *   4. 그 외 (indexCodeCoverage=0 또는 dataQuality=FAILED 또는 stuck STOCK_DAILY) → 'STILL_STALE'
 *
 * 사용자 §H 정합:
 *   - 'RECOVERED' 분류는 *KRX 본체 경로 정상화* 만 허용 — fallback 사용 시 절대 RECOVERED 금지.
 *   - 'NOT_NEEDED' 는 backfill 0 + raw KRX 정상 — 평상시 default.
 */
export function classifyRepairStatus(
  dataQuality: SectorEnergyDataQuality5,
  indexCodeCoverage: number,
  symmetryValidationPassed: boolean,
  fallbackUsed: SectorEnergyFallbackUsed,
  indexCodeBackfilledCount: number,
): 'RECOVERED' | 'PARTIAL' | 'STILL_STALE' | 'NOT_NEEDED' {
  // ① 평상시 raw KRX 정상 — 수리 불필요.
  if (
    fallbackUsed === 'NONE' &&
    dataQuality === 'OK' &&
    indexCodeBackfilledCount === 0
  ) {
    return 'NOT_NEEDED';
  }
  // ② backfill 로 회복 — KRX 본체 경로가 indexCode backfill 로 복구됐다.
  if (
    fallbackUsed === 'NONE' &&
    symmetryValidationPassed &&
    indexCodeCoverage >= 0.8 &&
    indexCodeBackfilledCount > 0
  ) {
    return 'RECOVERED';
  }
  // ③ indexCode 일부 회복 — coverage > 0 이지만 fallback 활성 또는 symmetry 미통과.
  if (
    indexCodeCoverage > 0 &&
    (fallbackUsed !== 'NONE' || !symmetryValidationPassed)
  ) {
    return 'PARTIAL';
  }
  // ④ 그 외 — provider 본체 복구 필요.
  return 'STILL_STALE';
}

/**
 * 사용자 §H — leadership confidence 차단 결정 SSOT.
 *
 * dataQuality 가 OK 또는 PARTIAL 이면 차단 안 함 (보조 신호 가능). 그 외 (PARTIAL_VOLUME / STALE
 * / DEGRADED / FAILED) 모두 차단.
 *
 * NOTE: PARTIAL_VOLUME 은 STRONG_BUY 만 차단 (BUY 까지는 허용, ADR-0415) — 본 차단 결정은
 *   *leadership confidence layer* 만 영향 (Gate2 완화 권고 차단). 일반 BUY 매수 흐름 영향 없음.
 */
export function shouldBlockLeadershipConfidence(dataQuality: SectorEnergyDataQuality5): boolean {
  return !(dataQuality === 'OK' || dataQuality === 'PARTIAL');
}

/**
 * 사용자 §D 권장 — operatorMessage 합성 SSOT.
 *
 * dataQuality + reasons 조합으로 운영자 친화 한국어/영문 mixed 메시지 합성.
 * 텔레그램 메시지 그대로 사용 가능 (HTML escape 불필요 — 일반 텍스트).
 */
export function buildOperatorMessage(
  dataQuality: SectorEnergyDataQuality5,
  reasons: SectorEnergyQualityReason[],
  indexCodeCoverage: number,
  fallbackUsed: SectorEnergyFallbackUsed,
): string {
  if (dataQuality === 'OK' && reasons.length === 1 && reasons[0] === 'OK') {
    return 'sector-index leadership data is healthy.';
  }
  const parts: string[] = [];
  if (reasons.includes('SOURCE_EMPTY')) {
    parts.push('sector-index source is empty (KRX OpenAPI returned no rows)');
  }
  if (reasons.includes('INDEX_CODE_COVERAGE_ZERO')) {
    parts.push(
      `sector indexCode coverage is ${(indexCodeCoverage * 100).toFixed(1)}%; stock-daily fallback is not equivalent to sector-index leadership`,
    );
  } else if (reasons.includes('INDEX_CODE_COVERAGE_LOW')) {
    parts.push(`sector indexCode coverage is ${(indexCodeCoverage * 100).toFixed(1)}% (< 80%)`);
  }
  if (reasons.includes('SYMMETRY_VALIDATION_FAILED') && !reasons.includes('INDEX_CODE_COVERAGE_ZERO')) {
    parts.push('sector ↔ stock symmetry validation failed');
  }
  if (reasons.includes('VALID_SECTOR_COUNT_LOW')) {
    parts.push('valid sector count is below the partial threshold');
  }
  if (fallbackUsed === 'STOCK_DAILY') {
    parts.push('stock-daily fallback used only for degraded diagnostics');
  } else if (fallbackUsed === 'ETF') {
    parts.push('Yahoo ETF fallback used (foreign concentration / volume change unavailable)');
  } else if (fallbackUsed === 'CACHE') {
    parts.push('cached sector data used (not today)');
  }
  if (reasons.includes('CACHE_STALE')) {
    parts.push('cache age exceeds 4h');
  }
  if (reasons.includes('KIS_BASKET_DERIVED_SHADOW')) {
    parts.push('KIS basket is a derived representative basket, not an official sector index');
  }
  if (parts.length === 0) {
    return `sector-energy data quality degraded to ${dataQuality}; operator review recommended.`;
  }
  return parts.join('; ') + '.';
}

// ─── 결정 트리 SSOT (사용자 §C 정합 — 절대 변경 금지) ────────────────────

/**
 * ADR-0423: SectorEnergy quality 진단 결정 트리 SSOT.
 *
 * 사용자 §C 결정 트리 (위에서 아래 첫 매칭, 절대 변경 금지):
 *   1. totalSectorRows === 0                      → DATA_UNAVAILABLE 의미 (FAILED + SOURCE_EMPTY)
 *   2. indexCodeCoverage === 0                    → STALE + INDEX_CODE_COVERAGE_ZERO + INDEX_CODE_MISSING
 *   3. indexCodeCoverage < 0.8                    → DEGRADED + INDEX_CODE_COVERAGE_LOW
 *   4. !symmetryValidationPassed                  → STALE 또는 DEGRADED + SYMMETRY_VALIDATION_FAILED
 *   5. fallbackUsed !== 'NONE'                    → PARTIAL + STOCK_DAILY/ETF/CACHE_FALLBACK_USED
 *   6. validSectorCount < 9                       → STALE + VALID_SECTOR_COUNT_LOW (ADR-0396 PARTIAL_MIN)
 *   7. cacheAgeMs > 4h                            → reasons 에 CACHE_STALE 첨부
 *   8. 그 외                                       → OK
 *
 * 핵심 불변식 (사용자 명시):
 *   - indexCodeCoverage=0 시 OK/PARTIAL 절대 금지 (#2).
 *   - symmetry failed 시 OK 절대 금지 (#4).
 *   - fallback 사용 시 OK 절대 금지 (#5).
 *
 * 외부 부작용 0 (순수 함수).
 */
export function evaluateSectorEnergyQualityDiagnostic(
  input: EvaluateSectorEnergyQualityInput,
): SectorEnergyQualityDiagnostic {
  const expectedSectorCount = input.expectedSectorCount ?? 12;
  const fallbackUsed: SectorEnergyFallbackUsed = input.fallbackUsed ?? 'NONE';
  const indexCodeCoverage = computeIndexCodeCoverage(input.rowsWithIndexCode, input.totalSectorRows);
  const missingIndexCodeCount = computeMissingIndexCodeCount(input.rowsWithIndexCode, input.totalSectorRows);

  const reasons: SectorEnergyQualityReason[] = [];
  let dataQuality: SectorEnergyDataQuality5;

  if (input.sourceTier === 'KIS_STOCK_BASKET_DERIVED') {
    reasons.push('KIS_BASKET_DERIVED_SHADOW');
    if (Number.isFinite(input.validSectorCount) && input.validSectorCount >= SECTOR_ENERGY_QUALITY_THRESHOLDS.VALID_SECTOR_COUNT_LOW_THRESHOLD) {
      dataQuality = 'PARTIAL';
    } else if (Number.isFinite(input.validSectorCount) && input.validSectorCount > 0) {
      dataQuality = 'STALE';
    } else {
      dataQuality = 'FAILED';
      reasons.push('SOURCE_EMPTY');
    }
    if (indexCodeCoverage === 0) reasons.push('INDEX_CODE_COVERAGE_ZERO');
    if (!input.symmetryValidationPassed) reasons.push('SYMMETRY_VALIDATION_FAILED');
  }
  // ① totalSectorRows === 0 → SOURCE_EMPTY (FAILED 분류 — DATA_UNAVAILABLE 의미)
  else if (!Number.isFinite(input.totalSectorRows) || input.totalSectorRows <= 0) {
    reasons.push('SOURCE_EMPTY');
    dataQuality = 'FAILED';
  }
  // ② indexCodeCoverage === 0 → STALE + INDEX_CODE_COVERAGE_ZERO + INDEX_CODE_MISSING
  else if (indexCodeCoverage === 0) {
    reasons.push('INDEX_CODE_COVERAGE_ZERO');
    reasons.push('INDEX_CODE_MISSING');
    dataQuality = 'STALE';
    // symmetry failed 도 동시에 발생했으면 첨부 (분리 진단)
    if (!input.symmetryValidationPassed) {
      reasons.push('SYMMETRY_VALIDATION_FAILED');
    }
    // fallback 사용 시 첨부 (사용자 §E — STALE 우세 + fallback 동시 표시)
    if (fallbackUsed === 'STOCK_DAILY') reasons.push('STOCK_DAILY_FALLBACK_USED');
    else if (fallbackUsed === 'ETF') reasons.push('ETF_FALLBACK_USED');
  }
  // ③ indexCodeCoverage < 0.8 → DEGRADED + INDEX_CODE_COVERAGE_LOW
  else if (indexCodeCoverage < SECTOR_ENERGY_QUALITY_THRESHOLDS.INDEX_CODE_COVERAGE_LOW_THRESHOLD) {
    reasons.push('INDEX_CODE_COVERAGE_LOW');
    dataQuality = 'DEGRADED';
    if (!input.symmetryValidationPassed) reasons.push('SYMMETRY_VALIDATION_FAILED');
    if (fallbackUsed === 'STOCK_DAILY') reasons.push('STOCK_DAILY_FALLBACK_USED');
    else if (fallbackUsed === 'ETF') reasons.push('ETF_FALLBACK_USED');
  }
  // ④ !symmetryValidationPassed → STALE + SYMMETRY_VALIDATION_FAILED
  else if (!input.symmetryValidationPassed) {
    reasons.push('SYMMETRY_VALIDATION_FAILED');
    dataQuality = 'STALE';
    if (fallbackUsed === 'STOCK_DAILY') reasons.push('STOCK_DAILY_FALLBACK_USED');
    else if (fallbackUsed === 'ETF') reasons.push('ETF_FALLBACK_USED');
  }
  // ⑤ fallbackUsed !== 'NONE' (symmetry OK + coverage 충분) → PARTIAL
  else if (fallbackUsed !== 'NONE') {
    if (fallbackUsed === 'STOCK_DAILY') reasons.push('STOCK_DAILY_FALLBACK_USED');
    else if (fallbackUsed === 'ETF') reasons.push('ETF_FALLBACK_USED');
    else if (fallbackUsed === 'CACHE') reasons.push('CACHE_STALE');
    dataQuality = 'PARTIAL';
  }
  // ⑥ validSectorCount < 9 (PARTIAL_MIN) → STALE + VALID_SECTOR_COUNT_LOW
  else if (
    Number.isFinite(input.validSectorCount) &&
    input.validSectorCount < SECTOR_ENERGY_QUALITY_THRESHOLDS.VALID_SECTOR_COUNT_LOW_THRESHOLD
  ) {
    reasons.push('VALID_SECTOR_COUNT_LOW');
    dataQuality = 'STALE';
  }
  // ⑦ 그 외 — OK
  else {
    reasons.push('OK');
    dataQuality = 'OK';
  }

  // CACHE_STALE 추가 첨부 (cacheAgeMs > 4h, 다른 reasons 와 동시 가능)
  if (
    input.cacheAgeMs !== undefined &&
    Number.isFinite(input.cacheAgeMs) &&
    input.cacheAgeMs > SECTOR_ENERGY_QUALITY_THRESHOLDS.CACHE_STALE_THRESHOLD_MS &&
    !reasons.includes('CACHE_STALE')
  ) {
    reasons.push('CACHE_STALE');
    if (dataQuality === 'OK') dataQuality = 'PARTIAL';
  }

  const operatorMessage = buildOperatorMessage(dataQuality, reasons, indexCodeCoverage, fallbackUsed);
  const officialIndexCoverage = Number.isFinite(input.officialIndexCoverage) ? Math.max(0, Math.min(1, Number(input.officialIndexCoverage))) : indexCodeCoverage;
  const internalProxyCoverage = Number.isFinite(input.internalProxyCoverage) ? Math.max(0, Math.min(1, Number(input.internalProxyCoverage))) : 0;
  const stockBasketCoverage = Number.isFinite(input.stockBasketCoverage)
    ? Math.max(0, Math.min(1, Number(input.stockBasketCoverage)))
    : input.sourceTier === 'KIS_STOCK_BASKET_DERIVED' ? 1 : 0;
  const leadershipConfidence: 'VERIFIED' | 'PARTIAL' | 'SHADOW_ONLY' | 'BLOCKED' =
    officialIndexCoverage >= 0.8 ? 'VERIFIED'
      : officialIndexCoverage > 0 ? 'PARTIAL'
        : (internalProxyCoverage > 0 || stockBasketCoverage > 0) ? 'SHADOW_ONLY'
          : 'BLOCKED';
  const promotionAllowed = leadershipConfidence === 'VERIFIED';
  const shadowLeadershipAllowed = internalProxyCoverage > 0 || stockBasketCoverage > 0 || leadershipConfidence === 'VERIFIED' || leadershipConfidence === 'PARTIAL';
  const reasonCodes = [
    ...(officialIndexCoverage === 0 ? ['OFFICIAL_INDEX_COVERAGE_ZERO'] : []),
    ...(officialIndexCoverage > 0 && officialIndexCoverage < 0.8 ? ['OFFICIAL_INDEX_COVERAGE_BELOW_THRESHOLD'] : []),
    ...(leadershipConfidence === 'SHADOW_ONLY' ? ['SHADOW_LEADERSHIP_RECORDED'] : []),
    ...(promotionAllowed ? ['OFFICIAL_INDEX_MASTER_LOADED'] : ['PROMOTION_DISABLED_COVERAGE_BELOW_80']),
    'EXECUTION_IMPACT_NONE_CONFIRMED',
  ];

  // ADR-0424: backfill stats + repair status 분류 SSOT.
  const indexCodeBackfilledCount =
    Number.isFinite(input.indexCodeBackfilledCount) && (input.indexCodeBackfilledCount ?? 0) >= 0
      ? Math.floor(input.indexCodeBackfilledCount as number)
      : 0;
  const repairStatus = classifyRepairStatus(
    dataQuality,
    indexCodeCoverage,
    Boolean(input.symmetryValidationPassed),
    fallbackUsed,
    indexCodeBackfilledCount,
  );

  return {
    dataQuality,
    reasons,
    validSectorCount: Number.isFinite(input.validSectorCount) ? Math.max(0, Math.floor(input.validSectorCount)) : 0,
    expectedSectorCount,
    indexCodeCoverage,
    missingIndexCodeCount,
    totalSectorRows: Number.isFinite(input.totalSectorRows) ? Math.max(0, Math.floor(input.totalSectorRows)) : 0,
    ...(input.sourceTier ? { sourceTier: input.sourceTier } : {}),
    fallbackUsed,
    symmetryValidationPassed: Boolean(input.symmetryValidationPassed),
    shouldBlockLeadershipConfidence: shouldBlockLeadershipConfidence(dataQuality),
    operatorMessage,
    // ADR-0424 — 옵셔널 필드 (후방호환).
    indexCodeBackfilledCount,
    repairStatus,
    // ADR-0446 — Phase 2 진단 + Sanity violation 진단 (옵셔널, 후방호환).
    ...(input.sectorIndexRecovery ? { sectorIndexRecovery: input.sectorIndexRecovery } : {}),
    // KRX-SECTOR-INDEXCODE-RAW-DIAGNOSTIC-001 — KRX raw 입력 부검 (옵셔널, 후방호환, propagate 만).
    ...(input.krxSectorIndexRaw ? { krxSectorIndexRaw: input.krxSectorIndexRaw } : {}),
    ...(input.sanityViolation ? { sanityViolation: input.sanityViolation } : {}),
    ...(input.coverageBreakdown ? { coverageBreakdown: input.coverageBreakdown } : {}),
    ...(input.representativeBasketAudit ? { representativeBasketAudit: input.representativeBasketAudit } : {}),
    ...(input.groupedSectorEnergy ? { groupedSectorEnergy: input.groupedSectorEnergy } : {}),
    // ADR-0447 — alias expansion 카운트 (옵셔널, 후방호환).
    // Caller 명시 전달 우선, 미전달 시 sectorIndexRecovery 자동 propagate.
    ...(input.aliasExpansionRecovered !== undefined
      ? { aliasExpansionRecovered: input.aliasExpansionRecovered }
      : input.sectorIndexRecovery?.aliasExpansionRecovered !== undefined
        ? { aliasExpansionRecovered: input.sectorIndexRecovery.aliasExpansionRecovered }
        : {}),
    ...(input.nonSectorAggregateIgnored !== undefined
      ? { nonSectorAggregateIgnored: input.nonSectorAggregateIgnored }
      : input.sectorIndexRecovery?.nonSectorAggregateIgnored !== undefined
        ? { nonSectorAggregateIgnored: input.sectorIndexRecovery.nonSectorAggregateIgnored }
        : {}),
    ...(input.topRecoveredAliases !== undefined
      ? { topRecoveredAliases: input.topRecoveredAliases }
      : input.sectorIndexRecovery?.topRecoveredAliases !== undefined
        ? { topRecoveredAliases: input.sectorIndexRecovery.topRecoveredAliases }
        : {}),
    officialIndexCoverage,
    internalProxyCoverage,
    stockBasketCoverage,
    leadershipConfidence,
    promotionAllowed,
    shadowLeadershipAllowed,
    counterfactualAllowed: true,
    selectedSectorEnergySourceTier: input.sourceTier ?? 'NONE',
    reasonCodes,
  };
}

// ─── /scan_blockers SectorEnergy 섹션 포맷터 (사용자 §F) ─────────────────

/**
 * ADR-0423: /scan_blockers 메시지 SectorEnergy 진단 섹션 SSOT.
 *
 * `diagnostic` undefined 시 null (정상 시 미노출, 호출자 측 fallback 가능).
 *
 * 사용자 §F 표시 정책:
 *   - dataQuality / validSectorCount / indexCodeCoverage / missingIndexCodeCount /
 *     symmetryValidation / fallbackUsed / reasons (Top 3) / leadershipConfidence / operatorAction
 *   - 텔레그램 메시지 길이 제한 — Top 3 reasons 만.
 *
 * 사용자 명시 정책:
 *   - "매수 차단" 표현 금지 — 진단 only.
 *   - operatorAction = "sector indexCode mapping/provider cache 점검 우선".
 */
export function formatSectorEnergyQualityDiagnosticSection(
  diagnostic: SectorEnergyQualityDiagnostic | null | undefined,
): string | null {
  if (!diagnostic) return null;

  const lines: string[] = [];
  lines.push('🌐 <b>SectorEnergy 진단 (ADR-0423):</b>');
  lines.push(`  • dataQuality: ${diagnostic.dataQuality}`);
  lines.push(`  • validSectorCount: ${diagnostic.validSectorCount}/${diagnostic.expectedSectorCount}`);
  lines.push(`  • indexCodeCoverage: ${(diagnostic.indexCodeCoverage * 100).toFixed(1)}%`);
  lines.push(`  • missingIndexCodeCount: ${diagnostic.missingIndexCodeCount}/${diagnostic.totalSectorRows}`);
  lines.push(`  • symmetryValidation: ${diagnostic.symmetryValidationPassed ? 'PASSED' : 'FAILED'}`);
  lines.push(`  • fallbackUsed: ${diagnostic.fallbackUsed}`);


  const audit = diagnostic.representativeBasketAudit;
  const coverage = diagnostic.coverageBreakdown;
  if (audit) {
    lines.push('');
    lines.push('🌐 SectorEnergy Recovery Audit');
    lines.push(`  • dataQuality: ${diagnostic.dataQuality}`);
    lines.push(`  • validSectorCount: ${diagnostic.validSectorCount}/${diagnostic.expectedSectorCount}`);
    lines.push(`  • officialIndex: ${audit.officialSectorIndexAvailable ? 'available' : 'unavailable'}`);
    lines.push(`  • basket: KIS representative, rows=${audit.representativeBasketActualRows}/${audit.representativeBasketExpectedRows}`);
    lines.push('  • rowFreshness:');
    lines.push(`    freshRows=${audit.priceRowsFresh} staleRows=${audit.priceRowsStale} missingRows=${audit.representativeBasketMissingRows}`);
    lines.push(`  • breakPoint: ${audit.breakPoint}`);
    lines.push(`  • sectorBoostAllowed=${audit.sectorBoostAllowed}`);
    lines.push(`  • strongBuyAllowed=${audit.strongBuyAllowed}`);
    lines.push(`  • executionHardBlock=${audit.executionHardBlock}`);
    lines.push(`  • executionImpact=${audit.executionImpact}`);
    lines.push(`  • nextAction: ${audit.nextAction}`);
  }
  if (coverage) {
    const topProblems = coverage.sectorRows
      .filter((row) => row.reason !== 'OK')
      .slice(0, 3);
    lines.push('  • sectorCoverage:');
    const partialQualitySectorCount = coverage.partialQualitySectorCount ?? coverage.partialSectorCount;
    const fullQualitySectorCount = coverage.fullQualitySectorCount ?? Math.max(0, coverage.validSectorCount - partialQualitySectorCount - coverage.staleSectorCount);
    lines.push(`    validSectorCount=${coverage.validSectorCount} fullQualitySectorCount=${fullQualitySectorCount} partialQualitySectorCount=${partialQualitySectorCount} staleSectorCount=${coverage.staleSectorCount} missingSectorCount=${coverage.missingSectorCount}`);
    if (topProblems.length > 0) {
      lines.push('  • topProblems:');
      topProblems.forEach((row, index) => {
        const problemType = row.reason === 'PRICE_ROWS_MISSING' ? 'priceRowsMissing'
          : row.reason === 'PRICE_ROWS_STALE' ? 'priceRowsStale'
            : row.reason === 'NO_REPRESENTATIVE_SYMBOLS' ? 'representativeSymbolsMissing'
              : row.reason;
        const rowLevelStatus = row.priceRowsMissing > 0 ? 'MISSING_ROWS' : row.freshness;
        const action = row.reason === 'PRICE_ROWS_STALE' ? 'REFRESH_SECTOR_BASKET_PRICE_CACHE'
          : row.reason === 'PRICE_ROWS_MISSING' ? 'WIRE_KIS_DAILY_PRICE_ROWS_FOR_SECTOR_BASKET'
            : 'VERIFY_SECTOR_COVERAGE_INPUT';
        lines.push(`    ${index + 1}. layer=PRODUCTION_BASKET sector=${row.sectorName} problemType=${problemType} rowLevelStatus=${rowLevelStatus} sectorLevelStatus=${row.freshness} action=${action}`);
      });
    }
  }


  const groupedSection = formatGroupedSectorEnergyDiagnosticSection(diagnostic.groupedSectorEnergy);
  if (groupedSection) {
    lines.push('');
    lines.push(groupedSection);
  }

  // Top 3 reasons (텔레그램 메시지 길이 제한)
  const filteredReasons = diagnostic.reasons.filter((r) => r !== 'OK');
  if (filteredReasons.length > 0) {
    lines.push('  • reasons:');
    const topReasons = filteredReasons.slice(0, 3);
    topReasons.forEach((r, i) => {
      lines.push(`    ${i + 1}. ${r}`);
    });
    if (filteredReasons.length > 3) {
      lines.push(`    ... 외 ${filteredReasons.length - 3}건`);
    }
  }

  const leadershipConfidence = diagnostic.sourceTier === 'KIS_STOCK_BASKET_DERIVED'
    ? 'SHADOW_ONLY'
    : diagnostic.shouldBlockLeadershipConfidence ? 'BLOCKED' : 'OK';
  lines.push(`  • leadershipConfidence: ${leadershipConfidence}`);

  // ADR-0424: backfill stats + repair status (옵셔널, 후방호환).
  if (diagnostic.indexCodeBackfilledCount !== undefined && diagnostic.indexCodeBackfilledCount > 0) {
    lines.push(
      `  • indexCodeBackfilledCount: ${diagnostic.indexCodeBackfilledCount} (NAME_LOOKUP via SECTOR_INDEX_MASTER)`,
    );
  }
  if (diagnostic.repairStatus !== undefined) {
    lines.push(`  • repairStatus: ${diagnostic.repairStatus}`);
  }

  if (diagnostic.shouldBlockLeadershipConfidence) {
    lines.push('  • operatorAction: sector indexCode mapping/provider cache 점검 우선');
  } else if (diagnostic.sourceTier === 'KIS_STOCK_BASKET_DERIVED') {
    lines.push('  • operatorAction: observe 20D KIS basket history before promotion audit.');
  } else if (diagnostic.repairStatus === 'RECOVERED') {
    lines.push(
      '  • operatorAction: KRX 본체 정상 — backfill 로 복구 (ADR-0424). 데이터 결손 빈도 모니터링.',
    );
  } else if (diagnostic.repairStatus === 'NOT_NEEDED') {
    lines.push('  • operatorAction: none — sector-index leadership 정상.');
  }

  if (diagnostic.operatorMessage) {
    lines.push('');
    lines.push(`  <i>${diagnostic.operatorMessage}</i>`);
  }

  return lines.join('\n');
}
