/**
 * @responsibility Cache-busting Yahoo historical refresh probe for DATA_STALE_PRICE triage.
 *
 * This helper bypasses yahooQuoteAdapter's in-memory cache and recomputes 5d/20d returns
 * from newly fetched chart rows. It never treats missing/stale return data as valid 0%.
 */

import { guardedFetch } from '../../utils/egressGuard.js';

export interface YahooHistoricalRefreshResult {
  ok: boolean;
  symbol: string;
  price: number | null;
  changePercent: number | null;
  return5d: number | null;
  return20d: number | null;
  latestAsOf: string | null;
  base5dAsOf: string | null;
  base20dAsOf: string | null;
  closeCount: number;
  reason?: 'FETCH_FAIL' | 'NO_RESULT' | 'INSUFFICIENT_HISTORY' | 'INVALID_PRICE' | 'HTTP_ERROR';
}

function validPrice(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function pct(current: number, base: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(base) || base <= 0 || current <= 0) return null;
  const p = ((current - base) / base) * 100;
  return Number.isFinite(p) ? parseFloat(p.toFixed(2)) : null;
}

function isoFromSec(sec: number | undefined): string | null {
  return typeof sec === 'number' && Number.isFinite(sec) && sec > 0
    ? new Date(sec * 1000).toISOString()
    : null;
}

export async function refreshYahooHistoricalReturns(
  symbol: string,
  options: { range?: string; interval?: string } = {},
): Promise<YahooHistoricalRefreshResult> {
  const range = options.range ?? '6mo';
  const interval = options.interval ?? '1d';
  const base = 'https://query2.finance.yahoo.com/v8/finance/chart/';
  const url = `${base}${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&cb=${Date.now()}`;

  try {
    const res = await guardedFetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    }, 'HISTORICAL');
    if (!res.ok) return empty(symbol, 'HTTP_ERROR');

    const data = await res.json();
    const result = data.chart?.result?.[0];
    if (!result) return empty(symbol, 'NO_RESULT');

    const meta = result.meta ?? {};
    const rawCloses: Array<number | null> = result.indicators?.quote?.[0]?.close ?? [];
    const rawTimestamps: number[] = Array.isArray(result.timestamp) ? result.timestamp : [];
    const closes: number[] = [];
    const timestamps: number[] = [];
    for (let i = 0; i < rawCloses.length; i += 1) {
      const c = validPrice(rawCloses[i]);
      if (c === null) continue;
      closes.push(c);
      timestamps.push(rawTimestamps[i] ?? 0);
    }

    if (closes.length < 21) {
      return { ...empty(symbol, 'INSUFFICIENT_HISTORY'), closeCount: closes.length };
    }

    const price = validPrice(meta.regularMarketPrice) ?? closes[closes.length - 1];
    const prevClose = validPrice(meta.regularMarketPreviousClose) ?? closes[closes.length - 2];
    const close5dAgoIdx = closes.length > 5 ? closes.length - 6 : 0;
    const close20dAgoIdx = closes.length > 20 ? closes.length - 21 : 0;
    const return5d = pct(price, closes[close5dAgoIdx]);
    const return20d = pct(price, closes[close20dAgoIdx]);
    const changePercent = pct(price, prevClose);

    if (price <= 0 || return20d === null) {
      return { ...empty(symbol, 'INVALID_PRICE'), closeCount: closes.length };
    }

    return {
      ok: true,
      symbol,
      price,
      changePercent,
      return5d,
      return20d,
      latestAsOf: isoFromSec(timestamps[timestamps.length - 1]),
      base5dAsOf: isoFromSec(timestamps[close5dAgoIdx]),
      base20dAsOf: isoFromSec(timestamps[close20dAgoIdx]),
      closeCount: closes.length,
    };
  } catch {
    return empty(symbol, 'FETCH_FAIL');
  }
}

function empty(symbol: string, reason: NonNullable<YahooHistoricalRefreshResult['reason']>): YahooHistoricalRefreshResult {
  return {
    ok: false,
    symbol,
    price: null,
    changePercent: null,
    return5d: null,
    return20d: null,
    latestAsOf: null,
    base5dAsOf: null,
    base20dAsOf: null,
    closeCount: 0,
    reason,
  };
}

export function formatYahooHistoricalRefresh(result: YahooHistoricalRefreshResult): string {
  if (!result.ok) return `refresh failed: ${result.reason ?? 'UNKNOWN'} closes=${result.closeCount}`;
  return `refresh OK: change=${fmt(result.changePercent)} return5d=${fmt(result.return5d)} return20d=${fmt(result.return20d)} base20d=${result.base20dAsOf ?? 'N/A'}`;
}

function fmt(v: number | null): string {
  return Number.isFinite(v) ? `${(v as number).toFixed(2)}%` : 'N/A';
}
