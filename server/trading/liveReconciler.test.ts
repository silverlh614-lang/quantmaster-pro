/**
 * @responsibility ADR-0015 liveReconciler pure 헬퍼 회귀 — diff 분류·apply 효과
 */

import { describe, it, expect } from 'vitest';
import { __testOnly, type LiveReconcileDiff } from './liveReconciler.js';
import type { ServerShadowTrade } from '../persistence/shadowTradeRepo.js';
import type { KisHolding } from '../clients/kisClient.js';

function makeLiveTrade(overrides: Partial<ServerShadowTrade> & { id: string; stockCode: string }): ServerShadowTrade {
  const now = new Date().toISOString();
  const qty = overrides.quantity ?? 10;
  return {
    stockName: `종목${overrides.stockCode}`,
    signalTime: now,
    signalPrice: 10000,
    shadowEntryPrice: 10000,
    originalQuantity: qty,
    stopLoss: 9000,
    targetPrice: 12000,
    mode: 'LIVE',
    status: 'ACTIVE',
    quantity: qty,
    fills: [
      { id: 'f1', type: 'BUY', qty, price: 10000, reason: 'init', timestamp: now, status: 'CONFIRMED' },
    ],
    ...overrides,
  } as ServerShadowTrade;
}

function makeHolding(code: string, hldgQty: number, pchsAvgPric = 10000): KisHolding {
  return {
    pdno: code,
    prdtName: `종목${code}`,
    hldgQty,
    pchsAvgPric,
    prpr: pchsAvgPric,
    evluPflsAmt: 0,
  };
}

describe('ADR-0015 liveReconciler — diffHoldings', () => {
  it('로컬 qty === KIS qty → MATCH (willApply=false)', () => {
    const trades = [makeLiveTrade({ id: 't1', stockCode: '005930', quantity: 10 })];
    const kis = [makeHolding('005930', 10)];
    const diffs = __testOnly.diffHoldings(trades, kis);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].category).toBe('MATCH');
    expect(diffs[0].willApply).toBe(false);
  });

  it('로컬 qty > KIS qty → QTY_DIVERGENCE (willApply=true)', () => {
    const trades = [makeLiveTrade({ id: 't1', stockCode: '005930', quantity: 10 })];
    const kis = [makeHolding('005930', 7)];
    const diffs = __testOnly.diffHoldings(trades, kis);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].category).toBe('QTY_DIVERGENCE');
    expect(diffs[0].localQty).toBe(10);
    expect(diffs[0].kisQty).toBe(7);
    expect(diffs[0].willApply).toBe(true);
  });

  it('로컬 qty < KIS qty → QTY_DIVERGENCE (체결 누락 보정 대상)', () => {
    const trades = [makeLiveTrade({ id: 't1', stockCode: '005930', quantity: 5 })];
    const kis = [makeHolding('005930', 10)];
    const diffs = __testOnly.diffHoldings(trades, kis);
    expect(diffs[0].category).toBe('QTY_DIVERGENCE');
    expect(diffs[0].localQty).toBe(5);
    expect(diffs[0].kisQty).toBe(10);
    expect(diffs[0].willApply).toBe(true);
  });

  it('로컬 ACTIVE, KIS 미보유 → GHOST_LOCAL (willApply=true)', () => {
    const trades = [makeLiveTrade({ id: 't1', stockCode: '005930', quantity: 10 })];
    const kis: KisHolding[] = [];
    const diffs = __testOnly.diffHoldings(trades, kis);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].category).toBe('GHOST_LOCAL');
    expect(diffs[0].willApply).toBe(true);
  });

  it('로컬 미보유, KIS 보유 → GHOST_KIS (willApply=false — 메타 손실 차단)', () => {
    const trades: ServerShadowTrade[] = [];
    const kis = [makeHolding('005930', 10)];
    const diffs = __testOnly.diffHoldings(trades, kis);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].category).toBe('GHOST_KIS');
    expect(diffs[0].willApply).toBe(false);
  });

  it('SHADOW mode trade 는 LIVE reconcile 대상에서 제외', () => {
    const trades = [
      makeLiveTrade({ id: 't1', stockCode: '005930', quantity: 10, mode: 'SHADOW' }),
      makeLiveTrade({ id: 't2', stockCode: '000660', quantity: 5, mode: 'LIVE' }),
    ];
    const kis = [makeHolding('000660', 5)];
    const diffs = __testOnly.diffHoldings(trades, kis);
    // SHADOW trade 는 GHOST_LOCAL 로 나타나지 않아야 함
    expect(diffs.find((d) => d.stockCode === '005930')).toBeUndefined();
    expect(diffs.find((d) => d.stockCode === '000660')?.category).toBe('MATCH');
  });

  it('closed status (HIT_STOP) 는 reconcile 대상에서 제외', () => {
    const trades = [
      makeLiveTrade({ id: 't1', stockCode: '005930', quantity: 10, status: 'HIT_STOP' }),
    ];
    const kis: KisHolding[] = [];
    const diffs = __testOnly.diffHoldings(trades, kis);
    expect(diffs).toHaveLength(0);
  });

  it('동일 종목 다중 trade 를 합산해 KIS 단일 row 와 비교', () => {
    const trades = [
      makeLiveTrade({ id: 't1', stockCode: '005930', quantity: 10 }),
      makeLiveTrade({ id: 't2', stockCode: '005930', quantity: 5 }),
    ];
    const kis = [makeHolding('005930', 15)];
    const diffs = __testOnly.diffHoldings(trades, kis);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].category).toBe('MATCH');
    expect(diffs[0].localQty).toBe(15);
  });
});

describe('ADR-0015 liveReconciler — applyDiffs', () => {
  it('GHOST_LOCAL 적용 시 SELL fill 추가 + status=HIT_STOP', () => {
    const trade = makeLiveTrade({ id: 't1', stockCode: '005930', quantity: 10 });
    const trades = [trade];
    const diffs: LiveReconcileDiff[] = [{
      category: 'GHOST_LOCAL',
      stockCode: '005930',
      stockName: '삼성전자',
      localQty: 10,
      kisQty: 0,
      tradeId: 't1',
      willApply: true,
      note: '',
    }];
    const applied = __testOnly.applyDiffs(trades, diffs, []);
    expect(applied).toBe(1);
    expect(trade.status).toBe('HIT_STOP');
    const sellFills = (trade.fills ?? []).filter((f) => f.type === 'SELL');
    expect(sellFills).toHaveLength(1);
    expect(sellFills[0].qty).toBe(10);
    expect(sellFills[0].exitRuleTag).toBe('RECONCILE_GHOST_LOCAL');
  });

  it('QTY_DIVERGENCE (로컬>KIS) 적용 시 차이만큼 SELL fill', () => {
    const trade = makeLiveTrade({ id: 't1', stockCode: '005930', quantity: 10 });
    const trades = [trade];
    const kisHoldings = [makeHolding('005930', 7, 10500)];
    const diffs: LiveReconcileDiff[] = [{
      category: 'QTY_DIVERGENCE',
      stockCode: '005930',
      stockName: '삼성전자',
      localQty: 10,
      kisQty: 7,
      tradeId: 't1',
      willApply: true,
      note: '',
    }];
    const applied = __testOnly.applyDiffs(trades, diffs, kisHoldings);
    expect(applied).toBe(1);
    const sellFills = (trade.fills ?? []).filter((f) => f.type === 'SELL');
    expect(sellFills).toHaveLength(1);
    expect(sellFills[0].qty).toBe(3);
    expect(sellFills[0].price).toBe(10500);
    expect(sellFills[0].exitRuleTag).toBe('RECONCILE_QTY_DIVERGENCE');
  });

  it('QTY_DIVERGENCE (로컬<KIS) 적용 시 차이만큼 BUY fill (체결 누락 보정)', () => {
    const trade = makeLiveTrade({ id: 't1', stockCode: '005930', quantity: 5 });
    const trades = [trade];
    const kisHoldings = [makeHolding('005930', 10, 10500)];
    const diffs: LiveReconcileDiff[] = [{
      category: 'QTY_DIVERGENCE',
      stockCode: '005930',
      stockName: '삼성전자',
      localQty: 5,
      kisQty: 10,
      tradeId: 't1',
      willApply: true,
      note: '',
    }];
    const applied = __testOnly.applyDiffs(trades, diffs, kisHoldings);
    expect(applied).toBe(1);
    const buyFills = (trade.fills ?? []).filter((f) => f.type === 'BUY');
    expect(buyFills).toHaveLength(2); // 기존 1건 + 보정 1건
    const added = buyFills[buyFills.length - 1];
    expect(added.qty).toBe(5);
    expect(added.price).toBe(10500);
  });

  it('GHOST_KIS 는 적용 안 함 (willApply=false)', () => {
    const trades: ServerShadowTrade[] = [];
    const diffs: LiveReconcileDiff[] = [{
      category: 'GHOST_KIS',
      stockCode: '005930',
      stockName: '삼성전자',
      localQty: 0,
      kisQty: 10,
      tradeId: null,
      willApply: false,
      note: '',
    }];
    const applied = __testOnly.applyDiffs(trades, diffs, [makeHolding('005930', 10)]);
    expect(applied).toBe(0);
  });

  it('MATCH 는 적용 안 함 (willApply=false)', () => {
    const trade = makeLiveTrade({ id: 't1', stockCode: '005930', quantity: 10 });
    const trades = [trade];
    const fillsBefore = (trade.fills ?? []).length;
    const diffs: LiveReconcileDiff[] = [{
      category: 'MATCH',
      stockCode: '005930',
      stockName: '삼성전자',
      localQty: 10,
      kisQty: 10,
      tradeId: 't1',
      willApply: false,
      note: '',
    }];
    const applied = __testOnly.applyDiffs(trades, diffs, [makeHolding('005930', 10)]);
    expect(applied).toBe(0);
    expect((trade.fills ?? []).length).toBe(fillsBefore);
  });
});
