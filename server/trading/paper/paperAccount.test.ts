// @responsibility Verify virtual account cash conservation through signal lifecycles.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ACCOUNT_HALT_WAIT, ACCOUNT_IDLE_SAVE_MS, accountBalances, accountNeedsSave, advancePaperAccount, buildPaperAccountView, createPaperAccount } from './paperAccount.js';
import { assertPaperAccount } from './paperAccountValidation.js';
import { accountSignalFixture } from './paperAccountFixtures.js';
import { selectAccountPolicy } from './paperAccountSelection.js';
import type { PaperStrategyTrade } from '../../../src/types/paperStrategy.js';

function fixture() {
  const { strategy, snapshot, trade } = accountSignalFixture();
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
  it('sizes simultaneous buys by holding slot without overspending or repeating after restart', () => {
    const f = fixture(); f.account.config.maxPositionPct = 50;
    const second = { ...structuredClone(f.trade), id: 'signal-2', symbol: '999999' };
    f.strategy.trades.push(second); f.snapshot.observations.push({ ...f.snapshot.observations[0], symbol: second.symbol });
    const first = advancePaperAccount(f.account, f.strategy, f.snapshot);
    expect(first.orders.map(order => order.status)).toEqual(['FILLED', 'FILLED']);
    expect(first.orders.map(order => order.budget)).toEqual([5000, 5000]);
    expect(accountBalances(first).cash).toBeGreaterThanOrEqual(0);
    next(f);
    const replayed = advancePaperAccount(JSON.parse(JSON.stringify(first)), f.strategy, f.snapshot);
    expect(replayed.orders).toEqual(first.orders); assertPaperAccount(replayed);
  });
  it('gives crowded signals the same per-stock size and fills free slots in a shuffled order', () => {
    const f = fixture(), symbols = ['100001', '100002', '100003', '100004', '100005', '100006', '100007'];
    for (const [index, symbol] of symbols.entries()) {
      f.strategy.trades.push({ ...structuredClone(f.trade), id: `signal-${index + 2}`, symbol });
      f.snapshot.observations.push({ ...f.snapshot.observations[0], symbol });
    }
    const rank = (symbol: string) => createHash('sha256').update(`${f.snapshot.tradingDate}:${symbol}`).digest('hex');
    const chosen = [f.trade.symbol, ...symbols].sort((a, b) => rank(a).localeCompare(rank(b))).slice(0, 5).sort();
    const result = advancePaperAccount(f.account, f.strategy, f.snapshot);
    const filled = result.orders.filter(order => order.status === 'FILLED');
    // Eight same-time signals no longer shrink each position to cash ÷ 8; five slots of 20% are filled.
    expect(filled.map(order => order.symbol).sort()).toEqual(chosen);
    expect(filled.every(order => order.budget === 2000)).toBe(true);
    expect(result.orders.filter(order => order.status === 'REJECTED').map(order => order.statusReason))
      .toEqual(Array(3).fill('동시 보유 한도 5종목 도달'));
    assertPaperAccount(result);
    const reversed = advancePaperAccount(f.account, { ...f.strategy, trades: [...f.strategy.trades].reverse() }, f.snapshot);
    expect(reversed.orders.filter(order => order.status === 'FILLED').map(order => order.symbol).sort()).toEqual(chosen);
    next(f);
    const later = { ...structuredClone(f.trade), id: 'signal-late', symbol: '100008', entrySnapshotId: f.snapshot.id, entryAt: f.snapshot.asOf };
    f.strategy.trades.push(later); f.snapshot.observations.push({ ...f.snapshot.observations[0], symbol: later.symbol });
    const full = advancePaperAccount(result, f.strategy, f.snapshot);
    expect(full.orders.at(-1)).toMatchObject({ symbol: '100008', status: 'REJECTED', statusReason: '동시 보유 한도 5종목 도달', budget: 0 });
    assertPaperAccount(full);
  });
  it('applies a weight change only to buys at or after it and keeps earlier orders as recorded', () => {
    const f = fixture();
    // A change recorded after this snapshot cannot resize it.
    f.account.weightChanges = [{ at: new Date(Date.parse(f.snapshot.asOf) + 1).toISOString(), maxPositionPct: 10 }];
    const first = advancePaperAccount(f.account, f.strategy, f.snapshot);
    expect(first.orders[0]).toMatchObject({ status: 'FILLED', budget: 2000 });
    assertPaperAccount(first);
    const signal = (symbol: string, index: number) => {
      const trade = { ...structuredClone(f.trade), id: `signal-late-${index}`, symbol, entrySnapshotId: f.snapshot.id, entryAt: f.snapshot.asOf };
      f.strategy.trades.push(trade); f.snapshot.observations.push({ ...f.snapshot.observations[0], symbol });
    };
    next(f); ['100001', '100002', '100003'].forEach(signal);
    const resized = advancePaperAccount(first, f.strategy, f.snapshot), added = resized.orders.slice(first.orders.length);
    expect(resized.orders.slice(0, first.orders.length)).toEqual(first.orders);
    expect(added.map(order => order.status)).toEqual(['FILLED', 'FILLED', 'FILLED']);
    expect(added.every(order => order.budget > 900 && order.budget < 1100)).toBe(true);
    assertPaperAccount(resized);
    // Raising the weight lowers the slot count; four holdings above two slots wait instead of being sold.
    resized.weightChanges!.push({ at: f.snapshot.asOf, maxPositionPct: 50 });
    next(f); signal('100004', 9);
    const capped = advancePaperAccount(resized, f.strategy, f.snapshot);
    expect(capped.orders.at(-1)).toMatchObject({ symbol: '100004', status: 'REJECTED', statusReason: '동시 보유 한도 2종목 도달' });
    expect(accountBalances(capped).buys.size).toBe(4);
    assertPaperAccount(capped);
    for (const bad of [[{ at: f.account.startedAt, maxPositionPct: 0 }], [{ at: 'later', maxPositionPct: 10 }],
      [{ at: f.snapshot.asOf, maxPositionPct: 10 }, { at: f.account.startedAt, maxPositionPct: 5 }]]) {
      expect(() => assertPaperAccount({ ...capped, weightChanges: bad })).toThrow('weight');
    }
  });
  it.each(['stale', 'future', 'estimated', 'missing', 'closed', 'beforeStart'])('rejects %s quotes instead of manufacturing fills', issue => {
    const f = fixture(), quote = f.snapshot.observations[0];
    if (issue === 'stale') quote.observedAt = new Date(Date.parse(f.snapshot.asOf) - 121000).toISOString();
    if (issue === 'future') quote.observedAt = new Date(Date.parse(f.snapshot.asOf) + 1).toISOString();
    if (issue === 'estimated') quote.source = 'AI_ESTIMATED';
    if (issue === 'missing') quote.price = null;
    // The day's rule is chosen during the session; a later closed-market quote must still be refused.
    if (issue === 'closed') { selectAccountPolicy(f.account, f.strategy.adaptive, f.snapshot); f.snapshot.marketOpen = false; }
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
  it('records stale price age and never retries a rejected order against a later quote', () => {
    const f = fixture();
    f.snapshot.asOf = new Date(Date.parse(f.snapshot.asOf) + 162_504).toISOString();
    f.trade.entryAt = f.snapshot.asOf;
    const rejected = advancePaperAccount(f.account, f.strategy, f.snapshot);
    expect(rejected.orders[0]).toMatchObject({ status: 'REJECTED', budget: 0, quantity: 0, fill: null });
    expect(rejected.orders[0].statusReason).toContain('163초 전 관측 (허용 120초)');
    expect(rejected.orders[0].statusReason).toContain(f.snapshot.observations[0].observedAt);
    next(f);
    const later = advancePaperAccount(rejected, f.strategy, f.snapshot);
    expect(later.orders).toEqual(rejected.orders); expect(accountBalances(later).cash).toBe(10000);
    assertPaperAccount(later);
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
  it('values a halted holding at its last price and sells only at the first valid price after the halt lifts', () => {
    const f = fixture(), bought = advancePaperAccount(f.account, f.strategy, f.snapshot), lastMark = bought.marks[f.trade.id];
    next(f, null); close(f); f.snapshot.observations[0].issue = 'TRADING_HALTED';
    const halted = advancePaperAccount(bought, f.strategy, f.snapshot);
    expect(halted.orders[1]).toMatchObject({ side: 'SELL', status: 'PENDING', statusReason: ACCOUNT_HALT_WAIT, fill: null });
    expect(halted.marks[f.trade.id]).toEqual(lastMark); assertPaperAccount(halted);
    expect(buildPaperAccountView(halted, f.snapshot.asOf, undefined, new Set([f.trade.symbol])).positions[0])
      .toMatchObject({ halted: true, mark: lastMark });
    expect(buildPaperAccountView(halted, f.snapshot.asOf).positions[0]).not.toHaveProperty('halted');
    next(f, 80); delete f.snapshot.observations[0].issue;
    const sold = advancePaperAccount(halted, f.strategy, f.snapshot);
    expect(sold.orders[1]).toMatchObject({ status: 'FILLED', fill: { at: f.snapshot.asOf, quote: { price: 80 } } });
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
  it('keeps exploratory signals in research even for an old exploration-enabled account', () => {
    const f = fixture();
    f.trade.entryDecision.explorationEvidence = {} as NonNullable<PaperStrategyTrade['entryDecision']['explorationEvidence']>;
    const counted = advancePaperAccount(f.account, f.strategy, f.snapshot);
    expect(counted.orders).toEqual([]);
    expect(counted.skippedSignals).toEqual({ through: f.trade.entryAt,
      counts: { [f.trade.tradingDate]: { '계좌는 검증 기준만 운용 · 탐색 신호는 1주 연구로 유지': 1 } } });
    assertPaperAccount(counted);
    f.account.config.includeExploration = true;
    expect(advancePaperAccount(f.account, f.strategy, f.snapshot).orders).toEqual([]);
  });
  it('counts signals outside the account rule once per day instead of storing rejected orders', () => {
    const f = fixture();
    f.trade.entryDecision.explorationEvidence = {} as NonNullable<PaperStrategyTrade['entryDecision']['explorationEvidence']>;
    const first = advancePaperAccount(f.account, f.strategy, f.snapshot);
    next(f);
    const later = { ...structuredClone(f.trade), id: 'later-exploration', entrySnapshotId: f.snapshot.id, entryAt: f.snapshot.asOf };
    f.strategy.trades.push(later);
    // A restarted account re-reads the strategy ledger; the earlier signal stays counted once.
    const second = advancePaperAccount(JSON.parse(JSON.stringify(first)), f.strategy, f.snapshot);
    expect(second.orders).toEqual([]);
    expect(second.skippedSignals).toEqual({ through: later.entryAt,
      counts: { [f.trade.tradingDate]: { '계좌는 검증 기준만 운용 · 탐색 신호는 1주 연구로 유지': 2 } } });
    assertPaperAccount(second);
  });
  it('keeps legacy rejected orders as the only record of earlier outside signals', () => {
    const f = fixture();
    f.trade.entryDecision.explorationEvidence = {} as NonNullable<PaperStrategyTrade['entryDecision']['explorationEvidence']>;
    const legacy = structuredClone(f.account);
    legacy.orders.push({ id: `${f.trade.id}:BUY`, tradeId: f.trade.id, symbol: f.trade.symbol, name: f.trade.name, side: 'BUY',
      signalAt: f.trade.entryAt, submittedAt: f.trade.entryAt, updatedAt: f.trade.entryAt, signalSnapshotId: f.snapshot.id,
      signalReason: 'legacy', signalLabel: 'legacy', purpose: 'EXPLORATION', quantity: 0, budget: 0, costModel: f.trade.costModel,
      status: 'REJECTED', statusReason: '계좌는 검증 기준만 운용 · 탐색 신호는 1주 연구로 유지', fill: null });
    const result = advancePaperAccount(legacy, f.strategy, f.snapshot);
    expect(result.orders).toEqual(legacy.orders); expect(result.skippedSignals).toBeUndefined();
  });
  it('rewrites the ledger only for account changes or after the idle interval', () => {
    const f = fixture(), bought = advancePaperAccount(f.account, f.strategy, f.snapshot);
    expect(accountNeedsSave(f.account, bought)).toBe(true);
    expect(accountNeedsSave(bought, bought)).toBe(false);
    next(f, 110);
    expect(accountNeedsSave(bought, advancePaperAccount(bought, f.strategy, f.snapshot))).toBe(true);
    // Without holdings or signals, a quote batch only advances the processed time and evaluation count.
    const idle = createPaperAccount(f.account.config, f.account.startedAt, 'idle'), empty = { ...f.strategy, trades: [] };
    const processed = advancePaperAccount(idle, empty, f.snapshot);
    next(f);
    const quiet = advancePaperAccount(processed, empty, f.snapshot);
    expect(quiet.lastSnapshotAt).not.toBe(processed.lastSnapshotAt); expect(accountNeedsSave(processed, quiet)).toBe(false);
    f.snapshot.asOf = new Date(Date.parse(processed.lastSnapshotAt!) + ACCOUNT_IDLE_SAVE_MS).toISOString();
    expect(accountNeedsSave(processed, advancePaperAccount(processed, empty, f.snapshot))).toBe(true);
  });
  it('marks old valuations as stale and rejects corrupted ledger balances', () => {
    const f = fixture(), bought = advancePaperAccount(f.account, f.strategy, f.snapshot);
    const later = new Date(Date.parse(f.snapshot.asOf) + 180000).toISOString();
    expect(buildPaperAccountView(bought, later).positions[0].stale).toBe(true);
    bought.orders[0].fill!.cashDelta += 1;
    expect(() => assertPaperAccount(bought)).toThrow('fill cashDelta');
    bought.orders[0].fill!.cashDelta -= 1;
    for (const counts of [{ '2026-09-18': { reason: 0 } }, { '2026-09-18': {} }, { '18-09-2026': { reason: 1 } }]) {
      expect(() => assertPaperAccount({ ...bought, skippedSignals: { through: bought.lastSnapshotAt!, counts } })).toThrow('skipped signal counts');
    }
    expect(() => assertPaperAccount({ ...bought, skippedSignals: { through: later, counts: {} } })).toThrow('skipped signal counts');
    expect(() => createPaperAccount({ initialCash: -1, maxPositionPct: 20, includeExploration: false }, later, 'id')).toThrow();
  });
});
