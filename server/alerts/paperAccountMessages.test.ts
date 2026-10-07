// @responsibility Verify account notification provenance with replay-safe queues.
import { describe, expect, it } from 'vitest';
import type { PaperBotState } from '../persistence/paperBotRepo.js';
import type { PaperAccountOrder } from '../../src/types/paperAccount.js';
import { accountFill, createPaperAccount, buildPaperAccountView } from '../trading/paper/paperAccount.js';
import { enqueueAccountExecutions, enqueueAccountHealth, formatAccountExecutions, formatAccountSummary, retireSignalTradeAlerts } from './paperAccountMessages.js';
import { accountSignalFixture } from '../trading/paper/paperAccountFixtures.js';
import { advancePaperAccount } from '../trading/paper/paperAccount.js';

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
  it('includes frozen policy evidence in bounded account analysis without reporting it as realized profit', () => {
    const f = accountSignalFixture();
    const account = advancePaperAccount(createPaperAccount({ initialCash: 10000, maxPositionPct: 20, includeExploration: false }, '2026-09-18T00:00:00Z', 'policy-account'), f.strategy, f.snapshot);
    const view = buildPaperAccountView(account, f.snapshot.asOf), queue = state();
    queue.accountInitializedAt = '2026-09-18T00:00:00Z'; enqueueAccountExecutions(queue, view, now);
    const message = queue.messages.find(item => item.channel === 'ANALYSIS')!.message;
    expect(message).toContain('검증 순수익 1순위 · 과거'); expect(message.length).toBeLessThanOrEqual(3500);
    expect(formatAccountSummary(view, now)).toContain('운용 기준 2026-09-18:');
    expect(formatAccountSummary(view, now)).toContain('실현손익 0원');
  });
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
    const counted = accountView(); counted.account!.orders[0].status = 'REJECTED'; counted.account!.orders[0].fill = null;
    counted.account!.orders[0].statusReason = '당일 선택한 수익성 우선 규칙과 다른 신호';
    counted.account!.skippedSignals = { through: now.toISOString(), counts: {
      '2026-09-17': { '당일 선택한 수익성 우선 규칙과 다른 신호': 9 }, '2026-09-18': { '당일 선택한 수익성 우선 규칙과 다른 신호': 4 } } };
    expect(formatAccountSummary(counted, now)).toContain('미매수 5건: 당일 선택한 수익성 우선 규칙과 다른 신호');
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
    expect(queue.messages.find(item => item.channel === 'TRADE')!.message).toContain('순수익률 <b>+10.00%</b> · 실현손익 +37,000원');
  });
  it('uses the approved CH1 layout for account fills and keeps evidence for CH2', () => {
    const view = accountView(), buy = view.account!.orders[0];
    buy.name = '지투지바이오'; buy.symbol = '456160'; buy.quantity = 10;
    buy.fill = accountFill('BUY', 10, { ...buy.fill!.quote, price: 43650, observedAt: '2026-10-06T00:10:00Z' }, buy.costModel, '2026-10-06T00:10:30Z', 't0:BUY:fill');
    const sell = { ...buy, id: 't0:SELL', side: 'SELL' as const, quantity: 10,
      signalReason: '관측 수익 고점 대비 반납 · 관측 45,050원으로 가상 청산 · D일과 독립적으로 판단',
      fill: accountFill('SELL', 10, { ...buy.fill.quote, price: 45050, observedAt: '2026-10-07T04:42:00Z' }, buy.costModel, '2026-10-07T04:42:20Z', 't0:SELL:fill') };
    const message = formatAccountExecutions(view.account!, [sell]);
    expect(message).toBe(['<b>① 매매 · 매수 0건 · 매도 1건</b>', 'Shadow 가상 계좌 · 실제 주문 없음', '',
      '🔴 <b>매도 · 지투지바이오 (456160)</b>', '순수익률 <b>+3.21%</b> · 실현손익 +14,000원', '10주 · 매수 43,650원 → 매도 45,050원',
      '사유: 수익 고점 대비 반납', '매수 10. 06. 09:10 → 매도 10. 07. 13:42', '✅ 진입: 검증 통과 규칙', '',
      '근거·복기: ② 판단 채널 · 전체 내역 대시보드 가상 계좌'].join('\n'));
    expect(formatAccountExecutions(view.account!, [buy])).toContain(['🟢 <b>매수 · 지투지바이오 (456160)</b>', '<b>10주 · 43,650원</b>',
      '매수 10. 06. 09:10 · 투입 436,500원', '✅ 검증 통과 가상매수'].join('\n'));
    for (const [reason, label] of [['비용 차감 손실 제한 · 관측', '손실 제한'], ['진입 조건의 지속적인 약화 · 관측', '진입 근거 약화'],
      ['진입 시 확정한 D3(2026-10-10) 종가 1원으로 가상 청산', '예약 매도'], ['<새 매도> · 상세', '&lt;새 매도&gt;']]) {
      expect(formatAccountExecutions(view.account!, [{ ...sell, signalReason: reason }])).toContain(`사유: ${label}\n`);
    }
    const exploration = formatAccountExecutions(view.account!, [{ ...sell, purpose: 'EXPLORATION' }]);
    expect(exploration).toContain('🧪 진입: 탐색 규칙 · 검증 전'); expect(exploration).not.toContain('검증 통과');
    const unmatched = formatAccountExecutions({ ...view.account!, orders: [] }, [sell]);
    expect(unmatched).toContain('순수익률·실현손익 대사 미확인\n10주 · 매수 미확인 → 매도 45,050원');
    expect(formatAccountExecutions(view.account!, [sell], true)).toContain('판단: 관측 수익 고점 대비 반납 · 관측 45,050원으로 가상 청산');
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
