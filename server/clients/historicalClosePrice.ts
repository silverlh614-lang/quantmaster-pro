// @responsibility Historical close price fetcher for learning labels (KIS daily first, Yahoo fallback)

import { fetchKisChartData } from '../screener/kisChartDataFetcher.js';
import { guardedFetch } from '../utils/egressGuard.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json',
};

function formatYmdCompact(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

function toYmd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function normalizeKrxCode(symbol: string): string | null {
  const raw = String(symbol ?? '').trim();
  const match = raw.match(/^(\d{6})(?:\.(?:KS|KQ))?$/i);
  return match ? match[1] : null;
}

async function fetchKisHistoricalClosePrice(
  code: string,
  asOf: Date,
): Promise<number | null> {
  const endDate = formatYmdCompact(asOf);
  const startDate = formatYmdCompact(new Date(asOf.getTime() - 10 * DAY_MS));
  const candles = await fetchKisChartData(code, 'D', startDate, endDate);
  const target = endDate;
  for (let i = candles.length - 1; i >= 0; i--) {
    const candle = candles[i];
    if (candle.date <= target && Number.isFinite(candle.close) && candle.close > 0) {
      return candle.close;
    }
  }
  return null;
}

async function fetchYahooHistoricalClosePrice(
  code: string,
  asOf: Date,
): Promise<number | null> {
  const targetYmd = toYmd(asOf);
  const period1 = Math.floor((asOf.getTime() - 10 * DAY_MS) / 1000);
  const period2 = Math.floor((asOf.getTime() + 2 * DAY_MS) / 1000);
  const symbols = [`${code}.KS`, `${code}.KQ`];

  for (const symbol of symbols) {
    const urls = [
      `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${period1}&period2=${period2}&interval=1d`,
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${period1}&period2=${period2}&interval=1d`,
    ];

    for (const url of urls) {
      try {
        const res = await guardedFetch(url, { headers: YF_HEADERS }, 'HISTORICAL');
        if (!res.ok) continue;
        const data = await res.json();
        const result = data?.chart?.result?.[0];
        if (!result) continue;

        const timestamps: number[] = Array.isArray(result.timestamp) ? result.timestamp : [];
        const closes = result.indicators?.quote?.[0]?.close as Array<number | null> | undefined;
        if (!Array.isArray(closes)) continue;

        let best: number | null = null;
        for (let i = 0; i < Math.min(timestamps.length, closes.length); i++) {
          const close = closes[i];
          if (typeof close !== 'number' || !Number.isFinite(close) || close <= 0) continue;
          const ymd = new Date(timestamps[i] * 1000).toISOString().slice(0, 10);
          if (ymd <= targetYmd) best = close;
        }
        if (best !== null) return best;
      } catch {
        // Try next Yahoo host/suffix.
      }
    }
  }

  return null;
}

/**
 * Historical close price for a KRX symbol as of the requested trading date.
 *
 * This must not fall back to current price: FutureReturnResolver labels would
 * become time-travelled if today's price were used for historical horizons.
 */
export async function fetchHistoricalClosePrice(
  symbol: string,
  asOf: Date,
): Promise<number | null> {
  const code = normalizeKrxCode(symbol);
  if (!code || !Number.isFinite(asOf.getTime())) return null;

  const kis = await fetchKisHistoricalClosePrice(code, asOf).catch(() => null);
  if (kis !== null) return kis;

  return fetchYahooHistoricalClosePrice(code, asOf).catch(() => null);
}

export const __testOnly = {
  normalizeKrxCode,
};
