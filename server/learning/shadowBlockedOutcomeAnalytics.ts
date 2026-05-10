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

export interface ShadowBlockedOutcomeReasonSummary {
  blockedReason: string;
  total: number;
  wouldBuyCount: number;
  pendingCount: number;
  resolved1dCount: number;
  resolved3dCount: number;
  resolved5dCount: number;
  resolved20dCount: number;
  avgReturn1d: number | null;
  avgReturn3d: number | null;
  avgReturn5d: number | null;
  avgReturn20d: number | null;
  winRate5d: number | null;
  overBlockedCount: number;
}

export interface ShadowBlockedOutcomeSummary {
  totalSignals: number;
  pendingSignals: number;
  resolvedSignals: number;
  byBlockedReason: ShadowBlockedOutcomeReasonSummary[];
  topOverBlockedReasons: ShadowBlockedOutcomeReasonSummary[];
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

function hasAnyResolvedReturn(signal: ShadowLearningOnlySignal): boolean {
  return (
    isNumber(signal.futureReturn1d)
    || isNumber(signal.futureReturn3d)
    || isNumber(signal.futureReturn5d)
    || isNumber(signal.futureReturn20d)
  );
}

function isOverBlockedCandidate(signal: ShadowLearningOnlySignal): boolean {
  return (
    signal.wouldHaveBought === true
    && isNumber(signal.futureReturn5d)
    && signal.futureReturn5d >= 0.03
    && OVER_BLOCKED_REASONS.has(signal.blockedReason)
  );
}

function summarizeReason(
  blockedReason: string,
  signals: ShadowLearningOnlySignal[],
): ShadowBlockedOutcomeReasonSummary {
  const returns1d = signals.map((s) => s.futureReturn1d).filter(isNumber);
  const returns3d = signals.map((s) => s.futureReturn3d).filter(isNumber);
  const returns5d = signals.map((s) => s.futureReturn5d).filter(isNumber);
  const returns20d = signals.map((s) => s.futureReturn20d).filter(isNumber);
  const win5d = returns5d.filter((value) => value > 0).length;

  return {
    blockedReason,
    total: signals.length,
    wouldBuyCount: signals.filter((s) => s.wouldHaveBought).length,
    pendingCount: signals.filter((s) => !hasAnyResolvedReturn(s)).length,
    resolved1dCount: returns1d.length,
    resolved3dCount: returns3d.length,
    resolved5dCount: returns5d.length,
    resolved20dCount: returns20d.length,
    avgReturn1d: avg(returns1d),
    avgReturn3d: avg(returns3d),
    avgReturn5d: avg(returns5d),
    avgReturn20d: avg(returns20d),
    winRate5d: returns5d.length > 0 ? win5d / returns5d.length : null,
    overBlockedCount: signals.filter(isOverBlockedCandidate).length,
  };
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
      if (b.total !== a.total) return b.total - a.total;
      return a.blockedReason.localeCompare(b.blockedReason);
    });

  const topOverBlockedReasons = byBlockedReason
    .filter((summary) => summary.overBlockedCount > 0)
    .sort((a, b) => {
      if (b.overBlockedCount !== a.overBlockedCount) return b.overBlockedCount - a.overBlockedCount;
      if (b.total !== a.total) return b.total - a.total;
      return a.blockedReason.localeCompare(b.blockedReason);
    })
    .slice(0, 5);

  return {
    totalSignals: signals.length,
    pendingSignals: signals.filter((s) => !hasAnyResolvedReturn(s)).length,
    resolvedSignals: signals.filter(hasAnyResolvedReturn).length,
    byBlockedReason,
    topOverBlockedReasons,
  };
}

export function loadAndSummarizeShadowBlockedOutcomes(): ShadowBlockedOutcomeSummary {
  return summarizeShadowBlockedOutcomes(loadShadowLearningOnlySignals());
}

function formatPct(value: number | null): string {
  if (value === null) return 'n/a';
  const sign = value > 0 ? '+' : '';
  return `${sign}${(value * 100).toFixed(1)}%`;
}

export function formatShadowBlockedOutcomeCompactLine(
  summary: ShadowBlockedOutcomeSummary,
): string | null {
  if (summary.totalSignals === 0) return null;
  const top = summary.topOverBlockedReasons[0];
  const topLabel = top
    ? `${top.blockedReason} ${top.overBlockedCount}건 / 5d ${formatPct(top.avgReturn5d)} / win ${formatPct(top.winRate5d)}`
    : 'none';
  return [
    '🧪 <b>Shadow Blocked Outcomes</b>',
    `• total=${summary.totalSignals} / resolved=${summary.resolvedSignals} / pending=${summary.pendingSignals}`,
    `• overBlockedTop: ${topLabel}`,
  ].join('\n');
}
