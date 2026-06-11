// @responsibility ADR-0601 D4 종목 마스터 파서·일캐시 로더 회귀 (고정폭 tail·캐시 fallback·메모이즈).
import { deflateRawSync } from 'node:zlib';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  __resetStockSectorCodeMasterMemoForTest,
  loadStockSectorCodeMaster,
  parseStockMasterBuffer,
} from './StockSectorCodeMasterProvider.js';

function masterLine(symbol: string, medium: string, tailBytes: number): Buffer {
  const head = Buffer.from(symbol.padEnd(9, ' ') + 'KR7000000000'.padEnd(12, ' ') + '테스트종목', 'utf8');
  const tail = Buffer.from(
    ('ST' + '1' + '1234' + medium.padStart(4, '0') + '5678').padEnd(tailBytes, ' '),
    'latin1',
  );
  return Buffer.concat([head, tail, Buffer.from('\n')]);
}

function makeZip(name: string, content: Buffer): Buffer {
  const compressed = deflateRawSync(content);
  const nameBuffer = Buffer.from(name, 'utf8');
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(8, 8);
  header.writeUInt32LE(compressed.length, 18);
  header.writeUInt32LE(content.length, 22);
  header.writeUInt16LE(nameBuffer.length, 26);
  return Buffer.concat([header, nameBuffer, compressed]);
}

describe('parseStockMasterBuffer', () => {
  it('KOSDAQ(222B tail) 고정폭에서 단축코드+업종 대/중/소 코드를 추출한다 (한글 디코딩 불필요)', () => {
    const buffer = Buffer.concat([
      masterLine('084370', '1006', 222),
      masterLine('035720', '0021', 222),
      masterLine('A0054', '0021', 222), // 6자리 미만 단축코드 → skip (SPAC/비표준)
      Buffer.from('short\n'),
    ]);
    const rows = parseStockMasterBuffer(buffer, 'KOSDAQ');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ symbol: '084370', market: 'KOSDAQ', sectorLargeCode: '1234', sectorMediumCode: '1006' });
    expect(rows[1]).toMatchObject({ symbol: '035720', sectorMediumCode: '0021' });
  });

  it('KOSPI(228B tail) 동일 오프셋 파싱', () => {
    const rows = parseStockMasterBuffer(masterLine('005930', '4003', 228), 'KOSPI');
    expect(rows[0]).toMatchObject({ symbol: '005930', market: 'KOSPI', sectorMediumCode: '4003', sectorSmallCode: '5678' });
  });
});

describe('loadStockSectorCodeMaster', () => {
  afterEach(() => { __resetStockSectorCodeMasterMemoForTest(); });

  it('다운로드→파싱→일자 메모이즈 (재호출 fetch 0) + 실패 시장 캐시 fallback', async () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sector-master-'));
    let fetches = 0;
    const fetchZip = async (url: string): Promise<Buffer> => {
      fetches += 1;
      if (url.includes('kospi')) return makeZip('kospi_code.mst', masterLine('005930', '4003', 228));
      return makeZip('kosdaq_code.mst', masterLine('084370', '1006', 222));
    };
    const first = await loadStockSectorCodeMaster({ cacheDir, fetchZip });
    expect(first).toMatchObject({ loaded: true, rowCount: 2, parseStatus: 'OK', kospiRows: 1, kosdaqRows: 1 });
    expect(first.bySymbol.get('084370')?.sectorMediumCode).toBe('1006');
    const second = await loadStockSectorCodeMaster({ cacheDir, fetchZip });
    expect(fetches).toBe(2);
    expect(second.rowCount).toBe(2);

    __resetStockSectorCodeMasterMemoForTest();
    const failing = await loadStockSectorCodeMaster({
      cacheDir,
      fetchZip: async () => { throw new Error('NETWORK_DOWN'); },
    });
    expect(failing).toMatchObject({ loaded: true, parseStatus: 'OK' });
    expect(failing.cacheFallbackMarkets.sort()).toEqual(['KOSDAQ', 'KOSPI']);
  });

  it('다운로드·캐시 모두 실패 → loaded=false·providerIssue (결손 ≠ 신호, 소비처 missing 유지)', async () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sector-master-empty-'));
    const result = await loadStockSectorCodeMaster({
      cacheDir,
      fetchZip: async () => { throw new Error('NETWORK_DOWN'); },
    });
    expect(result).toMatchObject({ loaded: false, parseStatus: 'FAILED', providerIssue: true });
  });
});
