/**
 * @responsibility regimeMemoryBank 회귀 테스트 (ADR-0024 PR-G)
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import {
  getEvolutionWeightsByRegime,
  saveEvolutionWeightsByRegime,
  evaluateFeedbackLoopByRegime,
  evaluateAllRegimes,
  ALL_REGIMES,
  __resetRegimeBankForTests,
} from './regimeMemoryBank';
import { CALIBRATION_MIN_TRADES } from './feedbackLoopEngine';
import type { TradeRecord } from '../../types/portfolio';
import type { ConditionId } from '../../types/core';

import { attachMockLocalStorage } from './__test-utils__/localStorageMock';

// node env 에서 localStorage 가 부재 → in-memory mock 으로 regimeMemoryBank 동작 검증
beforeAll(() => { attachMockLocalStorage(); });

const ORIGINAL_ENV = process.env.LEARNING_REGIME_BANK_DISABLED;
beforeEach(() => {
  __resetRegimeBankForTests();
  if (typeof globalThis.localStorage !== 'undefined') {
    globalThis.localStorage.clear();
  }
});
afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env.LEARNING_REGIME_BANK_DISABLED;
  } else {
    process.env.LEARNING_REGIME_BANK_DISABLED = ORIGINAL_ENV;
  }
});

function makeTrade(returnPct: number, conditionId: ConditionId, score: number, regime?: string): TradeRecord {
  const scores = {} as Record<ConditionId, number>;
  for (let i = 1; i <= 27; i++) scores[i as ConditionId] = 0;
  scores[conditionId] = score;
  return {
    id: `t-${Math.random().toString(36).slice(2, 8)}`,
    stockCode: 'A005930',
    stockName: '삼성전자',
    sector: 'IT',
    buyDate: new Date().toISOString(),
    buyPrice: 1000,
    quantity: 10,
    positionSize: 10,
    systemSignal: 'BUY',
    recommendation: '절반 포지션',
    gate1Score: 5,
    gate2Score: 5,
    gate3Score: 5,
    finalScore: 150,
    conditionScores: scores,
    followedSystem: true,
    returnPct,
    status: 'CLOSED',
    schemaVersion: 2,
    entryRegime: regime,
  };
}

describe('ALL_REGIMES SSOT', () => {
  it('7 regime 모두 포함', () => {
    expect(ALL_REGIMES).toHaveLength(7);
    expect(ALL_REGIMES).toContain('EXPANSION');
    expect(ALL_REGIMES).toContain('CRISIS');
  });
});

describe('getEvolutionWeightsByRegime / save', () => {
  it('regime 부재 → 글로벌 fallback (빈 객체)', () => {
    const w = getEvolutionWeightsByRegime('EXPANSION');
    expect(w).toEqual({});
  });

  it('regime null → 글로벌 fallback', () => {
    const w = getEvolutionWeightsByRegime(null);
    expect(w).toEqual({});
  });

  it('save → load 동일 regime', () => {
    saveEvolutionWeightsByRegime('CRISIS', { 7: 1.4, 21: 1.3 });
    const w = getEvolutionWeightsByRegime('CRISIS');
    expect(w[7]).toBe(1.4);
    expect(w[21]).toBe(1.3);
  });

  it('regime 별 독립 — EXPANSION save 가 CRISIS 영향 없음', () => {
    saveEvolutionWeightsByRegime('EXPANSION', { 24: 1.3 });
    saveEvolutionWeightsByRegime('CRISIS', { 7: 1.4 });
    const exp = getEvolutionWeightsByRegime('EXPANSION');
    const cri = getEvolutionWeightsByRegime('CRISIS');
    expect(exp[24]).toBe(1.3);
    expect(exp[7]).toBeUndefined();
    expect(cri[7]).toBe(1.4);
    expect(cri[24]).toBeUndefined();
  });

  it('LEARNING_REGIME_BANK_DISABLED=true → 항상 글로벌 fallback', () => {
    saveEvolutionWeightsByRegime('EXPANSION', { 24: 1.3 });
    process.env.LEARNING_REGIME_BANK_DISABLED = 'true';
    const w = getEvolutionWeightsByRegime('EXPANSION');
    // 글로벌 fallback (빈) — regime 데이터 무시
    expect(w).toEqual({});
  });

  it('LEARNING_REGIME_BANK_DISABLED=true → save 도 no-op', () => {
    process.env.LEARNING_REGIME_BANK_DISABLED = 'true';
    saveEvolutionWeightsByRegime('CRISIS', { 7: 1.4 });
    delete process.env.LEARNING_REGIME_BANK_DISABLED;
    expect(getEvolutionWeightsByRegime('CRISIS')).toEqual({});
  });
});

describe('evaluateFeedbackLoopByRegime', () => {
  it('regime 미지정 → 전체 trades 학습 (기존 동작)', () => {
    const trades = Array.from({ length: CALIBRATION_MIN_TRADES }, (_, i) =>
      makeTrade(5, 25, 8, i % 2 === 0 ? 'EXPANSION' : 'CRISIS'),
    );
    const result = evaluateFeedbackLoopByRegime(trades, undefined);
    expect(result.calibrationActive).toBe(true);
    expect(result.closedTradeCount).toBe(CALIBRATION_MIN_TRADES);
  });

  it('regime 지정 → 해당 regime trades 만 학습', () => {
    // 30 EXPANSION 거래 (모두 승리 +5%) + 30 CRISIS 거래 (모두 손실 -5%)
    const expTrades = Array.from({ length: CALIBRATION_MIN_TRADES }, () =>
      makeTrade(5, 25, 8, 'EXPANSION'),
    );
    const criTrades = Array.from({ length: CALIBRATION_MIN_TRADES }, () =>
      makeTrade(-5, 25, 8, 'CRISIS'),
    );

    const expResult = evaluateFeedbackLoopByRegime([...expTrades, ...criTrades], 'EXPANSION');
    expect(expResult.closedTradeCount).toBe(CALIBRATION_MIN_TRADES);
    const expCal = expResult.calibrations.find(c => c.conditionId === 25);
    expect(expCal!.winRate).toBe(1.0);
    expect(expCal!.direction).toBe('UP');

    const criResult = evaluateFeedbackLoopByRegime([...expTrades, ...criTrades], 'CRISIS');
    expect(criResult.closedTradeCount).toBe(CALIBRATION_MIN_TRADES);
    const criCal = criResult.calibrations.find(c => c.conditionId === 25);
    expect(criCal!.winRate).toBe(0);
    expect(criCal!.direction).toBe('DOWN');
  });

  it('regime 데이터 부족 (< 30) → calibrationActive=false', () => {
    const expTrades = Array.from({ length: 10 }, () => makeTrade(5, 25, 8, 'EXPANSION'));
    const result = evaluateFeedbackLoopByRegime(expTrades, 'EXPANSION');
    expect(result.calibrationActive).toBe(false);
  });
});

describe('evaluateAllRegimes', () => {
  it('regime 별 독립 학습 결과 반환', () => {
    const trades = [
      ...Array.from({ length: CALIBRATION_MIN_TRADES }, () =>
        makeTrade(5, 25, 8, 'EXPANSION'),
      ),
      ...Array.from({ length: CALIBRATION_MIN_TRADES }, () =>
        makeTrade(-5, 25, 8, 'CRISIS'),
      ),
    ];
    const results = evaluateAllRegimes(trades);
    expect(results.EXPANSION).toBeDefined();
    expect(results.CRISIS).toBeDefined();
    expect(results.EXPANSION!.calibrations.find(c => c.conditionId === 25)?.direction).toBe('UP');
    expect(results.CRISIS!.calibrations.find(c => c.conditionId === 25)?.direction).toBe('DOWN');
    // 거래 없는 regime 은 미포함
    expect(results.RANGE_BOUND).toBeUndefined();
  });

  it('빈 trades → 빈 결과 객체', () => {
    expect(evaluateAllRegimes([])).toEqual({});
  });
});
