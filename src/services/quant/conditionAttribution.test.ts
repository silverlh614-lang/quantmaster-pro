/**
 * @responsibility conditionAttribution 회귀 테스트 (ADR-0026 PR-I)
 */
import { describe, it, expect } from 'vitest';
import {
  classifyConditionAttribution,
  classifyAllConditions,
  ATTRIBUTION_MIN_GROUP,
} from './conditionAttribution';
import type { TradeRecord } from '../../types/portfolio';
import type { ConditionId } from '../../types/core';

function makeTrade(returnPct: number, conditionId: ConditionId, score: number): TradeRecord {
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
    gate1Score: 5, gate2Score: 5, gate3Score: 5, finalScore: 150,
    conditionScores: scores,
    followedSystem: true,
    returnPct,
    status: 'CLOSED',
  };
}

describe('classifyConditionAttribution — 4 분류', () => {
  it('ALPHA_DRIVER — 승리에서 평균 8 / 패배에서 평균 3 → spread +5', () => {
    const wins = Array.from({ length: 10 }, () => makeTrade(5, 25, 8));
    const losses = Array.from({ length: 10 }, () => makeTrade(-5, 25, 3));
    const r = classifyConditionAttribution(25 as ConditionId, [...wins, ...losses]);
    expect(r.classification).toBe('ALPHA_DRIVER');
    expect(r.winAvgScore).toBe(8);
    expect(r.lossAvgScore).toBe(3);
    expect(r.spread).toBe(5);
    expect(r.reliable).toBe(true);
  });

  it('FALSE_COMFORT — 패배에서 평균 7 / 승리에서 평균 4 → spread -3', () => {
    const wins = Array.from({ length: 10 }, () => makeTrade(5, 10, 4));
    const losses = Array.from({ length: 10 }, () => makeTrade(-5, 10, 7));
    const r = classifyConditionAttribution(10 as ConditionId, [...wins, ...losses]);
    expect(r.classification).toBe('FALSE_COMFORT');
    expect(r.spread).toBe(-3);
  });

  it('RISK_PROTECTOR — 양쪽 모두 평균 < 3 (낮은 점수)', () => {
    const wins = Array.from({ length: 10 }, () => makeTrade(5, 17, 2));
    const losses = Array.from({ length: 10 }, () => makeTrade(-5, 17, 1));
    const r = classifyConditionAttribution(17 as ConditionId, [...wins, ...losses]);
    expect(r.classification).toBe('RISK_PROTECTOR');
  });

  it('NOISE_FACTOR — 양쪽 평균 비슷 (5/4 → spread 1)', () => {
    const wins = Array.from({ length: 10 }, () => makeTrade(5, 19, 5));
    const losses = Array.from({ length: 10 }, () => makeTrade(-5, 19, 4));
    const r = classifyConditionAttribution(19 as ConditionId, [...wins, ...losses]);
    expect(r.classification).toBe('NOISE_FACTOR');
  });

  it('표본 부족 (각 그룹 < 5) → reliable=false', () => {
    const wins = Array.from({ length: 3 }, () => makeTrade(5, 25, 8));
    const losses = Array.from({ length: 3 }, () => makeTrade(-5, 25, 3));
    const r = classifyConditionAttribution(25 as ConditionId, [...wins, ...losses]);
    expect(r.reliable).toBe(false);
    // 분류는 가능하지만 reliable=false 표시
    expect(r.classification).toBe('ALPHA_DRIVER');
  });

  it('모든 거래 수익 → losses 0, lossAvgScore=0 → 결과 일관', () => {
    const wins = Array.from({ length: 10 }, () => makeTrade(5, 25, 8));
    const r = classifyConditionAttribution(25 as ConditionId, wins);
    expect(r.lossAvgScore).toBe(0);
    expect(r.winAvgScore).toBe(8);
    expect(r.classification).toBe('ALPHA_DRIVER');
    expect(r.reliable).toBe(false); // losses 0 → 표본 부족
  });

  it('빈 거래 → spread=0, 양쪽 0 → RISK_PROTECTOR (모두 < 3)', () => {
    const r = classifyConditionAttribution(1 as ConditionId, []);
    expect(r.classification).toBe('RISK_PROTECTOR');
    expect(r.winCount).toBe(0);
    expect(r.lossCount).toBe(0);
    expect(r.reliable).toBe(false);
  });
});

describe('classifyAllConditions', () => {
  it('27조건 분류 + 그룹핑', () => {
    // 조건 25 → ALPHA_DRIVER, 조건 10 → FALSE_COMFORT, 나머지 0/0 → RISK_PROTECTOR or NOISE
    const wins = Array.from({ length: 10 }, () => {
      const t = makeTrade(5, 25, 8);
      t.conditionScores[10 as ConditionId] = 4;
      return t;
    });
    const losses = Array.from({ length: 10 }, () => {
      const t = makeTrade(-5, 25, 3);
      t.conditionScores[10 as ConditionId] = 7;
      return t;
    });
    const result = classifyAllConditions([...wins, ...losses]);
    expect(result.alphaDrivers.find(a => a.conditionId === 25)).toBeDefined();
    expect(result.falseComforts.find(a => a.conditionId === 10)).toBeDefined();
    // 나머지 25개 조건은 양쪽 모두 0 → RISK_PROTECTOR
    expect(result.riskProtectors.length).toBe(25);
    expect(result.reliableCount).toBeGreaterThanOrEqual(2);
  });
});
