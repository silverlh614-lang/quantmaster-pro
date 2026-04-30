// @responsibility 회귀 테스트 — JobMetricsRepo round-trip + 손상 fallback + atomic write
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('jobMetricsRepo', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'job-metrics-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  it('1. 파일 부재 → 빈 객체 반환', async () => {
    const { loadJobMetrics } = await import('./jobMetricsRepo.js');
    expect(loadJobMetrics()).toEqual({});
  });

  it('2. round-trip — save 후 load 동일 값', async () => {
    const { loadJobMetrics, saveJobMetrics } = await import('./jobMetricsRepo.js');
    const input = {
      ghost_portfolio: {
        jobName: 'ghost_portfolio',
        runCount: 5,
        successCount: 4,
        failCount: 1,
        skippedCount: 0,
        lastSuccessAt: '2026-04-30T06:40:00.000Z',
        lastFailureAt: '2026-04-29T06:40:00.000Z',
        lastErrorMessage: 'KIS timeout',
      },
    };
    saveJobMetrics(input);
    const loaded = loadJobMetrics();
    expect(loaded.ghost_portfolio).toEqual(input.ghost_portfolio);
  });

  it('3. 다중 job 영속화 — 모든 키 보존', async () => {
    const { loadJobMetrics, saveJobMetrics } = await import('./jobMetricsRepo.js');
    saveJobMetrics({
      a: { jobName: 'a', runCount: 1, successCount: 1, failCount: 0, skippedCount: 0 },
      b: { jobName: 'b', runCount: 2, successCount: 0, failCount: 2, skippedCount: 0 },
      c: { jobName: 'c', runCount: 3, successCount: 0, failCount: 0, skippedCount: 3, lastSkipReason: 'WEEKEND' },
    });
    const loaded = loadJobMetrics();
    expect(Object.keys(loaded).sort()).toEqual(['a', 'b', 'c']);
    expect(loaded.c.lastSkipReason).toBe('WEEKEND');
  });

  it('4. 손상 JSON → 빈 객체 graceful fallback', async () => {
    fs.writeFileSync(path.join(tmpDir, 'job-metrics.json'), '{ corrupted');
    const { loadJobMetrics } = await import('./jobMetricsRepo.js');
    expect(loadJobMetrics()).toEqual({});
  });

  it('5. null/array 직접 저장 → 빈 객체 fallback', async () => {
    fs.writeFileSync(path.join(tmpDir, 'job-metrics.json'), 'null');
    const { loadJobMetrics: loadNull } = await import('./jobMetricsRepo.js');
    expect(loadNull()).toEqual({});

    vi.resetModules();
    fs.writeFileSync(path.join(tmpDir, 'job-metrics.json'), '[]');
    const { loadJobMetrics: loadArr } = await import('./jobMetricsRepo.js');
    expect(loadArr()).toEqual({});
  });

  it('6. 잘못된 type 필드 → 안전 fallback (NaN/string runCount → 0)', async () => {
    fs.writeFileSync(path.join(tmpDir, 'job-metrics.json'), JSON.stringify({
      bad: { jobName: 'bad', runCount: 'NaN', successCount: null, failCount: undefined, skippedCount: -Infinity },
    }));
    const { loadJobMetrics } = await import('./jobMetricsRepo.js');
    const loaded = loadJobMetrics();
    // -Infinity 는 isFinite=false 라 0 으로 fallback
    expect(loaded.bad.runCount).toBe(0);
    expect(loaded.bad.successCount).toBe(0);
    expect(loaded.bad.failCount).toBe(0);
    expect(loaded.bad.skippedCount).toBe(0);
  });

  it('7. atomic write — race 시 이전 본 보존 (tmp→rename)', async () => {
    const { saveJobMetrics } = await import('./jobMetricsRepo.js');
    saveJobMetrics({ a: { jobName: 'a', runCount: 1, successCount: 1, failCount: 0, skippedCount: 0 } });
    // 정상 파일만 존재 — tmp 파일 부재
    const file = path.join(tmpDir, 'job-metrics.json');
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.existsSync(`${file}.tmp`)).toBe(false);
  });

  it('8. __resetJobMetricsFileForTests — 파일 삭제', async () => {
    const { saveJobMetrics, __resetJobMetricsFileForTests } = await import('./jobMetricsRepo.js');
    saveJobMetrics({ a: { jobName: 'a', runCount: 1, successCount: 1, failCount: 0, skippedCount: 0 } });
    expect(fs.existsSync(path.join(tmpDir, 'job-metrics.json'))).toBe(true);
    __resetJobMetricsFileForTests();
    expect(fs.existsSync(path.join(tmpDir, 'job-metrics.json'))).toBe(false);
  });

  it('9. __resetJobMetricsFileForTests — 파일 부재 시 noop', async () => {
    const { __resetJobMetricsFileForTests } = await import('./jobMetricsRepo.js');
    expect(() => __resetJobMetricsFileForTests()).not.toThrow();
  });

  it('10. jobName 부재 entry → 무시 (영속 무결성)', async () => {
    fs.writeFileSync(path.join(tmpDir, 'job-metrics.json'), JSON.stringify({
      bad: { runCount: 5 }, // jobName 없음
      good: { jobName: 'good', runCount: 3, successCount: 3, failCount: 0, skippedCount: 0 },
    }));
    const { loadJobMetrics } = await import('./jobMetricsRepo.js');
    const loaded = loadJobMetrics();
    expect(loaded.bad).toBeUndefined();
    expect(loaded.good.runCount).toBe(3);
  });
});
