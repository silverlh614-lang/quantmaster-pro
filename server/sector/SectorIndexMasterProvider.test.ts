import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractMstFromZipBuffer, loadKisOfficialSectorIndexMaster, parseIdxCodeMasterText } from './SectorIndexMasterProvider.js';

function storedZip(fileName: string, content: string): Buffer {
  const name = Buffer.from(fileName, 'utf8');
  const data = Buffer.from(content, 'utf8');
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt32LE(0, 10);
  header.writeUInt32LE(0, 14);
  header.writeUInt32LE(data.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, name, data]);
}

describe('SectorIndexMasterProvider', () => {
  it('parses KIS idxcode.mst style rows into official sector master rows', () => {
    const rows = parseIdxCodeMasterText([
      '1 0001 KOSPI',
      '1 0021 finance',
      '2 1001 KOSDAQ',
    ].join('\n'));

    expect(rows).toHaveLength(3);
    expect(rows[1]).toMatchObject({
      officialIndexCode: '0021',
      officialIndexName: 'finance',
      normalizedSectorName: 'finance',
      sourceTier: 'OFFICIAL_KIS_SECTOR_INDEX',
      unsafeAlias: false,
    });
  });

  it('loads idxcode.mst from zip and reports executionImpact NONE', async () => {
    const zip = storedZip('idxcode.mst', '1 0001 KOSPI\n1 0021 finance\n');
    const result = await loadKisOfficialSectorIndexMaster({
      cacheFile: 'NUL',
      fetchZip: async () => zip,
      writeCache: false,
      now: () => new Date('2026-05-23T00:00:00.000Z'),
    });

    expect(extractMstFromZipBuffer(zip).toString('utf8')).toContain('0021');
    expect(result.masterLoaded).toBe(true);
    expect(result.masterRowCount).toBe(2);
    expect(result.idxcodeMstDownloaded).toBe(true);
    expect(result.parseStatus).toBe('OK');
    expect(result.rawSampleRows?.[1]).toMatchObject({
      idxCode: '0021',
      idxName: 'finance',
      normalizedIdxName: 'finance',
    });
    expect(result.reasonCodes).toContain('OFFICIAL_INDEX_MASTER_PARSE_OK');
    expect(result.providerIssue).toBe(false);
    expect(result.marketSignal).toBe(false);
    expect(result.executionImpact).toBe('NONE');
  });

  it('falls back to cache when idxcode.mst download fails', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sector-index-master-'));
    const cacheFile = path.join(dir, 'idxcode.mst');
    fs.writeFileSync(cacheFile, '1 0021 금융업\n', 'utf8');

    const result = await loadKisOfficialSectorIndexMaster({
      cacheFile,
      fetchZip: async () => { throw new Error('network down'); },
      writeCache: false,
      now: () => new Date('2026-05-23T00:00:00.000Z'),
    });

    expect(result.masterLoaded).toBe(true);
    expect(result.cacheFallbackUsed).toBe(true);
    expect(result.parseStatus).toBe('OK');
    expect(result.reasonCodes).toContain('CACHE_FALLBACK_USED');
    expect(result.executionImpact).toBe('NONE');
  });

  it('keeps provider failure diagnostic-only when download and cache both fail', async () => {
    const result = await loadKisOfficialSectorIndexMaster({
      cacheFile: path.join(os.tmpdir(), `missing-${Date.now()}-idxcode.mst`),
      fetchZip: async () => { throw new Error('network down'); },
      writeCache: false,
      now: () => new Date('2026-05-23T00:00:00.000Z'),
    });

    expect(result.masterLoaded).toBe(false);
    expect(result.parseStatus).toBe('FAILED');
    expect(result.masterRowCount).toBe(0);
    expect(result.providerIssue).toBe(true);
    expect(result.marketSignal).toBe(false);
    expect(result.executionImpact).toBe('NONE');
  });
});
