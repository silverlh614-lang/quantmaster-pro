// @responsibility PATCH-D ShadowLearningOnlySignal future return resolver.
/**
 * Resolves futureReturn1d/3d/5d/20d for blocked-day ShadowLearningOnlySignal rows.
 *
 * This module mutates only the shadow-learning-only signal ledger through its SSOT repo.
 * It does not import KIS/order paths and does not change live trading, preflight, Gate,
 * Kelly, or execution behavior.
 */

import {
  loadShadowLearningOnlySignals,
  saveShadowLearningOnlySignals,
} from '../persistence/shadowLearningOnlySignalRepo.js';
import type { ShadowLearningOnlySignal } from '../trading/shadowLearningOnlyScan.js';

export type ShadowFutureReturnHorizon = '1d' | '3d' | '5d' | '20d';

export interface ShadowFuturePriceProviderInput {
  symbol: string;
  signalDate: string;
  horizon: ShadowFutureReturnHorizon;
  signal: ShadowLearningOnlySignal;
}

interface ShadowFuturePricePoint {
  price: number;
  observedAt?: string;
}

export type ShadowFuturePriceProvider = (
  input: ShadowFuturePriceProviderInput,
) => Promise<ShadowFuturePricePoint | null> | ShadowFuturePricePoint | null;

type ShadowFutureReturnMaturityGate = (
  input: ShadowFuturePriceProviderInput,
) => boolean;

export interface ShadowFutureReturnResolveOptions {
  maturityGate?: ShadowFutureReturnMaturityGate;
}

export interface ShadowFutureReturnResolveStats {
  scanned: number;
  updatedSignals: number;
  resolved1d: number;
  resolved3d: number;
  resolved5d: number;
  resolved20d: number;
  skippedAlreadyResolved: number;
  providerMisses: number;
  notYetDue: number;
  notYetDue1d: number;
  notYetDue3d: number;
  notYetDue5d: number;
  notYetDue20d: number;
}

const HORIZONS: ShadowFutureReturnHorizon[] = ['1d', '3d', '5d', '20d'];

function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function getResolvedReturn(
  signal: ShadowLearningOnlySignal,
  horizon: ShadowFutureReturnHorizon,
): number | undefined {
  if (horizon === '1d') return signal.futureReturn1d;
  if (horizon === '3d') return signal.futureReturn3d;
  if (horizon === '5d') return signal.futureReturn5d;
  return signal.futureReturn20d;
}

function setResolvedReturn(
  signal: ShadowLearningOnlySignal,
  horizon: ShadowFutureReturnHorizon,
  value: number,
): void {
  if (horizon === '1d') signal.futureReturn1d = value;
  else if (horizon === '3d') signal.futureReturn3d = value;
  else if (horizon === '5d') signal.futureReturn5d = value;
  else signal.futureReturn20d = value;
}

function incrementNotYetDue(
  stats: ShadowFutureReturnResolveStats,
  horizon: ShadowFutureReturnHorizon,
): void {
  stats.notYetDue += 1;
  if (horizon === '1d') stats.notYetDue1d += 1;
  else if (horizon === '3d') stats.notYetDue3d += 1;
  else if (horizon === '5d') stats.notYetDue5d += 1;
  else stats.notYetDue20d += 1;
}

function updateOutcomeFromResolvedReturns(signal: ShadowLearningOnlySignal): void {
  const preferred = signal.futureReturn5d
    ?? signal.futureReturn20d
    ?? signal.futureReturn3d
    ?? signal.futureReturn1d;
  if (typeof preferred !== 'number' || !Number.isFinite(preferred)) {
    signal.outcome = 'PENDING';
    return;
  }
  if (preferred > 0) signal.outcome = 'WIN';
  else if (preferred < 0) signal.outcome = 'LOSS';
  else signal.outcome = 'BE';
}

export async function resolveShadowFutureReturns(
  signals: ShadowLearningOnlySignal[],
  priceProvider: ShadowFuturePriceProvider,
  options: ShadowFutureReturnResolveOptions = {},
): Promise<{ signals: ShadowLearningOnlySignal[]; stats: ShadowFutureReturnResolveStats }> {
  const next = signals.map((signal) => ({
    ...signal,
    learningOnly: true as const,
    executionImpact: 'NONE' as const,
  }));

  const stats: ShadowFutureReturnResolveStats = {
    scanned: next.length,
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

  for (const signal of next) {
    let updated = false;
    for (const horizon of HORIZONS) {
      if (typeof getResolvedReturn(signal, horizon) === 'number') {
        stats.skippedAlreadyResolved += 1;
        continue;
      }
      const providerInput: ShadowFuturePriceProviderInput = {
        symbol: signal.symbol,
        signalDate: signal.signalDate,
        horizon,
        signal,
      };
      if (options.maturityGate && !options.maturityGate(providerInput)) {
        incrementNotYetDue(stats, horizon);
        continue;
      }
      const point = await priceProvider(providerInput);
      if (!point || !isPositiveFinite(point.price) || !isPositiveFinite(signal.hypotheticalEntryPrice)) {
        stats.providerMisses += 1;
        continue;
      }
      const futureReturn = point.price / signal.hypotheticalEntryPrice - 1;
      setResolvedReturn(signal, horizon, futureReturn);
      if (horizon === '1d') stats.resolved1d += 1;
      else if (horizon === '3d') stats.resolved3d += 1;
      else if (horizon === '5d') stats.resolved5d += 1;
      else stats.resolved20d += 1;
      updated = true;
    }
    if (updated) {
      updateOutcomeFromResolvedReturns(signal);
      stats.updatedSignals += 1;
    } else if (!signal.outcome) {
      updateOutcomeFromResolvedReturns(signal);
    }
  }

  return { signals: next, stats };
}

export async function loadResolveAndSaveShadowFutureReturns(
  priceProvider: ShadowFuturePriceProvider,
  options: ShadowFutureReturnResolveOptions = {},
): Promise<ShadowFutureReturnResolveStats> {
  const loaded = loadShadowLearningOnlySignals();
  const { signals, stats } = await resolveShadowFutureReturns(loaded, priceProvider, options);
  if (stats.updatedSignals > 0) {
    saveShadowLearningOnlySignals(signals);
  }
  return stats;
}
