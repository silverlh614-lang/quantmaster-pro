/**
 * @responsibility learningCoverage 회귀 테스트 (ADR-0048 PR-Y4)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  countTradesByRegime,
  evaluateConditionCoverage,
  buildCoverageMatrix,
  COVERAGE_THRESHOLD,
  FALLBACK_REGIME,
  LEARNING_COVERAGE_CONSTANTS,
  type RegimeKey,
} from './learningCoverage';
import type { TradeRecord } from '../../types/portfolio';

const ORIGINAL_DISABLED = process.env.LEARNING_COVERAGE_GATE_DISABLED;
beforeEach(() => {
  delete process.env.LEARNING_COVERAGE_GATE_DISABLED;
});
afterEach(() => {
  if (ORIGINAL_DISABLED === undefined) delete process.env.LEARNING_COVERAGE_GATE_DISABLED;
  else process.env.LEARNING_COVERAGE_GATE_DISABLED = ORIGINAL_DISABLED;
});

function makeTrade(
  id: string,
  regime: RegimeKey | undefined,
  conditionScores: Record<number, number> = { 1: 8 },
): TradeRecord {
  return {
    id,
    stockCode: '005930',
    stockName: '삼성전자',
    sector: '반도체',
    buyDate: '2026-04-01T00:00:00.000Z',
    buyPrice: 70000,
    quantity: 10,
    positionSize: 5,
    systemSignal: 'STRONG_BUY',
    recommendation: '풀 포지션',
    gate1Score: 9,
    gate2Score: 9,
    gate3Score: 9,
    finalScore: 90,
    conditionScores,
    followedSystem: true,
    status: 'CLOSED',
    returnPct: 5,
    entryRegime: regime,
    schemaVersion: 2,
  } satisfies TradeRecord;
}

// ─── countTradesByRegime ──────────────────────────────────────────────────────

describe('countTradesByRegime', () => {
  it('빈 배열 → 빈 Map', () => {
    expect(countTradesByRegime([]).size).toBe(0);
  });

  it('동일 레짐 5건 → 카운트 5', () => {
    const trades = Array.from({ length: 5 }, (_, i) => makeTrade(`t${i}`, 'EXPANSION'));
    const counts = countTradesByRegime(trades);
    expect(counts.get('EXPANSION')).toBe(5);
    expect(counts.size).toBe(1);
  });

  it('다중 레짐 분포 — 각 레짐별 카운트', () => {
    const trades = [
      ...Array.from({ length: 3 }, (_, i) => makeTrade(`a${i}`, 'EXPANSION')),
      ...Array.from({ length: 2 }, (_, i) => makeTrade(`b${i}`, 'CRISIS')),
    ];
    const counts = countTradesByRegime(trades);
    expect(counts.get('EXPANSION')).toBe(3);
    expect(counts.get('CRISIS')).toBe(2);
  });

  it('entryRegime 부재 → FALLBACK_REGIME (UNCERTAIN)', () => {
    const trade = makeTrade('t1', undefined);
    const counts = countTradesByRegime([trade]);
    expect(counts.get(FALLBACK_REGIME)).toBe(1);
  });

  it('알 수 없는 regime 값 → FALLBACK_REGIME', () => {
    const trade = makeTrade('t1', 'UNKNOWN_REGIME' as RegimeKey);
    const counts = countTradesByRegime([trade]);
    expect(counts.get(FALLBACK_REGIME)).toBe(1);
  });
});

// ─── evaluateConditionCoverage ────────────────────────────────────────────────

describe('evaluateConditionCoverage', () => {
  it('빈 trades → sufficient=false, maxCellCount=0', () => {
    const result = evaluateConditionCoverage([]);
    expect(result.sufficient).toBe(false);
    expect(result.maxCellCount).toBe(0);
  });

  it('단일 레짐 30건 정확 → sufficient=true (boundary)', () => {
    const trades = Array.from({ length: COVERAGE_THRESHOLD }, (_, i) =>
      makeTrade(`t${i}`, 'EXPANSION'),
    );
    const result = evaluateConditionCoverage(trades);
    expect(result.sufficient).toBe(true);
    expect(result.maxCellCount).toBe(30);
  });

  it('단일 레짐 29건 → sufficient=false (임계 미달)', () => {
    const trades = Array.from({ length: 29 }, (_, i) => makeTrade(`t${i}`, 'EXPANSION'));
    const result = evaluateConditionCoverage(trades);
    expect(result.sufficient).toBe(false);
    expect(result.maxCellCount).toBe(29);
  });

  it('다중 레짐 분산 — 모두 30 미만이면 sufficient=false', () => {
    const trades = [
      ...Array.from({ length: 20 }, (_, i) => makeTrade(`a${i}`, 'EXPANSION')),
      ...Array.from({ length: 25 }, (_, i) => makeTrade(`b${i}`, 'CRISIS')),
    ];
    const result = evaluateConditionCoverage(trades);
    expect(result.sufficient).toBe(false);
    expect(result.maxCellCount).toBe(25);
  });

  it('다중 레짐 — 한 셀이라도 30+ 이면 sufficient=true', () => {
    const trades = [
      ...Array.from({ length: 30 }, (_, i) => makeTrade(`a${i}`, 'EXPANSION')),
      ...Array.from({ length: 5 }, (_, i) => makeTrade(`b${i}`, 'CRISIS')),
    ];
    const result = evaluateConditionCoverage(trades);
    expect(result.sufficient).toBe(true);
    expect(result.maxCellCount).toBe(30);
  });

  it('LEARNING_COVERAGE_GATE_DISABLED=true → 항상 sufficient=true', () => {
    process.env.LEARNING_COVERAGE_GATE_DISABLED = 'true';
    const trades = Array.from({ length: 5 }, (_, i) => makeTrade(`t${i}`, 'EXPANSION'));
    const result = evaluateConditionCoverage(trades);
    expect(result.sufficient).toBe(true);
    expect(result.maxCellCount).toBe(5);
  });
});

// ─── buildCoverageMatrix ──────────────────────────────────────────────────────

describe('buildCoverageMatrix', () => {
  it('빈 trades → 모든 조건의 cells=0, sufficient=false', () => {
    const matrix = buildCoverageMatrix([], [1, 2, 3]);
    expect(matrix).toHaveLength(3);
    for (const m of matrix) {
      expect(m.maxCellCount).toBe(0);
      expect(m.sufficient).toBe(false);
    }
  });

  it('조건별 셀 분포 정확 — 7 레짐 모두 키 보존', () => {
    const trades = [
      ...Array.from({ length: 32 }, (_, i) => makeTrade(`a${i}`, 'EXPANSION', { 1: 8 })),
      ...Array.from({ length: 10 }, (_, i) => makeTrade(`b${i}`, 'CRISIS', { 1: 8, 2: 6 })),
    ];
    const matrix = buildCoverageMatrix(trades, [1, 2]);
    const cond1 = matrix.find(m => m.conditionId === 1)!;
    expect(cond1.cells.EXPANSION).toBe(32);
    expect(cond1.cells.CRISIS).toBe(10);
    expect(cond1.cells.RECOVERY).toBe(0);
    expect(cond1.maxCellCount).toBe(32);
    expect(cond1.sufficient).toBe(true);

    const cond2 = matrix.find(m => m.conditionId === 2)!;
    expect(cond2.cells.CRISIS).toBe(10); // 조건 2 만 트리거 (≥5점)
    expect(cond2.cells.EXPANSION).toBe(0);
    expect(cond2.maxCellCount).toBe(10);
    expect(cond2.sufficient).toBe(false);
  });

  it('conditionScoreThreshold 인자 사용 → 임계 미달 trade 자동 제외', () => {
    const trades = [
      makeTrade('a', 'EXPANSION', { 1: 4 }), // 임계 5 미달
      makeTrade('b', 'EXPANSION', { 1: 5 }), // 임계 통과
    ];
    const matrix = buildCoverageMatrix(trades, [1], 5);
    expect(matrix[0].cells.EXPANSION).toBe(1); // 4점 trade 제외
  });
});

// ─── 상수 검증 ────────────────────────────────────────────────────────────────

describe('LEARNING_COVERAGE_CONSTANTS', () => {
  it('사용자 원안 임계 30 + 7 레짐 보존', () => {
    expect(LEARNING_COVERAGE_CONSTANTS.COVERAGE_THRESHOLD).toBe(30);
    expect(LEARNING_COVERAGE_CONSTANTS.FALLBACK_REGIME).toBe('UNCERTAIN');
    expect(LEARNING_COVERAGE_CONSTANTS.REGIME_COUNT).toBe(7);
  });
});
