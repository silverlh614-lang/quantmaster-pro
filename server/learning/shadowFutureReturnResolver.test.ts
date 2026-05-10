// @responsibility PATCH-D shadowFutureReturnResolver tests — future return resolution without live execution coupling.

import { describe, expect, it, vi } from 'vitest';
import type { ShadowLearningOnlySignal } from '../trading/shadowLearningOnlyScan.js';
import {
  loadResolveAndSaveShadowFutureReturns,
  resolveShadowFutureReturns,
  type ShadowFuturePriceProvider,
} from './shadowFutureReturnResolver.js';
import {
  loadShadowLearningOnlySignals,
  saveShadowLearningOnlySignals,
} from '../persistence/shadowLearningOnlySignalRepo.js';

vi.mock('../persistence/shadowLearningOnlySignalRepo.js', () => ({
  loadShadowLearningOnlySignals: vi.fn(),
  saveShadowLearningOnlySignals: vi.fn(),
}));

const mockedLoad = vi.mocked(loadShadowLearningOnlySignals);
const mockedSave = vi.mocked(saveShadowLearningOnlySignals);

function signal(overrides: Partial<ShadowLearningOnlySignal> = {}): ShadowLearningOnlySignal {
  return {
    symbol: overrides.symbol ?? '005930',
    signalDate: overrides.signalDate ?? '2026-05-10',
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

describe('resolveShadowFutureReturns', () => {
  it('resolves all horizons using injected price provider', async () => {
    const provider: ShadowFuturePriceProvider = ({ horizon }) => {
      const prices = { '1d': 10100, '3d': 10200, '5d': 9700, '20d': 11000 } as const;
      return { price: prices[horizon] };
    };

    const { signals, stats } = await resolveShadowFutureReturns([
      signal({ hypotheticalEntryPrice: 10000 }),
    ], provider);

    expect(stats).toEqual({
      scanned: 1,
      updatedSignals: 1,
      resolved1d: 1,
      resolved3d: 1,
      resolved5d: 1,
      resolved20d: 1,
      skippedAlreadyResolved: 0,
      providerMisses: 0,
    });
    expect(signals[0]!.futureReturn1d).toBeCloseTo(0.01);
    expect(signals[0]!.futureReturn3d).toBeCloseTo(0.02);
    expect(signals[0]!.futureReturn5d).toBeCloseTo(-0.03);
    expect(signals[0]!.futureReturn20d).toBeCloseTo(0.1);
    expect(signals[0]).toEqual(expect.objectContaining({
      outcome: 'LOSS',
      learningOnly: true,
      executionImpact: 'NONE',
    }));
  });

  it('does not overwrite already resolved horizons', async () => {
    const provider: ShadowFuturePriceProvider = () => ({ price: 12000 });

    const { signals, stats } = await resolveShadowFutureReturns([
      signal({ futureReturn5d: 0.05 }),
    ], provider);

    expect(signals[0]!.futureReturn5d).toBe(0.05);
    expect(stats.skippedAlreadyResolved).toBe(1);
    expect(stats.resolved1d).toBe(1);
    expect(stats.resolved3d).toBe(1);
    expect(stats.resolved5d).toBe(0);
    expect(stats.resolved20d).toBe(1);
  });

  it('counts provider misses and leaves missing horizons unresolved', async () => {
    const provider: ShadowFuturePriceProvider = ({ horizon }) => {
      if (horizon === '5d') return { price: 10300 };
      return null;
    };

    const { signals, stats } = await resolveShadowFutureReturns([
      signal(),
    ], provider);

    expect(stats.providerMisses).toBe(3);
    expect(stats.resolved5d).toBe(1);
    expect(signals[0]!.futureReturn1d).toBeUndefined();
    expect(signals[0]!.futureReturn5d).toBeCloseTo(0.03);
    expect(signals[0]!.outcome).toBe('WIN');
  });

  it('sets pending outcome when nothing resolves and outcome is absent', async () => {
    const { signals, stats } = await resolveShadowFutureReturns([
      signal(),
    ], () => null);

    expect(stats.updatedSignals).toBe(0);
    expect(stats.providerMisses).toBe(4);
    expect(signals[0]!.outcome).toBe('PENDING');
  });

  it('loadResolveAndSaveShadowFutureReturns saves only when at least one signal updated', async () => {
    mockedLoad.mockReturnValueOnce([signal()]);
    mockedSave.mockClear();

    const stats = await loadResolveAndSaveShadowFutureReturns(() => ({ price: 11000 }));

    expect(stats.updatedSignals).toBe(1);
    expect(mockedSave).toHaveBeenCalledTimes(1);
    const saved = mockedSave.mock.calls[0]![0][0]!;
    expect(saved.futureReturn1d).toBeCloseTo(0.1);
    expect(saved.futureReturn3d).toBeCloseTo(0.1);
    expect(saved.futureReturn5d).toBeCloseTo(0.1);
    expect(saved.futureReturn20d).toBeCloseTo(0.1);
    expect(saved).toEqual(expect.objectContaining({
      outcome: 'WIN',
      learningOnly: true,
      executionImpact: 'NONE',
    }));
  });

  it('loadResolveAndSaveShadowFutureReturns does not save when nothing updated', async () => {
    mockedLoad.mockReturnValueOnce([signal({ outcome: 'PENDING' })]);
    mockedSave.mockClear();

    const stats = await loadResolveAndSaveShadowFutureReturns(() => null);

    expect(stats.updatedSignals).toBe(0);
    expect(mockedSave).not.toHaveBeenCalled();
  });
});
