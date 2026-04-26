/**
 * @responsibility learningShadowModel 회귀 테스트 (ADR-0027 PR-J)
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { compareShadowVsLive, isPromotable } from './learningShadowModel';
import { evaluateFeedbackLoop, CALIBRATION_MIN_TRADES } from './feedbackLoopEngine';
import type { TradeRecord } from '../../types/portfolio';
import type { ConditionId } from '../../types/core';

// localStorage mock — node env 에서 saveEvolutionWeights 가 안전하게 no-op 되도록.
beforeAll(() => {
  if (typeof globalThis.window === 'undefined') {
    const store = new Map<string, string>();
    const mockLs = {
      getItem: (k: string): string | null => store.get(k) ?? null,
      setItem: (k: string, v: string): void => { store.set(k, v); },
      removeItem: (k: string): void => { store.delete(k); },
      clear: (): void => { store.clear(); },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).window = { localStorage: mockLs };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).localStorage = mockLs;
  }
});

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
    schemaVersion: 2,
  };
}

describe('evaluateFeedbackLoop — shadow option', () => {
  it('shadow=true → localStorage 저장 안 함 (LIVE 무영향)', () => {
    if (typeof globalThis.localStorage !== 'undefined') {
      globalThis.localStorage.clear();
    }
    const trades = Array.from({ length: CALIBRATION_MIN_TRADES }, () => makeTrade(5, 25, 8));
    const result = evaluateFeedbackLoop(trades, { 25: 1.0 }, { shadow: true });
    expect(result.calibrationActive).toBe(true);
    expect(result.calibrations.length).toBeGreaterThan(0);
    // localStorage 에 evolution-weights 저장 안 됨
    if (typeof globalThis.localStorage !== 'undefined') {
      expect(globalThis.localStorage.getItem('k-stock-evolution-weights')).toBeNull();
    }
  });

  it('options 없으면 기본 LIVE (저장 동작) — shadow 가 default false', () => {
    if (typeof globalThis.localStorage !== 'undefined') {
      globalThis.localStorage.clear();
    }
    const trades = Array.from({ length: CALIBRATION_MIN_TRADES }, () => makeTrade(5, 25, 8));
    evaluateFeedbackLoop(trades, { 25: 1.0 });
    if (typeof globalThis.localStorage !== 'undefined') {
      expect(globalThis.localStorage.getItem('k-stock-evolution-weights')).not.toBeNull();
    }
  });

  it('weightStep override — 0.20 → 가중치 변화 2배', () => {
    const trades = Array.from({ length: CALIBRATION_MIN_TRADES }, () => makeTrade(5, 25, 8));
    const r = evaluateFeedbackLoop(trades, { 25: 1.0 }, { shadow: true, weightStep: 0.20 });
    const cal = r.calibrations.find(c => c.conditionId === 25);
    // COMPUTED 25 → multiplier 1.0 → 0.20 그대로
    expect(cal!.newWeight).toBeCloseTo(1.20, 2);
  });

  it('upThreshold override — 0.50 으로 낮추면 50% 승률도 UP', () => {
    const wins = Array.from({ length: 16 }, () => makeTrade(5, 25, 8));
    const losses = Array.from({ length: 14 }, () => makeTrade(-5, 25, 8));
    // 16/30 = 53.3% → 0.50 임계 초과 → UP
    const r = evaluateFeedbackLoop([...wins, ...losses], { 25: 1.0 }, {
      shadow: true,
      upThreshold: 0.50,
    });
    const cal = r.calibrations.find(c => c.conditionId === 25);
    expect(cal!.direction).toBe('UP');
  });
});

describe('compareShadowVsLive', () => {
  it('동일 옵션 → shadowConfidence = 1.0 (완전 일치)', () => {
    const trades = Array.from({ length: CALIBRATION_MIN_TRADES }, () => makeTrade(5, 25, 8));
    const cmp = compareShadowVsLive(trades, { 25: 1.0 });
    expect(cmp.shadowConfidence).toBe(1.0);
    expect(cmp.avgWeightDelta).toBe(0);
    expect(cmp.divergence.every(d => d.agreement === 'AGREE')).toBe(true);
  });

  it('weightStep override → 가중치 차이 발생 (방향은 일치)', () => {
    const trades = Array.from({ length: CALIBRATION_MIN_TRADES }, () => makeTrade(5, 25, 8));
    const cmp = compareShadowVsLive(trades, { 25: 1.0 }, { weightStep: 0.20 });
    // 같은 방향 (UP) 이지만 가중치 다름 — 1.10 vs 1.20
    const cal25 = cmp.divergence.find(d => d.conditionId === 25);
    expect(cal25?.liveWeight).toBeCloseTo(1.10, 2);
    expect(cal25?.shadowWeight).toBeCloseTo(1.20, 2);
    expect(cal25?.agreement).toBe('AGREE');
    expect(cmp.shadowConfidence).toBe(1.0);
    expect(cmp.avgWeightDelta).toBeCloseTo(0.10, 2);
  });

  it('threshold 변경으로 direction 차이 발생 → DISAGREE', () => {
    const wins = Array.from({ length: 16 }, () => makeTrade(5, 25, 8));
    const losses = Array.from({ length: 14 }, () => makeTrade(-5, 25, 8));
    // LIVE: 53.3% → STABLE / Shadow upThreshold=0.50 → UP
    const cmp = compareShadowVsLive([...wins, ...losses], { 25: 1.0 }, { upThreshold: 0.50 });
    const cal25 = cmp.divergence.find(d => d.conditionId === 25);
    expect(cal25?.liveDirection).toBe('STABLE');
    expect(cal25?.shadowDirection).toBe('UP');
    expect(cal25?.agreement).toBe('DISAGREE');
    expect(cmp.shadowConfidence).toBeLessThan(1.0);
  });
});

describe('isPromotable', () => {
  it('동일 결과 (confidence=1.0, delta=0, ≥5 conditions) → 미충족 (조건 1개라 표본 부족)', () => {
    const trades = Array.from({ length: CALIBRATION_MIN_TRADES }, () => makeTrade(5, 25, 8));
    const cmp = compareShadowVsLive(trades, { 25: 1.0 });
    // divergence.length = 1 (조건 25 만 활성화), 5 미만 → not promotable
    expect(isPromotable(cmp)).toBe(false);
  });

  it('5개 조건 + 일치 → promotable', () => {
    const trades: TradeRecord[] = [];
    // 5 conditionId 활성화
    for (const id of [1, 2, 3, 4, 5] as ConditionId[]) {
      for (let i = 0; i < 6; i++) {
        trades.push(makeTrade(5, id, 8));
      }
    }
    const cmp = compareShadowVsLive(trades, {});
    expect(cmp.divergence.length).toBeGreaterThanOrEqual(5);
    expect(cmp.shadowConfidence).toBe(1.0);
    expect(cmp.avgWeightDelta).toBe(0);
    expect(isPromotable(cmp)).toBe(true);
  });

  it('큰 weightStep 차이 → avgDelta > 0.05 → not promotable', () => {
    const trades: TradeRecord[] = [];
    for (const id of [1, 2, 3, 4, 5] as ConditionId[]) {
      for (let i = 0; i < 6; i++) trades.push(makeTrade(5, id, 8));
    }
    const cmp = compareShadowVsLive(trades, {}, { weightStep: 0.20 });
    expect(cmp.avgWeightDelta).toBeGreaterThan(0.05);
    expect(isPromotable(cmp)).toBe(false);
  });
});
