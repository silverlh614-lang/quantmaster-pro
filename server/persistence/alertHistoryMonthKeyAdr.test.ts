/**
 * alertHistoryMonthKeyAdr.test.ts — 말일 previousMonthKey 오버플로 회귀.
 *
 * 결함: `now.setUTCMonth(m-1)` 이 일자를 보존해, 이전 달이 더 짧은 말일에는 다음 달로
 * 넘어가 previousMonthKey === currentMonthKey 가 됐다 → getRecentAlertHistory 가 같은
 * 파일을 두 번 읽어 **모든 알림 이력이 2배**. 2026-07-31 CI 전체 스위트 실패로 발현.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const OVERFLOW_DATES = [
  '2026-07-31T00:00:00Z', // 직전 6월 = 30일
  '2026-05-31T00:00:00Z', // 직전 4월 = 30일
  '2026-03-31T00:00:00Z', // 직전 2월 = 28일
  '2026-03-30T00:00:00Z',
  '2026-10-31T00:00:00Z', // 직전 9월 = 30일
];

describe('alertHistoryRepo — 월별 파일 선택 (말일 오버플로)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ahist-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.PERSIST_DATA_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  it.each(OVERFLOW_DATES)('%s — 말일에도 이력이 중복 집계되지 않는다', async (iso) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(iso));

    const { appendAlertHistory, getRecentAlertHistory } = await import('./alertHistoryRepo.js');
    appendAlertHistory({
      category: 'analysis_meta' as never,
      priority: 'NORMAL' as never,
      message: 'unique-entry',
      delivery: 'immediate',
      success: true,
    });

    const recent = getRecentAlertHistory(50);
    // 1건만 기록했으면 1건만 조회돼야 한다 (같은 파일 2회 읽기 → 2건이면 회귀).
    expect(recent.filter((e) => e.message === 'unique-entry')).toHaveLength(1);
  });

  it('말일이 아닌 날도 정상 (무회귀)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-27T00:00:00Z'));

    const { appendAlertHistory, getRecentAlertHistory } = await import('./alertHistoryRepo.js');
    appendAlertHistory({
      category: 'analysis_meta' as never,
      priority: 'NORMAL' as never,
      message: 'unique-entry',
      delivery: 'immediate',
      success: true,
    });
    expect(getRecentAlertHistory(50).filter((e) => e.message === 'unique-entry')).toHaveLength(1);
  });

  it('1월 → 전년 12월 파일도 함께 읽는다 (연도 롤백)', async () => {
    vi.useFakeTimers();
    // 먼저 2025-12 에 1건 기록
    vi.setSystemTime(new Date('2025-12-15T00:00:00Z'));
    const repo = await import('./alertHistoryRepo.js');
    repo.appendAlertHistory({
      category: 'analysis_meta' as never,
      priority: 'NORMAL' as never,
      message: 'december-entry',
      delivery: 'immediate',
      success: true,
    });

    // 2026-01 시점에서 조회 → 직전 월(2025-12) 파일이 포함돼야 한다
    vi.setSystemTime(new Date('2026-01-10T00:00:00Z'));
    const recent = repo.getRecentAlertHistory(50);
    expect(recent.filter((e) => e.message === 'december-entry')).toHaveLength(1);
  });
});
