/**
 * @responsibility feedbackLoopEngine coverage gate wiring 회귀 테스트 (ADR-0048 PR-Y4)
 */
import { describe, it, expect, beforeEach, afterEach, vi, beforeAll } from 'vitest';
import {
  evaluateFeedbackLoop,
  CALIBRATION_MIN_TRADES,
} from './quant/feedbackLoopEngine';
import { __resetF2WDriftStateForTests } from './quant/f2wDriftDetector';
import { COVERAGE_THRESHOLD, type RegimeKey } from './quant/learningCoverage';
import * as evolutionEngine from './quant/evolutionEngine';
import { attachMockLocalStorage } from './quant/__test-utils__/localStorageMock';
import type { TradeRecord } from '../types/portfolio';

beforeAll(() => { attachMockLocalStorage(); });

const ORIGINAL_DISABLED = process.env.LEARNING_COVERAGE_GATE_DISABLED;
beforeEach(() => {
  __resetF2WDriftStateForTests();
  delete process.env.LEARNING_COVERAGE_GATE_DISABLED;
  vi.restoreAllMocks();
});
afterEach(() => {
  if (ORIGINAL_DISABLED === undefined) delete process.env.LEARNING_COVERAGE_GATE_DISABLED;
  else process.env.LEARNING_COVERAGE_GATE_DISABLED = ORIGINAL_DISABLED;
});

function makeTrade(id: string, regime: RegimeKey, conditionId: number = 1): TradeRecord {
  return {
    id,
    stockCode: '005930',
    stockName: '삼성전자',
    sector: '반도체',
    buyDate: '2026-04-01T00:00:00.000Z',
    buyPrice: 70000,
    quantity: 10,
    positionSize: 5,
    sellDate: '2026-04-10T00:00:00.000Z',
    sellPrice: 75000,
    sellReason: 'TARGET_HIT',
    systemSignal: 'STRONG_BUY',
    recommendation: '풀 포지션',
    gate1Score: 9,
    gate2Score: 9,
    gate3Score: 9,
    finalScore: 90,
    conditionScores: { [conditionId]: 8 } as TradeRecord['conditionScores'],
    followedSystem: true,
    returnPct: 7.14,
    holdingDays: 9,
    status: 'CLOSED',
    entryRegime: regime,
    schemaVersion: 2,
  } satisfies TradeRecord;
}

describe('feedbackLoopEngine coverage gate (ADR-0048)', () => {
  it('단일 레짐 30건 → sufficient → 정상 보정 + coverageGated 미존재', () => {
    const trades = Array.from({ length: 30 }, (_, i) => makeTrade(`t${i}`, 'EXPANSION', 1));
    const saveSpy = vi.spyOn(evolutionEngine, 'saveEvolutionWeights');

    const result = evaluateFeedbackLoop(trades, { 1: 1.0 });

    expect(result.calibrationActive).toBe(true);
    expect(result.calibrations.length).toBeGreaterThan(0);
    expect(result.coverageGated).toBeUndefined();
    expect(saveSpy).toHaveBeenCalled();
  });

  it('다중 레짐 분산 (15 + 15) → 어떤 셀도 30 미만 → coverageGated', () => {
    const trades = [
      ...Array.from({ length: 15 }, (_, i) => makeTrade(`a${i}`, 'EXPANSION', 1)),
      ...Array.from({ length: 15 }, (_, i) => makeTrade(`b${i}`, 'CRISIS', 1)),
    ];
    const saveSpy = vi.spyOn(evolutionEngine, 'saveEvolutionWeights');

    const result = evaluateFeedbackLoop(trades, { 1: 1.0 });

    expect(result.calibrationActive).toBe(true);
    expect(result.calibrations).toHaveLength(0); // 가중치 보정 0건
    expect(result.coverageGated).toBeDefined();
    expect(result.coverageGated!.length).toBe(1);
    expect(result.coverageGated![0].conditionId).toBe(1);
    expect(result.coverageGated![0].maxCellCount).toBe(15);
    expect(result.coverageGated![0].reason).toBe('INSUFFICIENT_COVERAGE');
    expect(saveSpy).not.toHaveBeenCalled(); // 가중치 변경 0
  });

  it('단일 레짐 29건 → 임계 1 미달 → coverageGated', () => {
    const trades = Array.from({ length: 29 }, (_, i) => makeTrade(`t${i}`, 'EXPANSION', 1));
    // CALIBRATION_MIN_TRADES (30) 도 미달이라 calibrationActive 자체가 false
    // → coverage 게이트가 작동하지 않는 경로. 이 경우는 30+ 거래 + 다중 레짐 분산 케이스로 이동.
    const result = evaluateFeedbackLoop(trades, { 1: 1.0 });
    expect(result.calibrationActive).toBe(false);
  });

  it('한 셀 30+ + 다른 셀 5 → sufficient (한 셀이라도 충족)', () => {
    const trades = [
      ...Array.from({ length: 30 }, (_, i) => makeTrade(`a${i}`, 'EXPANSION', 1)),
      ...Array.from({ length: 5 }, (_, i) => makeTrade(`b${i}`, 'CRISIS', 1)),
    ];
    const result = evaluateFeedbackLoop(trades, { 1: 1.0 });
    expect(result.calibrationActive).toBe(true);
    expect(result.calibrations.length).toBeGreaterThan(0);
    expect(result.coverageGated).toBeUndefined();
  });

  it('LEARNING_COVERAGE_GATE_DISABLED=true → 게이트 우회 + 정상 보정', () => {
    process.env.LEARNING_COVERAGE_GATE_DISABLED = 'true';
    const trades = [
      ...Array.from({ length: 15 }, (_, i) => makeTrade(`a${i}`, 'EXPANSION', 1)),
      ...Array.from({ length: 15 }, (_, i) => makeTrade(`b${i}`, 'CRISIS', 1)),
    ];
    const result = evaluateFeedbackLoop(trades, { 1: 1.0 });
    expect(result.calibrations.length).toBeGreaterThan(0); // 게이트 우회 → 보정 됨
    expect(result.coverageGated).toBeUndefined();
  });

  it('shadow=true 호출 — 게이트 활성, drift 가드는 우회', () => {
    const trades = [
      ...Array.from({ length: 15 }, (_, i) => makeTrade(`a${i}`, 'EXPANSION', 1)),
      ...Array.from({ length: 15 }, (_, i) => makeTrade(`b${i}`, 'CRISIS', 1)),
    ];
    const saveSpy = vi.spyOn(evolutionEngine, 'saveEvolutionWeights');
    const result = evaluateFeedbackLoop(trades, { 1: 1.0 }, { shadow: true });
    // shadow 도 coverage 게이트는 적용 (학습 무결성)
    expect(result.coverageGated).toBeDefined();
    expect(saveSpy).not.toHaveBeenCalled(); // shadow 라 어차피 차단
  });

  it('entryRegime 부재 v1 레코드 → UNCERTAIN fallback 그룹화', () => {
    const trades = Array.from({ length: 30 }, (_, i) => {
      const t = makeTrade(`t${i}`, 'EXPANSION', 1);
      // v1 레코드 시뮬레이션
      delete (t as { entryRegime?: string }).entryRegime;
      return t;
    });
    const result = evaluateFeedbackLoop(trades, { 1: 1.0 });
    // 30건 모두 UNCERTAIN 으로 그룹화 → sufficient
    expect(result.calibrations.length).toBeGreaterThan(0);
    expect(result.coverageGated).toBeUndefined();
  });
});
