// @responsibility Validate virtual account ledger reconciliation before persistence.
import type { PaperAccountLedger, PaperAccountQuote } from '../../../src/types/paperAccount.js';
import { ACCOUNT_QUOTE_MAX_AGE_MS, accountBalances, accountFill, assertAccountConfig } from './paperAccount.js';

const validTime = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const text = (value: unknown) => typeof value === 'string' && value.length > 0;
const check = (condition: unknown, message: string): void => { if (!condition) throw new Error(`VIRTUAL_ACCOUNT_INVALID: ${message}`); };
function assertQuote(quote: PaperAccountQuote): void {
  check(quote && Number.isFinite(quote.price) && quote.price > 0 && validTime(quote.observedAt)
    && ['KIS', 'KIS_REST_REQUEST_OBSERVED', 'KRX'].includes(quote.source) && text(quote.snapshotId), 'quote');
}
export function assertPaperAccount(value: unknown): asserts value is PaperAccountLedger {
  const ledger = value as PaperAccountLedger;
  check(ledger && ledger.version === 'virtual-account-v1' && text(ledger.id) && validTime(ledger.startedAt), 'header');
  assertAccountConfig(ledger.config);
  check(typeof ledger.buyPaused === 'boolean' && Array.isArray(ledger.controls) && Array.isArray(ledger.orders)
    && ledger.marks && typeof ledger.marks === 'object' && !Array.isArray(ledger.marks), 'collections');
  check(ledger.lastSnapshotAt === null || validTime(ledger.lastSnapshotAt) && Date.parse(ledger.lastSnapshotAt) >= Date.parse(ledger.startedAt), 'snapshot time');
  let controlAt = ledger.startedAt;
  for (const control of ledger.controls) {
    check(validTime(control.at) && Date.parse(control.at) >= Date.parse(controlAt) && typeof control.buyPaused === 'boolean', 'control');
    controlAt = control.at;
  }
  check(ledger.buyPaused === (ledger.controls.at(-1)?.buyPaused ?? false), 'control state');
  const ids = new Set<string>(), bought = new Map<string, number>(), symbols = new Set<string>();
  let cash = ledger.config.initialCash;
  for (const order of ledger.orders) {
    check(order && ['BUY', 'SELL'].includes(order.side) && text(order.tradeId) && order.id === `${order.tradeId}:${order.side}` && !ids.has(order.id), 'order identity');
    ids.add(order.id);
    check(text(order.symbol) && text(order.name) && text(order.signalLabel) && text(order.signalReason) && text(order.signalSnapshotId)
      && ['VALIDATED', 'EXPLORATION'].includes(order.purpose) && text(order.statusReason), 'order evidence');
    check(validTime(order.signalAt) && validTime(order.submittedAt) && validTime(order.updatedAt)
      && Date.parse(order.signalAt) >= Date.parse(ledger.startedAt) && Date.parse(order.signalAt) <= Date.parse(order.submittedAt)
      && Date.parse(order.submittedAt) <= Date.parse(order.updatedAt), 'order time');
    check(Number.isSafeInteger(order.quantity) && order.quantity >= 0 && Number.isFinite(order.budget) && order.budget >= 0, 'order quantity');
    check(order.costModel && text(order.costModel.version) && [order.costModel.buyFeeRate, order.costModel.sellFeeRate, order.costModel.sellTaxRate, order.costModel.slippageRate]
      .every(rate => Number.isFinite(rate) && rate >= 0 && rate < 1)
      && order.costModel.sellFeeRate + order.costModel.sellTaxRate + order.costModel.slippageRate < 1, 'cost');
    check(['PENDING', 'FILLED', 'REJECTED', 'EXPIRED'].includes(order.status), 'order status');
    if (order.status !== 'FILLED') {
      check(order.fill === null, 'unfilled order contains fill');
      if (order.status === 'PENDING') check(order.side === 'SELL' && order.quantity === bought.get(order.tradeId), 'pending sell');
      continue;
    }
    const fill = order.fill;
    check(fill && order.quantity > 0 && fill.quantity === order.quantity && fill.id === `${order.id}:fill`
      && validTime(fill.at) && fill.at === order.updatedAt && Date.parse(fill.at) >= Date.parse(order.submittedAt), 'fill identity');
    assertQuote(fill!.quote);
    check(fill!.snapshotId === fill!.quote.snapshotId && Date.parse(fill!.quote.observedAt) <= Date.parse(fill!.at)
      && Date.parse(fill!.quote.observedAt) >= Date.parse(ledger.startedAt)
      && Date.parse(fill!.at) - Date.parse(fill!.quote.observedAt) <= ACCOUNT_QUOTE_MAX_AGE_MS
      && ledger.lastSnapshotAt && Date.parse(fill!.at) <= Date.parse(ledger.lastSnapshotAt), 'fill quote time');
    const expected = accountFill(order.side, order.quantity, fill!.quote, order.costModel, fill!.at, fill!.id);
    for (const key of ['price', 'grossAmount', 'fee', 'tax', 'cashDelta'] as const)
      check(Number.isFinite(fill![key]) && Math.abs(fill![key] - expected[key]) < 0.000001, `fill ${key}`);
    if (order.side === 'BUY') {
      check(!bought.has(order.tradeId) && !symbols.has(order.symbol) && -fill!.cashDelta <= order.budget, 'duplicate holding/budget');
      bought.set(order.tradeId, order.quantity); symbols.add(order.symbol);
    } else {
      check(bought.get(order.tradeId) === order.quantity && symbols.has(order.symbol), 'sell quantity');
      bought.delete(order.tradeId); symbols.delete(order.symbol);
    }
    cash = Math.round((cash + fill!.cashDelta) * 100) / 100;
    check(cash >= 0, 'negative cash');
  }
  for (const [tradeId, quote] of Object.entries(ledger.marks)) {
    check(bought.has(tradeId), 'mark without holding'); assertQuote(quote);
    const buy = ledger.orders.find(order => order.tradeId === tradeId && order.side === 'BUY');
    check(buy?.fill && Date.parse(quote.observedAt) >= Date.parse(buy.fill.quote.observedAt)
      && ledger.lastSnapshotAt && Date.parse(quote.observedAt) <= Date.parse(ledger.lastSnapshotAt), 'mark time');
  }
  accountBalances(ledger);
}
