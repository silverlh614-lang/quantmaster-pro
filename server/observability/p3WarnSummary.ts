// @responsibility Ten-minute compact summaries for suppressed P3 maintenance warnings.

import type { P3WarnPayload } from './maintenanceWarn.js';

interface P3WarnSummaryRow {
  source: P3WarnPayload['source'];
  code: string;
  suppressedCount: number;
  lastMessage: string;
  lastDetails?: Record<string, unknown>;
}

const SUMMARY_WINDOW_MS = 600_000;
const rows = new Map<string, P3WarnSummaryRow>();
let nextSummaryAt = Date.now() + SUMMARY_WINDOW_MS;

function rowKey(payload: P3WarnPayload): string {
  return `${payload.source}:${payload.code}`;
}

function shouldPrintSummary(now = Date.now()): boolean {
  if (process.env.P3_WARN_SUMMARY_DISABLED === 'true') return false;
  if (process.env.OPERATIONAL_WARN_DEBUG === 'true') return true;
  return now >= nextSummaryAt;
}

export function recordP3WarnSummary(payload: P3WarnPayload, suppressedCount: number): void {
  if (suppressedCount <= 0) return;
  const key = rowKey(payload);
  const current = rows.get(key);
  rows.set(key, {
    source: payload.source,
    code: payload.code,
    suppressedCount: Math.max(current?.suppressedCount ?? 0, suppressedCount),
    lastMessage: payload.message,
    lastDetails: payload.details,
  });
  flushP3WarnSummaryIfDue();
}

function flushP3WarnSummaryIfDue(now = Date.now()): void {
  if (rows.size === 0 || !shouldPrintSummary(now)) return;
  const summary = Array.from(rows.values()).map(({ source, code, suppressedCount }) => ({
    source,
    code,
    suppressedCount,
  }));
  console.warn('[P3WarnSummary] windowSec=600 executionImpact=NONE runtimeVisible=summary-only', summary);
  rows.clear();
  nextSummaryAt = now + SUMMARY_WINDOW_MS;
}
