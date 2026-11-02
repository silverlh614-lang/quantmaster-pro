// @responsibility Summarize virtual account execution by frozen policy selection.
import type { PaperAccountLedger } from '../types/paperAccount';

/** Selection IDs describe the decision context, not proof that every rejected order matched its winning rule.
 * Null selects buys whose original selection is missing; later sells follow their buy's trade ID. */
export function paperAccountOrderReview(account: PaperAccountLedger, selectionId?: string | null) {
  const known = new Set(account.selections?.map(selection => selection.id));
  const buys = account.orders.filter(order => order.side === 'BUY' && (selectionId === undefined
    || (selectionId === null ? !order.selectionId || !known.has(order.selectionId) : order.selectionId === selectionId)));
  const tradeIds = new Set(buys.map(order => order.tradeId));
  const orders = selectionId === undefined ? account.orders : account.orders.filter(order => tradeIds.has(order.tradeId));
  const counts = { FILLED: 0, REJECTED: 0, EXPIRED: 0, PENDING: 0 };
  const reasons = new Map<string, { status: PaperAccountLedger['orders'][number]['status']; reason: string; count: number }>();
  for (const buy of buys) {
    counts[buy.status]++;
    if (buy.status === 'FILLED') continue;
    const key = JSON.stringify([buy.status, buy.statusReason]);
    const item = reasons.get(key) ?? { status: buy.status, reason: buy.statusReason, count: 0 };
    item.count++; reasons.set(key, item);
  }
  return { buyCount: buys.length, counts, orders, reasons: [...reasons.values()]
    .sort((a, b) => b.count - a.count || a.status.localeCompare(b.status) || a.reason.localeCompare(b.reason)) };
}

/** Selection statistics never enter these results; only paired account fills contribute. */
export function paperAccountPerformance(account: PaperAccountLedger, selectionId?: string) {
  const buys = account.orders.filter(order => order.side === 'BUY' && order.fill
    && (selectionId === undefined || order.selectionId === selectionId));
  const sells = new Map(account.orders.filter(order => order.side === 'SELL' && order.fill).map(order => [order.tradeId, order]));
  const closed = buys.flatMap(buy => {
    const sell = sells.get(buy.tradeId);
    if (!sell?.fill || sell.quantity !== buy.quantity) return [];
    const pnl = Math.round((buy.fill!.cashDelta + sell.fill.cashDelta) * 100) / 100;
    return [{ pnl, returnPct: pnl / -buy.fill!.cashDelta * 100 }];
  });
  const wins = closed.filter(item => item.pnl > 0), losses = closed.filter(item => item.pnl < 0);
  const sum = (rows: typeof closed) => rows.reduce((total, item) => total + item.pnl, 0);
  const average = (rows: typeof closed) => rows.length ? rows.reduce((total, item) => total + item.returnPct, 0) / rows.length : null;
  return { closedCount: closed.length, openCount: buys.length - closed.length,
    realizedPnl: Math.round(sum(closed) * 100) / 100, meanNetReturnPct: average(closed),
    winRatePct: closed.length ? wins.length / closed.length * 100 : null,
    meanWinPct: average(wins), meanLossPct: average(losses),
    profitFactor: losses.length ? sum(wins) / -sum(losses) : null };
}
