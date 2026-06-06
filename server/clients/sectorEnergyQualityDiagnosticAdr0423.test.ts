/**
 * @responsibility ADR-0423 회귀 — SectorEnergy 데이터 진실성 진단 SSOT
 *
 * 사용자 §J 명시 9 케이스 + 추가 안전 invariant + Gate2/NO_LEADERSHIP 연결 + ADR 본문 정합 가드.
 *
 * 핵심 불변식 (사용자 명시 — 본 테스트가 영구 보호):
 *   1. SectorEnergy STALE 은 정상 데이터가 아니다.
 *   2. indexCode missing 을 숨기고 leadership OK 로 처리하면 안 된다.
 *   3. stock-daily fallback 은 정상 sector-index 기반 leadership 과 동급이 아니다.
 *   4. symmetry validation failed 는 단순 warning 이 아니라 dataQuality 를 낮추는 원인이다.
 *   5. Gate2 완화보다 SectorEnergy 데이터 진실성 복구가 먼저다.
 *   6. Gate threshold / weight / 매매 정책 절대 변경 금지.
 */

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  type SectorEnergyFallbackUsed,
  type SectorEnergyQualityDiagnostic,
  type SectorEnergyQualityReason,
  SECTOR_ENERGY_QUALITY_THRESHOLDS,
  buildOperatorMessage,
  computeIndexCodeCoverage,
  computeMissingIndexCodeCount,
  evaluateSectorEnergyQualityDiagnostic,
  formatSectorEnergyQualityDiagnosticSection,
  isSectorEnergyQualityDiagnosticDisabled,
  shouldBlockLeadershipConfidence,
} from './sectorEnergyQualityDiagnostic.js';
import { buildSectorEnergyDiagnostic } from '../trading/signalScanner/gate2LeadershipAttribution.js';

describe('ADR-0423 §J 사용자 명시 9 케이스', () => {
  it('1. indexCodeCoverage 0 이면 STALE — INDEX_CODE_COVERAGE_ZERO + leadershipConfidence BLOCKED', () => {
    const diag = evaluateSectorEnergyQualityDiagnostic({
      validSectorCount: 12,
      totalSectorRows: 12,
      rowsWithIndexCode: 0,
      symmetryValidationPassed: true,
    });
    expect(diag.dataQuality).toBe('STALE');
    expect(diag.reasons).toContain('INDEX_CODE_COVERAGE_ZERO');
    expect(diag.reasons).toContain('INDEX_CODE_MISSING');
    expect(diag.shouldBlockLeadershipConfidence).toBe(true);
    expect(diag.indexCodeCoverage).toBe(0);
    expect(diag.missingIndexCodeCount).toBe(12);
  });

  it('2. symmetry validation failed 면 OK 가 아니다 (핵심 불변식 #4)', () => {
    const diag = evaluateSectorEnergyQualityDiagnostic({
      validSectorCount: 12,
      totalSectorRows: 12,
      rowsWithIndexCode: 12,
      symmetryValidationPassed: false,
    });
    expect(diag.dataQuality).not.toBe('OK');
    expect(diag.reasons).toContain('SYMMETRY_VALIDATION_FAILED');
    expect(diag.shouldBlockLeadershipConfidence).toBe(true);
  });

  it('3. stock-daily fallback 사용 시 OK 가 아니다 (핵심 불변식 #3)', () => {
    const diag = evaluateSectorEnergyQualityDiagnostic({
      validSectorCount: 12,
      totalSectorRows: 12,
      rowsWithIndexCode: 12,
      symmetryValidationPassed: true,
      fallbackUsed: 'STOCK_DAILY',
    });
    expect(diag.dataQuality).not.toBe('OK');
    expect(['PARTIAL', 'DEGRADED', 'STALE'].includes(diag.dataQuality)).toBe(true);
    expect(diag.reasons).toContain('STOCK_DAILY_FALLBACK_USED');
  });

  it('4. indexCodeCoverage 낮으면 (< 0.8) DEGRADED — INDEX_CODE_COVERAGE_LOW', () => {
    const diag = evaluateSectorEnergyQualityDiagnostic({
      validSectorCount: 12,
      totalSectorRows: 12,
      rowsWithIndexCode: 6, // 50% coverage
      symmetryValidationPassed: true,
    });
    expect(diag.dataQuality).toBe('DEGRADED');
    expect(diag.reasons).toContain('INDEX_CODE_COVERAGE_LOW');
    expect(diag.indexCodeCoverage).toBe(0.5);
  });

  it('5. 정상 데이터면 OK — leadershipConfidence 차단 안 함', () => {
    const diag = evaluateSectorEnergyQualityDiagnostic({
      validSectorCount: 12,
      expectedSectorCount: 12,
      totalSectorRows: 12,
      rowsWithIndexCode: 12,
      symmetryValidationPassed: true,
      fallbackUsed: 'NONE',
    });
    expect(diag.dataQuality).toBe('OK');
    expect(diag.reasons).toEqual(['OK']);
    expect(diag.shouldBlockLeadershipConfidence).toBe(false);
  });



  it('KIS basket derived source is PARTIAL + READY_FOR_SHADOW, not OK or BLOCKED', () => {
    const diag = evaluateSectorEnergyQualityDiagnostic({
      validSectorCount: 12,
      expectedSectorCount: 12,
      totalSectorRows: 12,
      rowsWithIndexCode: 0,
      symmetryValidationPassed: true,
      fallbackUsed: 'NONE',
      sourceTier: 'KIS_STOCK_BASKET_DERIVED',
    });
    const section = formatSectorEnergyQualityDiagnosticSection(diag) ?? '';

    expect(diag.dataQuality).toBe('PARTIAL');
    expect(diag.reasons).toContain('KIS_BASKET_DERIVED_SHADOW');
    expect(diag.shouldBlockLeadershipConfidence).toBe(false);
    expect(section).toMatch(/legacyLeadershipConfidenceDiagnosticOnly: (READY_FOR_SHADOW|SHADOW_ONLY)/);
    expect(section).not.toContain('legacyLeadershipConfidenceDiagnosticOnly: OK');
    expect(diag.leadershipConfidence).toBe('SHADOW_ONLY');
    expect(diag.promotionAllowed).toBe(false);
    expect(diag.shadowLeadershipAllowed).toBe(true);
    expect(diag.counterfactualAllowed).toBe(true);
    expect(diag.reasonCodes).toContain('OFFICIAL_INDEX_COVERAGE_ZERO');
  });

  it('official coverage 80% 이상이면 VERIFIED + promotionAllowed=true', () => {
    const diag = evaluateSectorEnergyQualityDiagnostic({
      validSectorCount: 12,
      totalSectorRows: 12,
      rowsWithIndexCode: 12,
      symmetryValidationPassed: true,
      officialIndexCoverage: 0.8,
      internalProxyCoverage: 1,
      stockBasketCoverage: 1,
    });
    expect(diag.leadershipConfidence).toBe('VERIFIED');
    expect(diag.promotionAllowed).toBe(true);
  });

  it('6. totalSectorRows 0 이면 FAILED — SOURCE_EMPTY', () => {
    const diag = evaluateSectorEnergyQualityDiagnostic({
      validSectorCount: 0,
      totalSectorRows: 0,
      rowsWithIndexCode: 0,
      symmetryValidationPassed: false,
    });
    expect(diag.dataQuality).toBe('FAILED');
    expect(diag.reasons).toContain('SOURCE_EMPTY');
    expect(diag.shouldBlockLeadershipConfidence).toBe(true);
  });

  it('7. /scan_blockers formatter 가 ADR-0423 상세를 표시', () => {
    const diag: SectorEnergyQualityDiagnostic = {
      dataQuality: 'STALE',
      reasons: ['INDEX_CODE_COVERAGE_ZERO', 'INDEX_CODE_MISSING', 'STOCK_DAILY_FALLBACK_USED'],
      validSectorCount: 11,
      expectedSectorCount: 12,
      indexCodeCoverage: 0,
      missingIndexCodeCount: 12,
      totalSectorRows: 12,
      sourceTier: 'STOCK_DAILY',
      fallbackUsed: 'STOCK_DAILY',
      symmetryValidationPassed: false,
      shouldBlockLeadershipConfidence: true,
      operatorMessage: 'sector indexCode coverage is 0.0%; stock-daily fallback used only for degraded diagnostics.',
    };
    const section = formatSectorEnergyQualityDiagnosticSection(diag);
    expect(section).not.toBeNull();
    expect(section).toContain('SectorEnergy 진단 (ADR-0423)');
    expect(section).toContain('indexCodeCoverage');
    expect(section).toContain('symmetryValidation');
    expect(section).toContain('FAILED');
    expect(section).toContain('fallbackUsed');
    expect(section).toContain('STOCK_DAILY');
    expect(section).toContain('reasons');
    expect(section).toContain('legacyLeadershipConfidenceDiagnosticOnly');
    expect(section).toContain('BLOCKED');
    expect(section).toContain('STALE');
  });

  it('8. STALE 시 Gate2/NO_LEADERSHIP 진단 SECTOR_DATA_STALE_DOMINANT 와 정합', async () => {
    // ADR-0422 buildSectorEnergyDiagnostic 가 dataQuality ∈ {STALE, DEGRADED, FAILED} 시
    // isStale=true 를 부착 → ADR-0422 computeGate2LeadershipDiagnosis 가 SECTOR_DATA_STALE_DOMINANT 분기.
    // ADR-0423 이 출력하는 dataQuality 가 그 입력으로 정확히 정합해야 함.
    const diag = evaluateSectorEnergyQualityDiagnostic({
      validSectorCount: 11,
      totalSectorRows: 12,
      rowsWithIndexCode: 0,
      symmetryValidationPassed: false,
      fallbackUsed: 'STOCK_DAILY',
    });
    expect(diag.dataQuality).toBe('STALE');
    // ADR-0422 의 isStale 산출 정합 검증 (실제 빌더 호출).
    const gate2Diag = buildSectorEnergyDiagnostic({
      dataQuality: diag.dataQuality,
      validSectorCount: diag.validSectorCount,
      expectedSectorCount: diag.expectedSectorCount,
      reasons: diag.reasons.map((r) => r as string),
    });
    expect(gate2Diag.isStale).toBe(true);
  });

  it('9. STALE 은 failed 로 세지 않는다 — failed 카운터 미증가, stale 분리 영구 보장', () => {
    // ADR-0388/0416/0418 정합 — DATA_UNAVAILABLE / STALE / PROVIDER_DEGRADED 모두 failed 가 아님.
    // 본 SSOT 는 *진단 분류* 만 — failed 카운터 미사용 (별도 stale/unavailable 카운터는 ADR-0420/0422).
    const diag = evaluateSectorEnergyQualityDiagnostic({
      validSectorCount: 8,
      totalSectorRows: 12,
      rowsWithIndexCode: 0,
      symmetryValidationPassed: false,
    });
    expect(diag.dataQuality).toBe('STALE');
    // reasons 에 *경로* 의 failed 카운터 키워드 부재 — *원인 분리* 의무 보존.
    // 단, SYMMETRY_VALIDATION_FAILED 는 *원인명* (validation 결과 라벨) 이지
    // *categorical failed bucket* 이 아니다 — 허용. ADR-0420/0422 의 failed 카운터와 분리됨.
    const FAILED_CATEGORY_KEYWORDS = ['THRESHOLD_NOT_MET'];
    for (const r of diag.reasons) {
      // categorical failed bucket 키워드 부재 검증 (ADR-0388/0416/0418 정합)
      expect(FAILED_CATEGORY_KEYWORDS.includes(r as string)).toBe(false);
    }
    // Gate2 attribution 의 stale 카운터 분리 패턴 (ADR-0422 §D 정합):
    //   PROVIDER_DEGRADED + STALE detail → stale++ (failed++ 절대 금지).
    expect(diag.shouldBlockLeadershipConfidence).toBe(true);
  });
});

describe('ADR-0423 결정 트리 분기 SSOT (사용자 §C 정합)', () => {
  it('cacheAgeMs > 4h → CACHE_STALE 첨부', () => {
    const diag = evaluateSectorEnergyQualityDiagnostic({
      validSectorCount: 12,
      totalSectorRows: 12,
      rowsWithIndexCode: 12,
      symmetryValidationPassed: true,
      fallbackUsed: 'NONE',
      cacheAgeMs: 5 * 60 * 60 * 1000, // 5h > 4h
    });
    expect(diag.reasons).toContain('CACHE_STALE');
    expect(diag.dataQuality).not.toBe('OK'); // OK → PARTIAL 격하
  });

  it('cacheAgeMs < 4h → CACHE_STALE 미첨부 (정상 운영 잡음 차단)', () => {
    const diag = evaluateSectorEnergyQualityDiagnostic({
      validSectorCount: 12,
      totalSectorRows: 12,
      rowsWithIndexCode: 12,
      symmetryValidationPassed: true,
      fallbackUsed: 'NONE',
      cacheAgeMs: 30 * 60 * 1000, // 30분 < 4h
    });
    expect(diag.reasons).not.toContain('CACHE_STALE');
    expect(diag.dataQuality).toBe('OK');
  });

  it('validSectorCount < 9 + symmetry OK + fallback NONE + coverage 충분 → STALE + VALID_SECTOR_COUNT_LOW', () => {
    const diag = evaluateSectorEnergyQualityDiagnostic({
      validSectorCount: 7,
      totalSectorRows: 12,
      rowsWithIndexCode: 12, // 100%
      symmetryValidationPassed: true,
      fallbackUsed: 'NONE',
    });
    expect(diag.dataQuality).toBe('STALE');
    expect(diag.reasons).toContain('VALID_SECTOR_COUNT_LOW');
  });

  it('YAHOO_ETF fallback 사용 시 ETF_FALLBACK_USED 첨부', () => {
    const diag = evaluateSectorEnergyQualityDiagnostic({
      validSectorCount: 12,
      totalSectorRows: 12,
      rowsWithIndexCode: 12,
      symmetryValidationPassed: true,
      fallbackUsed: 'ETF',
    });
    expect(diag.reasons).toContain('ETF_FALLBACK_USED');
    expect(diag.dataQuality).toBe('PARTIAL');
  });

  it('CACHE fallback 사용 시 CACHE_STALE 첨부', () => {
    const diag = evaluateSectorEnergyQualityDiagnostic({
      validSectorCount: 12,
      totalSectorRows: 12,
      rowsWithIndexCode: 12,
      symmetryValidationPassed: true,
      fallbackUsed: 'CACHE',
    });
    expect(diag.reasons).toContain('CACHE_STALE');
    expect(diag.dataQuality).toBe('PARTIAL');
  });
});

describe('ADR-0423 헬퍼 함수 SSOT', () => {
  it('computeIndexCodeCoverage 정상/경계/안전 fallback', () => {
    expect(computeIndexCodeCoverage(0, 12)).toBe(0);
    expect(computeIndexCodeCoverage(6, 12)).toBe(0.5);
    expect(computeIndexCodeCoverage(12, 12)).toBe(1);
    // boundary clamp
    expect(computeIndexCodeCoverage(15, 12)).toBe(1);
    // 안전 fallback
    expect(computeIndexCodeCoverage(NaN, 12)).toBe(0);
    expect(computeIndexCodeCoverage(6, 0)).toBe(0);
    expect(computeIndexCodeCoverage(-1, 12)).toBe(0);
    // Infinity / NaN → 0 (보수적 fallback — 데이터 신뢰 불가).
    expect(computeIndexCodeCoverage(Infinity, 12)).toBe(0);
  });

  it('computeMissingIndexCodeCount 산출 정합', () => {
    expect(computeMissingIndexCodeCount(0, 12)).toBe(12);
    expect(computeMissingIndexCodeCount(6, 12)).toBe(6);
    expect(computeMissingIndexCodeCount(12, 12)).toBe(0);
    expect(computeMissingIndexCodeCount(15, 12)).toBe(0); // 음수 floor
    expect(computeMissingIndexCodeCount(NaN, 12)).toBe(12); // 안전 fallback
  });

  it('shouldBlockLeadershipConfidence — OK/PARTIAL 만 차단 안 함', () => {
    expect(shouldBlockLeadershipConfidence('OK')).toBe(false);
    expect(shouldBlockLeadershipConfidence('PARTIAL')).toBe(false);
    expect(shouldBlockLeadershipConfidence('PARTIAL_VOLUME')).toBe(true);
    expect(shouldBlockLeadershipConfidence('STALE')).toBe(true);
    expect(shouldBlockLeadershipConfidence('DEGRADED')).toBe(true);
    expect(shouldBlockLeadershipConfidence('FAILED')).toBe(true);
  });

  it('SECTOR_ENERGY_QUALITY_THRESHOLDS SSOT 정합 (사용자 §C 명시)', () => {
    expect(SECTOR_ENERGY_QUALITY_THRESHOLDS.INDEX_CODE_COVERAGE_LOW_THRESHOLD).toBe(0.8);
    expect(SECTOR_ENERGY_QUALITY_THRESHOLDS.VALID_SECTOR_COUNT_LOW_THRESHOLD).toBe(9);
    expect(SECTOR_ENERGY_QUALITY_THRESHOLDS.CACHE_STALE_THRESHOLD_MS).toBe(4 * 60 * 60 * 1000);
  });

  it('buildOperatorMessage — OK 시 healthy, STALE 시 진단 메시지', () => {
    expect(buildOperatorMessage('OK', ['OK'], 1, 'NONE')).toMatch(/healthy/);
    const msg = buildOperatorMessage(
      'STALE',
      ['INDEX_CODE_COVERAGE_ZERO', 'STOCK_DAILY_FALLBACK_USED'],
      0,
      'STOCK_DAILY',
    );
    expect(msg).toContain('coverage is 0.0%');
    expect(msg).toContain('stock-daily fallback');
  });

  it('isSectorEnergyQualityDiagnosticDisabled — ENV 정확 비교 (ADR-0157)', () => {
    const original = process.env.SECTOR_ENERGY_QUALITY_DIAGNOSTIC_DISABLED;
    try {
      delete process.env.SECTOR_ENERGY_QUALITY_DIAGNOSTIC_DISABLED;
      expect(isSectorEnergyQualityDiagnosticDisabled()).toBe(false);
      process.env.SECTOR_ENERGY_QUALITY_DIAGNOSTIC_DISABLED = 'true';
      expect(isSectorEnergyQualityDiagnosticDisabled()).toBe(true);
      // truthy 거부 (ADR-0157 정확 비교 의무)
      process.env.SECTOR_ENERGY_QUALITY_DIAGNOSTIC_DISABLED = '1';
      expect(isSectorEnergyQualityDiagnosticDisabled()).toBe(false);
      process.env.SECTOR_ENERGY_QUALITY_DIAGNOSTIC_DISABLED = 'TRUE';
      expect(isSectorEnergyQualityDiagnosticDisabled()).toBe(false);
    } finally {
      if (original === undefined) {
        delete process.env.SECTOR_ENERGY_QUALITY_DIAGNOSTIC_DISABLED;
      } else {
        process.env.SECTOR_ENERGY_QUALITY_DIAGNOSTIC_DISABLED = original;
      }
    }
  });
});


  it('staleRows=1이어도 rowFreshness와 sectorCoverage를 분리해 모순 없이 표시한다', () => {
    const diag: SectorEnergyQualityDiagnostic = {
      dataQuality: 'PARTIAL',
      reasons: ['KIS_BASKET_DERIVED_SHADOW'],
      validSectorCount: 12,
      expectedSectorCount: 12,
      indexCodeCoverage: 0,
      missingIndexCodeCount: 0,
      totalSectorRows: 12,
      fallbackUsed: 'NONE',
      symmetryValidationPassed: true,
      shouldBlockLeadershipConfidence: true,
      operatorMessage: 'test',
      representativeBasketAudit: {
        officialSectorIndexAvailable: false,
        usingKisRepresentativeBasket: true,
        representativeBasketExpectedRows: 12,
        representativeBasketActualRows: 12,
        representativeBasketMissingRows: 0,
        representativeSymbolsResolved: 48,
        representativeSymbolsMissing: 0,
        priceRowsFetched: 48,
        priceRowsFresh: 11,
        priceRowsStale: 1,
        latestAvailableDate: '20260514',
        previousTradingDate: '20260513',
        staleThresholdTradingDays: 1,
        breakPoint: 'REPRESENTATIVE_PRICE_ROWS_STALE',
        nextAction: 'REFRESH_SECTOR_BASKET_PRICE_CACHE',
        sectorBoostAllowed: false,
        strongBuyAllowed: false,
        executionHardBlock: false,
        executionImpact: 'NONE',
      },
      coverageBreakdown: {
        expectedSectorCount: 12,
        validSectorCount: 11,
        fullQualitySectorCount: 11,
        staleSectorCount: 1,
        missingSectorCount: 0,
        partialSectorCount: 0,
        executionImpact: 'NONE',
        sectorRows: [{
          sectorName: '금융',
          sectorCode: 'FINANCE',
          representativeSymbols: ['105560'],
          representativeSymbolCount: 1,
          priceRowsFound: 1,
          priceRowsMissing: 0,
          latestPriceDate: '20260510',
          ageTradingDays: 2,
          freshness: 'STALE',
          reason: 'PRICE_ROWS_STALE',
        }],
      },
    } as SectorEnergyQualityDiagnostic;

    const section = formatSectorEnergyQualityDiagnosticSection(diag) ?? '';
    expect(section).toContain('rowFreshness:');
    expect(section).toContain('freshRows=11 staleRows=1 missingRows=0');
    expect(section).toContain('sectorCoverage:');
    expect(section).toContain('validSectorCount=11 fullQualitySectorCount=11 partialQualitySectorCount=0 staleSectorCount=1 missingSectorCount=0');
    expect(section).toContain('topProblems:');
    expect(section).toContain('layer=PRODUCTION_BASKET sector=금융 problemType=priceRowsStale rowLevelStatus=STALE sectorLevelStatus=STALE');
  });

  it('coverage count를 valid/fullQuality/partialQuality로 정규화하고 topProblems layer를 표시한다', () => {
    const diag = {
      dataQuality: 'PARTIAL',
      reasons: ['KIS_STOCK_BASKET_DERIVED'],
      validSectorCount: 12,
      expectedSectorCount: 12,
      indexCodeCoverage: 0,
      missingIndexCodeCount: 0,
      totalSectorRows: 12,
      fallbackUsed: 'NONE',
      symmetryValidationPassed: true,
      shouldBlockLeadershipConfidence: true,
      operatorMessage: 'test',
      coverageBreakdown: {
        expectedSectorCount: 12,
        validSectorCount: 12,
        fullQualitySectorCount: 11,
        partialQualitySectorCount: 1,
        staleSectorCount: 0,
        missingSectorCount: 0,
        partialSectorCount: 1,
        executionImpact: 'NONE',
        sectorRows: [{
          sectorName: '2차전지',
          sectorCode: 'BATTERY',
          representativeSymbols: ['373220', '051910'],
          representativeSymbolCount: 2,
          priceRowsFound: 1,
          priceRowsMissing: 1,
          latestPriceDate: '20260514',
          ageTradingDays: 0,
          freshness: 'PARTIAL',
          reason: 'PRICE_ROWS_MISSING',
        }],
      },
    } as unknown as SectorEnergyQualityDiagnostic;

    const section = formatSectorEnergyQualityDiagnosticSection(diag) ?? '';
    expect(section).toContain('validSectorCount=12 fullQualitySectorCount=11 partialQualitySectorCount=1 staleSectorCount=0 missingSectorCount=0');
    expect(section).not.toContain('completeSectorCount=');
    expect(section).toContain('layer=PRODUCTION_BASKET sector=2차전지 problemType=priceRowsMissing rowLevelStatus=MISSING_ROWS sectorLevelStatus=PARTIAL action=WIRE_KIS_DAILY_PRICE_ROWS_FOR_SECTOR_BASKET');
  });


describe('ADR-0423 안전 invariant — Gate threshold / weight / 매매 정책 변경 0', () => {
  it('SSOT 모듈은 매매 결정 / 임계 / Gate threshold 변경 코드 없음', () => {
    const src = readFileSync('server/clients/sectorEnergyQualityDiagnostic.ts', 'utf8');
    // 매매 결정 함수 호출 없음
    expect(src).not.toMatch(/placeKisOrder|placeKisMarketBuyOrder|placeKisSellOrder/);
    expect(src).not.toMatch(/setGateThreshold|setMinGateScore/);
    // Gate2 임계 완화 권고 문구 없음
    expect(src).not.toMatch(/Gate threshold 완화|threshold 낮추기|MIN_GATE.*완화/);
    // STRONG_BUY 조건 변경 없음
    expect(src).not.toMatch(/STRONG_BUY.*=|setStrongBuy/);
    // weight 변경 없음
    expect(src).not.toMatch(/supply_confluence.*weight|setWeight/);
  });

  it('formatter 에 "매수 차단" 표현 없음 — 진단 only', () => {
    const diag: SectorEnergyQualityDiagnostic = {
      dataQuality: 'STALE',
      reasons: ['INDEX_CODE_COVERAGE_ZERO'],
      validSectorCount: 11,
      expectedSectorCount: 12,
      indexCodeCoverage: 0,
      missingIndexCodeCount: 12,
      totalSectorRows: 12,
      fallbackUsed: 'STOCK_DAILY',
      symmetryValidationPassed: false,
      shouldBlockLeadershipConfidence: true,
      operatorMessage: 'test',
    };
    const section = formatSectorEnergyQualityDiagnosticSection(diag) ?? '';
    expect(section).not.toContain('매수 차단');
    expect(section).not.toContain('매수 금지');
    // operatorAction 은 *데이터 점검* 안내만.
    expect(section).toContain('operatorAction');
    expect(section).toContain('점검 우선');
  });
});

describe('ADR-0423 wiring 정적 가드', () => {
  it('sectorEnergyProvider 가 withQualityDiagnostic SSOT 진입점에서 호출', () => {
    const src = readFileSync('server/clients/sectorEnergyProvider.ts', 'utf8');
    expect(src).toMatch(/withQualityDiagnostic/);
    expect(src).toMatch(/evaluateSectorEnergyQualityDiagnostic/);
    // 진입점 wrapper 사용
    expect(src).toMatch(/return withQualityDiagnostic\(/);
  });

  it('SymmetryValidationResult 가 todayRowsTotal / todayRowsWithIndexCode 옵셔널 필드 보유', () => {
    // ADR-0579: SymmetryValidationResult 타입은 sectorEnergyProvider/types.ts 로 추출됨 (ACMA 1500 한계).
    // 본문 + types 서브모듈을 함께 grep — 향후 이동에도 견고 (ADR-0444 static-grep-guard 패턴).
    const src = readFileSync('server/clients/sectorEnergyProvider.ts', 'utf8')
      + readFileSync('server/clients/sectorEnergyProvider/types.ts', 'utf8');
    expect(src).toMatch(/todayRowsTotal\?:\s*number/);
    expect(src).toMatch(/todayRowsWithIndexCode\?:\s*number/);
  });

  it('marketDataRefresh 가 sectorEnergyQualityDiagnostic 영속', () => {
    const src = readFileSync('server/trading/marketDataRefresh.ts', 'utf8');
    expect(src).toMatch(/sectorEnergyQualityDiagnostic/);
    // 옵셔널 spread 패턴 (후방호환)
    expect(src).toMatch(/sectorEnergyQualityDiagnostic !== undefined/);
  });

  it('signalScanner/index.ts 가 macroState 에서 carry-over', () => {
    const src = readFileSync('server/trading/signalScanner/index.ts', 'utf8');
    expect(src).toMatch(/sectorEnergyQualityDiagnostic/);
  });

  it('scanDiagnostics formatScanBlockersMessage 가 ADR-0423 섹션 호출', () => {
    const src = readFileSync('server/trading/signalScanner/scanDiagnostics.ts', 'utf8');
    expect(src).toMatch(/formatSectorEnergyQualityDiagnosticSection/);
    // ADR-0422 Gate2 섹션 *다음에* 본 섹션 추가됨 (책임 분리)
    expect(src).toMatch(/ADR-0423/);
  });

  it('/sector_energy_diag 가 ADR-0423 section 표시', () => {
    const src = readFileSync('server/telegram/commands/system/sectorEnergyDiag.cmd.ts', 'utf8');
    expect(src).toMatch(/formatSectorEnergyQualityDiagnosticSection/);
    expect(src).toMatch(/sectorEnergyQualityDiagnostic/);
  });
});

describe('ADR-0423 fallbackUsed 분류 매트릭스 정합', () => {
  const fallbacks: SectorEnergyFallbackUsed[] = ['NONE', 'STOCK_DAILY', 'ETF', 'CACHE'];

  it('각 fallbackUsed 값에 대응하는 reason 첨부', () => {
    for (const fallback of fallbacks) {
      const diag = evaluateSectorEnergyQualityDiagnostic({
        validSectorCount: 12,
        totalSectorRows: 12,
        rowsWithIndexCode: 12,
        symmetryValidationPassed: true,
        fallbackUsed: fallback,
      });
      if (fallback === 'NONE') {
        expect(diag.reasons.filter((r) => r.endsWith('_FALLBACK_USED')).length).toBe(0);
      } else if (fallback === 'STOCK_DAILY') {
        expect(diag.reasons).toContain('STOCK_DAILY_FALLBACK_USED');
      } else if (fallback === 'ETF') {
        expect(diag.reasons).toContain('ETF_FALLBACK_USED');
      } else if (fallback === 'CACHE') {
        expect(diag.reasons).toContain('CACHE_STALE');
      }
    }
  });

  it('fallback used + symmetry OK + coverage 충분 시 dataQuality === PARTIAL (사용자 §E)', () => {
    for (const fallback of ['STOCK_DAILY', 'ETF', 'CACHE'] as const) {
      const diag = evaluateSectorEnergyQualityDiagnostic({
        validSectorCount: 12,
        totalSectorRows: 12,
        rowsWithIndexCode: 12,
        symmetryValidationPassed: true,
        fallbackUsed: fallback,
      });
      expect(diag.dataQuality).toBe('PARTIAL');
    }
  });
});
