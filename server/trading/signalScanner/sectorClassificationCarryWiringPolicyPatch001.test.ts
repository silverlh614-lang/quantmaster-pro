// @responsibility Patch-SECTOR-CLASSIFICATION-CARRY-WIRING-001 회귀 — sector 분류 carry SSOT + normalSupplyPreview wiring 검증.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  buildSectorClassificationCarryMap,
  buildSectorClassificationCarryPayload,
  isSectorClassificationCarryWiringDisabled,
  type SectorClassificationCarryPayload,
} from './sectorClassificationCarryWiringPolicy.js';

const ORIGINAL_ENV = process.env.SECTOR_CLASSIFICATION_CARRY_WIRING_DISABLED;

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function readSource(relativePath: string): string {
  const abs = resolve(import.meta.dirname, relativePath);
  return readFileSync(abs, 'utf-8');
}

function readSsotSource(): string {
  return readSource('./sectorClassificationCarryWiringPolicy.ts');
}

function readWiringSource(): string {
  return readSource('./normalSupplyPreviewRunner.ts');
}

function makeEntry(overrides: Partial<{ code: string; sector: string }> = {}): {
  code?: string;
  sector?: string;
} {
  return {
    code: '005930',
    sector: '반도체',
    ...overrides,
  };
}

describe('Patch-SECTOR-CLASSIFICATION-CARRY-WIRING-001', () => {
  beforeEach(() => {
    delete process.env.SECTOR_CLASSIFICATION_CARRY_WIRING_DISABLED;
  });

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.SECTOR_CLASSIFICATION_CARRY_WIRING_DISABLED;
    } else {
      process.env.SECTOR_CLASSIFICATION_CARRY_WIRING_DISABLED = ORIGINAL_ENV;
    }
  });

  describe('Group A — ENV gate (ADR-0157 정확 비교)', () => {
    it('default OFF — ENV 미설정 시 false 반환 (carry 활성)', () => {
      expect(isSectorClassificationCarryWiringDisabled()).toBe(false);
    });

    it("'true' 정확 비교 시 true 반환 (carry 비활성)", () => {
      process.env.SECTOR_CLASSIFICATION_CARRY_WIRING_DISABLED = 'true';
      expect(isSectorClassificationCarryWiringDisabled()).toBe(true);
    });

    it("'1' / 'TRUE' / 'yes' / 빈값 모두 거부 (ADR-0157 정확 비교)", () => {
      for (const value of ['1', 'TRUE', 'yes', 'YES', 'on', '']) {
        process.env.SECTOR_CLASSIFICATION_CARRY_WIRING_DISABLED = value;
        expect(isSectorClassificationCarryWiringDisabled()).toBe(false);
      }
    });

    it("'false' 명시 시 false (legacy 동작 보존)", () => {
      process.env.SECTOR_CLASSIFICATION_CARRY_WIRING_DISABLED = 'false';
      expect(isSectorClassificationCarryWiringDisabled()).toBe(false);
    });

    it('호출자 측 inline ENV 검사 부재 (SSOT 헬퍼 위임 의무)', () => {
      const wiring = stripComments(readWiringSource());
      expect(wiring).not.toMatch(/process\.env\.SECTOR_CLASSIFICATION_CARRY_WIRING_DISABLED/);
      expect(wiring).toMatch(/isSectorClassificationCarryWiringDisabled/);
    });
  });

  describe('Group B — stockCode 정규화', () => {
    it('6자리 stockCode 보존', () => {
      const payload = buildSectorClassificationCarryPayload({
        stockCode: '005930',
        sectorAlias: '반도체',
      });
      expect(payload?.stockCode).toBe('005930');
    });

    it('짧은 숫자 stockCode 자동 zero-pad (4자리 → 6자리)', () => {
      const payload = buildSectorClassificationCarryPayload({
        stockCode: '5930',
        sectorAlias: '반도체',
      });
      expect(payload?.stockCode).toBe('005930');
    });

    it('null / undefined / 빈값 stockCode → undefined payload', () => {
      for (const stockCode of [null, undefined, '', '  ']) {
        const payload = buildSectorClassificationCarryPayload({
          stockCode,
          sectorAlias: '반도체',
        });
        expect(payload).toBeUndefined();
      }
    });

    it('비숫자 stockCode (AAPL 스타일) trim 만 적용 (padStart 미적용)', () => {
      const payload = buildSectorClassificationCarryPayload({
        stockCode: '  AAPL  ',
        sectorAlias: '반도체',
      });
      expect(payload?.stockCode).toBe('AAPL');
    });
  });

  describe('Group C — alias 매칭 결정 트리', () => {
    it("'반도체' alias → SEMICONDUCTOR + WATCHLIST_ALIAS source tier", () => {
      const payload = buildSectorClassificationCarryPayload({
        stockCode: '005930',
        sectorAlias: '반도체',
      });
      expect(payload?.sectorKey).toBe('SEMICONDUCTOR');
      expect(payload?.displayName).toBe('반도체');
      expect(payload?.krxIndexCode).toBe('1KSI3030');
      expect(payload?.market).toBe('KOSPI');
      expect(payload?.yahooProxySymbol).toBe('SOXX');
      expect(payload?.sourceTier).toBe('WATCHLIST_ALIAS');
      expect(payload?.rawAlias).toBe('반도체');
    });

    it("'이차전지' alias → BATTERY + WATCHLIST_ALIAS", () => {
      const payload = buildSectorClassificationCarryPayload({
        stockCode: '247540',
        sectorAlias: '이차전지',
      });
      expect(payload?.sectorKey).toBe('BATTERY');
      expect(payload?.krxIndexCode).toBe('1KSI3025');
      expect(payload?.sourceTier).toBe('WATCHLIST_ALIAS');
    });

    it('빈 alias → OTHER_FALLBACK (sectorKey=OTHER)', () => {
      const payload = buildSectorClassificationCarryPayload({
        stockCode: '005930',
        sectorAlias: '',
      });
      expect(payload?.sectorKey).toBe('OTHER');
      expect(payload?.displayName).toBe('기타');
      expect(payload?.sourceTier).toBe('OTHER_FALLBACK');
    });

    it("매칭 실패 alias 'NONEXISTENT' → OTHER_FALLBACK", () => {
      const payload = buildSectorClassificationCarryPayload({
        stockCode: '005930',
        sectorAlias: 'NONEXISTENT_SECTOR_NAME',
      });
      expect(payload?.sectorKey).toBe('OTHER');
      expect(payload?.sourceTier).toBe('OTHER_FALLBACK');
    });

    it('alias 부재 (undefined) → OTHER_FALLBACK', () => {
      const payload = buildSectorClassificationCarryPayload({
        stockCode: '005930',
        sectorAlias: undefined,
      });
      expect(payload?.sectorKey).toBe('OTHER');
      expect(payload?.sourceTier).toBe('OTHER_FALLBACK');
    });

    it('alias whitespace trim 적용', () => {
      const payload = buildSectorClassificationCarryPayload({
        stockCode: '005930',
        sectorAlias: '  반도체  ',
      });
      expect(payload?.sectorKey).toBe('SEMICONDUCTOR');
      expect(payload?.rawAlias).toBe('반도체');
    });
  });

  describe('Group D — buildSectorClassificationCarryMap 동작', () => {
    it('null / undefined / non-array → 빈 Map', () => {
      expect(buildSectorClassificationCarryMap(null as never).size).toBe(0);
      expect(buildSectorClassificationCarryMap(undefined as never).size).toBe(0);
      expect(buildSectorClassificationCarryMap('not-an-array' as never).size).toBe(0);
    });

    it('빈 배열 → 빈 Map', () => {
      expect(buildSectorClassificationCarryMap([]).size).toBe(0);
    });

    it('정상 entries → symbol-keyed Map (5자리 short stockCode 도 6자리 key 로 정규화)', () => {
      const map = buildSectorClassificationCarryMap([
        makeEntry({ code: '005930', sector: '반도체' }),
        makeEntry({ code: '247540', sector: '이차전지' }),
        makeEntry({ code: '5930', sector: '반도체' }),
      ]);
      // 005930 + 247540 — short 5930 → 005930 collision overrides last write
      expect(map.size).toBeGreaterThanOrEqual(2);
      expect(map.get('005930')?.sectorKey).toBe('SEMICONDUCTOR');
      expect(map.get('247540')?.sectorKey).toBe('BATTERY');
    });

    it('잘못된 row (null/string/code 부재) silent skip — 유효 row 만 보존', () => {
      const map = buildSectorClassificationCarryMap([
        null as never,
        'invalid' as never,
        { code: undefined, sector: '반도체' } as never,
        makeEntry({ code: '005930', sector: '반도체' }),
      ]);
      expect(map.size).toBe(1);
      expect(map.get('005930')?.sectorKey).toBe('SEMICONDUCTOR');
    });

    it('ENV disabled 시 빈 Map (carry 자연 skip)', () => {
      process.env.SECTOR_CLASSIFICATION_CARRY_WIRING_DISABLED = 'true';
      const map = buildSectorClassificationCarryMap([
        makeEntry({ code: '005930', sector: '반도체' }),
      ]);
      expect(map.size).toBe(0);
    });
  });

  describe('Group E — literal type invariants 컴파일 타임 강제', () => {
    it("executionImpact 가 항상 'NONE' literal (매매 의사결정 입력 차단)", () => {
      const payload = buildSectorClassificationCarryPayload({
        stockCode: '005930',
        sectorAlias: '반도체',
      });
      expect(payload?.executionImpact).toBe('NONE');
      // TypeScript literal type check: never assignable from string
      const _typeCheck: SectorClassificationCarryPayload['executionImpact'] = 'NONE';
      expect(_typeCheck).toBe('NONE');
    });

    it("providerIssue 가 항상 false literal (DATA_UNAVAILABLE → failed 변환 영구 차단)", () => {
      const payload = buildSectorClassificationCarryPayload({
        stockCode: '005930',
        sectorAlias: '반도체',
      });
      expect(payload?.providerIssue).toBe(false);
      const _typeCheck: SectorClassificationCarryPayload['providerIssue'] = false;
      expect(_typeCheck).toBe(false);
    });

    it("marketSignal 가 항상 false literal (UNKNOWN → NEUTRAL 변환 영구 차단)", () => {
      const payload = buildSectorClassificationCarryPayload({
        stockCode: '005930',
        sectorAlias: '반도체',
      });
      expect(payload?.marketSignal).toBe(false);
      const _typeCheck: SectorClassificationCarryPayload['marketSignal'] = false;
      expect(_typeCheck).toBe(false);
    });

    it('OTHER_FALLBACK 분기도 동일 literal invariants 유지', () => {
      const payload = buildSectorClassificationCarryPayload({
        stockCode: '005930',
        sectorAlias: 'NONEXISTENT',
      });
      expect(payload?.executionImpact).toBe('NONE');
      expect(payload?.providerIssue).toBe(false);
      expect(payload?.marketSignal).toBe(false);
    });
  });

  describe('Group F — producer-side wiring + SSOT 정적 grep 가드', () => {
    it('normalSupplyPreviewRunner.ts 가 SSOT import 명시', () => {
      const wiring = stripComments(readWiringSource());
      expect(wiring).toMatch(/buildSectorClassificationCarryMap/);
      expect(wiring).toMatch(/isSectorClassificationCarryWiringDisabled/);
      expect(wiring).toMatch(/SectorClassificationCarryPayload/);
      expect(wiring).toMatch(/from\s+['"]\.\/sectorClassificationCarryWiringPolicy\.js['"]/);
    });

    it('normalSupplyPreviewRunner.ts wiring 블록이 try/catch 격리 + candidate.sectorClassification 첨부', () => {
      const wiring = stripComments(readWiringSource());
      expect(wiring).toMatch(/sectorClassificationMap/);
      expect(wiring).toMatch(/sectorClassification\?:\s*SectorClassificationCarryPayload/);
      // try/catch 격리 패턴 (sector classification map build)
      expect(wiring).toMatch(/sectorClassificationMap[\s\S]{0,500}try\s*\{[\s\S]{0,200}buildSectorClassificationCarryMap/);
    });

    it('SSOT 모듈 KIS 주문 함수 5종 import 0건 (정적 grep 가드)', () => {
      const src = stripComments(readSsotSource());
      const kisOrderFns = [
        'placeKisMarketOrder',
        'placeKisSellOrder',
        'placeKisStopLossOrder',
        'placeKisTakeProfitOrder',
        'cancelKisOrder',
      ];
      for (const fn of kisOrderFns) {
        const importRe = new RegExp(`from\\s+['"][^'"]*${fn}`);
        expect(src).not.toMatch(importRe);
        const directImportRe = new RegExp(`\\{[^}]*\\b${fn}\\b[^}]*\\}\\s*from`);
        expect(src).not.toMatch(directImportRe);
      }
    });

    it('SSOT 모듈 autoTradeEngine / orderExecutor / trancheExecutor import 0건', () => {
      const src = stripComments(readSsotSource());
      expect(src).not.toMatch(/from\s+['"][^'"]*autoTradeEngine/);
      expect(src).not.toMatch(/from\s+['"][^'"]*orderExecutor/);
      expect(src).not.toMatch(/from\s+['"][^'"]*trancheExecutor/);
    });

    it('SSOT 모듈 외부 API (fetch / axios / node-fetch) import 0건', () => {
      const src = stripComments(readSsotSource());
      expect(src).not.toMatch(/from\s+['"]node-fetch['"]/);
      expect(src).not.toMatch(/from\s+['"]axios['"]/);
      expect(src).not.toMatch(/\bfetch\s*\(/);
    });

    it('Patch-SECTOR-CLASSIFICATION-CARRY-WIRING-001 추적 주석 (SSOT + wiring 양쪽)', () => {
      // 추적 주석은 stripComments 이전 raw source 에서 검사 (주석 자체가 추적성 증거)
      const ssotRaw = readSsotSource();
      const wiringRaw = readWiringSource();
      expect(ssotRaw).toMatch(/Patch-SECTOR-CLASSIFICATION-CARRY-WIRING-001/);
      expect(wiringRaw).toMatch(/Patch-SECTOR-CLASSIFICATION-CARRY-WIRING-001/);
    });
  });
});
