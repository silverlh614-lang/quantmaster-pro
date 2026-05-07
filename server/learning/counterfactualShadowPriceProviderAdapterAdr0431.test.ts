// @responsibility ADR-0431 thin adapter 회귀 테스트.
//
// ProvisionalShadowPriceProvider → CounterfactualShadowPriceProvider wrap 동등성.
// 사용자 §C 정합 — 큰 refactor 회피, ADR-0429 cache-first reuse.

import { describe, expect, it } from 'vitest';
import {
  createCounterfactualShadowPriceProvider,
  isCounterfactualPriceProviderCacheDisabled,
  wrapProvisionalProviderForCounterfactual,
} from './counterfactualShadowPriceProviderAdapter.js';
import type { ProvisionalShadowPriceProvider } from './provisionalShadowPerformanceReport.js';
import type { CounterfactualShadowLearningLedgerEntry } from '../persistence/counterfactualShadowLearningRepo.js';

function makeEntry(
  overrides: Partial<CounterfactualShadowLearningLedgerEntry & { entryPrice?: number; metadata?: Record<string, unknown> }> = {},
): CounterfactualShadowLearningLedgerEntry {
  return {
    eventType: 'COUNTERFACTUAL_SHADOW_LEARNING_ENTRY',
    source: 'ADR-0430',
    learningOnly: true,
    provisional: false,
    executionShadow: false,
    symbol: '005930',
    name: 'Samsung',
    scanId: 'scan-1',
    createdAtKst: '2026-05-07T10:00:00+09:00',
    label: 'R3_COUNTERFACTUAL_UNDER_SELL_ONLY',
    reasons: ['SELL_ONLY'],
    blockedBy: ['SELL_ONLY'],
    liveAllowed: false,
    paperAllowed: false,
    executionShadowAllowed: false,
    virtualAccountImpact: 'NONE',
    gate1Passed: true,
    gate2Passed: false,
    ...overrides,
  } as CounterfactualShadowLearningLedgerEntry;
}

describe('ADR-0431 counterfactualShadowPriceProviderAdapter', () => {
  it('available=true wrap — price/observedAtKst 그대로 forward + source ENTRY_SNAPSHOT', async () => {
    const provisional: ProvisionalShadowPriceProvider = async () => ({
      available: true,
      price: 105000,
      observedAtKst: '2026-05-07T11:00:00+09:00',
    });
    const wrapped = wrapProvisionalProviderForCounterfactual(provisional);
    const result = await wrapped('005930', 'T_PLUS_30M', '2026-05-07T10:00:00+09:00');
    if (!result.available) {
      throw new Error('expected available=true');
    }
    expect(result.price).toBe(105000);
    expect(result.observedAtKst).toBe('2026-05-07T11:00:00+09:00');
    expect(result.source).toBe('ENTRY_SNAPSHOT');
  });

  it('available=false wrap — reason / status / source NONE', async () => {
    const provisional: ProvisionalShadowPriceProvider = async () => ({
      available: false,
      reason: 'cache miss',
      status: 'DATA_UNAVAILABLE',
    });
    const wrapped = wrapProvisionalProviderForCounterfactual(provisional);
    const result = await wrapped('005930', 'T_PLUS_30M', '2026-05-07T10:00:00+09:00');
    if (result.available) {
      throw new Error('expected available=false');
    }
    expect(result.reason).toBe('cache miss');
    expect(result.status).toBe('DATA_UNAVAILABLE');
    expect(result.source).toBe('NONE');
  });

  it('horizon string forward — 6-value union 동등성', async () => {
    const seenHorizons: string[] = [];
    const provisional: ProvisionalShadowPriceProvider = async (_s, h) => {
      seenHorizons.push(h);
      return { available: false, reason: 'no data' };
    };
    const wrapped = wrapProvisionalProviderForCounterfactual(provisional);
    const horizons = [
      'T_PLUS_30M',
      'T_PLUS_1H',
      'SAME_DAY_CLOSE',
      'NEXT_OPEN',
      'T_PLUS_1D_CLOSE',
      'T_PLUS_3D_CLOSE',
    ] as const;
    for (const h of horizons) {
      await wrapped('005930', h, '2026-05-07T10:00:00+09:00');
    }
    expect(seenHorizons).toEqual([
      'T_PLUS_30M',
      'T_PLUS_1H',
      'SAME_DAY_CLOSE',
      'NEXT_OPEN',
      'T_PLUS_1D_CLOSE',
      'T_PLUS_3D_CLOSE',
    ]);
  });

  it('available=false + status undefined → status undefined 그대로 (호출자가 DATA_UNAVAILABLE fallback)', async () => {
    const provisional: ProvisionalShadowPriceProvider = async () => ({
      available: false,
      reason: 'no status set',
    });
    const wrapped = wrapProvisionalProviderForCounterfactual(provisional);
    const result = await wrapped('005930', 'T_PLUS_30M', '2026-05-07T10:00:00+09:00');
    if (result.available) {
      throw new Error('expected available=false');
    }
    expect(result.status).toBeUndefined();
    expect(result.source).toBe('NONE');
  });
});

describe('ADR-0434 counterfactual cache-only priceProvider', () => {
  it('entry snapshot fallback rejects 0/NaN/negative and accepts positive entryPrice', async () => {
    const valid = makeEntry({ entryPrice: 100000 });
    const provider = createCounterfactualShadowPriceProvider({
      entries: [valid],
      nowKst: '2026-05-07T11:00:00+09:00',
      cacheReaders: {
        intraday: () => null,
        daily: () => null,
        marketData: () => null,
        readOnlyQuote: () => null,
      },
    });
    const ok = await provider('005930', 'T_PLUS_30M', valid.createdAtKst);
    expect(ok.available).toBe(true);
    if (ok.available) expect(ok.source).toBe('ENTRY_SNAPSHOT');

    for (const badPrice of [0, -1, NaN]) {
      const bad = makeEntry({ entryPrice: badPrice, scanId: `bad-${badPrice}` });
      const badProvider = createCounterfactualShadowPriceProvider({
        entries: [bad],
        nowKst: '2026-05-07T11:00:00+09:00',
        allowSnapshotFallback: false,
      });
      const result = await badProvider('005930', 'T_PLUS_30M', bad.createdAtKst);
      expect(result.available).toBe(false);
      if (!result.available) expect(result.status).toBe('INSUFFICIENT_DATA');
    }
  });

  it('scan snapshot fallback follows conditionSnapshot.price, lastPrice, metadata.quoteSnapshot.lastPrice', async () => {
    const cases = [
      makeEntry({ conditionSnapshot: { price: 100000 } }),
      makeEntry({
        scanId: 'scan-2',
        symbol: '000660',
        createdAtKst: '2026-05-07T10:01:00+09:00',
        conditionSnapshot: { lastPrice: 99000 },
      }),
      makeEntry({
        scanId: 'scan-3',
        symbol: '035420',
        createdAtKst: '2026-05-07T10:02:00+09:00',
        metadata: { quoteSnapshot: { lastPrice: 98000 } },
      }),
    ];
    const provider = createCounterfactualShadowPriceProvider({
      entries: cases,
      nowKst: '2026-05-07T11:00:00+09:00',
      cacheReaders: {
        intraday: () => null,
        daily: () => null,
        marketData: () => null,
        readOnlyQuote: () => null,
      },
    });
    for (const entry of cases) {
      const result = await provider(entry.symbol, 'T_PLUS_30M', entry.createdAtKst);
      expect(result.available).toBe(true);
      if (result.available) expect(result.source).toBe('SCAN_SNAPSHOT');
    }
  });

  it('intraday and daily cache readers are used cache-only with DATA_UNAVAILABLE on miss', async () => {
    const entry = makeEntry({ entryPrice: 100000 });
    const provider = createCounterfactualShadowPriceProvider({
      entries: [entry],
      nowKst: '2026-05-12T15:00:00+09:00',
      allowSnapshotFallback: false,
      cacheReaders: {
        intraday: () => ({
          price: 101000,
          observedAtKst: '2026-05-07T10:30:00+09:00',
          source: 'INTRADAY_CANDLE_CACHE',
        }),
        daily: () => ({
          price: 103000,
          observedAtKst: '2026-05-08T15:30:00+09:00',
          source: 'DAILY_CANDLE_CACHE',
        }),
        marketData: () => null,
        readOnlyQuote: () => null,
      },
    });
    const intraday = await provider('005930', 'T_PLUS_30M', entry.createdAtKst);
    expect(intraday.available).toBe(true);
    if (intraday.available) expect(intraday.source).toBe('INTRADAY_CANDLE_CACHE');

    const daily = await provider('005930', 'T_PLUS_1D_CLOSE', entry.createdAtKst);
    expect(daily.available).toBe(true);
    if (daily.available) expect(daily.source).toBe('DAILY_CANDLE_CACHE');

    const missProvider = createCounterfactualShadowPriceProvider({
      entries: [entry],
      nowKst: '2026-05-12T15:00:00+09:00',
      allowSnapshotFallback: false,
      cacheReaders: {
        intraday: () => null,
        daily: () => null,
        marketData: () => null,
        readOnlyQuote: () => null,
      },
    });
    const miss = await missProvider('005930', 'T_PLUS_30M', entry.createdAtKst);
    expect(miss.available).toBe(false);
    if (!miss.available) expect(miss.status).toBe('DATA_UNAVAILABLE');
  });

  it('market data and read-only quote cache readers are used after candle cache misses', async () => {
    const entry = makeEntry({ entryPrice: 100000 });
    const marketProvider = createCounterfactualShadowPriceProvider({
      entries: [entry],
      nowKst: '2026-05-07T11:00:00+09:00',
      allowSnapshotFallback: false,
      cacheReaders: {
        intraday: () => null,
        daily: () => null,
        marketData: () => ({
          price: 101500,
          observedAtKst: '2026-05-07T10:35:00+09:00',
          source: 'MARKET_DATA_CACHE',
        }),
        readOnlyQuote: () => null,
      },
    });
    const market = await marketProvider('005930', 'T_PLUS_30M', entry.createdAtKst);
    expect(market.available).toBe(true);
    if (market.available) expect(market.source).toBe('MARKET_DATA_CACHE');

    const quoteProvider = createCounterfactualShadowPriceProvider({
      entries: [entry],
      nowKst: '2026-05-07T11:00:00+09:00',
      allowSnapshotFallback: false,
      cacheReaders: {
        intraday: () => null,
        daily: () => null,
        marketData: () => null,
        readOnlyQuote: () => ({
          price: 100800,
          observedAtKst: '2026-05-07T10:32:00+09:00',
          source: 'READ_ONLY_QUOTE',
        }),
      },
    });
    const quote = await quoteProvider('005930', 'T_PLUS_30M', entry.createdAtKst);
    expect(quote.available).toBe(true);
    if (quote.available) expect(quote.source).toBe('READ_ONLY_QUOTE');
  });

  it('market-closed horizons are classified as MARKET_CLOSED instead of losses', async () => {
    const entry = makeEntry({
      entryPrice: 100000,
      createdAtKst: '2026-05-09T10:00:00+09:00',
    });
    const provider = createCounterfactualShadowPriceProvider({
      entries: [entry],
      nowKst: '2026-05-10T12:00:00+09:00',
      allowSnapshotFallback: false,
      cacheReaders: {
        intraday: () => null,
        daily: () => null,
        marketData: () => null,
        readOnlyQuote: () => null,
      },
    });
    const result = await provider('005930', 'SAME_DAY_CLOSE', entry.createdAtKst);
    expect(result.available).toBe(false);
    if (!result.available) expect(result.status).toBe('MARKET_CLOSED');
  });

  it('horizon not reached is PENDING and provider exceptions are isolated as ERROR', async () => {
    const entry = makeEntry({ entryPrice: 100000 });
    const pendingProvider = createCounterfactualShadowPriceProvider({
      entries: [entry],
      nowKst: '2026-05-07T10:10:00+09:00',
    });
    const pending = await pendingProvider('005930', 'T_PLUS_30M', entry.createdAtKst);
    expect(pending.available).toBe(false);
    if (!pending.available) expect(pending.status).toBe('PENDING');

    const throwingProvider = createCounterfactualShadowPriceProvider({
      entries: [entry],
      nowKst: '2026-05-07T11:00:00+09:00',
      cacheReaders: {
        intraday: () => {
          throw new Error('cache down');
        },
      },
    });
    const error = await throwingProvider('005930', 'T_PLUS_30M', entry.createdAtKst);
    expect(error.available).toBe(false);
    if (!error.available) expect(error.status).toBe('ERROR');
  });

  it('ENV cache disabled recognizes only exact true', async () => {
    const original = process.env.COUNTERFACTUAL_PRICE_PROVIDER_CACHE_DISABLED;
    try {
      process.env.COUNTERFACTUAL_PRICE_PROVIDER_CACHE_DISABLED = 'true';
      expect(isCounterfactualPriceProviderCacheDisabled()).toBe(true);
      for (const value of ['1', 'TRUE', 'yes']) {
        process.env.COUNTERFACTUAL_PRICE_PROVIDER_CACHE_DISABLED = value;
        expect(isCounterfactualPriceProviderCacheDisabled()).toBe(false);
      }
    } finally {
      if (original === undefined) delete process.env.COUNTERFACTUAL_PRICE_PROVIDER_CACHE_DISABLED;
      else process.env.COUNTERFACTUAL_PRICE_PROVIDER_CACHE_DISABLED = original;
    }
  });
});
