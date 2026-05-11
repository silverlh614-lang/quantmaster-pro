// @responsibility sectorEnergy dataQuality 5단계 + 4-axis SSOT (ADR-0396)
/**
 * sectorEnergyDataQuality.ts (ADR-0396 = 사용자 명시 ADR-0371)
 *
 * SectorEnergyDataQuality 5단계 union + sourceTier / freshness / coverage / confidence 4-axis
 * 합성 SSOT. ADR-0125 단일 STALE 라벨이 4 종류 결함을 동시에 표현하던 결함 차단.
 *
 * 핵심 정책 (사용자 명시 절대 변경 금지):
 *   - validSectorCount 계단화: 12=OK / 9-11=PARTIAL / 6-8=STALE / 3-5=DEGRADED / 0-2=FAILED
 *   - sourceWeight: KRX_CODE=1.0 / STOCK_DAILY=0.85 / CACHE=0.7 / YAHOO_ETF=0.5 / FAILED=0
 *   - freshnessWeight: FRESH=1.0 / DEGRADED=0.7 / EXPIRED=0.4
 *   - cache age: ≤30분 FRESH / 30분~4h DEGRADED / >4h EXPIRED
 *   - confidence = clamp(sourceWeight × freshnessWeight × coverage, 0, 1)
 *
 * ENV 우회: SECTOR_ENERGY_DATAQUALITY_DECOMPOSITION_DISABLED=true (default OFF)
 *   - 활성화 시 ADR-0125 4-state 동작 100% 복원 (회귀 1줄 즉시 롤백)
 *   - 정확 비교 (=== 'true') ADR-0157 의무
 *
 * 호출자 측 inline ENV 검사 0건 — SSOT 위임 (ADR-0185~0189 정합).
 */

/**
 * ADR-0396: 5단계 union — DEGRADED 신규 (심각한 부족, 보조 신호로만 사용 가능).
 * ADR-0415: PARTIAL_VOLUME 신규 — 가격은 정상이나 거래량/일부 섹터 누락 (BUY 까지만).
 *
 * 6단계 분기 (사용자 명시 정책 절대 변경 금지):
 *   - OK            : 모든 섹터 정상 (validSectorCount=12)
 *   - PARTIAL       : 9~11 섹터 정상 (보조 신호 가능)
 *   - PARTIAL_VOLUME: 가격은 정상이나 거래량/일부 섹터 누락 (BUY 까지만, ADR-0415)
 *   - STALE         : 6~8 섹터 정상 (STRONG_BUY 금지, ADR-0415)
 *   - DEGRADED      : 3~5 섹터 정상 (STRONG_BUY 금지, ADR-0398)
 *   - FAILED        : 0~2 섹터 또는 산출 불가 (STRONG_BUY 금지, ADR-0398)
 *
 * 이름은 보존 (호출자 정합) — value 만 6단계 격상.
 */
export type SectorEnergyDataQuality5 =
  | 'OK'
  | 'PARTIAL'
  | 'PARTIAL_VOLUME'
  | 'STALE'
  | 'DEGRADED'
  | 'FAILED';

/** ADR-0396: 원천 데이터 출처 — 4-tier fallback chain + FAILED. */
export type SectorEnergySourceTier =
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

/** ADR-0396: cache age 기반 freshness 분기 — 30분/4h 임계. */
export type SectorEnergyFreshness = 'FRESH' | 'DEGRADED' | 'EXPIRED';

/** ADR-0396: 4-axis 합성 결과 SSOT. macroState 영속 + 호출자 read 단일 통로. */
export interface SectorEnergyQualityComposite {
  /** UI/게이트용 요약값 (5단계). */
  dataQuality: SectorEnergyDataQuality5;
  /** 원천 데이터 출처. */
  sourceTier: SectorEnergySourceTier;
  /** cache age 기반 freshness. */
  freshness: SectorEnergyFreshness;
  /** validSectorCount / totalSectorCount (0~1). */
  coverage: number;
  /** sourceWeight × freshnessWeight × coverage (0~1, clamp). */
  confidence: number;
}

// ─── 사용자 명시 정책 SSOT (절대 변경 금지) ──────────────────────────────────

/** validSectorCount 계단화 매트릭스 임계값 SSOT (사용자 명시). */
export const SECTOR_QUALITY_THRESHOLDS = Object.freeze({
  OK: 12,
  PARTIAL_MIN: 9,
  STALE_MIN: 6,
  DEGRADED_MIN: 3,
  // FAILED = 0~2
} as const);

/** sourceWeight SSOT (사용자 명시). */
export const SOURCE_WEIGHT: Readonly<Record<SectorEnergySourceTier, number>> = Object.freeze({
  KIS_OFFICIAL_INDEX: 1.0,
  KIS_OFFICIAL_DAILY: 1.0,
  KIS_STOCK_BASKET_DERIVED: 0.75,
  KRX_OFFICIAL_INDEX: 1.0,
  KRX_CODE: 1.0,
  STOCK_DAILY: 0.85,
  CACHE: 0.7,
  YAHOO_GLOBAL_PROXY: 0.5,
  YAHOO_ETF: 0.5,
  INTERNAL_PROXY: 0.2,
  MISSING: 0,
  FAILED: 0,
});

/** freshnessWeight SSOT (사용자 명시). */
export const FRESHNESS_WEIGHT: Readonly<Record<SectorEnergyFreshness, number>> = Object.freeze({
  FRESH: 1.0,
  DEGRADED: 0.7,
  EXPIRED: 0.4,
});

/** cache age 임계 (밀리초) SSOT (사용자 명시). */
export const CACHE_AGE_THRESHOLDS_MS = Object.freeze({
  FRESH_MAX: 30 * 60 * 1000, // 30분
  DEGRADED_MAX: 4 * 60 * 60 * 1000, // 4h
} as const);

/** 12 섹터 (1 ~ 1) coverage 산출용. */
export const TOTAL_SECTOR_COUNT_DEFAULT = 12;

// ─── ENV gate SSOT (호출자 측 inline 검사 0건) ──────────────────────────────

/**
 * ADR-0396: ENV `SECTOR_ENERGY_DATAQUALITY_DECOMPOSITION_DISABLED=true` 시 ADR-0125 4-state
 * 동작 100% 복원. 정확 비교 (=== 'true') — ADR-0157 의무 정합.
 */
export function isSectorEnergyDataQualityDecompositionDisabled(): boolean {
  return process.env.SECTOR_ENERGY_DATAQUALITY_DECOMPOSITION_DISABLED === 'true';
}

// ─── 4-axis 산출 헬퍼 SSOT ────────────────────────────────────────────────

/**
 * validSectorCount 계단화 매트릭스 → dataQuality 5단계.
 * 사용자 명시 정책 (절대 변경 금지):
 *   12 → OK / 9-11 → PARTIAL / 6-8 → STALE / 3-5 → DEGRADED / 0-2 → FAILED
 *
 * NaN/Infinity/음수 → 0 fallback (FAILED).
 */
export function classifyDataQualityFromValidCount(
  validSectorCount: number,
  totalSectorCount: number = TOTAL_SECTOR_COUNT_DEFAULT,
): SectorEnergyDataQuality5 {
  if (!Number.isFinite(validSectorCount) || validSectorCount < 0) return 'FAILED';
  // OK 임계는 totalSectorCount 와 동일 (12) — totalSectorCount override 시도 OK 임계만 적응.
  if (validSectorCount >= totalSectorCount) return 'OK';
  if (validSectorCount >= SECTOR_QUALITY_THRESHOLDS.PARTIAL_MIN) return 'PARTIAL';
  if (validSectorCount >= SECTOR_QUALITY_THRESHOLDS.STALE_MIN) return 'STALE';
  if (validSectorCount >= SECTOR_QUALITY_THRESHOLDS.DEGRADED_MIN) return 'DEGRADED';
  return 'FAILED';
}

/**
 * cache age (밀리초) → freshness 3단계.
 * NaN/Infinity/음수 → EXPIRED 보수 fallback (caller side stale data 인지 가능).
 */
export function classifyFreshnessFromAgeMs(ageMs: number): SectorEnergyFreshness {
  if (!Number.isFinite(ageMs) || ageMs < 0) return 'EXPIRED';
  if (ageMs <= CACHE_AGE_THRESHOLDS_MS.FRESH_MAX) return 'FRESH';
  if (ageMs <= CACHE_AGE_THRESHOLDS_MS.DEGRADED_MAX) return 'DEGRADED';
  return 'EXPIRED';
}

/**
 * coverage 산출 — validSectorCount / totalSectorCount, clamp [0, 1].
 * NaN/Infinity/0 division → 0 fallback.
 */
export function computeCoverage(
  validSectorCount: number,
  totalSectorCount: number = TOTAL_SECTOR_COUNT_DEFAULT,
): number {
  if (!Number.isFinite(validSectorCount) || validSectorCount < 0) return 0;
  if (!Number.isFinite(totalSectorCount) || totalSectorCount <= 0) return 0;
  const ratio = validSectorCount / totalSectorCount;
  if (!Number.isFinite(ratio)) return 0;
  return Math.max(0, Math.min(1, ratio));
}

/**
 * confidence 합성 SSOT — sourceWeight × freshnessWeight × coverage, clamp [0, 1].
 * 사용자 명시 정책 (절대 변경 금지).
 */
export function computeConfidence(
  sourceTier: SectorEnergySourceTier,
  freshness: SectorEnergyFreshness,
  coverage: number,
): number {
  const sw = SOURCE_WEIGHT[sourceTier] ?? 0;
  const fw = FRESHNESS_WEIGHT[freshness] ?? 0;
  const cw = Number.isFinite(coverage) ? Math.max(0, Math.min(1, coverage)) : 0;
  const raw = sw * fw * cw;
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.min(1, raw));
}

/**
 * 4-axis 통합 합성 — 호출자 측 단일 진입점.
 *
 * @param validSectorCount 유효 섹터 수 (returns.length>0 인 섹터)
 * @param sourceTier 원천 데이터 출처
 * @param ageMs cache age (밀리초) — KRX 정상 fetch 시 0 전달 (FRESH 자동 분류)
 * @param totalSectorCount 전체 섹터 수 (default 12)
 */
export function buildSectorEnergyQualityComposite(
  validSectorCount: number,
  sourceTier: SectorEnergySourceTier,
  ageMs: number,
  totalSectorCount: number = TOTAL_SECTOR_COUNT_DEFAULT,
): SectorEnergyQualityComposite {
  const dataQuality = classifyDataQualityFromValidCount(validSectorCount, totalSectorCount);
  const freshness = classifyFreshnessFromAgeMs(ageMs);
  const coverage = computeCoverage(validSectorCount, totalSectorCount);
  const confidence = computeConfidence(sourceTier, freshness, coverage);
  return {
    dataQuality,
    sourceTier,
    freshness,
    coverage,
    confidence,
  };
}

/**
 * ADR-0125 4-state ↔ ADR-0396 5-state 후방호환 매핑.
 * 기존 영속 데이터 (`'OK'/'PARTIAL'/'STALE'/'FAILED'`) 그대로 보존 — 사용자 4/30 정책 정합.
 * `'DEGRADED'` 는 신규 전용 — legacy 매핑 부재.
 */
export function isLegacy4StateDataQuality(
  q: string | undefined | null,
): q is 'OK' | 'PARTIAL' | 'STALE' | 'FAILED' {
  return q === 'OK' || q === 'PARTIAL' || q === 'STALE' || q === 'FAILED';
}

/** 6-state 검증 — type guard (ADR-0415 PARTIAL_VOLUME 추가). */
export function isSectorEnergyDataQuality5(
  q: string | undefined | null,
): q is SectorEnergyDataQuality5 {
  return (
    q === 'OK' ||
    q === 'PARTIAL' ||
    q === 'PARTIAL_VOLUME' ||
    q === 'STALE' ||
    q === 'DEGRADED' ||
    q === 'FAILED'
  );
}
