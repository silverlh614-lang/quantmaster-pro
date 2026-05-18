// @responsibility Last-known-good stock master shadow database.

import fs from 'fs';
import { STOCK_MASTER_SHADOW_FILE, ensureDataDir } from './paths.js';
import type { StockMasterEntry } from './krxStockMasterRepo.js';
import type { StockMasterSource } from './stockMasterHealthRepo.js';
import {
  emitShadowPersistenceWarn,
  readShadowJson,
  writeShadowJson,
} from './shadow/shadowPersistenceGateway.js';
import { deleteShadowPersistenceFallback } from './shadow/shadowPersistenceFallbackStore.js';

export interface ShadowMasterSnapshot {
  fetchedAt: number;
  source: StockMasterSource;
  entries: StockMasterEntry[];
  validatedCount: number;
}

const VALID_SHADOW_SOURCES: ReadonlyArray<StockMasterSource> = ['KRX_OPENAPI', 'KRX_CSV', 'NAVER_LIST'];

let _cached: ShadowMasterSnapshot | null = null;
let _loadedFromDisk = false;

function isShadowMasterSnapshot(data: unknown): data is ShadowMasterSnapshot {
  const parsed = data as Partial<ShadowMasterSnapshot> | null;
  return Boolean(
    parsed &&
    Array.isArray(parsed.entries) &&
    typeof parsed.fetchedAt === 'number' &&
    VALID_SHADOW_SOURCES.includes(parsed.source as StockMasterSource),
  );
}

function loadFromDisk(): ShadowMasterSnapshot | null {
  ensureDataDir();
  const result = readShadowJson<ShadowMasterSnapshot>({
    source: 'ShadowMasterDb',
    filePath: STOCK_MASTER_SHADOW_FILE,
    emptyValue: null as unknown as ShadowMasterSnapshot,
    validate: isShadowMasterSnapshot,
  });
  if (result.kind === 'SUCCESS' || result.kind === 'DEGRADED_FALLBACK') return result.data;
  return null;
}

function saveToDisk(snap: ShadowMasterSnapshot): void {
  ensureDataDir();
  writeShadowJson({
    source: 'ShadowMasterDb',
    filePath: STOCK_MASTER_SHADOW_FILE,
    data: snap,
  });
}

function ensureLoaded(): void {
  if (_loadedFromDisk) return;
  _cached = loadFromDisk();
  _loadedFromDisk = true;
}

export function loadShadowMaster(): ShadowMasterSnapshot | null {
  ensureLoaded();
  return _cached;
}

export function updateShadowMaster(
  source: StockMasterSource,
  entries: StockMasterEntry[],
  now: number = Date.now(),
): boolean {
  if (!VALID_SHADOW_SOURCES.includes(source)) {
    emitShadowPersistenceWarn({
      code: 'P1_SHADOW_PERSISTENCE_DEGRADED',
      source: 'ShadowMasterDb',
      message: 'Shadow master update rejected by source policy.',
      reason: `source=${source}`,
      learningImpact: 'NONE',
      details: { allowedSources: VALID_SHADOW_SOURCES },
      ttlSec: 300,
    });
    return false;
  }
  if (entries.length === 0) {
    emitShadowPersistenceWarn({
      code: 'P1_SHADOW_PERSISTENCE_DEGRADED',
      source: 'ShadowMasterDb',
      message: 'Shadow master update rejected because entries are empty.',
      reason: 'empty-entries',
      learningImpact: 'NONE',
      ttlSec: 300,
    });
    return false;
  }
  const snap: ShadowMasterSnapshot = {
    fetchedAt: now,
    source,
    entries,
    validatedCount: entries.length,
  };
  _cached = snap;
  _loadedFromDisk = true;
  saveToDisk(snap);
  return true;
}

export function getShadowMasterSize(): number {
  ensureLoaded();
  return _cached?.entries.length ?? 0;
}

export function getShadowMasterAgeMs(now: number = Date.now()): number {
  ensureLoaded();
  if (!_cached) return Infinity;
  return now - _cached.fetchedAt;
}

export const __testOnly = {
  reset(): void {
    _cached = null;
    _loadedFromDisk = false;
    deleteShadowPersistenceFallback('ShadowMasterDb');
    try { fs.unlinkSync(STOCK_MASTER_SHADOW_FILE); } catch { /* not present */ }
  },
  VALID_SHADOW_SOURCES,
};
