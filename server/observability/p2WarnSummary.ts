// @responsibility Compact five-minute summary for repeated P2 warning suppressions.

import type { OperationalWarnEmission } from './operationalWarnTypes.js';

const suppressedByKey = new Map<string, number>();

function summaryKey(payload: OperationalWarnEmission['payload']): string {
  const details = payload.details ?? {};
  const source = typeof details.source === 'string' ? details.source : undefined;
  const section = typeof details.section === 'string' ? details.section : undefined;
  return [payload.domain, source, section, payload.code].filter(Boolean).join(':');
}

export function recordP2WarnSummary(emission: OperationalWarnEmission): void {
  if (emission.payload.priority !== 'P2') return;
  const key = summaryKey(emission.payload);
  if (emission.suppressed) {
    suppressedByKey.set(key, emission.suppressedCount);
    return;
  }

  const suppressedCount = suppressedByKey.get(key) ?? 0;
  if (suppressedCount <= 0) return;
  suppressedByKey.delete(key);
  console.warn(
    `[P2WarnSummary] key=${key} suppressed=${suppressedCount} windowSec=${emission.payload.ttlSec} executionImpact=NONE`,
  );
}
