/**
 * @responsibility Production decision-path guard for KRX stock master usability.
 *
 * This is the wiring-facing wrapper around ADR-0168 emergencyDataQualityGuards.
 * It intentionally reads the persisted master snapshot, not network probe status.
 */

import {
  getKrxMasterMetadata,
  isMasterStale,
  RAW_KRX_MASTER_MIN_TOTAL,
  TRADABLE_KRX_UNIVERSE_MIN_TOTAL,
} from '../persistence/krxStockMasterRepo.js';
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
  rawMasterTotal: number;
  tradableUniverseTotal: number;
  scannerCandidateTotal: number;
  total: number;
  isStale: boolean;
  minTotal: number;
  minTradableTotal: number;
  ttlHours: number;
}

export function getProductionMasterDecisionSnapshot(
  path: ProductionDecisionPath,
): ProductionMasterDecisionSnapshot {
  const meta = getKrxMasterMetadata();
  return {
    path,
    rawMasterTotal: meta.raw_krx_master_total,
    tradableUniverseTotal: meta.tradable_universe_total,
    scannerCandidateTotal: meta.scanner_candidate_total,
    total: meta.raw_krx_master_total,
    isStale: isMasterStale(),
    minTotal: RAW_KRX_MASTER_MIN_TOTAL,
    minTradableTotal: TRADABLE_KRX_UNIVERSE_MIN_TOTAL,
    ttlHours: DEFAULT_KRX_MASTER_GUARD.ttlHours,
  };
}

export function assertProductionMasterUsable(
  path: ProductionDecisionPath,
): ProductionMasterDecisionSnapshot {
  const snapshot = getProductionMasterDecisionSnapshot(path);

  try {
    if (snapshot.rawMasterTotal < snapshot.minTotal) {
      throw new FatalDataQualityError('KRX_MASTER_TOO_SMALL', {
        total: snapshot.rawMasterTotal,
        minTotal: snapshot.minTotal,
        rawMasterTotal: snapshot.rawMasterTotal,
        scannerCandidateTotal: snapshot.scannerCandidateTotal,
      });
    }
    if (snapshot.tradableUniverseTotal < snapshot.minTradableTotal) {
      throw new FatalDataQualityError('KRX_UNIVERSE_TOO_SMALL', {
        total: snapshot.tradableUniverseTotal,
        minTotal: snapshot.minTradableTotal,
        rawMasterTotal: snapshot.rawMasterTotal,
        tradableUniverseTotal: snapshot.tradableUniverseTotal,
        scannerCandidateTotal: snapshot.scannerCandidateTotal,
      });
    }
    assertUsableKrxMaster({
      total: snapshot.rawMasterTotal,
      // isMasterStale() is the persisted repo SSOT. The emergency guard expects an age number,
      // so encode stale as ttl+1 and fresh as 0 without inventing file timestamps here.
      ageHours: snapshot.isStale ? snapshot.ttlHours + 1 : 0,
      source: 'KRX_FULL_MASTER',
    });
  } catch (err) {
    if (err instanceof FatalDataQualityError) {
      throw new FatalDataQualityError(err.code, {
        ...err.meta,
        path,
        total: snapshot.rawMasterTotal,
        rawMasterTotal: snapshot.rawMasterTotal,
        tradableUniverseTotal: snapshot.tradableUniverseTotal,
        scannerCandidateTotal: snapshot.scannerCandidateTotal,
        isStale: snapshot.isStale,
        minTotal: snapshot.minTotal,
        minTradableTotal: snapshot.minTradableTotal,
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
    const raw = String(err.meta.rawMasterTotal ?? err.meta.total ?? '?');
    const tradable = String(err.meta.tradableUniverseTotal ?? '?');
    const scanner = String(err.meta.scannerCandidateTotal ?? '?');
    const minTotal = String(err.meta.minTotal ?? RAW_KRX_MASTER_MIN_TOTAL);
    const minTradable = String(err.meta.minTradableTotal ?? TRADABLE_KRX_UNIVERSE_MIN_TOTAL);
    const stale = String(err.meta.isStale ?? '?');
    const threshold = err.code === 'KRX_UNIVERSE_TOO_SMALL' ? `tradable=${tradable} < ${minTradable}` : `raw=${raw} < ${minTotal}`;
    return `SCAN_ABORTED — ${err.code} / path=${path} / source=KRX_FULL_MASTER / ${threshold} / scannerCandidates=${scanner} / stale=${stale}`;
  }
  return `SCAN_ABORTED — ${err instanceof Error ? err.message : String(err)}`;
}
