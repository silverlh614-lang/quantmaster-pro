/**
 * jobMetricsRepo.test.ts — JobMetrics 영속 SSOT 회귀
 *
 * 사용자 4/30 /cron_introspect 보고: 4/4 cron 모두 runCount=0 (CONTRADICTION_METRICS_LIES).
 * 본 테스트가 영속 round-trip + 손상 fallback + atomic write + throttle 을 검증.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('ADR JobMetrics 영속 — Railway 재배포 안전성', () => {
  let tmpDir: string;
  let originalEnv: string | undefined;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobmetrics-'));
    originalEnv = process.env.PERSIST_DATA_DIR;
    process.env.PERSIST_DATA_DIR = tmpDir;
    // paths 모듈 cache 갱신 — DATA_DIR 이 ENV 시점에 결정됨.
    const { vi } = await import('vitest');
    vi.resetModules();
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.PERSIST_DATA_DIR;
    else process.env.PERSIST_DATA_DIR = originalEnv;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  it('빈 파일 → 빈 객체 fallback', async () => {
    const { loadJobMetrics, __resetJobMetricsRepoForTests } = await import('./jobMetricsRepo.js');
    __resetJobMetricsRepoForTests();
    const result = loadJobMetrics();
    expect(result).toEqual({});
  });

  it('saveJobMetrics → loadJobMetrics round-trip', async () => {
    const { saveJobMetrics, loadJobMetrics, __resetJobMetricsRepoForTests } =
      await import('./jobMetricsRepo.js');
    __resetJobMetricsRepoForTests();
    const snapshot = {
      nightly_reflection: {
        jobName: 'nightly_reflection',
        runCount: 7,
        successCount: 6,
        failCount: 1,
        skippedCount: 0,
        lastSuccessAt: '2026-04-30T10:00:00.000Z',
        lastFailureAt: '2026-04-29T10:00:00.000Z',
      },
    };
    saveJobMetrics(snapshot);
    const restored = loadJobMetrics();
    expect(restored).toEqual(snapshot);
  });

  it('손상된 JSON → 빈 객체 fallback (시스템 무중단)', async () => {
    const { loadJobMetrics, __resetJobMetricsRepoForTests } = await import('./jobMetricsRepo.js');
    const { JOB_METRICS_FILE } = await import('./paths.js');
    __resetJobMetricsRepoForTests();
    fs.mkdirSync(path.dirname(JOB_METRICS_FILE), { recursive: true });
    fs.writeFileSync(JOB_METRICS_FILE, '{ corrupted JSON');
    const result = loadJobMetrics();
    expect(result).toEqual({});
  });

  it('Array 직접 저장 시 빈 객체 fallback (schema 가드)', async () => {
    const { loadJobMetrics, __resetJobMetricsRepoForTests } = await import('./jobMetricsRepo.js');
    const { JOB_METRICS_FILE } = await import('./paths.js');
    __resetJobMetricsRepoForTests();
    fs.mkdirSync(path.dirname(JOB_METRICS_FILE), { recursive: true });
    fs.writeFileSync(JOB_METRICS_FILE, JSON.stringify([1, 2, 3]));
    const result = loadJobMetrics();
    expect(result).toEqual({});
  });

  it('runCount 가 number 가 아닌 entry 는 무시 (손상 entry 격리)', async () => {
    const { loadJobMetrics, __resetJobMetricsRepoForTests } = await import('./jobMetricsRepo.js');
    const { JOB_METRICS_FILE } = await import('./paths.js');
    __resetJobMetricsRepoForTests();
    fs.mkdirSync(path.dirname(JOB_METRICS_FILE), { recursive: true });
    fs.writeFileSync(JOB_METRICS_FILE, JSON.stringify({
      good: { jobName: 'good', runCount: 5, successCount: 5, failCount: 0, skippedCount: 0 },
      corrupt_runCount: { jobName: 'corrupt_runCount', runCount: 'not a number' },
      corrupt_null: null,
    }));
    const result = loadJobMetrics();
    expect(Object.keys(result)).toEqual(['good']);
    expect(result.good.runCount).toBe(5);
  });

  it('Atomic write — tmp 파일이 rename 후 사라짐', async () => {
    const { saveJobMetrics, __resetJobMetricsRepoForTests } = await import('./jobMetricsRepo.js');
    const { JOB_METRICS_FILE } = await import('./paths.js');
    __resetJobMetricsRepoForTests();
    saveJobMetrics({ tick: { jobName: 'tick', runCount: 1, successCount: 1, failCount: 0, skippedCount: 0 } });
    expect(fs.existsSync(JOB_METRICS_FILE)).toBe(true);
    // 동일 디렉토리에 .tmp.* 파일이 잔존하지 않아야 함
    const dir = path.dirname(JOB_METRICS_FILE);
    const tmpFiles = fs.readdirSync(dir).filter((f) => f.startsWith('job-metrics.json.tmp'));
    expect(tmpFiles).toHaveLength(0);
  });

  it('scheduleSaveJobMetrics throttle — 첫 호출 즉시 flush', async () => {
    const { scheduleSaveJobMetrics, loadJobMetrics, __resetJobMetricsRepoForTests } =
      await import('./jobMetricsRepo.js');
    __resetJobMetricsRepoForTests();
    scheduleSaveJobMetrics({
      ghost: { jobName: 'ghost', runCount: 4, successCount: 4, failCount: 0, skippedCount: 0 },
    });
    // 첫 호출은 _lastFlushAt=0 이라 즉시 flush.
    const restored = loadJobMetrics();
    expect(restored.ghost.runCount).toBe(4);
  });

  it('flushJobMetrics — pending throttle 즉시 처리', async () => {
    const { saveJobMetrics, scheduleSaveJobMetrics, flushJobMetrics, loadJobMetrics, __resetJobMetricsRepoForTests } =
      await import('./jobMetricsRepo.js');
    __resetJobMetricsRepoForTests();
    // 첫 즉시 flush 로 _lastFlushAt 갱신.
    saveJobMetrics({ a: { jobName: 'a', runCount: 1, successCount: 1, failCount: 0, skippedCount: 0 } });
    // 두 번째 호출은 throttle 영역 (30s 내) → pending 으로 누적.
    scheduleSaveJobMetrics({
      a: { jobName: 'a', runCount: 1, successCount: 1, failCount: 0, skippedCount: 0 },
      b: { jobName: 'b', runCount: 2, successCount: 2, failCount: 0, skippedCount: 0 },
    });
    // 디스크에는 아직 b 가 없음 (pending).
    expect(loadJobMetrics().b).toBeUndefined();
    // flushJobMetrics 호출 시 pending 즉시 처리.
    flushJobMetrics();
    expect(loadJobMetrics().b?.runCount).toBe(2);
  });

  it('JOB_METRICS_THROTTLE_MS 상수 export 정합', async () => {
    const { JOB_METRICS_THROTTLE_MS } = await import('./jobMetricsRepo.js');
    expect(JOB_METRICS_THROTTLE_MS).toBe(30_000);
  });

  it('scheduleCatalog 통합 — recordScheduleRun 후 디스크 영속 + 부팅 복원', async () => {
    const {
      recordScheduleRun,
      flushJobMetricsToDisk,
      restoreJobMetricsFromDisk,
      __resetScheduleMetricsForTests,
      getJobMetrics,
    } = await import('../scheduler/scheduleCatalog.js');
    const { __resetJobMetricsRepoForTests } = await import('./jobMetricsRepo.js');
    __resetJobMetricsRepoForTests();
    __resetScheduleMetricsForTests();

    // 1) 기록 → 메모리 + throttle 영속.
    recordScheduleRun({
      jobName: 'nightly_reflection',
      startedAt: '2026-04-30T10:00:00.000Z',
      finishedAt: '2026-04-30T10:00:01.000Z',
      durationMs: 1000,
      status: 'success',
    });
    // 즉시 flush — pending 강제 처리.
    flushJobMetricsToDisk();

    // 2) 메모리 리셋 (Railway 재배포 시뮬).
    __resetScheduleMetricsForTests();
    expect(getJobMetrics('nightly_reflection')).toBeUndefined();

    // 3) 부팅 복원 — 디스크 → 메모리.
    const restored = restoreJobMetricsFromDisk();
    expect(restored).toBeGreaterThanOrEqual(1);
    const m = getJobMetrics('nightly_reflection');
    expect(m).toBeDefined();
    expect(m?.runCount).toBe(1);
    expect(m?.successCount).toBe(1);
    expect(m?.lastSuccessAt).toBe('2026-04-30T10:00:01.000Z');
  });
});
