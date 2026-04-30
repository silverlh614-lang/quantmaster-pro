// @responsibility scheduledJob wrapper 가 success/skipped/failure 모두 recordScheduleRun 호출 누락 없이 트리거 검증
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// scheduleGuard 가 node-cron 의 cron.schedule 을 호출 — 본 테스트는 cron.schedule 을 mock 해
// callback 을 직접 추출 + 실행해 wiring 만 검증한다 (실제 cron 시간 대기 없음).
type CronCallback = () => Promise<void> | void;
const _capturedCallbacks: CronCallback[] = [];

vi.mock('node-cron', () => ({
  default: {
    schedule: (_expr: string, callback: CronCallback) => {
      _capturedCallbacks.push(callback);
      return { start: () => {}, stop: () => {} };
    },
  },
}));

describe('scheduledJob wrapper — recordScheduleRun wiring (PR-Diag-5 보강)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sched-wrapper-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    _capturedCallbacks.length = 0;
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  it('1. fn 정상 완료 → recordScheduleRun(success) + JobMetrics runCount/successCount 증가', async () => {
    const { scheduledJob } = await import('./scheduleGuard.js');
    const { __resetScheduleMetricsForTests, getJobMetrics } = await import('./scheduleCatalog.js');
    __resetScheduleMetricsForTests();
    const fn = vi.fn(async () => { /* 정상 */ });
    scheduledJob('* * * * *', 'ALWAYS_ON', 'test_job_success', fn);
    expect(_capturedCallbacks.length).toBe(1);
    await _capturedCallbacks[0]();
    const m = getJobMetrics('test_job_success');
    expect(m?.runCount).toBe(1);
    expect(m?.successCount).toBe(1);
    expect(m?.failCount).toBe(0);
    expect(m?.lastSuccessAt).toBeDefined();
  });

  it('2. fn throw → recordScheduleRun(failure) + failCount + lastErrorMessage 영속', async () => {
    const { scheduledJob } = await import('./scheduleGuard.js');
    const { __resetScheduleMetricsForTests, getJobMetrics } = await import('./scheduleCatalog.js');
    __resetScheduleMetricsForTests();
    const fn = vi.fn(async () => {
      throw new Error('intentional test failure');
    });
    scheduledJob('* * * * *', 'ALWAYS_ON', 'test_job_failure', fn);
    // wrapper 가 catch + swallow → throw 안 함
    await _capturedCallbacks[0]();
    const m = getJobMetrics('test_job_failure');
    expect(m?.runCount).toBe(1);
    expect(m?.failCount).toBe(1);
    expect(m?.successCount).toBe(0);
    expect(m?.lastErrorMessage).toContain('intentional test failure');
  });

  it('3. ScheduleClass=WEEKEND_MAINTENANCE 평일 실행 → skip + recordScheduleRun(skipped)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-30T06:00:00Z')); // 평일 (목요일)
    const { scheduledJob } = await import('./scheduleGuard.js');
    const { __resetScheduleMetricsForTests, getJobMetrics } = await import('./scheduleCatalog.js');
    __resetScheduleMetricsForTests();
    const fn = vi.fn(async () => {});
    scheduledJob('* * * * *', 'WEEKEND_MAINTENANCE', 'test_job_skip', fn);
    await _capturedCallbacks[0]();
    expect(fn).not.toHaveBeenCalled();
    const m = getJobMetrics('test_job_skip');
    expect(m?.runCount).toBe(1);
    expect(m?.skippedCount).toBe(1);
    expect(m?.lastSkipReason).toBeDefined();
    vi.useRealTimers();
  });

  it('4. options.force=true → ScheduleClass 가드 우회 + 정상 실행', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-30T06:00:00Z'));
    const { scheduledJob } = await import('./scheduleGuard.js');
    const { __resetScheduleMetricsForTests, getJobMetrics } = await import('./scheduleCatalog.js');
    __resetScheduleMetricsForTests();
    const fn = vi.fn(async () => {});
    scheduledJob('* * * * *', 'WEEKEND_MAINTENANCE', 'test_job_force', fn, { force: true });
    await _capturedCallbacks[0]();
    expect(fn).toHaveBeenCalled();
    const m = getJobMetrics('test_job_force');
    expect(m?.successCount).toBe(1);
    vi.useRealTimers();
  });

  it('5. **PR follow-up 핵심** — failure 발생 시 디스크 즉시 저장 (30s debounce 우회)', async () => {
    const { scheduledJob } = await import('./scheduleGuard.js');
    const { __resetScheduleMetricsForTests } = await import('./scheduleCatalog.js');
    __resetScheduleMetricsForTests();
    const fn = vi.fn(async () => {
      throw new Error('immediate save check');
    });
    scheduledJob('* * * * *', 'ALWAYS_ON', 'test_job_immediate_save', fn);
    await _capturedCallbacks[0]();
    // 디스크에 즉시 저장됐는지 확인
    const file = path.join(tmpDir, 'job-metrics.json');
    expect(fs.existsSync(file)).toBe(true);
    const persisted = JSON.parse(fs.readFileSync(file, 'utf-8'));
    expect(persisted.test_job_immediate_save.failCount).toBe(1);
    expect(persisted.test_job_immediate_save.lastErrorMessage).toContain('immediate save check');
  });

  it('6. success 다수 → 30s throttle 작동 (즉시 디스크 저장 안 됨)', async () => {
    const { scheduledJob } = await import('./scheduleGuard.js');
    const { __resetScheduleMetricsForTests } = await import('./scheduleCatalog.js');
    __resetScheduleMetricsForTests();
    const fn = vi.fn(async () => {});
    scheduledJob('* * * * *', 'ALWAYS_ON', 'test_job_throttled', fn);
    for (let i = 0; i < 5; i++) await _capturedCallbacks[0]();
    // success 만으로는 즉시 디스크 저장 안 됨 (30s throttle 대기 중)
    const file = path.join(tmpDir, 'job-metrics.json');
    expect(fs.existsSync(file)).toBe(false);
  });

  it('7. failure 후 success — failure 가 즉시 영속화 후 success 가 메모리만 갱신', async () => {
    const { scheduledJob } = await import('./scheduleGuard.js');
    const { __resetScheduleMetricsForTests, getJobMetrics } = await import('./scheduleCatalog.js');
    __resetScheduleMetricsForTests();
    let shouldFail = true;
    const fn = vi.fn(async () => {
      if (shouldFail) {
        shouldFail = false;
        throw new Error('first run fails');
      }
    });
    scheduledJob('* * * * *', 'ALWAYS_ON', 'test_job_recover', fn);
    // 1차: failure → 즉시 디스크
    await _capturedCallbacks[0]();
    const file = path.join(tmpDir, 'job-metrics.json');
    expect(fs.existsSync(file)).toBe(true);
    let persisted = JSON.parse(fs.readFileSync(file, 'utf-8'));
    expect(persisted.test_job_recover.failCount).toBe(1);
    // 2차: success → 메모리는 갱신, 디스크는 throttle 대기
    await _capturedCallbacks[0]();
    const memMetrics = getJobMetrics('test_job_recover');
    expect(memMetrics?.runCount).toBe(2);
    expect(memMetrics?.successCount).toBe(1);
    expect(memMetrics?.failCount).toBe(1);
    // 디스크는 1차 failure 시점 영속만 — successCount=0 그대로
    persisted = JSON.parse(fs.readFileSync(file, 'utf-8'));
    expect(persisted.test_job_recover.successCount).toBe(0);
  });
});
