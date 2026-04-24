/**
 * @responsibility PR-17 collectTodayBuyEvents / summarizeTodayBuyEvents 회귀 테스트
 *
 * BUY 측 버그: "오늘 매수 N개" 를 signalTime 기준으로만 집계하면 ①어제 signaled ->
 * 오늘 실제 체결(트랜치 진입 포함), ②오늘 REJECTED 로 되돌려진 fill 을 잘못
 * 반영한다. 이 테스트는 fill SSOT 기준 체결 현실이 정확히 집계됨을 검증한다.
 */

import { describe, it, expect } from 'vitest';
import {
  collectTodayBuyEvents,
  summarizeTodayBuyEvents,
} from './reportGenerator.js';
import type { ServerShadowTrade, PositionFill } from '../persistence/shadowTradeRepo.js';

const TODAY = '2026-04-24';
const YEST_ISO  = '2026-04-23T14:00:00.000Z';
const TODAY_ISO = '2026-04-24T04:30:00+09:00';
const TODAY_ISO2 = '2026-04-24T10:15:00+09:00';

function trade(overrides: Partial<ServerShadowTrade> & { id: string; fills?: PositionFill[] }): ServerShadowTrade {
  return {
    stockCode: overrides.id,
    stockName: `종목${overrides.id}`,
    signalTime: overrides.signalTime ?? YEST_ISO,
    signalPrice: 10_000,
    shadowEntryPrice: 10_000,
    quantity: 10,
    stopLoss: 9_500,
    targetPrice: 11_000,
    status: 'ACTIVE',
    fills: [],
    ...overrides,
  };
}

function buyFill(o: { id: string; qty: number; price: number; ts: string; status?: PositionFill['status']; subType?: PositionFill['subType'] }): PositionFill {
  return {
    id: o.id,
    type: 'BUY',
    subType: o.subType ?? 'INITIAL_BUY',
    qty: o.qty,
    price: o.price,
    reason: 'test',
    timestamp: o.ts,
    status: o.status ?? 'CONFIRMED',
    confirmedAt: o.status === 'REVERTED' ? undefined : o.ts,
  };
}

describe('collectTodayBuyEvents', () => {
  it('오늘 INITIAL_BUY fill 은 isInitial=true 로 집계', () => {
    const events = collectTodayBuyEvents([
      trade({
        id: 'A',
        signalTime: TODAY_ISO,
        fills: [buyFill({ id: 'a-b', qty: 10, price: 10_000, ts: TODAY_ISO })],
      }),
    ], TODAY);
    expect(events).toHaveLength(1);
    expect(events[0].isInitial).toBe(true);
  });

  it('어제 signaled 이지만 오늘 TRANCHE_BUY fill 이 있으면 isInitial=false 로 집계', () => {
    const events = collectTodayBuyEvents([
      trade({
        id: 'B',
        signalTime: YEST_ISO,
        fills: [
          buyFill({ id: 'b-init', qty: 10, price: 10_000, ts: YEST_ISO }),
          buyFill({ id: 'b-tr1', qty: 5, price: 10_500, ts: TODAY_ISO, subType: 'TRANCHE_BUY' }),
        ],
      }),
    ], TODAY);
    expect(events).toHaveLength(1);
    expect(events[0].isInitial).toBe(false);
    expect(events[0].fill.id).toBe('b-tr1');
  });

  it('REVERTED fill 은 집계 제외', () => {
    const events = collectTodayBuyEvents([
      trade({
        id: 'C',
        signalTime: TODAY_ISO,
        fills: [
          buyFill({ id: 'c-bad', qty: 10, price: 10_000, ts: TODAY_ISO, status: 'REVERTED' }),
          buyFill({ id: 'c-ok',  qty: 10, price: 10_100, ts: TODAY_ISO2 }),
        ],
      }),
    ], TODAY);
    expect(events).toHaveLength(1);
    expect(events[0].fill.id).toBe('c-ok');
  });

  it('PROVISIONAL 은 집계 포함 (주문 접수 성공 상태)', () => {
    const events = collectTodayBuyEvents([
      trade({
        id: 'D',
        signalTime: TODAY_ISO,
        fills: [buyFill({ id: 'd-p', qty: 10, price: 10_000, ts: TODAY_ISO, status: 'PROVISIONAL' })],
      }),
    ], TODAY);
    expect(events).toHaveLength(1);
    expect(events[0].fill.status).toBe('PROVISIONAL');
  });

  it('다른 날짜 fill 은 제외', () => {
    const events = collectTodayBuyEvents([
      trade({
        id: 'E',
        signalTime: YEST_ISO,
        fills: [buyFill({ id: 'e-y', qty: 10, price: 10_000, ts: YEST_ISO })],
      }),
    ], TODAY);
    expect(events).toHaveLength(0);
  });
});

describe('summarizeTodayBuyEvents', () => {
  it('신규 진입 + 트랜치 구분 + 수량/원가 합산', () => {
    const trades: ServerShadowTrade[] = [
      // 신규 진입 1건
      trade({
        id: 'NEW',
        signalTime: TODAY_ISO,
        fills: [buyFill({ id: 'n-b', qty: 10, price: 10_000, ts: TODAY_ISO })],
      }),
      // 기존 trade 에 오늘 tranche 2건
      trade({
        id: 'EXIST',
        signalTime: YEST_ISO,
        fills: [
          buyFill({ id: 'x-init', qty: 10, price: 12_000, ts: YEST_ISO }),
          buyFill({ id: 'x-tr1', qty: 5, price: 12_500, ts: TODAY_ISO, subType: 'TRANCHE_BUY' }),
          buyFill({ id: 'x-tr2', qty: 3, price: 12_800, ts: TODAY_ISO2, subType: 'TRANCHE_BUY' }),
        ],
      }),
    ];
    const events = collectTodayBuyEvents(trades, TODAY);
    const stats = summarizeTodayBuyEvents(events);

    expect(stats.totalBuys).toBe(3);       // 1 new + 2 tranches
    expect(stats.newEntries).toBe(1);
    expect(stats.tranches).toBe(2);
    expect(stats.totalQty).toBe(10 + 5 + 3);
    expect(stats.totalCostKrw).toBe(10 * 10_000 + 5 * 12_500 + 3 * 12_800);
  });

  it('체결 없음 → zero 집계', () => {
    const stats = summarizeTodayBuyEvents([]);
    expect(stats.totalBuys).toBe(0);
    expect(stats.newEntries).toBe(0);
    expect(stats.tranches).toBe(0);
    expect(stats.totalQty).toBe(0);
    expect(stats.totalCostKrw).toBe(0);
  });
});
