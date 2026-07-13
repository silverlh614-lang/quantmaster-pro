// @responsibility Compact operational warning counts for boot or periodic reporting.

import type { WarnPriority } from './operationalWarnTypes.js';

const counts: Record<WarnPriority, number> = {
  P0: 0,
  P1: 0,
  P2: 0,
  P3: 0,
  P4: 0,
  P5: 0,
};

export function recordOperationalWarnCount(priority: WarnPriority): void {
  counts[priority] += 1;
}

export function getOperationalWarnSummary(): Record<WarnPriority, number> {
  return { ...counts };
}

export function resetOperationalWarnSummary(): void {
  for (const key of Object.keys(counts) as WarnPriority[]) {
    counts[key] = 0;
  }
}
