// @responsibility Single gateway for shadow persistence reads, writes, fallback, and queueing.

import * as fs from 'fs';
import * as path from 'path';
import { emitOperationalWarn } from '../../observability/operationalWarn.js';
import {
  enqueueShadowLedgerWrite,
  getShadowLedgerWriteQueueSize,
  type ShadowLedgerWriteQueueItem,
} from './shadowLedgerWriteQueue.js';
import {
  getShadowPersistenceFallback,
  putShadowPersistenceFallback,
} from './shadowPersistenceFallbackStore.js';
import {
  markShadowPersistenceDegraded,
  markShadowPersistenceFailed,
  markShadowPersistenceMissing,
  markShadowPersistenceVerified,
} from './shadowPersistenceHealth.js';
import { recordShadowPersistenceCase } from './shadowCaseRecorder.js';

export type LearningImpact =
  | 'NONE'
  | 'DELAYED'
  | 'DEGRADED'
  | 'LOST_RISK'
  | 'REPLAY_REQUIRED';

export type ShadowPersistenceResult<T> =
  | { kind: 'SUCCESS'; data: T; source: string }
  | { kind: 'EMPTY'; source: string; reason?: string }
  | { kind: 'DEGRADED_FALLBACK'; data: T; source: string; fallback: string; reason: string; learningImpact: LearningImpact }
  | { kind: 'QUEUED_FOR_RETRY'; queueId: string; reason: string; learningImpact: LearningImpact }
  | { kind: 'FAILED'; source: string; reason: string; retryable: boolean; learningImpact: LearningImpact };

export type ShadowPersistenceWarnCode =
  | 'P1_SHADOW_DB_READ_FAILED'
  | 'P1_SHADOW_DB_WRITE_FAILED'
  | 'P1_SHADOW_LEDGER_WRITE_QUEUED'
  | 'P1_SHADOW_PERSISTENCE_DEGRADED'
  | 'P1_SHADOW_PERSISTENCE_REPLAY_REQUIRED'
  | 'P1_COUNTERFACTUAL_LEARNING_WRITE_FAILED'
  | 'P1_DEFECT_EVOLUTION_PERSIST_FAILED'
  | 'P1_SHADOW_RESOLVER_JOB_FAILED';

export interface ReadShadowJsonInput<T> {
  source: string;
  filePath: string;
  emptyValue: T;
  validate?: (data: unknown) => data is T;
  readFailedCode?: ShadowPersistenceWarnCode;
}

export interface WriteShadowJsonInput<T> {
  source: string;
  filePath: string;
  data: T;
  writeFailedCode?: ShadowPersistenceWarnCode;
  queuedCode?: ShadowPersistenceWarnCode;
  maxAttempts?: number;
}

function reasonFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function safeClone<T>(data: T): T {
  try {
    return JSON.parse(JSON.stringify(data)) as T;
  } catch {
    return data;
  }
}

export function emitShadowPersistenceWarn(input: {
  code: ShadowPersistenceWarnCode;
  source: string;
  message: string;
  reason: string;
  learningImpact: LearningImpact;
  queueId?: string;
  details?: Record<string, unknown>;
  ttlSec?: number;
}): void {
  emitOperationalWarn({
    priority: 'P1',
    domain: 'DATA',
    code: input.code,
    message: input.message,
    executionImpact: 'NONE',
    dedupKey: `shadow-persistence:${input.code}:${input.source}:${input.queueId ?? input.reason}`,
    ttlSec: input.ttlSec ?? 60,
    details: {
      reason: input.reason,
      source: input.source,
      executionImpact: 'NONE',
      learningImpact: input.learningImpact,
      queueId: input.queueId,
      ...input.details,
    },
  });
}

function ensureParentDir(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function atomicWriteJson(filePath: string, data: unknown): void {
  ensureParentDir(filePath);
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, filePath);
}

export function readShadowJson<T>(input: ReadShadowJsonInput<T>): ShadowPersistenceResult<T> {
  if (!fs.existsSync(input.filePath)) {
    const fallback = getShadowPersistenceFallback<T>(input.source);
    if (fallback !== undefined) {
      markShadowPersistenceDegraded({
        source: input.source,
        reason: 'file-missing-with-memory-fallback',
        fallbackActive: true,
        queuedWrites: getShadowLedgerWriteQueueSize(),
        learningImpact: 'DELAYED',
      });
      recordShadowPersistenceCase({
        source: input.source,
        operation: 'READ_JSON',
        reason: 'file-missing-with-memory-fallback',
        learningImpact: 'DELAYED',
        details: { filePath: input.filePath, fallback: 'memory' },
      });
      return {
        kind: 'DEGRADED_FALLBACK',
        source: input.source,
        data: fallback,
        fallback: 'memory',
        reason: 'file-missing-with-memory-fallback',
        learningImpact: 'DELAYED',
      };
    }
    markShadowPersistenceMissing(input.source, 'file-missing');
    return { kind: 'EMPTY', source: input.source, reason: 'file-missing' };
  }

  try {
    const raw = fs.readFileSync(input.filePath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (input.validate && !input.validate(parsed)) {
      throw new Error('schema-validation-failed');
    }
    const data = parsed as T;
    putShadowPersistenceFallback(input.source, data);
    markShadowPersistenceVerified(input.source);
    return { kind: 'SUCCESS', source: input.source, data };
  } catch (error) {
    const reason = reasonFromError(error);
    const fallback = getShadowPersistenceFallback<T>(input.source);
    const data = fallback ?? safeClone(input.emptyValue);
    const fallbackName = fallback ? 'memory' : 'emptyValue';
    const queuedWrites = getShadowLedgerWriteQueueSize();
    const learningImpact: LearningImpact = queuedWrites > 0
      ? 'DELAYED'
      : fallback
        ? 'DEGRADED'
        : 'LOST_RISK';
    markShadowPersistenceDegraded({
      source: input.source,
      reason,
      fallbackActive: true,
      queuedWrites,
      learningImpact,
    });
    recordShadowPersistenceCase({
      source: input.source,
      operation: 'READ_JSON',
      reason,
      learningImpact,
      details: { filePath: input.filePath, fallback: fallbackName },
    });
    emitShadowPersistenceWarn({
      code: input.readFailedCode ?? 'P1_SHADOW_DB_READ_FAILED',
      source: input.source,
      message: 'Shadow persistence read failed; fallback returned.',
      reason,
      learningImpact,
      details: { filePath: input.filePath, fallback: fallbackName },
    });
    emitShadowPersistenceWarn({
      code: 'P1_SHADOW_PERSISTENCE_DEGRADED',
      source: input.source,
      message: 'Shadow persistence read is degraded but learning continues.',
      reason,
      learningImpact,
      details: { filePath: input.filePath, fallback: fallbackName },
      ttlSec: 300,
    });
    return {
      kind: 'DEGRADED_FALLBACK',
      source: input.source,
      data,
      fallback: fallbackName,
      reason,
      learningImpact,
    };
  }
}

export function writeShadowJson<T>(input: WriteShadowJsonInput<T>): ShadowPersistenceResult<T> {
  putShadowPersistenceFallback(input.source, input.data);
  try {
    atomicWriteJson(input.filePath, input.data);
    markShadowPersistenceVerified(input.source);
    return { kind: 'SUCCESS', source: input.source, data: input.data };
  } catch (error) {
    const reason = reasonFromError(error);
    const item = enqueueShadowLedgerWrite({
      source: input.source,
      operation: 'WRITE_JSON',
      filePath: input.filePath,
      payload: safeClone(input.data),
      reason,
      maxAttempts: input.maxAttempts,
      learningImpact: 'DELAYED',
    });
    markShadowPersistenceDegraded({
      source: input.source,
      reason,
      fallbackActive: true,
      queuedWrites: getShadowLedgerWriteQueueSize(),
      learningImpact: 'DELAYED',
    });
    recordShadowPersistenceCase({
      source: input.source,
      operation: 'WRITE_JSON',
      reason,
      learningImpact: 'DELAYED',
      queueId: item.queueId,
      details: { filePath: input.filePath },
    });
    emitShadowPersistenceWarn({
      code: input.writeFailedCode ?? 'P1_SHADOW_DB_WRITE_FAILED',
      source: input.source,
      message: 'Shadow persistence write failed; queued for retry.',
      reason,
      learningImpact: 'DELAYED',
      queueId: item.queueId,
      details: { filePath: input.filePath },
    });
    emitShadowPersistenceWarn({
      code: input.queuedCode ?? 'P1_SHADOW_LEDGER_WRITE_QUEUED',
      source: input.source,
      message: 'Shadow persistence write queued for retry.',
      reason,
      learningImpact: 'DELAYED',
      queueId: item.queueId,
      details: { filePath: input.filePath, queuedWrites: getShadowLedgerWriteQueueSize() },
    });
    return {
      kind: 'QUEUED_FOR_RETRY',
      queueId: item.queueId,
      reason,
      learningImpact: 'DELAYED',
    };
  }
}

export function deleteShadowPath(input: {
  source: string;
  filePath: string;
  writeFailedCode?: ShadowPersistenceWarnCode;
}): ShadowPersistenceResult<null> {
  try {
    if (fs.existsSync(input.filePath)) fs.unlinkSync(input.filePath);
    markShadowPersistenceVerified(input.source);
    return { kind: 'SUCCESS', source: input.source, data: null };
  } catch (error) {
    const reason = reasonFromError(error);
    const item = enqueueShadowLedgerWrite({
      source: input.source,
      operation: 'DELETE',
      filePath: input.filePath,
      reason,
      learningImpact: 'DELAYED',
    });
    emitShadowPersistenceWarn({
      code: input.writeFailedCode ?? 'P1_SHADOW_DB_WRITE_FAILED',
      source: input.source,
      message: 'Shadow persistence delete failed; queued for retry.',
      reason,
      learningImpact: 'DELAYED',
      queueId: item.queueId,
      details: { filePath: input.filePath },
    });
    return { kind: 'QUEUED_FOR_RETRY', queueId: item.queueId, reason, learningImpact: 'DELAYED' };
  }
}

export function appendShadowJsonArray<T>(input: WriteShadowJsonInput<T[]> & { entry: T; maxEntries?: number }): ShadowPersistenceResult<T[]> {
  const current = readShadowJson<T[]>({
    source: input.source,
    filePath: input.filePath,
    emptyValue: [],
    validate: Array.isArray as (data: unknown) => data is T[],
  });
  const data = current.kind === 'SUCCESS' || current.kind === 'DEGRADED_FALLBACK'
    ? [...current.data, input.entry]
    : [input.entry];
  const trimmed = input.maxEntries && data.length > input.maxEntries
    ? data.slice(-input.maxEntries)
    : data;
  return writeShadowJson({ ...input, data: trimmed });
}

export function upsertShadowJsonArray<T>(input: WriteShadowJsonInput<T[]> & {
  entry: T;
  match: (entry: T) => boolean;
  maxEntries?: number;
}): ShadowPersistenceResult<T[]> {
  const current = readShadowJson<T[]>({
    source: input.source,
    filePath: input.filePath,
    emptyValue: [],
    validate: Array.isArray as (data: unknown) => data is T[],
  });
  const data = current.kind === 'SUCCESS' || current.kind === 'DEGRADED_FALLBACK'
    ? [...current.data]
    : [];
  const idx = data.findIndex(input.match);
  if (idx >= 0) data[idx] = input.entry;
  else data.push(input.entry);
  const trimmed = input.maxEntries && data.length > input.maxEntries
    ? data.slice(-input.maxEntries)
    : data;
  return writeShadowJson({ ...input, data: trimmed });
}

export function performQueuedShadowWrite(item: ShadowLedgerWriteQueueItem): void {
  if (item.operation === 'WRITE_JSON') {
    atomicWriteJson(item.filePath, item.payload);
    putShadowPersistenceFallback(item.source, item.payload);
    markShadowPersistenceVerified(item.source);
    return;
  }
  if (item.operation === 'DELETE') {
    if (fs.existsSync(item.filePath)) fs.unlinkSync(item.filePath);
    markShadowPersistenceVerified(item.source);
    return;
  }
  throw new Error(`unsupported queued operation: ${item.operation}`);
}

export function markShadowReplayRequired(input: {
  source: string;
  reason: string;
  queueId?: string;
}): void {
  markShadowPersistenceFailed({
    source: input.source,
    reason: input.reason,
    queuedWrites: getShadowLedgerWriteQueueSize(),
    learningImpact: 'REPLAY_REQUIRED',
  });
  recordShadowPersistenceCase({
    source: input.source,
    operation: 'REPLAY_REQUIRED',
    reason: input.reason,
    learningImpact: 'REPLAY_REQUIRED',
    queueId: input.queueId,
  });
  emitShadowPersistenceWarn({
    code: 'P1_SHADOW_PERSISTENCE_REPLAY_REQUIRED',
    source: input.source,
    message: 'Shadow persistence queued write requires replay.',
    reason: input.reason,
    learningImpact: 'REPLAY_REQUIRED',
    queueId: input.queueId,
    ttlSec: 300,
  });
}
