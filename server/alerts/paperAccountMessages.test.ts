// @responsibility Verify account notification provenance with replay-safe queues.
import { describe, expect, it } from 'vitest';
import type { PaperBotState } from '../persistence/paperBotRepo.js';
import type { PaperAccountOrder } from '../../src/types/paperAccount.js';
import { accountFill, createPaperAccount, buildPaperAccountView } from '../trading/paper/paperAccount.js';
import { enqueueAccountExecutions, enqueueAccountHealth, formatAccountSummary, retireSignalTradeAlerts } from './paperAccountMessages.js';

const now = new Date('2026-09-18T01:00:00Z');
const state = (): PaperBotState => ({ schemaVersion: 1, initializedAt: null, lastCheckedAt: null, health: 'OK', notifiedHealth: 'OK', seenEvents: {}, messages: [] });
function accountView(count = 1) {
  const account = createPaperAccount({ initialCash: 10000000, maxPositionPct: 20, includeExploration: true }, '2026-09-18T00:00:00Z', 'account');
  const costModel = { version: 'test', buyFeeRate: 0, sellFeeRate: 0, sellTaxRate: 0, slippageRate: 0 };
  account.orders = Array.from({ length: count }, (_, index): PaperAccountOrder => ({ id: `t${index}:BUY`, tradeId: `t${index}`, symbol: String(100000 + index), name: '<&>'.repeat(40),
    side: 'BUY', signalAt: now.toISOString(), submittedAt: now.toISOString(), updatedAt: now.toISOString(), signalSnapshotId: 's',
    signalReason: '&'.repeat(300), signalLabel: 'rsi14', purpose: 'VALIDATED', quantity: 37, budget: 400000, costModel,
    status: 'FILLED', statusReason: '가상 체결', fill: accountFill('BUY', 37,
      { price: 10000, source: 'KIS', observedAt: now.toISOString(), snapshotId: 's' }, costModel, now.toISOString(), `t${index}:BUY:fill`) }));
  return buildPaperAccountView(account, now.toISOString());
}
describe('account-only notifications', () => {
  it('baselines existing fills on upgrade, then queues each future fill once in bounded escaped batches', () => {
    const queue = state(), old = accountView();
    enqueueAccountExecutions(queue, old, now); expect(queue.messages).toHaveLength(0);
    const view = accountView(23), before = JSON.stringify(view);
    enqueueAccountExecutions(queue, view, now);
    expect(queue.messages.length).toBeGreaterThan(0);
    for (const channel of ['TRADE', 'ANALYSIS']) {
      const messages = queue.messages.filter(item => item.channel === channel);
      const body = messages.map(item => item.message).join('\n');
      expect(body).not.toContain('(100000)');
      for (let index = 1; index < 23; index++) expect(body.split(`(${100000 + index})`)).toHaveLength(2);
      for (const message of messages) { expect(message.message.length).toBeLessThanOrEqual(3500); expect(message.message).toContain('&lt;&amp;&gt;'); }
      expect(body).toContain('37주');
    }
    const saved = JSON.parse(JSON.stringify(queue)); enqueueAccountExecutions(saved, view, now);
    expect(saved.messages).toEqual(queue.messages); expect(JSON.stringify(view)).toBe(before);
  });
  it('never sends rejected, expired, pending, future fills or unconfirmed account state to CH1', () => {
    for (const status of ['REJECTED', 'EXPIRED', 'PENDING'] as const) {
      const queue = state(); queue.accountInitializedAt = '2026-09-18T00:00:00Z';
      const view = accountView(); view.account!.orders[0].status = status; view.account!.orders[0].fill = null;
      enqueueAccountExecutions(queue, view, now); expect(queue.messages).toHaveLength(0);
      expect(formatAccountSummary(view, now)).toContain(status === 'PENDING' ? '체결 대기 1건' : '미매수 1건');
    }
    const queue = state(); queue.accountInitializedAt = '2026-09-18T00:00:00Z';
    const future = accountView(); future.account!.orders[0].fill!.at = '2026-09-18T02:00:00Z';
    enqueueAccountExecutions(queue, future, now); enqueueAccountExecutions(queue, { ...accountView(), error: 'read failed' }, now);
    expect(queue.messages).toHaveLength(0);
  });
  it('reports realized account PnL using both cash movements rather than a one-share signal return', () => {
    const view = accountView(), buy = view.account!.orders[0];
    view.account!.orders.push({ ...buy, id: 't0:SELL', side: 'SELL', fill: accountFill('SELL', 37,
      { ...buy.fill!.quote, price: 11000 }, buy.costModel, now.toISOString(), 't0:SELL:fill') });
    const queue = state(); queue.accountInitializedAt = '2026-09-18T00:00:00Z';
    enqueueAccountExecutions(queue, view, now);
    expect(queue.messages.find(item => item.channel === 'TRADE')!.message).toContain('실현손익 37,000원');
  });
  it('retires pending old signal alerts but preserves sent originals and account retries', () => {
    const queue = state(); queue.accountInitializedAt = '2026-09-18T00:00:00Z'; enqueueAccountExecutions(queue, accountView(), now);
    const pending = queue.messages[0];
    queue.messages.push({ ...pending, id: 'paper:trades:legacy:TRADE' }, { ...pending, id: 'old-sent', state: 'SENT', messageId: 10 });
    retireSignalTradeAlerts(queue);
    expect(queue.messages[0].state).toBe('PENDING'); expect(queue.messages.at(-2)?.state).toBe('SUPERSEDED');
    expect(queue.messages.at(-1)).toMatchObject({ state: 'SENT', messageId: 10 });
  });
  it('sends account failure and recovery transitions privately without repeated minute alerts', () => {
    const queue = state(); enqueueAccountHealth(queue, undefined, now); enqueueAccountHealth(queue, undefined, now);
    expect(queue.messages).toHaveLength(1); expect(queue.messages[0].channel).toBeUndefined();
    enqueueAccountHealth(queue, accountView(), new Date(now.getTime() + 60000));
    expect(queue.messages[0].state).toBe('SUPERSEDED'); expect(queue.messages[1].message).toContain('오류 해소');
    expect(queue.messages[1].channel).toBeUndefined();
  });
});
