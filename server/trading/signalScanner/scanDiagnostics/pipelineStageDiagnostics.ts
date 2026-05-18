// @responsibility Pipeline stage dropoff aggregation.

import type { ScanCounters } from './scanCounterTypes.js';
import type {
  PipelineStageDropoffSummary,
  PipelineStageName,
  PipelineStageStatus,
} from './scanSummaryTypes.js';

export function emptyStageDropoff(stage: PipelineStageName): PipelineStageDropoffSummary {
  return { stage, pass: 0, fail: 0, blocked: 0, skipped: 0, shadowOnly: 0, dataUnavailable: 0, providerDegraded: 0 };
}

export function stageStatusField(status: PipelineStageStatus): keyof Omit<PipelineStageDropoffSummary, 'stage'> {
  switch (status) {
    case 'PASS': return 'pass';
    case 'FAIL': return 'fail';
    case 'BLOCKED': return 'blocked';
    case 'SKIPPED': return 'skipped';
    case 'SHADOW_ONLY': return 'shadowOnly';
    case 'DATA_UNAVAILABLE': return 'dataUnavailable';
    case 'PROVIDER_DEGRADED': return 'providerDegraded';
  }
}

export function recordPipelineStage(
  counters: ScanCounters,
  stage: PipelineStageName,
  status: PipelineStageStatus,
): void {
  const bucket = counters.perStageDropoff[stage] ?? (counters.perStageDropoff[stage] = {});
  bucket[status] = (bucket[status] ?? 0) + 1;
}

export function buildPerStageDropoffSummary(counters: ScanCounters): PipelineStageDropoffSummary[] {
  return Object.entries(counters.perStageDropoff).map(([stage, counts]) => {
    const row = emptyStageDropoff(stage as PipelineStageName);
    for (const [status, count] of Object.entries(counts)) {
      row[stageStatusField(status as PipelineStageStatus)] = count ?? 0;
    }
    return row;
  });
}
