// @responsibility Load and parse official KIS idxcode.mst sector index master with cache fallback.

import fs from 'node:fs';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { DATA_DIR, ensureDataDir } from '../persistence/paths.js';
import {
  buildOfficialSectorVerifyInputCandidates,
  canonicalizeOfficialIndexName,
  normalizeOfficialSectorName,
  type OfficialSectorIndexMasterRow,
} from './SectorIndexCodeMap.js';

export const KIS_OFFICIAL_SECTOR_INDEX_MASTER_URL =
  'https://new.real.download.dws.co.kr/common/master/idxcode.mst.zip';

export const KIS_OFFICIAL_SECTOR_INDEX_MASTER_CACHE_FILE = path.join(
  DATA_DIR,
  'sector-index-master',
  'idxcode.mst',
);

export interface SectorIndexMasterProviderResult {
  masterSource: 'OFFICIAL_KIS_IDXCODE_MST';
  masterLoaded: boolean;
  masterRowCount: number;
  idxcodeMstDownloaded: boolean;
  cacheFallbackUsed: boolean;
  parseStatus: 'OK' | 'FAILED' | 'PARTIAL' | 'NOT_ATTEMPTED';
  rows: OfficialSectorIndexMasterRow[];
  rawSampleRows?: Array<{
    idxDiv?: string;
    idxCode: string;
    idxName: string;
    rawIdxName?: string;
    normalizedIdxName: string;
    canonicalOfficialName?: string;
    codePrefixRemoved?: boolean;
    verifyInputCandidates?: string[];
  }>;
  providerIssue: boolean;
  marketSignal: false;
  executionImpact: 'NONE';
  reasonCodes: string[];
  cacheFile: string;
  fetchedAt: string;
}

export interface LoadKisOfficialSectorIndexMasterOptions {
  url?: string;
  cacheFile?: string;
  fetchZip?: (url: string) => Promise<Buffer>;
  writeCache?: boolean;
  now?: () => Date;
}

function marketFromIdxCode(idxCode: string, idxDiv?: string): OfficialSectorIndexMasterRow['market'] {
  const div = String(idxDiv ?? '').trim();
  if (idxCode === '2001') return 'KOSPI200';
  if (idxCode.startsWith('1') || div === '2' || div.toUpperCase() === 'Q') return 'KOSDAQ';
  if (idxCode.startsWith('2') || div === '3') return 'KOSPI200';
  if (/^\d{4}$/.test(idxCode)) return 'KOSPI';
  return 'UNKNOWN';
}

function toMasterRow(input: {
  idxDiv?: string;
  idxCode: string;
  idxName: string;
}): OfficialSectorIndexMasterRow | null {
  const code = String(input.idxCode ?? '').trim();
  const name = String(input.idxName ?? '').trim();
  if (!/^\d{4}$/.test(code) || !name) return null;
  const canonical = canonicalizeOfficialIndexName(name);
  const idxDiv = input.idxDiv ?? canonical.codePrefix;
  const normalizedSectorName = normalizeOfficialSectorName(name);
  return {
    market: marketFromIdxCode(code, input.idxDiv),
    ...(idxDiv ? { idxDiv } : {}),
    idxCode: code,
    officialIndexCode: code,
    officialIndexName: name,
    normalizedSectorName,
    canonicalOfficialName: canonical.canonicalName,
    codePrefixRemoved: canonical.codePrefixRemoved,
    rawIdxName: name,
    normalizedIdxName: normalizedSectorName,
    rawSectorName: name,
    sourceTier: 'OFFICIAL_KIS_SECTOR_INDEX',
    aliasResolved: false,
    unsafeAlias: false,
    selectedOfficialIndexCode: code,
    verifyInputCandidates: buildOfficialSectorVerifyInputCandidates({ idxDiv, idxCode: code }),
  };
}

function parseDelimitedLine(line: string): OfficialSectorIndexMasterRow | null {
  const pieces = line.split(/[,\t|]/).map((part) => part.trim()).filter(Boolean);
  if (pieces.length < 2) return null;
  const codeIndex = pieces.findIndex((part) => /^\d{4}$/.test(part));
  if (codeIndex < 0) return null;
  return toMasterRow({
    idxDiv: codeIndex > 0 ? pieces[0] : undefined,
    idxCode: pieces[codeIndex],
    idxName: pieces.slice(codeIndex + 1).join(' ') || pieces[codeIndex - 1] || '',
  });
}

function parseFixedWidthLine(line: string): OfficialSectorIndexMasterRow | null {
  const compact = line.trim();
  if (!compact) return null;
  const spaced = compact.match(/^(\S{1,4})\s+(\d{4})\s+(.+)$/);
  if (spaced) {
    return toMasterRow({ idxDiv: spaced[1], idxCode: spaced[2], idxName: spaced[3] });
  }
  const codeMatch = compact.match(/^(.*?)(\d{4})(.{2,})$/);
  if (!codeMatch) return null;
  return toMasterRow({
    idxDiv: codeMatch[1].trim() || undefined,
    idxCode: codeMatch[2],
    idxName: codeMatch[3].trim(),
  });
}

export function parseIdxCodeMasterText(text: string): OfficialSectorIndexMasterRow[] {
  const rows = new Map<string, OfficialSectorIndexMasterRow>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\0/g, '').trim();
    if (!line) continue;
    const parsed = parseDelimitedLine(line) ?? parseFixedWidthLine(line);
    if (!parsed) continue;
    rows.set(`${parsed.sourceTier}:${parsed.officialIndexCode}:${parsed.officialIndexName}`, parsed);
  }
  return Array.from(rows.values());
}

function readUInt16LE(buffer: Buffer, offset: number): number {
  return offset + 2 <= buffer.length ? buffer.readUInt16LE(offset) : 0;
}

function readUInt32LE(buffer: Buffer, offset: number): number {
  return offset + 4 <= buffer.length ? buffer.readUInt32LE(offset) : 0;
}

export function extractMstFromZipBuffer(zipBuffer: Buffer): Buffer {
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
      if (fileName.endsWith('.mst')) return data;
      firstFile ??= data;
    }
    offset = dataEnd;
  }
  if (firstFile) return firstFile;
  throw new Error('idxcode.mst not found in zip archive');
}

async function defaultFetchZip(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`idxcode.mst.zip fetch failed: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function loadCachedMaster(cacheFile: string): string | null {
  try {
    if (!fs.existsSync(cacheFile)) return null;
    return fs.readFileSync(cacheFile, 'utf8');
  } catch {
    return null;
  }
}

function writeCachedMaster(cacheFile: string, content: Buffer): void {
  ensureDataDir();
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  fs.writeFileSync(cacheFile, content);
}

export async function loadKisOfficialSectorIndexMaster(
  options: LoadKisOfficialSectorIndexMasterOptions = {},
): Promise<SectorIndexMasterProviderResult> {
  const now = (options.now ?? (() => new Date()))().toISOString();
  const url = options.url ?? KIS_OFFICIAL_SECTOR_INDEX_MASTER_URL;
  const cacheFile = options.cacheFile ?? KIS_OFFICIAL_SECTOR_INDEX_MASTER_CACHE_FILE;
  const fetchZip = options.fetchZip ?? defaultFetchZip;
  const reasonCodes = new Set<string>();
  let idxText: string | null = null;
  let idxcodeMstDownloaded = false;
  let cacheFallbackUsed = false;
  let parseStatus: SectorIndexMasterProviderResult['parseStatus'] = 'NOT_ATTEMPTED';

  try {
    const zip = await fetchZip(url);
    const mst = extractMstFromZipBuffer(zip);
    if (options.writeCache !== false) writeCachedMaster(cacheFile, mst);
    idxText = new TextDecoder('euc-kr', { fatal: false }).decode(mst);
    if (idxText.includes('\uFFFD')) idxText = mst.toString('utf8');
    idxcodeMstDownloaded = true;
    reasonCodes.add('OFFICIAL_INDEX_MASTER_DOWNLOADED');
  } catch {
    const cached = loadCachedMaster(cacheFile);
    if (cached) {
      idxText = cached;
      cacheFallbackUsed = true;
      reasonCodes.add('OFFICIAL_INDEX_MASTER_CACHE_FALLBACK_USED');
      reasonCodes.add('CACHE_FALLBACK_USED');
    } else {
      parseStatus = 'FAILED';
      reasonCodes.add('OFFICIAL_INDEX_MASTER_FETCH_FAILED');
      reasonCodes.add('OFFICIAL_INDEX_MASTER_CACHE_MISSING');
    }
  }

  let rows: OfficialSectorIndexMasterRow[] = [];
  if (idxText) {
    try {
      rows = parseIdxCodeMasterText(idxText);
      parseStatus = rows.length > 0 ? 'OK' : 'FAILED';
      if (rows.length > 0) {
        reasonCodes.add('OFFICIAL_INDEX_MASTER_LOADED');
        reasonCodes.add('OFFICIAL_INDEX_MASTER_PARSE_OK');
      } else {
        reasonCodes.add('OFFICIAL_INDEX_MASTER_PARSE_EMPTY');
        reasonCodes.add('PARSE_EMPTY');
      }
    } catch {
      parseStatus = 'FAILED';
      reasonCodes.add('OFFICIAL_INDEX_MASTER_PARSE_FAILED');
    }
  }

  const masterLoaded = rows.length > 0;
  return {
    masterSource: 'OFFICIAL_KIS_IDXCODE_MST',
    masterLoaded,
    masterRowCount: rows.length,
    idxcodeMstDownloaded,
    cacheFallbackUsed,
    parseStatus,
    rows,
    rawSampleRows: rows.slice(0, 8).map((row) => ({
      ...(row.idxDiv ? { idxDiv: row.idxDiv } : {}),
      idxCode: row.officialIndexCode,
      idxName: row.officialIndexName,
      rawIdxName: row.rawSectorName,
      normalizedIdxName: row.normalizedSectorName,
      canonicalOfficialName: row.canonicalOfficialName ?? canonicalizeOfficialIndexName(row.officialIndexName).canonicalName,
      codePrefixRemoved: row.codePrefixRemoved ?? canonicalizeOfficialIndexName(row.officialIndexName).codePrefixRemoved,
      verifyInputCandidates: row.verifyInputCandidates,
    })),
    providerIssue: !masterLoaded,
    marketSignal: false,
    executionImpact: 'NONE',
    reasonCodes: Array.from(reasonCodes),
    cacheFile,
    fetchedAt: now,
  };
}
