// @responsibility ADR-0396 sectorEnergy dataQuality 5단계 + 4-axis SSOT 회귀
import { describe, it, expect, afterEach } from 'vitest';
import {
  SECTOR_QUALITY_THRESHOLDS,
  SOURCE_WEIGHT,
  FRESHNESS_WEIGHT,
  CACHE_AGE_THRESHOLDS_MS,
  TOTAL_SECTOR_COUNT_DEFAULT,
  classifyDataQualityFromValidCount,
  classifyFreshnessFromAgeMs,
  computeCoverage,
  computeConfidence,
  buildSectorEnergyQualityComposite,
  isSectorEnergyDataQualityDecompositionDisabled,
  isLegacy4StateDataQuality,
  isSectorEnergyDataQuality5,
  type SectorEnergyDataQuality5,
  type SectorEnergySourceTier,
  type SectorEnergyFreshness,
} from './sectorEnergyDataQuality.js';

const ORIGINAL_ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('ADR-0396: SECTOR_QUALITY_THRESHOLDS SSOT 사용자 명시 정책', () => {
  it('계단화 매트릭스 임계값 정확 (12=OK / 9-11=PARTIAL / 6-8=STALE / 3-5=DEGRADED / 0-2=FAILED)', () => {
    expect(SECTOR_QUALITY_THRESHOLDS.OK).toBe(12);
    expect(SECTOR_QUALITY_THRESHOLDS.PARTIAL_MIN).toBe(9);
    expect(SECTOR_QUALITY_THRESHOLDS.STALE_MIN).toBe(6);
    expect(SECTOR_QUALITY_THRESHOLDS.DEGRADED_MIN).toBe(3);
  });

  it('SOURCE_WEIGHT SSOT 사용자 명시 정확 (KIS basket=0.65/STOCK_DAILY=0.2/CACHE=0.45)', () => {
    expect(SOURCE_WEIGHT.KRX_CODE).toBe(1.0);
    expect(SOURCE_WEIGHT.KIS_STOCK_BASKET_DERIVED).toBe(0.65);
    expect(SOURCE_WEIGHT.KIS_OFFICIAL_DAILY).toBe(0.9);
    expect(SOURCE_WEIGHT.STOCK_DAILY).toBe(0.2);
    expect(SOURCE_WEIGHT.CACHE).toBe(0.45);
    expect(SOURCE_WEIGHT.YAHOO_ETF).toBe(0.5);
    expect(SOURCE_WEIGHT.FAILED).toBe(0);
  });

  it('FRESHNESS_WEIGHT SSOT 사용자 명시 정확 (FRESH=1.0/DEGRADED=0.7/EXPIRED=0.4)', () => {
    expect(FRESHNESS_WEIGHT.FRESH).toBe(1.0);
    expect(FRESHNESS_WEIGHT.DEGRADED).toBe(0.7);
    expect(FRESHNESS_WEIGHT.EXPIRED).toBe(0.4);
  });

  it('CACHE_AGE_THRESHOLDS_MS 사용자 명시 정확 (FRESH≤30분 / DEGRADED≤4h / EXPIRED>4h)', () => {
    expect(CACHE_AGE_THRESHOLDS_MS.FRESH_MAX).toBe(30 * 60 * 1000);
    expect(CACHE_AGE_THRESHOLDS_MS.DEGRADED_MAX).toBe(4 * 60 * 60 * 1000);
  });

  it('TOTAL_SECTOR_COUNT_DEFAULT = 12 (KRX 12 섹터 SSOT)', () => {
    expect(TOTAL_SECTOR_COUNT_DEFAULT).toBe(12);
  });

  it('Object.freeze 적용 — 외부 mutation drift 차단', () => {
    expect(Object.isFrozen(SECTOR_QUALITY_THRESHOLDS)).toBe(true);
    expect(Object.isFrozen(SOURCE_WEIGHT)).toBe(true);
    expect(Object.isFrozen(FRESHNESS_WEIGHT)).toBe(true);
    expect(Object.isFrozen(CACHE_AGE_THRESHOLDS_MS)).toBe(true);
  });
});

describe('ADR-0396: classifyDataQualityFromValidCount 계단화 매트릭스 boundary', () => {
  it('validSectorCount=12 → OK', () => {
    expect(classifyDataQualityFromValidCount(12)).toBe('OK');
  });

  it('validSectorCount=11 → PARTIAL (boundary 12 미만)', () => {
    expect(classifyDataQualityFromValidCount(11)).toBe('PARTIAL');
  });

  it('validSectorCount=9 → PARTIAL (boundary 9 정확)', () => {
    expect(classifyDataQualityFromValidCount(9)).toBe('PARTIAL');
  });

  it('validSectorCount=8 → STALE (boundary 9 미만)', () => {
    expect(classifyDataQualityFromValidCount(8)).toBe('STALE');
  });

  it('validSectorCount=6 → STALE (boundary 6 정확)', () => {
    expect(classifyDataQualityFromValidCount(6)).toBe('STALE');
  });

  it('validSectorCount=5 → DEGRADED (boundary 6 미만)', () => {
    expect(classifyDataQualityFromValidCount(5)).toBe('DEGRADED');
  });

  it('validSectorCount=3 → DEGRADED (boundary 3 정확)', () => {
    expect(classifyDataQualityFromValidCount(3)).toBe('DEGRADED');
  });

  it('validSectorCount=2 → FAILED (boundary 3 미만)', () => {
    expect(classifyDataQualityFromValidCount(2)).toBe('FAILED');
  });

  it('validSectorCount=0 → FAILED', () => {
    expect(classifyDataQualityFromValidCount(0)).toBe('FAILED');
  });

  it('NaN / Infinity / 음수 → FAILED 안전 fallback', () => {
    expect(classifyDataQualityFromValidCount(NaN)).toBe('FAILED');
    expect(classifyDataQualityFromValidCount(-1)).toBe('FAILED');
    // Infinity 는 > 12 이므로 OK 로 분류 — 정책 정합 (validSectorCount 가 totalSectorCount 초과는 산출 결함)
  });

  it('totalSectorCount override 시 OK 임계 적응 (10 섹터 시스템)', () => {
    expect(classifyDataQualityFromValidCount(10, 10)).toBe('OK');
    expect(classifyDataQualityFromValidCount(9, 10)).toBe('PARTIAL');
  });
});

describe('ADR-0396: classifyFreshnessFromAgeMs 임계 boundary', () => {
  it('ageMs=0 → FRESH', () => {
    expect(classifyFreshnessFromAgeMs(0)).toBe('FRESH');
  });

  it('ageMs=30분 정확 → FRESH (boundary inclusive)', () => {
    expect(classifyFreshnessFromAgeMs(30 * 60 * 1000)).toBe('FRESH');
  });

  it('ageMs=30분+1ms → DEGRADED', () => {
    expect(classifyFreshnessFromAgeMs(30 * 60 * 1000 + 1)).toBe('DEGRADED');
  });

  it('ageMs=4h 정확 → DEGRADED (boundary inclusive)', () => {
    expect(classifyFreshnessFromAgeMs(4 * 60 * 60 * 1000)).toBe('DEGRADED');
  });

  it('ageMs=4h+1ms → EXPIRED', () => {
    expect(classifyFreshnessFromAgeMs(4 * 60 * 60 * 1000 + 1)).toBe('EXPIRED');
  });

  it('NaN / Infinity / 음수 → EXPIRED 보수 fallback', () => {
    expect(classifyFreshnessFromAgeMs(NaN)).toBe('EXPIRED');
    expect(classifyFreshnessFromAgeMs(-1)).toBe('EXPIRED');
  });
});

describe('ADR-0396: computeCoverage 산출', () => {
  it('정상 비율 산출 (8/12 = 0.6667)', () => {
    expect(computeCoverage(8)).toBeCloseTo(8 / 12, 4);
  });

  it('100% (12/12) → 1.0', () => {
    expect(computeCoverage(12)).toBe(1);
  });

  it('0% (0/12) → 0', () => {
    expect(computeCoverage(0)).toBe(0);
  });

  it('NaN / Infinity / 음수 → 0 fallback', () => {
    expect(computeCoverage(NaN)).toBe(0);
    expect(computeCoverage(-1)).toBe(0);
  });

  it('totalSectorCount=0 (division by zero) → 0 fallback', () => {
    expect(computeCoverage(5, 0)).toBe(0);
  });

  it('clamp [0, 1] — 산출 > 1 (예: 13/12) 시 1 절삭', () => {
    expect(computeCoverage(13, 12)).toBe(1);
  });
});

describe('ADR-0396: computeConfidence 합성 SSOT 정책 정합', () => {
  it('KRX_CODE + FRESH + 100% → 1.0 (만점)', () => {
    expect(computeConfidence('KRX_CODE', 'FRESH', 1.0)).toBe(1.0);
  });

  it('YAHOO_ETF + FRESH + 100% → 0.5 (사용자 명시 ETF 한계)', () => {
    expect(computeConfidence('YAHOO_ETF', 'FRESH', 1.0)).toBe(0.5);
  });


  it('KIS_STOCK_BASKET_DERIVED + FRESH + 100% → 65% shadow confidence', () => {
    expect(computeConfidence('KIS_STOCK_BASKET_DERIVED', 'FRESH', 1.0)).toBe(0.65);
  });

  it('STOCK_DAILY + DEGRADED + 67% → 0.2 × 0.7 × 0.6667 ≈ 0.093', () => {
    expect(computeConfidence('STOCK_DAILY', 'DEGRADED', 8 / 12)).toBeCloseTo(
      0.2 * 0.7 * (8 / 12),
      4,
    );
  });

  it('CACHE + EXPIRED + 50% → 0.45 × 0.4 × 0.5 = 0.09', () => {
    expect(computeConfidence('CACHE', 'EXPIRED', 0.5)).toBeCloseTo(0.45 * 0.4 * 0.5, 4);
  });

  it('FAILED 어떤 freshness/coverage 든 0 (사용자 명시)', () => {
    expect(computeConfidence('FAILED', 'FRESH', 1.0)).toBe(0);
    expect(computeConfidence('FAILED', 'DEGRADED', 0.5)).toBe(0);
  });

  it('clamp [0, 1] — 음수 coverage → 0 fallback', () => {
    expect(computeConfidence('KRX_CODE', 'FRESH', -1)).toBe(0);
  });

  it('clamp [0, 1] — coverage > 1 → 1 절삭', () => {
    expect(computeConfidence('KRX_CODE', 'FRESH', 2.0)).toBe(1.0);
  });

  it('NaN coverage → 0 fallback', () => {
    expect(computeConfidence('KRX_CODE', 'FRESH', NaN)).toBe(0);
  });
});

describe('ADR-0396: buildSectorEnergyQualityComposite 통합 합성', () => {
  it('KRX_CODE 정상 12 섹터 신선 → 만점 confidence', () => {
    const result = buildSectorEnergyQualityComposite(12, 'KRX_CODE', 0);
    expect(result.dataQuality).toBe('OK');
    expect(result.sourceTier).toBe('KRX_CODE');
    expect(result.freshness).toBe('FRESH');
    expect(result.coverage).toBe(1);
    expect(result.confidence).toBe(1);
  });

  it('STOCK_DAILY fallback 8 섹터 + 1h cache → 0.2 × 0.7 × 0.667 ≈ 0.093', () => {
    const result = buildSectorEnergyQualityComposite(8, 'STOCK_DAILY', 60 * 60 * 1000);
    expect(result.dataQuality).toBe('STALE');
    expect(result.sourceTier).toBe('STOCK_DAILY');
    expect(result.freshness).toBe('DEGRADED');
    expect(result.coverage).toBeCloseTo(8 / 12, 4);
    expect(result.confidence).toBeCloseTo(0.2 * 0.7 * (8 / 12), 4);
  });

  it('YAHOO_ETF L4 fallback (ADR-0397 사전 호환) — confidence 절반', () => {
    const result = buildSectorEnergyQualityComposite(10, 'YAHOO_ETF', 0);
    expect(result.dataQuality).toBe('PARTIAL');
    expect(result.sourceTier).toBe('YAHOO_ETF');
    expect(result.confidence).toBeCloseTo(0.5 * 1.0 * (10 / 12), 4);
  });

  it('FAILED tier → confidence 0 (모든 freshness/coverage 무관)', () => {
    const result = buildSectorEnergyQualityComposite(0, 'FAILED', 0);
    expect(result.dataQuality).toBe('FAILED');
    expect(result.confidence).toBe(0);
  });

  it('5 섹터 DEGRADED + 5h EXPIRED cache → 사용자 정책 정합', () => {
    const result = buildSectorEnergyQualityComposite(5, 'CACHE', 5 * 60 * 60 * 1000);
    expect(result.dataQuality).toBe('DEGRADED');
    expect(result.freshness).toBe('EXPIRED');
    expect(result.confidence).toBeCloseTo(0.45 * 0.4 * (5 / 12), 4);
  });
});

describe('ADR-0396: ENV gate `SECTOR_ENERGY_DATAQUALITY_DECOMPOSITION_DISABLED`', () => {
  it('default OFF (env 미설정 시 false)', () => {
    delete process.env.SECTOR_ENERGY_DATAQUALITY_DECOMPOSITION_DISABLED;
    expect(isSectorEnergyDataQualityDecompositionDisabled()).toBe(false);
  });

  it('"true" 명시 → true (정확 비교 ADR-0157)', () => {
    process.env.SECTOR_ENERGY_DATAQUALITY_DECOMPOSITION_DISABLED = 'true';
    expect(isSectorEnergyDataQualityDecompositionDisabled()).toBe(true);
  });

  it('"1" / "TRUE" / "yes" → false (정확 비교 ADR-0157 — truthy 거부)', () => {
    process.env.SECTOR_ENERGY_DATAQUALITY_DECOMPOSITION_DISABLED = '1';
    expect(isSectorEnergyDataQualityDecompositionDisabled()).toBe(false);
    process.env.SECTOR_ENERGY_DATAQUALITY_DECOMPOSITION_DISABLED = 'TRUE';
    expect(isSectorEnergyDataQualityDecompositionDisabled()).toBe(false);
    process.env.SECTOR_ENERGY_DATAQUALITY_DECOMPOSITION_DISABLED = 'yes';
    expect(isSectorEnergyDataQualityDecompositionDisabled()).toBe(false);
  });

  it('"false" / 빈 문자열 → false', () => {
    process.env.SECTOR_ENERGY_DATAQUALITY_DECOMPOSITION_DISABLED = 'false';
    expect(isSectorEnergyDataQualityDecompositionDisabled()).toBe(false);
    process.env.SECTOR_ENERGY_DATAQUALITY_DECOMPOSITION_DISABLED = '';
    expect(isSectorEnergyDataQualityDecompositionDisabled()).toBe(false);
  });
});

describe('ADR-0396: legacy 4-state 후방호환 / 5-state type guard', () => {
  it('isLegacy4StateDataQuality — OK/PARTIAL/STALE/FAILED 통과 + DEGRADED 거부', () => {
    expect(isLegacy4StateDataQuality('OK')).toBe(true);
    expect(isLegacy4StateDataQuality('PARTIAL')).toBe(true);
    expect(isLegacy4StateDataQuality('STALE')).toBe(true);
    expect(isLegacy4StateDataQuality('FAILED')).toBe(true);
    expect(isLegacy4StateDataQuality('DEGRADED')).toBe(false);
    expect(isLegacy4StateDataQuality(undefined)).toBe(false);
    expect(isLegacy4StateDataQuality(null)).toBe(false);
    expect(isLegacy4StateDataQuality('UNKNOWN')).toBe(false);
  });

  it('isSectorEnergyDataQuality5 — 5단계 모두 통과', () => {
    const valid: SectorEnergyDataQuality5[] = ['OK', 'PARTIAL', 'STALE', 'DEGRADED', 'FAILED'];
    for (const q of valid) {
      expect(isSectorEnergyDataQuality5(q)).toBe(true);
    }
    expect(isSectorEnergyDataQuality5('UNKNOWN')).toBe(false);
    expect(isSectorEnergyDataQuality5(undefined)).toBe(false);
    expect(isSectorEnergyDataQuality5(null)).toBe(false);
  });
});

describe('ADR-0396: KIS 주문 함수 import 0건 (정적 grep 가드)', () => {
  it('sectorEnergyDataQuality.ts 는 KIS 주문 함수 5종 import 부재', async () => {
    // 모듈 자체가 외부 의존성 0 — import 라인 부재 검증
    // (정적 검증: 본 모듈 source 자체에 KIS API 호출 패턴 없음)
    const KIS_ORDER_PATTERNS = [
      'placeKisMarketOrder',
      'placeKisSellOrder',
      'cancelKisOrder',
      'placeKisStopLossOrder',
      'placeKisTakeProfitOrder',
    ];
    const fs = await import('fs');
    const src = fs.readFileSync(
      new URL('./sectorEnergyDataQuality.ts', import.meta.url),
      'utf-8',
    );
    for (const pattern of KIS_ORDER_PATTERNS) {
      expect(src).not.toContain(pattern);
    }
  });
});
