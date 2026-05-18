// @responsibility Track compact health for shadow persistence sources.

export type ShadowPersistenceHealthStatus =
  | 'VERIFIED'
  | 'DEGRADED'
  | 'STALE'
  | 'MISSING'
  | 'FAILED';

export interface ShadowPersistenceHealthRecord {
  source: string;
  status: ShadowPersistenceHealthStatus;
  updatedAt: string;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  failureCount: number;
  queuedWrites: number;
  fallbackActive: boolean;
  reason?: string;
  learningImpact?: string;
}

const health = new Map<string, ShadowPersistenceHealthRecord>();

function nowIso(): string {
  return new Date().toISOString();
}

function getOrCreate(source: string): ShadowPersistenceHealthRecord {
  const existing = health.get(source);
  if (existing) return existing;
  const created: ShadowPersistenceHealthRecord = {
    source,
    status: 'MISSING',
    updatedAt: nowIso(),
    failureCount: 0,
    queuedWrites: 0,
    fallbackActive: false,
  };
  health.set(source, created);
  return created;
}

export function markShadowPersistenceVerified(source: string): void {
  const record = getOrCreate(source);
  record.status = 'VERIFIED';
  record.updatedAt = nowIso();
  record.lastSuccessAt = record.updatedAt;
  record.fallbackActive = false;
  record.reason = undefined;
  record.learningImpact = 'NONE';
}

export function markShadowPersistenceMissing(source: string, reason = 'missing'): void {
  const record = getOrCreate(source);
  record.status = 'MISSING';
  record.updatedAt = nowIso();
  record.reason = reason;
  record.learningImpact = 'NONE';
}

export function markShadowPersistenceDegraded(input: {
  source: string;
  reason: string;
  fallbackActive?: boolean;
  queuedWrites?: number;
  learningImpact?: string;
}): void {
  const record = getOrCreate(input.source);
  record.status = 'DEGRADED';
  record.updatedAt = nowIso();
  record.lastFailureAt = record.updatedAt;
  record.failureCount += 1;
  record.fallbackActive = input.fallbackActive === true;
  record.queuedWrites = input.queuedWrites ?? record.queuedWrites;
  record.reason = input.reason;
  record.learningImpact = input.learningImpact ?? 'DEGRADED';
}

export function markShadowPersistenceFailed(input: {
  source: string;
  reason: string;
  queuedWrites?: number;
  learningImpact?: string;
}): void {
  const record = getOrCreate(input.source);
  record.status = 'FAILED';
  record.updatedAt = nowIso();
  record.lastFailureAt = record.updatedAt;
  record.failureCount += 1;
  record.queuedWrites = input.queuedWrites ?? record.queuedWrites;
  record.fallbackActive = true;
  record.reason = input.reason;
  record.learningImpact = input.learningImpact ?? 'REPLAY_REQUIRED';
}

export function getShadowPersistenceHealthSnapshot(): ShadowPersistenceHealthRecord[] {
  return Array.from(health.values()).sort((a, b) => a.source.localeCompare(b.source));
}

export function formatShadowPersistenceHealthCompact(): string {
  const rows = getShadowPersistenceHealthSnapshot();
  if (rows.length === 0) return 'ShadowPersistence: no sources observed';
  return rows.map((row) => [
    `source=${row.source}`,
    `status=${row.status}`,
    `queued=${row.queuedWrites}`,
    `fallback=${row.fallbackActive}`,
    row.learningImpact ? `learningImpact=${row.learningImpact}` : undefined,
    row.reason ? `reason=${row.reason}` : undefined,
  ].filter(Boolean).join(' ')).join('\n');
}

export function __resetShadowPersistenceHealthForTests(): void {
  health.clear();
}
