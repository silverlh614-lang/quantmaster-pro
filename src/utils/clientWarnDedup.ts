// @responsibility client-only P4 warning dedup 모듈

const DEFAULT_TTL_SEC = 1800;
const lastSeenByKey = new Map<string, number>();

export function shouldEmitClientWarn(dedupKey: string, ttlSec: number = DEFAULT_TTL_SEC, now: number = Date.now()): boolean {
  const normalizedTtlMs = Math.max(0, ttlSec) * 1000;
  const lastSeenAt = lastSeenByKey.get(dedupKey);
  if (lastSeenAt !== undefined && now - lastSeenAt < normalizedTtlMs) {
    return false;
  }
  lastSeenByKey.set(dedupKey, now);
  return true;
}

export function __resetClientWarnDedupForTests(): void {
  lastSeenByKey.clear();
}
