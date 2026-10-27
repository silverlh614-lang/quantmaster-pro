// @responsibility Verify the account protection replay against hand-computed results.
import { describe, expect, it } from 'vitest';
import type { PaperAccountLedger, PaperAccountOrder } from '../../../src/types/paperAccount.js';
import type { PaperCostModel } from '../../../src/types/paperExperiment.js';
import type { PaperStrategyTrade } from '../../../src/types/paperStrategy.js';
import { createPaperAccount } from './paperAccount.js';
import { studyPaperAccountProtection, type PaperProtectionRule } from './paperAccountProtection.js';

const cost = { version: 'test', buyFeeRate: 0, sellFeeRate: 0, sellTaxRate: 0, slippageRate: 0 } as PaperCostModel;
const quote = (at: string, price: number) => ({ price, observedAt: at, source: 'KIS', snapshotId: at });
function order(tradeId: string, side: 'BUY' | 'SELL', at: string, price: number, quantity: number,
  status: PaperAccountOrder['status'] = 'FILLED', statusReason = '체결'): PaperAccountOrder {
  const amount = price * quantity;
  return { id: `${tradeId}:${side}`, tradeId, symbol: tradeId, name: tradeId, side, signalAt: at, submittedAt: at, updatedAt: at,
    signalSnapshotId: at, signalReason: '', signalLabel: '', purpose: 'VALIDATED', quantity, budget: amount, costModel: cost,
    status, statusReason, fill: status === 'FILLED' ? { id: `${tradeId}:${side}:fill`, at, snapshotId: at, quote: quote(at, price),
      quantity, price, grossAmount: amount, fee: 0, tax: 0, cashDelta: side === 'BUY' ? -amount : amount } : null };
}
function ledger(maxPositionPct: number, orders: PaperAccountOrder[], marks: PaperAccountLedger['marks'] = {}): PaperAccountLedger {
  const account = createPaperAccount({ initialCash: 1_000_000, maxPositionPct, includeExploration: false }, '2026-09-13T00:00:00Z', 'acct');
  return { ...account, orders, marks };
}
const rule = (key: string, investedCapPct: number, brake?: PaperProtectionRule['brake']): PaperProtectionRule => ({ key, label: key, investedCapPct, brake });

describe('account protection replay', () => {
  it('reproduces the recorded account under the current rule, valuing an open holding at its latest mark', () => {
    const account = ledger(50, [order('A', 'BUY', '2026-09-14T01:00:00Z', 10_000, 50), order('B', 'BUY', '2026-09-14T01:00:00Z', 5_000, 100),
      order('A', 'SELL', '2026-09-15T01:00:00Z', 9_000, 50)], { B: quote('2026-09-15T06:00:00Z', 6_000) });
    const [current] = studyPaperAccountProtection(account, [], '2026-09-15T07:00:00Z', [rule('CURRENT', 100)]).results;
    // Cash 450,000 + B 100 × 6,000 = 1,050,000.
    expect(current).toMatchObject({ buyCount: 2, pausedSkips: 0, brakeCount: 0 });
    expect(current.returnPct).toBeCloseTo(5);
  });

  it('holds fewer stocks under an invested-share cap', () => {
    const at = '2026-09-14T01:00:00Z', sold = '2026-09-15T01:00:00Z';
    const account = ledger(25, ['A', 'B', 'C'].flatMap(id => [order(id, 'BUY', at, 1_000, 250), order(id, 'SELL', sold, 900, 250)]));
    const [current, half] = studyPaperAccountProtection(account, [], '2026-09-15T07:00:00Z', [rule('CURRENT', 100), rule('CAP_50', 50)]).results;
    expect([current.buyCount, half.buyCount]).toEqual([3, 2]);
    // Three 250,000 lots losing 10% versus two.
    expect(current.returnPct).toBeCloseTo(-7.5);
    expect(half.returnPct).toBeCloseTo(-5);
  });

  it('pauses new buys after a fall, then resumes on the set trading day with signals the full account had to skip', () => {
    const skipped = order('C', 'BUY', '2026-09-16T01:00:00Z', 0, 0, 'REJECTED', '동시 보유 한도 2종목 도달');
    const tradeC = { id: 'C', entryPrice: 2_000, exit: { price: 2_400, decisionAt: '2026-09-17T02:00:00Z' } } as unknown as PaperStrategyTrade;
    const account = ledger(50, [order('A', 'BUY', '2026-09-14T01:00:00Z', 10_000, 50), order('A', 'SELL', '2026-09-14T03:00:00Z', 8_000, 50),
      order('B', 'BUY', '2026-09-15T01:00:00Z', 1_000, 450), order('B', 'SELL', '2026-09-15T05:00:00Z', 1_100, 450), skipped]);
    const study = studyPaperAccountProtection(account, [tradeC], '2026-09-18T07:00:00Z',
      [rule('CURRENT', 100), rule('BRAKE', 100, { drawdownPct: 7, pauseTradingDays: 2 })]);
    expect(study).toMatchObject({ candidateCount: 3, estimatedCount: 1 });
    const [current, brake] = study.results;
    // Current: −100,000 on A, +45,000 on B, then 236 × 400 on C.
    expect(current.buyCount).toBe(3);
    expect(current.returnPct).toBeCloseTo((1_000_000 - 100_000 + 45_000 + 236 * 400) / 10_000 - 100);
    // The 10% fall on 9/14 pauses buys until the second trading day after (9/16): B is skipped, C bought with 450,000.
    expect(brake).toMatchObject({ buyCount: 2, pausedSkips: 1, brakeCount: 1 });
    expect(brake.returnPct).toBeCloseTo(-1);
    expect(brake.maxDrawdownPct).toBeCloseTo(10);
  });

  it('never buys the same stock twice and ignores refusals other than the holding limit', () => {
    const account = ledger(50, [order('A', 'BUY', '2026-09-14T01:00:00Z', 1_000, 500),
      order('X', 'BUY', '2026-09-14T02:00:00Z', 0, 0, 'REJECTED', '가격 유효시간 초과')]);
    const study = studyPaperAccountProtection(account, [], '2026-09-14T07:00:00Z', [rule('CURRENT', 100)]);
    expect(study.candidateCount).toBe(1);
    // No mark: the open holding is valued at its purchase cost.
    expect(study.results[0].returnPct).toBeCloseTo(0);
  });
});
