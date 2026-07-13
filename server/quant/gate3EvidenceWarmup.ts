// @responsibility Gate3 outcome warm-up watchdog for forward-return labeling; diagnostic only.

import type { Gate3OutcomeSeed, Gate3OutcomeTrackingSummary } from './gate3OutcomeSeed.js';

type Gate3EvidenceWarmupWarning =
  | 'WARN_OUTCOME_LABELER_STALLED'
  | 'WARN_DUPLICATE_SUPPRESSION_CHECK'
  | 'WARN_FORWARD_RETURN_UPDATE_MISSING'
  | 'WARN_EVIDENCE_AGGREGATOR_DISCONNECTED';

export interface Gate3EvidenceWarmupStatus {
  pending: number;
  partial: number;
  labeled: number;
  oldestPendingAgeTradingDays: number;
  d1Updated: number;
  d3Updated: number;
  d5Updated: number;
  d10Updated: number;
  stalePending: number;
  schedulerHealthy: boolean;
  evidenceReady: boolean;
  thresholdEvidenceSampleSize: number;
  duplicateSuppressed: number;
  warnings: Gate3EvidenceWarmupWarning[];
  marketSignal: false;
  providerIssue: false;
  shadowLearning: true;
  counterfactualRecorded: true;
}

export interface Gate3EvidenceWarmupOptions {
  now?: Date;
  thresholdEvidenceSampleSize?: number;
  duplicateSuppressed?: number;
  outcomeTracking?: Gate3OutcomeTrackingSummary;
  stalePendingTradingDays?: number;
}

function finiteReturn(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

function utcDate(value: string): Date | null {
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) ? date : null;
}

function isWeekday(date: Date): boolean {
  const day = date.getUTCDay();
  return day !== 0 && day !== 6;
}

export function tradingDaysBetween(startDate: string, now: Date): number {
  const start = utcDate(startDate);
  if (!start) return 0;
  const end = utcDate(now.toISOString().slice(0, 10));
  if (!end || end.getTime() <= start.getTime()) return 0;
  let cursor = new Date(start.getTime());
  let days = 0;
  while (cursor.getTime() < end.getTime()) {
    cursor = new Date(cursor.getTime() + 86_400_000);
    if (cursor.getTime() <= end.getTime() && isWeekday(cursor)) days += 1;
  }
  return days;
}

function pendingSeeds(seeds: readonly Gate3OutcomeSeed[]): Gate3OutcomeSeed[] {
  return seeds.filter((seed) => seed.outcomeStatus === 'PENDING' || seed.outcomeStatus === 'PARTIAL');
}

function updatedCount(seeds: readonly Gate3OutcomeSeed[], horizon: keyof Gate3OutcomeSeed['forwardReturns']): number {
  return seeds.filter((seed) => finiteReturn(seed.forwardReturns[horizon])).length;
}

function isSchedulerFailureWarning(warning: Gate3EvidenceWarmupWarning): boolean {
  return warning !== 'WARN_DUPLICATE_SUPPRESSION_CHECK';
}

export function buildGate3EvidenceWarmupStatus(
  seeds: readonly Gate3OutcomeSeed[],
  options: Gate3EvidenceWarmupOptions = {},
): Gate3EvidenceWarmupStatus {
  const now = options.now ?? new Date();
  const pendingLike = pendingSeeds(seeds);
  const ages = pendingLike.map((seed) => tradingDaysBetween(seed.tradeDate, now));
  const oldestPendingAgeTradingDays = ages.length > 0 ? Math.max(...ages) : 0;
  const staleThreshold = options.stalePendingTradingDays ?? 10;
  const pending = options.outcomeTracking?.pending ?? seeds.filter((seed) => seed.outcomeStatus === 'PENDING').length;
  const partial = options.outcomeTracking?.partial ?? seeds.filter((seed) => seed.outcomeStatus === 'PARTIAL').length;
  const labeled = options.outcomeTracking?.labeled ?? seeds.filter((seed) => seed.outcomeStatus === 'LABELED').length;
  const thresholdEvidenceSampleSize = options.thresholdEvidenceSampleSize ?? labeled;
  const duplicateSuppressed = options.duplicateSuppressed ?? options.outcomeTracking?.duplicateSuppressed ?? 0;
  const d1Updated = updatedCount(seeds, 'd1');
  const warnings: Gate3EvidenceWarmupWarning[] = [];

  if (oldestPendingAgeTradingDays >= 5 && labeled === 0) warnings.push('WARN_OUTCOME_LABELER_STALLED');
  if (pending >= 100 && duplicateSuppressed === 0) warnings.push('WARN_DUPLICATE_SUPPRESSION_CHECK');
  if (d1Updated === 0 && oldestPendingAgeTradingDays >= 1) warnings.push('WARN_FORWARD_RETURN_UPDATE_MISSING');
  if (labeled > 0 && thresholdEvidenceSampleSize === 0) warnings.push('WARN_EVIDENCE_AGGREGATOR_DISCONNECTED');

  return {
    pending,
    partial,
    labeled,
    oldestPendingAgeTradingDays,
    d1Updated,
    d3Updated: updatedCount(seeds, 'd3'),
    d5Updated: updatedCount(seeds, 'd5'),
    d10Updated: updatedCount(seeds, 'd10'),
    stalePending: ages.filter((age) => age >= staleThreshold).length,
    schedulerHealthy: warnings.every((warning) => !isSchedulerFailureWarning(warning)),
    evidenceReady: thresholdEvidenceSampleSize > 0,
    thresholdEvidenceSampleSize,
    duplicateSuppressed,
    warnings,
    marketSignal: false,
    providerIssue: false,
    shadowLearning: true,
    counterfactualRecorded: true,
  };
}

export function formatGate3EvidenceWarmupSection(status: Gate3EvidenceWarmupStatus | null | undefined): string | null {
  if (!status) return null;
  return [
    'Gate3 Evidence Warm-up',
    '----------------------',
    `pending: ${status.pending}`,
    `partial: ${status.partial}`,
    `labeled: ${status.labeled}`,
    `oldestPendingAgeTradingDays: ${status.oldestPendingAgeTradingDays}`,
    `d1Updated: ${status.d1Updated}`,
    `d3Updated: ${status.d3Updated}`,
    `d5Updated: ${status.d5Updated}`,
    `d10Updated: ${status.d10Updated}`,
    `stalePending: ${status.stalePending}`,
    `schedulerHealthy: ${status.schedulerHealthy}`,
    `evidenceReady: ${status.evidenceReady}`,
    `thresholdEvidenceSampleSize: ${status.thresholdEvidenceSampleSize}`,
    `duplicateSuppressed: ${status.duplicateSuppressed}`,
    `warnings: ${status.warnings.join(',') || 'none'}`,
    'marketSignal=false; providerIssue=false; shadowLearning=true; counterfactualRecorded=true',
  ].join('\n');
}
