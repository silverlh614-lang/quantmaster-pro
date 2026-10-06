// @responsibility Collect fresh KIS quotes into a price-only Shadow snapshot.
import { randomUUID } from 'node:crypto';
import type { PaperObservation, PaperSnapshot } from '../../../src/types/paperExperiment.js';
import { fetchKisMultiQuotes, fetchKisStockFullQuote, KIS_MULTI_QUOTE_LIMIT } from '../../clients/kisClient.js';
import { toKstDateKey } from '../../calendar/krxTradingCalendar.js';
import { isPaperMarketOpen } from './paperExperimentCollector.js';

type PriceTarget = { symbol: string; name: string };
type Quote = { code?: string; currentPrice?: number | null; fetchedAt?: string } | null;

function observe(item: PriceTarget, quote: Quote, requestedAt: number, receivedAt: number): PaperObservation {
  const observed = Date.parse(quote?.fetchedAt ?? '');
  const valid = quote?.code === item.symbol && Number.isFinite(quote.currentPrice) && quote.currentPrice! > 0
    && Number.isFinite(observed) && observed >= requestedAt && observed <= receivedAt;
  return { ...item, price: valid ? quote!.currentPrice! : null,
    observedAt: valid ? quote!.fetchedAt! : new Date(receivedAt).toISOString(),
    source: 'KIS_REST_REQUEST_OBSERVED', return1dPct: null, return5dPct: null, aboveMa20: null,
    news: [], dailyCloses: [], ...(!valid ? { issue: 'CURRENT_QUOTE_UNAVAILABLE' } : {}) };
}

export async function collectPaperPriceSnapshot(symbols: PriceTarget[]): Promise<PaperSnapshot> {
  const started = new Date();
  const observations: PaperObservation[] = [];
  const single: PriceTarget[] = [];
  // One multi-stock request answers up to 30 holdings; codes it leaves out keep the single-quote path.
  for (let offset = 0; offset < symbols.length; offset += KIS_MULTI_QUOTE_LIMIT) {
    const chunk = symbols.slice(offset, offset + KIS_MULTI_QUOTE_LIMIT), requestedAt = Date.now();
    const quotes = await fetchKisMultiQuotes(chunk.map(item => item.symbol));
    const receivedAt = Date.now();
    for (const item of chunk) {
      const quote = quotes?.get(item.symbol);
      if (quote) observations.push(observe(item, quote, requestedAt, receivedAt));
      else single.push(item);
    }
  }
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(5, single.length) }, async () => {
    while (next < single.length) {
      const item = single[next++];
      const requestedAt = Date.now();
      try {
        const quote = await fetchKisStockFullQuote(item.symbol);
        observations.push(observe(item, quote, requestedAt, Date.now()));
      } catch (error) {
        console.warn('[PaperPriceMonitor] Quote failed', item.symbol, error instanceof Error ? error.message : String(error));
        observations.push({ ...item, price: null, observedAt: new Date().toISOString(), source: 'KIS_REST_REQUEST_OBSERVED',
          return1dPct: null, return5dPct: null, aboveMa20: null, news: [], dailyCloses: [], issue: 'CURRENT_QUOTE_UNAVAILABLE' });
      }
    }
  }));
  const finished = new Date();
  return { id: `paper_prices_${randomUUID()}`, quoteOnly: true, asOf: finished.toISOString(),
    tradingDate: toKstDateKey(finished), marketOpen: isPaperMarketOpen(started) && isPaperMarketOpen(finished), observations };
}
