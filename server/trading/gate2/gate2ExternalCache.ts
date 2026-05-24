// @responsibility Persistent Gate2 external financial projection cache.

import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, ensureDataDir } from '../../persistence/paths.js';
import type { Gate2ExternalProjection } from './gate2ExternalDataProvider.js';

export interface Gate2ExternalCacheRecord {
  symbol: string;
  projection: Gate2ExternalProjection;
  updatedAt: string;
}

export interface Gate2ExternalCacheFile {
  version: 1;
  updatedAt: string | null;
  records: Gate2ExternalCacheRecord[];
}

const CACHE_FILE = path.join(DATA_DIR, 'gate2-external-cache.json');

function cleanSymbol(symbol: string): string {
  return String(symbol || '').replace(/[^0-9]/g, '').slice(0, 6).padStart(6, '0');
}

function emptyCache(): Gate2ExternalCacheFile {
  return { version: 1, updatedAt: null, records: [] };
}

export function loadGate2ExternalCache(): Gate2ExternalCacheFile {
  try {
    if (!fs.existsSync(CACHE_FILE)) return emptyCache();
    const parsed = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) as Partial<Gate2ExternalCacheFile>;
    return {
      version: 1,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
      records: Array.isArray(parsed.records) ? parsed.records.filter(record => record && typeof record.symbol === 'string') as Gate2ExternalCacheRecord[] : [],
    };
  } catch {
    return emptyCache();
  }
}

export function saveGate2ExternalCache(cache: Gate2ExternalCacheFile): void {
  ensureDataDir();
  const tmp = `${CACHE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
  fs.renameSync(tmp, CACHE_FILE);
}

export function getGate2ExternalCacheRecord(symbol: string): Gate2ExternalCacheRecord | null {
  const target = cleanSymbol(symbol);
  return loadGate2ExternalCache().records.find(record => cleanSymbol(record.symbol) === target) ?? null;
}

export function upsertGate2ExternalCacheRecords(records: readonly Gate2ExternalCacheRecord[]): Gate2ExternalCacheFile {
  const cache = loadGate2ExternalCache();
  const bySymbol = new Map(cache.records.map(record => [cleanSymbol(record.symbol), record]));
  for (const record of records) {
    bySymbol.set(cleanSymbol(record.symbol), {
      ...record,
      symbol: cleanSymbol(record.symbol),
    });
  }
  const next: Gate2ExternalCacheFile = {
    version: 1,
    updatedAt: new Date().toISOString(),
    records: [...bySymbol.values()].sort((a, b) => a.symbol.localeCompare(b.symbol)).slice(-500),
  };
  saveGate2ExternalCache(next);
  return next;
}

export function summarizeGate2ExternalCache(now: Date = new Date()): {
  recordCount: number;
  latestUpdatedAt: string | null;
  verifiedCount: number;
  staleCount: number;
  missingCount: number;
  unavailableCount: number;
  executionImpact: 'NONE';
} {
  const cache = loadGate2ExternalCache();
  const latestUpdatedAt = cache.records
    .map(record => record.updatedAt)
    .filter(Boolean)
    .sort()
    .at(-1) ?? cache.updatedAt;
  const ageMs = latestUpdatedAt ? now.getTime() - new Date(latestUpdatedAt).getTime() : Number.POSITIVE_INFINITY;
  const staleByAge = ageMs > 7 * 24 * 60 * 60 * 1000;
  const verifiedCount = cache.records.filter(record => record.projection.financialSnapshot.confidence === 'VERIFIED').length;
  const staleCount = cache.records.filter(record => record.projection.financialSnapshot.confidence === 'STALE').length
    + (staleByAge && cache.records.length > 0 ? cache.records.filter(record => record.projection.financialSnapshot.confidence === 'VERIFIED').length : 0);
  const missingCount = cache.records.filter(record => record.projection.financialSnapshot.confidence === 'MISSING').length;
  return {
    recordCount: cache.records.length,
    latestUpdatedAt,
    verifiedCount,
    staleCount,
    missingCount,
    unavailableCount: cache.records.reduce((sum, record) => sum + record.projection.unavailableCount, 0),
    executionImpact: 'NONE',
  };
}
