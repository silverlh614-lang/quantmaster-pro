// @responsibility Historical close price fetcher for learning labels (KIS daily first, Yahoo fallback)

import { fetchKisChartData } from '../screener/kisChartDataFetcher.js';
import { guardedFetch } from '../utils/egressGuard.js';
// ADR-0440 — `normalizeKrxCode` SSOT (`server/utils/symbolNormalizer`) 직접 import.
// 기존 로컬 정규식 복붙 (`^(\d{6})(?:\.(?:KS|KQ))?$/i`) 영구 제거 — drift 위험 차단 +
// SSOT 의 `.KOSPI` / `.KOSDAQ` suffix 추가 지원 자연 확장.
import { normalizeKrxCode } from '../utils/symbolNormalizer.js';
// ADR-0443 — yahooSymbolResolver SSOT 위임 — `${code}.KS` / `${code}.KQ` direct
// template concat 영구 차단. 마스터 매칭 시 정확한 시장 1회 시도 + 부재 시 보수적
// 양쪽 fallback (historical bars fetcher 시그니처 부적합으로 fetchYahooQuoteByCode
// 미사용, tryGetYahooSymbol 만 사용 + 그레이스 양쪽 시도 보존).
import { tryGetYahooSymbol } from '../screener/adapters/yahooSymbolResolver.js';

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
  // ADR-0443 — 마스터 매칭 시 정확한 시장 우선 + 부재 시 보수적 양쪽 fallback (그레이스).
  // historical fetcher 시그니처가 fetchYahooQuoteByCode (YahooQuoteExtended) 와
  // 부적합 — tryGetYahooSymbol 만 사용 + 양쪽 시도 보존. 마스터 미커버 종목 (KONEX/OTHER)
  // 도 동작 보존 (운영 안정성).
  const resolved = tryGetYahooSymbol(code);
  const symbols = resolved
    ? [resolved, resolved.endsWith('.KS') ? `${code}.KQ` : `${code}.KS`]
    : [`${code}.KS`, `${code}.KQ`];

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
  // ADR-0440 — `.code` 명시 사용. SSOT `normalizeKrxCode(raw): NormalizedKrxSymbol`
  // 의 `.code` 는 invalid 시 null — 기존 로컬 함수 동작과 byte-equivalent.
  const code = normalizeKrxCode(symbol).code;
  if (!code || !Number.isFinite(asOf.getTime())) return null;

  const kis = await fetchKisHistoricalClosePrice(code, asOf).catch(() => null);
  if (kis !== null) return kis;

  return fetchYahooHistoricalClosePrice(code, asOf).catch(() => null);
}

export const __testOnly = {
  // ADR-0440 — SSOT `.code` accessor 노출 (기존 string|null 시그니처 보존).
  normalizeKrxCode: (symbol: string): string | null => normalizeKrxCode(symbol).code,
};
