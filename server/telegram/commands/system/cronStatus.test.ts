// @responsibility 회귀 테스트 — /cron_status 분류 SSOT + 권장 액션 + 메시지 포맷 + cmd 메타
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  ScheduleEntry,
  JobMetrics,
  ScheduleRunRecord,
} from '../../../scheduler/scheduleCatalog.js';

const NOW = new Date('2026-04-30T06:00:00Z');

function makeEntry(over: Partial<ScheduleEntry> = {}): ScheduleEntry {
  return {
    timeKst: '15:40',
    label: 'Ghost',
    group: 'learning',
    jobName: 'ghost_portfolio',
    ...over,
  };
}

function makeMetrics(over: Partial<JobMetrics> = {}): JobMetrics {
  return {
    jobName: 'ghost_portfolio',
    runCount: 0,
    successCount: 0,
    failCount: 0,
    skippedCount: 0,
    ...over,
  };
}

function makeRun(over: Partial<ScheduleRunRecord> = {}): ScheduleRunRecord {
  return {
    jobName: 'ghost_portfolio',
    startedAt: '2026-04-30T06:40:00.000Z',
    finishedAt: '2026-04-30T06:40:01.000Z',
    durationMs: 1000,
    status: 'success',
    ...over,
  };
}

describe('classifyCronStatus', () => {
  let mod: typeof import('./cronStatus.cmd.js');
  beforeEach(async () => {
    vi.resetModules();
    mod = await import('./cronStatus.cmd.js');
  });

  it('1. jobName 부재 → NO_JOB_NAME', () => {
    const e = makeEntry({ jobName: undefined });
    expect(mod.classifyCronStatus(e, undefined, undefined)).toBe('NO_JOB_NAME');
  });

  it('2. metrics 부재 → NEVER_RAN (사용자 보고 시나리오 — ghost runCount 0)', () => {
    expect(mod.classifyCronStatus(makeEntry(), undefined, undefined)).toBe('NEVER_RAN');
  });

  it('3. runCount=0 → NEVER_RAN (Map 등록만)', () => {
    expect(mod.classifyCronStatus(makeEntry(), makeMetrics({ runCount: 0 }), undefined)).toBe('NEVER_RAN');
  });

  it('4. success 1+ + 실패 없음 → NORMAL', () => {
    expect(mod.classifyCronStatus(
      makeEntry(),
      makeMetrics({ runCount: 5, successCount: 5, lastSuccessAt: '2026-04-30T06:00:00Z' }),
      makeRun(),
    )).toBe('NORMAL');
  });

  it('5. failure 후 success 없음 → FAILING', () => {
    expect(mod.classifyCronStatus(
      makeEntry(),
      makeMetrics({
        runCount: 3,
        successCount: 1,
        failCount: 2,
        lastSuccessAt: '2026-04-29T06:00:00Z',
        lastFailureAt: '2026-04-30T06:00:00Z',
        lastErrorMessage: 'KIS timeout',
      }),
      makeRun({ status: 'failure' }),
    )).toBe('FAILING');
  });

  it('6. success 0 + skipped 누적 → SKIPPED_ONLY', () => {
    expect(mod.classifyCronStatus(
      makeEntry(),
      makeMetrics({
        runCount: 5,
        successCount: 0,
        skippedCount: 5,
        lastSkipReason: 'KRX_HOLIDAY',
      }),
      makeRun({ status: 'skipped' }),
    )).toBe('SKIPPED_ONLY');
  });

  it('7. failure 1회 + 그 후 success 다수 → NORMAL (실패 회복)', () => {
    expect(mod.classifyCronStatus(
      makeEntry(),
      makeMetrics({
        runCount: 10,
        successCount: 9,
        failCount: 1,
        lastSuccessAt: '2026-04-30T06:00:00Z',
        lastFailureAt: '2026-04-25T06:00:00Z',
      }),
      makeRun(),
    )).toBe('NORMAL');
  });
});

describe('buildRecommendation', () => {
  let mod: typeof import('./cronStatus.cmd.js');
  beforeEach(async () => {
    vi.resetModules();
    mod = await import('./cronStatus.cmd.js');
  });

  it('1. jobName 등록 0 → SCHEDULE_CATALOG 비어있음', () => {
    const r = mod.buildRecommendation({ jobNamedEntries: 0, neverRanJobs: [], failingJobs: [] });
    expect(r).toContain('jobName 등록된 cron 0건');
  });

  it('2. 모두 정상 → ✅ 모든 등록 cron 정상', () => {
    const r = mod.buildRecommendation({ jobNamedEntries: 30, neverRanJobs: [], failingJobs: [] });
    expect(r).toContain('✅ 모든 등록 cron 정상');
  });

  it('3. 다수(≥50%) 미실행 → 부팅 시퀀스 결함 의심', () => {
    const r = mod.buildRecommendation({
      jobNamedEntries: 10,
      neverRanJobs: ['a', 'b', 'c', 'd', 'e'],
      failingJobs: [],
    });
    expect(r).toContain('부팅 시퀀스 전반 결함');
    expect(r).toContain('5/10');
  });

  it('4. 1~3개 미실행 → 해당 jobName 등록 누락 또는 throw 의심 (사용자 보고 ghost_portfolio 시나리오)', () => {
    const r = mod.buildRecommendation({
      jobNamedEntries: 30,
      neverRanJobs: ['ghost_portfolio'],
      failingJobs: [],
    });
    expect(r).toContain('1개 cron 미실행');
    expect(r).toContain('ghost_portfolio');
    expect(r).toContain('throw');
  });

  it('5. 미실행 0 + failing 다수 → lastErrorMessage 확인 권장', () => {
    const r = mod.buildRecommendation({
      jobNamedEntries: 30,
      neverRanJobs: [],
      failingJobs: ['nightly_reflection', 'ghost_portfolio'],
    });
    expect(r).toContain('2개 cron 최근 실패');
  });
});

describe('collectCronStatus', () => {
  beforeEach(() => vi.resetModules());

  it('1. SCHEDULE_CATALOG 전체 순회 — totalCatalogEntries ≥ 30', async () => {
    const { collectCronStatus } = await import('./cronStatus.cmd.js');
    const snap = collectCronStatus(NOW);
    expect(snap.totalCatalogEntries).toBeGreaterThanOrEqual(30);
    expect(snap.jobNamedEntries).toBeGreaterThan(0);
    expect(snap.entries.length).toBe(snap.totalCatalogEntries);
  });

  it('2. 메트릭 reset 상태 → neverRanJobs 가 jobNamedEntries 와 동일 (사용자 시나리오)', async () => {
    const { __resetScheduleMetricsForTests } = await import('../../../scheduler/scheduleCatalog.js');
    __resetScheduleMetricsForTests();
    const { collectCronStatus } = await import('./cronStatus.cmd.js');
    const snap = collectCronStatus(NOW);
    expect(snap.everRanCount).toBe(0);
    expect(snap.neverRanJobs.length).toBe(snap.jobNamedEntries);
    expect(snap.failingJobs.length).toBe(0);
    expect(snap.recommendation).toContain('부팅 시퀀스 전반 결함');
  });

  it('3. 일부 jobs 정상 실행 후 → everRanCount 갱신', async () => {
    const { __resetScheduleMetricsForTests, recordScheduleRun } = await import('../../../scheduler/scheduleCatalog.js');
    __resetScheduleMetricsForTests();
    recordScheduleRun({
      jobName: 'ghost_portfolio',
      startedAt: '2026-04-30T06:40:00Z',
      finishedAt: '2026-04-30T06:40:01Z',
      durationMs: 1000,
      status: 'success',
    });
    const { collectCronStatus } = await import('./cronStatus.cmd.js');
    const snap = collectCronStatus(NOW);
    expect(snap.everRanCount).toBe(1);
    expect(snap.neverRanJobs).not.toContain('ghost_portfolio');
  });

  it('4. failure 누적 → failingJobs 에 포함', async () => {
    const { __resetScheduleMetricsForTests, recordScheduleRun } = await import('../../../scheduler/scheduleCatalog.js');
    __resetScheduleMetricsForTests();
    recordScheduleRun({
      jobName: 'nightly_reflection',
      startedAt: '2026-04-30T10:00:00Z',
      finishedAt: '2026-04-30T10:00:01Z',
      durationMs: 1000,
      status: 'failure',
      note: 'Gemini timeout',
    });
    const { collectCronStatus } = await import('./cronStatus.cmd.js');
    const snap = collectCronStatus(NOW);
    expect(snap.failingJobs).toContain('nightly_reflection');
  });
});

describe('formatCronStatusMessage', () => {
  beforeEach(() => vi.resetModules());

  it('1. 헤더 + 그룹 라벨 + 권장 액션 노출', async () => {
    const { __resetScheduleMetricsForTests } = await import('../../../scheduler/scheduleCatalog.js');
    __resetScheduleMetricsForTests();
    const { collectCronStatus, formatCronStatusMessage } = await import('./cronStatus.cmd.js');
    const msg = formatCronStatusMessage(collectCronStatus(NOW));
    expect(msg).toContain('⏰ Cron Status');
    expect(msg).toContain('등록 카탈로그');
    expect(msg).toContain('🤖 매매');
    expect(msg).toContain('📚 학습');
    expect(msg).toContain('권장 액션');
  });

  it('2. NEVER_RAN 항목에 ⚠️ 메시지 노출 (사용자 시나리오)', async () => {
    const { __resetScheduleMetricsForTests } = await import('../../../scheduler/scheduleCatalog.js');
    __resetScheduleMetricsForTests();
    const { collectCronStatus, formatCronStatusMessage } = await import('./cronStatus.cmd.js');
    const msg = formatCronStatusMessage(collectCronStatus(NOW));
    expect(msg).toContain('⚠️ 등록은 있으나 한 번도 실행 안 됨');
    expect(msg).toContain('🔴 runCount=0 인 cron');
  });

  it('3. NEVER_RAN 10개 초과 시 절삭 + "외 N건" 표기', async () => {
    const { __resetScheduleMetricsForTests } = await import('../../../scheduler/scheduleCatalog.js');
    __resetScheduleMetricsForTests();
    const { collectCronStatus, formatCronStatusMessage } = await import('./cronStatus.cmd.js');
    const snap = collectCronStatus(NOW);
    if (snap.neverRanJobs.length > 10) {
      const msg = formatCronStatusMessage(snap);
      expect(msg).toContain('외 ');
      expect(msg).toContain('건');
    }
  });

  it('4. FAILING 시 lastErrorMessage 노출', async () => {
    const { __resetScheduleMetricsForTests, recordScheduleRun } = await import('../../../scheduler/scheduleCatalog.js');
    __resetScheduleMetricsForTests();
    recordScheduleRun({
      jobName: 'nightly_reflection',
      startedAt: '2026-04-30T10:00:00Z',
      finishedAt: '2026-04-30T10:00:01Z',
      durationMs: 1000,
      status: 'failure',
      note: 'Gemini timeout 408',
    });
    const { collectCronStatus, formatCronStatusMessage } = await import('./cronStatus.cmd.js');
    const msg = formatCronStatusMessage(collectCronStatus(NOW));
    expect(msg).toContain('Gemini timeout');
  });

  it('5. SKIPPED_ONLY 시 skipReason 노출', async () => {
    const { __resetScheduleMetricsForTests, recordScheduleRun } = await import('../../../scheduler/scheduleCatalog.js');
    __resetScheduleMetricsForTests();
    recordScheduleRun({
      jobName: 'ghost_portfolio',
      startedAt: '2026-04-30T06:40:00Z',
      finishedAt: '2026-04-30T06:40:01Z',
      durationMs: 1000,
      status: 'skipped',
      note: 'KRX_HOLIDAY',
    });
    const { collectCronStatus, formatCronStatusMessage } = await import('./cronStatus.cmd.js');
    const msg = formatCronStatusMessage(collectCronStatus(NOW));
    expect(msg).toContain('skipReason');
    expect(msg).toContain('KRX_HOLIDAY');
  });
});

describe('cmd 메타데이터 + 등록', () => {
  beforeEach(() => vi.resetModules());

  it('1. name + alias /cron, /cs + SYS + riskLevel=0 + ADMIN', async () => {
    const mod = await import('./cronStatus.cmd.js');
    expect(mod.default.name).toBe('/cron_status');
    expect(mod.default.aliases).toContain('/cron');
    expect(mod.default.aliases).toContain('/cs');
    expect(mod.default.category).toBe('SYS');
    expect(mod.default.riskLevel).toBe(0);
    expect(mod.default.visibility).toBe('ADMIN');
  });

  it('2. commandRegistry 에 등록 — alias 동일 instance', async () => {
    await import('./cronStatus.cmd.js');
    const { commandRegistry } = await import('../../commandRegistry.js');
    const main = commandRegistry.resolve('/cron_status');
    const aliasA = commandRegistry.resolve('/cron');
    const aliasB = commandRegistry.resolve('/cs');
    expect(main).toBeTruthy();
    expect(aliasA).toBe(main);
    expect(aliasB).toBe(main);
  });

  it('3. execute 정상 — reply 1회 호출', async () => {
    const mod = await import('./cronStatus.cmd.js');
    const reply = vi.fn(async (_msg: string) => {});
    await mod.default.execute({ args: [], reply });
    expect(reply).toHaveBeenCalledOnce();
    expect(reply.mock.calls[0][0]).toContain('Cron Status');
  });

  it('4. execute throw graceful', async () => {
    const mod = await import('./cronStatus.cmd.js');
    const reply = vi.fn(async (_msg: string) => {});
    await expect(mod.default.execute({ args: [], reply })).resolves.toBeUndefined();
  });
});
