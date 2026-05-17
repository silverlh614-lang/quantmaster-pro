// @responsibility pending wiring dashboard 집계 모델 계산
import type {
  PendingExecutionImpact,
  PendingPriority,
  PendingScope,
  PendingWiringItem,
  PendingWiringStatus,
} from '../types/pendingWiring';

export const PENDING_PRIORITIES: PendingPriority[] = ['P0', 'P1', 'P2', 'P3'];
export const PENDING_STATUSES: PendingWiringStatus[] = [
  'NOT_STARTED',
  'INFRASTRUCTURE_ONLY',
  'PARTIAL',
  'OBSERVE_ONLY',
  'SHADOW_ONLY',
  'ADVISORY_ONLY',
  'WEIGHTED_READY',
  'GATED_READY',
  'CORE_READY',
  'BLOCKED',
  'DONE',
];
export const PENDING_SCOPES: PendingScope[] = [
  'LIVE',
  'SHADOW',
  'UI',
  'DIAGNOSTIC',
  'TELEGRAM',
  'DATA_PROVIDER',
  'BACKTEST',
  'LEARNING',
  'MACRO',
  'SECTOR',
  'RISK',
];

const STATUS_LABELS: Record<PendingWiringStatus, string> = {
  NOT_STARTED: 'Not started',
  INFRASTRUCTURE_ONLY: 'Infrastructure only',
  PARTIAL: 'Partial',
  OBSERVE_ONLY: 'Observe only',
  SHADOW_ONLY: 'Shadow only',
  ADVISORY_ONLY: 'Advisory only',
  WEIGHTED_READY: 'Weighted ready',
  GATED_READY: 'Gated ready',
  CORE_READY: 'Core ready candidate',
  BLOCKED: 'Blocked',
  DONE: 'Done',
};

const STATUS_DESCRIPTIONS: Record<PendingWiringStatus, string> = {
  NOT_STARTED: 'Implementation or wiring has not started yet.',
  INFRASTRUCTURE_ONLY: 'Code, types, or scaffolding exist, but no real caller or execution path is connected.',
  PARTIAL: 'Only some paths are connected; do not treat it as the full feature.',
  OBSERVE_ONLY: 'Observation-only state. It should not affect live trading decisions.',
  SHADOW_ONLY: 'Shadow decisioning or virtual learning only. It should not affect live execution.',
  ADVISORY_ONLY: 'Supplementary information only. It does not directly control gates or execution.',
  WEIGHTED_READY: 'Ready for weight reflection, but not promoted to an upper gate or core path.',
  GATED_READY: 'Ready for gate reflection. Verification is still needed before core promotion.',
  CORE_READY: 'Candidate for core promotion. Actual promotion needs separate approval and verification.',
  BLOCKED: 'Wiring is blocked by an external dependency, missing data, or policy limit.',
  DONE: 'Wiring is complete according to the source registry. UI must not mark items as done by itself.',
};

const DUE_SOON_DAYS = 14;

export function countPendingByPriority(items: PendingWiringItem[]): Record<PendingPriority, number> {
  return countBy(PENDING_PRIORITIES, items, (item) => item.priority);
}

export function countPendingByStatus(items: PendingWiringItem[]): Record<PendingWiringStatus, number> {
  return countBy(PENDING_STATUSES, items, (item) => item.status);
}

export function countPendingByScope(items: PendingWiringItem[]): Record<PendingScope, number> {
  const counts = emptyCounts(PENDING_SCOPES);
  for (const item of items) {
    for (const scope of item.scope) counts[scope] += 1;
  }
  return counts;
}

export function getOverduePendingItems(items: PendingWiringItem[], now: Date = new Date()): PendingWiringItem[] {
  const today = startOfDay(now).getTime();
  return items.filter((item) => {
    const due = parseDate(item.dueAt);
    return Boolean(due && due.getTime() < today && item.status !== 'DONE');
  });
}

export function getDueSoonPendingItems(items: PendingWiringItem[], now: Date = new Date()): PendingWiringItem[] {
  const today = startOfDay(now).getTime();
  const soon = today + DUE_SOON_DAYS * 86_400_000;
  return items.filter((item) => {
    const due = parseDate(item.dueAt);
    if (!due || item.status === 'DONE') return false;
    const time = due.getTime();
    return time >= today && time <= soon;
  });
}

export function hasLivePartialRisk(items: PendingWiringItem[]): boolean {
  return items.some(
    (item) =>
      item.scope.includes('LIVE') &&
      (item.status === 'PARTIAL' || item.status === 'INFRASTRUCTURE_ONLY'),
  );
}

export function hasBlockingImpact(items: PendingWiringItem[]): boolean {
  return items.some((item) => item.executionImpact === 'BLOCKING');
}

export function derivePendingRiskBanner(items: PendingWiringItem[]): string | null {
  if (items.some((item) => item.priority === 'P0' && item.status !== 'DONE')) {
    return 'P0 pending wiring exists. Review before promoting related modules.';
  }
  if (hasBlockingImpact(items)) return 'Blocking pending wiring exists. Review operational dependency before release.';
  if (hasLivePartialRisk(items)) return 'LIVE scope item is only partially wired. Do not treat this module as production-ready.';
  if (getOverduePendingItems(items).length > 0) return 'Some pending items are overdue.';
  return null;
}

export function derivePendingSafeBanner(items: PendingWiringItem[]): string | null {
  if (items.length === 0) return null;
  const isolatedImpact = items.every(isIsolatedImpact);
  const hasLiveScope = items.some((item) => item.scope.includes('LIVE'));
  const hasP0 = items.some((item) => item.priority === 'P0' && item.status !== 'DONE');
  if (isolatedImpact && !hasLiveScope && !hasP0) return 'Pending items are currently isolated from live execution. No live execution impact detected.';
  return null;
}

export function getPendingStatusLabel(status: PendingWiringStatus): string {
  return STATUS_LABELS[status];
}

export function getPendingStatusDescription(status: PendingWiringStatus): string {
  return STATUS_DESCRIPTIONS[status];
}

export function getPendingRecommendedAction(item: PendingWiringItem): string {
  if (item.nextAction) return item.nextAction;
  if (item.executionImpact === 'BLOCKING') return 'Resolve blocker before operational promotion.';
  if (item.priority === 'P0') return 'Review immediately and schedule a wiring patch.';
  if (item.status === 'INFRASTRUCTURE_ONLY') return 'Add a caller or registry wiring plan before claiming readiness.';
  if (item.status === 'PARTIAL') return 'Document covered paths and remaining paths.';
  if (item.status === 'OBSERVE_ONLY' || item.status === 'SHADOW_ONLY') return 'Keep isolated until verification evidence is available.';
  return 'Track in the pending registry and refresh metadata.';
}

export function getPendingImpactVariant(impact: PendingExecutionImpact) {
  if (impact === 'BLOCKING') return 'danger' as const;
  if (impact === 'DEGRADED' || impact === 'NEW_BUY_BLOCKED_ONLY') return 'warning' as const;
  if (impact === 'SHADOW_ONLY') return 'info' as const;
  return 'default' as const;
}

function countBy<T extends string>(keys: T[], items: PendingWiringItem[], selector: (item: PendingWiringItem) => T): Record<T, number> {
  const counts = emptyCounts(keys);
  for (const item of items) counts[selector(item)] += 1;
  return counts;
}

function emptyCounts<T extends string>(keys: T[]): Record<T, number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<T, number>;
}

function parseDate(value?: string): Date | null {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function isIsolatedImpact(item: PendingWiringItem): boolean {
  return item.executionImpact === 'NONE' || item.executionImpact === 'SHADOW_ONLY';
}
