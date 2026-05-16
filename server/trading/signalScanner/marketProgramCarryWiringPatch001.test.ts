/**
 * @responsibility Patch-MARKET-PROGRAM-CARRY-WIRING-001 회귀 — ENV gate / 4 필드 carry / Branch A+B wiring / literal invariants 정적 가드.
 */

import fs from 'node:fs';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  buildMarketProgramFlowCarryPayload,
  isMarketProgramCarryWiringDisabled,
  type MarketProgramFlowCarryPayload,
} from './marketProgramCarryWiringPolicy.js';

function readSource(relativeFromTest: string): string {
  return fs.readFileSync(new URL(relativeFromTest, import.meta.url), 'utf8');
}

/** 주석을 strip 한 코드 본체만 반환 (JSDoc / 라인 주석 false-positive 차단). */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const POLICY_SRC = readSource('./marketProgramCarryWiringPolicy.ts');
const POLICY_CODE = stripComments(POLICY_SRC);
const INDEX_SRC = readSource('./index.ts');
const INDEX_CODE = stripComments(INDEX_SRC);
const RUNNER_SRC = readSource('./normalSupplyPreviewRunner.ts');
const RUNNER_CODE = stripComments(RUNNER_SRC);

beforeEach(() => {
  delete process.env.MARKET_PROGRAM_CARRY_WIRING_DISABLED;
});

afterEach(() => {
  delete process.env.MARKET_PROGRAM_CARRY_WIRING_DISABLED;
});

// =====================================================================================
// Group A — ENV gate (ADR-0157 정확 비교, default OFF)
// =====================================================================================

describe('Group A — ENV gate (ADR-0157 정확 비교)', () => {
  it('A1: default (미설정) → isMarketProgramCarryWiringDisabled() === false', () => {
    expect(isMarketProgramCarryWiringDisabled()).toBe(false);
  });

  it("A2: 'true' (lowercase) → true (정확 비교 통과)", () => {
    process.env.MARKET_PROGRAM_CARRY_WIRING_DISABLED = 'true';
    expect(isMarketProgramCarryWiringDisabled()).toBe(true);
  });

  it("A3: 'TRUE'/'1'/'yes' 모두 false 거부 (ADR-0157 정확 비교)", () => {
    for (const value of ['TRUE', '1', 'yes', 'YES', 'on', 'True']) {
      process.env.MARKET_PROGRAM_CARRY_WIRING_DISABLED = value;
      expect(isMarketProgramCarryWiringDisabled()).toBe(false);
    }
  });

  it("A4: 'false' → false (legacy 동작 보존)", () => {
    process.env.MARKET_PROGRAM_CARRY_WIRING_DISABLED = 'false';
    expect(isMarketProgramCarryWiringDisabled()).toBe(false);
  });

  it('A5: 빈 문자열 → false', () => {
    process.env.MARKET_PROGRAM_CARRY_WIRING_DISABLED = '';
    expect(isMarketProgramCarryWiringDisabled()).toBe(false);
  });
});

// =====================================================================================
// Group B — buildMarketProgramFlowCarryPayload 4 필드 정합
// =====================================================================================

describe('Group B — buildMarketProgramFlowCarryPayload 4 필드 정합', () => {
  it('B1: null macroState → undefined (호출자 자연 fallback)', () => {
    expect(buildMarketProgramFlowCarryPayload(null)).toBeUndefined();
    expect(buildMarketProgramFlowCarryPayload(undefined)).toBeUndefined();
  });

  it('B2: 부분 macroState (programSource 만) → 4 필드 모두 등장 + 부재 필드 undefined', () => {
    const result = buildMarketProgramFlowCarryPayload({
      programNetBuyAmount: undefined,
      programArbitrageNetBuy: undefined,
      programFetchedAt: undefined,
      programSource: 'KIS_API',
    });
    expect(result).toBeDefined();
    expect(result?.marketProgramNetBuy).toBeUndefined();
    expect(result?.programArbitrageNetBuyAmount).toBeUndefined();
    expect(result?.programFetchedAt).toBeUndefined();
    expect(result?.sourceProvider).toBe('KIS_API');
    expect(result?.providerIssue).toBe(false);
    expect(result?.executionImpact).toBe('NONE');
    expect(result?.marketSignal).toBe(false);
  });

  it('B3: 정상 4 필드 → 그대로 propagate', () => {
    const result = buildMarketProgramFlowCarryPayload({
      programNetBuyAmount: 1250,
      programArbitrageNetBuy: 320,
      programFetchedAt: '2026-05-16T05:30:00Z',
      programSource: 'KIS_API',
    });
    expect(result).toEqual<MarketProgramFlowCarryPayload>({
      marketProgramNetBuy: 1250,
      programArbitrageNetBuyAmount: 320,
      programFetchedAt: '2026-05-16T05:30:00Z',
      sourceProvider: 'KIS_API',
      providerIssue: false,
      executionImpact: 'NONE',
      marketSignal: false,
    });
  });

  it("B4: programSource='NONE' → providerIssue=true (DATA_UNAVAILABLE 의미, bearish 변환 금지)", () => {
    const result = buildMarketProgramFlowCarryPayload({
      programNetBuyAmount: undefined,
      programArbitrageNetBuy: undefined,
      programFetchedAt: undefined,
      programSource: 'NONE',
    });
    expect(result?.sourceProvider).toBe('NONE');
    expect(result?.providerIssue).toBe(true);
    // 핵심 invariant — providerIssue=true 이지만 marketSignal: false / executionImpact: 'NONE'
    expect(result?.marketSignal).toBe(false);
    expect(result?.executionImpact).toBe('NONE');
  });

  it("B5: programArbitrageNetBuy === null (명시적 null) 그대로 보존 — forensic '명시적 null' vs '부재' 구분", () => {
    const result = buildMarketProgramFlowCarryPayload({
      programNetBuyAmount: 1000,
      programArbitrageNetBuy: null,
      programFetchedAt: '2026-05-16T05:30:00Z',
      programSource: 'KIS_API',
    });
    expect(result?.programArbitrageNetBuyAmount).toBeNull();
  });

  it('B6: programSource 부재 시 NONE fallback + providerIssue=true', () => {
    const result = buildMarketProgramFlowCarryPayload({
      programNetBuyAmount: undefined,
      programArbitrageNetBuy: undefined,
      programFetchedAt: undefined,
      programSource: undefined,
    });
    expect(result?.sourceProvider).toBe('NONE');
    expect(result?.providerIssue).toBe(true);
  });

  it("B7: ENV `MARKET_PROGRAM_CARRY_WIRING_DISABLED=true` 시 정상 macroState 도 undefined 반환 (1줄 즉시 legacy 복원)", () => {
    process.env.MARKET_PROGRAM_CARRY_WIRING_DISABLED = 'true';
    const result = buildMarketProgramFlowCarryPayload({
      programNetBuyAmount: 1250,
      programArbitrageNetBuy: 320,
      programFetchedAt: '2026-05-16T05:30:00Z',
      programSource: 'KIS_API',
    });
    expect(result).toBeUndefined();
  });
});

// =====================================================================================
// Group C — signalScanner/index.ts Branch A wiring 정적 grep 가드
// =====================================================================================

describe('Group C — signalScanner/index.ts Branch A wiring 정적 grep 가드', () => {
  it('C1: index.ts 가 buildMarketProgramFlowCarryPayload SSOT 를 import', () => {
    expect(INDEX_CODE).toMatch(
      /from\s+['"]\.\/marketProgramCarryWiringPolicy\.js['"]/,
    );
    expect(INDEX_CODE).toContain('buildMarketProgramFlowCarryPayload');
  });

  it('C2: persistNormalSupplyPreview 호출 site 2 곳 모두 marketProgramFlow 인자 전달', () => {
    // persistNormalSupplyPreview({...}) 호출 site 전체 추출 — non-greedy regex 가 중첩 객체 첫 `}` 에서 멈추지
    // 않도록 brace-depth 추적 (예: deriveNormalSupplyPreviewEngineMode({...}) 내부 `}` 무시).
    const callsites: string[] = [];
    const calleeIdent = 'persistNormalSupplyPreview(';
    let cursor = 0;
    while (cursor < INDEX_CODE.length) {
      const start = INDEX_CODE.indexOf(calleeIdent, cursor);
      if (start === -1) break;
      // 시작 `(` 부터 매칭하는 `)` 까지 depth 추적
      let depth = 0;
      let i = start + calleeIdent.length - 1; // points at `(`
      for (; i < INDEX_CODE.length; i++) {
        const ch = INDEX_CODE[i];
        if (ch === '(') depth++;
        else if (ch === ')') {
          depth--;
          if (depth === 0) {
            i++;
            break;
          }
        }
      }
      callsites.push(INDEX_CODE.slice(start, i));
      cursor = i;
    }
    expect(callsites.length).toBeGreaterThanOrEqual(2);
    // 모든 callsite 가 marketProgramFlow: 키 보유 의무
    for (const match of callsites) {
      expect(match).toMatch(/marketProgramFlow:/);
      expect(match).toMatch(/buildMarketProgramFlowCarryPayload\(/);
    }
  });

  it('C3: PREFLIGHT_ABORT_DIAGNOSTIC + RUNTIME_DIAGNOSTIC 두 source label 이 marketProgramFlow 와 함께 등장', () => {
    // PREFLIGHT_ABORT_DIAGNOSTIC callsite
    const preflightBlock = INDEX_CODE.match(
      /source:\s*['"]PREFLIGHT_ABORT_DIAGNOSTIC['"][\s\S]*?\}\)/,
    );
    expect(preflightBlock).not.toBeNull();
    expect(preflightBlock?.[0]).toMatch(/marketProgramFlow:/);
    expect(preflightBlock?.[0]).toMatch(/buildMarketProgramFlowCarryPayload\(/);

    // RUNTIME_DIAGNOSTIC callsite
    const runtimeBlock = INDEX_CODE.match(
      /source:\s*['"]RUNTIME_DIAGNOSTIC['"][\s\S]*?\}\)/,
    );
    expect(runtimeBlock).not.toBeNull();
    expect(runtimeBlock?.[0]).toMatch(/marketProgramFlow:/);
    expect(runtimeBlock?.[0]).toMatch(/buildMarketProgramFlowCarryPayload\(/);
  });

  it('C4: 호출자 측 inline `process.env.MARKET_PROGRAM_CARRY_WIRING_DISABLED` 검사 0건 (SSOT 위임 의무)', () => {
    expect(INDEX_CODE).not.toMatch(/process\.env\.MARKET_PROGRAM_CARRY_WIRING_DISABLED/);
  });
});

// =====================================================================================
// Group D — normalSupplyPreviewRunner.ts Branch B wiring 정적 grep 가드
// =====================================================================================

describe('Group D — normalSupplyPreviewRunner.ts Branch B wiring 정적 grep 가드', () => {
  it('D1: type cast 4 필드 모두 노출 (programNetBuyAmount + programArbitrageNetBuy + programFetchedAt + programSource)', () => {
    // type cast block 안에 4 필드 모두 등장 의무
    const castBlock = RUNNER_CODE.match(/loadMacroState\(\)\s+as\s+\{[\s\S]*?\}\s*\|\s*null/);
    expect(castBlock).not.toBeNull();
    expect(castBlock?.[0]).toMatch(/programNetBuyAmount\??:/);
    expect(castBlock?.[0]).toMatch(/programArbitrageNetBuy\??:/);
    expect(castBlock?.[0]).toMatch(/programFetchedAt\??:/);
    expect(castBlock?.[0]).toMatch(/programSource\??:/);
  });

  it('D2: SSOT 위임 — buildMarketProgramFlowCarryPayload(macroState) 호출 (inline 4 필드 객체 합성 부재)', () => {
    expect(RUNNER_CODE).toMatch(
      /from\s+['"]\.\/marketProgramCarryWiringPolicy\.js['"]/,
    );
    expect(RUNNER_CODE).toMatch(/buildMarketProgramFlowCarryPayload\(macroState\)/);
    // legacy inline 객체 합성 (marketProgramNetBuy: macroState.programNetBuyAmount, ...) 부재 의무
    // — drift 차단: SSOT 가 4 필드 모두 carry 하므로 호출자 측 inline 부분 carry 금지
    expect(RUNNER_CODE).not.toMatch(
      /marketProgramNetBuy:\s*macroState\.programNetBuyAmount/,
    );
    expect(RUNNER_CODE).not.toMatch(
      /sourceProvider:\s*macroState\.programSource\s*\?\?/,
    );
  });

  it('D3: 호출자 측 inline `process.env.MARKET_PROGRAM_CARRY_WIRING_DISABLED` 검사 0건', () => {
    expect(RUNNER_CODE).not.toMatch(
      /process\.env\.MARKET_PROGRAM_CARRY_WIRING_DISABLED/,
    );
  });
});

// =====================================================================================
// Group E — literal type 컴파일 타임 강제 (런타임 검증)
// =====================================================================================

describe('Group E — literal type 컴파일 타임 강제 (런타임 검증)', () => {
  it("E1: executionImpact 가 정확히 'NONE' literal (호출자 측 매매 결정 입력 영구 차단)", () => {
    const result = buildMarketProgramFlowCarryPayload({
      programNetBuyAmount: 100,
      programArbitrageNetBuy: 0,
      programFetchedAt: '2026-05-16T05:30:00Z',
      programSource: 'KIS_API',
    });
    // literal type contract — string 'PARTIAL'/'FULL' 등 다른 값 영구 차단
    expect(result?.executionImpact).toBe('NONE');
    expect(typeof result?.executionImpact).toBe('string');
  });

  it('E2: marketSignal 이 정확히 false literal (providerIssue=true 시 bearish 변환 영구 차단)', () => {
    const result = buildMarketProgramFlowCarryPayload({
      programNetBuyAmount: undefined,
      programArbitrageNetBuy: undefined,
      programFetchedAt: undefined,
      programSource: 'NONE',
    });
    expect(result?.marketSignal).toBe(false);
    expect(result?.providerIssue).toBe(true);
    // 절대 불변식 — providerIssue=true 이어도 marketSignal=false 보존
    expect(result?.marketSignal).not.toBe(true);
  });

  it('E3: providerIssue=true 시에도 DATA_UNAVAILABLE 의미 보존 — UNKNOWN != NEUTRAL (ADR-0421 정합)', () => {
    const noneResult = buildMarketProgramFlowCarryPayload({
      programNetBuyAmount: undefined,
      programArbitrageNetBuy: undefined,
      programFetchedAt: undefined,
      programSource: 'NONE',
    });
    expect(noneResult?.providerIssue).toBe(true);
    expect(noneResult?.executionImpact).toBe('NONE');
    expect(noneResult?.marketSignal).toBe(false);

    // 비교 — KIS_API 정상 case
    const kisResult = buildMarketProgramFlowCarryPayload({
      programNetBuyAmount: 100,
      programArbitrageNetBuy: 50,
      programFetchedAt: '2026-05-16T05:30:00Z',
      programSource: 'KIS_API',
    });
    expect(kisResult?.providerIssue).toBe(false);
    // 두 경우 모두 executionImpact / marketSignal 동일 — providerIssue 만 상이
    expect(kisResult?.executionImpact).toBe(noneResult?.executionImpact);
    expect(kisResult?.marketSignal).toBe(noneResult?.marketSignal);
  });
});

// =====================================================================================
// Group F — LIVE 본체 무수정 정적 grep 가드
// =====================================================================================

describe('Group F — LIVE 본체 무수정 정적 grep 가드', () => {
  it('F1: LIVE 매매 본체 파일들이 marketProgramCarryWiringPolicy 를 import 하지 않음', () => {
    const liveBodyPaths = [
      '../signalScanner.ts',
      './perSymbolEvaluation.ts',
      './preflight.ts',
      '../entryEngine.ts',
      '../exitEngine/index.ts',
      '../../clients/kisClient/orders.ts',
      '../../orchestrator/tradingOrchestrator.ts',
      '../../autoTradeEngine.ts',
      '../trancheExecutor.ts',
      '../buyPipeline.ts',
    ];
    for (const relPath of liveBodyPaths) {
      const fileUrl = new URL(relPath, import.meta.url);
      // 파일이 없으면 skip (signalScanner.ts 또는 autoTradeEngine.ts 가 diff 한 경로일 수 있음)
      if (!fs.existsSync(fileUrl)) continue;
      const src = stripComments(fs.readFileSync(fileUrl, 'utf8'));
      expect(src).not.toContain('marketProgramCarryWiringPolicy');
      expect(src).not.toContain('buildMarketProgramFlowCarryPayload');
    }
  });
});

// =====================================================================================
// Group G — 외부 API 호출 0건 정적 grep
// =====================================================================================

describe('Group G — 외부 API 호출 0건 정적 grep', () => {
  it('G1: marketProgramCarryWiringPolicy.ts 가 fetch / axios / node-fetch import 0건', () => {
    expect(POLICY_CODE).not.toMatch(/from\s+['"]node-fetch['"]/);
    expect(POLICY_CODE).not.toMatch(/from\s+['"]axios['"]/);
    expect(POLICY_CODE).not.toMatch(/\bfetch\s*\(/);
    expect(POLICY_CODE).not.toMatch(/\baxios\b/);
  });

  it('G2: marketProgramCarryWiringPolicy.ts 가 KIS 주문 함수 5종 import 0건', () => {
    const kisOrderFns = [
      'placeKisMarketOrder',
      'placeKisSellOrder',
      'placeKisStopLossOrder',
      'placeKisTakeProfitOrder',
      'cancelKisOrder',
    ];
    for (const fn of kisOrderFns) {
      expect(POLICY_CODE).not.toContain(fn);
    }
  });

  it('G3: marketProgramCarryWiringPolicy.ts 가 autoTradeEngine / orderExecutor / trancheExecutor / kisClient orders import 0건', () => {
    expect(POLICY_CODE).not.toMatch(/from\s+['"][^'"]*autoTradeEngine[^'"]*['"]/);
    expect(POLICY_CODE).not.toMatch(/from\s+['"][^'"]*orderExecutor[^'"]*['"]/);
    expect(POLICY_CODE).not.toMatch(/from\s+['"][^'"]*trancheExecutor[^'"]*['"]/);
    expect(POLICY_CODE).not.toMatch(/from\s+['"][^'"]*kisClient\/orders[^'"]*['"]/);
  });
});
