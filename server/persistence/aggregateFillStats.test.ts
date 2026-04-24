/**
 * @responsibility aggregateFillStats 기간별 fill 집계 회귀 테스트
 *
 * PR-18: 주간/월간/전체 리포트·학습 모듈이 공통으로 쓰는 fill-level 집계 헬퍼가
 * 범위 필터링, 부분매도·전량청산 구분, REVERTED 제외, PROVISIONAL 게이팅을 정확히
 * 처리함을 보장한다.
 */

import { describe, it, expect } from 'vitest';
import { aggregateFillStats } from './shadowTradeRepo.js';
import type { ServerShadowTrade, PositionFill } from './shadowTradeRepo.js';

const T0 = '2026-04-20T05:00:00.000Z'; // out of 주간 range
const T1 = '2026-04-23T05:00:00.000Z'; // 주간 range 안
const T2 = '2026-04-24T05:00:00.000Z';
const WEEK_FROM = '2026-04-22T00:00:00.000Z';
const WEEK_TO   = '2026-04-25T00:00:00.000Z';

function trade(overrides: Partial<ServerShadowTrade> & { id: string; fills: PositionFill[] }): ServerShadowTrade {
  return {
    stockCode: overrides.id,
    stockName: `종목${overrides.id}`,
    signalTime: T0,
    signalPrice: 10_000,
    shadowEntryPrice: 10_000,
    quantity: 10,
    stopLoss: 9_500,
    targetPrice: 11_000,
    status: 'ACTIVE',
    ...overrides,
  };
}

function sell(o: { id: string; qty: number; pnl: number; pnlPct: number; ts: string; status?: PositionFill['status'] }): PositionFill {
  return {
    id: o.id,
    type: 'SELL',
    subType: 'PARTIAL_TP',
    qty: o.qty,
    price: 10_000 + o.pnl / o.qty,
    pnl: o.pnl,
    pnlPct: o.pnlPct,
    reason: 'test',
    timestamp: o.ts,
    status: o.status ?? 'CONFIRMED',
    confirmedAt: o.status && o.status !== 'CONFIRMED' ? undefined : o.ts,
  };
}

describe('aggregateFillStats', () => {
  it('기본: 전량 청산 + 부분매도 혼재에서 win/loss/partial 구분', () => {
    const trades = [
      // 전량 손절 trade (이번 주 범위 안)
      trade({
        id: 'FULL_STOP',
        status: 'HIT_STOP',
        fills: [
          { id: 'fs-b', type: 'BUY', qty: 10, price: 10_000, reason: 'init', timestamp: T0, status: 'CONFIRMED' },
          sell({ id: 'fs-s', qty: 10, pnl: -10_000, pnlPct: -10, ts: T1 }),
        ],
      }),
      // ACTIVE trade 부분매도 (이번 주)
      trade({
        id: 'PARTIAL',
        status: 'ACTIVE',
        fills: [
          { id: 'p-b', type: 'BUY', qty: 10, price: 10_000, reason: 'init', timestamp: T0, status: 'CONFIRMED' },
          sell({ id: 'p-s1', qty: 3, pnl: 6_000, pnlPct: 20, ts: T1 }),
          sell({ id: 'p-s2', qty: 2, pnl: -2_000, pnlPct: -10, ts: T2 }),
        ],
      }),
    ];
    const agg = aggregateFillStats(trades, { fromIso: WEEK_FROM, toIso: WEEK_TO });
    // FULL_STOP: 1 loss fill, PARTIAL: 1 win + 1 loss
    expect(agg.fillCount).toBe(3);
    expect(agg.winFills).toBe(1);
    expect(agg.lossFills).toBe(2);
    expect(agg.fullClosedCount).toBe(1);
    expect(agg.partialOnlyCount).toBe(1);
    expect(agg.uniqueTradeCount).toBe(2);
    expect(agg.totalRealizedKrw).toBe(-10_000 + 6_000 - 2_000);
    // 가중 평균 = (-10×10 + 20×3 - 10×2) / (10+3+2) = (-100+60-20) / 15 = -60/15 = -4%
    expect(agg.weightedReturnPct).toBeCloseTo(-4, 1);
  });

  it('range 밖 fill 은 제외', () => {
    const trades = [
      trade({
        id: 'OLD',
        status: 'HIT_TARGET',
        fills: [
          { id: 'o-b', type: 'BUY', qty: 10, price: 10_000, reason: 'init', timestamp: T0, status: 'CONFIRMED' },
          sell({ id: 'o-s', qty: 10, pnl: 1_000, pnlPct: 10, ts: T0 }), // 범위 전
        ],
      }),
    ];
    const agg = aggregateFillStats(trades, { fromIso: WEEK_FROM, toIso: WEEK_TO });
    expect(agg.fillCount).toBe(0);
    expect(agg.uniqueTradeCount).toBe(0);
  });

  it('REVERTED 는 제외 / PROVISIONAL 은 includeProvisional 플래그로 제어', () => {
    const trades = [
      trade({
        id: 'MIX',
        fills: [
          { id: 'm-b', type: 'BUY', qty: 10, price: 10_000, reason: 'init', timestamp: T0, status: 'CONFIRMED' },
          sell({ id: 'm-ok',  qty: 3, pnl: 900,  pnlPct: 3,  ts: T1 }),
          sell({ id: 'm-rev', qty: 2, pnl: 600,  pnlPct: 3,  ts: T1, status: 'REVERTED' }),
          sell({ id: 'm-pro', qty: 2, pnl: 500,  pnlPct: 2.5, ts: T1, status: 'PROVISIONAL' }),
        ],
      }),
    ];
    // 기본 — CONFIRMED 만
    const base = aggregateFillStats(trades, { fromIso: WEEK_FROM, toIso: WEEK_TO });
    expect(base.fillCount).toBe(1);
    // PROVISIONAL 포함
    const withProv = aggregateFillStats(trades, { fromIso: WEEK_FROM, toIso: WEEK_TO, includeProvisional: true });
    expect(withProv.fillCount).toBe(2);
  });

  it('range 미지정 — 전체 기간 집계', () => {
    const trades = [
      trade({
        id: 'ALL',
        fills: [
          { id: 'a-b', type: 'BUY', qty: 10, price: 10_000, reason: 'init', timestamp: T0, status: 'CONFIRMED' },
          sell({ id: 'a-s1', qty: 5, pnl: 2_500, pnlPct: 5, ts: T0 }),
          sell({ id: 'a-s2', qty: 5, pnl: 3_000, pnlPct: 6, ts: T2 }),
        ],
      }),
    ];
    const agg = aggregateFillStats(trades);
    expect(agg.fillCount).toBe(2);
    expect(agg.winFills).toBe(2);
    expect(agg.totalRealizedKrw).toBe(5_500);
  });

  it('빈 입력 — zero', () => {
    const agg = aggregateFillStats([]);
    expect(agg.fillCount).toBe(0);
    expect(agg.winFills).toBe(0);
    expect(agg.lossFills).toBe(0);
    expect(agg.uniqueTradeCount).toBe(0);
    expect(agg.fullClosedCount).toBe(0);
    expect(agg.partialOnlyCount).toBe(0);
    expect(agg.weightedReturnPct).toBe(0);
    expect(agg.totalRealizedKrw).toBe(0);
  });
});
