// @responsibility Persistent Gate2 external financial projection cache.

import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, ensureDataDir } from '../../persistence/paths.js';
import type {
  Gate2DartProviderHealth,
  Gate2ExternalProjection,
  Gate2ExternalRefreshCounters,
  Gate2ExternalRefreshTrace,
  Gate2ExternalRootCause,
} from './gate2ExternalDataProvider.js';

export interface Gate2ExternalCacheRecord {
  symbol: string;
  projection: Gate2ExternalProjection;
  updatedAt: string;
}

export interface Gate2ExternalLastRefreshDiagnostics {
  asOf: string;
  counters: Gate2ExternalRefreshCounters;
  rootCause: Gate2ExternalRootCause;
  traces: Gate2ExternalRefreshTrace[];
  providerHealth: Gate2DartProviderHealth;
  dartNotApplicable?: number;
  trueCorpCodeNotFound?: number;
  lookupFailed?: number;
  unavailableDueToPER?: number;
  unavailableDueToCorpCodeMissing?: number;
  strongBuyBlockedDetails?: string;
  blockingDetails?: string;
  externalDataBlockReason?: 'NONE' | 'DART_FINANCIALS_MISSING' | 'GATE2_EXTERNAL_PARTIAL';
  externalDataBlockedDetails?: string;
  fundamentalQualityFailReason?: 'NONE' | 'EPS_NON_POSITIVE';
  fundamentalQualityFailDetails?: string;
  qualityFailDetails?: string;
  excludedDetails?: string;
  excludedCount?: number;
  excludedSymbols?: string[];
  excludedReason?: 'DART_NOT_APPLICABLE' | 'NONE';
  unavailableCountRaw?: number;
  unavailableCountActionable?: number;
  unavailableExcludingExcluded?: number;
  excludedUnavailableEquivalent?: number;
  corpCodeMissingSymbols?: string[];
  dartNotApplicableSymbols?: string[];
  trueCorpCodeNotFoundSymbols?: string[];
  corpCodeLookupFailedSymbols?: string[];
  nonEquitySymbols?: string[];
}

export interface Gate2ExternalCacheFile {
  version: 1;
  updatedAt: string | null;
  records: Gate2ExternalCacheRecord[];
  lastRefresh?: Gate2ExternalLastRefreshDiagnostics;
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
      lastRefresh: parsed.lastRefresh && typeof parsed.lastRefresh === 'object'
        ? parsed.lastRefresh as Gate2ExternalLastRefreshDiagnostics
        : undefined,
    };
  } catch {
    return emptyCache();
  }
}

function saveGate2ExternalCache(cache: Gate2ExternalCacheFile): void {
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
    lastRefresh: cache.lastRefresh,
  };
  saveGate2ExternalCache(next);
  return next;
}

export function updateGate2ExternalLastRefresh(lastRefresh: Gate2ExternalLastRefreshDiagnostics): Gate2ExternalCacheFile {
  const cache = loadGate2ExternalCache();
  const next: Gate2ExternalCacheFile = {
    ...cache,
    version: 1,
    updatedAt: cache.updatedAt ?? lastRefresh.asOf,
    lastRefresh,
  };
  saveGate2ExternalCache(next);
  return next;
}

export function isGate2ExternalCacheWritable(): boolean {
  try {
    ensureDataDir();
    fs.accessSync(DATA_DIR, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
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
