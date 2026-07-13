// @responsibility TTL-based in-memory deduplication store for operational warnings.

export interface WarnDedupDecision {
  allowed: boolean;
  suppressedCount: number;
  expiresAt: number;
}

interface WarnDedupRecord {
  expiresAt: number;
  suppressedCount: number;
}

const records = new Map<string, WarnDedupRecord>();

function nowMs(): number {
  return Date.now();
}

export function shouldEmitWarn(dedupKey: string, ttlSec: number, now = nowMs()): WarnDedupDecision {
  const ttlMs = Math.max(0, ttlSec) * 1000;
  const current = records.get(dedupKey);
  if (current && current.expiresAt > now) {
    current.suppressedCount += 1;
    return {
      allowed: false,
      suppressedCount: current.suppressedCount,
      expiresAt: current.expiresAt,
    };
  }

  const expiresAt = now + ttlMs;
  records.set(dedupKey, {
    expiresAt,
    suppressedCount: 0,
  });
  return {
    allowed: true,
    suppressedCount: 0,
    expiresAt,
  };
}

export function clearWarnDedupStore(): void {
  records.clear();
}
