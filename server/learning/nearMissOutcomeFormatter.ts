/**
 * @responsibility ADR-454b/455 Near-Miss Outcome 평가/분석 결과 포맷터 — Telegram/diagnostic read-only 노출.
 *
 * DATA_BLOCKED_NEAR_MISS / PROBING / SHADOW_ONLY outcome ledger 의 3/5/10영업일
 * 관측 결과와 unavailable/thresholdNotMet condition 별 과잉 차단 후보를 운영자에게
 * 보여주기만 한다. live decision, Kelly, Gate threshold, KIS 주문, entryEngine 에는 어떤 값도
 * 전달하지 않는다.
 */
import type {
  NearMissOutcomeHorizon,
  NearMissOutcomeSummary,
} from '../persistence/nearMissOutcomeLedger.js';
import type { NearMissOutcomeEvaluationResult } from './nearMissOutcomeEvaluator.js';
import {
  buildNearMissOutcomeAnalyticsReport,
  type NearMissOutcomeAnalyticsReport,
  type NearMissOutcomeConditionAnalytics,
  type NearMissOutcomeStrictnessVerdict,
} from './nearMissOutcomeAnalytics.js';

const HORIZONS: readonly NearMissOutcomeHorizon[] = [3, 5, 10];

function formatPct(value: number): string {
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${value.toFixed(2)}%`;
}

function formatHorizon(summary: NearMissOutcomeSummary, horizon: NearMissOutcomeHorizon): string {
  const observed = summary.observedCountByHorizon[horizon] ?? 0;
  const avg = summary.avgReturnPctByHorizon[horizon] ?? 0;
  return `${horizon}d ${formatPct(avg)} (n=${observed})`;
}

function formatWinRate(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatVerdict(verdict: NearMissOutcomeStrictnessVerdict): string {
  switch (verdict) {
    case 'OVER_STRICT_CANDIDATE':
      return 'over-strict?';
    case 'GOOD_DEFENSE':
      return 'good-defense';
    case 'MIXED_OR_NEUTRAL':
      return 'mixed';
    case 'INSUFFICIENT_DATA':
      return 'insufficient';
  }
}

function formatConditionRow(row: NearMissOutcomeConditionAnalytics): string {
  const stats = row.horizonStats[row.verdictHorizonDays];
  return `${row.condition} ${row.verdictHorizonDays}d ${formatPct(stats.avgReturnPct)}`
    + ` win ${formatWinRate(stats.winRate)} n=${stats.observed} ${formatVerdict(row.verdict)}`;
}

function topCondition(
  report: NearMissOutcomeAnalyticsReport,
  kind: 'unavailableConditions' | 'thresholdNotMetConditions',
): NearMissOutcomeConditionAnalytics | undefined {
  return report.conditionAnalytics[kind].find((row) => row.verdict !== 'INSUFFICIENT_DATA')
    ?? report.conditionAnalytics[kind][0];
}

/**
 * /scan_blockers 용 compact line. Ledger 가 비어 있으면 noise 를 만들지 않는다.
 */
export function formatNearMissOutcomeDiagnosticLine(
  summary: NearMissOutcomeSummary | null | undefined,
): string | null {
  if (!summary || summary.totalCount === 0) return null;

  return [
    '🧪 Near-Miss Outcome (ADR-454b):',
    `total ${summary.totalCount}`,
    `active ${summary.activeCount}`,
    `closed ${summary.closedCount}`,
    HORIZONS.map((horizon) => formatHorizon(summary, horizon)).join(' | '),
    'executionImpact NONE',
  ].join(' ');
}


/**
 * ADR-455 /scan_blockers 용 compact analytics line. Ledger 가 비어 있으면 noise 를 만들지 않는다.
 */
export function formatNearMissOutcomeAnalyticsDiagnosticLine(
  report: NearMissOutcomeAnalyticsReport | null | undefined = buildNearMissOutcomeAnalyticsReport(),
): string | null {
  if (!report || report.totalEntries === 0) return null;

  const unavailable = topCondition(report, 'unavailableConditions');
  const threshold = topCondition(report, 'thresholdNotMetConditions');
  const parts = [
    '🔎 Near-Miss Analytics (ADR-455):',
    `observed ${report.observedEntries}/${report.totalEntries}`,
  ];
  if (unavailable) parts.push(`unavailable: ${formatConditionRow(unavailable)}`);
  if (threshold) parts.push(`threshold: ${formatConditionRow(threshold)}`);
  parts.push('diagnosticOnly executionImpact NONE');
  return parts.join(' | ');
}

/**
 * ADR-455 multi-line analytics section. 자동 완화/승격 없이 condition 별 진단만 제공한다.
 */
export function formatNearMissOutcomeAnalyticsReport(
  report: NearMissOutcomeAnalyticsReport = buildNearMissOutcomeAnalyticsReport(),
): string {
  const lines = [
    '🔎 Near-Miss Outcome Analytics (ADR-455)',
    `• scope: DATA_BLOCKED_NEAR_MISS / PROBING / SHADOW_ONLY only; observed entries ${report.observedEntries}/${report.totalEntries}`,
    `• policy: minN ${report.policy.minObservedSamples}, overStrict avg≥${formatPct(report.policy.overStrictAvgReturnPct)} win≥${formatWinRate(report.policy.overStrictWinRate)}, goodDefense avg≤${formatPct(report.policy.goodDefenseAvgReturnPct)} win≤${formatWinRate(report.policy.goodDefenseWinRate)}`,
    '• bucket 3/5/10d:',
    ...report.bucketAnalytics.map((bucket) => {
      const horizons = HORIZONS.map((horizon) => {
        const stats = bucket.horizonStats[horizon];
        return `${horizon}d ${formatPct(stats.avgReturnPct)} win ${formatWinRate(stats.winRate)} n=${stats.observed}`;
      }).join(' | ');
      return `  - ${bucket.bucket} entries ${bucket.totalEntries}: ${horizons}`;
    }),
    '• unavailableConditions top:',
    ...(report.conditionAnalytics.unavailableConditions.length > 0
      ? report.conditionAnalytics.unavailableConditions.map((row) => `  - ${formatConditionRow(row)}`)
      : ['  - none']),
    '• thresholdNotMetConditions top:',
    ...(report.conditionAnalytics.thresholdNotMetConditions.length > 0
      ? report.conditionAnalytics.thresholdNotMetConditions.map((row) => `  - ${formatConditionRow(row)}`)
      : ['  - none']),
    '• safety: diagnostic only; no Gate/Kelly/KIS/entryEngine/thresholdSearchLoop/live-decision changes; normalizedGateScore not used for live decisions',
  ];

  return lines.join('\n');
}

/**
 * 장마감 cron Telegram/report 용 multi-line formatter.
 */
export function formatNearMissOutcomeEvaluationReport(result: NearMissOutcomeEvaluationResult): string {
  const lines = [
    '🧪 Near-Miss Outcome Evaluation (ADR-454b)',
    '• scope: DATA_BLOCKED_NEAR_MISS / PROBING / SHADOW_ONLY only',
    '• executionImpact: NONE — diagnostic/learning only',
    `• refreshed: observed ${result.updated}, skipped ${result.skipped}, newlyClosed ${result.closed}`,
    `• ledger: total ${result.summary.totalCount}, active ${result.summary.activeCount}, closed ${result.summary.closedCount}`,
    `• avg return: ${HORIZONS.map((horizon) => formatHorizon(result.summary, horizon)).join(' | ')}`,
    formatNearMissOutcomeAnalyticsReport(),
    '• safety: no live promotion, no normalizedGateScore decision use, no Kelly/Gate/KIS/entryEngine changes',
  ];

  return lines.join('\n');
}
