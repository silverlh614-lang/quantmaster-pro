// @responsibility Summarize realized virtual account results after policy selection.
import type { PaperAccountLedger } from '../types/paperAccount';

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
