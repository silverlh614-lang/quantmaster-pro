// @responsibility PATCH-D Shadow future-return snapshot warmup planner.
/**
 * Plans and executes Yahoo historical snapshot warmup for unresolved
 * ShadowLearningOnlySignal rows. This is snapshot-cache warmup only.
 * It does not touch live trading, preflight, Gate, Kelly, STRONG_BUY, or order paths.
 */

import { loadShadowLearningOnlySignals } from '../persistence/shadowLearningOnlySignalRepo.js';
import type { ShadowLearningOnlySignal } from '../trading/shadowLearningOnlyScan.js';
import { fetchAndStoreYahooHistoricalSnapshot } from '../market/yahooHistoricalSnapshotWarmup.js';
import { symbolCandidatesForShadowFutureReturnCache } from './shadowFutureReturnCacheProvider.js';

export interface ShadowReturnWarmupPlanOptions {
  limit?: number;
}

export interface ShadowReturnWarmupTarget {
  symbol: string;
  yahooSymbols: string[];
}

export interface ShadowReturnWarmupStats {
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

const WARMUP_RANGES = ['5d', '1mo', '3mo', '1y'] as const;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function clampLimit(limit: unknown): number {
  const n = typeof limit === 'number' ? limit : Number(limit);
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(n)));
}

function isFullyResolved(signal: ShadowLearningOnlySignal): boolean {
  return (
    typeof signal.futureReturn1d === 'number'
    && typeof signal.futureReturn3d === 'number'
    && typeof signal.futureReturn5d === 'number'
    && typeof signal.futureReturn20d === 'number'
  );
}

export function buildShadowReturnWarmupTargets(
  signals: ShadowLearningOnlySignal[],
  options: ShadowReturnWarmupPlanOptions = {},
): { targets: ShadowReturnWarmupTarget[]; skippedAlreadyResolved: number } {
  const limit = clampLimit(options.limit);
  const symbols = new Set<string>();
  let skippedAlreadyResolved = 0;

  for (const signal of signals) {
    if (isFullyResolved(signal)) {
      skippedAlreadyResolved += 1;
      continue;
    }
    if (signal.symbol && signal.symbol.trim().length > 0) {
      symbols.add(signal.symbol.trim());
    }
  }

  const targets = Array.from(symbols)
    .slice(0, limit)
    .map((symbol) => ({
      symbol,
      yahooSymbols: symbolCandidatesForShadowFutureReturnCache(symbol),
    }));

  return { targets, skippedAlreadyResolved };
}

export async function runShadowReturnWarmup(
  options: ShadowReturnWarmupPlanOptions = {},
): Promise<ShadowReturnWarmupStats> {
  const signals = loadShadowLearningOnlySignals();
  const { targets, skippedAlreadyResolved } = buildShadowReturnWarmupTargets(signals, options);
  const allUnresolvedSymbols = new Set(
    signals
      .filter((signal) => !isFullyResolved(signal))
      .map((signal) => signal.symbol)
      .filter((symbol): symbol is string => typeof symbol === 'string' && symbol.trim().length > 0),
  );

  const stats: ShadowReturnWarmupStats = {
    candidateSignals: signals.length,
    targetSymbols: allUnresolvedSymbols.size,
    attemptedSymbols: targets.length,
    attemptedRequests: 0,
    storedSnapshots: 0,
    notFound: 0,
    failed: 0,
    skippedAlreadyResolved,
    sampleTargets: [],
    sampleFailures: [],
  };

  for (const target of targets) {
    for (const yahooSymbol of target.yahooSymbols) {
      for (const range of WARMUP_RANGES) {
        const cacheKey = `${yahooSymbol}:${range}:1d`;
        if (stats.sampleTargets.length < 5) stats.sampleTargets.push(cacheKey);
        stats.attemptedRequests += 1;
        try {
          const result = await fetchAndStoreYahooHistoricalSnapshot({
            symbol: yahooSymbol,
            range,
            interval: '1d',
            cacheKey,
          });
          if (result.status === 200) stats.storedSnapshots += 1;
          else if (result.status === 404) {
            stats.notFound += 1;
            if (stats.sampleFailures.length < 5) stats.sampleFailures.push(`${cacheKey}:404`);
          } else {
            stats.failed += 1;
            if (stats.sampleFailures.length < 5) stats.sampleFailures.push(`${cacheKey}:${result.status}`);
          }
        } catch (e) {
          stats.failed += 1;
          if (stats.sampleFailures.length < 5) {
            const msg = e instanceof Error ? e.message : String(e);
            stats.sampleFailures.push(`${cacheKey}:ERROR:${msg.slice(0, 80)}`);
          }
        }
      }
    }
  }

  return stats;
}

export function parseShadowReturnWarmupLimit(raw: string | undefined): number {
  return clampLimit(raw);
}
