/**
 * @responsibility Production decision-path guard for KRX stock master usability.
 *
 * This is the wiring-facing wrapper around ADR-0168 emergencyDataQualityGuards.
 * It intentionally reads the persisted master snapshot, not network probe status.
 */

import { getMasterSize, isMasterStale } from '../persistence/krxStockMasterRepo.js';
import {
  DEFAULT_KRX_MASTER_GUARD,
  FatalDataQualityError,
  assertUsableKrxMaster,
} from './emergencyDataQualityGuards.js';

export type ProductionDecisionPath =
  | 'SCANNER'
  | 'RECOMMENDATION'
  | 'AUTOTRADE'
  | 'INTRADAY_AUTOTRADE';

export interface ProductionMasterDecisionSnapshot {
  path: ProductionDecisionPath;
  total: number;
  isStale: boolean;
  minTotal: number;
  ttlHours: number;
}

export function getProductionMasterDecisionSnapshot(
  path: ProductionDecisionPath,
): ProductionMasterDecisionSnapshot {
  return {
    path,
    total: getMasterSize(),
    isStale: isMasterStale(),
    minTotal: DEFAULT_KRX_MASTER_GUARD.minTotal,
    ttlHours: DEFAULT_KRX_MASTER_GUARD.ttlHours,
  };
}

export function assertProductionMasterUsable(
  path: ProductionDecisionPath,
): ProductionMasterDecisionSnapshot {
  const snapshot = getProductionMasterDecisionSnapshot(path);

  try {
    assertUsableKrxMaster({
      total: snapshot.total,
      // isMasterStale() is the persisted repo SSOT. The emergency guard expects an age number,
      // so encode stale as ttl+1 and fresh as 0 without inventing file timestamps here.
      ageHours: snapshot.isStale ? snapshot.ttlHours + 1 : 0,
      source: 'DISK_MASTER',
    });
  } catch (err) {
    if (err instanceof FatalDataQualityError) {
      throw new FatalDataQualityError(err.code, {
        ...err.meta,
        path,
        total: snapshot.total,
        isStale: snapshot.isStale,
        minTotal: snapshot.minTotal,
        ttlHours: snapshot.ttlHours,
        action: 'BLOCK_PRODUCTION_DECISION_PATH',
      });
    }
    throw err;
  }

  return snapshot;
}

export function formatProductionMasterBlockedMessage(err: unknown): string {
  if (err instanceof FatalDataQualityError) {
    const path = String(err.meta.path ?? 'UNKNOWN');
    const total = String(err.meta.total ?? '?');
    const minTotal = String(err.meta.minTotal ?? DEFAULT_KRX_MASTER_GUARD.minTotal);
    const stale = String(err.meta.isStale ?? '?');
    return `SCAN_ABORTED — ${err.code} / path=${path} / total=${total} < ${minTotal} or stale=${stale}`;
  }
  return `SCAN_ABORTED — ${err instanceof Error ? err.message : String(err)}`;
}
