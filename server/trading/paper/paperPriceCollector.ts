// @responsibility Collect fresh KIS quotes into a price-only Shadow snapshot.
import { randomUUID } from 'node:crypto';
import type { PaperObservation, PaperSnapshot } from '../../../src/types/paperExperiment.js';
import { fetchKisStockFullQuote } from '../../clients/kisClient.js';
import { toKstDateKey } from '../../calendar/krxTradingCalendar.js';
import { isPaperMarketOpen } from './paperExperimentCollector.js';

export async function collectPaperPriceSnapshot(symbols: Array<{ symbol: string; name: string }>): Promise<PaperSnapshot> {
  const started = new Date();
  const observations: PaperObservation[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(5, symbols.length) }, async () => {
    while (next < symbols.length) {
      const item = symbols[next++];
      const requestedAt = Date.now();
      try {
        const quote = await fetchKisStockFullQuote(item.symbol);
        const receivedAt = Date.now(), observed = Date.parse(quote?.fetchedAt ?? '');
        const valid = quote?.code === item.symbol && Number.isFinite(quote.currentPrice) && quote.currentPrice! > 0
          && Number.isFinite(observed) && observed >= requestedAt && observed <= receivedAt;
        observations.push({ ...item, price: valid ? quote!.currentPrice! : null,
          observedAt: valid ? quote!.fetchedAt! : new Date(receivedAt).toISOString(),
          source: 'KIS_REST_REQUEST_OBSERVED', return1dPct: null, return5dPct: null, aboveMa20: null,
          news: [], dailyCloses: [], ...(!valid ? { issue: 'CURRENT_QUOTE_UNAVAILABLE' } : {}) });
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
