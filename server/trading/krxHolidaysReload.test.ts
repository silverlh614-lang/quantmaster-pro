/**
 * @responsibility krxHolidays.reloadKrxHolidaySet 회귀 테스트 — patch 통합 검증 (ADR-0045 PR-D)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('krxHolidays — patch reload 통합', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'krx-holidays-reload-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  it('reload 전: STATIC_HOLIDAYS 만 반영 (어린이날 5/5 true, 2028-01-01 false)', async () => {
    const { isKrxHoliday } = await import('./krxHolidays.js');
    expect(isKrxHoliday('2026-05-05')).toBe(true);
    expect(isKrxHoliday('2028-01-01')).toBe(false);
  });

  it('reload 후 patch 항목이 활성 Set 에 추가됨', async () => {
    const { appendKrxHolidayPatch } = await import('../persistence/krxHolidayRepo.js');
    appendKrxHolidayPatch([
      { date: '2028-01-01', reason: '신정', addedAt: 'A', addedBy: 'manual' },
      { date: '2028-12-25', reason: '성탄절', addedAt: 'A', addedBy: 'manual' },
    ]);

    const { isKrxHoliday, reloadKrxHolidaySet, KRX_HOLIDAYS } = await import('./krxHolidays.js');
    expect(isKrxHoliday('2028-01-01')).toBe(false); // reload 전
    reloadKrxHolidaySet();
    expect(isKrxHoliday('2028-01-01')).toBe(true);
    expect(isKrxHoliday('2028-12-25')).toBe(true);
    // KRX_HOLIDAYS 인스턴스도 동일 갱신 (호출자 import 호환)
    expect(KRX_HOLIDAYS.has('2028-01-01')).toBe(true);
  });

  it('STATIC_HOLIDAYS 항목은 reload 후에도 보존', async () => {
    const { reloadKrxHolidaySet, isKrxHoliday } = await import('./krxHolidays.js');
    reloadKrxHolidaySet();
    expect(isKrxHoliday('2026-05-05')).toBe(true); // 어린이날
    expect(isKrxHoliday('2027-01-01')).toBe(true); // 2027 신정
  });

  it('patch 제거 후 reload 시 isKrxHoliday(제거 날짜) === false', async () => {
    const { appendKrxHolidayPatch, removeKrxHolidayPatchByDate } = await import('../persistence/krxHolidayRepo.js');
    appendKrxHolidayPatch([
      { date: '2028-01-01', reason: '신정', addedAt: 'A', addedBy: 'manual' },
    ]);
    const { isKrxHoliday, reloadKrxHolidaySet } = await import('./krxHolidays.js');
    reloadKrxHolidaySet();
    expect(isKrxHoliday('2028-01-01')).toBe(true);

    removeKrxHolidayPatchByDate('2028-01-01');
    reloadKrxHolidaySet();
    expect(isKrxHoliday('2028-01-01')).toBe(false);
  });

  it('getStaticKrxHolidays — patch 미적용 view 제공', async () => {
    const { appendKrxHolidayPatch } = await import('../persistence/krxHolidayRepo.js');
    appendKrxHolidayPatch([
      { date: '2028-01-01', reason: '신정', addedAt: 'A', addedBy: 'manual' },
    ]);
    const { reloadKrxHolidaySet, getStaticKrxHolidays } = await import('./krxHolidays.js');
    reloadKrxHolidaySet();
    const staticSet = getStaticKrxHolidays();
    expect(staticSet.has('2028-01-01')).toBe(false); // patch 는 정적에서 제외
    expect(staticSet.has('2026-05-05')).toBe(true);
  });
});
