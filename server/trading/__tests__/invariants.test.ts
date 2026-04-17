/**
 * server/trading/__tests__/invariants.test.ts
 * 트레이드 이벤트 불변성 검증 — 아이디어 9
 *
 * 테스트 원칙: 회계 정확성이 모든 분석의 기반이다.
 * TradeEvent 시퀀스와 fills 배열이 수학적으로 일관된 상태를 유지하는지 보장한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs', () => ({
  default: {
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    existsSync: vi.fn(() => false),
    appendFileSync: vi.fn(),
  },
}));
vi.mock('../../persistence/paths.js', () => ({
  SHADOW_FILE: '/mock/shadow-trades.json',
  SHADOW_LOG_FILE: '/mock/shadow-log.json',
  ensureDataDir: vi.fn(),
  tradeEventsFile: vi.fn(() => '/mock/events.jsonl'),
}));

import {
  getRemainingQty,
  getTotalRealizedPnl,
  getWeightedPnlPct,
  appendFill,
  updateShadow,
} from '../../persistence/shadowTradeRepo.js';
import type { ServerShadowTrade, PositionFill } from '../../persistence/shadowTradeRepo.js';
import { aggregatePosition } from '../positionAggregator.js';
import type { TradeEvent } from '../tradeEventLog.js';

// ─── 팩토리 헬퍼 ─────────────────────────────────────────────────────────────

let _fillSeq = 0;
function fill(
  type: 'BUY' | 'SELL',
  qty: number,
  price: number,
  opts: Partial<PositionFill> = {},
): Omit<PositionFill, 'id'> {
  return {
    type,
    qty,
    price,
    reason: 'test',
    timestamp: new Date(Date.now() + ++_fillSeq).toISOString(),
    pnl: type === 'SELL' ? opts.pnl : undefined,
    pnlPct: type === 'SELL' ? opts.pnlPct : undefined,
    subType: opts.subType,
    exitRuleTag: opts.exitRuleTag,
  };
}

function makeTrade(
  entryPrice: number,
  entryQty: number,
  overrides: Partial<ServerShadowTrade> = {},
): ServerShadowTrade {
  const t: ServerShadowTrade = {
    id: `test-${Date.now()}-${Math.random()}`,
    stockCode: '000000',
    stockName: '테스트',
    signalTime: new Date().toISOString(),
    signalPrice: entryPrice,
    shadowEntryPrice: entryPrice,
    quantity: entryQty,
    originalQuantity: entryQty,
    stopLoss: Math.round(entryPrice * 0.9),
    targetPrice: Math.round(entryPrice * 1.2),
    status: 'ACTIVE',
    fills: [],
    ...overrides,
  };
  appendFill(t, fill('BUY', entryQty, entryPrice, { subType: 'INITIAL_BUY' }));
  return t;
}

/** TradeEvent 시퀀스 생성 헬퍼 */
function makeEventSeq(
  positionId: string,
  entryPrice: number,
  entryQty: number,
  sells: { qty: number; price: number; type?: 'PARTIAL_SELL' | 'FULL_SELL' }[],
): TradeEvent[] {
  const events: TradeEvent[] = [];
  let remaining = entryQty;
  let cum = 0;

  events.push({
    id: 'evt_entry',
    positionId,
    ts: new Date().toISOString(),
    type: 'ENTRY',
    subType: 'INITIAL_BUY',
    quantity: entryQty,
    price: entryPrice,
    realizedPnL: 0,
    cumRealizedPnL: 0,
    remainingQty: entryQty,
  });

  let seq = 0;
  for (const s of sells) {
    remaining -= s.qty;
    const pnl = (s.price - entryPrice) * s.qty;
    cum += pnl;
    events.push({
      id: `evt_sell_${++seq}`,
      positionId,
      ts: new Date().toISOString(),
      type: s.type ?? (remaining === 0 ? 'FULL_SELL' : 'PARTIAL_SELL'),
      quantity: s.qty,
      price: s.price,
      realizedPnL: pnl,
      cumRealizedPnL: cum,
      remainingQty: Math.max(0, remaining),
    });
  }
  return events;
}

// ─── 테스트 ───────────────────────────────────────────────────────────────────

describe('TradeEvent Invariants (아이디어 9)', () => {

  beforeEach(() => { _fillSeq = 0; });

  // ── 불변성 1: Σ SELL qty == originalQuantity (완전 청산 후) ─────────────────
  it('CLOSED 포지션 Σ SELL qty == originalQuantity', () => {
    const t = makeTrade(70_000, 100);
    appendFill(t, fill('SELL', 40, 72_000, { pnl: 80_000,  pnlPct: 2.86, subType: 'PARTIAL_TP' }));
    appendFill(t, fill('SELL', 60, 63_000, { pnl: -420_000, pnlPct: -10,  subType: 'STOP_LOSS' }));

    const sellFills = (t.fills ?? []).filter(f => f.type === 'SELL');
    const totalSell = sellFills.reduce((s, f) => s + f.qty, 0);

    expect(totalSell).toBe(t.originalQuantity);  // 100 == 100
    expect(getRemainingQty(t)).toBe(0);
  });

  // ── 불변성 2: Σ realizedPnL == 산술적으로 계산한 총 손익 ────────────────────
  it('Σ realizedPnL == (exitPrice−entryPrice)×qty 합산과 일치한다', () => {
    const entryPrice = 70_000;
    const t = makeTrade(entryPrice, 100);

    const sell1 = { qty: 40, price: 72_000 };
    const sell2 = { qty: 60, price: 63_000 };

    const pnl1 = (sell1.price - entryPrice) * sell1.qty;  // +80,000
    const pnl2 = (sell2.price - entryPrice) * sell2.qty;  // −420,000
    const expectedTotal = pnl1 + pnl2;                   // −340,000

    appendFill(t, fill('SELL', sell1.qty, sell1.price, { pnl: pnl1, pnlPct: (sell1.price / entryPrice - 1) * 100, subType: 'PARTIAL_TP' }));
    appendFill(t, fill('SELL', sell2.qty, sell2.price, { pnl: pnl2, pnlPct: (sell2.price / entryPrice - 1) * 100, subType: 'STOP_LOSS' }));

    expect(getTotalRealizedPnl(t)).toBeCloseTo(expectedTotal, 0);
  });

  // ── 불변성 3: TradeEvent remainingQty는 단조 감소해야 한다 ───────────────────
  it('TradeEvent remainingQty는 단조 감소한다', () => {
    const events = makeEventSeq('pos-001', 70_000, 100, [
      { qty: 30, price: 73_000 },
      { qty: 40, price: 72_000 },
      { qty: 30, price: 63_000 },
    ]);

    const sellEvents = events.filter(e => e.type !== 'ENTRY');
    for (let i = 1; i < sellEvents.length; i++) {
      expect(sellEvents[i].remainingQty).toBeLessThanOrEqual(sellEvents[i - 1].remainingQty);
    }
  });

  // ── 불변성 4: CLOSED 포지션의 마지막 이벤트 remainingQty == 0 ───────────────
  it('FULL_SELL 이벤트의 remainingQty == 0', () => {
    const events = makeEventSeq('pos-002', 70_000, 100, [
      { qty: 50, price: 73_000 },
      { qty: 50, price: 63_000 },
    ]);

    const last = events[events.length - 1];
    expect(last.type).toBe('FULL_SELL');
    expect(last.remainingQty).toBe(0);
  });

  // ── 불변성 5: originalQuantity는 updateShadow 이후에도 불변 ─────────────────
  it('originalQuantity는 updateShadow 호출 후에도 변경되지 않는다', () => {
    const t = makeTrade(70_000, 100);
    const original = t.originalQuantity;

    // 덮어쓰기 시도
    updateShadow(t, { originalQuantity: 999 } as any);
    expect(t.originalQuantity).toBe(original);  // 차단됨

    // 상태 변경은 허용됨
    updateShadow(t, { status: 'HIT_STOP', exitPrice: 63_000 });
    expect(t.originalQuantity).toBe(original);  // 여전히 불변
    expect(t.status).toBe('HIT_STOP');          // 다른 필드는 변경
  });

  // ── 불변성 6: ENTRY event remainingQty == originalQuantity ──────────────────
  it('ENTRY 이벤트의 remainingQty == originalQuantity', () => {
    const qty = 150;
    const events = makeEventSeq('pos-003', 80_000, qty, [
      { qty: 150, price: 85_000 },
    ]);

    const entry = events.find(e => e.type === 'ENTRY');
    expect(entry).toBeDefined();
    expect(entry!.remainingQty).toBe(qty);
  });

  // ── 불변성 7: cumRealizedPnL at last event == Σ realizedPnL ─────────────────
  it('마지막 이벤트의 cumRealizedPnL == 모든 이벤트 realizedPnL 합산', () => {
    const events = makeEventSeq('pos-004', 70_000, 100, [
      { qty: 40, price: 74_000 },
      { qty: 60, price: 65_000 },
    ]);

    const totalPnL    = events.reduce((s, e) => s + e.realizedPnL, 0);
    const lastCumPnL  = events[events.length - 1].cumRealizedPnL;

    expect(lastCumPnL).toBeCloseTo(totalPnL, 0);
  });

  // ── 불변성 8: aggregatePosition — CLOSED 포지션 weightedReturnPct 부호 ───────
  it('aggregatePosition: totalRealizedPnL 부호가 weightedReturnPct 부호와 일치한다', () => {
    const t = makeTrade(70_000, 100);
    const entryPrice = 70_000;

    // 손절 시나리오
    appendFill(t, fill('SELL', 100, 63_000, {
      pnl: (63_000 - entryPrice) * 100,
      pnlPct: (63_000 / entryPrice - 1) * 100,
      subType: 'STOP_LOSS',
    }));
    updateShadow(t, { status: 'HIT_STOP', quantity: 0 });

    const summary = aggregatePosition(t);
    expect(summary.totalRealizedPnL).toBeLessThan(0);
    expect(summary.weightedReturnPct).toBeLessThan(0);
    expect(Math.sign(summary.totalRealizedPnL)).toBe(Math.sign(summary.weightedReturnPct));
  });
});
