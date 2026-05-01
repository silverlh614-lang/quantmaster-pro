// @responsibility fssDetailRepo 회귀 테스트 — ADR-0141 Stage 1.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

async function loadModule() {
  return import('./fssDetailRepo.js');
}

describe('fssDetailRepo (ADR-0141 Stage 1)', () => {
  let tmpDir: string;
  const originalDataDir = process.env.PERSIST_DATA_DIR;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fss-detail-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    vi.resetModules();
  });

  afterEach(() => {
    if (originalDataDir === undefined) delete process.env.PERSIST_DATA_DIR;
    else process.env.PERSIST_DATA_DIR = originalDataDir;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('loadFssDetailRecords — 파일 부재 시 빈 배열', async () => {
    const { loadFssDetailRecords } = await loadModule();
    expect(loadFssDetailRecords()).toEqual([]);
  });

  it('loadFssDetailRecords — 손상 JSON fallback', async () => {
    const { loadFssDetailRecords } = await loadModule();
    const { FSS_DETAIL_FILE, ensureDataDir } = await import('./paths.js');
    ensureDataDir();
    fs.writeFileSync(FSS_DETAIL_FILE, 'INVALID{');
    expect(loadFssDetailRecords()).toEqual([]);
  });

  it('appendFssDetailRecord — 정상 영속 + round-trip + raw 카테고리 보존', async () => {
    const { appendFssDetailRecord, loadFssDetailRecords } = await loadModule();
    appendFssDetailRecord({
      date: '2026-04-29',
      rows: [
        { category: '외국인', netBuyQty: 100000, netBuyKrw: 5_000_000_000 },
        { category: '금융투자', netBuyQty: -50000, netBuyKrw: -2_500_000_000 },
      ],
      fetchedAt: '2026-04-29T07:00:00.000Z',
    });
    const records = loadFssDetailRecords();
    expect(records).toHaveLength(1);
    expect(records[0].rows).toHaveLength(2);
    expect(records[0].rows[0].category).toBe('외국인');
    expect(records[0].rows[1].netBuyKrw).toBe(-2_500_000_000);
  });

  it('appendFssDetailRecord — 같은 date 중복 → 마지막 덮어쓰기', async () => {
    const { appendFssDetailRecord, loadFssDetailRecords } = await loadModule();
    appendFssDetailRecord({
      date: '2026-04-29',
      rows: [{ category: 'A', netBuyQty: 100, netBuyKrw: 1_000_000 }],
      fetchedAt: '2026-04-29T01:00:00.000Z',
    });
    appendFssDetailRecord({
      date: '2026-04-29',
      rows: [{ category: 'B', netBuyQty: 200, netBuyKrw: 2_000_000 }],
      fetchedAt: '2026-04-29T07:00:00.000Z',
    });
    const records = loadFssDetailRecords();
    expect(records).toHaveLength(1);
    expect(records[0].rows[0].category).toBe('B');
  });

  it('appendFssDetailRecord — 잘못된 date silent skip', async () => {
    const { appendFssDetailRecord, loadFssDetailRecords } = await loadModule();
    appendFssDetailRecord({ date: 'invalid', rows: [], fetchedAt: '2026-04-29T07:00:00.000Z' });
    expect(loadFssDetailRecords()).toEqual([]);
  });

  it('appendFssDetailRecord — rows 비배열 silent skip', async () => {
    const { appendFssDetailRecord, loadFssDetailRecords } = await loadModule();
    // @ts-expect-error invalid input on purpose
    appendFssDetailRecord({ date: '2026-04-29', rows: 'not-array', fetchedAt: 'x' });
    expect(loadFssDetailRecords()).toEqual([]);
  });

  it('appendFssDetailRecord — 30 record 초과 시 FIFO trim', async () => {
    const { appendFssDetailRecord, loadFssDetailRecords, FSS_DETAIL_MAX_ROWS } = await loadModule();
    expect(FSS_DETAIL_MAX_ROWS).toBe(30);
    for (let i = 1; i <= 35; i++) {
      const dd = String(i).padStart(2, '0');
      appendFssDetailRecord({
        date: `2026-03-${dd}`,
        rows: [{ category: 'X', netBuyQty: i, netBuyKrw: i * 100 }],
        fetchedAt: `2026-03-${dd}T00:00:00.000Z`,
      });
    }
    const records = loadFssDetailRecords();
    expect(records).toHaveLength(30);
    expect(records[0].date).toBe('2026-03-06');  // 03-01 ~ 03-05 trim
  });

  it('appendFssDetailRecord — atomic write tmp 잔존 안 함', async () => {
    const { appendFssDetailRecord } = await loadModule();
    const { FSS_DETAIL_FILE } = await import('./paths.js');
    appendFssDetailRecord({
      date: '2026-04-29',
      rows: [{ category: 'A', netBuyQty: 1, netBuyKrw: 1 }],
      fetchedAt: '2026-04-29T07:00:00.000Z',
    });
    const dir = path.dirname(FSS_DETAIL_FILE);
    const files = fs.readdirSync(dir);
    expect(files.filter((f) => f.includes('.tmp.'))).toEqual([]);
  });

  it('getLatestFssDetailRecord — 부재 시 null', async () => {
    const { getLatestFssDetailRecord } = await loadModule();
    expect(getLatestFssDetailRecord()).toBeNull();
  });

  it('getLatestFssDetailRecord — 가장 최신 일자 반환', async () => {
    const { appendFssDetailRecord, getLatestFssDetailRecord } = await loadModule();
    appendFssDetailRecord({ date: '2026-04-25', rows: [{ category: 'A', netBuyQty: 0, netBuyKrw: 0 }], fetchedAt: '' });
    appendFssDetailRecord({ date: '2026-04-29', rows: [{ category: 'B', netBuyQty: 0, netBuyKrw: 0 }], fetchedAt: '' });
    appendFssDetailRecord({ date: '2026-04-27', rows: [{ category: 'C', netBuyQty: 0, netBuyKrw: 0 }], fetchedAt: '' });
    const latest = getLatestFssDetailRecord();
    expect(latest?.date).toBe('2026-04-29');
    expect(latest?.rows[0].category).toBe('B');
  });

  it('getFssDetailRecord — 일자 매칭 + 부재 시 null', async () => {
    const { appendFssDetailRecord, getFssDetailRecord } = await loadModule();
    appendFssDetailRecord({ date: '2026-04-29', rows: [{ category: 'X', netBuyQty: 0, netBuyKrw: 0 }], fetchedAt: '' });
    expect(getFssDetailRecord('2026-04-29')?.rows[0].category).toBe('X');
    expect(getFssDetailRecord('2026-04-30')).toBeNull();
    expect(getFssDetailRecord('invalid')).toBeNull();
  });
});
