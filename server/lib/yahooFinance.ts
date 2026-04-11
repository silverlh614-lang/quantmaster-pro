/**
 * yahooFinance.ts — Yahoo Finance v8 차트 API 공용 fetch 유틸리티
 *
 * query2 → query1 dual-host fallback.
 * marketDataRefresh.ts, marketDataRouter.ts 등에서 공유.
 */

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json',
};

/** Yahoo Finance 차트 결과 원시 객체. null이면 fetch 실패. */
export async function fetchYahooChart(
  symbol: string,
  range: string,
  timeoutMs = 10_000,
): Promise<any | null> {
  for (const host of ['query2', 'query1']) {
    try {
      const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`;
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(url, { headers: YF_HEADERS, signal: ctrl.signal });
      clearTimeout(tid);
      if (!res.ok) continue;
      const data = await res.json();
      const result = data?.chart?.result?.[0];
      if (result) return result;
    } catch { /* try next host */ }
  }
  return null;
}

/** 차트 결과에서 유효한 close 배열만 추출. */
export function extractCloses(chartResult: any): number[] {
  const closes: (number | null)[] = chartResult?.indicators?.quote?.[0]?.close ?? [];
  return closes.filter((v): v is number => v !== null && isFinite(v));
}

/** 심볼의 close 배열 반환 (fetchYahooChart + extractCloses 결합). */
export async function fetchCloses(symbol: string, range: string, timeoutMs?: number): Promise<number[] | null> {
  const chart = await fetchYahooChart(symbol, range, timeoutMs);
  if (!chart) return null;
  const valid = extractCloses(chart);
  return valid.length > 0 ? valid : null;
}

/** regularMarketPrice 추출. */
export function getPrice(chartResult: any | null): number | null {
  return chartResult?.meta?.regularMarketPrice ?? null;
}

/** price + change + changePct 추출 (당일 변동). */
export function getQuote(chartResult: any | null): { price: number; change: number; changePct: number } | null {
  if (!chartResult) return null;
  const meta = chartResult.meta;
  const price = meta?.regularMarketPrice ?? null;
  const prev = meta?.chartPreviousClose ?? meta?.previousClose ?? null;
  if (price === null) return null;
  const change = prev !== null ? parseFloat((price - prev).toFixed(2)) : 0;
  const changePct = prev !== null ? parseFloat(((price - prev) / prev * 100).toFixed(2)) : 0;
  return { price, change, changePct };
}

/** close 배열 기준 기간 수익률 (%). */
export function getPeriodReturn(chartResult: any | null): number | null {
  if (!chartResult) return null;
  const valid = extractCloses(chartResult);
  if (valid.length < 2) return null;
  return parseFloat(((valid[valid.length - 1] - valid[0]) / valid[0] * 100).toFixed(2));
}
