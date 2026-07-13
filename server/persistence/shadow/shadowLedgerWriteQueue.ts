// @responsibility Memory retry queue for shadow persistence write failures.

import type { LearningImpact } from './shadowPersistenceGateway.js';

export type ShadowQueuedWriteStatus =
  | 'QUEUED'
  | 'RETRYING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'REPLAY_REQUIRED';

export interface ShadowLedgerWriteQueueItem {
  queueId: string;
  source: string;
  operation: 'WRITE_JSON' | 'DELETE';
  filePath: string;
  payload?: unknown;
  reason: string;
  status: ShadowQueuedWriteStatus;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  updatedAt: string;
  learningImpact: LearningImpact;
}

const queue: ShadowLedgerWriteQueueItem[] = [];

function nextQueueId(source: string): string {
  const compact = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  return `shadow-write-${compact}-${source.replace(/[^A-Za-z0-9_-]/g, '_')}-${queue.length + 1}`;
}

export function enqueueShadowLedgerWrite(input: {
  source: string;
  operation: ShadowLedgerWriteQueueItem['operation'];
  filePath: string;
  payload?: unknown;
  reason: string;
  maxAttempts?: number;
  learningImpact?: LearningImpact;
}): ShadowLedgerWriteQueueItem {
  const now = new Date().toISOString();
  const item: ShadowLedgerWriteQueueItem = {
    queueId: nextQueueId(input.source),
    source: input.source,
    operation: input.operation,
    filePath: input.filePath,
    ...(input.payload !== undefined ? { payload: input.payload } : {}),
    reason: input.reason,
    status: 'QUEUED',
    attempts: 0,
    maxAttempts: input.maxAttempts ?? 3,
    createdAt: now,
    updatedAt: now,
    learningImpact: input.learningImpact ?? 'DELAYED',
  };
  queue.push(item);
  return item;
}

export function listShadowLedgerWriteQueue(status?: ShadowQueuedWriteStatus): ShadowLedgerWriteQueueItem[] {
  return queue.filter((item) => !status || item.status === status).map((item) => ({ ...item }));
}

export function getShadowLedgerWriteQueueSize(): number {
  return queue.filter((item) => item.status === 'QUEUED' || item.status === 'RETRYING').length;
}

export function markShadowLedgerWriteRetrying(queueId: string): ShadowLedgerWriteQueueItem | null {
  const item = queue.find((candidate) => candidate.queueId === queueId);
  if (!item) return null;
  item.status = 'RETRYING';
  item.attempts += 1;
  item.updatedAt = new Date().toISOString();
  return { ...item };
}

export function markShadowLedgerWriteSucceeded(queueId: string): void {
  const item = queue.find((candidate) => candidate.queueId === queueId);
  if (!item) return;
  item.status = 'SUCCEEDED';
  item.learningImpact = 'NONE';
  item.updatedAt = new Date().toISOString();
}

export function markShadowLedgerWriteFailed(queueId: string, reason: string): void {
  const item = queue.find((candidate) => candidate.queueId === queueId);
  if (!item) return;
  item.status = item.attempts >= item.maxAttempts ? 'REPLAY_REQUIRED' : 'FAILED';
  item.reason = reason;
  item.learningImpact = item.status === 'REPLAY_REQUIRED' ? 'REPLAY_REQUIRED' : 'DELAYED';
  item.updatedAt = new Date().toISOString();
}

export function __resetShadowLedgerWriteQueueForTests(): void {
  queue.splice(0, queue.length);
}
