/**
 * @responsibility computeConditionEdge 회귀 테스트 (ADR-0023 PR-F)
 */
import { describe, it, expect } from 'vitest';
import { computeConditionEdge } from './conditionEdgeScore';
import type { TradeRecord, LossReason } from '../../types/portfolio';
import type { ConditionId } from '../../types/core';

function makeTrade(returnPct: number, lossReason?: LossReason): TradeRecord {
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
    conditionScores: {} as Record<ConditionId, number>,
    followedSystem: true,
    status: 'CLOSED',
    returnPct,
    ...(returnPct < 0 && lossReason ? { lossReason } : {}),
  };
}

describe('computeConditionEdge', () => {
  it('빈 입력 → profitFactor null + edgeScore = -2 (winRate 0)', () => {
    const stats = computeConditionEdge([], 0, 0);
    expect(stats.profitFactor).toBeNull();
    expect(stats.avgReturnPosi).toBe(0);
    expect(stats.avgReturnNeg).toBe(0);
    // (0-0.5)*4 = -2 + 0 + 0 - 0 = -2
    expect(stats.edgeScore).toBe(-2);
  });

  it('전부 승리 → profitFactor null (loss=0) + edgeScore 양수', () => {
    const trades = Array.from({ length: 10 }, () => makeTrade(5));
    const stats = computeConditionEdge(trades, 1.0, 5);
    expect(stats.profitFactor).toBeNull(); // loss 0
    expect(stats.avgReturnPosi).toBeCloseTo(5, 2);
    expect(stats.avgReturnNeg).toBe(0);
    // (1.0-0.5)*4=+2 + clamp(5)*0.4=+2 + (1-1)*1=0 - 0 = +4
    expect(stats.edgeScore).toBe(4);
  });

  it('Profit Factor — 좋은 손익비 (10승 +10% / 5패 -2%)', () => {
    const wins = Array.from({ length: 10 }, () => makeTrade(10));
    const losses = Array.from({ length: 5 }, () => makeTrade(-2));
    const winRate = 10 / 15;
    const avgReturn = (10 * 10 + 5 * -2) / 15;
    const stats = computeConditionEdge([...wins, ...losses], winRate, avgReturn);
    // weightedWinReturn = 100, weightedLossReturn = 10 → PF = 10
    expect(stats.profitFactor).toBe(10);
    expect(stats.avgReturnPosi).toBe(10);
    expect(stats.avgReturnNeg).toBe(-2);
  });

  it('Profit Factor — 나쁜 손익비 (10승 +2% / 5패 -10%)', () => {
    const wins = Array.from({ length: 10 }, () => makeTrade(2));
    const losses = Array.from({ length: 5 }, () => makeTrade(-10));
    const winRate = 10 / 15;
    const avgReturn = (10 * 2 + 5 * -10) / 15;
    const stats = computeConditionEdge([...wins, ...losses], winRate, avgReturn);
    // weightedWinReturn = 20, weightedLossReturn = 50 → PF = 0.4
    expect(stats.profitFactor).toBe(0.4);
    expect(stats.avgReturnPosi).toBe(2);
    expect(stats.avgReturnNeg).toBe(-10);
  });

  it('Edge Score — 같은 승률 (66.6%) 이라도 PF 다르면 점수 차이 큼', () => {
    const goodTrades = [
      ...Array.from({ length: 10 }, () => makeTrade(10)),
      ...Array.from({ length: 5 }, () => makeTrade(-2)),
    ];
    const badTrades = [
      ...Array.from({ length: 10 }, () => makeTrade(2)),
      ...Array.from({ length: 5 }, () => makeTrade(-10)),
    ];
    const goodWr = 10 / 15;
    const goodAvg = (10 * 10 + 5 * -2) / 15;
    const badAvg = (10 * 2 + 5 * -10) / 15;
    const good = computeConditionEdge(goodTrades, goodWr, goodAvg);
    const bad = computeConditionEdge(badTrades, goodWr, badAvg);
    expect(good.edgeScore).toBeGreaterThan(bad.edgeScore);
  });

  it('lossReason multiplier (PR-E) 가 PF 계산에 적용됨', () => {
    // 5 패가 STOP_TOO_TIGHT (multiplier 0.3) → loss 영향력 30% 만 반영
    const wins = Array.from({ length: 10 }, () => makeTrade(5));
    const losses = Array.from({ length: 5 }, () => makeTrade(-5, 'STOP_TOO_TIGHT'));
    const stats = computeConditionEdge([...wins, ...losses], 0.667, 1.67);
    // weightedWinReturn = 50, weightedLossReturn = 5 × 0.3 × 5 = 7.5
    // PF = 50/7.5 ≈ 6.667 (lossReason 적용 전 50/25=2 와 큰 차이)
    expect(stats.profitFactor).toBeCloseTo(50 / 7.5, 2);
  });

  it('NaN/Infinity returnPct → 분류에서 자동 스킵', () => {
    const trades = [
      makeTrade(5),
      { ...makeTrade(0), returnPct: NaN } as TradeRecord,
      makeTrade(-5),
    ];
    const stats = computeConditionEdge(trades, 0.5, 0);
    // NaN 거래 스킵 → 1승 +5% / 1패 -5%
    expect(stats.profitFactor).toBe(1);
  });

  it('Edge Score 극단 케이스 (100% 손실 + 큰 손실 + PF=0)', () => {
    // 극단: 모두 -15% 손실 → PF = 0 (winSum=0/lossSum=150)
    // (0-0.5)*4 = -2 + clamp(-15,-5,5)*0.4 = -2 + (0-1)*1 = -1 - clamp(15,0,15)*0.2 = -3
    // = -2 + -2 + -1 + -3 = -8
    const trades = Array.from({ length: 10 }, () => makeTrade(-15));
    const stats = computeConditionEdge(trades, 0, -15);
    expect(stats.edgeScore).toBe(-8);
    expect(stats.profitFactor).toBe(0); // null 아님 — winSum=0
  });
});
