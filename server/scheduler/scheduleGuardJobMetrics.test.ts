/**
 * scheduleGuardJobMetrics.test.ts — scheduledJob → recordScheduleRun → 영속 round-trip
 *
 * 사용자 4/30 결함: scheduledJob wrapper 가 recordScheduleRun 호출하지만 메모리에만
 * 누적 → /cron_introspect runCount=0. 본 테스트가 *cron 콜백 실행* → *영속 적용* → *부팅 후 복원* 까지 검증.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('scheduleGuard JobMetrics 영속 정합 (사용자 /cron_introspect 결함)', () => {
  let tmpDir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sched-jm-'));
    originalEnv = process.env.PERSIST_DATA_DIR;
    process.env.PERSIST_DATA_DIR = tmpDir;
    vi.resetModules();
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.PERSIST_DATA_DIR;
    else process.env.PERSIST_DATA_DIR = originalEnv;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  it('recordScheduleRun success 5회 → 디스크 영속 + 재시작 후 runCount=5 복원', async () => {
    const { recordScheduleRun, flushJobMetricsToDisk, getJobMetrics, __resetScheduleMetricsForTests, restoreJobMetricsFromDisk } =
      await import('./scheduleCatalog.js');
    const { __resetJobMetricsRepoForTests } = await import('../persistence/jobMetricsRepo.js');
    __resetJobMetricsRepoForTests();
    __resetScheduleMetricsForTests();

    for (let i = 0; i < 5; i++) {
      recordScheduleRun({
        jobName: 'orchestrator_tick',
        startedAt: `2026-04-30T09:${i.toString().padStart(2, '0')}:00.000Z`,
        finishedAt: `2026-04-30T09:${i.toString().padStart(2, '0')}:01.000Z`,
        durationMs: 1000,
        status: 'success',
      });
    }
    flushJobMetricsToDisk();

    // Railway 재배포 시뮬 — 메모리 휘발.
    __resetScheduleMetricsForTests();
    expect(getJobMetrics('orchestrator_tick')).toBeUndefined();

    // 부팅 복원.
    restoreJobMetricsFromDisk();
    const m = getJobMetrics('orchestrator_tick');
    expect(m?.runCount).toBe(5);
    expect(m?.successCount).toBe(5);
    expect(m?.failCount).toBe(0);
    expect(m?.lastSuccessAt).toBe('2026-04-30T09:04:01.000Z');
  });

  it('mixed success/failure/skipped → 모든 카운터 영속', async () => {
    const { recordScheduleRun, flushJobMetricsToDisk, getJobMetrics, __resetScheduleMetricsForTests, restoreJobMetricsFromDisk } =
      await import('./scheduleCatalog.js');
    const { __resetJobMetricsRepoForTests } = await import('../persistence/jobMetricsRepo.js');
    __resetJobMetricsRepoForTests();
    __resetScheduleMetricsForTests();

    recordScheduleRun({
      jobName: 'ghost_portfolio',
      startedAt: '2026-04-30T10:00:00.000Z',
      finishedAt: '2026-04-30T10:00:05.000Z',
      durationMs: 5000,
      status: 'success',
    });
    recordScheduleRun({
      jobName: 'ghost_portfolio',
      startedAt: '2026-04-30T11:00:00.000Z',
      finishedAt: '2026-04-30T11:00:01.000Z',
      durationMs: 1000,
      status: 'failure',
      note: 'KIS rate limit',
    });
    recordScheduleRun({
      jobName: 'ghost_portfolio',
      startedAt: '2026-05-04T10:00:00.000Z',
      finishedAt: '2026-05-04T10:00:00.000Z',
      durationMs: 0,
      status: 'skipped',
      note: 'KRX_HOLIDAY',
    });
    flushJobMetricsToDisk();

    __resetScheduleMetricsForTests();
    restoreJobMetricsFromDisk();
    const m = getJobMetrics('ghost_portfolio');
    expect(m?.runCount).toBe(3);
    expect(m?.successCount).toBe(1);
    expect(m?.failCount).toBe(1);
    expect(m?.skippedCount).toBe(1);
    expect(m?.lastErrorMessage).toBe('KIS rate limit');
    expect(m?.lastSkipReason).toBe('KRX_HOLIDAY');
  });

  it('재시작 후 동일 jobName 재기록 → 누적값 보존 (race 보호)', async () => {
    const { recordScheduleRun, flushJobMetricsToDisk, getJobMetrics, __resetScheduleMetricsForTests, restoreJobMetricsFromDisk } =
      await import('./scheduleCatalog.js');
    const { __resetJobMetricsRepoForTests } = await import('../persistence/jobMetricsRepo.js');
    __resetJobMetricsRepoForTests();
    __resetScheduleMetricsForTests();

    // Day 1: 3회 성공.
    for (let i = 0; i < 3; i++) {
      recordScheduleRun({
        jobName: 'f2w_reverse_loop',
        startedAt: `2026-04-29T03:${i}.000Z`,
        finishedAt: `2026-04-29T03:${i}.000Z`,
        durationMs: 100,
        status: 'success',
      });
    }
    flushJobMetricsToDisk();

    // 재배포 시뮬.
    __resetScheduleMetricsForTests();
    restoreJobMetricsFromDisk();

    // Day 2: 추가 2회 성공.
    recordScheduleRun({
      jobName: 'f2w_reverse_loop',
      startedAt: '2026-04-30T03:00.000Z',
      finishedAt: '2026-04-30T03:00.000Z',
      durationMs: 100,
      status: 'success',
    });
    recordScheduleRun({
      jobName: 'f2w_reverse_loop',
      startedAt: '2026-04-30T03:10.000Z',
      finishedAt: '2026-04-30T03:10.000Z',
      durationMs: 100,
      status: 'success',
    });
    flushJobMetricsToDisk();

    // 다시 재배포.
    __resetScheduleMetricsForTests();
    restoreJobMetricsFromDisk();
    const m = getJobMetrics('f2w_reverse_loop');
    expect(m?.runCount).toBe(5); // 3 (Day 1) + 2 (Day 2) — 누적.
    expect(m?.successCount).toBe(5);
  });

  it('restoreJobMetricsFromDisk — 메모리 우선 (race 시 디스크 덮어쓰기 안 함)', async () => {
    const {
      recordScheduleRun,
      flushJobMetricsToDisk,
      getJobMetrics,
      __resetScheduleMetricsForTests,
      restoreJobMetricsFromDisk,
    } = await import('./scheduleCatalog.js');
    const { __resetJobMetricsRepoForTests } = await import('../persistence/jobMetricsRepo.js');
    __resetJobMetricsRepoForTests();
    __resetScheduleMetricsForTests();

    // 1) 디스크에 runCount=10 저장.
    recordScheduleRun({
      jobName: 'nightly_reflection',
      startedAt: '2026-04-23T10:00.000Z',
      finishedAt: '2026-04-23T10:00.000Z',
      durationMs: 100,
      status: 'success',
    });
    // 메모리 강제 갱신 (10회 누적).
    for (let i = 0; i < 9; i++) {
      recordScheduleRun({
        jobName: 'nightly_reflection',
        startedAt: `2026-04-${24 + i}T10:00.000Z`,
        finishedAt: `2026-04-${24 + i}T10:00.000Z`,
        durationMs: 100,
        status: 'success',
      });
    }
    flushJobMetricsToDisk();
    expect(getJobMetrics('nightly_reflection')?.runCount).toBe(10);

    // 2) 메모리에 다른 값 직접 주입 (race 시뮬).
    const { __injectMetricsForTests } = await import('./scheduleCatalog.js');
    __resetScheduleMetricsForTests();
    __injectMetricsForTests({
      nightly_reflection: {
        jobName: 'nightly_reflection',
        runCount: 99, // 메모리 값.
        successCount: 99,
        failCount: 0,
        skippedCount: 0,
      },
    });

    // 3) restoreJobMetricsFromDisk — 메모리에 이미 있으니 덮어쓰지 않음 (race 보호).
    const restored = restoreJobMetricsFromDisk();
    expect(restored).toBe(0); // 메모리에 있어서 복원 skip.
    expect(getJobMetrics('nightly_reflection')?.runCount).toBe(99);
  });
});
