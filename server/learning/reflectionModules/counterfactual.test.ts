/**
 * counterfactual.test.ts — Counterfactual Simulator (#3) 검증.
 */

import { describe, it, expect } from 'vitest';
import { computeCounterfactual } from './counterfactual.js';

function trade(overrides: any): any {
  return {
    id: 't1', stockCode: '005930', stockName: '삼성전자',
    signalTime: '2026-04-20T01:00:00Z',
    signalPrice: 70_000, shadowEntryPrice: 70_000, quantity: 10,
    stopLoss: 66_000, targetPrice: 77_000,
    status: 'HIT_STOP', exitPrice: 65_500, exitTime: '2026-04-20T06:00:00Z',
    returnPct: -6.43, ...overrides,
  };
}

describe('computeCounterfactual', () => {
  it('Late Stop — exitPrice < stopLoss 이면 (stop - exit)*qty 합산', async () => {
    const t1 = trade({ stopLoss: 66_000, exitPrice: 65_500, quantity: 10 }); // slip 5,000
    const t2 = trade({ id: 't2', stopLoss: 50_000, exitPrice: 49_200, quantity: 5 }); // slip 4,000
    const res = await computeCounterfactual({
      closedToday: [t1, t2],
      missedSignalCodes: [],
    });
    expect(res.lateStopKrw).toBe(9_000);
    expect(res.sampleCount).toBe(2);
  });

  it('Late Stop — exitPrice ≥ stopLoss 이면 0 (지연 손실 없음)', async () => {
    const t = trade({ status: 'HIT_STOP', stopLoss: 66_000, exitPrice: 66_200 });
    const res = await computeCounterfactual({ closedToday: [t], missedSignalCodes: [] });
    expect(res.lateStopKrw).toBe(0);
    expect(res.sampleCount).toBe(0);
  });

  it('Early Exit — eodPriceFor 주입 시 추가 상승분 KRW 합산', async () => {
    const win = trade({ id: 'w1', status: 'HIT_TARGET', exitPrice: 77_000, quantity: 10 });
    const res = await computeCounterfactual({
      closedToday: [win],
      missedSignalCodes: [],
      eodPriceFor: async () => 78_500,
    });
    expect(res.earlyExitKrw).toBe(15_000);
    expect(res.sampleCount).toBe(1);
  });

  it('Miss — eodPriceFor 없으면 sampleCount 만 증가', async () => {
    const res = await computeCounterfactual({
      closedToday: [],
      missedSignalCodes: ['005930', '005380'],
    });
    expect(res.missedOpportunityKrw).toBe(0);
    expect(res.sampleCount).toBe(2);
  });

  it('여러 트레이드 혼합 — 각 축 독립 집계', async () => {
    const loss = trade({ status: 'HIT_STOP', stopLoss: 60_000, exitPrice: 58_000, quantity: 10 }); // slip 20,000
    const win = trade({ id: 'w', status: 'HIT_TARGET', exitPrice: 75_000, quantity: 5 });
    const res = await computeCounterfactual({
      closedToday: [loss, win],
      missedSignalCodes: ['000660'],
      eodPriceFor: async (code) => code === win.stockCode ? 76_000 : null,
    });
    expect(res.lateStopKrw).toBe(20_000);
    expect(res.earlyExitKrw).toBe(5_000);
    expect(res.sampleCount).toBe(3); // 1 late + 1 early + 1 miss
  });
});
