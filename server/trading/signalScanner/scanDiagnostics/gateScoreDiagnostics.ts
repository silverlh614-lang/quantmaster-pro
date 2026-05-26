// @responsibility Gate score diagnostic aggregation.

import {
  classifyGateScoreCandidateBucket,
  type GateScoreCandidateBucket,
} from '../gateScoreCandidateBucket.js';
import type { ScanCounters } from './scanCounterTypes.js';

export interface GateScoreHealthSummary {
  samples: number;
  rawScoreAvg: number;
  availableMaxScoreAvg: number;
  normalizedGateScoreAvg: number;
  unavailableTop: Array<{ condition: string; count: number }>;
  thresholdNotMetTop: Array<{ condition: string; count: number }>;
  providerDegradedTop: Array<{ condition: string; count: number }>;
  diagnosis:
    | 'DATA_UNAVAILABLE_DOMINANT'
    | 'THRESHOLD_NOT_MET_DOMINANT'
    | 'PROVIDER_DEGRADED_DOMINANT'
    | 'MIXED'
    | 'NO_SAMPLES';
}

export interface GateScoreCandidateBucketSummary {
  counts: Record<GateScoreCandidateBucket, number>;
  dataBlockedNearMissTopUnavailable: Array<{ condition: string; count: number }>;
  probingTopConditions: Array<{ condition: string; count: number }>;
  totalNearMissLike: number;
  outcomeLedgerRecorded?: number;
  outcomeLedgerSkipped?: number;
}

/** Gate1 multi-threshold survivor sweep (diagnostic-only, executionImpact=NONE). */
export interface Gate1ThresholdSweepSummary {
  totalScored: number;
  adaptiveThreshold: number;
  survivorsAt70: number;
  survivorsAt65: number;
  survivorsAt60: number;
  survivorsAtAdaptive: number;
  maxScore: number;
  avgScore: number;
}

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

  // Gate1 threshold sweep capture (diagnostic-only) — comparable raw score (fallback gateScore)
  // mirrors the bucket classifier's `raw >= normalThreshold`. executionImpact=NONE.
  const sweepScore = isFiniteNumber(result.rawScore) ? result.rawScore : result.gateScore;
  counters.gate1SweepScores.push(sweepScore);
  counters.gate1SweepAdaptiveThreshold = normalThreshold;

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
    '📊 Gate Score Health (ADR-452)',
    `  • raw avg: ${raw}`,
    `  • availableMax avg: ${max}`,
    `  • normalized avg: ${pct}%`,
    `  • diagnosis: ${summary.diagnosis}`,
  ];

  if (summary.unavailableTop.length > 0) {
    lines.push(`  • unavailable top: ${summary.unavailableTop.map((x) => `${x.condition}×${x.count}`).join(', ')}`);
  }
  if (summary.thresholdNotMetTop.length > 0) {
    lines.push(`  • thresholdNotMet top: ${summary.thresholdNotMetTop.map((x) => `${x.condition}×${x.count}`).join(', ')}`);
  }
  if (summary.providerDegradedTop.length > 0) {
    lines.push(`  • providerDegraded top: ${summary.providerDegradedTop.map((x) => `${x.condition}×${x.count}`).join(', ')}`);
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
    '🟡 Gate Near-Miss Buckets (ADR-452d)',
    `  • DATA_BLOCKED_NEAR_MISS: ${nearMiss}`,
    `  • PROBING: ${probing}`,
    `  • SHADOW_ONLY: ${shadowOnly}`,
    '  • executionImpact: NONE',
    `  • outcomeLedger: recorded ${summary.outcomeLedgerRecorded ?? 0}, skipped ${summary.outcomeLedgerSkipped ?? 0} (ADR-454, 3/5/10d)`,
  ];

  if (summary.dataBlockedNearMissTopUnavailable.length > 0) {
    lines.push(
      `  • nearMiss unavailable: ${summary.dataBlockedNearMissTopUnavailable
        .map((x) => `${x.condition}×${x.count}`)
        .join(', ')}`,
    );
  }

  if (summary.probingTopConditions.length > 0) {
    lines.push(
      `  • probing blockers: ${summary.probingTopConditions
        .map((x) => `${x.condition}×${x.count}`)
        .join(', ')}`,
    );
  }

  return lines.join('\n');
}

/**
 * Gate1 threshold sweep — captured per-candidate gate1 raw scores 로부터 survivors@{70,65,60,adaptive}
 * 를 산출한다. R3 sanity OBSERVE_ONLY 강등 후 "threshold 가 과한지 vs 점수 산출 자체가 0인지" 를
 * 숫자로 판정하기 위한 진단 전용 (executionImpact=NONE). 샘플 0 이면 undefined → 미표시.
 */
export function buildGate1ThresholdSweepSummary(
  counters: ScanCounters,
): Gate1ThresholdSweepSummary | undefined {
  const scores = counters.gate1SweepScores;
  if (!scores || scores.length === 0) return undefined;
  const survivors = (threshold: number): number => scores.filter((s) => s >= threshold).length;
  const adaptive = counters.gate1SweepAdaptiveThreshold;
  const adaptiveUsable = isFiniteNumber(adaptive) && adaptive > 0;
  return {
    totalScored: scores.length,
    adaptiveThreshold: adaptiveUsable ? adaptive : 0,
    survivorsAt70: survivors(70),
    survivorsAt65: survivors(65),
    survivorsAt60: survivors(60),
    survivorsAtAdaptive: adaptiveUsable ? survivors(adaptive) : 0,
    maxScore: Math.max(...scores),
    avgScore: scores.reduce((a, b) => a + b, 0) / scores.length,
  };
}

export function formatGate1ThresholdSweepSection(
  summary?: Gate1ThresholdSweepSummary | null,
): string | null {
  if (!summary || summary.totalScored === 0) return null;
  const n = summary.totalScored;
  const adaptiveLabel = summary.adaptiveThreshold > 0 ? summary.adaptiveThreshold.toFixed(0) : 'n/a';
  const interpretation =
    summary.survivorsAt60 === 0
      ? 'threshold 무관 — 60 에서도 생존 0 (점수 산출/데이터 문제 의심)'
      : 'threshold 민감 — 하향 시 생존 증가 (threshold 과부족 후보)';
  return [
    '🎯 Gate1 Threshold Sweep (diagnostic, executionImpact=NONE)',
    `  • scored candidates: ${n}`,
    `  • max ${summary.maxScore.toFixed(1)} / avg ${summary.avgScore.toFixed(1)}`,
    `  • survivors@70: ${summary.survivorsAt70}/${n}`,
    `  • survivors@65: ${summary.survivorsAt65}/${n}`,
    `  • survivors@60: ${summary.survivorsAt60}/${n}`,
    `  • survivors@adaptive(${adaptiveLabel}): ${summary.survivorsAtAdaptive}/${n}`,
    `  • interpretation: ${interpretation}`,
  ].join('\n');
}
