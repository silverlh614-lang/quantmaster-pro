// @responsibility PATCH-D read-only analytics for ShadowLearningOnlySignal blocked-day outcomes.
/**
 * Shadow blocked outcome analytics.
 *
 * Read-only module:
 * - groups persisted ShadowLearningOnlySignal rows by blockedReason
 * - computes pending/resolved counts and horizon returns
 * - identifies potentially over-blocked situations for later policy review
 *
 * It must not mutate live trading, preflight, Gate, Kelly, order, or persistence behavior.
 */

import { loadShadowLearningOnlySignals } from '../persistence/shadowLearningOnlySignalRepo.js';
import type { ShadowLearningOnlySignal } from '../trading/shadowLearningOnlyScan.js';

export interface ShadowOutcomeAttributionSummary {
  key: string;
  total: number;
  wouldBuyCount: number;
  pendingCount: number;
  resolvedAnyCount: number;
  resolved1dCount: number;
  resolved3dCount: number;
  resolved5dCount: number;
  resolved20dCount: number;
  avgReturn1d: number | null;
  avgReturn3d: number | null;
  avgReturn5d: number | null;
  avgReturn20d: number | null;
  winRate1d: number | null;
  winRate3d: number | null;
  winRate5d: number | null;
  winRate20d: number | null;
  overBlockedCount: number;
}

export interface ShadowBlockedOutcomeReasonSummary extends ShadowOutcomeAttributionSummary {
  blockedReason: string;
}

export interface ShadowPolicyWatchSummary {
  relaxCandidates: ShadowOutcomeAttributionSummary[];
  keepStrictCandidates: ShadowOutcomeAttributionSummary[];
  needMoreData: string[];
}

export interface ShadowBlockedOutcomeSummary {
  totalSignals: number;
  pendingSignals: number;
  resolvedSignals: number;
  byBlockedReason: ShadowBlockedOutcomeReasonSummary[];
  byMacroBlockReason: ShadowOutcomeAttributionSummary[];
  byDataQualityStatus: ShadowOutcomeAttributionSummary[];
  bySignalGrade: ShadowOutcomeAttributionSummary[];
  byBlockedReasonSignalGrade: ShadowOutcomeAttributionSummary[];
  byBlockedReasonMacroBlockReason: ShadowOutcomeAttributionSummary[];
  topOverBlockedReasons: ShadowBlockedOutcomeReasonSummary[];
  topFastOverBlocked: ShadowOutcomeAttributionSummary[];
  policyWatch: ShadowPolicyWatchSummary;
}

const OVER_BLOCKED_REASONS = new Set<ShadowLearningOnlySignal['blockedReason']>([
  'DATA_STARVED',
  'SUPPLY_DATA_UNSTABLE',
  'SECTOR_ENERGY_STALE',
  'VOLUME_CLOCK_BLOCK',
  'POSITION_FULL',
]);

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function winRate(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.filter((value) => value > 0).length / values.length;
}

function hasAnyResolvedReturn(signal: ShadowLearningOnlySignal): boolean {
  return (
    isNumber(signal.futureReturn1d)
    || isNumber(signal.futureReturn3d)
    || isNumber(signal.futureReturn5d)
    || isNumber(signal.futureReturn20d)
  );
}

function isOverBlockedCandidate(signal: ShadowLearningOnlySignal): boolean {
  const strong1d = isNumber(signal.futureReturn1d) && signal.futureReturn1d >= 0.015;
  const strong5d = isNumber(signal.futureReturn5d) && signal.futureReturn5d >= 0.03;
  return (
    signal.wouldHaveBought === true
    && (strong1d || strong5d)
    && OVER_BLOCKED_REASONS.has(signal.blockedReason)
  );
}

function summarizeAttribution(
  key: string,
  signals: ShadowLearningOnlySignal[],
): ShadowOutcomeAttributionSummary {
  const returns1d = signals.map((s) => s.futureReturn1d).filter(isNumber);
  const returns3d = signals.map((s) => s.futureReturn3d).filter(isNumber);
  const returns5d = signals.map((s) => s.futureReturn5d).filter(isNumber);
  const returns20d = signals.map((s) => s.futureReturn20d).filter(isNumber);

  return {
    key,
    total: signals.length,
    wouldBuyCount: signals.filter((s) => s.wouldHaveBought).length,
    pendingCount: signals.filter((s) => !hasAnyResolvedReturn(s)).length,
    resolvedAnyCount: signals.filter(hasAnyResolvedReturn).length,
    resolved1dCount: returns1d.length,
    resolved3dCount: returns3d.length,
    resolved5dCount: returns5d.length,
    resolved20dCount: returns20d.length,
    avgReturn1d: avg(returns1d),
    avgReturn3d: avg(returns3d),
    avgReturn5d: avg(returns5d),
    avgReturn20d: avg(returns20d),
    winRate1d: winRate(returns1d),
    winRate3d: winRate(returns3d),
    winRate5d: winRate(returns5d),
    winRate20d: winRate(returns20d),
    overBlockedCount: signals.filter(isOverBlockedCandidate).length,
  };
}

function summarizeReason(
  blockedReason: string,
  signals: ShadowLearningOnlySignal[],
): ShadowBlockedOutcomeReasonSummary {
  return {
    ...summarizeAttribution(blockedReason, signals),
    blockedReason,
  };
}

function groupByKey(
  signals: ShadowLearningOnlySignal[],
  keyFn: (signal: ShadowLearningOnlySignal) => string | undefined | null,
): ShadowOutcomeAttributionSummary[] {
  const grouped = new Map<string, ShadowLearningOnlySignal[]>();
  for (const signal of signals) {
    const key = keyFn(signal)?.trim() || 'UNKNOWN';
    const bucket = grouped.get(key) ?? [];
    bucket.push(signal);
    grouped.set(key, bucket);
  }
  return Array.from(grouped.entries())
    .map(([key, rows]) => summarizeAttribution(key, rows))
    .sort(sortAttributionRows);
}

function groupByCompositeKey(
  signals: ShadowLearningOnlySignal[],
  leftFn: (signal: ShadowLearningOnlySignal) => string | undefined | null,
  rightFn: (signal: ShadowLearningOnlySignal) => string | undefined | null,
): ShadowOutcomeAttributionSummary[] {
  return groupByKey(signals, (signal) => `${leftFn(signal)?.trim() || 'UNKNOWN'} / ${rightFn(signal)?.trim() || 'UNKNOWN'}`);
}

function sortAttributionRows(a: ShadowOutcomeAttributionSummary, b: ShadowOutcomeAttributionSummary): number {
  if (b.resolvedAnyCount !== a.resolvedAnyCount) return b.resolvedAnyCount - a.resolvedAnyCount;
  if ((b.avgReturn1d ?? -Infinity) !== (a.avgReturn1d ?? -Infinity)) {
    return (b.avgReturn1d ?? -Infinity) - (a.avgReturn1d ?? -Infinity);
  }
  if (b.total !== a.total) return b.total - a.total;
  return a.key.localeCompare(b.key);
}

function buildPolicyWatch(
  crossRows: ShadowOutcomeAttributionSummary[],
): ShadowPolicyWatchSummary {
  const relaxCandidates = crossRows
    .filter((row) => row.resolved1dCount >= 10)
    .filter((row) => (row.avgReturn1d ?? 0) >= 0.01)
    .filter((row) => (row.winRate1d ?? 0) >= 0.52)
    .sort((a, b) => (b.avgReturn1d ?? 0) - (a.avgReturn1d ?? 0))
    .slice(0, 5);

  const keepStrictCandidates = crossRows
    .filter((row) => row.resolved1dCount >= 10)
    .filter((row) => (row.avgReturn1d ?? 0) <= -0.01)
    .filter((row) => (row.winRate1d ?? 1) <= 0.45)
    .sort((a, b) => (a.avgReturn1d ?? 0) - (b.avgReturn1d ?? 0))
    .slice(0, 5);

  const needMoreData: string[] = [];
  if (crossRows.every((row) => row.resolved5dCount === 0)) {
    needMoreData.push('5d outcomes are not available yet; treat 1d recommendations as watchlist only.');
  }
  if (crossRows.every((row) => row.resolved20dCount === 0)) {
    needMoreData.push('20d outcomes are not available yet; no medium-term policy change recommended.');
  }

  return { relaxCandidates, keepStrictCandidates, needMoreData };
}

export function summarizeShadowBlockedOutcomes(
  signals: ShadowLearningOnlySignal[],
): ShadowBlockedOutcomeSummary {
  const grouped = new Map<string, ShadowLearningOnlySignal[]>();
  for (const signal of signals) {
    const bucket = grouped.get(signal.blockedReason) ?? [];
    bucket.push(signal);
    grouped.set(signal.blockedReason, bucket);
  }

  const byBlockedReason = Array.from(grouped.entries())
    .map(([blockedReason, rows]) => summarizeReason(blockedReason, rows))
    .sort((a, b) => {
      if (b.resolvedAnyCount !== a.resolvedAnyCount) return b.resolvedAnyCount - a.resolvedAnyCount;
      if (b.total !== a.total) return b.total - a.total;
      return a.blockedReason.localeCompare(b.blockedReason);
    });

  const topOverBlockedReasons = byBlockedReason
    .filter((summary) => summary.overBlockedCount > 0)
    .sort((a, b) => {
      if (b.overBlockedCount !== a.overBlockedCount) return b.overBlockedCount - a.overBlockedCount;
      if ((b.avgReturn1d ?? -Infinity) !== (a.avgReturn1d ?? -Infinity)) {
        return (b.avgReturn1d ?? -Infinity) - (a.avgReturn1d ?? -Infinity);
      }
      if (b.total !== a.total) return b.total - a.total;
      return a.blockedReason.localeCompare(b.blockedReason);
    })
    .slice(0, 5);

  const byMacroBlockReason = groupByKey(signals, (s) => s.macroBlockReason);
  const byDataQualityStatus = groupByKey(signals, (s) => s.dataQualityStatus);
  const bySignalGrade = groupByKey(signals, (s) => s.signalGrade);
  const byBlockedReasonSignalGrade = groupByCompositeKey(
    signals,
    (s) => s.blockedReason,
    (s) => s.signalGrade,
  );
  const byBlockedReasonMacroBlockReason = groupByCompositeKey(
    signals,
    (s) => s.blockedReason,
    (s) => s.macroBlockReason,
  );

  const topFastOverBlocked = [...byBlockedReasonSignalGrade]
    .filter((row) => row.resolved1dCount >= 3 && (row.avgReturn1d ?? 0) > 0)
    .sort((a, b) => {
      if ((b.avgReturn1d ?? -Infinity) !== (a.avgReturn1d ?? -Infinity)) {
        return (b.avgReturn1d ?? -Infinity) - (a.avgReturn1d ?? -Infinity);
      }
      return b.resolved1dCount - a.resolved1dCount;
    })
    .slice(0, 5);

  return {
    totalSignals: signals.length,
    pendingSignals: signals.filter((s) => !hasAnyResolvedReturn(s)).length,
    resolvedSignals: signals.filter(hasAnyResolvedReturn).length,
    byBlockedReason,
    byMacroBlockReason,
    byDataQualityStatus,
    bySignalGrade,
    byBlockedReasonSignalGrade,
    byBlockedReasonMacroBlockReason,
    topOverBlockedReasons,
    topFastOverBlocked,
    policyWatch: buildPolicyWatch(byBlockedReasonSignalGrade),
  };
}

export function loadAndSummarizeShadowBlockedOutcomes(): ShadowBlockedOutcomeSummary {
  return summarizeShadowBlockedOutcomes(loadShadowLearningOnlySignals());
}

export function formatPct(value: number | null): string {
  if (value === null) return 'n/a';
  const sign = value > 0 ? '+' : '';
  return `${sign}${(value * 100).toFixed(1)}%`;
}

export function formatOutcomeRow(row: ShadowOutcomeAttributionSummary): string {
  return `${row.key}: n=${row.total}, resolved=${row.resolvedAnyCount}, 1d=${formatPct(row.avgReturn1d)} / win=${formatPct(row.winRate1d)}, 5d=${formatPct(row.avgReturn5d)} / win=${formatPct(row.winRate5d)}, over=${row.overBlockedCount}`;
}

export function formatShadowBlockedOutcomeCompactLine(
  summary: ShadowBlockedOutcomeSummary,
): string | null {
  if (summary.totalSignals === 0) return null;
  const top = summary.topOverBlockedReasons[0];
  const topLabel = top
    ? `${top.blockedReason} ${top.overBlockedCount}건 / 1d ${formatPct(top.avgReturn1d)} / 5d ${formatPct(top.avgReturn5d)}`
    : 'none';
  return [
    '🧪 <b>Shadow Blocked Outcomes</b>',
    `• total=${summary.totalSignals} / resolved=${summary.resolvedSignals} / pending=${summary.pendingSignals}`,
    `• overBlockedTop: ${topLabel}`,
  ].join('\n');
}
