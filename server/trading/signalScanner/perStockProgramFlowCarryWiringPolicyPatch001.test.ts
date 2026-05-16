/**
 * @responsibility Regression suite for Patch-PER-STOCK-PROGRAM-FLOW-CARRY-WIRING-001 SSOT.
 *
 * Validates ENV gate, 9-field sanitization, ISO timestamp validation, symbol
 * normalization, builder semantics, literal type invariants, and producer-side
 * wiring static-grep guards. Mirrors Patch-MARKET-PROGRAM-CARRY-WIRING-001 (PR #1029)
 * regression discipline (≥20 cases, ENV exact comparison ADR-0157, literal type
 * compile-time enforcement, LIVE body 0-line static guard).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildPerStockProgramFlowCarryMap,
  buildPerStockProgramFlowCarryPayload,
  isPerStockProgramFlowCarryWiringDisabled,
  type PerStockProgramFlowCarryPayload,
} from './perStockProgramFlowCarryWiringPolicy.js';
import type { IntradayProgramFlowStockRow } from '../../replay/intradayProgramFlowSnapshotRepo.js';

function makeRow(overrides: Partial<IntradayProgramFlowStockRow> = {}): IntradayProgramFlowStockRow {
  return {
    symbol: '005930',
    normalizedSymbol: '005930',
    name: '삼성전자',
    programNetBuyAmount: 12500,
    programBuyAmount: 30000,
    programSellAmount: 17500,
    programNetVolume: 1000,
    programNetValue: 75000000,
    sourceProvider: 'KIS_API',
    dataStatus: 'VERIFIED',
    providerIssue: false,
    marketSignal: false,
    capturedAt: '2026-05-16T05:30:00Z',
    reason: undefined,
    ...overrides,
  };
}

const ORIGINAL_ENV = process.env.PER_STOCK_PROGRAM_FLOW_CARRY_WIRING_DISABLED;

describe('Patch-PER-STOCK-PROGRAM-FLOW-CARRY-WIRING-001 — SSOT regression', () => {
  beforeEach(() => {
    delete process.env.PER_STOCK_PROGRAM_FLOW_CARRY_WIRING_DISABLED;
  });

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.PER_STOCK_PROGRAM_FLOW_CARRY_WIRING_DISABLED;
    } else {
      process.env.PER_STOCK_PROGRAM_FLOW_CARRY_WIRING_DISABLED = ORIGINAL_ENV;
    }
  });

  // ───────────────── Group A — ENV gate (ADR-0157 정확 비교) ─────────────────

  describe('Group A — ENV gate', () => {
    it('default (미설정) → false (정책 적용)', () => {
      delete process.env.PER_STOCK_PROGRAM_FLOW_CARRY_WIRING_DISABLED;
      expect(isPerStockProgramFlowCarryWiringDisabled()).toBe(false);
    });

    it("'true' (정확 비교) → true (legacy 동작 복원)", () => {
      process.env.PER_STOCK_PROGRAM_FLOW_CARRY_WIRING_DISABLED = 'true';
      expect(isPerStockProgramFlowCarryWiringDisabled()).toBe(true);
    });

    it("'1' / 'TRUE' / 'yes' / 빈값 모두 거부 (ADR-0157)", () => {
      for (const value of ['1', 'TRUE', 'yes', '', 'YES', 'on', 'enabled']) {
        process.env.PER_STOCK_PROGRAM_FLOW_CARRY_WIRING_DISABLED = value;
        expect(isPerStockProgramFlowCarryWiringDisabled()).toBe(false);
      }
    });

    it("'false' 명시 → false", () => {
      process.env.PER_STOCK_PROGRAM_FLOW_CARRY_WIRING_DISABLED = 'false';
      expect(isPerStockProgramFlowCarryWiringDisabled()).toBe(false);
    });

    it('호출자 측 inline ENV 검사 0건 (SSOT 헬퍼 위임 의무)', () => {
      // normalSupplyPreviewRunner.ts 가 isPerStockProgramFlowCarryWiringDisabled() SSOT 호출만 사용해야 함
      const runnerPath = resolve(
        import.meta.dirname,
        'normalSupplyPreviewRunner.ts',
      );
      const src = readFileSync(runnerPath, 'utf8');
      const codeOnly = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      // process.env.PER_STOCK_... 직접 검사 패턴 부재
      expect(codeOnly).not.toMatch(/process\.env\.PER_STOCK_PROGRAM_FLOW_CARRY_WIRING_DISABLED/);
      // SSOT 헬퍼 호출 의무
      expect(codeOnly).toMatch(/isPerStockProgramFlowCarryWiringDisabled\s*\(/);
    });
  });

  // ───────────────── Group B — 9-필드 sanitization ─────────────────

  describe('Group B — 9-field sanitization', () => {
    it('NaN → undefined', () => {
      const row = makeRow({ programNetBuyAmount: NaN, programBuyAmount: NaN });
      const payload = buildPerStockProgramFlowCarryPayload(row);
      expect(payload?.programNetBuyAmount).toBeUndefined();
      expect(payload?.programBuyAmount).toBeUndefined();
    });

    it('Infinity → undefined', () => {
      const row = makeRow({ programNetVolume: Infinity, programNetValue: -Infinity });
      const payload = buildPerStockProgramFlowCarryPayload(row);
      expect(payload?.programNetVolume).toBeUndefined();
      expect(payload?.programNetValue).toBeUndefined();
    });

    it('null number → undefined', () => {
      const row = makeRow({ programSellAmount: null, programNetValue: null });
      const payload = buildPerStockProgramFlowCarryPayload(row);
      expect(payload?.programSellAmount).toBeUndefined();
      expect(payload?.programNetValue).toBeUndefined();
    });

    it('0 → 유효 (정상 데이터)', () => {
      const row = makeRow({
        programNetBuyAmount: 0,
        programBuyAmount: 0,
        programSellAmount: 0,
        programNetVolume: 0,
        programNetValue: 0,
      });
      const payload = buildPerStockProgramFlowCarryPayload(row);
      expect(payload?.programNetBuyAmount).toBe(0);
      expect(payload?.programBuyAmount).toBe(0);
      expect(payload?.programSellAmount).toBe(0);
      expect(payload?.programNetVolume).toBe(0);
      expect(payload?.programNetValue).toBe(0);
    });

    it('알 수 없는 source → "NONE" fallback', () => {
      const row = makeRow({ sourceProvider: 'INVALID' as never });
      const payload = buildPerStockProgramFlowCarryPayload(row);
      expect(payload?.sourceProvider).toBe('NONE');
    });

    it('알 수 없는 status → "UNKNOWN" fallback', () => {
      const row = makeRow({ dataStatus: 'INVALID_STATUS' as never });
      const payload = buildPerStockProgramFlowCarryPayload(row);
      expect(payload?.dataStatus).toBe('UNKNOWN');
    });

    it('정상 9-필드 row → round-trip 보존', () => {
      const row = makeRow();
      const payload = buildPerStockProgramFlowCarryPayload(row);
      expect(payload).toBeDefined();
      expect(payload?.symbol).toBe('005930');
      expect(payload?.name).toBe('삼성전자');
      expect(payload?.programNetBuyAmount).toBe(12500);
      expect(payload?.programBuyAmount).toBe(30000);
      expect(payload?.programSellAmount).toBe(17500);
      expect(payload?.programNetVolume).toBe(1000);
      expect(payload?.programNetValue).toBe(75000000);
      expect(payload?.sourceProvider).toBe('KIS_API');
      expect(payload?.dataStatus).toBe('VERIFIED');
      expect(payload?.capturedAt).toBe('2026-05-16T05:30:00Z');
    });

    it('빈 문자열 symbol → undefined 반환 (skip)', () => {
      const row = makeRow({ symbol: '   ', normalizedSymbol: '' });
      const payload = buildPerStockProgramFlowCarryPayload(row);
      expect(payload).toBeUndefined();
    });
  });

  // ───────────────── Group C — ISO timestamp validation ─────────────────

  describe('Group C — ISO timestamp validation', () => {
    it('valid ISO with Z → 보존', () => {
      const row = makeRow({ capturedAt: '2026-05-16T05:30:00Z' });
      const payload = buildPerStockProgramFlowCarryPayload(row);
      expect(payload?.capturedAt).toBe('2026-05-16T05:30:00Z');
    });

    it('valid ISO with timezone offset → 보존', () => {
      const row = makeRow({ capturedAt: '2026-05-16T14:30:00+09:00' });
      const payload = buildPerStockProgramFlowCarryPayload(row);
      expect(payload?.capturedAt).toBe('2026-05-16T14:30:00+09:00');
    });

    it('잘못된 형식 → undefined', () => {
      const row = makeRow({ capturedAt: 'not-an-iso-string' });
      const payload = buildPerStockProgramFlowCarryPayload(row);
      expect(payload?.capturedAt).toBeUndefined();
    });
  });

  // ───────────────── Group D — Symbol normalization ─────────────────

  describe('Group D — Symbol normalization', () => {
    it('6자리 숫자 보존', () => {
      const row = makeRow({ symbol: '005930', normalizedSymbol: '005930' });
      const payload = buildPerStockProgramFlowCarryPayload(row);
      expect(payload?.symbol).toBe('005930');
    });

    it('짧은 숫자 6자리 zero-pad', () => {
      const row = makeRow({ symbol: '5930', normalizedSymbol: '5930' });
      const payload = buildPerStockProgramFlowCarryPayload(row);
      expect(payload?.symbol).toBe('005930');
    });

    it('null/undefined symbol → undefined 반환', () => {
      const row = makeRow({ symbol: null as unknown as string, normalizedSymbol: null as unknown as string });
      const payload = buildPerStockProgramFlowCarryPayload(row);
      expect(payload).toBeUndefined();
    });
  });

  // ───────────────── Group E — buildPerStockProgramFlowCarryMap ─────────────────

  describe('Group E — buildPerStockProgramFlowCarryMap', () => {
    it('null/undefined 입력 → 빈 Map', () => {
      expect(buildPerStockProgramFlowCarryMap(null).size).toBe(0);
      expect(buildPerStockProgramFlowCarryMap(undefined).size).toBe(0);
    });

    it('빈 배열 → 빈 Map', () => {
      expect(buildPerStockProgramFlowCarryMap([]).size).toBe(0);
    });

    it('혼재 (정상 + 잘못된 row) → 정상만 Map 에 등재', () => {
      const rows: IntradayProgramFlowStockRow[] = [
        makeRow({ symbol: '005930', normalizedSymbol: '005930' }),
        makeRow({ symbol: '   ', normalizedSymbol: '' }), // skip
        makeRow({ symbol: '247540', normalizedSymbol: '247540', name: '에코프로비엠' }),
      ];
      const map = buildPerStockProgramFlowCarryMap(rows);
      expect(map.size).toBe(2);
      expect(map.get('005930')?.symbol).toBe('005930');
      expect(map.get('247540')?.name).toBe('에코프로비엠');
    });
  });

  // ───────────────── Group F — Literal type invariants ─────────────────

  describe('Group F — Literal type invariants (compile-time + runtime)', () => {
    it("executionImpact === 'NONE' literal", () => {
      const payload = buildPerStockProgramFlowCarryPayload(makeRow());
      expect(payload?.executionImpact).toBe('NONE');
      // TypeScript 컴파일 타임 강제: literal type
      const check: PerStockProgramFlowCarryPayload['executionImpact'] = 'NONE';
      expect(check).toBe('NONE');
    });

    it('providerIssue === false literal', () => {
      const payload = buildPerStockProgramFlowCarryPayload(makeRow());
      expect(payload?.providerIssue).toBe(false);
      const check: PerStockProgramFlowCarryPayload['providerIssue'] = false;
      expect(check).toBe(false);
    });

    it('marketSignal === false literal (program 데이터 bearish 변환 영구 차단)', () => {
      const payload = buildPerStockProgramFlowCarryPayload(makeRow());
      expect(payload?.marketSignal).toBe(false);
      const check: PerStockProgramFlowCarryPayload['marketSignal'] = false;
      expect(check).toBe(false);
    });
  });

  // ───────────────── Group G — Producer-side wiring static-grep guards ─────────────────

  describe('Group G — normalSupplyPreviewRunner.ts wiring 정적 가드', () => {
    let runnerSrc: string;
    let runnerCodeOnly: string;

    beforeEach(() => {
      const runnerPath = resolve(import.meta.dirname, 'normalSupplyPreviewRunner.ts');
      runnerSrc = readFileSync(runnerPath, 'utf8');
      runnerCodeOnly = runnerSrc
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
    });

    it('SSOT import 의무 (buildPerStockProgramFlowCarryMap + isPerStockProgramFlowCarryWiringDisabled + PerStockProgramFlowCarryPayload type)', () => {
      expect(runnerCodeOnly).toMatch(/buildPerStockProgramFlowCarryMap/);
      expect(runnerCodeOnly).toMatch(/isPerStockProgramFlowCarryWiringDisabled/);
      expect(runnerCodeOnly).toMatch(/PerStockProgramFlowCarryPayload/);
    });

    it('loadLatestIntradayProgramFlowSnapshot 호출 (try/catch 격리)', () => {
      expect(runnerCodeOnly).toMatch(/loadLatestIntradayProgramFlowSnapshot\s*\(\s*\)/);
      // try/catch 패턴 존재 — snapshot 로드 throw 가 매수 흐름 차단 안 함
      expect(runnerCodeOnly).toMatch(/try\s*\{[\s\S]*?loadLatestIntradayProgramFlowSnapshot[\s\S]*?\}\s*catch/);
    });

    it('candidate 별 stockProgramFlow 첨부 패턴 (type cast — CandidateWithSupplyContext 본체 무수정)', () => {
      expect(runnerCodeOnly).toMatch(/stockProgramFlow\?\s*:\s*PerStockProgramFlowCarryPayload/);
      expect(runnerCodeOnly).toMatch(/perStockProgramFlowMap\.get\s*\(/);
    });

    it('KIS 주문 함수 5종 import 0건 (정적 grep 가드)', () => {
      const FORBIDDEN_KIS_ORDER_FUNCS = [
        'placeKisMarketOrder',
        'placeKisSellOrder',
        'placeKisStopLossOrder',
        'placeKisTakeProfitOrder',
        'cancelKisOrder',
      ];
      for (const fn of FORBIDDEN_KIS_ORDER_FUNCS) {
        expect(runnerCodeOnly, `${fn} import 0건 의무`).not.toMatch(
          new RegExp(`from\\s+['"][^'"]*kisClient[^'"]*['"][\\s\\S]*?\\b${fn}\\b`),
        );
      }
    });

    it('autoTradeEngine·orderExecutor·trancheExecutor import 0건', () => {
      expect(runnerCodeOnly).not.toMatch(/from\s+['"][^'"]*autoTradeEngine/);
      expect(runnerCodeOnly).not.toMatch(/from\s+['"][^'"]*orderExecutor/);
      expect(runnerCodeOnly).not.toMatch(/from\s+['"][^'"]*trancheExecutor/);
    });

    it('Patch 추적 주석 (Patch-PER-STOCK-PROGRAM-FLOW-CARRY-WIRING-001)', () => {
      // 주석 strip 전 원본에 패치 ID 존재
      expect(runnerSrc).toMatch(/Patch-PER-STOCK-PROGRAM-FLOW-CARRY-WIRING-001/);
    });
  });
});
