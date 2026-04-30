// @responsibility 회귀 테스트 — /cron_introspect cross-check 분류 + 파일 trace + 권장 액션 + cmd 메타
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { JobMetrics, ScheduleRunRecord } from '../../../scheduler/scheduleCatalog.js';

const NOW = new Date('2026-04-30T06:00:00Z');

function makeMetrics(over: Partial<JobMetrics> = {}): JobMetrics {
  return {
    jobName: 'nightly_reflection',
    runCount: 0,
    successCount: 0,
    failCount: 0,
    skippedCount: 0,
    ...over,
  };
}

function isoNHoursAgo(n: number): string {
  return new Date(NOW.getTime() - n * 3600 * 1000).toISOString();
}

function isoNDaysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 24 * 3600 * 1000).toISOString();
}

describe('resolveVerifyPath', () => {
  let mod: typeof import('./cronIntrospect.cmd.js');
  beforeEach(async () => {
    vi.resetModules();
    mod = await import('./cronIntrospect.cmd.js');
  });

  it('1. nightly_reflection → REFLECTIONS_DIR', () => {
    const p = mod.resolveVerifyPath('nightly_reflection');
    expect(p).toBeTruthy();
    expect(p).toContain('reflections');
  });

  it('2. ghost_portfolio → ghost-portfolio.json', () => {
    const p = mod.resolveVerifyPath('ghost_portfolio');
    expect(p).toContain('ghost-portfolio.json');
  });

  it('3. f2w_reverse_loop → f2w-audit-log.json', () => {
    const p = mod.resolveVerifyPath('f2w_reverse_loop');
    expect(p).toContain('f2w-audit-log.json');
  });

  it('4. orchestrator_tick → trade-events-YYYYMM.jsonl (현재 월)', () => {
    const p = mod.resolveVerifyPath('orchestrator_tick');
    expect(p).toContain('trade-events-');
    expect(p).toMatch(/\.jsonl$/);
  });

  it('5. 알 수 없는 jobName → null (휴리스틱 매칭 실패)', () => {
    expect(mod.resolveVerifyPath('unknown_xyz_job')).toBeNull();
  });

  it('6. 휴리스틱 — "weight" 포함 → F2W audit', () => {
    expect(mod.resolveVerifyPath('weight_calibration')).toContain('f2w-audit-log.json');
  });

  it('7. 휴리스틱 — "reconcile" 포함 → reconcile-last.json', () => {
    expect(mod.resolveVerifyPath('daily_reconcile')).toContain('reconcile-last.json');
  });

  it('8. 휴리스틱 — "attribution" 포함', () => {
    expect(mod.resolveVerifyPath('attribution_analyzer')).toContain('attribution-records.json');
  });
});

describe('inspectFileTrace', () => {
  let tmpDir: string;
  let mod: typeof import('./cronIntrospect.cmd.js');
  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'introspect-'));
    vi.resetModules();
    mod = await import('./cronIntrospect.cmd.js');
  });
  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  it('1. 파일 부재 → exists=false', () => {
    const trace = mod.inspectFileTrace(path.join(tmpDir, 'missing.json'), NOW);
    expect(trace.exists).toBe(false);
  });

  it('2. 단일 파일 + 최근 갱신 → lastModified 노출', () => {
    const file = path.join(tmpDir, 'ghost.json');
    fs.writeFileSync(file, '{}');
    const trace = mod.inspectFileTrace(file, NOW);
    expect(trace.exists).toBe(true);
    expect(trace.lastModified).toBeTruthy();
    expect(trace.recentFileCount).toBeUndefined(); // 디렉토리 아님
  });

  it('3. 디렉토리 — recentFileCount + mostRecentFile', () => {
    const dir = path.join(tmpDir, 'reflections');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, '2026-04-30.json'), '{}');
    fs.writeFileSync(path.join(dir, '2026-04-29.json'), '{}');
    const trace = mod.inspectFileTrace(dir, NOW);
    expect(trace.exists).toBe(true);
    expect(trace.recentFileCount).toBe(2);
    expect(trace.mostRecentFile).toBeTruthy();
  });

  it('4. 디렉토리 + 7일 초과 파일 → recentFileCount 제외', () => {
    const dir = path.join(tmpDir, 'old-dir');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'old.json'), '{}');
    // mtime 을 8일 전으로 설정
    const eightDaysAgo = NOW.getTime() - 8 * 24 * 3600 * 1000;
    fs.utimesSync(path.join(dir, 'old.json'), new Date(eightDaysAgo), new Date(eightDaysAgo));
    const trace = mod.inspectFileTrace(dir, NOW);
    expect(trace.recentFileCount).toBe(0);
  });
});

describe('classifyIntrospect', () => {
  let mod: typeof import('./cronIntrospect.cmd.js');
  beforeEach(async () => {
    vi.resetModules();
    mod = await import('./cronIntrospect.cmd.js');
  });

  it('1. trace 부재 → PATH_UNKNOWN', () => {
    const r = mod.classifyIntrospect(makeMetrics(), undefined, NOW);
    expect(r.verdict).toBe('PATH_UNKNOWN');
  });

  it('2. trace.error → PATH_INACCESSIBLE', () => {
    const r = mod.classifyIntrospect(undefined, { path: '/x', exists: false, error: 'EACCES' }, NOW);
    expect(r.verdict).toBe('PATH_INACCESSIBLE');
    expect(r.reasoning).toContain('EACCES');
  });

  it('3. 파일 부재 + 메트릭 0 → BOTH_QUIET', () => {
    const r = mod.classifyIntrospect(undefined, { path: '/x', exists: false }, NOW);
    expect(r.verdict).toBe('BOTH_QUIET');
    expect(r.reasoning).toContain('cron 진짜 미실행');
  });

  it('4. 파일 부재 + 메트릭 runCount=5 → CONTRADICTION (결과 누락)', () => {
    const r = mod.classifyIntrospect(makeMetrics({ runCount: 5 }), { path: '/x', exists: false }, NOW);
    expect(r.verdict).toBe('CONTRADICTION_METRICS_LIES');
  });

  it('5. **사용자 시나리오 핵심** — 메트릭 0 + 파일 최근 갱신 → CONTRADICTION_METRICS_LIES', () => {
    const r = mod.classifyIntrospect(
      makeMetrics({ runCount: 0 }),
      { path: '/x', exists: true, lastModified: isoNHoursAgo(2) },
      NOW,
    );
    expect(r.verdict).toBe('CONTRADICTION_METRICS_LIES');
    expect(r.reasoning).toContain('메모리 reset 또는 wiring 결함');
  });

  it('6. 메트릭 + 파일 모두 7일+ 미갱신 → BOTH_QUIET', () => {
    const r = mod.classifyIntrospect(
      makeMetrics({ runCount: 0 }),
      { path: '/x', exists: true, lastModified: isoNDaysAgo(10) },
      NOW,
    );
    expect(r.verdict).toBe('BOTH_QUIET');
    expect(r.reasoning).toContain('일+');
  });

  it('7. 메트릭 + 파일 모두 최근 갱신 → CONSISTENT', () => {
    const r = mod.classifyIntrospect(
      makeMetrics({ runCount: 5, successCount: 5 }),
      { path: '/x', exists: true, lastModified: isoNHoursAgo(2) },
      NOW,
    );
    expect(r.verdict).toBe('CONSISTENT');
  });

  it('8. 메트릭 ran + 파일 7일+ 미갱신 → CONTRADICTION (다른 경로 의심)', () => {
    const r = mod.classifyIntrospect(
      makeMetrics({ runCount: 5 }),
      { path: '/x', exists: true, lastModified: isoNDaysAgo(10) },
      NOW,
    );
    expect(r.verdict).toBe('CONTRADICTION_METRICS_LIES');
    expect(r.reasoning).toContain('다른 경로');
  });
});

describe('buildIntrospectEntry + collectIntrospect', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'introspect-data-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    vi.resetModules();
  });
  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  it('1. 핵심 4개 cron 자동 — 영속 부재 + 메트릭 reset → 모두 BOTH_QUIET 또는 CONTRADICTION', async () => {
    const { __resetScheduleMetricsForTests } = await import('../../../scheduler/scheduleCatalog.js');
    __resetScheduleMetricsForTests();
    const { collectIntrospect, CORE_JOBS } = await import('./cronIntrospect.cmd.js');
    const snap = collectIntrospect([...CORE_JOBS], NOW);
    expect(snap.entries.length).toBe(4);
    // 메트릭 reset + 파일 부재 → BOTH_QUIET 우세
    const bothQuietCount = snap.entries.filter((e) => e.verdict === 'BOTH_QUIET').length;
    expect(bothQuietCount).toBeGreaterThan(0);
  });

  it('2. **사용자 시나리오 재현** — 메트릭 0 + ghost 파일 최근 갱신 → CONTRADICTION_METRICS_LIES', async () => {
    const { __resetScheduleMetricsForTests } = await import('../../../scheduler/scheduleCatalog.js');
    __resetScheduleMetricsForTests();
    // ghost-portfolio.json 을 1시간 전 갱신으로 fixture
    const ghostFile = path.join(tmpDir, 'ghost-portfolio.json');
    fs.writeFileSync(ghostFile, JSON.stringify([{ stockCode: 'A' }]));
    const oneHourAgo = NOW.getTime() - 3600 * 1000;
    fs.utimesSync(ghostFile, new Date(oneHourAgo), new Date(oneHourAgo));
    const { buildIntrospectEntry } = await import('./cronIntrospect.cmd.js');
    const entry = buildIntrospectEntry('ghost_portfolio', NOW);
    expect(entry.verdict).toBe('CONTRADICTION_METRICS_LIES');
    expect(entry.reasoning).toContain('파일');
  });

  it('3. 정상 시나리오 — 메트릭 + 파일 모두 최근 → CONSISTENT', async () => {
    const { __resetScheduleMetricsForTests, recordScheduleRun } = await import('../../../scheduler/scheduleCatalog.js');
    __resetScheduleMetricsForTests();
    recordScheduleRun({
      jobName: 'ghost_portfolio',
      startedAt: '2026-04-30T06:00:00Z',
      finishedAt: '2026-04-30T06:00:01Z',
      durationMs: 1000,
      status: 'success',
    });
    const ghostFile = path.join(tmpDir, 'ghost-portfolio.json');
    fs.writeFileSync(ghostFile, JSON.stringify([{ stockCode: 'A' }]));
    const { buildIntrospectEntry } = await import('./cronIntrospect.cmd.js');
    const entry = buildIntrospectEntry('ghost_portfolio', NOW);
    expect(entry.verdict).toBe('CONSISTENT');
  });

  it('4. summary 카운트 산출', async () => {
    const { __resetScheduleMetricsForTests } = await import('../../../scheduler/scheduleCatalog.js');
    __resetScheduleMetricsForTests();
    const { collectIntrospect } = await import('./cronIntrospect.cmd.js');
    const snap = collectIntrospect(['nightly_reflection', 'ghost_portfolio'], NOW);
    expect(snap.summary.contradictionCount + snap.summary.bothQuietCount + snap.summary.consistentCount + snap.summary.unknownCount).toBe(2);
  });
});

describe('buildRecommendation', () => {
  let mod: typeof import('./cronIntrospect.cmd.js');
  beforeEach(async () => {
    vi.resetModules();
    mod = await import('./cronIntrospect.cmd.js');
  });

  it('1. total=0 → 검증 대상 0건', () => {
    const r = mod.buildRecommendation({ contradictionCount: 0, bothQuietCount: 0, consistentCount: 0, unknownCount: 0 }, 0);
    expect(r).toContain('0건');
  });

  it('2. ≥50% 모순 → 🚨 wiring 결함 확정 의심 + PR-Fix-JobMetrics 권장', () => {
    const r = mod.buildRecommendation({ contradictionCount: 3, bothQuietCount: 1, consistentCount: 0, unknownCount: 0 }, 4);
    expect(r).toContain('🚨');
    expect(r).toContain('wiring 결함');
    expect(r).toContain('PR-Fix-JobMetrics');
  });

  it('3. <50% 모순 → 일부 cron 메트릭 거짓', () => {
    const r = mod.buildRecommendation({ contradictionCount: 1, bothQuietCount: 0, consistentCount: 3, unknownCount: 0 }, 4);
    expect(r).toContain('1/4 모순');
    expect(r).toContain('일부');
  });

  it('4. 모두 BOTH_QUIET → cron 진짜 사망 + /cron_status 결합 권장', () => {
    const r = mod.buildRecommendation({ contradictionCount: 0, bothQuietCount: 4, consistentCount: 0, unknownCount: 0 }, 4);
    expect(r).toContain('진짜 사망');
    expect(r).toContain('/cron_status');
  });

  it('5. 모두 정상 → ✅', () => {
    const r = mod.buildRecommendation({ contradictionCount: 0, bothQuietCount: 0, consistentCount: 4, unknownCount: 0 }, 4);
    expect(r).toContain('✅');
    expect(r).toContain('정상');
  });
});

describe('formatIntrospectMessage', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'introspect-fmt-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    vi.resetModules();
  });
  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  it('1. 헤더 + JobMetrics 보고 + 파일 흔적 + 진단 + 종합 라인 모두 노출', async () => {
    const { __resetScheduleMetricsForTests } = await import('../../../scheduler/scheduleCatalog.js');
    __resetScheduleMetricsForTests();
    const { collectIntrospect, formatIntrospectMessage, CORE_JOBS } = await import('./cronIntrospect.cmd.js');
    const msg = formatIntrospectMessage(collectIntrospect([...CORE_JOBS], NOW));
    expect(msg).toContain('🔬 Cron Introspect');
    expect(msg).toContain('JobMetrics 보고');
    expect(msg).toContain('실제 파일 흔적');
    expect(msg).toContain('진단:');
    expect(msg).toContain('🎯 종합 진단');
    expect(msg).toContain('권장 액션');
  });

  it('2. CONTRADICTION 시 🚨 이모지 + reasoning 노출', async () => {
    const { __resetScheduleMetricsForTests } = await import('../../../scheduler/scheduleCatalog.js');
    __resetScheduleMetricsForTests();
    const ghostFile = path.join(tmpDir, 'ghost-portfolio.json');
    fs.writeFileSync(ghostFile, '[]');
    const oneHourAgo = NOW.getTime() - 3600 * 1000;
    fs.utimesSync(ghostFile, new Date(oneHourAgo), new Date(oneHourAgo));
    const { collectIntrospect, formatIntrospectMessage } = await import('./cronIntrospect.cmd.js');
    const msg = formatIntrospectMessage(collectIntrospect(['ghost_portfolio'], NOW));
    expect(msg).toContain('🚨');
    expect(msg).toContain('CONTRADICTION_METRICS_LIES');
    expect(msg).toContain('메모리 reset 또는 wiring 결함');
  });

  it('3. 4개 모두 모순 시 PR-Fix-JobMetrics 권장 라인 노출', async () => {
    const { __resetScheduleMetricsForTests } = await import('../../../scheduler/scheduleCatalog.js');
    __resetScheduleMetricsForTests();
    const ghostFile = path.join(tmpDir, 'ghost-portfolio.json');
    fs.writeFileSync(ghostFile, '[]');
    const f2wFile = path.join(tmpDir, 'f2w-audit-log.json');
    fs.writeFileSync(f2wFile, '[]');
    const oneHourAgo = NOW.getTime() - 3600 * 1000;
    fs.utimesSync(ghostFile, new Date(oneHourAgo), new Date(oneHourAgo));
    fs.utimesSync(f2wFile, new Date(oneHourAgo), new Date(oneHourAgo));
    const { collectIntrospect, formatIntrospectMessage } = await import('./cronIntrospect.cmd.js');
    const msg = formatIntrospectMessage(collectIntrospect(['ghost_portfolio', 'f2w_reverse_loop'], NOW));
    expect(msg).toContain('PR-Fix-JobMetrics');
  });
});

describe('cmd 메타데이터 + 등록', () => {
  beforeEach(() => vi.resetModules());

  it('1. name + alias /ci + SYS + riskLevel=0 + ADMIN', async () => {
    const mod = await import('./cronIntrospect.cmd.js');
    expect(mod.default.name).toBe('/cron_introspect');
    expect(mod.default.aliases).toContain('/ci');
    expect(mod.default.category).toBe('SYS');
    expect(mod.default.riskLevel).toBe(0);
    expect(mod.default.visibility).toBe('ADMIN');
  });

  it('2. commandRegistry — alias 동일 instance', async () => {
    await import('./cronIntrospect.cmd.js');
    const { commandRegistry } = await import('../../commandRegistry.js');
    const main = commandRegistry.resolve('/cron_introspect');
    const alias = commandRegistry.resolve('/ci');
    expect(main).toBeTruthy();
    expect(alias).toBe(main);
  });

  it('3. 인자 없음 → 핵심 4개 cron 자동 검증', async () => {
    const mod = await import('./cronIntrospect.cmd.js');
    const reply = vi.fn(async (_msg: string) => {});
    await mod.default.execute({ args: [], reply });
    expect(reply).toHaveBeenCalledOnce();
    const msg = reply.mock.calls[0][0] as string;
    expect(msg).toContain('nightly_reflection');
    expect(msg).toContain('ghost_portfolio');
    expect(msg).toContain('f2w_reverse_loop');
    expect(msg).toContain('orchestrator_tick');
  });

  it('4. 인자 jobName 명시 → 단일 검증', async () => {
    const mod = await import('./cronIntrospect.cmd.js');
    const reply = vi.fn(async (_msg: string) => {});
    await mod.default.execute({ args: ['ghost_portfolio'], reply });
    const msg = reply.mock.calls[0][0] as string;
    expect(msg).toContain('ghost_portfolio');
    // 다른 핵심 cron 은 미포함
    expect(msg).not.toContain('nightly_reflection');
  });

  it('5. execute throw graceful', async () => {
    const mod = await import('./cronIntrospect.cmd.js');
    const reply = vi.fn(async (_msg: string) => {});
    await expect(mod.default.execute({ args: [], reply })).resolves.toBeUndefined();
  });
});
