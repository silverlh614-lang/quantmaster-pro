// @responsibility OpenDART corpCode.xml master cache and stock_code -> corp_code resolver.

import fs from 'node:fs';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { DATA_DIR, ensureDataDir } from '../../persistence/paths.js';
import { fetchWithRetry, FetchRetryError } from '../../utils/fetchWithRetry.js';

export const DART_CORP_CODE_MASTER_URL = 'https://opendart.fss.or.kr/api/corpCode.xml';
export const DART_CORP_CODE_MASTER_CACHE_FILE = path.join(DATA_DIR, 'dart-corp-code-master.json');
export const DEFAULT_DART_CORP_CODE_TTL_HOURS = 72;

export interface DartCorpCodeMasterRow {
  corpCode: string;
  corpName: string;
  stockCode: string;
  modifyDate: string;
}

export interface DartCorpCodeMasterCacheFile {
  version: 1;
  loaded: boolean;
  source: 'DART_CORPCODE_XML' | 'NONE';
  loadedAt: string | null;
  ttlHours: number;
  rows: DartCorpCodeMasterRow[];
  lastError?: string | null;
  lastHttpStatus?: number | null;
}

export interface DartCorpCodeCacheStatus {
  corpCodeCacheLoaded: boolean;
  corpCodeCacheCount: number;
  listedStockCodeCount: number;
  loadedAt: string | null;
  ttlExpiresAt: string | null;
  source: 'DART_CORPCODE_XML' | 'NONE';
  ttlHours: number;
  expired: boolean;
  sampleMappings: string[];
  missingSampleSymbols: string[];
  lastError: string | null;
  lastHttpStatus: number | null;
  executionImpact: 'NONE';
}

export type DartCorpCodeResolveStatus = 'FOUND' | 'NOT_FOUND' | 'CACHE_MISSING' | 'ERROR';

export interface DartCorpCodeResolveResult {
  status: DartCorpCodeResolveStatus;
  symbol: string;
  corpCode?: string;
  corpName?: string;
  stockCode?: string;
  modifyDate?: string;
  reason: string;
  executionImpact: 'NONE';
}

export interface DartCorpCodeRefreshResult extends DartCorpCodeCacheStatus {
  downloaded: boolean;
  parseStatus: 'OK' | 'FAILED' | 'EMPTY' | 'NOT_ATTEMPTED';
  refreshed: boolean;
  reason: string;
  cacheFile: string;
}

export interface DartCorpCodeCacheOptions {
  cacheFile?: string;
  apiKey?: string | null;
  now?: Date;
  ttlHours?: number;
  fetchZip?: (url: string) => Promise<Buffer>;
}

function nowIso(now: Date = new Date()): string {
  return now.toISOString();
}

function cleanStockCode(value: unknown): string {
  return String(value ?? '').replace(/[^0-9]/g, '').slice(0, 6).padStart(6, '0');
}

function emptyCache(ttlHours = DEFAULT_DART_CORP_CODE_TTL_HOURS): DartCorpCodeMasterCacheFile {
  return {
    version: 1,
    loaded: false,
    source: 'NONE',
    loadedAt: null,
    ttlHours,
    rows: [],
    lastError: null,
    lastHttpStatus: null,
  };
}

function cacheFileFrom(options?: DartCorpCodeCacheOptions): string {
  return options?.cacheFile ?? DART_CORP_CODE_MASTER_CACHE_FILE;
}

function sanitizeError(value: unknown): string {
  const message = value instanceof Error ? value.message : String(value ?? 'UNKNOWN_ERROR');
  return message
    .replace(/crtfc_key=[^&\s]+/gi, 'crtfc_key=<masked>')
    .replace(/api[_-]?key[=:][^&\s]+/gi, 'apiKey=<masked>');
}

function readUInt16LE(buffer: Buffer, offset: number): number {
  return offset + 2 <= buffer.length ? buffer.readUInt16LE(offset) : 0;
}

function readUInt32LE(buffer: Buffer, offset: number): number {
  return offset + 4 <= buffer.length ? buffer.readUInt32LE(offset) : 0;
}

export function extractXmlFromZipBuffer(zipBuffer: Buffer): Buffer {
  let offset = 0;
  let firstFile: Buffer | null = null;
  while (offset + 30 <= zipBuffer.length) {
    const signature = readUInt32LE(zipBuffer, offset);
    if (signature !== 0x04034b50) {
      offset += 1;
      continue;
    }
    const method = readUInt16LE(zipBuffer, offset + 8);
    const compressedSize = readUInt32LE(zipBuffer, offset + 18);
    const fileNameLength = readUInt16LE(zipBuffer, offset + 26);
    const extraLength = readUInt16LE(zipBuffer, offset + 28);
    const nameStart = offset + 30;
    const nameEnd = nameStart + fileNameLength;
    const dataStart = nameEnd + extraLength;
    const dataEnd = dataStart + compressedSize;
    if (nameEnd > zipBuffer.length || dataEnd > zipBuffer.length || compressedSize <= 0) break;
    const fileName = zipBuffer.subarray(nameStart, nameEnd).toString('utf8').toLowerCase();
    const compressed = zipBuffer.subarray(dataStart, dataEnd);
    let data: Buffer | null = null;
    if (method === 0) data = Buffer.from(compressed);
    else if (method === 8) data = inflateRawSync(compressed);
    if (data) {
      if (fileName.endsWith('.xml')) return data;
      firstFile ??= data;
    }
    offset = dataEnd;
  }
  if (firstFile) return firstFile;
  throw new Error('corpCode.xml not found in zip archive');
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function tagValue(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*<\\/${tag}>`, 'i'));
  return decodeXmlEntities(match?.[1] ?? '');
}

export function parseDartCorpCodeXml(xml: string): DartCorpCodeMasterRow[] {
  const rows = new Map<string, DartCorpCodeMasterRow>();
  const listPattern = /<list>\s*([\s\S]*?)\s*<\/list>/gi;
  let match: RegExpExecArray | null;
  while ((match = listPattern.exec(xml)) !== null) {
    const block = match[1] ?? '';
    const corpCode = tagValue(block, 'corp_code');
    const corpName = tagValue(block, 'corp_name');
    const stockCode = cleanStockCode(tagValue(block, 'stock_code'));
    const modifyDate = tagValue(block, 'modify_date');
    if (!/^\d{8}$/.test(corpCode) || !/^\d{6}$/.test(stockCode) || stockCode === '000000') continue;
    rows.set(stockCode, { corpCode, corpName, stockCode, modifyDate });
  }
  return [...rows.values()].sort((a, b) => a.stockCode.localeCompare(b.stockCode));
}

function loadCacheFile(cacheFile: string): DartCorpCodeMasterCacheFile {
  try {
    if (!fs.existsSync(cacheFile)) return emptyCache();
    const parsed = JSON.parse(fs.readFileSync(cacheFile, 'utf8')) as Partial<DartCorpCodeMasterCacheFile>;
    const rows = Array.isArray(parsed.rows)
      ? parsed.rows.filter(row => row && typeof row.stockCode === 'string' && typeof row.corpCode === 'string') as DartCorpCodeMasterRow[]
      : [];
    return {
      version: 1,
      loaded: parsed.loaded === true && rows.length > 0,
      source: parsed.source === 'DART_CORPCODE_XML' ? 'DART_CORPCODE_XML' : 'NONE',
      loadedAt: typeof parsed.loadedAt === 'string' ? parsed.loadedAt : null,
      ttlHours: typeof parsed.ttlHours === 'number' && Number.isFinite(parsed.ttlHours)
        ? parsed.ttlHours
        : DEFAULT_DART_CORP_CODE_TTL_HOURS,
      rows,
      lastError: typeof parsed.lastError === 'string' ? parsed.lastError : null,
      lastHttpStatus: typeof parsed.lastHttpStatus === 'number' ? parsed.lastHttpStatus : null,
    };
  } catch {
    return emptyCache();
  }
}

export function loadDartCorpCodeMasterCache(options: DartCorpCodeCacheOptions = {}): DartCorpCodeMasterCacheFile {
  return loadCacheFile(cacheFileFrom(options));
}

export function saveDartCorpCodeMasterCache(
  cache: DartCorpCodeMasterCacheFile,
  options: DartCorpCodeCacheOptions = {},
): DartCorpCodeMasterCacheFile {
  ensureDataDir();
  const cacheFile = cacheFileFrom(options);
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  const next: DartCorpCodeMasterCacheFile = {
    ...cache,
    version: 1,
    loaded: cache.rows.length > 0,
    source: cache.rows.length > 0 ? 'DART_CORPCODE_XML' : cache.source,
  };
  const tmp = `${cacheFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, cacheFile);
  return next;
}

function ttlExpiresAt(cache: DartCorpCodeMasterCacheFile): string | null {
  if (!cache.loadedAt) return null;
  const expires = new Date(cache.loadedAt).getTime() + cache.ttlHours * 60 * 60 * 1000;
  return Number.isFinite(expires) ? new Date(expires).toISOString() : null;
}

function isExpired(cache: DartCorpCodeMasterCacheFile, now: Date = new Date()): boolean {
  if (!cache.loadedAt) return true;
  const expires = new Date(cache.loadedAt).getTime() + cache.ttlHours * 60 * 60 * 1000;
  return !Number.isFinite(expires) || now.getTime() > expires;
}

function sampleMappings(cache: DartCorpCodeMasterCacheFile, symbols: readonly string[]): string[] {
  const bySymbol = new Map(cache.rows.map(row => [row.stockCode, row]));
  const requested = symbols.map(cleanStockCode).filter(symbol => /^\d{6}$/.test(symbol));
  const sampleSymbols = requested.length > 0 ? requested : ['005930', '000660', '035420', '051910', '005380'];
  return sampleSymbols
    .map(symbol => bySymbol.get(symbol))
    .filter((row): row is DartCorpCodeMasterRow => Boolean(row))
    .slice(0, 5)
    .map(row => `${row.stockCode} -> ${row.corpName} corp_code=${row.corpCode}`);
}

function buildStatus(cache: DartCorpCodeMasterCacheFile, options: {
  now?: Date;
  sampleSymbols?: readonly string[];
} = {}): DartCorpCodeCacheStatus {
  const symbols = (options.sampleSymbols ?? []).map(cleanStockCode).filter(symbol => /^\d{6}$/.test(symbol));
  const bySymbol = new Map(cache.rows.map(row => [row.stockCode, row]));
  return {
    corpCodeCacheLoaded: cache.loaded && cache.rows.length > 0,
    corpCodeCacheCount: cache.rows.length,
    listedStockCodeCount: cache.rows.length,
    loadedAt: cache.loadedAt,
    ttlExpiresAt: ttlExpiresAt(cache),
    source: cache.source,
    ttlHours: cache.ttlHours,
    expired: isExpired(cache, options.now),
    sampleMappings: sampleMappings(cache, symbols),
    missingSampleSymbols: symbols.filter(symbol => !bySymbol.has(symbol)),
    lastError: cache.lastError ?? null,
    lastHttpStatus: cache.lastHttpStatus ?? null,
    executionImpact: 'NONE',
  };
}

async function defaultFetchZip(url: string): Promise<Buffer> {
  const response = await fetchWithRetry(url, {
    timeoutMs: 15000,
    retries: 1,
    callerLabel: 'dart-corp-code-master',
  });
  if (!response.ok) throw new Error(`corpCode.xml fetch failed: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function errorHttpStatus(error: unknown): number | null {
  return error instanceof FetchRetryError && typeof error.status === 'number' ? error.status : null;
}

export async function refreshDartCorpCodeMasterCache(
  options: DartCorpCodeCacheOptions = {},
): Promise<DartCorpCodeRefreshResult> {
  const apiKey = options.apiKey ?? process.env.DART_API_KEY ?? process.env.OPENDART_API_KEY ?? null;
  const cacheFile = cacheFileFrom(options);
  const ttlHours = options.ttlHours ?? DEFAULT_DART_CORP_CODE_TTL_HOURS;
  if (!apiKey) {
    const cache = saveDartCorpCodeMasterCache({
      ...loadCacheFile(cacheFile),
      lastError: 'DART_API_KEY_MISSING',
      lastHttpStatus: null,
    }, { cacheFile });
    return {
      ...buildStatus(cache, { now: options.now }),
      downloaded: false,
      parseStatus: 'NOT_ATTEMPTED',
      refreshed: false,
      reason: 'DART_API_KEY_MISSING',
      cacheFile,
    };
  }

  const url = `${DART_CORP_CODE_MASTER_URL}?crtfc_key=${encodeURIComponent(apiKey)}`;
  const fetchZip = options.fetchZip ?? defaultFetchZip;
  try {
    const zip = await fetchZip(url);
    const xmlBuffer = extractXmlFromZipBuffer(zip);
    const xmlText = new TextDecoder('utf-8', { fatal: false }).decode(xmlBuffer);
    const rows = parseDartCorpCodeXml(xmlText);
    const parseStatus = rows.length > 0 ? 'OK' : 'EMPTY';
    const cache = saveDartCorpCodeMasterCache({
      version: 1,
      loaded: rows.length > 0,
      source: rows.length > 0 ? 'DART_CORPCODE_XML' : 'NONE',
      loadedAt: nowIso(options.now),
      ttlHours,
      rows,
      lastError: rows.length > 0 ? null : 'DART_CORP_CODE_XML_EMPTY',
      lastHttpStatus: 200,
    }, { cacheFile });
    return {
      ...buildStatus(cache, { now: options.now }),
      downloaded: true,
      parseStatus,
      refreshed: rows.length > 0,
      reason: rows.length > 0 ? 'OK' : 'DART_CORP_CODE_XML_EMPTY',
      cacheFile,
    };
  } catch (error) {
    const previous = loadCacheFile(cacheFile);
    const cache = saveDartCorpCodeMasterCache({
      ...previous,
      lastError: sanitizeError(error),
      lastHttpStatus: errorHttpStatus(error),
    }, { cacheFile });
    return {
      ...buildStatus(cache, { now: options.now }),
      downloaded: false,
      parseStatus: 'FAILED',
      refreshed: false,
      reason: sanitizeError(error),
      cacheFile,
    };
  }
}

export async function ensureDartCorpCodeMasterCache(
  options: DartCorpCodeCacheOptions & { force?: boolean } = {},
): Promise<DartCorpCodeRefreshResult> {
  const cacheFile = cacheFileFrom(options);
  const cache = loadCacheFile(cacheFile);
  if (!options.force && cache.loaded && cache.rows.length > 0 && !isExpired(cache, options.now)) {
    return {
      ...buildStatus(cache, { now: options.now }),
      downloaded: false,
      parseStatus: 'OK',
      refreshed: false,
      reason: 'CACHE_READY',
      cacheFile,
    };
  }
  return refreshDartCorpCodeMasterCache(options);
}

export function resolveDartCorpCodeFromCache(
  symbol: string,
  options: DartCorpCodeCacheOptions = {},
): DartCorpCodeResolveResult {
  try {
    const normalized = cleanStockCode(symbol);
    const cache = loadCacheFile(cacheFileFrom(options));
    if (!cache.loaded || cache.rows.length === 0) {
      return {
        status: 'CACHE_MISSING',
        symbol: normalized,
        reason: 'DART_CORP_CODE_CACHE_NOT_LOADED',
        executionImpact: 'NONE',
      };
    }
    const row = cache.rows.find(item => item.stockCode === normalized);
    if (!row) {
      return {
        status: 'NOT_FOUND',
        symbol: normalized,
        reason: 'DART_CORP_CODE_NOT_FOUND',
        executionImpact: 'NONE',
      };
    }
    return {
      status: 'FOUND',
      symbol: normalized,
      corpCode: row.corpCode,
      corpName: row.corpName,
      stockCode: row.stockCode,
      modifyDate: row.modifyDate,
      reason: 'FOUND',
      executionImpact: 'NONE',
    };
  } catch (error) {
    return {
      status: 'ERROR',
      symbol: cleanStockCode(symbol),
      reason: sanitizeError(error),
      executionImpact: 'NONE',
    };
  }
}

export function getDartCorpCodeCacheStatus(input: {
  sampleSymbols?: readonly string[];
  now?: Date;
  cacheFile?: string;
} = {}): DartCorpCodeCacheStatus {
  return buildStatus(loadCacheFile(input.cacheFile ?? DART_CORP_CODE_MASTER_CACHE_FILE), {
    now: input.now,
    sampleSymbols: input.sampleSymbols,
  });
}

export function bootstrapDartCorpCodeMasterCache(): void {
  const apiKey = process.env.DART_API_KEY || process.env.OPENDART_API_KEY;
  if (!apiKey) return;
  const cache = loadDartCorpCodeMasterCache();
  if (cache.loaded && cache.rows.length > 0 && !isExpired(cache)) return;
  ensureDartCorpCodeMasterCache({ apiKey }).catch(error => {
    console.warn('[Gate2External] DART corpCode bootstrap failed:', sanitizeError(error));
  });
}
