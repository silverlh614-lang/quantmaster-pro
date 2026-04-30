// @responsibility 회귀 테스트 — scheduleCatalog JobMetrics 영속화 + 부팅 복원 + debounce wiring
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('scheduleCatalog JobMetrics persistence (PR-Diag-5 결함 수리)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sched-persist-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  it('1. recordScheduleRun 후 __flushJobMetricsForTests → 디스크 영속 확인', async () => {
    const mod = await import('./scheduleCatalog.js');
    mod.__resetScheduleMetricsForTests();
    mod.recordScheduleRun({
      jobName: 'ghost_portfolio',
      startedAt: '2026-04-30T06:40:00.000Z',
      finishedAt: '2026-04-30T06:40:01.000Z',
      durationMs: 1000,
      status: 'success',
    });
    mod.__flushJobMetricsForTests();
    const file = path.join(tmpDir, 'job-metrics.json');
    expect(fs.existsSync(file)).toBe(true);
    const persisted = JSON.parse(fs.readFileSync(file, 'utf-8'));
    expect(persisted.ghost_portfolio.runCount).toBe(1);
    expect(persisted.ghost_portfolio.successCount).toBe(1);
    expect(persisted.ghost_portfolio.lastSuccessAt).toBe('2026-04-30T06:40:01.000Z');
  });

  it('2. **사용자 시나리오 핵심** — Railway 재배포 시뮬레이션 — 영속 데이터에서 메모리 복원', async () => {
    // 1차 프로세스: 메트릭 누적 + 영속화
    const { recordScheduleRun, __resetScheduleMetricsForTests, __flushJobMetricsForTests } = await import('./scheduleCatalog.js');
    __resetScheduleMetricsForTests();
    recordScheduleRun({
      jobName: 'ghost_portfolio',
      startedAt: '2026-04-30T06:40:00.000Z',
      finishedAt: '2026-04-30T06:40:01.000Z',
      durationMs: 1000,
      status: 'success',
    });
    recordScheduleRun({
      jobName: 'nightly_reflection',
      startedAt: '2026-04-30T10:00:00.000Z',
      finishedAt: '2026-04-30T10:00:02.000Z',
      durationMs: 2000,
      status: 'success',
    });
    __flushJobMetricsForTests();

    // 2차 프로세스: 모듈 재로드 (Railway 재배포 시뮬레이션)
    vi.resetModules();
    const reloaded = await import('./scheduleCatalog.js');
    const ghostMetrics = reloaded.getJobMetrics('ghost_portfolio');
    const reflectMetrics = reloaded.getJobMetrics('nightly_reflection');
    expect(ghostMetrics).toBeDefined();
    expect(ghostMetrics?.runCount).toBe(1);
    expect(reflectMetrics).toBeDefined();
    expect(reflectMetrics?.runCount).toBe(1);
  });

  it('3. failure 누적 → lastErrorMessage 영속 + 재로드 후 복원', async () => {
    const { recordScheduleRun, __resetScheduleMetricsForTests, __flushJobMetricsForTests } = await import('./scheduleCatalog.js');
    __resetScheduleMetricsForTests();
    recordScheduleRun({
      jobName: 'f2w_reverse_loop',
      startedAt: '2026-04-30T03:10:00.000Z',
      finishedAt: '2026-04-30T03:10:02.000Z',
      durationMs: 2000,
      status: 'failure',
      note: 'Pearson correlation samples insufficient (n=2)',
    });
    __flushJobMetricsForTests();

    vi.resetModules();
    const reloaded = await import('./scheduleCatalog.js');
    const m = reloaded.getJobMetrics('f2w_reverse_loop');
    expect(m?.failCount).toBe(1);
    expect(m?.lastErrorMessage).toContain('Pearson');
  });

  it('4. skipped 누적 → lastSkipReason 영속 + 재로드', async () => {
    const { recordScheduleRun, __resetScheduleMetricsForTests, __flushJobMetricsForTests } = await import('./scheduleCatalog.js');
    __resetScheduleMetricsForTests();
    recordScheduleRun({
      jobName: 'ghost_portfolio',
      startedAt: '2026-05-01T06:40:00.000Z',
      finishedAt: '2026-05-01T06:40:00.000Z',
      durationMs: 0,
      status: 'skipped',
      note: 'KRX_HOLIDAY',
    });
    __flushJobMetricsForTests();

    vi.resetModules();
    const reloaded = await import('./scheduleCatalog.js');
    const m = reloaded.getJobMetrics('ghost_portfolio');
    expect(m?.skippedCount).toBe(1);
    expect(m?.lastSkipReason).toBe('KRX_HOLIDAY');
  });

  it('5. 다중 cron 누적 — 부팅 후 모두 복원', async () => {
    const { recordScheduleRun, __resetScheduleMetricsForTests, __flushJobMetricsForTests } = await import('./scheduleCatalog.js');
    __resetScheduleMetricsForTests();
    const jobs = ['nightly_reflection', 'ghost_portfolio', 'f2w_reverse_loop', 'orchestrator_tick'];
    for (const j of jobs) {
      recordScheduleRun({
        jobName: j,
        startedAt: '2026-04-30T06:40:00.000Z',
        finishedAt: '2026-04-30T06:40:01.000Z',
        durationMs: 1000,
        status: 'success',
      });
    }
    __flushJobMetricsForTests();

    vi.resetModules();
    const { getAllJobMetrics } = await import('./scheduleCatalog.js');
    const all = getAllJobMetrics();
    expect(all.length).toBe(4);
    for (const j of jobs) {
      expect(all.find((m) => m.jobName === j)?.runCount).toBe(1);
    }
  });

  it('6. 영속 파일 부재 + 새 record → 정상 작동 + 첫 영속화', async () => {
    const { recordScheduleRun, __resetScheduleMetricsForTests, __flushJobMetricsForTests, getJobMetrics } = await import('./scheduleCatalog.js');
    __resetScheduleMetricsForTests();
    expect(fs.existsSync(path.join(tmpDir, 'job-metrics.json'))).toBe(false);
    recordScheduleRun({
      jobName: 'orchestrator_tick',
      startedAt: '2026-04-30T06:40:00.000Z',
      finishedAt: '2026-04-30T06:40:00.500Z',
      durationMs: 500,
      status: 'success',
    });
    __flushJobMetricsForTests();
    expect(fs.existsSync(path.join(tmpDir, 'job-metrics.json'))).toBe(true);
    expect(getJobMetrics('orchestrator_tick')?.runCount).toBe(1);
  });

  it('7. 손상 영속 파일 → graceful (빈 메모리 시작 + 재누적 가능)', async () => {
    fs.writeFileSync(path.join(tmpDir, 'job-metrics.json'), '{ corrupted');
    const { recordScheduleRun, __resetScheduleMetricsForTests, getJobMetrics } = await import('./scheduleCatalog.js');
    // reset 호출은 _persistenceLoaded 를 false 로 → 다음 recordScheduleRun 자동 복원
    __resetScheduleMetricsForTests();
    fs.writeFileSync(path.join(tmpDir, 'job-metrics.json'), '{ corrupted');
    recordScheduleRun({
      jobName: 'ghost_portfolio',
      startedAt: '2026-04-30T06:40:00Z',
      finishedAt: '2026-04-30T06:40:01Z',
      durationMs: 1000,
      status: 'success',
    });
    expect(getJobMetrics('ghost_portfolio')?.runCount).toBe(1);
  });

  it('8. debounce — success 빠른 연속 호출 시 즉시 디스크 write 안 함 (30초 throttle)', async () => {
    const { recordScheduleRun, __resetScheduleMetricsForTests } = await import('./scheduleCatalog.js');
    __resetScheduleMetricsForTests();
    // 빠른 연속 호출 (orchestrator_tick 시뮬)
    for (let i = 0; i < 10; i++) {
      recordScheduleRun({
        jobName: 'orchestrator_tick',
        startedAt: '2026-04-30T06:40:00Z',
        finishedAt: '2026-04-30T06:40:00.500Z',
        durationMs: 500,
        status: 'success',
      });
    }
    // 즉시는 영속 안 됨 (debounce 30s timer 대기 중)
    expect(fs.existsSync(path.join(tmpDir, 'job-metrics.json'))).toBe(false);
  });

  it('10. **PR follow-up 핵심** failure → 30s throttle 우회 즉시 저장 (디버깅 우선)', async () => {
    const { recordScheduleRun, __resetScheduleMetricsForTests } = await import('./scheduleCatalog.js');
    __resetScheduleMetricsForTests();
    recordScheduleRun({
      jobName: 'f2w_reverse_loop',
      startedAt: '2026-04-30T03:10:00Z',
      finishedAt: '2026-04-30T03:10:02Z',
      durationMs: 2000,
      status: 'failure',
      note: 'Pearson correlation samples insufficient',
    });
    // failure 는 debounce 우회 즉시 디스크 저장
    const file = path.join(tmpDir, 'job-metrics.json');
    expect(fs.existsSync(file)).toBe(true);
    const persisted = JSON.parse(fs.readFileSync(file, 'utf-8'));
    expect(persisted.f2w_reverse_loop.failCount).toBe(1);
    expect(persisted.f2w_reverse_loop.lastErrorMessage).toContain('Pearson');
  });

  it('11. skipped → 30s throttle 적용 (failure 와 분리, 즉시 저장 안 됨)', async () => {
    const { recordScheduleRun, __resetScheduleMetricsForTests } = await import('./scheduleCatalog.js');
    __resetScheduleMetricsForTests();
    recordScheduleRun({
      jobName: 'ghost_portfolio',
      startedAt: '2026-05-02T06:40:00Z',
      finishedAt: '2026-05-02T06:40:00Z',
      durationMs: 0,
      status: 'skipped',
      note: 'WEEKEND',
    });
    // skipped 는 throttle 적용 (failure 와 다름) — 즉시 영속 안 됨
    expect(fs.existsSync(path.join(tmpDir, 'job-metrics.json'))).toBe(false);
  });

  it('12. success 후 failure 즉시 저장 — 누적 메모리 카운트 모두 영속', async () => {
    const { recordScheduleRun, __resetScheduleMetricsForTests } = await import('./scheduleCatalog.js');
    __resetScheduleMetricsForTests();
    // 1) success 5회 (throttle 대기, 디스크 미저장)
    for (let i = 0; i < 5; i++) {
      recordScheduleRun({
        jobName: 'orchestrator_tick',
        startedAt: '2026-04-30T06:40:00Z',
        finishedAt: '2026-04-30T06:40:00.500Z',
        durationMs: 500,
        status: 'success',
      });
    }
    expect(fs.existsSync(path.join(tmpDir, 'job-metrics.json'))).toBe(false);
    // 2) failure 1회 → 즉시 저장 (success 5회 누적 카운트 포함)
    recordScheduleRun({
      jobName: 'orchestrator_tick',
      startedAt: '2026-04-30T06:41:00Z',
      finishedAt: '2026-04-30T06:41:01Z',
      durationMs: 1000,
      status: 'failure',
      note: 'KIS rate limit',
    });
    const persisted = JSON.parse(fs.readFileSync(path.join(tmpDir, 'job-metrics.json'), 'utf-8'));
    expect(persisted.orchestrator_tick.successCount).toBe(5);
    expect(persisted.orchestrator_tick.failCount).toBe(1);
    expect(persisted.orchestrator_tick.runCount).toBe(6);
  });

  it('9. __resetScheduleMetricsForTests → 영속 파일도 삭제', async () => {
    const { recordScheduleRun, __resetScheduleMetricsForTests, __flushJobMetricsForTests } = await import('./scheduleCatalog.js');
    __resetScheduleMetricsForTests();
    recordScheduleRun({
      jobName: 'ghost_portfolio',
      startedAt: '2026-04-30T06:40:00Z',
      finishedAt: '2026-04-30T06:40:01Z',
      durationMs: 1000,
      status: 'success',
    });
    __flushJobMetricsForTests();
    expect(fs.existsSync(path.join(tmpDir, 'job-metrics.json'))).toBe(true);
    __resetScheduleMetricsForTests();
    expect(fs.existsSync(path.join(tmpDir, 'job-metrics.json'))).toBe(false);
  });
});
