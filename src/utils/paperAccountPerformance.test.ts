// @responsibility Verify realized account profit excludes historical selection scores.
import { describe, expect, it } from 'vitest';
import { accountFill, createPaperAccount } from '../../server/trading/paper/paperAccount.js';
import { paperAccountPerformance } from './paperAccountPerformance';
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
