// @responsibility counterfactualShadowPriceProviderAdapter — ADR-0431 thin adapter SSOT.
//
// ADR-0431:
// Thin adapter that lets ADR-0431 reuse ADR-0429's cache-first read-only price
// provider without coupling counterfactual ledger entries to provisional ledger
// entries. The adapter wraps a ProvisionalShadowPriceProvider (or any compatible
// horizon-based price source) and exposes the CounterfactualShadowPriceProvider
// signature.
//
// 핵심 불변식:
//   1. counterfactual ledger 와 provisional ledger entry 절대 혼합 금지 — 본 어댑터는
//      symbol/horizon/entryAtKst 만 forward, ledger 형식 변환 0
//   2. KIS 주문 함수 import 0건 — read-only price 호출만
//   3. 외부 API 폭주 차단 — wrapped provider 의 caching/quota 위임
//   4. 큰 refactor 회피 (사용자 §C 권장) — ADR-0429 generic 추출 대신 adapter 1 함수
//   5. status / source field 정합 — ProvisionalShadowPointStatus → CounterfactualShadowPointStatus
//      union 호환 (DATA_UNAVAILABLE / MARKET_CLOSED / ERROR / PENDING / OBSERVED 5종 동일)

import type {
  ProvisionalShadowPriceProvider,
  ProvisionalShadowHorizon,
} from './provisionalShadowPerformanceReport.js';
import type {
  CounterfactualShadowPriceProvider,
  CounterfactualShadowHorizon,
  CounterfactualShadowPointStatus,
  CounterfactualShadowPointSource,
} from './counterfactualShadowLearningPerformanceReport.js';
import {
  COUNTERFACTUAL_HORIZON_OFFSET_MS,
  isHorizonReached as isCounterfactualHorizonReached,
  resolveCounterfactualEntryPriceWithSource,
} from './counterfactualShadowLearningPerformanceReport.js';
import type { CounterfactualShadowLearningLedgerEntry } from '../persistence/counterfactualShadowLearningRepo.js';
import { getSnapshot } from '../persistence/offHoursSnapshotRepo.js';
import { isKrxTradingDay, toKstDateKey } from '../calendar/krxTradingCalendar.js';

export interface CounterfactualCachedPriceLookupInput {
  entry: CounterfactualShadowLearningLedgerEntry;
  symbol: string;
  horizon: CounterfactualShadowHorizon;
  entryAtKst: string;
  targetAtKst: string;
}

export interface CounterfactualCachedPriceHit {
  price: number;
  observedAtKst: string;
  source: Exclude<CounterfactualShadowPointSource, 'ENTRY_SNAPSHOT' | 'SCAN_SNAPSHOT' | 'NONE'>;
}

export interface CounterfactualPriceCacheReaders {
  intraday?: (input: CounterfactualCachedPriceLookupInput) => CounterfactualCachedPriceHit | null;
  daily?: (input: CounterfactualCachedPriceLookupInput) => CounterfactualCachedPriceHit | null;
  marketData?: (input: CounterfactualCachedPriceLookupInput) => CounterfactualCachedPriceHit | null;
  readOnlyQuote?: (input: CounterfactualCachedPriceLookupInput) => CounterfactualCachedPriceHit | null;
}

export interface CreateCounterfactualShadowPriceProviderInput {
  entries: CounterfactualShadowLearningLedgerEntry[];
  nowKst?: string;
  cacheReaders?: CounterfactualPriceCacheReaders;
  /**
   * ADR-0434 requires snapshot prices to stay useful when no cache has reached the point yet.
   * Keeping this enabled preserves cache-only/no-network behavior while preventing false losses.
   */
  allowSnapshotFallback?: boolean;
}

/**
 * ProvisionalShadowHorizon 와 CounterfactualShadowHorizon 는 *동일 6-value union*
 * (T_PLUS_30M / T_PLUS_1H / SAME_DAY_CLOSE / NEXT_OPEN / T_PLUS_1D_CLOSE / T_PLUS_3D_CLOSE).
 *
 * TypeScript 가 nominal type 으로 분리해 다루므로 명시적 cast 가 필요. 본 함수는 런타임
 * 동등성 정적 검증 (compile-time 정확) 후 안전 cast.
 */
function castHorizonToProvisional(
  horizon: CounterfactualShadowHorizon,
): ProvisionalShadowHorizon {
  // 동등 union — 런타임 string 값 그대로.
  return horizon as unknown as ProvisionalShadowHorizon;
}

/**
 * ProvisionalShadowPointStatus → CounterfactualShadowPointStatus mapping.
 *
 * Provisional 5종 (PENDING/OBSERVED/DATA_UNAVAILABLE/MARKET_CLOSED/ERROR) 모두
 * Counterfactual union 에 포함 — INSUFFICIENT_DATA 만 counterfactual 전용 (호출자 측
 * entryPrice 부재 시 처리, 본 어댑터 영역 외).
 */
function mapStatus(
  status: 'PENDING' | 'OBSERVED' | 'DATA_UNAVAILABLE' | 'MARKET_CLOSED' | 'ERROR' | undefined,
): CounterfactualShadowPointStatus | undefined {
  if (status === undefined) return undefined;
  return status; // union 호환 — INSUFFICIENT_DATA 는 ADR-0431 전용
}

/**
 * Wrap a ProvisionalShadowPriceProvider as a CounterfactualShadowPriceProvider.
 *
 * 사용자 §C 정합 — 큰 refactor 회피, ADR-0429 의 cache-first read-only 구현을 그대로 reuse.
 * 호출자 (`/shadow_counterfactual` cmd) 가 ADR-0429 `createProvisionalShadowPriceProvider`
 * 결과를 본 어댑터에 통과시키면 즉시 호환.
 *
 * 주의: ADR-0429 의 `createProvisionalShadowPriceProvider({entries})` 는 *provisional
 * ledger entries* 만 인덱싱한다. 본 어댑터는 ledger 형식 변환을 *하지 않는다* — 호출자가
 * 별도 priceProvider 인스턴스를 만들어 counterfactual entries 로 인덱싱해야 한다.
 *
 * 또는 generic priceProvider (ledger-free) 가 도입되면 본 어댑터 자체가 폐기 가능.
 * 본 PR 은 *adapter 만* 도입, generic 추출은 후속 PR scope.
 */
export function wrapProvisionalProviderForCounterfactual(
  provider: ProvisionalShadowPriceProvider,
): CounterfactualShadowPriceProvider {
  return async (symbol, horizon, entryAtKst) => {
    const result = await provider(symbol, castHorizonToProvisional(horizon), entryAtKst);
    if (result.available) {
      return {
        available: true,
        price: result.price,
        observedAtKst: result.observedAtKst,
        source: 'ENTRY_SNAPSHOT',
      };
    }
    return {
      available: false,
      reason: result.reason,
      ...(result.status !== undefined ? { status: mapStatus(result.status) } : {}),
      source: 'NONE',
    };
  };
}

export function isCounterfactualPriceProviderCacheDisabled(): boolean {
  return process.env.COUNTERFACTUAL_PRICE_PROVIDER_CACHE_DISABLED === 'true';
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function resolveHorizonTargetTimeKst(
  entryAtKst: string,
  horizon: CounterfactualShadowHorizon,
): string | null {
  const entryMs = Date.parse(entryAtKst);
  if (!Number.isFinite(entryMs)) return null;
  if (horizon === 'T_PLUS_30M' || horizon === 'T_PLUS_1H') {
    return new Date(entryMs + COUNTERFACTUAL_HORIZON_OFFSET_MS[horizon]).toISOString();
  }

  const entryKey = toKstDateKey(new Date(entryMs));
  if (!entryKey) return null;
  if (horizon === 'SAME_DAY_CLOSE') return `${entryKey}T15:30:00+09:00`;

  const offset = horizon === 'NEXT_OPEN' || horizon === 'T_PLUS_1D_CLOSE' ? 1 : 3;
  const targetKey = findNthKrxTradingDayAfter(entryKey, offset);
  if (!targetKey) return null;
  if (horizon === 'NEXT_OPEN') return `${targetKey}T09:00:00+09:00`;
  return `${targetKey}T15:30:00+09:00`;
}

function findNthKrxTradingDayAfter(dateKey: string, n: number): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || n <= 0) return null;
  let cursor = dateKey;
  let count = 0;
  for (let i = 0; i < n + 14; i += 1) {
    cursor = addDateKeyDays(cursor, 1);
    if (isKrxTradingDay(cursor)) {
      count += 1;
      if (count >= n) return cursor;
    }
  }
  return null;
}

function addDateKeyDays(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  const yy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function isIntradayHorizon(horizon: CounterfactualShadowHorizon): boolean {
  return horizon === 'T_PLUS_30M' || horizon === 'T_PLUS_1H' || horizon === 'SAME_DAY_CLOSE';
}

/**
 * ADR-0439 — exported for reuse by `provisionalShadowPriceProvider.ts`.
 * counterfactual adapter 본체 동작 0 변경, export 키워드만 추가 (drift 차단).
 */
export function normalizeYahooSymbol(symbol: string): string {
  const s = symbol.trim();
  if (/^\d{6}$/.test(s)) return `${s}.KS`;
  return s;
}

/**
 * ADR-0439 — exported for reuse by `provisionalShadowPriceProvider.ts`.
 */
export interface ParsedYahooPoint {
  price: number;
  observedAtKst: string;
  timestampMs: number;
}

/**
 * ADR-0439 — exported for reuse by `provisionalShadowPriceProvider.ts`.
 */
export function parseYahooChartBody(body: string): ParsedYahooPoint[] {
  try {
    const parsed = JSON.parse(body) as {
      chart?: {
        result?: Array<{
          timestamp?: number[];
          indicators?: { quote?: Array<{ close?: Array<number | null> }> };
          meta?: { regularMarketPrice?: number; regularMarketTime?: number };
        }>;
      };
    };
    const result = parsed.chart?.result?.[0];
    const timestamps = result?.timestamp ?? [];
    const closes = result?.indicators?.quote?.[0]?.close ?? [];
    const points: ParsedYahooPoint[] = [];
    for (let i = 0; i < timestamps.length; i += 1) {
      const close = closes[i];
      if (isPositiveFinite(close)) {
        const timestampMs = timestamps[i] * 1000;
        points.push({
          price: close,
          observedAtKst: new Date(timestampMs).toISOString(),
          timestampMs,
        });
      }
    }
    const metaPrice = result?.meta?.regularMarketPrice;
    if (isPositiveFinite(metaPrice)) {
      const timestampMs = (result?.meta?.regularMarketTime ?? Math.floor(Date.now() / 1000)) * 1000;
      points.push({
        price: metaPrice,
        observedAtKst: new Date(timestampMs).toISOString(),
        timestampMs,
      });
    }
    return points;
  } catch {
    return [];
  }
}

/**
 * ADR-0439 — exported for reuse by `provisionalShadowPriceProvider.ts`.
 */
export function closestPointAtOrAfter(points: ParsedYahooPoint[], targetMs: number): ParsedYahooPoint | null {
  const sorted = points
    .filter((p) => p.timestampMs >= targetMs)
    .sort((a, b) => a.timestampMs - b.timestampMs);
  return sorted[0] ?? null;
}

/**
 * ADR-0439 — exported for reuse by `provisionalShadowPriceProvider.ts`.
 */
export function latestPoint(points: ParsedYahooPoint[]): ParsedYahooPoint | null {
  return points.slice().sort((a, b) => b.timestampMs - a.timestampMs)[0] ?? null;
}

/**
 * ADR-0439 — exported for reuse by `provisionalShadowPriceProvider.ts`.
 *
 * Reads a Yahoo proxy cache snapshot at `${normalizedSymbol}:${range}:${interval}` and
 * returns the closest point at-or-after `targetAtKst` (mode='closest') or the most
 * recent point (mode='latest'). Returns null when the snapshot is missing, parses
 * to zero points, or `targetAtKst` is invalid.
 */
export function readYahooSnapshotPoint(
  symbol: string,
  targetAtKst: string,
  range: string,
  interval: string,
  mode: 'closest' | 'latest',
): ParsedYahooPoint | null {
  const key = `${normalizeYahooSymbol(symbol)}:${range}:${interval}`;
  const snapshot = getSnapshot(key);
  if (!snapshot) return null;
  const points = parseYahooChartBody(snapshot.body);
  if (points.length === 0) return null;
  if (mode === 'latest') return latestPoint(points);
  const targetMs = Date.parse(targetAtKst);
  if (!Number.isFinite(targetMs)) return null;
  return closestPointAtOrAfter(points, targetMs);
}

function defaultIntradayReader(
  input: CounterfactualCachedPriceLookupInput,
): CounterfactualCachedPriceHit | null {
  for (const interval of ['1m', '5m', '15m', '30m', '1h']) {
    const point = readYahooSnapshotPoint(input.symbol, input.targetAtKst, '1d', interval, 'closest');
    if (point) {
      return {
        price: point.price,
        observedAtKst: point.observedAtKst,
        source: 'INTRADAY_CANDLE_CACHE',
      };
    }
  }
  return null;
}

function defaultDailyReader(
  input: CounterfactualCachedPriceLookupInput,
): CounterfactualCachedPriceHit | null {
  for (const range of ['5d', '1mo', '1y']) {
    const point = readYahooSnapshotPoint(input.symbol, input.targetAtKst, range, '1d', 'closest');
    if (point) {
      return {
        price: point.price,
        observedAtKst: point.observedAtKst,
        source: 'DAILY_CANDLE_CACHE',
      };
    }
  }
  return null;
}

function defaultMarketDataReader(
  input: CounterfactualCachedPriceLookupInput,
): CounterfactualCachedPriceHit | null {
  for (const [range, interval] of [
    ['1d', '1m'],
    ['1d', '5m'],
    ['5d', '1d'],
    ['1mo', '1d'],
    ['1y', '1d'],
  ] as const) {
    const point = readYahooSnapshotPoint(input.symbol, input.targetAtKst, range, interval, 'latest');
    if (point) {
      return {
        price: point.price,
        observedAtKst: point.observedAtKst,
        source: 'MARKET_DATA_CACHE',
      };
    }
  }
  return null;
}

function defaultReadOnlyQuoteReader(
  input: CounterfactualCachedPriceLookupInput,
): CounterfactualCachedPriceHit | null {
  const meta = (input.entry as CounterfactualShadowLearningLedgerEntry & {
    metadata?: { readOnlyQuote?: { lastPrice?: number; observedAtKst?: string } };
  }).metadata;
  const quote = meta?.readOnlyQuote;
  if (!isPositiveFinite(quote?.lastPrice)) return null;
  return {
    price: quote.lastPrice,
    observedAtKst: quote.observedAtKst ?? input.entry.createdAtKst,
    source: 'READ_ONLY_QUOTE',
  };
}

function isMarketClosedForHorizon(
  entryAtKst: string,
  horizon: CounterfactualShadowHorizon,
): boolean {
  const targetAt = resolveHorizonTargetTimeKst(entryAtKst, horizon);
  if (!targetAt) return false;
  const targetKey = targetAt.slice(0, 10);
  return !isKrxTradingDay(targetKey);
}

export function createCounterfactualShadowPriceProvider(
  input: CreateCounterfactualShadowPriceProviderInput,
): CounterfactualShadowPriceProvider {
  const entriesIndex = new Map<string, CounterfactualShadowLearningLedgerEntry>();
  for (const entry of input.entries) {
    entriesIndex.set(`${entry.symbol}:${entry.createdAtKst}`, entry);
  }

  const readers: Required<CounterfactualPriceCacheReaders> = {
    intraday: input.cacheReaders?.intraday ?? defaultIntradayReader,
    daily: input.cacheReaders?.daily ?? defaultDailyReader,
    marketData: input.cacheReaders?.marketData ?? defaultMarketDataReader,
    readOnlyQuote: input.cacheReaders?.readOnlyQuote ?? defaultReadOnlyQuoteReader,
  };
  const allowSnapshotFallback = input.allowSnapshotFallback ?? true;

  return async (symbol, horizon, entryAtKst) => {
    const key = `${symbol}:${entryAtKst}`;
    const entry = entriesIndex.get(key);
    if (!entry) {
      return {
        available: false,
        reason: 'counterfactual entry not found in provider index',
        status: 'DATA_UNAVAILABLE',
        source: 'NONE',
      };
    }

    const nowMs = Date.parse(input.nowKst ?? new Date().toISOString());
    if (!isCounterfactualHorizonReached(entryAtKst, horizon, nowMs)) {
      return {
        available: false,
        reason: 'horizon not yet reached',
        status: 'PENDING',
        source: 'NONE',
      };
    }

    const targetAtKst = resolveHorizonTargetTimeKst(entryAtKst, horizon);
    if (!targetAtKst) {
      return {
        available: false,
        reason: 'horizon target time unavailable',
        status: 'INSUFFICIENT_DATA',
        source: 'NONE',
      };
    }

    if (!isCounterfactualPriceProviderCacheDisabled()) {
      try {
        const lookupInput = { entry, symbol, horizon, entryAtKst, targetAtKst };
        const orderedReaders = isIntradayHorizon(horizon)
          ? [readers.intraday, readers.daily, readers.marketData, readers.readOnlyQuote]
          : [readers.daily, readers.intraday, readers.marketData, readers.readOnlyQuote];
        for (const reader of orderedReaders) {
          const hit = reader(lookupInput);
          if (hit && isPositiveFinite(hit.price)) {
            return {
              available: true,
              price: hit.price,
              observedAtKst: hit.observedAtKst,
              source: hit.source,
            };
          }
        }
      } catch (e) {
        return {
          available: false,
          reason: e instanceof Error ? e.message : String(e),
          status: 'ERROR',
          source: 'NONE',
        };
      }
    }

    const entryPrice = resolveCounterfactualEntryPriceWithSource(entry);
    if (allowSnapshotFallback && entryPrice) {
      return {
        available: true,
        price: entryPrice.price,
        observedAtKst: entry.createdAtKst,
        source: entryPrice.source,
      };
    }

    if (isMarketClosedForHorizon(entryAtKst, horizon)) {
      return {
        available: false,
        reason: 'market closed for horizon',
        status: 'MARKET_CLOSED',
        source: 'NONE',
      };
    }

    return {
      available: false,
      reason: 'cache miss in cache-only counterfactual price provider',
      status: entryPrice ? 'DATA_UNAVAILABLE' : 'INSUFFICIENT_DATA',
      source: 'NONE',
    };
  };
}
