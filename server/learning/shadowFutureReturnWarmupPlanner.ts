// @responsibility Shadow futureReturn snapshot warmup planner.

import { fetchAndStoreYahooHistoricalSnapshot } from '../market/yahooHistoricalSnapshotWarmup.js';
import { loadShadowLearningOnlySignals } from '../persistence/shadowLearningOnlySignalRepo.js';
import type { ShadowLearningOnlySignal } from '../trading/shadowLearningOnlyScan.js';
import { symbolCandidatesForShadowFutureReturnCache } from './shadowFutureReturnCacheProvider.js';

export const SHADOW_RETURN_WARMUP_DEFAULT_LIMIT = 20;
export const SHADOW_RETURN_WARMUP_MAX_LIMIT = 50;
export const SHADOW_RETURN_WARMUP_RANGES = ['5d', '1mo', '3mo', '1y'] as const;

export interface ShadowFutureReturnWarmupStats {
  candidateSignals: number;
  targetSymbols: number;
  attemptedSymbols: number;
  attemptedRequests: number;
  storedSnapshots: number;
  notFound: number;
  failed: number;
  skippedAlreadyResolved: number;
  sampleTargets: string[];
  sampleFailures: string[];
}

function hasAllFutureReturns(signal: ShadowLearningOnlySignal): boolean {
  return (
    typeof signal.futureReturn1d === 'number' &&
    typeof signal.futureReturn3d === 'number' &&
    typeof signal.futureReturn5d === 'number' &&
    typeof signal.futureReturn20d === 'number'
  );
}

export function clampShadowReturnWarmupLimit(limit: number): number {
  if (!Number.isFinite(limit)) return SHADOW_RETURN_WARMUP_DEFAULT_LIMIT;
  return Math.max(1, Math.min(SHADOW_RETURN_WARMUP_MAX_LIMIT, Math.trunc(limit)));
}

export function collectUnresolvedShadowReturnSymbols(signals: ShadowLearningOnlySignal[]): {
  symbols: string[];
  skippedAlreadyResolved: number;
} {
  const symbols = new Set<string>();
  let skippedAlreadyResolved = 0;

  for (const signal of signals) {
    if (hasAllFutureReturns(signal)) {
      skippedAlreadyResolved += 1;
      continue;
    }
    const symbol = signal.symbol.trim();
    if (symbol.length > 0) symbols.add(symbol);
  }

  return {
    symbols: Array.from(symbols),
    skippedAlreadyResolved,
  };
}

export async function runShadowFutureReturnWarmup(limit: number): Promise<ShadowFutureReturnWarmupStats> {
  const signals = loadShadowLearningOnlySignals();
  const { symbols, skippedAlreadyResolved } = collectUnresolvedShadowReturnSymbols(signals);
  const selectedSymbols = symbols.slice(0, clampShadowReturnWarmupLimit(limit));
  const stats: ShadowFutureReturnWarmupStats = {
    candidateSignals: signals.length,
    targetSymbols: symbols.length,
    attemptedSymbols: selectedSymbols.length,
    attemptedRequests: 0,
    storedSnapshots: 0,
    notFound: 0,
    failed: 0,
    skippedAlreadyResolved,
    sampleTargets: [],
    sampleFailures: [],
  };

  for (const symbol of selectedSymbols) {
    for (const yahooSymbol of symbolCandidatesForShadowFutureReturnCache(symbol)) {
      for (const range of SHADOW_RETURN_WARMUP_RANGES) {
        const target = `${yahooSymbol}:${range}:1d`;
        if (stats.sampleTargets.length < 10) stats.sampleTargets.push(target);
        stats.attemptedRequests += 1;

        try {
          const result = await fetchAndStoreYahooHistoricalSnapshot({
            symbol: yahooSymbol,
            range,
            interval: '1d',
            cacheKey: target,
          });

          if (result.status === 200) {
            stats.storedSnapshots += 1;
          } else if (result.status === 404) {
            stats.notFound += 1;
            if (stats.sampleFailures.length < 10) stats.sampleFailures.push(`${yahooSymbol}:404`);
          } else {
            stats.failed += 1;
            if (stats.sampleFailures.length < 10) stats.sampleFailures.push(`${yahooSymbol}:${result.status}`);
          }
        } catch {
          stats.failed += 1;
          if (stats.sampleFailures.length < 10) stats.sampleFailures.push(`${yahooSymbol}:ERROR`);
        }
      }
    }
  }

  return stats;
}
