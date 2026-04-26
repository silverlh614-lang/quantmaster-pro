/**
 * @responsibility krxHolidayRepo 회귀 테스트 — patch 영속·idempotent·손상 fallback (ADR-0039 PR-D)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('krxHolidayRepo — patch 영속', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'krx-holiday-patch-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    vi.resetModules(); // paths.ts 의 DATA_DIR 캐시 갱신
  });

  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  it('빈 파일 → 빈 Set', async () => {
    const { loadKrxHolidayPatch } = await import('./krxHolidayRepo.js');
    expect(loadKrxHolidayPatch().size).toBe(0);
  });

  it('append 후 load 시 반영', async () => {
    const { appendKrxHolidayPatch, loadKrxHolidayPatch } = await import('./krxHolidayRepo.js');
    const added = appendKrxHolidayPatch([
      { date: '2028-01-01', reason: '신정', addedAt: '2026-12-01T00:00:00Z', addedBy: 'manual' },
    ]);
    expect(added).toBe(1);
    const set = loadKrxHolidayPatch();
    expect(set.has('2028-01-01')).toBe(true);
  });

  it('append idempotent — 동일 날짜 두번째 추가 시 added=0', async () => {
    const { appendKrxHolidayPatch } = await import('./krxHolidayRepo.js');
    appendKrxHolidayPatch([
      { date: '2028-01-01', reason: '신정', addedAt: 'A', addedBy: 'manual' },
    ]);
    const added2 = appendKrxHolidayPatch([
      { date: '2028-01-01', reason: '신정 (수정)', addedAt: 'B', addedBy: 'audit' },
    ]);
    expect(added2).toBe(0);
  });

  it('append entries 정렬 — 디스크 파일이 날짜 오름차순 보존', async () => {
    const { appendKrxHolidayPatch, loadKrxHolidayPatchEntries } = await import('./krxHolidayRepo.js');
    appendKrxHolidayPatch([
      { date: '2028-12-25', reason: '성탄절', addedAt: 'A', addedBy: 'manual' },
      { date: '2028-01-01', reason: '신정', addedAt: 'A', addedBy: 'manual' },
      { date: '2028-08-15', reason: '광복절', addedAt: 'A', addedBy: 'manual' },
    ]);
    const entries = loadKrxHolidayPatchEntries();
    expect(entries.map((e) => e.date)).toEqual(['2028-01-01', '2028-08-15', '2028-12-25']);
  });

  it('잘못된 날짜 형식은 무시 + 경고', async () => {
    const { appendKrxHolidayPatch, loadKrxHolidayPatch } = await import('./krxHolidayRepo.js');
    const added = appendKrxHolidayPatch([
      { date: '2028/01/01', reason: '잘못된 형식', addedAt: 'A', addedBy: 'manual' },
      { date: '2028-01-01', reason: '신정', addedAt: 'A', addedBy: 'manual' },
    ]);
    expect(added).toBe(1);
    const set = loadKrxHolidayPatch();
    expect(set.has('2028-01-01')).toBe(true);
    expect(set.has('2028/01/01')).toBe(false);
  });

  it('removeKrxHolidayPatchByDate — 등록 항목 제거', async () => {
    const { appendKrxHolidayPatch, removeKrxHolidayPatchByDate, loadKrxHolidayPatch } =
      await import('./krxHolidayRepo.js');
    appendKrxHolidayPatch([
      { date: '2028-01-01', reason: '신정', addedAt: 'A', addedBy: 'manual' },
      { date: '2028-12-25', reason: '성탄절', addedAt: 'A', addedBy: 'manual' },
    ]);
    expect(removeKrxHolidayPatchByDate('2028-01-01')).toBe(true);
    const set = loadKrxHolidayPatch();
    expect(set.size).toBe(1);
    expect(set.has('2028-12-25')).toBe(true);
  });

  it('removeKrxHolidayPatchByDate — 미등록 항목 → false', async () => {
    const { removeKrxHolidayPatchByDate } = await import('./krxHolidayRepo.js');
    expect(removeKrxHolidayPatchByDate('2099-01-01')).toBe(false);
  });

  it('손상된 JSON → 빈 Set fallback (시스템 무중단)', async () => {
    fs.writeFileSync(path.join(tmpDir, 'krx-holiday-patch.json'), 'not valid json {{{');
    const { loadKrxHolidayPatch } = await import('./krxHolidayRepo.js');
    expect(loadKrxHolidayPatch().size).toBe(0);
  });
});
