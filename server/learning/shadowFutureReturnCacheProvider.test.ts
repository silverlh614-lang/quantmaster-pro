// @responsibility PATCH-D shadowFutureReturnCacheProvider tests — cache-only read path

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./counterfactualShadowPriceProviderAdapter.js', () => ({
  readYahooSnapshotPoint: vi.fn(),
}));

vi.mock('./shadowFutureReturnResolver.js', async () => {
  const actual = await vi.importActual<typeof import('./shadowFutureReturnResolver.js')>(
    './shadowFutureReturnResolver.js',
  );
  return {
    ...actual,
    loadResolveAndSaveShadowFutureReturns: vi.fn(),
  };
});

import { readYahooSnapshotPoint } from './counterfactualShadowPriceProviderAdapter.js';
import { loadResolveAndSaveShadowFutureReturns } from './shadowFutureReturnResolver.js';
import {
  createShadowFutureReturnCachePriceProvider,
  findNthKrxTradingDayAfter,
  loadResolveAndSaveShadowFutureReturnsFromCache,
  resolveShadowFutureReturnTargetCloseKst,
} from './shadowFutureReturnCacheProvider.js';

const mockedReadYahooSnapshotPoint = vi.mocked(readYahooSnapshotPoint);
const mockedLoadResolveAndSave = vi.mocked(loadResolveAndSaveShadowFutureReturns);

describe('shadowFutureReturnCacheProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('finds the next KRX trading day while skipping weekend', () => {
    expect(findNthKrxTradingDayAfter('2026-05-08', 1)).toBe('2026-05-11');
  });

  it('skips known KRX holidays when resolving future trading day', () => {
    // 2026-05-25 is in the local static holiday table.
    expect(findNthKrxTradingDayAfter('2026-05-22', 1)).toBe('2026-05-26');
  });

  it('resolves horizon target close time in KST', () => {
    expect(resolveShadowFutureReturnTargetCloseKst('2026-05-08', '1d')).toBe(
      '2026-05-11T15:30:00+09:00',
    );
  });

  it('returns null for invalid signal date', () => {
    expect(resolveShadowFutureReturnTargetCloseKst('bad-date', '1d')).toBeNull();
  });

  it('reads first available Yahoo snapshot point for short horizon', () => {
    mockedReadYahooSnapshotPoint
      .mockReturnValueOnce(null)
      .mockReturnValueOnce({ price: 10100, observedAtKst: '2026-05-11T15:30:00+09:00', timestampMs: 1 });
    const provider = createShadowFutureReturnCachePriceProvider();

    const result = provider({
      symbol: '005930',
      signalDate: '2026-05-08',
      horizon: '1d',
      signal: {} as never,
    });

    expect(result).toEqual({
      price: 10100,
      observedAt: '2026-05-11T15:30:00+09:00',
    });
    expect(mockedReadYahooSnapshotPoint).toHaveBeenNthCalledWith(
      1,
      '005930',
      '2026-05-11T15:30:00+09:00',
      '5d',
      '1d',
      'closest',
    );
    expect(mockedReadYahooSnapshotPoint).toHaveBeenNthCalledWith(
      2,
      '005930',
      '2026-05-11T15:30:00+09:00',
      '1mo',
      '1d',
      'closest',
    );
  });

  it('uses longer range candidates for 20d horizon', () => {
    mockedReadYahooSnapshotPoint.mockReturnValueOnce({
      price: 12000,
      observedAtKst: '2026-06-09T15:30:00+09:00',
      timestampMs: 1,
    });
    const provider = createShadowFutureReturnCachePriceProvider();

    const result = provider({
      symbol: '005930',
      signalDate: '2026-05-08',
      horizon: '20d',
      signal: {} as never,
    });

    expect(result?.price).toBe(12000);
    expect(mockedReadYahooSnapshotPoint.mock.calls[0]?.[2]).toBe('3mo');
  });

  it('returns null when cache has no usable price', () => {
    mockedReadYahooSnapshotPoint.mockReturnValue(null);
    const provider = createShadowFutureReturnCachePriceProvider();

    expect(provider({
      symbol: '005930',
      signalDate: '2026-05-08',
      horizon: '5d',
      signal: {} as never,
    })).toBeNull();
  });

  it('wires cache provider into loadResolveAndSaveShadowFutureReturns', async () => {
    mockedLoadResolveAndSave.mockResolvedValue({
      scanned: 0,
      updatedSignals: 0,
      resolved1d: 0,
      resolved3d: 0,
      resolved5d: 0,
      resolved20d: 0,
      skippedAlreadyResolved: 0,
      providerMisses: 0,
    });

    const stats = await loadResolveAndSaveShadowFutureReturnsFromCache();

    expect(stats.scanned).toBe(0);
    expect(mockedLoadResolveAndSave).toHaveBeenCalledTimes(1);
    expect(typeof mockedLoadResolveAndSave.mock.calls[0]?.[0]).toBe('function');
  });
});
