// @responsibility PATCH-D shadowFutureReturnCacheProvider tests — cache-only read path

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShadowLearningOnlySignal } from '../trading/shadowLearningOnlyScan.js';

vi.mock('./counterfactualShadowPriceProviderAdapter.js', () => ({
  readYahooSnapshotPoint: vi.fn(),
}));

vi.mock('../persistence/offHoursSnapshotRepo.js', () => ({
  getSnapshotKeySamples: vi.fn(() => []),
  getSnapshotSize: vi.fn(() => 0),
}));

vi.mock('../persistence/shadowLearningOnlySignalRepo.js', () => ({
  loadShadowLearningOnlySignals: vi.fn(() => []),
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
import { getSnapshotKeySamples, getSnapshotSize } from '../persistence/offHoursSnapshotRepo.js';
import { loadShadowLearningOnlySignals } from '../persistence/shadowLearningOnlySignalRepo.js';
import { loadResolveAndSaveShadowFutureReturns } from './shadowFutureReturnResolver.js';
import {
  buildShadowFutureReturnCacheCoverageSummary,
  createShadowFutureReturnCachePriceProvider,
  findNthKrxTradingDayAfter,
  isShadowFutureReturnTargetMature,
  loadAndBuildShadowFutureReturnCacheCoverageSummary,
  loadResolveAndSaveShadowFutureReturnsFromCache,
  resolveShadowFutureReturnTargetCloseKst,
  symbolCandidatesForShadowFutureReturnCache,
} from './shadowFutureReturnCacheProvider.js';

const mockedReadYahooSnapshotPoint = vi.mocked(readYahooSnapshotPoint);
const mockedGetSnapshotKeySamples = vi.mocked(getSnapshotKeySamples);
const mockedGetSnapshotSize = vi.mocked(getSnapshotSize);
const mockedLoadSignals = vi.mocked(loadShadowLearningOnlySignals);
const mockedLoadResolveAndSave = vi.mocked(loadResolveAndSaveShadowFutureReturns);

function signal(overrides: Partial<ShadowLearningOnlySignal> = {}): ShadowLearningOnlySignal {
  return {
    symbol: overrides.symbol ?? '005930',
    signalDate: overrides.signalDate ?? '2026-05-08',
    blockedReason: overrides.blockedReason ?? 'DATA_STARVED',
    learningOnly: true,
    executionImpact: 'NONE',
    wouldHaveBought: overrides.wouldHaveBought ?? true,
    hypotheticalEntryPrice: overrides.hypotheticalEntryPrice ?? 10000,
    hypotheticalStopLoss: overrides.hypotheticalStopLoss ?? 9200,
    hypotheticalTargetPrice: overrides.hypotheticalTargetPrice ?? 12000,
    signalGrade: overrides.signalGrade ?? 'BUY',
    gateScore: overrides.gateScore ?? 7,
    regime: overrides.regime ?? 'R2_BULL',
    macroBlockReason: overrides.macroBlockReason ?? 'test',
    dataQualityStatus: overrides.dataQualityStatus ?? 'OK',
    ...overrides,
  };
}

function emptyStats() {
  return {
    scanned: 0,
    updatedSignals: 0,
    resolved1d: 0,
    resolved3d: 0,
    resolved5d: 0,
    resolved20d: 0,
    skippedAlreadyResolved: 0,
    providerMisses: 0,
    notYetDue: 0,
    notYetDue1d: 0,
    notYetDue3d: 0,
    notYetDue5d: 0,
    notYetDue20d: 0,
  };
}

describe('shadowFutureReturnCacheProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetSnapshotKeySamples.mockReturnValue([]);
    mockedGetSnapshotSize.mockReturnValue(0);
    mockedLoadSignals.mockReturnValue([]);
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

  it('detects whether a target close is mature', () => {
    expect(isShadowFutureReturnTargetMature({
      symbol: '005930',
      signalDate: '2026-05-08',
      horizon: '1d',
      signal: signal(),
    }, new Date('2026-05-11T06:31:00.000Z'))).toBe(true);
    expect(isShadowFutureReturnTargetMature({
      symbol: '005930',
      signalDate: '2026-05-08',
      horizon: '3d',
      signal: signal(),
    }, new Date('2026-05-11T06:31:00.000Z'))).toBe(false);
  });

  it('builds symbol candidates for six digit KRX code', () => {
    expect(symbolCandidatesForShadowFutureReturnCache('061970')).toEqual([
      '061970.KS',
      '061970.KQ',
      '061970',
    ]);
  });

  it('reads first available Yahoo snapshot point for short horizon through suffix fallback', async () => {
    mockedReadYahooSnapshotPoint
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(null)
      .mockReturnValueOnce({ price: 10100, observedAtKst: '2026-05-11T15:30:00+09:00', timestampMs: 1 });
    const provider = createShadowFutureReturnCachePriceProvider();

    const result = await provider({
      symbol: '061970',
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
      '061970.KS',
      '2026-05-11T15:30:00+09:00',
      '5d',
      '1d',
      'closest',
    );
    expect(mockedReadYahooSnapshotPoint).toHaveBeenNthCalledWith(
      5,
      '061970.KQ',
      '2026-05-11T15:30:00+09:00',
      '5d',
      '1d',
      'closest',
    );
  });

  it('uses longer range candidates for 20d horizon', async () => {
    mockedReadYahooSnapshotPoint.mockReturnValueOnce({
      price: 12000,
      observedAtKst: '2026-06-09T15:30:00+09:00',
      timestampMs: 1,
    });
    const provider = createShadowFutureReturnCachePriceProvider();

    const result = await provider({
      symbol: '005930',
      signalDate: '2026-05-08',
      horizon: '20d',
      signal: {} as never,
    });

    expect(result?.price).toBe(12000);
    expect(mockedReadYahooSnapshotPoint.mock.calls[0]?.[2]).toBe('3mo');
  });

  it('returns null when cache has no usable price', async () => {
    mockedReadYahooSnapshotPoint.mockReturnValue(null);
    const provider = createShadowFutureReturnCachePriceProvider();

    const result = await provider({
      symbol: '005930',
      signalDate: '2026-05-08',
      horizon: '5d',
      signal: {} as never,
    });

    expect(result).toBeNull();
  });

  it('builds maturity-aware cache coverage summary with misses, due counts, and samples', () => {
    mockedGetSnapshotSize.mockReturnValue(12);
    mockedGetSnapshotKeySamples.mockReturnValue(['061970.KQ:1mo:1d', '336370.KS:5d:1d']);
    mockedReadYahooSnapshotPoint
      .mockReturnValueOnce({ price: 10100, observedAtKst: '2026-05-11T15:30:00+09:00', timestampMs: 1 })
      .mockReturnValue(null);

    const summary = buildShadowFutureReturnCacheCoverageSummary([
      signal({ symbol: '005930' }),
      signal({ symbol: '000660', futureReturn1d: 0.01 }),
    ], 2, new Date('2026-05-11T06:31:00.000Z'));

    expect(summary.snapshotEntries).toBe(12);
    expect(summary.checkedSignals).toBe(2);
    expect(summary.checkedLookups).toBe(1);
    expect(summary.cacheHits).toBe(1);
    expect(summary.cacheMisses).toBe(0);
    expect(summary.unresolvedSignals).toBe(0);
    expect(summary.notYetDueLookups).toBe(6);
    expect(summary.sampleMissingTargets).toHaveLength(0);
    expect(summary.sampleSnapshotKeys).toEqual(['061970.KQ:1mo:1d', '336370.KS:5d:1d']);
    expect(mockedGetSnapshotKeySamples).toHaveBeenCalledWith(2);
  });

  it('shows mature cache misses only when target close has passed', () => {
    mockedGetSnapshotSize.mockReturnValue(3);
    mockedGetSnapshotKeySamples.mockReturnValue(['005930.KS:5d:1d']);
    mockedReadYahooSnapshotPoint.mockReturnValue(null);

    const summary = buildShadowFutureReturnCacheCoverageSummary([
      signal({ symbol: '005930' }),
    ], 2, new Date('2026-05-11T06:31:00.000Z'));

    expect(summary.checkedSignals).toBe(1);
    expect(summary.checkedLookups).toBe(1);
    expect(summary.cacheMisses).toBe(1);
    expect(summary.notYetDueLookups).toBe(3);
    expect(summary.sampleMissingTargets).toHaveLength(1);
    expect(summary.sampleMissingTargets[0]).toContain('005930:1d:2026-05-11:');
  });

  it('loads signals for cache coverage summary convenience function', () => {
    mockedGetSnapshotSize.mockReturnValue(3);
    mockedGetSnapshotKeySamples.mockReturnValue(['005930.KS:5d:1d']);
    mockedLoadSignals.mockReturnValue([signal({ symbol: '005930' })]);
    mockedReadYahooSnapshotPoint.mockReturnValue(null);

    const summary = loadAndBuildShadowFutureReturnCacheCoverageSummary();

    expect(summary.snapshotEntries).toBe(3);
    expect(summary.checkedSignals).toBe(1);
    expect(summary.sampleSnapshotKeys).toEqual(['005930.KS:5d:1d']);
  });

  it('wires cache provider and maturity gate into loadResolveAndSaveShadowFutureReturns', async () => {
    mockedLoadResolveAndSave.mockResolvedValue(emptyStats());

    const stats = await loadResolveAndSaveShadowFutureReturnsFromCache();

    expect(stats.scanned).toBe(0);
    expect(mockedLoadResolveAndSave).toHaveBeenCalledTimes(1);
    expect(typeof mockedLoadResolveAndSave.mock.calls[0]?.[0]).toBe('function');
    expect(typeof mockedLoadResolveAndSave.mock.calls[0]?.[1]?.maturityGate).toBe('function');
  });
});
