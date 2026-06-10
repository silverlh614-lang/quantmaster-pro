// @responsibility Normalize quote hydration outcomes before gate evaluation.

import type { ScanCounters } from '../scanDiagnostics/scanCounterTypes.js';
import type { PipelineStageStatus } from '../scanDiagnostics/scanSummaryTypes.js';

export type QuoteHydrationState = 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'NOT_REQUESTED';

export interface QuoteHydrationReport {
  state: QuoteHydrationState;
  hydrated: number;
  failed: number;
  breakPoint?: 'PRICE_FETCH';
  diagnostics: Record<string, unknown>;
}

function stageStatusCount(counters: ScanCounters, statuses: readonly PipelineStageStatus[]): number {
  const bucket = counters.perStageDropoff.PRICE_FETCH;
  if (!bucket) return 0;
  return statuses.reduce((sum, status) => sum + (bucket[status] ?? 0), 0);
}

function finiteCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

export function evaluateQuoteHydration(
  counters: ScanCounters,
  totalCandidates: number,
): QuoteHydrationReport {
  const total = finiteCount(totalCandidates);
  const pass = stageStatusCount(counters, ['PASS']);
  const failedByStage = stageStatusCount(counters, ['FAIL', 'DATA_UNAVAILABLE', 'PROVIDER_DEGRADED']);
  const failed = Math.max(finiteCount(counters.quoteFails), failedByStage);
  const hydrated = Math.max(pass, total > 0 ? Math.max(0, total - failed) : 0);
  const requested = pass + failed;
  const state: QuoteHydrationState =
    requested === 0 && total === 0
      ? 'NOT_REQUESTED'
      : failed <= 0
        ? 'SUCCESS'
        : hydrated > 0
          ? 'PARTIAL'
          : 'FAILED';

  return {
    state,
    hydrated,
    failed,
    ...(failed > 0 ? { breakPoint: 'PRICE_FETCH' as const } : {}),
    diagnostics: {
      totalCandidates: total,
      priceFetchPass: pass,
      priceFetchFailedByStage: failedByStage,
      quoteFails: counters.quoteFails,
    },
  };
}
