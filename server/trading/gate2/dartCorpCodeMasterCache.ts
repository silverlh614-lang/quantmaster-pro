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
  corpEngName?: string;
  stockCode: string;
  modifyDate: string;
}

export interface DartCorpCodeMasterCacheFile {
  version: 1;
  loaded: boolean;
  source: 'DART_CORPCODE_XML' | 'NONE';
  loadedAt: string | null;
  ttlHours: number;
  corpCodeCacheCount?: number;
  listedStockCodeCount?: number;
  selectedXmlEntry?: string | null;
  zipEntries?: string[];
  zipOpenStatus?: 'OK' | 'FAILED' | 'NOT_ATTEMPTED';
  requestUrlHost?: string | null;
  contentType?: string | null;
  contentLength?: number | null;
  firstBytesHex?: string | null;
  firstBytesAscii?: string | null;
  responsePreview?: string | null;
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
  requestUrlHost: string | null;
  httpStatus: number | null;
  contentType: string | null;
  contentLength: number | null;
  firstBytesHex: string | null;
  firstBytesAscii: string | null;
  zipOpenStatus: 'OK' | 'FAILED' | 'NOT_ATTEMPTED';
  zipEntries: string[];
  selectedXmlEntry: string | null;
  responsePreview: string | null;
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

export interface DartCorpCodeFetchResponse {
  body: Buffer;
  httpStatus?: number | null;
  contentType?: string | null;
  contentLength?: number | null;
}

export interface DartCorpCodeCacheOptions {
  cacheFile?: string;
  apiKey?: string | null;
  now?: Date;
  ttlHours?: number;
  fetchZip?: (url: string) => Promise<Buffer | DartCorpCodeFetchResponse>;
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
    corpCodeCacheCount: 0,
    listedStockCodeCount: 0,
    selectedXmlEntry: null,
    zipEntries: [],
    zipOpenStatus: 'NOT_ATTEMPTED',
    requestUrlHost: null,
    contentType: null,
    contentLength: null,
    firstBytesHex: null,
    firstBytesAscii: null,
    responsePreview: null,
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

function isZipBuffer(buffer: Buffer): boolean {
  return buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

function firstBytesHex(buffer: Buffer, max = 16): string {
  return buffer.subarray(0, max).toString('hex').match(/../g)?.join(' ') ?? '';
}

function firstBytesAscii(buffer: Buffer, max = 16): string {
  return buffer
    .subarray(0, max)
    .toString('latin1')
    .replace(/[^\x20-\x7E]/g, '.');
}

function safePreview(buffer: Buffer, max = 200): string {
  return sanitizeError(buffer.subarray(0, max).toString('utf8')).replace(/\s+/g, ' ').trim();
}

interface ZipEntryInfo {
  name: string;
  baseName: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  dataStart: number;
  dataEnd: number;
}

export interface DartCorpCodeZipExtraction {
  xml: Buffer;
  zipEntries: string[];
  selectedXmlEntry: string;
}

function zipBaseName(name: string): string {
  return name.split(/[\\/]/).pop() ?? name;
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const min = Math.max(0, buffer.length - 22 - 0xffff);
  for (let offset = buffer.length - 22; offset >= min; offset -= 1) {
    if (readUInt32LE(buffer, offset) === 0x06054b50) return offset;
  }
  return -1;
}

function listCentralDirectoryEntries(zipBuffer: Buffer): ZipEntryInfo[] {
  const eocdOffset = findEndOfCentralDirectory(zipBuffer);
  if (eocdOffset < 0) return [];
  const entryCount = readUInt16LE(zipBuffer, eocdOffset + 10);
  let offset = readUInt32LE(zipBuffer, eocdOffset + 16);
  const entries: ZipEntryInfo[] = [];
  for (let index = 0; index < entryCount && offset + 46 <= zipBuffer.length; index += 1) {
    if (readUInt32LE(zipBuffer, offset) !== 0x02014b50) break;
    const method = readUInt16LE(zipBuffer, offset + 10);
    const compressedSize = readUInt32LE(zipBuffer, offset + 20);
    const uncompressedSize = readUInt32LE(zipBuffer, offset + 24);
    const fileNameLength = readUInt16LE(zipBuffer, offset + 28);
    const extraLength = readUInt16LE(zipBuffer, offset + 30);
    const commentLength = readUInt16LE(zipBuffer, offset + 32);
    const localHeaderOffset = readUInt32LE(zipBuffer, offset + 42);
    const nameStart = offset + 46;
    const nameEnd = nameStart + fileNameLength;
    if (nameEnd > zipBuffer.length) break;
    const name = zipBuffer.subarray(nameStart, nameEnd).toString('utf8');
    const localNameLength = readUInt16LE(zipBuffer, localHeaderOffset + 26);
    const localExtraLength = readUInt16LE(zipBuffer, localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (
      readUInt32LE(zipBuffer, localHeaderOffset) === 0x04034b50
      && dataStart <= dataEnd
      && dataEnd <= zipBuffer.length
      && !name.endsWith('/')
    ) {
      entries.push({
        name,
        baseName: zipBaseName(name),
        method,
        compressedSize,
        uncompressedSize,
        dataStart,
        dataEnd,
      });
    }
    offset = nameEnd + extraLength + commentLength;
  }
  return entries;
}

function listLocalHeaderEntries(zipBuffer: Buffer): ZipEntryInfo[] {
  const entries: ZipEntryInfo[] = [];
  let offset = 0;
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
    const name = zipBuffer.subarray(nameStart, nameEnd).toString('utf8');
    if (!name.endsWith('/')) {
      entries.push({
        name,
        baseName: zipBaseName(name),
        method,
        compressedSize,
        uncompressedSize: readUInt32LE(zipBuffer, offset + 22),
        dataStart,
        dataEnd,
      });
    }
    offset = dataEnd;
  }
  return entries;
}

function uniqueZipEntries(entries: readonly ZipEntryInfo[]): ZipEntryInfo[] {
  const seen = new Set<string>();
  return entries.filter(entry => {
    const key = `${entry.name}:${entry.dataStart}:${entry.dataEnd}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractZipEntryData(zipBuffer: Buffer, entry: ZipEntryInfo): Buffer | null {
  if (entry.dataEnd > zipBuffer.length || entry.dataStart > entry.dataEnd) return null;
  const compressed = zipBuffer.subarray(entry.dataStart, entry.dataEnd);
  if (entry.method === 0) return Buffer.from(compressed);
  if (entry.method === 8) return inflateRawSync(compressed);
  return null;
}

function xmlLooksLikeCorpCode(data: Buffer): boolean {
  const sample = data.subarray(0, 4096).toString('utf8').toLowerCase();
  return (sample.includes('<result') && sample.includes('<list')) || sample.includes('corp_code');
}

function selectCorpCodeXmlEntry(zipBuffer: Buffer, entries: readonly ZipEntryInfo[]): {
  entry: ZipEntryInfo;
  data: Buffer;
} | null {
  const xmlEntries = entries.filter(entry => entry.baseName.toLowerCase().endsWith('.xml'));
  const tryEntry = (entry: ZipEntryInfo | undefined): { entry: ZipEntryInfo; data: Buffer } | null => {
    if (!entry) return null;
    const data = extractZipEntryData(zipBuffer, entry);
    return data ? { entry, data } : null;
  };

  const exact = tryEntry(xmlEntries.find(entry => entry.baseName === 'CORPCODE.xml'));
  if (exact) return exact;

  const insensitive = tryEntry(xmlEntries.find(entry => entry.baseName.toLowerCase() === 'corpcode.xml'));
  if (insensitive) return insensitive;

  if (xmlEntries.length === 1) {
    const onlyXml = tryEntry(xmlEntries[0]);
    if (onlyXml) return onlyXml;
  }

  for (const entry of xmlEntries) {
    const data = extractZipEntryData(zipBuffer, entry);
    if (data && xmlLooksLikeCorpCode(data)) return { entry, data };
  }
  return null;
}

export function extractXmlFromZipBufferWithDiagnostics(zipBuffer: Buffer): DartCorpCodeZipExtraction {
  if (!isZipBuffer(zipBuffer)) throw new Error('DART_CORPCODE_RESPONSE_NOT_ZIP');
  const entries = uniqueZipEntries([
    ...listCentralDirectoryEntries(zipBuffer),
    ...listLocalHeaderEntries(zipBuffer),
  ]);
  if (entries.length === 0) throw new Error('DART_CORPCODE_ZIP_OPEN_FAILED');
  const selected = selectCorpCodeXmlEntry(zipBuffer, entries);
  if (!selected) throw new Error('DART_CORPCODE_XML_ENTRY_NOT_FOUND');
  return {
    xml: selected.data,
    zipEntries: entries.map(entry => entry.name),
    selectedXmlEntry: selected.entry.name,
  };
}

export function extractXmlFromZipBuffer(zipBuffer: Buffer): Buffer {
  return extractXmlFromZipBufferWithDiagnostics(zipBuffer).xml;
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

interface ParsedDartCorpCodeXml {
  rows: DartCorpCodeMasterRow[];
  totalListCount: number;
  listedStockCodeCount: number;
}

function parseDartCorpCodeXmlDetailed(xml: string): ParsedDartCorpCodeXml {
  const rows = new Map<string, DartCorpCodeMasterRow>();
  const listPattern = /<list>\s*([\s\S]*?)\s*<\/list>/gi;
  let totalListCount = 0;
  let match: RegExpExecArray | null;
  while ((match = listPattern.exec(xml)) !== null) {
    totalListCount += 1;
    const block = match[1] ?? '';
    const corpCode = tagValue(block, 'corp_code');
    const corpName = tagValue(block, 'corp_name');
    const corpEngName = tagValue(block, 'corp_eng_name');
    const stockCode = cleanStockCode(tagValue(block, 'stock_code'));
    const modifyDate = tagValue(block, 'modify_date');
    if (!/^\d{8}$/.test(corpCode) || !/^\d{6}$/.test(stockCode) || stockCode === '000000') continue;
    rows.set(stockCode, { corpCode, corpName, corpEngName, stockCode, modifyDate });
  }
  const listedRows = [...rows.values()].sort((a, b) => a.stockCode.localeCompare(b.stockCode));
  return {
    rows: listedRows,
    totalListCount,
    listedStockCodeCount: listedRows.length,
  };
}

export function parseDartCorpCodeXml(xml: string): DartCorpCodeMasterRow[] {
  return parseDartCorpCodeXmlDetailed(xml).rows;
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
      corpCodeCacheCount: typeof parsed.corpCodeCacheCount === 'number' ? parsed.corpCodeCacheCount : rows.length,
      listedStockCodeCount: typeof parsed.listedStockCodeCount === 'number' ? parsed.listedStockCodeCount : rows.length,
      selectedXmlEntry: typeof parsed.selectedXmlEntry === 'string' ? parsed.selectedXmlEntry : null,
      zipEntries: Array.isArray(parsed.zipEntries) ? parsed.zipEntries.filter(item => typeof item === 'string') : [],
      zipOpenStatus: parsed.zipOpenStatus === 'OK' || parsed.zipOpenStatus === 'FAILED'
        ? parsed.zipOpenStatus
        : 'NOT_ATTEMPTED',
      requestUrlHost: typeof parsed.requestUrlHost === 'string' ? parsed.requestUrlHost : null,
      contentType: typeof parsed.contentType === 'string' ? parsed.contentType : null,
      contentLength: typeof parsed.contentLength === 'number' ? parsed.contentLength : null,
      firstBytesHex: typeof parsed.firstBytesHex === 'string' ? parsed.firstBytesHex : null,
      firstBytesAscii: typeof parsed.firstBytesAscii === 'string' ? parsed.firstBytesAscii : null,
      responsePreview: typeof parsed.responsePreview === 'string' ? parsed.responsePreview : null,
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
    corpCodeCacheCount: cache.corpCodeCacheCount ?? cache.rows.length,
    listedStockCodeCount: cache.listedStockCodeCount ?? cache.rows.length,
    zipEntries: (cache.zipEntries ?? []).slice(0, 10),
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
    .map(row => `${row.stockCode} -> ${row.corpName} / corpCode=${row.corpCode}`);
}

function buildStatus(cache: DartCorpCodeMasterCacheFile, options: {
  now?: Date;
  sampleSymbols?: readonly string[];
} = {}): DartCorpCodeCacheStatus {
  const symbols = (options.sampleSymbols ?? []).map(cleanStockCode).filter(symbol => /^\d{6}$/.test(symbol));
  const bySymbol = new Map(cache.rows.map(row => [row.stockCode, row]));
  return {
    corpCodeCacheLoaded: cache.loaded && cache.rows.length > 0,
    corpCodeCacheCount: cache.corpCodeCacheCount ?? cache.rows.length,
    listedStockCodeCount: cache.listedStockCodeCount ?? cache.rows.length,
    loadedAt: cache.loadedAt,
    ttlExpiresAt: ttlExpiresAt(cache),
    source: cache.source,
    ttlHours: cache.ttlHours,
    expired: isExpired(cache, options.now),
    sampleMappings: sampleMappings(cache, symbols),
    missingSampleSymbols: symbols.filter(symbol => !bySymbol.has(symbol)),
    lastError: cache.lastError ?? null,
    lastHttpStatus: cache.lastHttpStatus ?? null,
    requestUrlHost: cache.requestUrlHost ?? null,
    httpStatus: cache.lastHttpStatus ?? null,
    contentType: cache.contentType ?? null,
    contentLength: cache.contentLength ?? null,
    firstBytesHex: cache.firstBytesHex ?? null,
    firstBytesAscii: cache.firstBytesAscii ?? null,
    zipOpenStatus: cache.zipOpenStatus ?? 'NOT_ATTEMPTED',
    zipEntries: (cache.zipEntries ?? []).slice(0, 10),
    selectedXmlEntry: cache.selectedXmlEntry ?? null,
    responsePreview: cache.responsePreview ?? null,
    executionImpact: 'NONE',
  };
}

async function defaultFetchZip(url: string): Promise<DartCorpCodeFetchResponse> {
  const response = await fetchWithRetry(url, {
    timeoutMs: 15000,
    retries: 1,
    callerLabel: 'dart-corp-code-master',
  });
  if (!response.ok) throw new Error(`corpCode.xml fetch failed: HTTP ${response.status}`);
  const body = Buffer.from(await response.arrayBuffer());
  const contentLength = Number(response.headers.get('content-length'));
  return {
    body,
    httpStatus: response.status,
    contentType: response.headers.get('content-type'),
    contentLength: Number.isFinite(contentLength) ? contentLength : body.length,
  };
}

function errorHttpStatus(error: unknown): number | null {
  return error instanceof FetchRetryError && typeof error.status === 'number' ? error.status : null;
}

function normalizeFetchResponse(input: Buffer | DartCorpCodeFetchResponse): DartCorpCodeFetchResponse {
  if (Buffer.isBuffer(input)) {
    return {
      body: input,
      httpStatus: 200,
      contentType: null,
      contentLength: input.length,
    };
  }
  return {
    body: input.body,
    httpStatus: input.httpStatus ?? null,
    contentType: input.contentType ?? null,
    contentLength: input.contentLength ?? input.body.length,
  };
}

function requestUrlHost(): string {
  return new URL(DART_CORP_CODE_MASTER_URL).host;
}

function fetchDiagnostics(response: DartCorpCodeFetchResponse): Pick<
  DartCorpCodeMasterCacheFile,
  'requestUrlHost' | 'contentType' | 'contentLength' | 'firstBytesHex' | 'firstBytesAscii' | 'responsePreview' | 'lastHttpStatus'
> {
  return {
    requestUrlHost: requestUrlHost(),
    contentType: response.contentType ?? null,
    contentLength: response.contentLength ?? response.body.length,
    firstBytesHex: firstBytesHex(response.body),
    firstBytesAscii: firstBytesAscii(response.body),
    responsePreview: isZipBuffer(response.body) ? null : safePreview(response.body),
    lastHttpStatus: response.httpStatus ?? null,
  };
}

function classifyCorpCodeRefreshError(error: unknown): string {
  const message = sanitizeError(error);
  if (message.includes('DART_CORPCODE_RESPONSE_NOT_ZIP')) return 'DART_CORPCODE_RESPONSE_NOT_ZIP';
  if (message.includes('DART_CORPCODE_ZIP_OPEN_FAILED')) return 'DART_CORPCODE_ZIP_OPEN_FAILED';
  if (message.includes('DART_CORPCODE_XML_ENTRY_NOT_FOUND')) return 'DART_CORPCODE_XML_ENTRY_NOT_FOUND';
  if (message.includes('DART_CORPCODE_XML_PARSE_FAILED')) return 'DART_CORPCODE_XML_PARSE_FAILED';
  if (message.includes('DART_CORPCODE_LIST_EMPTY')) return 'DART_CORPCODE_LIST_EMPTY';
  if (message.includes('DART_CORPCODE_CACHE_WRITE_FAILED')) return 'DART_CORPCODE_CACHE_WRITE_FAILED';
  if (errorHttpStatus(error) != null || message.includes('fetch failed')) return 'DART_CORPCODE_DOWNLOAD_FAILED';
  return message;
}

export async function refreshDartCorpCodeMasterCache(
  options: DartCorpCodeCacheOptions = {},
): Promise<DartCorpCodeRefreshResult> {
  const apiKey = options.apiKey ?? process.env.DART_API_KEY ?? process.env.OPENDART_API_KEY ?? null;
  const cacheFile = cacheFileFrom(options);
  const ttlHours = options.ttlHours ?? DEFAULT_DART_CORP_CODE_TTL_HOURS;
  let lastDiagnostics: Partial<DartCorpCodeMasterCacheFile> = {
    requestUrlHost: requestUrlHost(),
    zipOpenStatus: 'NOT_ATTEMPTED',
  };
  if (!apiKey) {
    const cache = saveDartCorpCodeMasterCache({
      ...loadCacheFile(cacheFile),
      lastError: 'DART_API_KEY_MISSING',
      lastHttpStatus: null,
      requestUrlHost: requestUrlHost(),
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
    const fetched = normalizeFetchResponse(await fetchZip(url));
    lastDiagnostics = fetchDiagnostics(fetched);
    if (!isZipBuffer(fetched.body)) throw new Error('DART_CORPCODE_RESPONSE_NOT_ZIP');
    const extracted = extractXmlFromZipBufferWithDiagnostics(fetched.body);
    lastDiagnostics = {
      ...lastDiagnostics,
      zipOpenStatus: 'OK',
      zipEntries: extracted.zipEntries.slice(0, 10),
      selectedXmlEntry: extracted.selectedXmlEntry,
      responsePreview: null,
    };
    const xmlBuffer = extracted.xml;
    const xmlText = new TextDecoder('utf-8', { fatal: false }).decode(xmlBuffer);
    const parsed = parseDartCorpCodeXmlDetailed(xmlText);
    const rows = parsed.rows;
    const parseStatus = rows.length > 0 ? 'OK' : 'EMPTY';
    if (parsed.totalListCount === 0 || rows.length === 0) throw new Error('DART_CORPCODE_LIST_EMPTY');
    let cache: DartCorpCodeMasterCacheFile;
    try {
      cache = saveDartCorpCodeMasterCache({
        version: 1,
        loaded: rows.length > 0,
        source: rows.length > 0 ? 'DART_CORPCODE_XML' : 'NONE',
        loadedAt: nowIso(options.now),
        ttlHours,
        corpCodeCacheCount: parsed.totalListCount,
        listedStockCodeCount: parsed.listedStockCodeCount,
        selectedXmlEntry: extracted.selectedXmlEntry,
        zipEntries: extracted.zipEntries.slice(0, 10),
        zipOpenStatus: 'OK',
        requestUrlHost: requestUrlHost(),
        contentType: fetched.contentType ?? null,
        contentLength: fetched.contentLength ?? fetched.body.length,
        firstBytesHex: firstBytesHex(fetched.body),
        firstBytesAscii: firstBytesAscii(fetched.body),
        responsePreview: null,
        rows,
        lastError: null,
        lastHttpStatus: fetched.httpStatus ?? null,
      }, { cacheFile });
    } catch (saveError) {
      const previous = loadCacheFile(cacheFile);
      const fallback = {
        ...previous,
        ...lastDiagnostics,
        zipOpenStatus: lastDiagnostics.zipOpenStatus ?? 'OK',
        lastError: `DART_CORPCODE_CACHE_WRITE_FAILED:${sanitizeError(saveError)}`,
        lastHttpStatus: fetched.httpStatus ?? null,
      };
      return {
        ...buildStatus(fallback, { now: options.now }),
        downloaded: true,
        parseStatus,
        refreshed: false,
        reason: 'DART_CORPCODE_CACHE_WRITE_FAILED',
        cacheFile,
      };
    }
    return {
      ...buildStatus(cache, { now: options.now }),
      downloaded: true,
      parseStatus,
      refreshed: true,
      reason: 'OK',
      cacheFile,
    };
  } catch (error) {
    const reason = classifyCorpCodeRefreshError(error);
    const previous = loadCacheFile(cacheFile);
    const cache = saveDartCorpCodeMasterCache({
      ...previous,
      ...lastDiagnostics,
      zipOpenStatus: reason === 'DART_CORPCODE_RESPONSE_NOT_ZIP' || reason === 'DART_CORPCODE_ZIP_OPEN_FAILED'
        ? 'FAILED'
        : lastDiagnostics.zipOpenStatus ?? 'NOT_ATTEMPTED',
      lastError: reason,
      lastHttpStatus: lastDiagnostics.lastHttpStatus ?? errorHttpStatus(error),
    }, { cacheFile });
    return {
      ...buildStatus(cache, { now: options.now }),
      downloaded: false,
      parseStatus: 'FAILED',
      refreshed: false,
      reason,
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
