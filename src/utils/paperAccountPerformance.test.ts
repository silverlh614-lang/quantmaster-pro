// @responsibility Verify realized account profit excludes historical selection scores.
import { describe, expect, it } from 'vitest';
import { accountFill, createPaperAccount } from '../../server/trading/paper/paperAccount.js';
import { paperAccountOrderReview, paperAccountPerformance } from './paperAccountPerformance';
import type { PaperAccountOrder } from '../types/paperAccount';

describe('account forward performance', () => {
  it('pairs variable-sized cash flows, isolates policy cohorts and leaves open trades unrealized', () => {
    const at = '2026-09-18T01:00:00Z';
    const account = createPaperAccount({ initialCash: 10000, maxPositionPct: 20, includeExploration: false }, at, 'account');
    const costModel = { version: 'test', buyFeeRate: 0, sellFeeRate: 0, sellTaxRate: 0, slippageRate: 0 };
    const order = (tradeId: string, side: 'BUY' | 'SELL', quantity: number, price: number, selectionId?: string): PaperAccountOrder => ({
      id: `${tradeId}:${side}`, tradeId, symbol: tradeId, name: tradeId, side, signalAt: at, submittedAt: at, updatedAt: at,
      signalSnapshotId: 'scan', signalReason: 'test', signalLabel: 'test', purpose: 'VALIDATED', quantity, budget: 10000,
      costModel, status: 'FILLED', statusReason: 'test', ...(selectionId ? { selectionId } : {}),
      fill: accountFill(side, quantity, { price, observedAt: at, source: 'KIS', snapshotId: 'scan' }, costModel, at, `${tradeId}:${side}:fill`),
    });
    account.orders = [order('a', 'BUY', 10, 100, 'day1'), order('b', 'BUY', 1, 100, 'day2'),
      order('open', 'BUY', 1, 100, 'day1'), order('a', 'SELL', 10, 110), order('b', 'SELL', 1, 90)];
    expect(paperAccountPerformance(account)).toMatchObject({ closedCount: 2, openCount: 1, realizedPnl: 90,
      meanNetReturnPct: 0, winRatePct: 50, meanWinPct: 10, meanLossPct: -10, profitFactor: 10 });
    expect(paperAccountPerformance(account, 'day1')).toMatchObject({ closedCount: 1, openCount: 1, realizedPnl: 100, meanNetReturnPct: 10, profitFactor: null });
    expect(paperAccountPerformance(account, 'unknown')).toMatchObject({ closedCount: 0, meanNetReturnPct: null, realizedPnl: 0 });
  });
});

const quoteAt = '2026-09-18T01:00:00Z';
function sampleOrder(tradeId: string, side: 'BUY' | 'SELL', status: PaperAccountOrder['status'], selectionId?: string,
  reason = 'test'): PaperAccountOrder {
  const costModel = { version: 'test', buyFeeRate: 0, sellFeeRate: 0, sellTaxRate: 0, slippageRate: 0 };
  return { id: `${tradeId}:${side}`, tradeId, symbol: tradeId, name: tradeId, side, signalAt: quoteAt,
    submittedAt: quoteAt, updatedAt: quoteAt, signalSnapshotId: 'scan', signalReason: 'test', signalLabel: 'test',
    purpose: 'VALIDATED', quantity: status === 'FILLED' ? 1 : 0, budget: 100, costModel, status, statusReason: reason, selectionId,
    fill: status === 'FILLED' ? accountFill(side, 1, { price: 100, observedAt: quoteAt, source: 'KIS', snapshotId: 'scan' },
      costModel, quoteAt, `${tradeId}:${side}:fill`) : null };
}
describe('account selection order attribution', () => {
  it('counts buy outcomes without adding daily excluded signals or later sells to the denominator', () => {
    const account = createPaperAccount({ initialCash: 10000, maxPositionPct: 20, includeExploration: false }, quoteAt, 'account');
    account.orders = [sampleOrder('a', 'BUY', 'FILLED', 'day1'), sampleOrder('a', 'SELL', 'FILLED', 'day2'),
      sampleOrder('b', 'BUY', 'REJECTED', 'day1', '동시 보유 한도'), sampleOrder('c', 'BUY', 'REJECTED', 'day1', '동시 보유 한도'),
      sampleOrder('d', 'BUY', 'PENDING', 'day1', '가격 대기'), sampleOrder('e', 'BUY', 'EXPIRED', 'day1', '시간 만료'),
      sampleOrder('f', 'BUY', 'FILLED', 'day2'), sampleOrder('f', 'SELL', 'FILLED', 'day1')];
    account.skippedSignals = { through: quoteAt, counts: { '2026-09-18': { '다른 규칙': 100 } } };
    const before = JSON.stringify(account), result = paperAccountOrderReview(account, 'day1');
    expect(result).toMatchObject({ buyCount: 5, counts: { FILLED: 1, REJECTED: 2, PENDING: 1, EXPIRED: 1 } });
    expect(result.reasons).toContainEqual({ status: 'REJECTED', reason: '동시 보유 한도', count: 2 });
    expect(result.orders.map(order => order.id)).toEqual(['a:BUY', 'a:SELL', 'b:BUY', 'c:BUY', 'd:BUY', 'e:BUY']);
    expect(paperAccountPerformance(account, 'day1')).toMatchObject({ closedCount: 1, openCount: 0, meanNetReturnPct: 0 });
    expect(JSON.stringify(account)).toBe(before);
  });
  it('keeps missing and dangling selection references visible without attributing them by date', () => {
    const account = createPaperAccount({ initialCash: 10000, maxPositionPct: 20, includeExploration: false }, quoteAt, 'account');
    account.selections = [{ id: 'known' }] as NonNullable<typeof account.selections>;
    account.orders = [sampleOrder('old', 'BUY', 'FILLED'), sampleOrder('old', 'SELL', 'FILLED', 'known'),
      sampleOrder('dangling', 'BUY', 'REJECTED', 'missing'), sampleOrder('new', 'BUY', 'FILLED', 'known')];
    expect(paperAccountOrderReview(account, null)).toMatchObject({ buyCount: 2 });
    expect(paperAccountOrderReview(account, null).orders.map(order => order.id)).toEqual(['old:BUY', 'old:SELL', 'dangling:BUY']);
    expect(paperAccountOrderReview(account).buyCount).toBe(3);
    expect(paperAccountOrderReview(account).orders).toEqual(account.orders);
    expect(paperAccountOrderReview(account, 'no-orders')).toMatchObject({ buyCount: 0, orders: [], reasons: [] });
    delete account.selections;
    expect(paperAccountOrderReview(account, null).buyCount).toBe(3);
  });
});
