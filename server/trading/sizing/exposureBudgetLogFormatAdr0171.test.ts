/**
 * exposureBudgetLogFormatAdr0171.test.ts (ADR-0171)
 *
 * formatExposureBudgetLog SSOT — 6 신규 필드 (사용자 §4 권장) +
 * isExposureBudgetVerboseLogEnabled ENV gate + 호출자 4 site 정합 정적 가드.
 *
 * 실행: npx vitest run server/trading/sizing/exposureBudgetLogFormatAdr0171.test.ts
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  formatExposureBudgetLog,
  isExposureBudgetVerboseLogEnabled,
  computePortfolioExposureBudget,
  applyPortfolioExposureCap,
  REGIME_EXPOSURE_POLICIES,
  type FormatExposureBudgetLogInput,
  type MarketRegimeLevel,
} from './regimeExposurePolicy.js';

const ORIGINAL_ENV = process.env.SIZING_EXPOSURE_BUDGET_VERBOSE_LOG;
beforeEach(() => { delete process.env.SIZING_EXPOSURE_BUDGET_VERBOSE_LOG; });
afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.SIZING_EXPOSURE_BUDGET_VERBOSE_LOG;
  else process.env.SIZING_EXPOSURE_BUDGET_VERBOSE_LOG = ORIGINAL_ENV;
});

// ─── ENV 분기 ─────────────────────────────────────────────────────────────

describe('isExposureBudgetVerboseLogEnabled — ENV 분기', () => {
  it('미설정 시 false (default OFF)', () => {
    expect(isExposureBudgetVerboseLogEnabled()).toBe(false);
  });
  it('=true 시 true', () => {
    process.env.SIZING_EXPOSURE_BUDGET_VERBOSE_LOG = 'true';
    expect(isExposureBudgetVerboseLogEnabled()).toBe(true);
  });
  it('=false 시 false', () => {
    process.env.SIZING_EXPOSURE_BUDGET_VERBOSE_LOG = 'false';
    expect(isExposureBudgetVerboseLogEnabled()).toBe(false);
  });
  it('=1 시 false (strict equals 비교)', () => {
    process.env.SIZING_EXPOSURE_BUDGET_VERBOSE_LOG = '1';
    expect(isExposureBudgetVerboseLogEnabled()).toBe(false);
  });
});

// ─── 분기 1: budget 부재 (ENV OFF / INPUT_MISSING) ───────────────────────

describe('formatExposureBudgetLog — 분기 1: budget 부재', () => {
  it('budget 미전달 → 경량 한 줄 (regime 미노출)', () => {
    const msg = formatExposureBudgetLog({
      stockCode: '005930',
      stockName: '삼성전자',
      pathLabel: 'PRE_BREAKOUT_FOLLOWTHROUGH',
      rawQuantity: 100,
      finalQuantity: 100,
      capResult: undefined,
      budget: undefined,
    });
    expect(msg).toBe('[Sizing-ExposureBudget] 005930 삼성전자 (PRE_BREAKOUT_FOLLOWTHROUGH) → qty=100 (raw=100)');
    expect(msg).not.toContain('regime=');
    expect(msg).not.toContain('targetPct');
  });

  it('blockReason 부재 시 trailing 공백 제거', () => {
    const msg = formatExposureBudgetLog({
      stockCode: '005930', stockName: '삼성', rawQuantity: 50, finalQuantity: 50,
    });
    expect(msg.endsWith('(raw=50)')).toBe(true);
    expect(msg).not.toMatch(/\s+$/);
  });

  it('blockReason 존재 시 마지막에 노출', () => {
    const msg = formatExposureBudgetLog({
      stockCode: '005930', stockName: '삼성', rawQuantity: 100, finalQuantity: 0,
      capResult: { finalPositionAmount: 0, cappedByExposureBudget: true, blockReason: '레짐별 최대 한도 초과' },
    });
    expect(msg).toContain('qty=0 (raw=100) 레짐별 최대 한도 초과');
  });
});

// ─── 분기 2: budget 존재 + verbose OFF (default 4 필드) ──────────────────

describe('formatExposureBudgetLog — 분기 2: budget 존재 + verbose OFF', () => {
  const budget = computePortfolioExposureBudget({
    accountEquity: 10_000_000,
    currentEquityExposureAmount: 5_000_000,
    currentCashAmount: 5_000_000,
    regime: 'R3_NEUTRAL',
  });
  const capResult = applyPortfolioExposureCap({
    rawPositionAmount: 1_000_000,
    exposureBudget: budget,
    isAddOnBuy: false,
  });

  it('verbose OFF (default) — regime 노출 4 필드 byte-equivalent', () => {
    const msg = formatExposureBudgetLog({
      stockCode: '005930',
      stockName: '삼성전자',
      rawQuantity: 100,
      finalQuantity: 80,
      budget,
      capResult,
    });
    expect(msg).toContain('regime=R3_NEUTRAL');
    expect(msg).toContain('qty=80 (raw=100)');
    expect(msg).not.toContain('targetPct');
    expect(msg).not.toContain('maxPct');
    expect(msg).not.toContain('currentPct');
    expect(msg).not.toContain('toTarget');
    expect(msg).not.toContain('toMax');
    expect(msg).not.toContain('cappedByBudget');
  });

  it('pathLabel 미전달 시 (메인 buyList) suffix 부재', () => {
    const msg = formatExposureBudgetLog({
      stockCode: '005930', stockName: '삼성', rawQuantity: 100, finalQuantity: 80, budget, capResult,
    });
    expect(msg).not.toContain('(PRE_BREAKOUT');
    expect(msg).not.toContain('(INTRADAY');
  });

  it('pathLabel 빈 문자열 → suffix 부재', () => {
    const msg = formatExposureBudgetLog({
      stockCode: '005930', stockName: '삼성', pathLabel: '', rawQuantity: 100, finalQuantity: 80, budget, capResult,
    });
    expect(msg).not.toContain('()');
  });
});

// ─── 분기 3: budget 존재 + verbose ON (10 필드 = 사용자 §4 권장) ────────

describe('formatExposureBudgetLog — 분기 3: verbose ON (10 필드)', () => {
  it('ENV ON — 6 신규 필드 모두 노출', () => {
    process.env.SIZING_EXPOSURE_BUDGET_VERBOSE_LOG = 'true';
    const budget = computePortfolioExposureBudget({
      accountEquity: 10_000_000,
      currentEquityExposureAmount: 4_000_000,
      currentCashAmount: 6_000_000,
      regime: 'R3_NEUTRAL',
    });
    const msg = formatExposureBudgetLog({
      stockCode: '005930', stockName: '삼성전자', rawQuantity: 200, finalQuantity: 150,
      budget,
      capResult: { finalPositionAmount: 1_500_000, cappedByExposureBudget: true, blockReason: '예산 제한' },
    });
    // 6 신규 필드
    expect(msg).toContain('targetPct=');
    expect(msg).toContain('maxPct=');
    expect(msg).toContain('currentPct=');
    expect(msg).toContain('toTarget=');
    expect(msg).toContain('toMax=');
    expect(msg).toContain('cappedByBudget=');
    // 기존 4 필드 보존
    expect(msg).toContain('005930');
    expect(msg).toContain('삼성전자');
    expect(msg).toContain('regime=R3_NEUTRAL');
    expect(msg).toContain('qty=150 (raw=200)');
    expect(msg).toContain('예산 제한');
  });

  it('verboseOverride=true — ENV 무관 강제 활성', () => {
    const budget = computePortfolioExposureBudget({
      accountEquity: 10_000_000, currentEquityExposureAmount: 0, currentCashAmount: 10_000_000, regime: 'R5_BULL',
    });
    const msg = formatExposureBudgetLog({
      stockCode: '005930', stockName: '삼성', rawQuantity: 100, finalQuantity: 100, budget,
      capResult: { finalPositionAmount: 1_000_000, cappedByExposureBudget: false },
      verboseOverride: true,
    });
    expect(msg).toContain('cappedByBudget=false');
    expect(msg).toContain('targetPct=');
  });

  it('verboseOverride=false + ENV ON → ENV 우선되지 않고 override 우선 (4 필드)', () => {
    process.env.SIZING_EXPOSURE_BUDGET_VERBOSE_LOG = 'true';
    const budget = computePortfolioExposureBudget({
      accountEquity: 10_000_000, currentEquityExposureAmount: 0, currentCashAmount: 10_000_000, regime: 'R3_NEUTRAL',
    });
    const msg = formatExposureBudgetLog({
      stockCode: '005930', stockName: '삼성', rawQuantity: 100, finalQuantity: 100, budget,
      capResult: { finalPositionAmount: 1_000_000, cappedByExposureBudget: false },
      verboseOverride: false,
    });
    expect(msg).not.toContain('targetPct=');
    expect(msg).toContain('regime=R3_NEUTRAL');
  });

  it('cappedByBudget=true 정확 노출 (사용자 §4 핵심 신호)', () => {
    const budget = computePortfolioExposureBudget({
      accountEquity: 10_000_000, currentEquityExposureAmount: 4_000_000, currentCashAmount: 6_000_000, regime: 'R1_DEFENSIVE',
    });
    const msg = formatExposureBudgetLog({
      stockCode: '005930', stockName: '삼성', rawQuantity: 100, finalQuantity: 0, budget,
      capResult: { finalPositionAmount: 0, cappedByExposureBudget: true, blockReason: '신규 매수 금지' },
      verboseOverride: true,
    });
    expect(msg).toContain('cappedByBudget=true');
  });

  it('targetPct/maxPct 정수 % 형식 (R3_NEUTRAL = 45%/50%)', () => {
    const budget = computePortfolioExposureBudget({
      accountEquity: 10_000_000, currentEquityExposureAmount: 0, currentCashAmount: 10_000_000, regime: 'R3_NEUTRAL',
    });
    const msg = formatExposureBudgetLog({
      stockCode: '005930', stockName: '삼성', rawQuantity: 100, finalQuantity: 100, budget,
      capResult: { finalPositionAmount: 1_000_000, cappedByExposureBudget: false },
      verboseOverride: true,
    });
    expect(msg).toContain('targetPct=45%');
    expect(msg).toContain('maxPct=50%');
  });

  it('currentPct 소수점 2자리 형식 (40% 노출 시 40.00%)', () => {
    const budget = computePortfolioExposureBudget({
      accountEquity: 10_000_000, currentEquityExposureAmount: 4_000_000, currentCashAmount: 6_000_000, regime: 'R3_NEUTRAL',
    });
    const msg = formatExposureBudgetLog({
      stockCode: '005930', stockName: '삼성', rawQuantity: 100, finalQuantity: 100, budget,
      capResult: { finalPositionAmount: 1_000_000, cappedByExposureBudget: false },
      verboseOverride: true,
    });
    expect(msg).toContain('currentPct=40.00%');
  });

  it('toTarget/toMax 정수 원 형식 (R3 target=450만 / max=500만)', () => {
    const budget = computePortfolioExposureBudget({
      accountEquity: 10_000_000, currentEquityExposureAmount: 0, currentCashAmount: 10_000_000, regime: 'R3_NEUTRAL',
    });
    // R3_NEUTRAL targetPct=45% × 1000만 = 450만, maxPct=50% × 1000만 = 500만
    const msg = formatExposureBudgetLog({
      stockCode: '005930', stockName: '삼성', rawQuantity: 100, finalQuantity: 100, budget,
      capResult: { finalPositionAmount: 1_000_000, cappedByExposureBudget: false },
      verboseOverride: true,
    });
    expect(msg).toContain('toTarget=4500000원');
    expect(msg).toContain('toMax=5000000원');
  });
});

// ─── 호출자 4 site 정합 정적 가드 (drift 차단) ────────────────────────────

describe('호출자 4 site 정합 — 정적 grep 가드', () => {
  const buyListLoopSrc = readFileSync(
    resolve(process.cwd(), 'server/trading/signalScanner/perSymbol/buyListLoop.ts'),
    'utf-8',
  );
  const intradayLoopSrc = readFileSync(
    resolve(process.cwd(), 'server/trading/signalScanner/perSymbol/intradayLoop.ts'),
    'utf-8',
  );

  it('buyListLoop.ts — formatExposureBudgetLog import + 3 호출 (PRE_FOLLOW + PRE 30% + 메인)', () => {
    expect(buyListLoopSrc).toMatch(/import\s*\{[^}]*formatExposureBudgetLog[^}]*\}\s*from\s+'\.\.\/\.\.\/sizing\/regimeExposurePolicy\.js'/);
    const occurrences = buyListLoopSrc.match(/formatExposureBudgetLog\(/g) ?? [];
    expect(occurrences.length).toBe(3);
  });

  it('intradayLoop.ts — formatExposureBudgetLog import + 1 호출', () => {
    expect(intradayLoopSrc).toMatch(/import\s*\{[^}]*formatExposureBudgetLog[^}]*\}\s*from\s+'\.\.\/\.\.\/sizing\/regimeExposurePolicy\.js'/);
    const occurrences = intradayLoopSrc.match(/formatExposureBudgetLog\(/g) ?? [];
    expect(occurrences.length).toBe(1);
  });

  it('buyListLoop.ts — 3 pathLabel 정확 (PRE_BREAKOUT_FOLLOWTHROUGH / PRE_BREAKOUT 30% / 메인=undefined)', () => {
    expect(buyListLoopSrc).toContain("pathLabel: 'PRE_BREAKOUT_FOLLOWTHROUGH'");
    expect(buyListLoopSrc).toContain("pathLabel: 'PRE_BREAKOUT 30%'");
    // 메인 buyList 는 pathLabel 미전달 (regime 노출 4 필드 default).
  });

  it('intradayLoop.ts — pathLabel = INTRADAY_STRONG', () => {
    expect(intradayLoopSrc).toContain("pathLabel: 'INTRADAY_STRONG'");
  });

  it('buyListLoop.ts + intradayLoop.ts — inline `[Sizing-ExposureBudget]` 문자열 합성 부재 (drift 차단)', () => {
    // 본 PR 후엔 모든 호출 site 가 SSOT formatter 만 사용해야 함.
    // inline `console.log(\`[Sizing-ExposureBudget]\` ...)` 패턴 차단.
    const inlineBuyList = buyListLoopSrc.match(/console\.log\(\s*`\[Sizing-ExposureBudget\]/g) ?? [];
    const inlineIntraday = intradayLoopSrc.match(/console\.log\(\s*`\[Sizing-ExposureBudget\]/g) ?? [];
    expect(inlineBuyList.length).toBe(0);
    expect(inlineIntraday.length).toBe(0);
  });

  it('호출자 4 site 모두 ADR-0171 주석 추적성', () => {
    const buyListAdr = buyListLoopSrc.match(/ADR-0171/g) ?? [];
    const intradayAdr = intradayLoopSrc.match(/ADR-0171/g) ?? [];
    expect(buyListAdr.length).toBeGreaterThanOrEqual(4);  // 1 import + 3 site 주석
    expect(intradayAdr.length).toBeGreaterThanOrEqual(2);  // 1 import + 1 site 주석
  });
});

// ─── 통합 시나리오 — applyPortfolioExposureCap 결과 wiring ────────────────

describe('통합 시나리오 — applyPortfolioExposureCap 결과 + formatter', () => {
  it('R0_CRISIS 신규 매수 차단 시나리오 — verbose ON (cappedByBudget=true)', () => {
    const budget = computePortfolioExposureBudget({
      accountEquity: 10_000_000, currentEquityExposureAmount: 0, currentCashAmount: 10_000_000, regime: 'R0_CRISIS',
    });
    const capResult = applyPortfolioExposureCap({
      rawPositionAmount: 500_000,
      exposureBudget: budget,
      isAddOnBuy: false,
    });
    const msg = formatExposureBudgetLog({
      stockCode: '005930', stockName: '삼성', rawQuantity: 50, finalQuantity: 0, budget, capResult,
      verboseOverride: true,
    });
    expect(msg).toContain('cappedByBudget=true');
    expect(msg).toContain('현재 레짐에서 신규 매수 금지');
  });

  it('R6_STRONG_BULL 정상 진입 시나리오 — verbose ON (cappedByBudget=false)', () => {
    const budget = computePortfolioExposureBudget({
      accountEquity: 10_000_000, currentEquityExposureAmount: 0, currentCashAmount: 10_000_000, regime: 'R6_STRONG_BULL',
    });
    const capResult = applyPortfolioExposureCap({
      rawPositionAmount: 500_000,
      exposureBudget: budget,
      isAddOnBuy: false,
    });
    const msg = formatExposureBudgetLog({
      stockCode: '005930', stockName: '삼성', rawQuantity: 50, finalQuantity: 50, budget, capResult,
      verboseOverride: true,
    });
    expect(msg).toContain('cappedByBudget=false');
    expect(msg).toContain('regime=R6_STRONG_BULL');
    expect(msg).toContain('targetPct=85%');
    expect(msg).toContain('maxPct=90%');
  });
});
