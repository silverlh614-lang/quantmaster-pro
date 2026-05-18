// @responsibility Gate score diagnostic aggregation.

import type { GateLayerSummary } from '../../../quantFilter.js';
import {
  classifyGateScoreCandidateBucket,
  type GateScoreCandidateBucket,
} from '../gateScoreCandidateBucket.js';
import type {
  GateLayerAuditSummary,
  GateScoreCandidateBucketSummary,
  GateScoreHealthSummary,
  ScanCounters,
} from './scanCounterTypes.js';

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function incrementCount(record: Record<string, number>, condition: string): void {
  record[condition] = (record[condition] ?? 0) + 1;
}

export function topCounts(record: Record<string, number>, limit = 5): Array<{ condition: string; count: number }> {
  return Object.entries(record)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([condition, count]) => ({ condition, count }));
}

export function accumulateGateScoreHealth(
  counters: ScanCounters,
  result: {
    rawScore?: number;
    gateScore?: number;
    availableMaxScore?: number;
    normalizedGateScore?: number;
    unavailableConditions?: readonly string[];
    thresholdNotMetConditions?: readonly string[];
    providerDegradedConditions?: readonly string[];
  } | null | undefined,
): void {
  if (!result) return;

  const raw = isFiniteNumber(result.rawScore)
    ? result.rawScore
    : isFiniteNumber(result.gateScore)
      ? result.gateScore
      : NaN;
  const availableMax = result.availableMaxScore;
  const normalized = result.normalizedGateScore;

  if (!isFiniteNumber(raw) || !isFiniteNumber(availableMax) || !isFiniteNumber(normalized)) {
    return;
  }

  counters.gateScoreHealthSamples += 1;
  counters.gateScoreRawSum += raw;
  counters.gateScoreAvailableMaxSum += availableMax;
  counters.gateScoreNormalizedSum += normalized;

  for (const condition of result.unavailableConditions ?? []) {
    incrementCount(counters.gateScoreUnavailableCounts, condition);
  }
  for (const condition of result.thresholdNotMetConditions ?? []) {
    incrementCount(counters.gateScoreThresholdNotMetCounts, condition);
  }
  for (const condition of result.providerDegradedConditions ?? []) {
    incrementCount(counters.gateScoreProviderDegradedCounts, condition);
  }
}

function recordLayerBlockReasons(target: Record<string, number>, layer: GateLayerSummary['gate1']): void {
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

export function accumulateGateScoreCandidateBucket(
  counters: ScanCounters,
  result: {
    gateScore?: number;
    rawScore?: number;
    availableMaxScore?: number;
    normalizedGateScore?: number;
    unavailableConditions?: readonly string[];
    thresholdNotMetConditions?: readonly string[];
    providerDegradedConditions?: readonly string[];
  } | null | undefined,
  normalThreshold: number,
): ReturnType<typeof classifyGateScoreCandidateBucket> | null {
  if (!result || !isFiniteNumber(result.gateScore) || !isFiniteNumber(normalThreshold)) return null;

  const decision = classifyGateScoreCandidateBucket({
    gateScore: result.gateScore,
    rawScore: result.rawScore,
    availableMaxScore: result.availableMaxScore,
    normalizedGateScore: result.normalizedGateScore,
    unavailableConditions: result.unavailableConditions,
    thresholdNotMetConditions: result.thresholdNotMetConditions,
    providerDegradedConditions: result.providerDegradedConditions,
    normalThreshold,
  });

  counters.gateScoreBucketCounts[decision.bucket] += 1;
  incrementCount(counters.gateScoreBucketReasonCounts, decision.bucket);

  if (decision.bucket === 'DATA_BLOCKED_NEAR_MISS') {
    for (const condition of result.unavailableConditions ?? []) {
      incrementCount(counters.dataBlockedNearMissUnavailableCounts, condition);
    }
  }

  if (decision.bucket === 'PROBING') {
    for (const condition of [
      ...(result.unavailableConditions ?? []),
      ...(result.thresholdNotMetConditions ?? []),
      ...(result.providerDegradedConditions ?? []),
    ]) {
      incrementCount(counters.probingConditionCounts, condition);
    }
  }

  return decision;
}

export function accumulateNearMissOutcomeLedgerWrite(
  counters: ScanCounters,
  outcome: { recorded: boolean } | null | undefined,
): void {
  if (outcome?.recorded) counters.nearMissOutcomeLedgerRecorded += 1;
  else counters.nearMissOutcomeLedgerSkipped += 1;
}

export function buildGateScoreHealthSummary(counters: ScanCounters): GateScoreHealthSummary {
  const samples = counters.gateScoreHealthSamples;
  if (samples <= 0) {
    return {
      samples: 0,
      rawScoreAvg: 0,
      availableMaxScoreAvg: 0,
      normalizedGateScoreAvg: 0,
      unavailableTop: [],
      thresholdNotMetTop: [],
      providerDegradedTop: [],
      diagnosis: 'NO_SAMPLES',
    };
  }

  const unavailableTotal = Object.values(counters.gateScoreUnavailableCounts).reduce((a, b) => a + b, 0);
  const thresholdTotal = Object.values(counters.gateScoreThresholdNotMetCounts).reduce((a, b) => a + b, 0);
  const degradedTotal = Object.values(counters.gateScoreProviderDegradedCounts).reduce((a, b) => a + b, 0);

  let diagnosis: GateScoreHealthSummary['diagnosis'] = 'MIXED';
  if (unavailableTotal > thresholdTotal && unavailableTotal > degradedTotal) {
    diagnosis = 'DATA_UNAVAILABLE_DOMINANT';
  } else if (thresholdTotal > unavailableTotal && thresholdTotal > degradedTotal) {
    diagnosis = 'THRESHOLD_NOT_MET_DOMINANT';
  } else if (degradedTotal > unavailableTotal && degradedTotal > thresholdTotal) {
    diagnosis = 'PROVIDER_DEGRADED_DOMINANT';
  }

  return {
    samples,
    rawScoreAvg: counters.gateScoreRawSum / samples,
    availableMaxScoreAvg: counters.gateScoreAvailableMaxSum / samples,
    normalizedGateScoreAvg: counters.gateScoreNormalizedSum / samples,
    unavailableTop: topCounts(counters.gateScoreUnavailableCounts),
    thresholdNotMetTop: topCounts(counters.gateScoreThresholdNotMetCounts),
    providerDegradedTop: topCounts(counters.gateScoreProviderDegradedCounts),
    diagnosis,
  };
}

export function formatGateScoreHealthSection(summary?: GateScoreHealthSummary | null): string | null {
  if (!summary || summary.diagnosis === 'NO_SAMPLES') return null;

  const pct = (summary.normalizedGateScoreAvg * 100).toFixed(1);
  const raw = summary.rawScoreAvg.toFixed(2);
  const max = summary.availableMaxScoreAvg.toFixed(2);
  const lines = [
    '?뱤 Gate Score Health (ADR-452)',
    `  ??raw avg: ${raw}`,
    `  ??availableMax avg: ${max}`,
    `  ??normalized avg: ${pct}%`,
    `  ??diagnosis: ${summary.diagnosis}`,
  ];

  if (summary.unavailableTop.length > 0) {
    lines.push(`  ??unavailable top: ${summary.unavailableTop.map((x) => `${x.condition}횞${x.count}`).join(', ')}`);
  }
  if (summary.thresholdNotMetTop.length > 0) {
    lines.push(`  ??thresholdNotMet top: ${summary.thresholdNotMetTop.map((x) => `${x.condition}횞${x.count}`).join(', ')}`);
  }
  if (summary.providerDegradedTop.length > 0) {
    lines.push(`  ??providerDegraded top: ${summary.providerDegradedTop.map((x) => `${x.condition}횞${x.count}`).join(', ')}`);
  }

  return lines.join('\n');
}

export function buildGateScoreCandidateBucketSummary(counters: ScanCounters): GateScoreCandidateBucketSummary {
  const counts = { ...counters.gateScoreBucketCounts } as Record<GateScoreCandidateBucket, number>;
  return {
    counts,
    dataBlockedNearMissTopUnavailable: topCounts(counters.dataBlockedNearMissUnavailableCounts),
    probingTopConditions: topCounts(counters.probingConditionCounts),
    totalNearMissLike: (counts.DATA_BLOCKED_NEAR_MISS ?? 0) + (counts.PROBING ?? 0) + (counts.SHADOW_ONLY ?? 0),
    outcomeLedgerRecorded: counters.nearMissOutcomeLedgerRecorded,
    outcomeLedgerSkipped: counters.nearMissOutcomeLedgerSkipped,
  };
}

export function formatGateScoreCandidateBucketSection(
  summary?: GateScoreCandidateBucketSummary | null,
): string | null {
  if (!summary) return null;

  const nearMiss = summary.counts.DATA_BLOCKED_NEAR_MISS ?? 0;
  const probing = summary.counts.PROBING ?? 0;
  const shadowOnly = summary.counts.SHADOW_ONLY ?? 0;

  if (nearMiss + probing + shadowOnly === 0) return null;

  const lines = [
    '?윞 Gate Near-Miss Buckets (ADR-452d)',
    `  ??DATA_BLOCKED_NEAR_MISS: ${nearMiss}`,
    `  ??PROBING: ${probing}`,
    `  ??SHADOW_ONLY: ${shadowOnly}`,
    '  ??executionImpact: NONE',
    `  ??outcomeLedger: recorded ${summary.outcomeLedgerRecorded ?? 0}, skipped ${summary.outcomeLedgerSkipped ?? 0} (ADR-454, 3/5/10d)`,
  ];

  if (summary.dataBlockedNearMissTopUnavailable.length > 0) {
    lines.push(
      `  ??nearMiss unavailable: ${summary.dataBlockedNearMissTopUnavailable
        .map((x) => `${x.condition}횞${x.count}`)
        .join(', ')}`,
    );
  }

  if (summary.probingTopConditions.length > 0) {
    lines.push(
      `  ??probing blockers: ${summary.probingTopConditions
        .map((x) => `${x.condition}횞${x.count}`)
        .join(', ')}`,
    );
  }

  return lines.join('\n');
}
