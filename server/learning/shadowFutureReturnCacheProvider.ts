// @responsibility PATCH-D cache-backed price provider for ShadowLearningOnlySignal future returns.
/**
 * Cache-backed read-only provider for shadow future-return resolver.
 *
 * It reuses existing Yahoo snapshot cache helpers and KRX calendar logic.
 * This module does not fetch external data and does not import KIS/order paths.
 */

import {
  loadResolveAndSaveShadowFutureReturns,
  type ShadowFuturePriceProvider,
  type ShadowFuturePriceProviderInput,
  type ShadowFutureReturnHorizon,
} from './shadowFutureReturnResolver.js';
import { loadShadowLearningOnlySignals } from '../persistence/shadowLearningOnlySignalRepo.js';
import { getSnapshotKeySamples, getSnapshotSize } from '../persistence/offHoursSnapshotRepo.js';
import { isKrxTradingDay, toKstDateKey } from '../calendar/krxTradingCalendar.js';
import { readYahooSnapshotPoint } from './counterfactualShadowPriceProviderAdapter.js';
import type { ShadowLearningOnlySignal } from '../trading/shadowLearningOnlyScan.js';

const HORIZON_TRADING_DAY_OFFSET: Record<ShadowFutureReturnHorizon, number> = {
  '1d': 1,
  '3d': 3,
  '5d': 5,
  '20d': 20,
};

const HORIZONS: ShadowFutureReturnHorizon[] = ['1d', '3d', '5d', '20d'];

export interface ShadowFutureReturnCacheCoverageSummary {
  snapshotEntries: number;
  checkedSignals: number;
  checkedLookups: number;
  cacheHits: number;
  cacheMisses: number;
  unresolvedSignals: number;
  notYetDueLookups: number;
  sampleMissingTargets: string[];
  sampleSnapshotKeys: string[];
}

function dateKeyToUtcNoon(dateKey: string): Date {
  return new Date(`${dateKey}T03:00:00.000Z`);
}

function addDateKeyDays(dateKey: string, days: number): string {
  const d = dateKeyToUtcNoon(dateKey);
  d.setUTCDate(d.getUTCDate() + days);
  return toKstDateKey(d);
}

export function findNthKrxTradingDayAfter(dateKey: string, n: number): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || n <= 0) return null;
  let cursor = dateKey;
  let count = 0;
  const maxWalk = n * 3 + 20;
  for (let i = 0; i < maxWalk; i += 1) {
    cursor = addDateKeyDays(cursor, 1);
    if (isKrxTradingDay(cursor)) {
      count += 1;
      if (count >= n) return cursor;
    }
  }
  return null;
}

export function resolveShadowFutureReturnTargetCloseKst(
  signalDate: string,
  horizon: ShadowFutureReturnHorizon,
): string | null {
  const signalDateKey = signalDate.slice(0, 10);
  const offset = HORIZON_TRADING_DAY_OFFSET[horizon];
  const targetDateKey = findNthKrxTradingDayAfter(signalDateKey, offset);
  if (!targetDateKey) return null;
  return `${targetDateKey}T15:30:00+09:00`;
}

export function isShadowFutureReturnTargetMature(
  input: ShadowFuturePriceProviderInput,
  now: Date = new Date(),
): boolean {
  const targetAtKst = resolveShadowFutureReturnTargetCloseKst(input.signalDate, input.horizon);
  if (!targetAtKst) return false;
  const targetMs = Date.parse(targetAtKst);
  return Number.isFinite(targetMs) && targetMs <= now.getTime();
}

function rangeCandidatesForHorizon(horizon: ShadowFutureReturnHorizon): string[] {
  if (horizon === '20d') return ['3mo', '6mo', '1y'];
  if (horizon === '5d') return ['1mo', '3mo', '1y'];
  return ['5d', '1mo', '3mo', '1y'];
}

export function symbolCandidatesForShadowFutureReturnCache(symbol: string): string[] {
  const s = symbol.trim();
  if (!/^\d{6}$/.test(s)) return [s];
  return [`${s}.KS`, `${s}.KQ`, s];
}

function hasResolvedHorizon(signal: ShadowLearningOnlySignal, horizon: ShadowFutureReturnHorizon): boolean {
  if (horizon === '1d') return typeof signal.futureReturn1d === 'number';
  if (horizon === '3d') return typeof signal.futureReturn3d === 'number';
  if (horizon === '5d') return typeof signal.futureReturn5d === 'number';
  return typeof signal.futureReturn20d === 'number';
}

function lookupCachePoint(symbol: string, targetAtKst: string, horizon: ShadowFutureReturnHorizon) {
  for (const candidate of symbolCandidatesForShadowFutureReturnCache(symbol)) {
    for (const range of rangeCandidatesForHorizon(horizon)) {
      const point = readYahooSnapshotPoint(candidate, targetAtKst, range, '1d', 'closest');
      if (point && Number.isFinite(point.price) && point.price > 0) return point;
    }
  }
  return null;
}

export function createShadowFutureReturnCachePriceProvider(): ShadowFuturePriceProvider {
  return ({ symbol, signalDate, horizon }) => {
    const targetAtKst = resolveShadowFutureReturnTargetCloseKst(signalDate, horizon);
    if (!targetAtKst) return null;
    const point = lookupCachePoint(symbol, targetAtKst, horizon);
    if (!point) return null;
    return {
      price: point.price,
      observedAt: point.observedAtKst,
    };
  };
}

export function buildShadowFutureReturnCacheCoverageSummary(
  signals: ShadowLearningOnlySignal[],
  sampleLimit = 5,
  now: Date = new Date(),
): ShadowFutureReturnCacheCoverageSummary {
  let checkedLookups = 0;
  let cacheHits = 0;
  let cacheMisses = 0;
  let notYetDueLookups = 0;
  const unresolved = new Set<string>();
  const sampleMissingTargets: string[] = [];

  for (const signal of signals) {
    for (const horizon of HORIZONS) {
      if (hasResolvedHorizon(signal, horizon)) continue;
      const targetAtKst = resolveShadowFutureReturnTargetCloseKst(signal.signalDate, horizon);
      if (!targetAtKst) continue;
      if (!isShadowFutureReturnTargetMature({
        symbol: signal.symbol,
        signalDate: signal.signalDate,
        horizon,
        signal,
      }, now)) {
        notYetDueLookups += 1;
        continue;
      }
      checkedLookups += 1;
      const hit = lookupCachePoint(signal.symbol, targetAtKst, horizon);
      if (hit) {
        cacheHits += 1;
      } else {
        cacheMisses += 1;
        unresolved.add(signal.symbol);
        if (sampleMissingTargets.length < sampleLimit) {
          sampleMissingTargets.push(`${signal.symbol}:${horizon}:${targetAtKst.slice(0, 10)}:${symbolCandidatesForShadowFutureReturnCache(signal.symbol).join('|')}:${rangeCandidatesForHorizon(horizon).join('|')}`);
        }
      }
    }
  }

  return {
    snapshotEntries: getSnapshotSize(),
    checkedSignals: signals.length,
    checkedLookups,
    cacheHits,
    cacheMisses,
    unresolvedSignals: unresolved.size,
    notYetDueLookups,
    sampleMissingTargets,
    sampleSnapshotKeys: getSnapshotKeySamples(sampleLimit),
  };
}

export function loadAndBuildShadowFutureReturnCacheCoverageSummary(): ShadowFutureReturnCacheCoverageSummary {
  return buildShadowFutureReturnCacheCoverageSummary(loadShadowLearningOnlySignals());
}

export async function loadResolveAndSaveShadowFutureReturnsFromCache() {
  return loadResolveAndSaveShadowFutureReturns(createShadowFutureReturnCachePriceProvider(), {
    maturityGate: isShadowFutureReturnTargetMature,
  });
}
