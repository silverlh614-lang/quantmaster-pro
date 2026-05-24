import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ensureDartCorpCodeMasterCache,
  extractXmlFromZipBuffer,
  getDartCorpCodeCacheStatus,
  parseDartCorpCodeXml,
  refreshDartCorpCodeMasterCache,
  resolveDartCorpCodeFromCache,
} from './dartCorpCodeMasterCache.js';

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

const sampleXml = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<result>',
  '<list><corp_code>00126380</corp_code><corp_name>Samsung Electronics</corp_name><stock_code>005930</stock_code><modify_date>20240101</modify_date></list>',
  '<list><corp_code>00164779</corp_code><corp_name>SK hynix</corp_name><stock_code>000660</stock_code><modify_date>20240102</modify_date></list>',
  '<list><corp_code>00999999</corp_code><corp_name>Unlisted</corp_name><stock_code></stock_code><modify_date>20240103</modify_date></list>',
  '</result>',
].join('');

describe('DART corpCode master cache', () => {
  it('parses corpCode.xml listed stock rows', () => {
    const rows = parseDartCorpCodeXml(sampleXml);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      stockCode: '000660',
      corpCode: '00164779',
    });
  });

  it('loads corpCode.xml from zip into a persistent resolver cache', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dart-corpcode-'));
    const cacheFile = path.join(dir, 'corpcode.json');
    const zip = storedZip('CORPCODE.xml', sampleXml);

    const result = await refreshDartCorpCodeMasterCache({
      apiKey: 'DUMMY',
      cacheFile,
      fetchZip: async () => zip,
      now: new Date('2026-05-24T00:00:00.000Z'),
    });

    expect(extractXmlFromZipBuffer(zip).toString('utf8')).toContain('00126380');
    expect(result.refreshed).toBe(true);
    expect(result.corpCodeCacheLoaded).toBe(true);
    expect(result.corpCodeCacheCount).toBe(2);
    expect(result.executionImpact).toBe('NONE');

    expect(resolveDartCorpCodeFromCache('5930', { cacheFile })).toMatchObject({
      status: 'FOUND',
      symbol: '005930',
      corpCode: '00126380',
      executionImpact: 'NONE',
    });
    expect(resolveDartCorpCodeFromCache('011210', { cacheFile })).toMatchObject({
      status: 'NOT_FOUND',
      reason: 'DART_CORP_CODE_NOT_FOUND',
    });
  });

  it('uses existing cache in ensure path and reports sample mappings', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dart-corpcode-ready-'));
    const cacheFile = path.join(dir, 'corpcode.json');
    await refreshDartCorpCodeMasterCache({
      apiKey: 'DUMMY',
      cacheFile,
      fetchZip: async () => storedZip('CORPCODE.xml', sampleXml),
      now: new Date('2026-05-24T00:00:00.000Z'),
    });

    const ensured = await ensureDartCorpCodeMasterCache({
      apiKey: 'DUMMY',
      cacheFile,
      fetchZip: async () => { throw new Error('should not fetch fresh cache'); },
      now: new Date('2026-05-24T01:00:00.000Z'),
    });
    const status = getDartCorpCodeCacheStatus({ cacheFile, sampleSymbols: ['005930', '011210'] });

    expect(ensured.reason).toBe('CACHE_READY');
    expect(status.sampleMappings.join('|')).toContain('005930');
    expect(status.missingSampleSymbols).toEqual(['011210']);
    expect(status.executionImpact).toBe('NONE');
  });

  it('keeps cache failure diagnostic-only when API key is missing', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dart-corpcode-missing-key-'));
    const cacheFile = path.join(dir, 'corpcode.json');

    const result = await refreshDartCorpCodeMasterCache({
      apiKey: null,
      cacheFile,
      now: new Date('2026-05-24T00:00:00.000Z'),
    });

    expect(result.refreshed).toBe(false);
    expect(result.reason).toBe('DART_API_KEY_MISSING');
    expect(result.corpCodeCacheLoaded).toBe(false);
    expect(result.executionImpact).toBe('NONE');
  });
});
