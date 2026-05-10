// @responsibility Reusable Yahoo historical fetch and off-hours snapshot write helper.

import { setSnapshot } from '../persistence/offHoursSnapshotRepo.js';
import { guardedFetch } from '../utils/egressGuard.js';
import { capYahooRange } from '../utils/yahooRangePolicy.js';

export interface YahooHistoricalSnapshotFetchResult {
  body: string;
  contentType: string;
  status: number;
}

export interface YahooHistoricalSnapshotWarmupInput {
  symbol: string;
  range: string;
  interval: string;
  cacheKey?: string;
  realtimeTag?: 'REALTIME' | string;
}

const YAHOO_CONTENT_TYPE = 'application/json; charset=utf-8';
const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
};

function yahooHistoricalUrls(symbol: string, range: string, interval: string): string[] {
  return [
    `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?range=${range}&interval=${interval}`,
    `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=${range}&interval=${interval}`,
  ];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchAndStoreYahooHistoricalSnapshot(
  input: YahooHistoricalSnapshotWarmupInput,
): Promise<YahooHistoricalSnapshotFetchResult> {
  const symbol = input.symbol;
  const range = capYahooRange(input.range);
  const interval = input.interval || '1d';
  const cacheKey = input.cacheKey ?? `${symbol}:${range}:${interval}`;
  const urls = yahooHistoricalUrls(symbol, range, interval);
  let lastError: any = null;

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    console.log(`Proxying request to Yahoo (${url.includes('query2') ? 'query2' : 'query1'}): ${url}`);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      let response: Response;

      try {
        response = await guardedFetch(url, {
          headers: YAHOO_HEADERS,
          signal: controller.signal,
        }, (input.realtimeTag ?? 'REALTIME') as Parameters<typeof guardedFetch>[2]);
      } finally {
        clearTimeout(timeoutId);
      }

      if (response.ok) {
        const data = await response.json();
        if (data.chart?.result?.[0]) {
          const body = JSON.stringify(data);
          setSnapshot(cacheKey, { body, contentType: YAHOO_CONTENT_TYPE, fetchedAt: Date.now() });
          return { body, contentType: YAHOO_CONTENT_TYPE, status: 200 };
        } else if (data.chart?.error) {
          console.warn(`Yahoo API returned error for ${symbol}:`, data.chart.error);
          lastError = data.chart.error;
          if (i < urls.length - 1) await sleep(500);
          continue;
        }

        lastError = { details: JSON.stringify(data) };
        if (i < urls.length - 1) await sleep(500);
        continue;
      } else if (response.status === 404) {
        console.warn(`Yahoo API symbol not found (404) for ${symbol}`);
        return {
          body: JSON.stringify({ error: 'Symbol not found', symbol }),
          contentType: YAHOO_CONTENT_TYPE,
          status: 404,
        };
      }

      const errorText = await response.text();
      console.error(`Yahoo API error (${response.status}) for ${symbol}:`, errorText);
      lastError = { status: response.status, details: errorText };
      if (i < urls.length - 1) await sleep(500);
    } catch (error: any) {
      console.error(`Proxy error for ${symbol} using ${url.includes('query2') ? 'query2' : 'query1'}:`, error.message);
      lastError = error;
      if (i < urls.length - 1) await sleep(500);
    }
  }

  return {
    body: JSON.stringify({
      error: 'Failed to fetch data from Yahoo after multiple attempts',
      details: lastError?.message || lastError?.details || 'Unknown error',
      symbol,
    }),
    contentType: YAHOO_CONTENT_TYPE,
    status: 502,
  };
}
