// @responsibility: scheduleCatalog JobMetrics 회귀 — recordScheduleRun 누적·정렬·에러 메시지 절삭.
import { describe, it, expect, beforeEach } from 'vitest';

import {
  recordScheduleRun,
  getJobMetrics,
  getAllJobMetrics,
  __resetScheduleMetricsForTests,
  wrapJob,
} from './scheduleCatalog.js';

beforeEach(() => {
  __resetScheduleMetricsForTests();
});

// ── recordScheduleRun → JobMetrics 누적 ──────────────────────────────────────

describe('recordScheduleRun JobMetrics 누적', () => {
  it('첫 success 호출 → runCount=1, successCount=1, lastSuccessAt 채워짐', () => {
    recordScheduleRun({
      jobName: 'job_a',
      startedAt: '2026-04-25T01:00:00.000Z',
      finishedAt: '2026-04-25T01:00:01.000Z',
      durationMs: 1000,
      status: 'success',
      note: '결과 OK',
    });
    const m = getJobMetrics('job_a');
    expect(m).toBeDefined();
    expect(m!.runCount).toBe(1);
    expect(m!.successCount).toBe(1);
    expect(m!.failCount).toBe(0);
    expect(m!.skippedCount).toBe(0);
    expect(m!.lastSuccessAt).toBe('2026-04-25T01:00:01.000Z');
    expect(m!.lastFailureAt).toBeUndefined();
    expect(m!.lastErrorMessage).toBeUndefined();
  });

  it('failure 누적 → failCount + lastFailureAt + lastErrorMessage 갱신', () => {
    recordScheduleRun({
      jobName: 'job_b',
      startedAt: '2026-04-25T02:00:00.000Z',
      finishedAt: '2026-04-25T02:00:00.500Z',
      durationMs: 500,
      status: 'failure',
      note: 'KIS 401 unauthorized',
    });
    const m = getJobMetrics('job_b');
    expect(m!.failCount).toBe(1);
    expect(m!.lastFailureAt).toBe('2026-04-25T02:00:00.500Z');
    expect(m!.lastErrorMessage).toBe('KIS 401 unauthorized');
  });

  it('skipped 누적 → skippedCount만 증가, lastError 변경 없음', () => {
    recordScheduleRun({
      jobName: 'job_c',
      startedAt: '2026-04-25T03:00:00.000Z',
      finishedAt: '2026-04-25T03:00:00.100Z',
      durationMs: 100,
      status: 'skipped',
      note: 'cooldown 미충족',
    });
    const m = getJobMetrics('job_c');
    expect(m!.skippedCount).toBe(1);
    expect(m!.runCount).toBe(1);
    expect(m!.lastErrorMessage).toBeUndefined();
  });

  it('success 후 failure → 누적 + lastError 갱신', () => {
    recordScheduleRun({
      jobName: 'job_d', startedAt: '2026-04-25T04:00:00.000Z',
      finishedAt: '2026-04-25T04:00:01.000Z', durationMs: 1000,
      status: 'success', note: 'OK',
    });
    recordScheduleRun({
      jobName: 'job_d', startedAt: '2026-04-25T04:05:00.000Z',
      finishedAt: '2026-04-25T04:05:00.500Z', durationMs: 500,
      status: 'failure', note: 'timeout',
    });
    const m = getJobMetrics('job_d');
    expect(m!.runCount).toBe(2);
    expect(m!.successCount).toBe(1);
    expect(m!.failCount).toBe(1);
    expect(m!.lastSuccessAt).toBe('2026-04-25T04:00:01.000Z');
    expect(m!.lastFailureAt).toBe('2026-04-25T04:05:00.500Z');
    expect(m!.lastErrorMessage).toBe('timeout');
  });

  it('lastErrorMessage 는 120자 절삭', () => {
    const longMsg = 'A'.repeat(200);
    recordScheduleRun({
      jobName: 'job_e', startedAt: '2026-04-25T05:00:00.000Z',
      finishedAt: '2026-04-25T05:00:01.000Z', durationMs: 1000,
      status: 'failure', note: longMsg,
    });
    expect(getJobMetrics('job_e')!.lastErrorMessage).toHaveLength(120);
  });

  it('미실행 jobName → undefined 반환', () => {
    expect(getJobMetrics('never_ran')).toBeUndefined();
  });
});

// ── getAllJobMetrics 정렬 ─────────────────────────────────────────────────────

describe('getAllJobMetrics — failCount 내림차순', () => {
  it('failCount 가 큰 순, 동률은 runCount 내림차순', () => {
    // job_a: 5 fail / 10 run
    for (let i = 0; i < 5; i++) {
      recordScheduleRun({
        jobName: 'job_a', startedAt: '2026-04-25T00:00:00.000Z',
        finishedAt: '2026-04-25T00:00:01.000Z', durationMs: 1000,
        status: 'failure', note: 'X',
      });
    }
    for (let i = 0; i < 5; i++) {
      recordScheduleRun({
        jobName: 'job_a', startedAt: '2026-04-25T00:00:00.000Z',
        finishedAt: '2026-04-25T00:00:01.000Z', durationMs: 1000,
        status: 'success',
      });
    }
    // job_b: 5 fail / 8 run (동률 fail, runCount 작음)
    for (let i = 0; i < 5; i++) {
      recordScheduleRun({
        jobName: 'job_b', startedAt: '2026-04-25T00:00:00.000Z',
        finishedAt: '2026-04-25T00:00:01.000Z', durationMs: 1000,
        status: 'failure', note: 'X',
      });
    }
    for (let i = 0; i < 3; i++) {
      recordScheduleRun({
        jobName: 'job_b', startedAt: '2026-04-25T00:00:00.000Z',
        finishedAt: '2026-04-25T00:00:01.000Z', durationMs: 1000,
        status: 'success',
      });
    }
    // job_c: 1 fail / 100 run (가장 적은 fail)
    recordScheduleRun({
      jobName: 'job_c', startedAt: '2026-04-25T00:00:00.000Z',
      finishedAt: '2026-04-25T00:00:01.000Z', durationMs: 1000,
      status: 'failure', note: 'X',
    });
    for (let i = 0; i < 99; i++) {
      recordScheduleRun({
        jobName: 'job_c', startedAt: '2026-04-25T00:00:00.000Z',
        finishedAt: '2026-04-25T00:00:01.000Z', durationMs: 1000,
        status: 'success',
      });
    }

    const all = getAllJobMetrics();
    expect(all).toHaveLength(3);
    // failCount 5 > 5 > 1, 동률은 runCount 내림차순 → a(10) > b(8)
    expect(all[0].jobName).toBe('job_a');
    expect(all[1].jobName).toBe('job_b');
    expect(all[2].jobName).toBe('job_c');
  });

  it('빈 metrics → 빈 배열', () => {
    expect(getAllJobMetrics()).toEqual([]);
  });

  it('반환 객체 mutate 가 내부 상태에 영향 없음 (defensive copy)', () => {
    recordScheduleRun({
      jobName: 'job_x', startedAt: '2026-04-25T00:00:00.000Z',
      finishedAt: '2026-04-25T00:00:01.000Z', durationMs: 1000,
      status: 'success',
    });
    const all = getAllJobMetrics();
    all[0].runCount = 999; // 외부 mutate 시도
    expect(getJobMetrics('job_x')!.runCount).toBe(1); // 내부는 영향 없어야 함
  });
});

// ── wrapJob 자동 메트릭 등록 ─────────────────────────────────────────────────

describe('wrapJob 자동 메트릭 등록', () => {
  it('성공 cron 콜백 → metrics success 누적', async () => {
    const wrapped = wrapJob('cron_a', async () => 'ok');
    await wrapped();
    const m = getJobMetrics('cron_a');
    expect(m!.successCount).toBe(1);
    expect(m!.failCount).toBe(0);
  });

  it('실패 cron 콜백 → metrics failure 누적 + lastErrorMessage', async () => {
    const wrapped = wrapJob('cron_b', async () => {
      throw new Error('boom!');
    });
    await wrapped(); // wrapJob 이 swallow 하므로 throw 없음
    const m = getJobMetrics('cron_b');
    expect(m!.failCount).toBe(1);
    expect(m!.lastErrorMessage).toBe('boom!');
  });

  it('성공+실패 혼재 시 누적 모두 정확', async () => {
    const wrapped = wrapJob('cron_c', async (): Promise<string> => {
      // 짝수 호출은 실패, 홀수는 성공
      const counter = (wrapped as unknown as { __c?: number }).__c = ((wrapped as unknown as { __c?: number }).__c ?? 0) + 1;
      if (counter % 2 === 0) throw new Error(`fail #${counter}`);
      return 'ok';
    });
    await wrapped(); // 1: success
    await wrapped(); // 2: failure
    await wrapped(); // 3: success
    await wrapped(); // 4: failure
    const m = getJobMetrics('cron_c');
    expect(m!.successCount).toBe(2);
    expect(m!.failCount).toBe(2);
    expect(m!.runCount).toBe(4);
    expect(m!.lastErrorMessage).toBe('fail #4');
  });
});
