/**
 * @responsibility ADR-455 Near-Miss Outcome Analytics — over-strict condition detection.
 *
 * NearMissOutcomeRecord 의 OBSERVED 3/5/10영업일 수익률을 bucket / condition 별로
 * 집계하여 "과도한 차단 후보"와 "좋은 방어 후보"를 진단한다. 본 모듈은 read-only 분석
 * 전용이며 Gate band, Kelly, KIS 주문, entryEngine, thresholdSearchLoop, live decision 을
 * 변경하지 않는다. DATA_BLOCKED_NEAR_MISS / PROBING / SHADOW_ONLY 는 executionImpact=NONE 이다.
 */
import {
  NEAR_MISS_OUTCOME_HORIZONS,
  type NearMissOutcomeEntry,
  type NearMissOutcomeHorizon,
  type NearMissOutcomeTrackedBucket,
  getAllNearMissOutcomes,
} from '../persistence/nearMissOutcomeLedger.js';

export type NearMissOutcomeConditionKind = 'unavailableConditions' | 'thresholdNotMetConditions' | 'providerDegradedConditions';
export type NearMissOutcomeStrictnessVerdict =
  | 'OVER_STRICT_CANDIDATE'
  | 'GOOD_DEFENSE'
  | 'MIXED_OR_NEUTRAL'
  | 'INSUFFICIENT_DATA';

export const NEAR_MISS_OUTCOME_ANALYTICS_POLICY = Object.freeze({
  minObservedSamples: 3,
  overStrictAvgReturnPct: 2,
  overStrictWinRate: 0.55,
  goodDefenseAvgReturnPct: -2,
  goodDefenseWinRate: 0.45,
  maxRankedConditionsPerKind: 5,
  preferredHorizonDays: 10 as NearMissOutcomeHorizon,
});

export interface NearMissOutcomeReturnStats {
  observed: number;
  avgReturnPct: number;
  winRate: number;
  positiveCount: number;
}

export interface NearMissOutcomeBucketAnalytics {
  bucket: NearMissOutcomeTrackedBucket;
  totalEntries: number;
  horizonStats: Record<NearMissOutcomeHorizon, NearMissOutcomeReturnStats>;
}

export interface NearMissOutcomeConditionAnalytics {
  kind: NearMissOutcomeConditionKind;
  condition: string;
  totalEntries: number;
  horizonStats: Record<NearMissOutcomeHorizon, NearMissOutcomeReturnStats>;
  verdict: NearMissOutcomeStrictnessVerdict;
  verdictHorizonDays: NearMissOutcomeHorizon;
}

export interface NearMissOutcomeAnalyticsReport {
  totalEntries: number;
  observedEntries: number;
  bucketAnalytics: NearMissOutcomeBucketAnalytics[];
  conditionAnalytics: Record<NearMissOutcomeConditionKind, NearMissOutcomeConditionAnalytics[]>;
  policy: typeof NEAR_MISS_OUTCOME_ANALYTICS_POLICY;
  executionImpact: 'NONE';
  diagnosticOnly: true;
}

const EMPTY_STATS: NearMissOutcomeReturnStats = Object.freeze({
  observed: 0,
  avgReturnPct: 0,
  winRate: 0,
  positiveCount: 0,
});

function emptyStatsByHorizon(): Record<NearMissOutcomeHorizon, NearMissOutcomeReturnStats> {
  return Object.fromEntries(
    NEAR_MISS_OUTCOME_HORIZONS.map((horizon) => [horizon, { ...EMPTY_STATS }]),
  ) as Record<NearMissOutcomeHorizon, NearMissOutcomeReturnStats>;
}

function calculateStats(entries: readonly NearMissOutcomeEntry[]): Record<NearMissOutcomeHorizon, NearMissOutcomeReturnStats> {
  return Object.fromEntries(NEAR_MISS_OUTCOME_HORIZONS.map((horizon) => {
    const returns = entries
      .flatMap((entry) => entry.horizons)
      .filter((point) => point.horizonDays === horizon && point.status === 'OBSERVED' && Number.isFinite(point.returnPct))
      .map((point) => point.returnPct ?? 0);
    const observed = returns.length;
    const positiveCount = returns.filter((value) => value > 0).length;
    const avgReturnPct = observed > 0
      ? Number((returns.reduce((sum, value) => sum + value, 0) / observed).toFixed(2))
      : 0;
    const winRate = observed > 0 ? Number((positiveCount / observed).toFixed(2)) : 0;
    return [horizon, { observed, avgReturnPct, winRate, positiveCount }];
  })) as Record<NearMissOutcomeHorizon, NearMissOutcomeReturnStats>;
}

function uniqueConditions(entry: NearMissOutcomeEntry, kind: NearMissOutcomeConditionKind): string[] {
  const values = entry[kind] ?? [];
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function chooseVerdictHorizon(stats: Record<NearMissOutcomeHorizon, NearMissOutcomeReturnStats>): NearMissOutcomeHorizon {
  const preferred = NEAR_MISS_OUTCOME_ANALYTICS_POLICY.preferredHorizonDays;
  if (stats[preferred].observed >= NEAR_MISS_OUTCOME_ANALYTICS_POLICY.minObservedSamples) return preferred;

  const eligible = [...NEAR_MISS_OUTCOME_HORIZONS]
    .reverse()
    .find((horizon) => stats[horizon].observed >= NEAR_MISS_OUTCOME_ANALYTICS_POLICY.minObservedSamples);
  return eligible ?? preferred;
}

export function classifyNearMissConditionStrictness(
  stats: NearMissOutcomeReturnStats,
): NearMissOutcomeStrictnessVerdict {
  const policy = NEAR_MISS_OUTCOME_ANALYTICS_POLICY;
  if (stats.observed < policy.minObservedSamples) return 'INSUFFICIENT_DATA';
  if (stats.avgReturnPct >= policy.overStrictAvgReturnPct && stats.winRate >= policy.overStrictWinRate) {
    return 'OVER_STRICT_CANDIDATE';
  }
  if (stats.avgReturnPct <= policy.goodDefenseAvgReturnPct && stats.winRate <= policy.goodDefenseWinRate) {
    return 'GOOD_DEFENSE';
  }
  return 'MIXED_OR_NEUTRAL';
}

function rankConditionRows(rows: NearMissOutcomeConditionAnalytics[]): NearMissOutcomeConditionAnalytics[] {
  return [...rows].sort((a, b) => {
    const aStats = a.horizonStats[a.verdictHorizonDays];
    const bStats = b.horizonStats[b.verdictHorizonDays];
    const verdictRank: Record<NearMissOutcomeStrictnessVerdict, number> = {
      OVER_STRICT_CANDIDATE: 0,
      GOOD_DEFENSE: 1,
      MIXED_OR_NEUTRAL: 2,
      INSUFFICIENT_DATA: 3,
    };
    return verdictRank[a.verdict] - verdictRank[b.verdict]
      || bStats.avgReturnPct - aStats.avgReturnPct
      || bStats.observed - aStats.observed
      || a.condition.localeCompare(b.condition);
  });
}

export function buildNearMissOutcomeAnalyticsReport(
  entries: readonly NearMissOutcomeEntry[] = getAllNearMissOutcomes(),
): NearMissOutcomeAnalyticsReport {
  const observedEntries = entries.filter((entry) =>
    entry.horizons.some((point) => point.status === 'OBSERVED' && Number.isFinite(point.returnPct)),
  ).length;

  const buckets: NearMissOutcomeTrackedBucket[] = ['DATA_BLOCKED_NEAR_MISS', 'PROBING', 'SHADOW_ONLY'];
  const bucketAnalytics = buckets.map((bucket) => {
    const bucketEntries = entries.filter((entry) => entry.bucket === bucket);
    return {
      bucket,
      totalEntries: bucketEntries.length,
      horizonStats: bucketEntries.length > 0 ? calculateStats(bucketEntries) : emptyStatsByHorizon(),
    };
  });

  const conditionAnalytics = Object.fromEntries((['unavailableConditions', 'thresholdNotMetConditions', 'providerDegradedConditions'] as const).map((kind) => {
    const byCondition = new Map<string, NearMissOutcomeEntry[]>();
    for (const entry of entries) {
      for (const condition of uniqueConditions(entry, kind)) {
        byCondition.set(condition, [...(byCondition.get(condition) ?? []), entry]);
      }
    }

    const rows = [...byCondition.entries()].map(([condition, conditionEntries]) => {
      const horizonStats = calculateStats(conditionEntries);
      const verdictHorizonDays = chooseVerdictHorizon(horizonStats);
      const verdict = classifyNearMissConditionStrictness(horizonStats[verdictHorizonDays]);
      return {
        kind,
        condition,
        totalEntries: conditionEntries.length,
        horizonStats,
        verdict,
        verdictHorizonDays,
      };
    });

    return [kind, rankConditionRows(rows).slice(0, NEAR_MISS_OUTCOME_ANALYTICS_POLICY.maxRankedConditionsPerKind)];
  })) as Record<NearMissOutcomeConditionKind, NearMissOutcomeConditionAnalytics[]>;

  return {
    totalEntries: entries.length,
    observedEntries,
    bucketAnalytics,
    conditionAnalytics,
    policy: NEAR_MISS_OUTCOME_ANALYTICS_POLICY,
    executionImpact: 'NONE',
    diagnosticOnly: true,
  };
}
