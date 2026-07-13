// @responsibility Shadow futureReturn snapshot warmup planner.

import { fetchAndStoreYahooHistoricalSnapshot } from '../market/yahooHistoricalSnapshotWarmup.js';
import { loadShadowLearningOnlySignals } from '../persistence/shadowLearningOnlySignalRepo.js';
import type { ShadowLearningOnlySignal } from '../trading/shadowLearningOnlyScan.js';
import { symbolCandidatesForShadowFutureReturnCache } from './shadowFutureReturnCacheProvider.js';

export const SHADOW_RETURN_WARMUP_DEFAULT_LIMIT = 20;
const SHADOW_RETURN_WARMUP_MAX_LIMIT = 50;
const SHADOW_RETURN_WARMUP_RANGES = ['5d', '1mo', '3mo', '1y'] as const;

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

function collectUnresolvedShadowReturnSymbols(signals: ShadowLearningOnlySignal[]): {
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

function prioritizeShadowWarmupSymbols(
  symbols: string[],
  prioritySymbols: string[] = [],
): string[] {
  const available = new Set(symbols);
  const out: string[] = [];
  for (const symbol of prioritySymbols) {
    const s = symbol.trim();
    if (available.has(s) && !out.includes(s)) out.push(s);
  }
  for (const symbol of symbols) {
    if (!out.includes(symbol)) out.push(symbol);
  }
  return out;
}

function symbolCandidatesForShadowReturnWarmup(symbol: string): string[] {
  const s = symbol.trim();
  const candidates = symbolCandidatesForShadowFutureReturnCache(s);
  if (/^\d{6}$/.test(s)) {
    return candidates.filter((candidate) => candidate !== s);
  }
  return candidates;
}

function compactFailureDetail(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: unknown; details?: unknown; symbol?: unknown };
    const detail = typeof parsed.details === 'string'
      ? parsed.details
      : typeof parsed.error === 'string'
        ? parsed.error
        : '';
    return detail.replace(/\s+/g, ' ').slice(0, 120);
  } catch {
    return body.replace(/\s+/g, ' ').slice(0, 120);
  }
}

function pushSampleFailure(
  stats: ShadowFutureReturnWarmupStats,
  target: string,
  status: number | 'ERROR',
  detail?: string,
): void {
  if (stats.sampleFailures.length >= 10) return;
  const suffix = detail && detail.length > 0 ? `:${detail}` : '';
  stats.sampleFailures.push(`${target}:${status}${suffix}`);
}

export async function runShadowFutureReturnWarmup(
  limit: number,
  prioritySymbols: string[] = [],
): Promise<ShadowFutureReturnWarmupStats> {
  const signals = loadShadowLearningOnlySignals();
  const { symbols, skippedAlreadyResolved } = collectUnresolvedShadowReturnSymbols(signals);
  const orderedSymbols = prioritizeShadowWarmupSymbols(symbols, prioritySymbols);
  const selectedSymbols = orderedSymbols.slice(0, clampShadowReturnWarmupLimit(limit));
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
    for (const yahooSymbol of symbolCandidatesForShadowReturnWarmup(symbol)) {
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
            realtimeTag: 'HISTORICAL',
          });

          if (result.status === 200) {
            stats.storedSnapshots += 1;
          } else if (result.status === 404) {
            stats.notFound += 1;
            pushSampleFailure(stats, target, 404, compactFailureDetail(result.body));
          } else {
            stats.failed += 1;
            pushSampleFailure(stats, target, result.status, compactFailureDetail(result.body));
          }
        } catch (e) {
          /* SDS-ignore: warmup fetch failures are counted in stats.failed and sampled in stats.failures. */
          stats.failed += 1;
          const msg = e instanceof Error ? e.message : String(e);
          pushSampleFailure(stats, target, 'ERROR', msg.slice(0, 120));
        }
      }
    }
  }

  return stats;
}
