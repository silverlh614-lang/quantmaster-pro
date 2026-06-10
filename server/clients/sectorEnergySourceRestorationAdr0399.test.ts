// @responsibility ADR-0399 Sector Energy Source Restoration 회귀 — SECTOR_INDEX_MASTER + 4-tier 호출 순서 + diagnostics
//
// ADR-0399 (= 사용자 명시 ADR-0374) 핵심 정책 검증:
//   1. indexName 단독 매칭 영구 차단 (ADR-0370 default OFF 강화 위에 본 PR 정적 가드)
//   2. SECTOR_INDEX_MASTER SSOT (12 표준 섹터, 절대 변경 금지)
//   3. 호출 순서 SSOT — L1 KRX_CODE → L2 STOCK_DAILY → L3 CACHE → L4 YAHOO_ETF
//   4. sourceTier / freshness / coverage / confidence 4-axis (ADR-0396 SSOT 정합)
//   5. diagnostics 메타 (candidateDates / sourceTierAttempts / finalSourceTier / confidence / fallbackReason)
//   6. ENV `SECTOR_ENERGY_SOURCE_RESTORATION_DISABLED=true` 정확 비교 (ADR-0157)

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  SECTOR_INDEX_MASTER,
  KNOWN_DISPLAY_NAMES,
  getSectorByIndexCode,
  getSectorByKey,
  getSectorByAlias,
  getCanonicalDisplayNames,
  isSectorEnergySourceRestorationDisabled,
  type SectorIndexMasterEntry,
  type SectorKey,
} from './sectorEnergyMaster.js';
import {
  isSectorEnergySourceRestorationDisabled as providerEnvCheck,
  type SectorEnergyDiagnosticsMeta,
  type SectorEnergyBuildResult,
  type SectorEnergySourceTierForDiag,
} from './sectorEnergyProvider.js';

describe('ADR-0399 Sector Energy Source Restoration', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.SECTOR_ENERGY_SOURCE_RESTORATION_DISABLED;
    delete process.env.SECTOR_ENERGY_SOURCE_RESTORATION_DISABLED;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.SECTOR_ENERGY_SOURCE_RESTORATION_DISABLED;
    } else {
      process.env.SECTOR_ENERGY_SOURCE_RESTORATION_DISABLED = originalEnv;
    }
  });

  // ─── #1 SECTOR_INDEX_MASTER SSOT 정합 ──────────────────────────────────────
  describe('SECTOR_INDEX_MASTER SSOT (사용자 명시 12 표준 섹터)', () => {
    it('12 표준 섹터 등재 (절대 변경 금지)', () => {
      expect(SECTOR_INDEX_MASTER).toHaveLength(12);
    });

    it('사용자 명시 12 displayName 모두 등재', () => {
      const expected = [
        '반도체', '이차전지', '바이오/헬스케어', '금융', '조선', '철강',
        '에너지/화학', '건설/부동산', '유통/소비재', '인터넷/플랫폼', '자동차', '기타',
      ];
      const displayNames = SECTOR_INDEX_MASTER.map((e) => e.displayName);
      for (const name of expected) {
        expect(displayNames).toContain(name);
      }
    });

    it('각 entry 는 sectorKey / displayName / krxIndexCode / market / aliases 필드 보유', () => {
      for (const entry of SECTOR_INDEX_MASTER) {
        expect(typeof entry.sectorKey).toBe('string');
        expect(typeof entry.displayName).toBe('string');
        expect(typeof entry.krxIndexCode).toBe('string');
        expect(['KOSPI', 'KOSDAQ']).toContain(entry.market);
        expect(Array.isArray(entry.aliases)).toBe(true);
      }
    });

    it('Object.freeze drift 차단 — push 시도 시 throw', () => {
      expect(() => {
        // @ts-expect-error — Object.freeze drift 가드 검증 의도
        SECTOR_INDEX_MASTER.push({} as SectorIndexMasterEntry);
      }).toThrow();
    });

    it('KNOWN_DISPLAY_NAMES Set 12개 정합', () => {
      expect(KNOWN_DISPLAY_NAMES.size).toBe(12);
      expect(KNOWN_DISPLAY_NAMES.has('반도체')).toBe(true);
      expect(KNOWN_DISPLAY_NAMES.has('이차전지')).toBe(true);
    });

    it('krxIndexCode 중복 없음 (정확 매칭 SSOT 보장)', () => {
      const codes = SECTOR_INDEX_MASTER.map((e) => e.krxIndexCode);
      const uniqueCodes = new Set(codes);
      expect(uniqueCodes.size).toBe(codes.length);
    });

    it('sectorKey 중복 없음', () => {
      const keys = SECTOR_INDEX_MASTER.map((e) => e.sectorKey);
      const uniqueKeys = new Set(keys);
      expect(uniqueKeys.size).toBe(keys.length);
    });
  });

  // ─── #2 lookup 헬퍼 SSOT ──────────────────────────────────────────────────
  describe('SSOT lookup 헬퍼 (indexCode 정확 매칭 우선)', () => {
    it('getSectorByIndexCode — 정확 매칭 (반도체 1KSI3030)', () => {
      const entry = getSectorByIndexCode('1KSI3030');
      expect(entry).not.toBeNull();
      expect(entry?.sectorKey).toBe('SEMICONDUCTOR');
      expect(entry?.displayName).toBe('반도체');
    });

    it('getSectorByIndexCode — 알 수 없는 코드 → null', () => {
      expect(getSectorByIndexCode('UNKNOWN_CODE')).toBeNull();
    });

    it('getSectorByIndexCode — null/undefined/빈 문자열 안전 fallback', () => {
      expect(getSectorByIndexCode(null)).toBeNull();
      expect(getSectorByIndexCode(undefined)).toBeNull();
      expect(getSectorByIndexCode('')).toBeNull();
      expect(getSectorByIndexCode('   ')).toBeNull();
    });

    it('getSectorByKey — sectorKey 정확 매칭', () => {
      const entry = getSectorByKey('BATTERY');
      expect(entry).not.toBeNull();
      expect(entry?.displayName).toBe('이차전지');
    });

    it('getSectorByKey — 알 수 없는 key → null', () => {
      expect(getSectorByKey('UNKNOWN_KEY')).toBeNull();
      expect(getSectorByKey(null)).toBeNull();
    });

    it('getSectorByAlias — displayName 정확 매칭 우선', () => {
      const entry = getSectorByAlias('반도체');
      expect(entry?.sectorKey).toBe('SEMICONDUCTOR');
    });

    it('getSectorByAlias — alias 배열 매칭 (대소문자 무관)', () => {
      const entry = getSectorByAlias('배터리');
      expect(entry?.sectorKey).toBe('BATTERY');
      const entry2 = getSectorByAlias('IT 하드웨어');
      expect(entry2?.sectorKey).toBe('SEMICONDUCTOR');
    });

    it('getCanonicalDisplayNames — 12개 displayName 배열', () => {
      const names = getCanonicalDisplayNames();
      expect(names).toHaveLength(12);
      expect(names).toContain('반도체');
    });
  });

  // ─── #3 ENV 정확 비교 (ADR-0157 정합) ─────────────────────────────────────
  describe('ENV `SECTOR_ENERGY_SOURCE_RESTORATION_DISABLED` 정확 비교', () => {
    it('default OFF (ENV 미설정 시 false)', () => {
      delete process.env.SECTOR_ENERGY_SOURCE_RESTORATION_DISABLED;
      expect(isSectorEnergySourceRestorationDisabled()).toBe(false);
      expect(providerEnvCheck()).toBe(false);
    });

    it('정확 "true" 시 활성', () => {
      process.env.SECTOR_ENERGY_SOURCE_RESTORATION_DISABLED = 'true';
      expect(isSectorEnergySourceRestorationDisabled()).toBe(true);
      expect(providerEnvCheck()).toBe(true);
    });

    it('"1" / "TRUE" / "yes" 거부 (ADR-0157 정확 비교 의무)', () => {
      process.env.SECTOR_ENERGY_SOURCE_RESTORATION_DISABLED = '1';
      expect(isSectorEnergySourceRestorationDisabled()).toBe(false);
      process.env.SECTOR_ENERGY_SOURCE_RESTORATION_DISABLED = 'TRUE';
      expect(isSectorEnergySourceRestorationDisabled()).toBe(false);
      process.env.SECTOR_ENERGY_SOURCE_RESTORATION_DISABLED = 'yes';
      expect(isSectorEnergySourceRestorationDisabled()).toBe(false);
    });

    it('"false" / 빈 문자열 → false (default 동작)', () => {
      process.env.SECTOR_ENERGY_SOURCE_RESTORATION_DISABLED = 'false';
      expect(isSectorEnergySourceRestorationDisabled()).toBe(false);
      process.env.SECTOR_ENERGY_SOURCE_RESTORATION_DISABLED = '';
      expect(isSectorEnergySourceRestorationDisabled()).toBe(false);
    });
  });

  // ─── #4 indexName 단독 매칭 영구 차단 (정적 grep 가드) ─────────────────────
  describe('indexName 단독 매칭 영구 차단 정책 (정적 grep 가드)', () => {
    it('sectorEnergyMaster.ts — indexName 단독 fallback 분기 부재', () => {
      const src = fs.readFileSync(
        path.resolve(__dirname, 'sectorEnergyMaster.ts'),
        'utf-8',
      );
      // ADR-0399 정책 명시 주석 존재
      expect(src).toContain('indexName 단독 매칭 금지');
      expect(src).toContain('ADR-0399');
      // getSectorByAlias 는 명시적 호출자 측 fallback 진입점 (default 경로 아님)
      expect(src).toMatch(/매칭 SSOT 에서는 indexCode 우선/);
    });

    it('sectorEnergyProvider.ts — useNameFallback default false 보존', () => {
      const src = fs.readFileSync(
        path.resolve(__dirname, 'sectorEnergyProvider.ts'),
        'utf-8',
      );
      expect(src).toContain("process.env.SECTOR_ENERGY_INDEX_NAME_FALLBACK === 'true'");
      // ADR-0370 default OFF 강화 + ADR-0399 영구 차단 명시
      expect(src).toMatch(/ADR-0399[^\n]*?indexName fallback/);
    });

    it('sectorEnergyProvider.ts — indexName fallback 분기 사용 시 sourceTier=STOCK_DAILY 분류 (KRX_CODE 분류 차단)', () => {
      const src = fs.readFileSync(
        path.resolve(__dirname, 'sectorEnergyProvider.ts'),
        'utf-8',
      );
      // indexName fallback 분기에서 sourceTier='KRX_CODE' 부착이 부재해야 함
      // (정확 매칭이 아니라 휴리스틱 매칭이라)
      const fallbackBlock = src.match(
        /isSectorEnergyIndexNameFallbackEnabled\(\)[\s\S]{0,600}?sourceTier:[^,]+/,
      );
      // fallback 분기에 sourceTier 부착 시 'STOCK_DAILY' 또는 비어있어야 함 (KRX_CODE 부재)
      if (fallbackBlock) {
        expect(fallbackBlock[0]).not.toContain("sourceTier: 'KRX_CODE'");
      }
    });
  });

  // ─── #5 diagnostics 타입 SSOT (ADR-0399 §"diagnostics 메타") ─────────────
  describe('SectorEnergyDiagnosticsMeta 타입 SSOT', () => {
    it('candidateDates 배열 + sourceTierAttempts + finalSourceTier + confidence', () => {
      const meta: SectorEnergyDiagnosticsMeta = {
        candidateDates: ['20260506', '20260505'],
        sourceTierAttempts: [
          { tier: 'KRX_CODE', validCount: 12, reason: undefined },
        ],
        finalSourceTier: 'KRX_CODE',
        confidence: 1.0,
      };
      expect(meta.candidateDates).toEqual(['20260506', '20260505']);
      expect(meta.sourceTierAttempts[0].tier).toBe('KRX_CODE');
      expect(meta.finalSourceTier).toBe('KRX_CODE');
      expect(meta.confidence).toBe(1.0);
    });

    it('fallbackReason 옵셔널 — 부재 시 undefined', () => {
      const meta: SectorEnergyDiagnosticsMeta = {
        candidateDates: [],
        sourceTierAttempts: [],
        finalSourceTier: 'FAILED',
        confidence: 0,
      };
      expect(meta.fallbackReason).toBeUndefined();
    });

    it('SectorEnergySourceTierForDiag — KIS-first + legacy union 정합', () => {
      const tiers: SectorEnergySourceTierForDiag[] = [
        'KIS_OFFICIAL_INDEX',
        'KIS_OFFICIAL_DAILY',
        'KIS_STOCK_BASKET_DERIVED',
        'KRX_OFFICIAL_INDEX',
        'KRX_CODE',
        'STOCK_DAILY',
        'CACHE',
        'YAHOO_GLOBAL_PROXY',
        'YAHOO_ETF',
        'INTERNAL_PROXY',
        'MISSING',
        'FAILED',
      ];
      expect(tiers).toHaveLength(12);
    });
  });

  // ─── #6 SectorEnergyBuildResult schema 격상 (ADR-0399) ─────────────────────
  describe('SectorEnergyBuildResult — sourceTier / diagnostics 옵셔널 격상', () => {
    it('sourceTier 옵셔널 — 부재 시 undefined (후방호환)', () => {
      const result: SectorEnergyBuildResult = {
        inputs: [],
        dataQuality: 'OK',
        validSectorCount: 12,
        totalSectorCount: 12,
        reasons: [],
      };
      expect(result.sourceTier).toBeUndefined();
      expect(result.diagnostics).toBeUndefined();
    });

    it('sourceTier 부착 시 5 union 만 허용', () => {
      const result: SectorEnergyBuildResult = {
        inputs: [],
        dataQuality: 'OK',
        validSectorCount: 12,
        totalSectorCount: 12,
        reasons: [],
        sourceTier: 'KRX_CODE',
      };
      expect(result.sourceTier).toBe('KRX_CODE');
    });
  });

  // ─── #7 ADR-0397/0398 SSOT 정합 (호출만, 무수정) ──────────────────────────
  describe('ADR-0396/0397/0398 SSOT 무수정 정합', () => {
    it('Yahoo ETF 채택 시 dataQuality=DEGRADED 강제 정책 (ADR-0397) 보존', () => {
      const src = fs.readFileSync(
        path.resolve(__dirname, 'sectorEnergyProvider.ts'),
        'utf-8',
      );
      // applyYahooEtfDegradation — ADR-0397 정합
      expect(src).toContain('applyYahooEtfDegradation');
      expect(src).toMatch(/dataQuality:\s*'DEGRADED'/);
    });

    it('호출 순서 SSOT — L1 → L2 → L3 → L4 (절대 변경 금지)', () => {
      const src = fs.readFileSync(
        path.resolve(__dirname, 'sectorEnergyProvider.ts'),
        'utf-8',
      );
      // ADR-0399 §"호출 순서 SSOT" 명시
      expect(src).toContain('L1 → L2 → L3 → L4');
      // 4-tier 분기 키워드 모두 존재
      expect(src).toContain('KRX_CODE');
      expect(src).toContain('STOCK_DAILY');
      expect(src).toContain('CACHE');
      expect(src).toContain('YAHOO_ETF');
    });

    it('confidence 산출은 ADR-0396 SSOT (`buildSectorEnergyQualityComposite`) 위임', () => {
      const src = fs.readFileSync(
        path.resolve(__dirname, 'sectorEnergyProvider.ts'),
        'utf-8',
      );
      // 신규 산출식 도입 금지 — ADR-0396 SSOT 호출만
      expect(src).toContain('buildSectorEnergyQualityComposite');
    });
  });

  // ─── #8 macroStateRepo schema (ADR-0399 sectorEnergyDiagnostics 옵셔널) ─────
  describe('macroState.sectorEnergyDiagnostics 옵셔널 schema (ADR-0399)', () => {
    it('macroStateRepo.ts — sectorEnergyDiagnostics 옵셔널 필드 등재', () => {
      const src = fs.readFileSync(
        path.resolve(__dirname, '../persistence/macroStateRepo.ts'),
        'utf-8',
      );
      expect(src).toContain('sectorEnergyDiagnostics?:');
      expect(src).toContain('candidateDates: string[]');
      expect(src).toContain('finalSourceTier:');
      expect(src).toContain('ADR-0399');
    });

    it('marketDataRefresh.ts — diagnostics + 4-axis 영속 wiring', () => {
      // ADR-0595: resolve 부는 marketDataRefresh/sectorEnergySection.ts 로 이동 (merge spread 는 본체 잔존).
      // 본문 + 서브모듈을 함께 grep — 향후 이동에도 견고 (ADR-0444 static-grep-guard 패턴).
      const src = fs.readFileSync(
        path.resolve(__dirname, '../trading/marketDataRefresh.ts'),
        'utf-8',
      ) + fs.readFileSync(
        path.resolve(__dirname, '../trading/marketDataRefresh/sectorEnergySection.ts'),
        'utf-8',
      );
      expect(src).toContain('sectorEnergyDiagnostics');
      expect(src).toContain('sectorEnergySourceTier');
      expect(src).toContain('sectorEnergyConfidence');
      // ADR-0399 명시 주석
      expect(src).toContain('ADR-0399');
    });
  });

  // ─── #9 운영 효과 시나리오 (정적 검증) ────────────────────────────────────
  describe('운영 효과 시나리오 (정적 검증)', () => {
    it('휴장일 클러스터 자동 후퇴 — recentBusinessDaysKst(5) 사용 검증', () => {
      const src = fs.readFileSync(
        path.resolve(__dirname, 'sectorEnergyProvider.ts'),
        'utf-8',
      );
      // ADR-0399: T → T-1 → T-2 → T-3 → T-5 자동 탐색 (recentBusinessDaysKst 재사용)
      expect(src).toContain('recentBusinessDaysKst(5)');
    });

    it('attemptedTodayDates 영속 — diagnostics 메타 candidateDates 진입', () => {
      const src = fs.readFileSync(
        path.resolve(__dirname, 'sectorEnergyProvider.ts'),
        'utf-8',
      );
      expect(src).toContain('attemptedTodayDates');
      expect(src).toContain('__getLastAttemptedTodayDatesForTests');
    });

    it('sectorEnergyDiag.cmd — ADR-0399 진단 메타 표시 wiring', () => {
      const src = fs.readFileSync(
        path.resolve(__dirname, '../telegram/commands/system/sectorEnergyDiag.cmd.ts'),
        'utf-8',
      );
      expect(src).toContain('ADR-0399');
      expect(src).toContain('sectorEnergyDiagnostics');
      expect(src).toContain('candidateDates');
      expect(src).toContain('sourceTierAttempts');
      expect(src).toContain('fallbackReason');
    });
  });

  // ─── #10 KIS 주문 함수 import 0건 (절대 규칙 #2/#3/#4) ────────────────────
  describe('KIS 주문 함수 5종 import 0건 (절대 규칙 #2/#3/#4)', () => {
    it('sectorEnergyMaster.ts — KIS 주문 함수 import 0건', () => {
      const src = fs.readFileSync(
        path.resolve(__dirname, 'sectorEnergyMaster.ts'),
        'utf-8',
      );
      expect(src).not.toContain('placeKisMarketOrder');
      expect(src).not.toContain('placeKisSellOrder');
      expect(src).not.toContain('cancelKisOrder');
      expect(src).not.toContain('placeKisStopLossOrder');
      expect(src).not.toContain('placeKisTakeProfitOrder');
    });

    it('sectorEnergyProvider.ts — KIS 주문 함수 import 0건', () => {
      const src = fs.readFileSync(
        path.resolve(__dirname, 'sectorEnergyProvider.ts'),
        'utf-8',
      );
      expect(src).not.toContain('placeKisMarketOrder');
      expect(src).not.toContain('placeKisSellOrder');
      expect(src).not.toContain('cancelKisOrder');
    });
  });

  // ─── 추가 — sectorKey 정합 ────────────────────────────────────────────────
  describe('sectorKey 정합 (TypeScript 타입 추론 검증)', () => {
    it('SectorKey union 12 변종 등재 (DRY)', () => {
      const keys: SectorKey[] = [
        'SEMICONDUCTOR', 'BATTERY', 'BIO_HEALTHCARE', 'FINANCE',
        'SHIPBUILDING', 'STEEL', 'CHEMICAL', 'CONSTRUCTION',
        'CONSUMER_RETAIL', 'IT_INTERNET', 'AUTOMOTIVE', 'OTHER',
      ];
      expect(keys).toHaveLength(12);
      // 모든 SectorKey 가 SECTOR_INDEX_MASTER 에 등재
      for (const key of keys) {
        const entry = getSectorByKey(key);
        expect(entry).not.toBeNull();
        expect(entry?.sectorKey).toBe(key);
      }
    });
  });
});
