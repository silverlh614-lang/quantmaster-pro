// @responsibility Verify virtual account cash conservation through signal lifecycles.
import { describe, expect, it } from 'vitest';
import { accountBalances, advancePaperAccount, buildPaperAccountView, createPaperAccount } from './paperAccount.js';
import { assertPaperAccount } from './paperAccountValidation.js';
import { legacyStrategyLedger, strategyTestSnapshot } from './paperStrategyFixtures.js';
import type { PaperStrategyTrade } from '../../../src/types/paperStrategy.js';

function fixture() {
  const strategy = legacyStrategyLedger(), snapshot = strategyTestSnapshot();
  const trade = strategy.trades[0];
  trade.id = 'signal-1'; trade.strategyVersion = 'adaptive-features-v1'; trade.entrySnapshotId = snapshot.id;
  trade.entryAt = snapshot.asOf; trade.entryPrice = 100; trade.tradingDate = snapshot.tradingDate;
  trade.costModel = { version: 'cost-v1', buyFeeRate: 0.001, sellFeeRate: 0.001, sellTaxRate: 0.002, slippageRate: 0.001 };
  snapshot.observations[0].symbol = trade.symbol; snapshot.observations[0].price = 100;
  snapshot.observations[0].observedAt = snapshot.asOf; snapshot.observations[0].source = 'KIS_REST_REQUEST_OBSERVED';
  const account = createPaperAccount({ initialCash: 10000, maxPositionPct: 20, includeExploration: false },
    new Date(Date.parse(snapshot.asOf) - 60000).toISOString(), 'virtual-test');
  return { strategy, snapshot, account, trade };
}
function next(f: ReturnType<typeof fixture>, price: number | null = 110) {
  f.snapshot.id += '-next'; f.snapshot.asOf = new Date(Date.parse(f.snapshot.asOf) + 60000).toISOString();
  f.snapshot.observations[0].observedAt = f.snapshot.asOf; f.snapshot.observations[0].price = price;
}
function close(f: ReturnType<typeof fixture>) {
  f.trade.status = 'CLOSED';
  f.trade.exit = { model: 'ADAPTIVE_OBSERVED', snapshotId: f.snapshot.id, price: 110, netPnl: 0, netReturnPct: 0, grossReturnPct: 10,
    decisionAt: f.snapshot.asOf, effectiveAt: f.snapshot.asOf, observedAt: f.snapshot.asOf,
    decision: { ...f.trade.entryDecision, action: 'EXIT', reason: '손실 제한', decisionAt: f.snapshot.asOf } };
}
describe('virtual account', () => {
  it('sizes integer shares with costs, settles both sides and conserves equity', () => {
    const f = fixture(), original = JSON.stringify(f);
    const bought = advancePaperAccount(f.account, f.strategy, f.snapshot);
    expect(bought.orders[0]).toMatchObject({ quantity: 19, status: 'FILLED', budget: 2000 });
    expect(accountBalances(bought).cash).toBe(8096.2);
    expect(buildPaperAccountView(bought, f.snapshot.asOf).equity).toBe(9988.6);
    expect(JSON.stringify(f)).toBe(original); assertPaperAccount(bought);
    next(f); close(f);
    const sold = advancePaperAccount(bought, f.strategy, f.snapshot), view = buildPaperAccountView(sold, f.snapshot.asOf);
    expect(view).toMatchObject({ cash: 10177.84, realizedPnl: 177.84, unrealizedPnl: 0, equity: 10177.84, positions: [] });
    expect(view.returnPct).toBeCloseTo(1.7784); assertPaperAccount(sold);
    expect(advancePaperAccount(sold, f.strategy, f.snapshot)).toBe(sold);
  });
  it('does not overspend or retry unfunded signals after restart', () => {
    const f = fixture(); f.account.config.maxPositionPct = 100;
    const second = { ...structuredClone(f.trade), id: 'signal-2', symbol: '999999' };
    f.strategy.trades.push(second); f.snapshot.observations.push({ ...f.snapshot.observations[0], symbol: second.symbol });
    const first = advancePaperAccount(f.account, f.strategy, f.snapshot);
    expect(first.orders.map(order => order.status)).toEqual(['FILLED', 'REJECTED']);
    expect(accountBalances(first).cash).toBeGreaterThanOrEqual(0);
    next(f);
    const replayed = advancePaperAccount(JSON.parse(JSON.stringify(first)), f.strategy, f.snapshot);
    expect(replayed.orders).toEqual(first.orders); assertPaperAccount(replayed);
  });
  it.each(['stale', 'future', 'estimated', 'missing', 'closed', 'beforeStart'])('rejects %s quotes instead of manufacturing fills', issue => {
    const f = fixture(), quote = f.snapshot.observations[0];
    if (issue === 'stale') quote.observedAt = new Date(Date.parse(f.snapshot.asOf) - 121000).toISOString();
    if (issue === 'future') quote.observedAt = new Date(Date.parse(f.snapshot.asOf) + 1).toISOString();
    if (issue === 'estimated') quote.source = 'AI_ESTIMATED';
    if (issue === 'missing') quote.price = null;
    if (issue === 'closed') f.snapshot.marketOpen = false;
    if (issue === 'beforeStart') quote.observedAt = new Date(Date.parse(f.account.startedAt) - 1).toISOString();
    const result = advancePaperAccount(f.account, f.strategy, f.snapshot);
    expect(result.orders[0].status).toBe('REJECTED'); expect(accountBalances(result).cash).toBe(10000); assertPaperAccount(result);
  });
  it('does not import pre-start positions or backdate missed orders', () => {
    const f = fixture(); f.trade.entryAt = new Date(Date.parse(f.account.startedAt) - 1).toISOString();
    expect(advancePaperAccount(f.account, f.strategy, f.snapshot).orders).toHaveLength(0);
    f.trade.entryAt = f.snapshot.asOf; f.trade.entrySnapshotId = 'missed-snapshot';
    expect(advancePaperAccount(f.account, f.strategy, f.snapshot).orders[0]).toMatchObject({ status: 'EXPIRED', fill: null });
  });
  it('persists pending sells until fresh prices arrive, without backdating exit fills', () => {
    const f = fixture(), bought = advancePaperAccount(f.account, f.strategy, f.snapshot);
    next(f, null); close(f);
    const pending = advancePaperAccount(bought, f.strategy, f.snapshot);
    expect(pending.orders[1].status).toBe('PENDING'); expect(accountBalances(pending).buys.size).toBe(1); assertPaperAccount(pending);
    const signalAt = f.trade.exit!.decisionAt;
    next(f, 105);
    const sold = advancePaperAccount(JSON.parse(JSON.stringify(pending)), f.strategy, f.snapshot);
    expect(sold.orders[1]).toMatchObject({ status: 'FILLED', signalAt, fill: { at: f.snapshot.asOf, quote: { price: 105 } } });
    assertPaperAccount(sold);
  });
  it('keeps exit processing active while new account buys are paused', () => {
    const f = fixture(), bought = advancePaperAccount(f.account, f.strategy, f.snapshot);
    bought.buyPaused = true; bought.controls.push({ at: f.snapshot.asOf, buyPaused: true });
    next(f); close(f);
    const another = { ...structuredClone(f.trade), id: 'next', symbol: '999999', status: 'OPEN', exit: null,
      entrySnapshotId: f.snapshot.id, entryAt: f.snapshot.asOf } as PaperStrategyTrade;
    f.strategy.trades.push(another);
    const result = advancePaperAccount(bought, f.strategy, f.snapshot);
    expect(result.orders[1].status).toBe('FILLED'); expect(result.orders[2].statusReason).toBe('계좌 신규 매수 일시정지');
    assertPaperAccount(result);
  });
  it('reuses sale proceeds for a new signal in the same snapshot', () => {
    const f = fixture(); f.account.config.maxPositionPct = 100;
    const bought = advancePaperAccount(f.account, f.strategy, f.snapshot);
    next(f); close(f);
    const replacement = { ...structuredClone(f.trade), id: 'replacement', symbol: '999999', status: 'OPEN', exit: null,
      entrySnapshotId: f.snapshot.id, entryAt: f.snapshot.asOf } as PaperStrategyTrade;
    f.strategy.trades.push(replacement); f.snapshot.observations.push({ ...f.snapshot.observations[0], symbol: replacement.symbol });
    const result = advancePaperAccount(bought, f.strategy, f.snapshot);
    expect(result.orders.slice(1).map(order => [order.side, order.status])).toEqual([['SELL', 'FILLED'], ['BUY', 'FILLED']]);
    expect(result.orders[2].budget).toBeGreaterThan(10000);
    expect(accountBalances(result).cash).toBeGreaterThanOrEqual(0); assertPaperAccount(result);
  });
  it('rejects duplicate symbol holdings even when a second trade id is supplied', () => {
    const f = fixture(); f.strategy.trades.push({ ...structuredClone(f.trade), id: 'duplicate-symbol' });
    const result = advancePaperAccount(f.account, f.strategy, f.snapshot);
    expect(result.orders[1]).toMatchObject({ status: 'REJECTED', statusReason: '동일 종목 보유 중', fill: null });
    assertPaperAccount(result);
  });
  it('keeps exploratory signals outside the account unless configured', () => {
    const f = fixture();
    f.trade.entryDecision.explorationEvidence = {} as NonNullable<PaperStrategyTrade['entryDecision']['explorationEvidence']>;
    expect(advancePaperAccount(f.account, f.strategy, f.snapshot).orders[0].statusReason).toBe('탐색 매수 제외 설정');
    f.account.config.includeExploration = true;
    expect(advancePaperAccount(f.account, f.strategy, f.snapshot).orders[0].status).toBe('FILLED');
  });
  it('marks old valuations as stale and rejects corrupted ledger balances', () => {
    const f = fixture(), bought = advancePaperAccount(f.account, f.strategy, f.snapshot);
    const later = new Date(Date.parse(f.snapshot.asOf) + 180000).toISOString();
    expect(buildPaperAccountView(bought, later).positions[0].stale).toBe(true);
    bought.orders[0].fill!.cashDelta += 1;
    expect(() => assertPaperAccount(bought)).toThrow('fill cashDelta');
    expect(() => createPaperAccount({ initialCash: -1, maxPositionPct: 20, includeExploration: false }, later, 'id')).toThrow();
  });
});
