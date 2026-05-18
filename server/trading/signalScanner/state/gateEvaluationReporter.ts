// @responsibility Normalize gate evaluation counters into scan-evaluation counts.

import type { ScanCounters } from '../scanDiagnostics/scanCounterTypes.js';
import type { PipelineStageName, PipelineStageStatus } from '../scanDiagnostics/scanSummaryTypes.js';

export interface GateEvaluationReport {
  evaluatedCount: number;
  skippedCount: number;
  rejectedCount: number;
  survivorCount: number;
  dataInsufficientCount: number;
  providerDegradedCount: number;
  hardRiskBlockedCount: number;
  diagnostics: Record<string, unknown>;
}

function stageCount(
  counters: ScanCounters,
  stage: PipelineStageName,
  statuses: readonly PipelineStageStatus[],
): number {
  const bucket = counters.perStageDropoff[stage];
  if (!bucket) return 0;
  return statuses.reduce((sum, status) => sum + (bucket[status] ?? 0), 0);
}

function finiteCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

export function buildGateEvaluationReport(
  counters: ScanCounters,
  totalCandidates: number,
): GateEvaluationReport {
  const total = finiteCount(totalCandidates);
  const serverGateSamples = stageCount(counters, 'SERVER_GATE_EVALUATED', [
    'PASS',
    'FAIL',
    'BLOCKED',
    'SHADOW_ONLY',
    'DATA_UNAVAILABLE',
    'PROVIDER_DEGRADED',
  ]);
  const eligibilitySamples = stageCount(counters, 'GATE_ELIGIBILITY_CLASSIFIED', [
    'PASS',
    'FAIL',
    'BLOCKED',
    'SHADOW_ONLY',
    'DATA_UNAVAILABLE',
    'PROVIDER_DEGRADED',
  ]);
  const explicitEvaluated =
    finiteCount(counters.gate1Pass) +
    finiteCount(counters.gateMisses) +
    finiteCount(counters.trueGateFailCount) +
    finiteCount(counters.dataUnavailableBlockedCount) +
    finiteCount(counters.providerDegradedObservableCount) +
    finiteCount(counters.hardRiskBlockedCount);
  const evaluatedCount = Math.min(
    total > 0 ? total : Math.max(serverGateSamples, eligibilitySamples, explicitEvaluated),
    Math.max(serverGateSamples, eligibilitySamples, explicitEvaluated, finiteCount(counters.entries)),
  );
  const survivorCount = Math.max(
    finiteCount(counters.entries),
    finiteCount(counters.gate3Pass),
    finiteCount(counters.liveEligibleCount) + finiteCount(counters.shadowObservableCount),
  );
  const rejectedCount = Math.max(
    finiteCount(counters.gateMisses) +
      finiteCount(counters.rrrMisses) +
      finiteCount(counters.waitGateFail) +
      finiteCount(counters.trueGateFailCount) +
      finiteCount(counters.hardRiskBlockedCount),
    stageCount(counters, 'SERVER_GATE_EVALUATED', ['FAIL', 'BLOCKED']),
    stageCount(counters, 'GATE_ELIGIBILITY_CLASSIFIED', ['FAIL', 'BLOCKED']),
  );
  const skippedCount = Math.max(0, total - evaluatedCount);
  const dataInsufficientCount = finiteCount(counters.dataUnavailableBlockedCount) +
    stageCount(counters, 'SERVER_GATE_EVALUATED', ['DATA_UNAVAILABLE']) +
    stageCount(counters, 'GATE_ELIGIBILITY_CLASSIFIED', ['DATA_UNAVAILABLE']);
  const providerDegradedCount = finiteCount(counters.providerDegradedObservableCount) +
    stageCount(counters, 'SERVER_GATE_EVALUATED', ['PROVIDER_DEGRADED']) +
    stageCount(counters, 'GATE_ELIGIBILITY_CLASSIFIED', ['PROVIDER_DEGRADED']);

  return {
    evaluatedCount,
    skippedCount,
    rejectedCount,
    survivorCount,
    dataInsufficientCount,
    providerDegradedCount,
    hardRiskBlockedCount: finiteCount(counters.hardRiskBlockedCount),
    diagnostics: {
      gate1Pass: counters.gate1Pass,
      gate2Pass: counters.gate2Pass,
      gate3Pass: counters.gate3Pass,
      entries: counters.entries,
      gateMisses: counters.gateMisses,
      trueGateFailCount: counters.trueGateFailCount,
      dataUnavailableBlockedCount: counters.dataUnavailableBlockedCount,
      providerDegradedObservableCount: counters.providerDegradedObservableCount,
      liveEligibleCount: counters.liveEligibleCount,
      shadowObservableCount: counters.shadowObservableCount,
      serverGateSamples,
      eligibilitySamples,
    },
  };
}
