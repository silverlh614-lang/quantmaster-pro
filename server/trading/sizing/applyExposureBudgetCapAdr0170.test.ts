/**
 * @responsibility ADR-0170 §M4 회귀 — applyExposureBudgetCap macro 옵셔널 입력 + 4 호출자 정합 정적 가드
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  applyExposureBudgetCap,
  type ApplyExposureBudgetCapInput,
} from './positionSizingEngineWiring.js';
import { applyExposureBudgetCap as activeExposureBudgetCap } from './entrySizingPolicy.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../../..');

const ORIGINAL_BUDGET = process.env.POSITION_SIZING_EXPOSURE_BUDGET_ENABLED;
const ORIGINAL_DISABLED = process.env.EXPOSURE_REGIME_AUTO_MAPPING_DISABLED;

afterEach(() => {
  if (ORIGINAL_BUDGET === undefined) delete process.env.POSITION_SIZING_EXPOSURE_BUDGET_ENABLED;
  else process.env.POSITION_SIZING_EXPOSURE_BUDGET_ENABLED = ORIGINAL_BUDGET;
  if (ORIGINAL_DISABLED === undefined) delete process.env.EXPOSURE_REGIME_AUTO_MAPPING_DISABLED;
  else process.env.EXPOSURE_REGIME_AUTO_MAPPING_DISABLED = ORIGINAL_DISABLED;
});

function readSrc(rel: string): string {
  return readFileSync(path.join(REPO_ROOT, rel), 'utf-8');
}

function makeInput(overrides: Partial<ApplyExposureBudgetCapInput> = {}): ApplyExposureBudgetCapInput {
  return {
    rawQuantity: 100,
    shadowEntryPrice: 10_000,
    accountEquity: 30_000_000,
    currentEquityExposureAmount: 0,
    currentCashAmount: 30_000_000,
    regime: 'R5_CAUTION',
    isAddOnBuy: false,
    ...overrides,
  };
}

describe('retired macro inputs at the active exposure boundary', () => {
  it.each([
    {}, { macro: { bearDefenseMode: true } }, { macro: { vix: 35 } },
    { macro: { vix: 15, bearDefenseMode: false } },
    { exposureRegime: 'R3_NEUTRAL', macro: { bearDefenseMode: true } },
    { regime: 'R6_DEFENSE', macro: { bearDefenseMode: false, vix: 10 } },
  ])('ignores historical regime and macro labels %j', (overrides) => {
    process.env.POSITION_SIZING_EXPOSURE_BUDGET_ENABLED = 'true';
    const result = applyExposureBudgetCap(makeInput(overrides));
    expect(result).toMatchObject({ applied: true, finalQuantity: 100 });
    expect(result.budget).toBeUndefined();
  });
  it('legacy import delegates to the current cash/capital boundary', () => {
    expect(applyExposureBudgetCap).toBe(activeExposureBudgetCap);
    delete process.env.POSITION_SIZING_EXPOSURE_BUDGET_ENABLED;
    expect(applyExposureBudgetCap(makeInput({ currentCashAmount: 15000 })))
      .toMatchObject({ applied: true, finalQuantity: 1 });
  });
});
describe('ADR-0170 §4 호출자 정합 정적 가드 — drift 차단', () => {
  it('helpers.ts — buildExposureBudgetMacroInput export 보유', () => {
    const src = readSrc('server/trading/signalScanner/perSymbol/helpers.ts');
    expect(src).toMatch(/export function buildExposureBudgetMacroInput/);
  });

  it('helpers.ts — vix/vkospi/bearDefenseMode 3 필드 propagate', () => {
    const src = readSrc('server/trading/signalScanner/perSymbol/helpers.ts');
    expect(src).toContain('vix: macroState.vix');
    expect(src).toContain('vkospi: macroState.vkospi');
    expect(src).toContain('bearDefenseMode: macroState.bearDefenseMode');
  });

  it('helpers.ts — macroState=null 안전 fallback', () => {
    const src = readSrc('server/trading/signalScanner/perSymbol/helpers.ts');
    expect(src).toMatch(/macroState:\s*MacroState\s*\|\s*null\s*\|\s*undefined/);
  });

  // seed 4452bd3 가 buyListLoop.ts 를 perSymbol/steps/* 로 분해 — 메인 buyList 의
  // 3 호출자(exposureBudgetCap / preBreakoutFollowthroughBudget / preBreakoutEntry)가
  // 각각 별도 step 파일로 이동했다. 정적 가드를 분해된 step 파일들로 재지정한다
  // (intradayLoop 는 별도 caller 로 아래 case 가 커버). intent(=메인 3 caller 모두
  // buildExposureBudgetMacroInput(ctx.macroState) 로 macro propagate) 보존.
  const MAIN_BUYLIST_STEP_FILES = [
    'server/trading/signalScanner/perSymbol/steps/exposureBudgetCap.ts',
    'server/trading/signalScanner/perSymbol/steps/preBreakoutFollowthroughBudget.ts',
    'server/trading/signalScanner/perSymbol/steps/preBreakoutEntry.ts',
  ];

  it('메인 buyList step 파일들 — buildExposureBudgetMacroInput import', () => {
    for (const f of MAIN_BUYLIST_STEP_FILES) {
      expect(readSrc(f)).toMatch(/buildExposureBudgetMacroInput/);
    }
  });

  it('메인 buyList — 3 호출자 모두 macro 전달 (분해된 step 파일 합산)', () => {
    const total = MAIN_BUYLIST_STEP_FILES.reduce((acc, f) => {
      const matches = readSrc(f).match(/macro:\s*buildExposureBudgetMacroInput\(ctx\.macroState\)/g) ?? [];
      return acc + matches.length;
    }, 0);
    expect(total).toBe(3);
  });

  it('intradayLoop.ts — buildExposureBudgetMacroInput import + 호출', () => {
    const src = readSrc('server/trading/signalScanner/perSymbol/intradayLoop.ts');
    expect(src).toContain('buildExposureBudgetMacroInput');
    expect(src).toMatch(/macro:\s*buildExposureBudgetMacroInput\(ctx\.macroState\)/);
  });

  it('entrySizingPolicy.ts does not import live regime mappers', () => {
    const src = readSrc('server/trading/sizing/entrySizingPolicy.ts');
    expect(src).not.toContain('mapInternalToExposureRegime');
  });

  it('entrySizingPolicy.ts does not consume historical macro arguments', () => {
    const src = readSrc('server/trading/sizing/entrySizingPolicy.ts');
    expect(src).not.toContain('input.macro');
  });

  it('entrySizingPolicy.ts does not select any substitute regime', () => {
    const src = readSrc('server/trading/sizing/entrySizingPolicy.ts');
    expect(src).not.toContain('input.regime');
    expect(src).not.toContain('input.exposureRegime');
  });

  it('ADR-0170 §M4 추적 주석 존재 — regimeExposurePolicy.ts', () => {
    const src = readSrc('server/trading/sizing/regimeExposurePolicy.ts');
    expect(src).toMatch(/ADR-0170/);
  });

  it('entrySizingPolicy.ts labels current calculations as fixed budget', () => {
    const src = readSrc('server/trading/sizing/entrySizingPolicy.ts');
    expect(src).toContain('FIXED_BUDGET');
  });

  // seed 4452bd3 분해로 buyListLoop.ts 의 ADR-0170 §M4 추적 주석이 macro-input SSOT
  // 헬퍼(helpers.ts: buildExposureBudgetMacroInput 정의부)로 이동했다. 메인 buyList 의
  // 3 step caller 가 모두 이 헬퍼를 import 하므로 추적성 SSOT 는 helpers.ts 다.
  it('ADR-0170 §M4 추적 주석 존재 — perSymbol/helpers.ts (macro-input SSOT)', () => {
    const src = readSrc('server/trading/signalScanner/perSymbol/helpers.ts');
    expect(src).toMatch(/ADR-0170/);
  });

  it('ADR-0170 §M4 추적 주석 존재 — intradayLoop.ts', () => {
    const src = readSrc('server/trading/signalScanner/perSymbol/intradayLoop.ts');
    expect(src).toMatch(/ADR-0170/);
  });
});
