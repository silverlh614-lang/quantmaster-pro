// @responsibility Retry and reconcile queued shadow persistence writes.

import {
  listShadowLedgerWriteQueue,
  markShadowLedgerWriteFailed,
  markShadowLedgerWriteRetrying,
  markShadowLedgerWriteSucceeded,
} from './shadowLedgerWriteQueue.js';
import {
  markShadowReplayRequired,
  performQueuedShadowWrite,
} from './shadowPersistenceGateway.js';

export interface ShadowPersistenceReconcileResult {
  checked: number;
  succeeded: number;
  failed: number;
  replayRequired: number;
}

function reasonFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function reconcileShadowPersistenceQueue(limit = 20): ShadowPersistenceReconcileResult {
  const candidates = listShadowLedgerWriteQueue()
    .filter((item) => item.status === 'QUEUED' || item.status === 'FAILED')
    .slice(0, Math.max(0, limit));
  const result: ShadowPersistenceReconcileResult = {
    checked: candidates.length,
    succeeded: 0,
    failed: 0,
    replayRequired: 0,
  };

  for (const queued of candidates) {
    const retrying = markShadowLedgerWriteRetrying(queued.queueId);
    if (!retrying) continue;
    try {
      performQueuedShadowWrite(retrying);
      markShadowLedgerWriteSucceeded(retrying.queueId);
      result.succeeded++;
    } catch (error) {
      const reason = reasonFromError(error);
      markShadowLedgerWriteFailed(retrying.queueId, reason);
      const latest = listShadowLedgerWriteQueue().find((item) => item.queueId === retrying.queueId);
      if (latest?.status === 'REPLAY_REQUIRED') {
        markShadowReplayRequired({
          source: latest.source,
          reason,
          queueId: latest.queueId,
        });
        result.replayRequired++;
      } else {
        result.failed++;
      }
    }
  }

  return result;
}
