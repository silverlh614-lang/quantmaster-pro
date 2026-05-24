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

function storedZipWithCentralDirectorySizeOnly(fileName: string, content: string): Buffer {
  const name = Buffer.from(fileName, 'utf8');
  const data = Buffer.from(content, 'utf8');
  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(0, 6);
  localHeader.writeUInt16LE(0, 8);
  localHeader.writeUInt32LE(0, 10);
  localHeader.writeUInt32LE(0, 14);
  localHeader.writeUInt32LE(0, 18);
  localHeader.writeUInt32LE(0, 22);
  localHeader.writeUInt16LE(name.length, 26);
  localHeader.writeUInt16LE(0, 28);
  const local = Buffer.concat([localHeader, name, data]);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(0, 10);
  central.writeUInt32LE(0, 12);
  central.writeUInt32LE(0, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt16LE(0, 30);
  central.writeUInt16LE(0, 32);
  central.writeUInt16LE(0, 34);
  central.writeUInt16LE(0, 36);
  central.writeUInt32LE(0, 38);
  central.writeUInt32LE(0, 42);
  const centralDirectory = Buffer.concat([central, name]);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(local.length, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([local, centralDirectory, eocd]);
}

const sampleXml = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<result>',
  '<list><corp_code>00126380</corp_code><corp_name>Samsung Electronics</corp_name><corp_eng_name>Samsung Electronics</corp_eng_name><stock_code>005930</stock_code><modify_date>20240101</modify_date></list>',
  '<list><corp_code>00164779</corp_code><corp_name>SK hynix</corp_name><corp_eng_name>SK hynix</corp_eng_name><stock_code>000660</stock_code><modify_date>20240102</modify_date></list>',
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
    expect(result.corpCodeCacheCount).toBe(3);
    expect(result.listedStockCodeCount).toBe(2);
    expect(result.selectedXmlEntry).toBe('CORPCODE.xml');
    expect(result.zipOpenStatus).toBe('OK');
    expect(result.zipEntries).toContain('CORPCODE.xml');
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

  it('discovers CORPCODE.xml through the central directory when local sizes are zero', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dart-corpcode-central-'));
    const cacheFile = path.join(dir, 'corpcode.json');
    const zip = storedZipWithCentralDirectorySizeOnly('CORPCODE.xml', sampleXml);

    const result = await refreshDartCorpCodeMasterCache({
      apiKey: 'DUMMY',
      cacheFile,
      fetchZip: async () => ({
        body: zip,
        httpStatus: 200,
        contentType: 'application/zip',
        contentLength: zip.length,
      }),
      now: new Date('2026-05-24T00:00:00.000Z'),
    });

    expect(extractXmlFromZipBuffer(zip).toString('utf8')).toContain('00126380');
    expect(result.refreshed).toBe(true);
    expect(result.reason).toBe('OK');
    expect(result.zipOpenStatus).toBe('OK');
    expect(result.selectedXmlEntry).toBe('CORPCODE.xml');
    expect(result.requestUrlHost).toBe('opendart.fss.or.kr');
    expect(result.httpStatus).toBe(200);
    expect(result.firstBytesAscii).toContain('PK');
  });

  it('reports non-zip OpenDART responses without exposing credentials', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dart-corpcode-nonzip-'));
    const cacheFile = path.join(dir, 'corpcode.json');

    const result = await refreshDartCorpCodeMasterCache({
      apiKey: 'DUMMY',
      cacheFile,
      fetchZip: async () => ({
        body: Buffer.from('{"status":"013","message":"invalid crtfc_key=SECRET"}', 'utf8'),
        httpStatus: 200,
        contentType: 'application/json',
      }),
      now: new Date('2026-05-24T00:00:00.000Z'),
    });

    expect(result.refreshed).toBe(false);
    expect(result.reason).toBe('DART_CORPCODE_RESPONSE_NOT_ZIP');
    expect(result.zipOpenStatus).toBe('FAILED');
    expect(result.responsePreview).toContain('crtfc_key=<masked>');
    expect(result.responsePreview).not.toContain('SECRET');
    expect(result.executionImpact).toBe('NONE');
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
