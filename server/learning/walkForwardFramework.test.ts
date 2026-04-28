// @responsibility walkForwardFramework 회귀 테스트 — 통계 + Rolling + Regime + Decay + 진입점.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

async function loadFramework() {
  return import('./walkForwardFramework.js');
}

async function loadRepo() {
  return import('../persistence/walkForwardResultsRepo.js');
}

const ENV_KEYS = [
  'WALK_FORWARD_FRAMEWORK_DISABLED',
  'WALK_FORWARD_IS_DAYS',
  'WALK_FORWARD_OOS_DAYS',
  'WALK_FORWARD_STEP_DAYS',
  'WALK_FORWARD_MAX_WINDOWS',
];

function makeRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `rec_${Math.random().toString(36).slice(2)}`,
    stockCode: '005930',
    stockName: '삼성전자',
    signalTime: '2026-03-15T01:00:00Z',
    priceAtRecommend: 70000,
    stopLoss: 65000,
    targetPrice: 80000,
    kellyPct: 0.2,
    gateScore: 9,
    signalType: 'BUY',
    status: 'WIN',
    actualReturn: 5.0,
    resolvedAt: '2026-03-25T01:00:00Z',
    ...overrides,
  };
}

describe('walkForwardFramework — 통계 산출', () => {
  beforeEach(() => { vi.resetModules(); });

  it('computeMaxDrawdown — 빈 입력 0', async () => {
    const f = await loadFramework();
    expect(f.computeMaxDrawdown([])).toBe(0);
  });

  it('computeMaxDrawdown — 단조 상승 0', async () => {
    const f = await loadFramework();
    expect(f.computeMaxDrawdown([5, 3, 10, 2])).toBeCloseTo(0, 1);
  });

  it('computeMaxDrawdown — 음수 누적 시 양수 반환', async () => {
    const f = await loadFramework();
    const dd = f.computeMaxDrawdown([10, -20, -10]);
    expect(dd).toBeGreaterThan(0);
  });

  it('computeMaxDrawdown — NaN 입력 0 fallback', async () => {
    const f = await loadFramework();
    expect(f.computeMaxDrawdown([NaN, NaN])).toBe(0);
  });

  it('computeSharpe — 표본 < 2 → 0', async () => {
    const f = await loadFramework();
    expect(f.computeSharpe([])).toBe(0);
    expect(f.computeSharpe([5])).toBe(0);
  });

  it('computeSharpe — stdev=0 → 0 (모두 동일값)', async () => {
    const f = await loadFramework();
    expect(f.computeSharpe([1, 1, 1, 1])).toBe(0);
  });

  it('computeSharpe — 정상 mean/stdev', async () => {
    const f = await loadFramework();
    const sharpe = f.computeSharpe([2, -1, 3, 1]);
    expect(sharpe).toBeGreaterThan(0);
  });

  it('computeWindowMetrics — 빈 입력 sampleSize=0', async () => {
    const f = await loadFramework();
    const m = f.computeWindowMetrics([]);
    expect(m.sampleSize).toBe(0);
    expect(m.winRate).toBe(0);
  });

  it('computeWindowMetrics — WIN/LOSS/EXPIRED 혼재', async () => {
    const f = await loadFramework();
    const records = [
      makeRecord({ status: 'WIN', actualReturn: 10 }),
      makeRecord({ status: 'WIN', actualReturn: 5 }),
      makeRecord({ status: 'LOSS', actualReturn: -3 }),
      makeRecord({ status: 'EXPIRED', actualReturn: 0 }),
    ] as unknown as Parameters<typeof f.computeWindowMetrics>[0];
    const m = f.computeWindowMetrics(records);
    expect(m.sampleSize).toBe(4);
    expect(m.winRate).toBeCloseTo(2 / 3, 3);
    expect(m.avgReturn).toBeCloseTo(3, 3);
  });

  it('computeWindowMetrics — winLoss=0 (전부 EXPIRED) → winRate=0', async () => {
    const f = await loadFramework();
    const records = [
      makeRecord({ status: 'EXPIRED', actualReturn: 0 }),
      makeRecord({ status: 'EXPIRED', actualReturn: 0 }),
    ] as unknown as Parameters<typeof f.computeWindowMetrics>[0];
    const m = f.computeWindowMetrics(records);
    expect(m.winRate).toBe(0);
    expect(m.sampleSize).toBe(2);
  });
});

describe('walkForwardFramework — Rolling window 산출', () => {
  beforeEach(() => { vi.resetModules(); });

  it('generateRollingWindows — 1개 윈도우 정합', async () => {
    const f = await loadFramework();
    const now = Date.parse('2026-04-28T00:00:00Z');
    const windows = f.generateRollingWindows(now, 60, 30, 7, 1);
    expect(windows).toHaveLength(1);
    const w = windows[0];
    expect(w.outSampleEndMs).toBe(now);
    expect(w.outSampleEndMs - w.outSampleStartMs).toBe(30 * 86400000);
    expect(w.inSampleEndMs).toBe(w.outSampleStartMs);
    expect(w.inSampleEndMs - w.inSampleStartMs).toBe(60 * 86400000);
  });

  it('generateRollingWindows — N개 윈도우 step 슬라이딩', async () => {
    const f = await loadFramework();
    const now = Date.parse('2026-04-28T00:00:00Z');
    const windows = f.generateRollingWindows(now, 60, 30, 7, 3);
    expect(windows).toHaveLength(3);
    // 정렬: 가장 최근이 마지막
    const last = windows[windows.length - 1];
    expect(last.outSampleEndMs).toBe(now);
    // 직전 윈도우는 step 만큼 과거
    const prev = windows[windows.length - 2];
    expect(prev.outSampleEndMs).toBe(now - 7 * 86400000);
  });

  it('generateRollingWindows — isStart ≤ 0 보호', async () => {
    const f = await loadFramework();
    const now = 100 * 86400000; // 100일 후
    const windows = f.generateRollingWindows(now, 60, 30, 7, 100);
    // 모든 윈도우가 isStart > 0 만 포함
    for (const w of windows) {
      expect(w.inSampleStartMs).toBeGreaterThan(0);
    }
  });
});

describe('walkForwardFramework — Regime 분리', () => {
  beforeEach(() => { vi.resetModules(); });

  it('computeRegimeBreakdown — 표본 부족 regime 제외', async () => {
    const f = await loadFramework();
    const isRecs = [
      makeRecord({ entryRegime: 'R2_BULL', status: 'WIN', actualReturn: 5 }),
      makeRecord({ entryRegime: 'R2_BULL', status: 'WIN', actualReturn: 3 }),
      makeRecord({ entryRegime: 'R2_BULL', status: 'LOSS', actualReturn: -2 }),
      makeRecord({ entryRegime: 'R5_CAUTION', status: 'WIN', actualReturn: 4 }),
    ] as unknown as Parameters<typeof f.computeRegimeBreakdown>[0];
    const oosRecs: typeof isRecs = [];
    const result = f.computeRegimeBreakdown(isRecs, oosRecs, 3);
    expect(Object.keys(result)).toContain('R2_BULL');
    // R5_CAUTION 은 표본 1건 — 제외
    expect(Object.keys(result)).not.toContain('R5_CAUTION');
  });

  it('computeRegimeBreakdown — entryRegime 부재 → UNKNOWN 그룹', async () => {
    const f = await loadFramework();
    const recs = Array.from({ length: 4 }, () =>
      makeRecord({ entryRegime: undefined, status: 'WIN', actualReturn: 1 }),
    ) as unknown as Parameters<typeof f.computeRegimeBreakdown>[0];
    const result = f.computeRegimeBreakdown(recs, [], 3);
    expect(Object.keys(result)).toContain('UNKNOWN');
  });
});

describe('walkForwardFramework — Decay trend', () => {
  beforeEach(() => { vi.resetModules(); });

  function makeWin(id: string, oosWr: number, ts: string) {
    return {
      windowId: id,
      inSampleStart: '', inSampleEnd: '', outSampleStart: '', outSampleEnd: '',
      isMetrics: { sampleSize: 10, winRate: 0.5, avgReturn: 1, totalReturn: 5, sharpe: 0.3, maxDrawdown: 5 },
      oosMetrics: { sampleSize: 10, winRate: oosWr, avgReturn: 1, totalReturn: 5, sharpe: 0.3, maxDrawdown: 5 },
      degradation: 0,
      computedAt: ts,
    };
  }

  it('표본 부족 → INSUFFICIENT', async () => {
    const f = await loadFramework();
    const windows = [makeWin('a', 0.5, '2026-01-01T00:00:00Z')];
    expect(f.computeDecayTrend(windows)).toBe('INSUFFICIENT');
  });

  it('정상 STABLE', async () => {
    const f = await loadFramework();
    const windows = Array.from({ length: 9 }, (_, i) =>
      makeWin(`w${i}`, 0.55, `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`),
    );
    expect(f.computeDecayTrend(windows)).toBe('STABLE');
  });

  it('명확한 DECAYING — 초기 1/3 0.7 vs 최근 1/3 0.4', async () => {
    const f = await loadFramework();
    const windows = [
      ...Array.from({ length: 3 }, (_, i) => makeWin(`a${i}`, 0.7, `2026-01-0${i + 1}T00:00:00Z`)),
      ...Array.from({ length: 3 }, (_, i) => makeWin(`b${i}`, 0.55, `2026-01-1${i + 1}T00:00:00Z`)),
      ...Array.from({ length: 3 }, (_, i) => makeWin(`c${i}`, 0.4, `2026-02-0${i + 1}T00:00:00Z`)),
    ];
    expect(f.computeDecayTrend(windows)).toBe('DECAYING');
  });

  it('명확한 IMPROVING — 초기 0.4 vs 최근 0.7', async () => {
    const f = await loadFramework();
    const windows = [
      ...Array.from({ length: 3 }, (_, i) => makeWin(`a${i}`, 0.4, `2026-01-0${i + 1}T00:00:00Z`)),
      ...Array.from({ length: 3 }, (_, i) => makeWin(`b${i}`, 0.55, `2026-01-1${i + 1}T00:00:00Z`)),
      ...Array.from({ length: 3 }, (_, i) => makeWin(`c${i}`, 0.7, `2026-02-0${i + 1}T00:00:00Z`)),
    ];
    expect(f.computeDecayTrend(windows)).toBe('IMPROVING');
  });

  it('thresholdPctPt 커스텀 — 5%p 변화도 STABLE 으로 잡으려면 threshold 10%p', async () => {
    const f = await loadFramework();
    const windows = [
      ...Array.from({ length: 3 }, (_, i) => makeWin(`a${i}`, 0.5, `2026-01-0${i + 1}T00:00:00Z`)),
      ...Array.from({ length: 3 }, (_, i) => makeWin(`b${i}`, 0.55, `2026-01-1${i + 1}T00:00:00Z`)),
      ...Array.from({ length: 3 }, (_, i) => makeWin(`c${i}`, 0.55, `2026-02-0${i + 1}T00:00:00Z`)),
    ];
    expect(f.computeDecayTrend(windows, 6, 10)).toBe('STABLE');
  });
});

describe('walkForwardFramework — runWalkForwardFramework', () => {
  let tmpDir: string;
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-fw-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    for (const k of ENV_KEYS) {
      originalEnv[k] = process.env[k];
      delete process.env[k];
    }
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    for (const k of ENV_KEYS) {
      if (originalEnv[k] === undefined) delete process.env[k];
      else process.env[k] = originalEnv[k];
    }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  it('FRAMEWORK_DISABLED=true → skipped DISABLED', async () => {
    process.env.WALK_FORWARD_FRAMEWORK_DISABLED = 'true';
    vi.resetModules();
    const f = await loadFramework();
    const result = await f.runWalkForwardFramework();
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('DISABLED');
  });

  it('records 0건 → skipped NO_RECORDS', async () => {
    vi.doMock('./recommendationTracker.js', () => ({
      getRecommendations: () => [],
    }));
    const f = await loadFramework();
    const result = await f.runWalkForwardFramework({ now: Date.parse('2026-04-28T00:00:00Z') });
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('NO_RECORDS');
  });

  it('표본 충분 시 윈도우 영속 + summary 산출', async () => {
    // 6개월 데이터 mock
    const baseRecs: Record<string, unknown>[] = [];
    const now = Date.parse('2026-04-28T00:00:00Z');
    for (let i = 0; i < 30; i += 1) {
      const offset = i * 5; // 5일씩
      const t = now - offset * 86400000;
      baseRecs.push(makeRecord({
        signalTime: new Date(t).toISOString(),
        status: i % 2 === 0 ? 'WIN' : 'LOSS',
        actualReturn: i % 2 === 0 ? 3 : -2,
        entryRegime: 'R2_BULL',
      }));
    }
    vi.doMock('./recommendationTracker.js', () => ({
      getRecommendations: () => baseRecs,
    }));
    const f = await loadFramework();
    const result = await f.runWalkForwardFramework({ now });
    expect(result.skipped).toBe(false);
    expect(result.results).toBeDefined();
    expect(result.results!.windows.length).toBeGreaterThan(0);
    expect(result.results!.summary.totalWindows).toBeGreaterThan(0);
  });

  it('영속 결과 read-back 정합', async () => {
    const baseRecs: Record<string, unknown>[] = [];
    const now = Date.parse('2026-04-28T00:00:00Z');
    for (let i = 0; i < 30; i += 1) {
      baseRecs.push(makeRecord({
        signalTime: new Date(now - i * 5 * 86400000).toISOString(),
        status: i % 3 === 0 ? 'WIN' : 'LOSS',
        actualReturn: i % 3 === 0 ? 5 : -3,
      }));
    }
    vi.doMock('./recommendationTracker.js', () => ({
      getRecommendations: () => baseRecs,
    }));
    const f = await loadFramework();
    await f.runWalkForwardFramework({ now });
    const repo = await loadRepo();
    const reread = repo.loadWalkForwardResults();
    expect(reread.windows.length).toBeGreaterThan(0);
    expect(reread.summary.totalWindows).toBe(reread.windows.length);
  });

  it('getResolvedConfig — ENV 반영', async () => {
    process.env.WALK_FORWARD_IS_DAYS = '90';
    process.env.WALK_FORWARD_OOS_DAYS = '21';
    process.env.WALK_FORWARD_STEP_DAYS = '14';
    process.env.WALK_FORWARD_MAX_WINDOWS = '12';
    vi.resetModules();
    const f = await loadFramework();
    const c = f.getResolvedConfig();
    expect(c.isDays).toBe(90);
    expect(c.oosDays).toBe(21);
    expect(c.stepDays).toBe(14);
    expect(c.maxWindows).toBe(12);
  });

  it('getResolvedConfig — ENV 잘못된 값 → default fallback', async () => {
    process.env.WALK_FORWARD_IS_DAYS = 'NOT_A_NUMBER';
    process.env.WALK_FORWARD_OOS_DAYS = '-5';
    vi.resetModules();
    const f = await loadFramework();
    const c = f.getResolvedConfig();
    expect(c.isDays).toBe(60); // default
    expect(c.oosDays).toBe(30); // default (-5 < 1 fallback)
  });
});

describe('walkForwardFramework — computeSummary', () => {
  beforeEach(() => { vi.resetModules(); });

  function makeWin(degradation: number, ts: string) {
    return {
      windowId: `w${ts}`,
      inSampleStart: '', inSampleEnd: '', outSampleStart: '', outSampleEnd: '',
      isMetrics: { sampleSize: 10, winRate: 0.6, avgReturn: 1, totalReturn: 5, sharpe: 0.3, maxDrawdown: 5 },
      oosMetrics: { sampleSize: 10, winRate: 0.5, avgReturn: 1, totalReturn: 5, sharpe: 0.3, maxDrawdown: 5 },
      degradation,
      computedAt: ts,
    };
  }

  it('빈 windows → totalWindows=0 + INSUFFICIENT', async () => {
    const f = await loadFramework();
    const s = f.computeSummary([]);
    expect(s.totalWindows).toBe(0);
    expect(s.decayTrend).toBe('INSUFFICIENT');
  });

  it('overfitFlagged — degradation > 15%p 카운트', async () => {
    const f = await loadFramework();
    const windows = [
      makeWin(5, '2026-01-01T00:00:00Z'),
      makeWin(20, '2026-01-08T00:00:00Z'),
      makeWin(8, '2026-01-15T00:00:00Z'),
      makeWin(18, '2026-01-22T00:00:00Z'),
    ];
    const s = f.computeSummary(windows);
    expect(s.overfitFlagged).toBe(2);
    expect(s.totalWindows).toBe(4);
  });

  it('avgDegradation + medianDegradation 정확', async () => {
    const f = await loadFramework();
    const windows = [
      makeWin(2, '2026-01-01T00:00:00Z'),
      makeWin(4, '2026-01-08T00:00:00Z'),
      makeWin(6, '2026-01-15T00:00:00Z'),
    ];
    const s = f.computeSummary(windows);
    expect(s.avgDegradation).toBeCloseTo(4, 3);
    expect(s.medianDegradation).toBeCloseTo(4, 3);
  });
});
