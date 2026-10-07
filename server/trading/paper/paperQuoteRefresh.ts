// @responsibility Refresh aging prices before finalizing a paper observation snapshot.
import { fetchKisMultiQuotes, fetchKisStockFullQuote, KIS_MULTI_QUOTE_LIMIT } from '../../clients/kisClient.js';

type Quote = { code: string; currentPrice: number | null; fetchedAt: string; per?: number | null };
type Target = { symbol: string; quote: Quote | null | undefined };

/** Leave 30 seconds of headroom against the account's unchanged 120-second execution limit. */
const REFRESH_AFTER_MS = 90_000;
const REQUEST_BUDGET_MS = 20_000;

export async function refreshPaperQuotes(targets: Target[], scanStartedAt: number): Promise<Map<string, Quote>> {
  const startedAt = Date.now(), deadline = startedAt + REQUEST_BUDGET_MS;
  const pending = targets.filter(({ symbol, quote }) => quote?.code === symbol
    && Number.isFinite(quote.currentPrice) && quote.currentPrice! > 0
    && Date.parse(quote.fetchedAt) >= scanStartedAt
    && startedAt - Date.parse(quote.fetchedAt) >= REFRESH_AFTER_MS)
    .sort((a, b) => Date.parse(a.quote!.fetchedAt) - Date.parse(b.quote!.fetchedAt));
  const refreshed = new Map<string, Quote>(), single: string[] = [];
  const accept = (symbol: string, quote: Quote | null | undefined, requestedAt: number): boolean => {
    if (!quote || quote.code !== symbol || !Number.isFinite(quote.currentPrice) || quote.currentPrice! <= 0
      || !Number.isFinite(Date.parse(quote.fetchedAt)) || Date.parse(quote.fetchedAt) < requestedAt
      || Date.parse(quote.fetchedAt) > Date.now()) return false;
    // Multi-price responses omit PER. Never attach an old PER to a newly observed price.
    refreshed.set(symbol, { code: symbol, currentPrice: quote.currentPrice, fetchedAt: quote.fetchedAt, per: quote.per ?? null });
    return true;
  };
  for (let offset = 0; offset < pending.length && Date.now() < deadline; offset += KIS_MULTI_QUOTE_LIMIT) {
    const chunk = pending.slice(offset, offset + KIS_MULTI_QUOTE_LIMIT), requestedAt = Date.now();
    try {
      const quotes = await fetchKisMultiQuotes(chunk.map(item => item.symbol));
      for (const item of chunk) if (!accept(item.symbol, quotes?.get(item.symbol), requestedAt)) single.push(item.symbol);
      // An unavailable multi-quote service should not consume the entire budget on identical retries.
      if (!quotes?.size) {
        single.push(...pending.slice(offset + chunk.length).map(item => item.symbol));
        break;
      }
    } catch (error) {
      console.warn('[PaperQuoteRefresh] Multi-quote refresh failed', error instanceof Error ? error.message : String(error));
      single.push(...pending.slice(offset).map(item => item.symbol));
      break;
    }
  }
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(5, single.length) }, async () => {
    while (next < single.length && Date.now() < deadline) {
      const symbol = single[next++], requestedAt = Date.now();
      try { accept(symbol, await fetchKisStockFullQuote(symbol), requestedAt); }
      catch (error) {
        console.warn('[PaperQuoteRefresh] Single-quote refresh failed', symbol, error instanceof Error ? error.message : String(error));
      }
    }
  }));
  // In-flight requests may outlast the budget. The consumer still checks age at final snapshot time.
  // Unanswered quotes keep their original timestamps; research remains available, execution can refuse them.
  return refreshed;
}
