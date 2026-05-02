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

describe('ADR-0170 §3 applyExposureBudgetCap macro 옵셔널 입력', () => {
  it('macro 미전달 → 기존 매핑 (R5_CAUTION → R2_WEAK 정책 적용)', () => {
    process.env.POSITION_SIZING_EXPOSURE_BUDGET_ENABLED = 'true';
    const result = applyExposureBudgetCap(makeInput());
    expect(result.applied).toBe(true);
    expect(result.budget?.regime).toBe('R2_WEAK');
  });

  it('macro 전달 + bearDefenseMode=true → R1_DEFENSIVE 자동 격상 적용', () => {
    process.env.POSITION_SIZING_EXPOSURE_BUDGET_ENABLED = 'true';
    const result = applyExposureBudgetCap(makeInput({ macro: { bearDefenseMode: true } }));
    expect(result.applied).toBe(true);
    expect(result.budget?.regime).toBe('R1_DEFENSIVE');
  });

  it('macro 전달 + vix>30 → R1_DEFENSIVE', () => {
    process.env.POSITION_SIZING_EXPOSURE_BUDGET_ENABLED = 'true';
    const result = applyExposureBudgetCap(makeInput({ macro: { vix: 35 } }));
    expect(result.budget?.regime).toBe('R1_DEFENSIVE');
  });

  it('macro 전달 + 신호 없음 → 기존 매핑 R2_WEAK', () => {
    process.env.POSITION_SIZING_EXPOSURE_BUDGET_ENABLED = 'true';
    const result = applyExposureBudgetCap(makeInput({ macro: { vix: 15, bearDefenseMode: false } }));
    expect(result.budget?.regime).toBe('R2_WEAK');
  });

  it('exposureRegime 명시 우선 — macro 무시', () => {
    process.env.POSITION_SIZING_EXPOSURE_BUDGET_ENABLED = 'true';
    const result = applyExposureBudgetCap(makeInput({
      exposureRegime: 'R3_NEUTRAL',
      macro: { bearDefenseMode: true },
    }));
    expect(result.budget?.regime).toBe('R3_NEUTRAL');
  });

  it('R6_DEFENSE → R0_CRISIS — macro 무관 (자본 보호)', () => {
    process.env.POSITION_SIZING_EXPOSURE_BUDGET_ENABLED = 'true';
    const result = applyExposureBudgetCap(makeInput({
      regime: 'R6_DEFENSE',
      macro: { bearDefenseMode: false, vix: 10 },
    }));
    expect(result.budget?.regime).toBe('R0_CRISIS');
  });

  it('ENV 비활성 (POSITION_SIZING_EXPOSURE_BUDGET_ENABLED 미설정) → applied=false', () => {
    delete process.env.POSITION_SIZING_EXPOSURE_BUDGET_ENABLED;
    const result = applyExposureBudgetCap(makeInput({ macro: { bearDefenseMode: true } }));
    expect(result.applied).toBe(false);
    expect(result.skipReason).toBe('ENV_DISABLED');
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

  it('buyListLoop.ts — buildExposureBudgetMacroInput import', () => {
    const src = readSrc('server/trading/signalScanner/perSymbol/buyListLoop.ts');
    expect(src).toMatch(/buildExposureBudgetMacroInput/);
  });

  it('buyListLoop.ts — 3 호출자 모두 macro 전달', () => {
    const src = readSrc('server/trading/signalScanner/perSymbol/buyListLoop.ts');
    const matches = src.match(/macro:\s*buildExposureBudgetMacroInput\(ctx\.macroState\)/g) ?? [];
    expect(matches.length).toBe(3);
  });

  it('intradayLoop.ts — buildExposureBudgetMacroInput import + 호출', () => {
    const src = readSrc('server/trading/signalScanner/perSymbol/intradayLoop.ts');
    expect(src).toContain('buildExposureBudgetMacroInput');
    expect(src).toMatch(/macro:\s*buildExposureBudgetMacroInput\(ctx\.macroState\)/);
  });

  it('positionSizingEngineWiring.ts — mapInternalToExposureRegimeWithMacro import', () => {
    const src = readSrc('server/trading/sizing/positionSizingEngineWiring.ts');
    expect(src).toMatch(/import\s+\{[\s\S]*?\bmapInternalToExposureRegimeWithMacro\b[\s\S]*?\}\s+from\s+['"]\.\/regimeExposurePolicy\.js['"]/);
  });

  it('positionSizingEngineWiring.ts — macro 전달 시 With Macro 경로 사용', () => {
    const src = readSrc('server/trading/sizing/positionSizingEngineWiring.ts');
    expect(src).toContain('mapInternalToExposureRegimeWithMacro(input.regime, input.macro)');
  });

  it('positionSizingEngineWiring.ts — macro 부재 시 기존 매핑 fallback (회귀 안전)', () => {
    const src = readSrc('server/trading/sizing/positionSizingEngineWiring.ts');
    expect(src).toMatch(/input\.macro[\s\S]*?mapInternalToExposureRegimeWithMacro[\s\S]*?:\s*mapInternalToExposureRegime\(input\.regime\)/);
  });

  it('ADR-0170 §M4 추적 주석 존재 — regimeExposurePolicy.ts', () => {
    const src = readSrc('server/trading/sizing/regimeExposurePolicy.ts');
    expect(src).toMatch(/ADR-0170/);
  });

  it('ADR-0170 §M4 추적 주석 존재 — positionSizingEngineWiring.ts', () => {
    const src = readSrc('server/trading/sizing/positionSizingEngineWiring.ts');
    expect(src).toMatch(/ADR-0170/);
  });

  it('ADR-0170 §M4 추적 주석 존재 — buyListLoop.ts', () => {
    const src = readSrc('server/trading/signalScanner/perSymbol/buyListLoop.ts');
    expect(src).toMatch(/ADR-0170/);
  });

  it('ADR-0170 §M4 추적 주석 존재 — intradayLoop.ts', () => {
    const src = readSrc('server/trading/signalScanner/perSymbol/intradayLoop.ts');
    expect(src).toMatch(/ADR-0170/);
  });
});
