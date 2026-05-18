// @responsibility Gate layer audit diagnostic aggregation.

import type { GateLayerSummary } from '../../../quantFilter.js';
import type { ScanCounters } from './scanCounterTypes.js';
import { incrementCount, topCounts } from './gateScoreDiagnostics.js';

export interface GateLayerAuditSummary {
  gate1PassCount: number;
  gate2PassCount: number;
  gate3PassCount: number;
  strongBuySuppressedByDataUnavailableCount: number;
  topGate1BlockReasons: Array<{ reason: string; count: number }>;
  topGate2BlockReasons: Array<{ reason: string; count: number }>;
  topGate3BlockReasons: Array<{ reason: string; count: number }>;
}

export interface GateLayerAuditAccumulator {
  gate1PassCount: number;
  gate2PassCount: number;
  gate3PassCount: number;
  strongBuySuppressedByDataUnavailableCount: number;
  gate1BlockReasons: Record<string, number>;
  gate2BlockReasons: Record<string, number>;
  gate3BlockReasons: Record<string, number>;
}

export function createGateLayerAuditAccumulator(): GateLayerAuditAccumulator {
  return {
    gate1PassCount: 0,
    gate2PassCount: 0,
    gate3PassCount: 0,
    strongBuySuppressedByDataUnavailableCount: 0,
    gate1BlockReasons: {},
    gate2BlockReasons: {},
    gate3BlockReasons: {},
  };
}

export function recordLayerBlockReasons(target: Record<string, number>, layer: GateLayerSummary['gate1']): void {
  for (const key of layer.unavailable) incrementCount(target, `DATA_UNAVAILABLE:${key}`);
  for (const key of layer.providerDegraded) incrementCount(target, `PROVIDER_DEGRADED:${key}`);
  for (const key of layer.thresholdNotMet) incrementCount(target, `THRESHOLD_NOT_MET:${key}`);
}

export function accumulateGateLayerSummary(
  counters: ScanCounters,
  summary: GateLayerSummary | null | undefined,
  signalType?: string,
): void {
  if (!summary) return;
  if (summary.gate1.passed) counters.gateLayerAudit.gate1PassCount += 1;
  if (summary.gate2.passed) counters.gateLayerAudit.gate2PassCount += 1;
  if (summary.gate3.passed) counters.gateLayerAudit.gate3PassCount += 1;
  recordLayerBlockReasons(counters.gateLayerAudit.gate1BlockReasons, summary.gate1);
  recordLayerBlockReasons(counters.gateLayerAudit.gate2BlockReasons, summary.gate2);
  recordLayerBlockReasons(counters.gateLayerAudit.gate3BlockReasons, summary.gate3);
  if (signalType === 'STRONG' && summary.finalPath === 'SHADOW_OBSERVABLE' && (
    summary.gate1.unavailable.length > 0 || summary.gate2.unavailable.length > 0 || summary.gate3.unavailable.length > 0
  )) {
    counters.gateLayerAudit.strongBuySuppressedByDataUnavailableCount += 1;
  }
}

export function buildGateLayerAuditSummary(counters: ScanCounters): GateLayerAuditSummary {
  return {
    gate1PassCount: counters.gateLayerAudit.gate1PassCount,
    gate2PassCount: counters.gateLayerAudit.gate2PassCount,
    gate3PassCount: counters.gateLayerAudit.gate3PassCount,
    strongBuySuppressedByDataUnavailableCount: counters.gateLayerAudit.strongBuySuppressedByDataUnavailableCount,
    topGate1BlockReasons: topCounts(counters.gateLayerAudit.gate1BlockReasons).map(({ condition, count }) => ({ reason: condition, count })),
    topGate2BlockReasons: topCounts(counters.gateLayerAudit.gate2BlockReasons).map(({ condition, count }) => ({ reason: condition, count })),
    topGate3BlockReasons: topCounts(counters.gateLayerAudit.gate3BlockReasons).map(({ condition, count }) => ({ reason: condition, count })),
  };
}
