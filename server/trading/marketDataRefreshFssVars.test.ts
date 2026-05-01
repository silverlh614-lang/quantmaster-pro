// @responsibility computeFssVars 회귀 테스트 — ADR-0136 STALE/MISSING 시 passiveActiveBoth=null.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

async function loadModules() {
  const refresh = await import('./marketDataRefresh.js');
  const fss = await import('../persistence/fssRepo.js');
  return { refresh, fss };
}

describe('computeFssVars (ADR-0136)', () => {
  let tmpDir: string;
  const originalDataDir = process.env.PERSIST_DATA_DIR;
  const originalDisableEnv = process.env.FSS_STATUS_DIAGNOSTIC_DISABLED;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fss-vars-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    delete process.env.FSS_STATUS_DIAGNOSTIC_DISABLED;
    vi.resetModules();
  });

  afterEach(() => {
    if (originalDataDir === undefined) delete process.env.PERSIST_DATA_DIR;
    else process.env.PERSIST_DATA_DIR = originalDataDir;
    if (originalDisableEnv === undefined) delete process.env.FSS_STATUS_DIAGNOSTIC_DISABLED;
    else process.env.FSS_STATUS_DIAGNOSTIC_DISABLED = originalDisableEnv;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('MISSING: 영속 부재 시 passiveActiveBoth=null + fssRecordsAge.status=MISSING', async () => {
    const { refresh } = await loadModules();
    const result = refresh.computeFssVars(new Date('2026-05-01T03:00:00Z'));
    expect(result.passiveActiveBoth).toBeNull();
    expect(result.fssRecordsAge.status).toBe('MISSING');
    expect(result.foreignNetBuy5d).toBe(0);
    expect(result.foreignContinuousBuyDays).toBe(0);
    expect(result.foreignContinuousSellDays).toBe(0);
  });

  it('STALE: 5일 전 레코드 시 passiveActiveBoth=null + status=STALE', async () => {
    const { refresh, fss } = await loadModules();
    fss.saveFssRecords([
      { date: '2026-04-26', passiveNetBuy: 100, activeNetBuy: 50 },
    ]);
    const result = refresh.computeFssVars(new Date('2026-05-01T03:00:00Z'));
    expect(result.passiveActiveBoth).toBeNull();
    expect(result.fssRecordsAge.status).toBe('STALE');
    expect(result.fssRecordsAge.ageDays).toBe(5);
  });

  it('OK + 표본 < 3 시 passiveActiveBoth=null (통계 신뢰도 부족)', async () => {
    const { refresh, fss } = await loadModules();
    // 1일치만 — OK 신선도이지만 last5 표본 < 3
    fss.saveFssRecords([
      { date: '2026-05-01', passiveNetBuy: 100, activeNetBuy: 50 },
    ]);
    const result = refresh.computeFssVars(new Date('2026-05-01T03:00:00Z'));
    expect(result.passiveActiveBoth).toBeNull();
    expect(result.fssRecordsAge.status).toBe('OK');
  });

  it('OK + 표본 ≥ 3 + 모두 양수 시 passiveActiveBoth=true', async () => {
    const { refresh, fss } = await loadModules();
    fss.saveFssRecords([
      { date: '2026-04-29', passiveNetBuy: 100, activeNetBuy: 50 },
      { date: '2026-04-30', passiveNetBuy: 80, activeNetBuy: 30 },
      { date: '2026-05-01', passiveNetBuy: 60, activeNetBuy: 20 },
    ]);
    const result = refresh.computeFssVars(new Date('2026-05-01T03:00:00Z'));
    expect(result.passiveActiveBoth).toBe(true);
    expect(result.fssRecordsAge.status).toBe('OK');
    expect(result.foreignNetBuy5d).toBe(340);
  });

  it('OK + 표본 ≥ 3 + 한 항목이라도 0 또는 음수 시 passiveActiveBoth=false', async () => {
    const { refresh, fss } = await loadModules();
    fss.saveFssRecords([
      { date: '2026-04-29', passiveNetBuy: 100, activeNetBuy: 50 },
      { date: '2026-04-30', passiveNetBuy: 80, activeNetBuy: -10 },  // active 음수
      { date: '2026-05-01', passiveNetBuy: 60, activeNetBuy: 20 },
    ]);
    const result = refresh.computeFssVars(new Date('2026-05-01T03:00:00Z'));
    expect(result.passiveActiveBoth).toBe(false);
    expect(result.fssRecordsAge.status).toBe('OK');
  });

  it('boundary — 정확히 3일 전 + 표본 3건 OK / passiveActiveBoth 평가', async () => {
    const { refresh, fss } = await loadModules();
    // 3일 전 = 4-28 still OK
    fss.saveFssRecords([
      { date: '2026-04-26', passiveNetBuy: 100, activeNetBuy: 50 },
      { date: '2026-04-27', passiveNetBuy: 80, activeNetBuy: 30 },
      { date: '2026-04-28', passiveNetBuy: 60, activeNetBuy: 20 },
    ]);
    const result = refresh.computeFssVars(new Date('2026-05-01T03:00:00Z'));
    expect(result.fssRecordsAge.status).toBe('OK');
    expect(result.fssRecordsAge.ageDays).toBe(3);
    expect(result.passiveActiveBoth).toBe(true);
  });

  it('ENV 우회 — FSS_STATUS_DIAGNOSTIC_DISABLED=true 시 STALE 도 false fallback (회귀 안전망)', async () => {
    process.env.FSS_STATUS_DIAGNOSTIC_DISABLED = 'true';
    const { refresh, fss } = await loadModules();
    fss.saveFssRecords([
      { date: '2026-04-26', passiveNetBuy: 100, activeNetBuy: 50 },  // 5일 전
    ]);
    const result = refresh.computeFssVars(new Date('2026-05-01T03:00:00Z'));
    expect(result.passiveActiveBoth).toBe(false);  // null 이 아니라 false (기존 동작 복원)
    expect(result.fssRecordsAge.status).toBe('STALE');  // 진단 정보는 그대로 노출
  });

  it('fssRecordsAge 진단은 항상 영속 (MISSING 포함)', async () => {
    const { refresh } = await loadModules();
    const result = refresh.computeFssVars(new Date('2026-05-01T03:00:00Z'));
    expect(result.fssRecordsAge).toBeDefined();
    expect(result.fssRecordsAge.status).toBe('MISSING');
    expect(result.fssRecordsAge.recordCount).toBe(0);
  });
});
