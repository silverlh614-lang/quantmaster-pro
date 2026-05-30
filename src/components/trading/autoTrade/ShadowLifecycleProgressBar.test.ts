// @responsibility ShadowLifecycleProgressBar 순수 aggregator/health 회귀 (Phase F)
import { describe, it, expect } from 'vitest';
import {
  aggregateLifecycleStages,
  deriveLifecycleHealth,
} from './ShadowLifecycleProgressBar';
import type { ServerShadowTrade } from '../../../api';

const HOUR = 60 * 60 * 1000;
const WINDOW = 24 * HOUR;

function nowMinus(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

function trade(overrides: Partial<ServerShadowTrade>): ServerShadowTrade {
  return {
    stockCode: '005930',
    stockName: '삼성전자',
    status: 'PENDING',
    signalTime: nowMinus(1 * HOUR),
    ...overrides,
  };
}

describe('aggregateLifecycleStages', () => {
  it('빈 입력 — 모든 단계 0', () => {
    const stages = aggregateLifecycleStages([], WINDOW);
    expect(stages.map((s) => s.count)).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('null/undefined 입력 안전 처리', () => {
    expect(aggregateLifecycleStages(null, WINDOW).every((s) => s.count === 0)).toBe(true);
    expect(aggregateLifecycleStages(undefined, WINDOW).every((s) => s.count === 0)).toBe(true);
  });

  it('윈도우 밖 신호는 카운트 안 함', () => {
    const stages = aggregateLifecycleStages([
      trade({ signalTime: nowMinus(48 * HOUR) }),
    ], WINDOW);
    expect(stages[0].count).toBe(0);
  });

  it('PENDING 신호만 — BUY_SIGNAL 1건', () => {
    const stages = aggregateLifecycleStages([trade({})], WINDOW);
    expect(stages[0].count).toBe(1); // BUY_SIGNAL
    expect(stages[1].count).toBe(0); // PAPER_FILLED
  });

  it('BUY fill 있음 — PAPER_FILLED + POSITION_OPENED', () => {
    const stages = aggregateLifecycleStages([
      trade({
        status: 'ACTIVE',
        fills: [{ type: 'BUY', qty: 10, timestamp: nowMinus(30 * 60 * 1000) }],
      }),
    ], WINDOW);
    expect(stages[1].count).toBe(1);
    expect(stages[2].count).toBe(1);
  });

  it('전체 생애주기 완료 — 6단계 모두 1', () => {
    const stages = aggregateLifecycleStages([
      trade({
        status: 'HIT_TARGET',
        fills: [
          { type: 'BUY', qty: 10, timestamp: nowMinus(3 * HOUR) },
          { type: 'SELL', qty: 10, timestamp: nowMinus(1 * HOUR) },
        ],
        exitTime: nowMinus(1 * HOUR),
        resolvedAt: nowMinus(30 * 60 * 1000),
        returnPct: 3.2,
      }),
    ], WINDOW);
    expect(stages.map((s) => s.count)).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it('exitTime 윈도우 밖 — CLOSED 카운트 안 됨', () => {
    const stages = aggregateLifecycleStages([
      trade({
        signalTime: nowMinus(2 * HOUR),
        status: 'HIT_STOP',
        exitTime: nowMinus(48 * HOUR),
      }),
    ], WINDOW);
    expect(stages[4].count).toBe(0); // CLOSED
  });
});

describe('deriveLifecycleHealth', () => {
  const stage = (counts: number[]) =>
    ['BUY_SIGNAL', 'PAPER_FILLED', 'POSITION_OPENED', 'SELL_SIGNAL', 'CLOSED', 'OUTCOME_RECORDED']
      .map((code, i) => ({ code: code as any, label: code, count: counts[i] }));

  it('total=0 → IDLE', () => {
    const r = deriveLifecycleHealth(stage([0, 0, 0, 0, 0, 0]));
    expect(r.health).toBe('IDLE');
  });

  it('signal>0 + filled=0 → ATTENTION (paper fill stall)', () => {
    const r = deriveLifecycleHealth(stage([3, 0, 0, 0, 0, 0]));
    expect(r.health).toBe('ATTENTION');
    expect(r.reason).toMatch(/가상 체결/);
  });

  it('closed>0 + outcome=0 → ATTENTION (outcome 영속 누락)', () => {
    const r = deriveLifecycleHealth(stage([2, 2, 2, 2, 2, 0]));
    expect(r.health).toBe('ATTENTION');
    expect(r.reason).toMatch(/결과 기록/);
  });

  it('sell>0 + closed=0 → ATTENTION (체결 지연)', () => {
    const r = deriveLifecycleHealth(stage([1, 1, 1, 1, 0, 0]));
    expect(r.health).toBe('ATTENTION');
    expect(r.reason).toMatch(/청산 완료/);
  });

  it('모든 단계 흐름 → HEALTHY', () => {
    const r = deriveLifecycleHealth(stage([3, 3, 3, 3, 3, 3]));
    expect(r.health).toBe('HEALTHY');
  });
});
