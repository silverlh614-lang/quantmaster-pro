import { describe, expect, it } from 'vitest';
import { evaluateFeedbackLoop, CALIBRATION_MIN_TRADES } from './quant/feedbackLoopEngine';
import type { TradeRecord } from '../types/portfolio';
import type { ConditionId } from '../types/quant';

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────

/** 단일 CLOSED 거래 레코드를 생성한다 */
function makeTrade(
  returnPct: number,
  conditionScores: Partial<Record<ConditionId, number>> = {},
): TradeRecord {
  const scores = {} as Record<ConditionId, number>;
  for (let i = 1; i <= 27; i++) scores[i as ConditionId] = conditionScores[i as ConditionId] ?? 0;
  return {
    id: `trade-${Math.random().toString(36).slice(2, 8)}`,
    stockCode: 'A000000',
    stockName: '테스트 종목',
    sector: 'IT',
    buyDate: new Date().toISOString(),
    buyPrice: 10000,
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
  };
}

/** N개의 거래를 생성하되, conditionId에 대해 지정 점수를 부여한다 */
function makeTrades(
  count: number,
  returnPct: number,
  conditionId: ConditionId,
  score: number,
): TradeRecord[] {
  return Array.from({ length: count }, () =>
    makeTrade(returnPct, { [conditionId]: score }),
  );
}

// ─── 캘리브레이션 활성화 임계값 검증 ─────────────────────────────────────────

describe('evaluateFeedbackLoop — 캘리브레이션 활성화', () => {
  it('거래 없음 → calibrationActive = false, 특별 메시지 반환', () => {
    const result = evaluateFeedbackLoop([]);
    expect(result.calibrationActive).toBe(false);
    expect(result.closedTradeCount).toBe(0);
    expect(result.summary).toContain('매매 기록 없음');
  });

  it(`${CALIBRATION_MIN_TRADES - 1}개 거래 → calibrationActive = false (임계값 미달)`, () => {
    const trades = Array.from({ length: CALIBRATION_MIN_TRADES - 1 }, () => makeTrade(5));
    const result = evaluateFeedbackLoop(trades);
    expect(result.calibrationActive).toBe(false);
    expect(result.calibrationProgress).toBeLessThan(1);
  });

  it(`${CALIBRATION_MIN_TRADES}개 거래 정확히 → calibrationActive = true`, () => {
    const trades = Array.from({ length: CALIBRATION_MIN_TRADES }, () => makeTrade(5));
    const result = evaluateFeedbackLoop(trades);
    expect(result.calibrationActive).toBe(true);
    expect(result.calibrationProgress).toBe(1);
  });

  it(`${CALIBRATION_MIN_TRADES + 10}개 거래 → calibrationActive = true (초과 허용)`, () => {
    const trades = Array.from({ length: CALIBRATION_MIN_TRADES + 10 }, () => makeTrade(5));
    const result = evaluateFeedbackLoop(trades);
    expect(result.calibrationActive).toBe(true);
    expect(result.closedTradeCount).toBe(CALIBRATION_MIN_TRADES + 10);
  });

  it('calibrationProgress = closedTradeCount / 30 (진행률)', () => {
    const trades = Array.from({ length: 15 }, () => makeTrade(5));
    const result = evaluateFeedbackLoop(trades);
    expect(result.calibrationProgress).toBeCloseTo(15 / CALIBRATION_MIN_TRADES, 5);
  });
});

// ─── 가중치 상향 조정 — 승률 > 60% ──────────────────────────────────────────

describe('evaluateFeedbackLoop — 가중치 상향 (승률 > 60%)', () => {
  it('조건 1의 승률이 100%이면 가중치 +10% (1.0 → 1.1)', () => {
    // 조건 1에 점수 8을 부여한 거래 10개 (모두 승리: +5%)
    const trades = makeTrades(10, 5, 1 as ConditionId, 8);
    // 나머지 19개는 조건 1 점수 없음
    const filler = Array.from({ length: CALIBRATION_MIN_TRADES - 10 }, () => makeTrade(5));
    const result = evaluateFeedbackLoop([...trades, ...filler], { 1: 1.0 });
    const cal = result.calibrations.find(c => c.conditionId === 1);
    expect(cal).toBeDefined();
    expect(cal!.direction).toBe('UP');
    expect(cal!.newWeight).toBeCloseTo(1.1, 5);
  });

  it('가중치 최대값 1.5 초과 금지', () => {
    const trades = makeTrades(10, 5, 1 as ConditionId, 8);
    const filler = Array.from({ length: CALIBRATION_MIN_TRADES - 10 }, () => makeTrade(5));
    // 이미 1.5에 근접한 가중치
    const result = evaluateFeedbackLoop([...trades, ...filler], { 1: 1.5 });
    const cal = result.calibrations.find(c => c.conditionId === 1);
    if (cal) {
      expect(cal.newWeight).toBeLessThanOrEqual(1.5);
    }
  });
});

// ─── 가중치 하향 조정 — 승률 < 40% ──────────────────────────────────────────

describe('evaluateFeedbackLoop — 가중치 하향 (승률 < 40%)', () => {
  it('조건 2의 승률이 0%이면 가중치 -10% (1.0 → 0.9)', () => {
    // 조건 2에 점수 8 부여 + 모두 손실(-5%)
    const trades = makeTrades(10, -5, 2 as ConditionId, 8);
    const filler = Array.from({ length: CALIBRATION_MIN_TRADES - 10 }, () => makeTrade(5));
    const result = evaluateFeedbackLoop([...trades, ...filler], { 2: 1.0 });
    const cal = result.calibrations.find(c => c.conditionId === 2);
    expect(cal).toBeDefined();
    expect(cal!.direction).toBe('DOWN');
    expect(cal!.newWeight).toBeCloseTo(0.9, 5);
  });

  it('가중치 최소값 0.5 미만 금지', () => {
    const trades = makeTrades(10, -5, 2 as ConditionId, 8);
    const filler = Array.from({ length: CALIBRATION_MIN_TRADES - 10 }, () => makeTrade(5));
    const result = evaluateFeedbackLoop([...trades, ...filler], { 2: 0.5 });
    const cal = result.calibrations.find(c => c.conditionId === 2);
    if (cal) {
      expect(cal.newWeight).toBeGreaterThanOrEqual(0.5);
    }
  });
});

// ─── 가중치 안정 — 승률 40%~60% ─────────────────────────────────────────────

describe('evaluateFeedbackLoop — 가중치 안정 (승률 40%~60%)', () => {
  it('승률 50% → direction = STABLE, delta = 0', () => {
    const condId = 3 as ConditionId;
    // 5승 + 5패 (승률 50%)
    const winTrades  = makeTrades(5, 5,  condId, 8);
    const loseTrades = makeTrades(5, -5, condId, 8);
    const filler = Array.from({ length: CALIBRATION_MIN_TRADES - 10 }, () => makeTrade(5));
    const result = evaluateFeedbackLoop([...winTrades, ...loseTrades, ...filler], { [condId]: 1.0 });
    const cal = result.calibrations.find(c => c.conditionId === condId);
    expect(cal).toBeDefined();
    expect(cal!.direction).toBe('STABLE');
    expect(cal!.delta).toBe(0);
    expect(cal!.newWeight).toBe(1.0);
  });
});

// ─── 조건별 최소 거래 수 미달 시 제외 ────────────────────────────────────────

describe('evaluateFeedbackLoop — 최소 조건 거래 수 (5건 미달 제외)', () => {
  it('특정 조건에 4건 미만 데이터 → 해당 조건 calibrations 미포함', () => {
    const condId = 5 as ConditionId;
    // 조건 5에 4건만 부여 (임계값 5 미달)
    const trades = makeTrades(4, 5, condId, 8);
    const filler = Array.from({ length: CALIBRATION_MIN_TRADES - 4 }, () => makeTrade(5));
    const result = evaluateFeedbackLoop([...trades, ...filler]);
    const cal = result.calibrations.find(c => c.conditionId === condId);
    expect(cal).toBeUndefined();
  });

  it('특정 조건에 5건 이상 데이터 → 해당 조건 calibrations 포함', () => {
    const condId = 5 as ConditionId;
    const trades = makeTrades(5, 5, condId, 8);
    const filler = Array.from({ length: CALIBRATION_MIN_TRADES - 5 }, () => makeTrade(5));
    const result = evaluateFeedbackLoop([...trades, ...filler]);
    const cal = result.calibrations.find(c => c.conditionId === condId);
    expect(cal).toBeDefined();
  });

  it('조건 점수 5 미만 거래는 해당 조건 집계에서 제외', () => {
    const condId = 6 as ConditionId;
    // 점수 4 (임계값 5 미만) → 집계 제외
    const trades = makeTrades(10, 5, condId, 4);
    const filler = Array.from({ length: CALIBRATION_MIN_TRADES - 10 }, () => makeTrade(5));
    const result = evaluateFeedbackLoop([...trades, ...filler]);
    const cal = result.calibrations.find(c => c.conditionId === condId);
    expect(cal).toBeUndefined();
  });
});

// ─── 반환값 구조 완전성 검증 ─────────────────────────────────────────────────

describe('evaluateFeedbackLoop — 반환값 구조', () => {
  it('캘리브레이션 전: 필수 필드 모두 반환', () => {
    const result = evaluateFeedbackLoop([]);
    expect(result.closedTradeCount).toBeDefined();
    expect(result.calibrationActive).toBeDefined();
    expect(result.calibrationProgress).toBeDefined();
    expect(result.calibrations).toBeDefined();
    expect(result.boostedCount).toBeDefined();
    expect(result.reducedCount).toBeDefined();
    expect(result.lastCalibratedAt).toBeDefined();
    expect(result.summary).toBeDefined();
  });

  it('캘리브레이션 후: lastCalibratedAt이 ISO 8601 형식', () => {
    const trades = Array.from({ length: CALIBRATION_MIN_TRADES }, () => makeTrade(5));
    const result = evaluateFeedbackLoop(trades);
    expect(result.lastCalibratedAt).not.toBeNull();
    expect(result.lastCalibratedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('캘리브레이션 전: lastCalibratedAt = null', () => {
    const result = evaluateFeedbackLoop([]);
    expect(result.lastCalibratedAt).toBeNull();
  });

  it('boostedCount + reducedCount ≤ calibrations.length', () => {
    const condId = 7 as ConditionId;
    const wins  = makeTrades(8, 5, condId, 8);
    const filler = Array.from({ length: CALIBRATION_MIN_TRADES - 8 }, () => makeTrade(5));
    const result = evaluateFeedbackLoop([...wins, ...filler]);
    expect(result.boostedCount + result.reducedCount).toBeLessThanOrEqual(result.calibrations.length);
  });

  it('summary 문자열에 거래 건수가 포함됨 (캘리브레이션 활성 후)', () => {
    const trades = Array.from({ length: CALIBRATION_MIN_TRADES }, () => makeTrade(5));
    const result = evaluateFeedbackLoop(trades);
    expect(result.summary).toContain(`${CALIBRATION_MIN_TRADES}`);
  });
});
