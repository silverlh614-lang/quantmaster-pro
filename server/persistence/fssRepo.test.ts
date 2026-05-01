// @responsibility fssRepo 회귀 테스트 — ADR-0136 getFssRecordsAge 신선도 분류 SSOT.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

async function loadModule() {
  return import('./fssRepo.js');
}

describe('fssRepo (ADR-0136)', () => {
  let tmpDir: string;
  const originalDataDir = process.env.PERSIST_DATA_DIR;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fss-repo-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    vi.resetModules();
  });

  afterEach(() => {
    if (originalDataDir === undefined) {
      delete process.env.PERSIST_DATA_DIR;
    } else {
      process.env.PERSIST_DATA_DIR = originalDataDir;
    }
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  describe('getFssRecordsAge', () => {
    it('파일 부재 시 MISSING / latestDate=null / ageDays=null / recordCount=0', async () => {
      const { getFssRecordsAge } = await loadModule();
      const info = getFssRecordsAge(new Date('2026-05-01T00:00:00Z'));
      expect(info.status).toBe('MISSING');
      expect(info.latestDate).toBeNull();
      expect(info.ageDays).toBeNull();
      expect(info.recordCount).toBe(0);
    });

    it('빈 배열 영속 시 MISSING (파일 부재와 동일 의미)', async () => {
      const { saveFssRecords, getFssRecordsAge } = await loadModule();
      saveFssRecords([]);
      const info = getFssRecordsAge(new Date('2026-05-01T00:00:00Z'));
      expect(info.status).toBe('MISSING');
      expect(info.recordCount).toBe(0);
    });

    it('오늘 레코드 시 OK / ageDays=0', async () => {
      const { saveFssRecords, getFssRecordsAge } = await loadModule();
      saveFssRecords([{ date: '2026-05-01', passiveNetBuy: 100, activeNetBuy: 50 }]);
      // KST 자정 기준 오늘 2026-05-01 ↔ now=2026-05-01T03:00Z (KST 12:00) ageDays=0
      const info = getFssRecordsAge(new Date('2026-05-01T03:00:00Z'));
      expect(info.status).toBe('OK');
      expect(info.latestDate).toBe('2026-05-01');
      expect(info.ageDays).toBe(0);
      expect(info.recordCount).toBe(1);
    });

    it('1일 전 레코드 시 OK / ageDays=1', async () => {
      const { saveFssRecords, getFssRecordsAge } = await loadModule();
      saveFssRecords([{ date: '2026-04-30', passiveNetBuy: 100, activeNetBuy: 50 }]);
      const info = getFssRecordsAge(new Date('2026-05-01T03:00:00Z'));
      expect(info.status).toBe('OK');
      expect(info.ageDays).toBe(1);
    });

    it('boundary — 3일 전 OK / 4일 전 STALE', async () => {
      const { saveFssRecords, getFssRecordsAge } = await loadModule();
      // 3일 전 (2026-04-28) → OK
      saveFssRecords([{ date: '2026-04-28', passiveNetBuy: 100, activeNetBuy: 50 }]);
      let info = getFssRecordsAge(new Date('2026-05-01T03:00:00Z'));
      expect(info.status).toBe('OK');
      expect(info.ageDays).toBe(3);

      // 4일 전 (2026-04-27) → STALE
      saveFssRecords([{ date: '2026-04-27', passiveNetBuy: 100, activeNetBuy: 50 }]);
      info = getFssRecordsAge(new Date('2026-05-01T03:00:00Z'));
      expect(info.status).toBe('STALE');
      expect(info.ageDays).toBe(4);
    });

    it('STALE — 10일 전 레코드 + recordCount 보존', async () => {
      const { saveFssRecords, getFssRecordsAge } = await loadModule();
      saveFssRecords([
        { date: '2026-04-21', passiveNetBuy: 100, activeNetBuy: 50 },
        { date: '2026-04-20', passiveNetBuy: 80, activeNetBuy: 30 },
      ]);
      const info = getFssRecordsAge(new Date('2026-05-01T03:00:00Z'));
      expect(info.status).toBe('STALE');
      expect(info.ageDays).toBe(10);
      expect(info.recordCount).toBe(2);
      expect(info.latestDate).toBe('2026-04-21');
    });

    it('잘못된 latestDate 형식 → MISSING 안전 fallback', async () => {
      const { getFssRecordsAge } = await loadModule();
      // 직접 잘못된 JSON 영속 (검증 우회)
      const fssRepo = await loadModule();
      // FSS_RECORDS_FILE 위치에 잘못된 date 영속
      const malformed = [{ date: 'not-a-date', passiveNetBuy: 100, activeNetBuy: 50 }];
      // saveFssRecords 가 sort 후 trim 하므로 직접 fs.writeFileSync 사용
      const { FSS_RECORDS_FILE } = await import('./paths.js');
      fs.writeFileSync(FSS_RECORDS_FILE, JSON.stringify(malformed));
      const info = fssRepo.getFssRecordsAge(new Date('2026-05-01T03:00:00Z'));
      expect(info.status).toBe('MISSING');
      expect(info.latestDate).toBeNull();
      expect(info.ageDays).toBeNull();
      // recordCount 는 영속 레코드 갯수 그대로 (1)
      expect(info.recordCount).toBe(1);
    });

    it('FSS_STALE_THRESHOLD_DAYS 상수 SSOT = 4', async () => {
      const { FSS_STALE_THRESHOLD_DAYS } = await loadModule();
      expect(FSS_STALE_THRESHOLD_DAYS).toBe(4);
    });
  });
});
