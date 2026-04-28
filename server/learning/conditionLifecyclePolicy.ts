// @responsibility 27조건 lifecycle status SSOT — attributionRepo 위 read-only 분류 레이어.
/**
 * conditionLifecyclePolicy.ts — ADR-0084 Condition Lifecycle Status Policy
 *
 * `attributionRepo` 영속 레코드 (PR-19 ADR-0006) 위에 *읽기 전용 분류 레이어*.
 * 별도 영속 SSOT 신설 없음 — closedAt 시간 분포로 firstSeenAt/lastSeenAt 산출.
 *
 * 결정 트리 (우선순위 SSOT):
 *   1. ENV CONDITION_LIFECYCLE_DISABLED=true  → 'normal' (정책 우회)
 *   2. firstSeenAt 부재 (활성 record 0건)     → 'grace'
 *   3. firstSeenAt < 30일 (grace period)      → 'grace'
 *   4. activatedCount < 30 (표본 부족)        → 'grace'
 *   5. activationRate < 1%                    → 'deprecated'
 *   6. activationRate < 5%                    → 'silent'
 *   7. 그 외                                  → 'normal'
 *
 * 본 PR 은 *측정 전용*. 실제 silent/deprecated 가드 wiring 은 후속 PR.
 */

import type { ServerAttributionRecord } from '../persistence/attributionRepo.js';
import { CONDITION_NAMES } from './attributionAnalyzer.js';

export type ConditionLifecycleStatus = 'normal' | 'grace' | 'silent' | 'deprecated';

export const CONDITION_LIFECYCLE_CONSTANTS = {
  /** attributionAnalyzer 와 동일 — score ≥ 이 값이면 "활성" */
  HIGH_SCORE_THRESHOLD: 6,
  /** 본 임계 미만 표본은 grace (첫 30 거래까지는 deprecated 판정 보류) */
  MIN_SAMPLE_FOR_LIFECYCLE: 30,
  /** 첫 등장 후 grace 기간 (일) — firstSeenAt 부터 본 일 수 미만은 grace */
  GRACE_PERIOD_DAYS: 30,
  /** activationRate 1% 미만 → deprecated */
  DEPRECATED_THRESHOLD: 0.01,
  /** activationRate 5% 미만 → silent */
  SILENT_THRESHOLD: 0.05,
} as const;

export const KNOWN_CONDITION_IDS: ReadonlyArray<number> = Array.from(
  { length: 27 },
  (_, i) => i + 1,
);

const DAY_MS = 24 * 60 * 60 * 1000;

export function isConditionLifecycleDisabled(): boolean {
  return process.env.CONDITION_LIFECYCLE_DISABLED === 'true';
}

// ── 산출 헬퍼 ───────────────────────────────────────────────────────────────────

/** 해당 조건이 score ≥ HIGH_SCORE_THRESHOLD 인 record 수. */
export function activatedCount(
  conditionId: number,
  records: ServerAttributionRecord[],
  threshold: number = CONDITION_LIFECYCLE_CONSTANTS.HIGH_SCORE_THRESHOLD,
): number {
  return records.filter((r) => (r.conditionScores?.[conditionId] ?? 0) >= threshold).length;
}

/** 해당 조건의 활성률 (0~1). records 0건 시 0. */
export function activationRate(
  conditionId: number,
  records: ServerAttributionRecord[],
  threshold: number = CONDITION_LIFECYCLE_CONSTANTS.HIGH_SCORE_THRESHOLD,
): number {
  if (records.length === 0) return 0;
  return activatedCount(conditionId, records, threshold) / records.length;
}

/** firstSeenAt = 활성 record 중 가장 오래된 closedAt (ISO). 부재 시 null. */
export function firstSeenAt(
  conditionId: number,
  records: ServerAttributionRecord[],
  threshold: number = CONDITION_LIFECYCLE_CONSTANTS.HIGH_SCORE_THRESHOLD,
): string | null {
  let earliest: string | null = null;
  let earliestMs = Number.POSITIVE_INFINITY;
  for (const r of records) {
    if ((r.conditionScores?.[conditionId] ?? 0) < threshold) continue;
    const ms = Date.parse(r.closedAt);
    if (!Number.isFinite(ms)) continue;
    if (ms < earliestMs) {
      earliestMs = ms;
      earliest = r.closedAt;
    }
  }
  return earliest;
}

/** lastSeenAt = 활성 record 중 가장 최근 closedAt (ISO). 부재 시 null. */
export function lastSeenAt(
  conditionId: number,
  records: ServerAttributionRecord[],
  threshold: number = CONDITION_LIFECYCLE_CONSTANTS.HIGH_SCORE_THRESHOLD,
): string | null {
  let latest: string | null = null;
  let latestMs = Number.NEGATIVE_INFINITY;
  for (const r of records) {
    if ((r.conditionScores?.[conditionId] ?? 0) < threshold) continue;
    const ms = Date.parse(r.closedAt);
    if (!Number.isFinite(ms)) continue;
    if (ms > latestMs) {
      latestMs = ms;
      latest = r.closedAt;
    }
  }
  return latest;
}

export function ageDays(firstSeen: string | null, now: Date = new Date()): number {
  if (!firstSeen) return 0;
  const ms = Date.parse(firstSeen);
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, (now.getTime() - ms) / DAY_MS);
}

// ── 단일 조건 status ────────────────────────────────────────────────────────────

export interface ConditionLifecycleReport {
  conditionId: number;
  conditionName: string;
  status: ConditionLifecycleStatus;
  reason: string;
  activatedCount: number;
  totalRecords: number;
  activationRate: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  ageDays: number;
  /** records 의 closedAt 시간 분포 — 디버깅/UI 추적용 */
  recordsInWindow: number;
  windowDays?: number;
  /** entryRegime 별 활성률 분리 (표본 ≥3 인 regime 만 노출) */
  byRegime?: Record<string, { activatedCount: number; activationRate: number }>;
}

export interface ConditionLifecycleThresholdOverride {
  HIGH_SCORE_THRESHOLD?: number;
  MIN_SAMPLE_FOR_LIFECYCLE?: number;
  GRACE_PERIOD_DAYS?: number;
  DEPRECATED_THRESHOLD?: number;
  SILENT_THRESHOLD?: number;
}

export interface GetConditionStatusOptions {
  /** records 필터링 윈도우 (일) — undefined 면 전체 records */
  windowDays?: number;
  /** 비교 기준 시각 (default: 현재 시각) */
  now?: Date;
  /** 결정 트리 임계 override */
  thresholds?: ConditionLifecycleThresholdOverride;
}

function filterRecordsByWindow(
  records: ServerAttributionRecord[],
  windowDays: number | undefined,
  now: Date,
): ServerAttributionRecord[] {
  if (!windowDays || windowDays <= 0) return records;
  const cutoff = now.getTime() - windowDays * DAY_MS;
  return records.filter((r) => {
    const ms = Date.parse(r.closedAt);
    return Number.isFinite(ms) && ms >= cutoff;
  });
}

function buildRegimeBreakdown(
  conditionId: number,
  records: ServerAttributionRecord[],
  threshold: number,
  minSample: number = 3,
): Record<string, { activatedCount: number; activationRate: number }> | undefined {
  const grouped = new Map<string, ServerAttributionRecord[]>();
  for (const r of records) {
    const regime = (r.entryRegime ?? '').trim() || 'UNKNOWN';
    const arr = grouped.get(regime) ?? [];
    arr.push(r);
    grouped.set(regime, arr);
  }
  const out: Record<string, { activatedCount: number; activationRate: number }> = {};
  for (const [regime, group] of grouped.entries()) {
    if (group.length < minSample) continue;
    const cnt = activatedCount(conditionId, group, threshold);
    out[regime] = {
      activatedCount: cnt,
      activationRate: cnt / group.length,
    };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function getConditionLifecycleStatus(
  records: ServerAttributionRecord[],
  conditionId: number,
  opts: GetConditionStatusOptions = {},
): ConditionLifecycleReport {
  const now = opts.now ?? new Date();
  const thresholds = { ...CONDITION_LIFECYCLE_CONSTANTS, ...opts.thresholds };
  const filtered = filterRecordsByWindow(records, opts.windowDays, now);
  const total = filtered.length;
  const cnt = activatedCount(conditionId, filtered, thresholds.HIGH_SCORE_THRESHOLD);
  const rate = total > 0 ? cnt / total : 0;
  const first = firstSeenAt(conditionId, filtered, thresholds.HIGH_SCORE_THRESHOLD);
  const last = lastSeenAt(conditionId, filtered, thresholds.HIGH_SCORE_THRESHOLD);
  const age = ageDays(first, now);

  let status: ConditionLifecycleStatus;
  let reason: string;

  if (isConditionLifecycleDisabled()) {
    status = 'normal';
    reason = 'CONDITION_LIFECYCLE_DISABLED=true (정책 우회)';
  } else if (first === null) {
    status = 'grace';
    reason = '활성 record 부재 — grace';
  } else if (age < thresholds.GRACE_PERIOD_DAYS) {
    status = 'grace';
    reason = `첫 등장 후 ${age.toFixed(1)}일 (grace ${thresholds.GRACE_PERIOD_DAYS}일 이내)`;
  } else if (cnt < thresholds.MIN_SAMPLE_FOR_LIFECYCLE) {
    status = 'grace';
    reason = `표본 부족 (${cnt}/${thresholds.MIN_SAMPLE_FOR_LIFECYCLE} 활성)`;
  } else if (rate < thresholds.DEPRECATED_THRESHOLD) {
    status = 'deprecated';
    reason = `활성률 ${(rate * 100).toFixed(2)}% < ${(thresholds.DEPRECATED_THRESHOLD * 100).toFixed(2)}%`;
  } else if (rate < thresholds.SILENT_THRESHOLD) {
    status = 'silent';
    reason = `활성률 ${(rate * 100).toFixed(2)}% < ${(thresholds.SILENT_THRESHOLD * 100).toFixed(2)}%`;
  } else {
    status = 'normal';
    reason = `활성률 ${(rate * 100).toFixed(2)}%`;
  }

  return {
    conditionId,
    conditionName: CONDITION_NAMES[conditionId] ?? `조건 ${conditionId}`,
    status,
    reason,
    activatedCount: cnt,
    totalRecords: total,
    activationRate: rate,
    firstSeenAt: first,
    lastSeenAt: last,
    ageDays: age,
    recordsInWindow: total,
    windowDays: opts.windowDays,
    byRegime: buildRegimeBreakdown(conditionId, filtered, thresholds.HIGH_SCORE_THRESHOLD),
  };
}

// ── 27 조건 일괄 ────────────────────────────────────────────────────────────────

export function getAllConditionLifecycleStatuses(
  records: ServerAttributionRecord[],
  opts: GetConditionStatusOptions = {},
): ConditionLifecycleReport[] {
  return KNOWN_CONDITION_IDS.map((id) => getConditionLifecycleStatus(records, id, opts));
}

export interface ConditionLifecycleSummary {
  total: number;
  normal: number;
  grace: number;
  silent: number;
  deprecated: number;
}

export function summarizeConditionLifecycle(
  reports: ConditionLifecycleReport[],
): ConditionLifecycleSummary {
  const summary: ConditionLifecycleSummary = {
    total: reports.length,
    normal: 0,
    grace: 0,
    silent: 0,
    deprecated: 0,
  };
  for (const r of reports) {
    summary[r.status] += 1;
  }
  return summary;
}
