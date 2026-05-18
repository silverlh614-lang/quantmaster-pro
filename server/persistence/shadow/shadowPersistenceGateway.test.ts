import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  readShadowJson,
  writeShadowJson,
} from './shadowPersistenceGateway.js';
import { reconcileShadowPersistenceQueue } from './shadowPersistenceReconciler.js';
import {
  __resetShadowLedgerWriteQueueForTests,
  getShadowLedgerWriteQueueSize,
  listShadowLedgerWriteQueue,
} from './shadowLedgerWriteQueue.js';
import {
  __resetShadowPersistenceHealthForTests,
  getShadowPersistenceHealthSnapshot,
} from './shadowPersistenceHealth.js';
import { clearShadowPersistenceFallbacks } from './shadowPersistenceFallbackStore.js';
import {
  __resetShadowPersistenceCasesForTests,
  listShadowPersistenceCases,
} from './shadowCaseRecorder.js';
import { clearWarnDedupStore } from '../../observability/warnDedupStore.js';

describe('shadowPersistenceGateway', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shadow-persist-'));
    __resetShadowLedgerWriteQueueForTests();
    __resetShadowPersistenceHealthForTests();
    __resetShadowPersistenceCasesForTests();
    clearShadowPersistenceFallbacks();
    clearWarnDedupStore();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes and reads JSON through the gateway', () => {
    const filePath = path.join(tmpDir, 'ledger.json');
    const write = writeShadowJson({
      source: 'TestShadowLedger',
      filePath,
      data: { version: 1, entries: [{ id: 'a' }] },
    });

    expect(write.kind).toBe('SUCCESS');

    const read = readShadowJson<{ version: 1; entries: Array<{ id: string }> }>({
      source: 'TestShadowLedger',
      filePath,
      emptyValue: { version: 1, entries: [] },
      validate: (data): data is { version: 1; entries: Array<{ id: string }> } =>
        Boolean(data && typeof data === 'object' && Array.isArray((data as { entries?: unknown }).entries)),
    });

    expect(read.kind).toBe('SUCCESS');
    if (read.kind === 'SUCCESS') {
      expect(read.data.entries[0]?.id).toBe('a');
    }
    expect(getShadowPersistenceHealthSnapshot()[0]).toEqual(expect.objectContaining({
      source: 'TestShadowLedger',
      status: 'VERIFIED',
      learningImpact: 'NONE',
    }));
  });

  it('queues write failures and serves memory fallback instead of losing learning data', () => {
    const filePath = path.join(tmpDir, 'blocked-ledger.json');
    fs.mkdirSync(filePath);

    const write = writeShadowJson({
      source: 'BlockedShadowLedger',
      filePath,
      data: { entries: [{ id: 'queued' }] },
      writeFailedCode: 'P1_SHADOW_DB_WRITE_FAILED',
    });

    expect(write.kind).toBe('QUEUED_FOR_RETRY');
    expect(getShadowLedgerWriteQueueSize()).toBe(1);
    expect(listShadowPersistenceCases()).toEqual([
      expect.objectContaining({
        source: 'BlockedShadowLedger',
        operation: 'WRITE_JSON',
        executionImpact: 'NONE',
        learningImpact: 'DELAYED',
      }),
    ]);

    const read = readShadowJson<{ entries: Array<{ id: string }> }>({
      source: 'BlockedShadowLedger',
      filePath,
      emptyValue: { entries: [] },
      validate: (data): data is { entries: Array<{ id: string }> } =>
        Boolean(data && typeof data === 'object' && Array.isArray((data as { entries?: unknown }).entries)),
    });

    expect(read.kind).toBe('DEGRADED_FALLBACK');
    if (read.kind === 'DEGRADED_FALLBACK') {
      expect(read.data.entries[0]?.id).toBe('queued');
      expect(read.learningImpact).toBe('DELAYED');
    }
  });

  it('reconciles queued writes when the disk path becomes writable', () => {
    const filePath = path.join(tmpDir, 'retry-ledger.json');
    fs.mkdirSync(filePath);

    writeShadowJson({
      source: 'RetryShadowLedger',
      filePath,
      data: { entries: [{ id: 'retry-ok' }] },
    });
    expect(getShadowLedgerWriteQueueSize()).toBe(1);

    fs.rmSync(filePath, { recursive: true, force: true });
    const result = reconcileShadowPersistenceQueue();

    expect(result).toEqual(expect.objectContaining({
      checked: 1,
      succeeded: 1,
      failed: 0,
      replayRequired: 0,
    }));
    expect(listShadowLedgerWriteQueue()[0]).toEqual(expect.objectContaining({
      status: 'SUCCEEDED',
      learningImpact: 'NONE',
    }));
    expect(JSON.parse(fs.readFileSync(filePath, 'utf-8'))).toEqual({
      entries: [{ id: 'retry-ok' }],
    });
  });
});
