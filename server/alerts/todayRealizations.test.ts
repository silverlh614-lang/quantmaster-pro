/**
 * @responsibility 당일 실현 이벤트 집계 SSOT 회귀 테스트 — 부분매도·이월청산 포함 보장
 *
 * PR-15: generateDailyReport 등이 signalTime 기준 필터 + HIT_TARGET/STOP 만 집계해
 * ACTIVE 포지션의 부분매도 익절을 누락하던 버그의 재발 방지.
 */

import { describe, it, expect } from 'vitest';
import { collectTodayRealizations, summarizeTodayRealizations } from './reportGenerator.js';
import type { ServerShadowTrade, PositionFill } from '../persistence/shadowTradeRepo.js';

const TODAY = '2026-04-24';
const YESTERDAY_ISO = '2026-04-23T14:00:00.000Z';
const TODAY_ISO     = '2026-04-24T04:30:00+09:00';
const TODAY_ISO_2   = '2026-04-24T10:15:00+09:00';

function mkTrade(overrides: Partial<ServerShadowTrade> & { id: string; fills?: PositionFill[] }): ServerShadowTrade {
  return {
    stockCode: overrides.stockCode ?? overrides.id,
    stockName: overrides.stockName ?? `종목${overrides.id}`,
    signalTime: overrides.signalTime ?? YESTERDAY_ISO,
    signalPrice: 10_000,
    shadowEntryPrice: 10_000,
    quantity: 10,
    stopLoss: 9_500,
    targetPrice: 11_000,
    status: overrides.status ?? 'ACTIVE',
    fills: overrides.fills ?? [],
    ...overrides,
  };
}

function sellFill(opts: {
  id: string;
  qty: number;
  pnl: number;
  pnlPct: number;
  timestamp: string;
  status?: PositionFill['status'];
  subType?: PositionFill['subType'];
}): PositionFill {
  return {
    id: opts.id,
    type: 'SELL',
    subType: opts.subType ?? 'PARTIAL_TP',
    qty: opts.qty,
    price: 10_000 + opts.pnl / opts.qty,
    pnl: opts.pnl,
    pnlPct: opts.pnlPct,
    reason: 'test',
    timestamp: opts.timestamp,
    status: opts.status ?? 'CONFIRMED',
    confirmedAt: opts.status === 'CONFIRMED' || opts.status === undefined ? opts.timestamp : undefined,
  };
}

describe('collectTodayRealizations', () => {
  it('ACTIVE 상태의 부분매도(익절) fill 도 오늘 실현으로 포함한다', () => {
    const trades = [
      mkTrade({
        id: 'A',
        status: 'ACTIVE',
        fills: [
          { id: 'A-b', type: 'BUY', qty: 10, price: 10_000, reason: 'init', timestamp: YESTERDAY_ISO, status: 'CONFIRMED' },
          sellFill({ id: 'A-partial', qty: 4, pnl: 20_000, pnlPct: 5.0, timestamp: TODAY_ISO }),
        ],
      }),
    ];
    const r = collectTodayRealizations(trades, TODAY);
    expect(r).toHaveLength(1);
    expect(r[0].fill.id).toBe('A-partial');
    expect(r[0].isFinalClose).toBe(false);
  });

  it('어제 진입→오늘 청산된 전량매도도 집계에 포함한다', () => {
    const trades = [
      mkTrade({
        id: 'B',
        status: 'HIT_STOP',
        signalTime: YESTERDAY_ISO,
        exitTime: TODAY_ISO,
        fills: [
          { id: 'B-b', type: 'BUY', qty: 10, price: 10_000, reason: 'init', timestamp: YESTERDAY_ISO, status: 'CONFIRMED' },
          sellFill({ id: 'B-stop', qty: 10, pnl: -70_000, pnlPct: -7, timestamp: TODAY_ISO, subType: 'STOP_LOSS' }),
        ],
      }),
    ];
    const r = collectTodayRealizations(trades, TODAY);
    expect(r).toHaveLength(1);
    expect(r[0].isFinalClose).toBe(true);
  });

  it('REVERTED fill / PROVISIONAL 은 제외한다 (REVERTED 만)', () => {
    const trades = [
      mkTrade({
        id: 'C',
        fills: [
          { id: 'C-b', type: 'BUY', qty: 10, price: 10_000, reason: 'init', timestamp: YESTERDAY_ISO, status: 'CONFIRMED' },
          sellFill({ id: 'C-ok',    qty: 3, pnl: 15_000,  pnlPct: 5,  timestamp: TODAY_ISO }),
          sellFill({ id: 'C-rev',   qty: 2, pnl: -4_000,  pnlPct: -2, timestamp: TODAY_ISO, status: 'REVERTED' }),
          sellFill({ id: 'C-prov',  qty: 2, pnl: 8_000,   pnlPct: 4,  timestamp: TODAY_ISO, status: 'PROVISIONAL' }),
        ],
      }),
    ];
    const r = collectTodayRealizations(trades, TODAY);
    // REVERTED 제외, PROVISIONAL/CONFIRMED 포함
    expect(r.map(x => x.fill.id).sort()).toEqual(['C-ok', 'C-prov']);
  });

  it('다른 날짜 fill 은 제외한다', () => {
    const trades = [
      mkTrade({
        id: 'D',
        fills: [
          { id: 'D-b', type: 'BUY', qty: 10, price: 10_000, reason: 'init', timestamp: YESTERDAY_ISO, status: 'CONFIRMED' },
          sellFill({ id: 'D-yest', qty: 5, pnl: 10_000, pnlPct: 2, timestamp: YESTERDAY_ISO }),
        ],
      }),
    ];
    const r = collectTodayRealizations(trades, TODAY);
    expect(r).toHaveLength(0);
  });
});

describe('summarizeTodayRealizations — 사용자 재현 케이스', () => {
  // 이미지 시나리오 재현: 어제 진입한 현대제철이 오늘 -7.42% 전량 손절 + 다른 포지션에서 오늘 +5% 부분 익절.
  // 기존 로직은 signalTime 기준 필터 + HIT_STOP 만 집계해 부분 익절을 누락했음.
  it('전량 손절 + 부분 익절 동시 발생 시 양쪽 모두 집계', () => {
    const trades = [
      mkTrade({
        id: 'HYUNDAISTEEL',
        stockName: '현대제철',
        signalTime: YESTERDAY_ISO,
        status: 'HIT_STOP',
        fills: [
          { id: 'hs-b', type: 'BUY', qty: 29, price: 42_126, reason: 'init', timestamp: YESTERDAY_ISO, status: 'CONFIRMED' },
          sellFill({ id: 'hs-stop', qty: 29, pnl: -90_654, pnlPct: -7.42, timestamp: TODAY_ISO, subType: 'STOP_LOSS' }),
        ],
      }),
      mkTrade({
        id: 'POSCO',
        stockName: '포스코인터내셔널',
        signalTime: '2026-04-22T04:00:00.000Z',
        status: 'ACTIVE',
        fills: [
          { id: 'po-b', type: 'BUY', qty: 15, price: 81_343, reason: 'init', timestamp: '2026-04-22T04:00:00.000Z', status: 'CONFIRMED' },
          sellFill({ id: 'po-tp', qty: 5, pnl: 20_335, pnlPct: 5.0, timestamp: TODAY_ISO_2 }),
        ],
      }),
    ];
    const r = collectTodayRealizations(trades, TODAY);
    const s = summarizeTodayRealizations(r);

    expect(s.realizationCount).toBe(2);
    expect(s.wins).toBe(1);
    expect(s.losses).toBe(1);
    expect(s.fullClosedCount).toBe(1);     // 현대제철 전량손절
    expect(s.partialOnlyCount).toBe(1);    // 포스코인터 부분익절
    // 가중 평균: (-7.42 × 29 + 5.0 × 5) / 34 = (-215.18 + 25) / 34 = -190.18 / 34 = -5.59%
    expect(s.weightedReturnPct).toBeCloseTo(-5.59, 2);
    expect(s.totalRealizedKrw).toBe(-90_654 + 20_335);
    expect(s.winRate).toBe(50);
  });

  it('실현 이벤트 없으면 zero 집계', () => {
    const s = summarizeTodayRealizations([]);
    expect(s.realizationCount).toBe(0);
    expect(s.wins).toBe(0);
    expect(s.losses).toBe(0);
    expect(s.weightedReturnPct).toBe(0);
    expect(s.totalRealizedKrw).toBe(0);
    expect(s.winRate).toBe(0);
  });
});
