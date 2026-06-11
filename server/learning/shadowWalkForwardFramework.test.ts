// @responsibility shadowWalkForwardFramework 회귀 — adapter + window metrics + 진입점.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { RejectionShadowEntry } from './rejectionShadowTracker.js';
import type { TwinEntry } from './counterfactualTwinPortfolio.js';

async function loadFramework() {
  return import('./shadowWalkForwardFramework.js');
}

// warm-up 1회 — 최초 dynamic import 의 transform 비용(>5s)이 첫 테스트의 5s timeout 을
// 소진하던 선존 flake 수리 (walkForwardFramework.test.ts 와 동일 패턴).
beforeAll(async () => {
  await loadFramework();
  vi.resetModules();
}, 60_000);

const ENV_KEYS = [
  'SHADOW_WALK_FORWARD_DISABLED',
  'SHADOW_WALK_FORWARD_IS_DAYS',
  'SHADOW_WALK_FORWARD_OOS_DAYS',
  'SHADOW_WALK_FORWARD_STEP_DAYS',
  'SHADOW_WALK_FORWARD_MAX_WINDOWS',
];

function makeRejection(overrides: Partial<RejectionShadowEntry> = {}): RejectionShadowEntry {
  return {
    id: `r_${Math.random().toString(36).slice(2)}`,
    stockCode: '005930',
    stockName: '삼성전자',
    signalDate: '2026-04-15',
    signalPriceKrw: 70000,
    gateScore: 16,
    scoreDelta: 2,
    rejectionReason: 'Gate 1 미달',
    trackUntil: '2026-04-22',
    currentReturnPct: 3,
    closed: true,
    ...overrides,
  };
}

function makeTwin(overrides: Partial<TwinEntry> = {}): TwinEntry {
  return {
    id: `t_${Math.random().toString(36).slice(2)}`,
    twin: 'AGGRESSIVE',
    stockCode: '005930',
    stockName: '삼성전자',
    signalDate: '2026-04-15',
    signalGateScore: 18,
    entryPrice: 70000,
    positionWeight: 0.2,
    trackUntil: '2026-05-15',
    currentReturnPct: 5,
    status: 'CLOSED',
    ...overrides,
  };
}

describe('shadowWalkForwardFramework — adapter', () => {
  beforeEach(() => { vi.resetModules(); });

  it('rejectionToWindowRecord — closed → CLOSED', async () => {
    const f = await loadFramework();
    const rec = f.rejectionToWindowRecord(makeRejection({ closed: true, currentReturnPct: 7 }));
    expect(rec.status).toBe('CLOSED');
    expect(rec.source).toBe('REJECTION');
    expect(rec.returnPct).toBe(7);
    expect(rec.isWin).toBe(true); // ≥ 5%
  });

  it('rejectionToWindowRecord — closed=false → PENDING', async () => {
    const f = await loadFramework();
    const rec = f.rejectionToWindowRecord(makeRejection({ closed: false }));
    expect(rec.status).toBe('PENDING');
  });

  it('rejectionToWindowRecord — currentReturnPct < 5% → isWin false', async () => {
    const f = await loadFramework();
    const rec = f.rejectionToWindowRecord(makeRejection({ currentReturnPct: 3 }));
    expect(rec.isWin).toBe(false);
  });

  it('rejectionToWindowRecord — currentReturnPct = 5 boundary → isWin true', async () => {
    const f = await loadFramework();
    const rec = f.rejectionToWindowRecord(makeRejection({ currentReturnPct: 5 }));
    expect(rec.isWin).toBe(true);
  });

  it('rejectionToWindowRecord — currentReturnPct undefined → 0 fallback', async () => {
    const f = await loadFramework();
    const rec = f.rejectionToWindowRecord(makeRejection({ currentReturnPct: undefined }));
    expect(rec.returnPct).toBe(0);
    expect(rec.isWin).toBe(false);
  });

  it('twinToWindowRecord — CLOSED 정상', async () => {
    const f = await loadFramework();
    const rec = f.twinToWindowRecord(makeTwin({ status: 'CLOSED', currentReturnPct: 8 }));
    expect(rec.status).toBe('CLOSED');
    expect(rec.source).toBe('TWIN');
    expect(rec.twin).toBe('AGGRESSIVE');
    expect(rec.isWin).toBe(true);
  });

  it('twinToWindowRecord — currentReturnPct = 0 → isWin false', async () => {
    const f = await loadFramework();
    const rec = f.twinToWindowRecord(makeTwin({ currentReturnPct: 0 }));
    expect(rec.isWin).toBe(false);
  });

  it('twinToWindowRecord — DISCIPLINED twin', async () => {
    const f = await loadFramework();
    const rec = f.twinToWindowRecord(makeTwin({ twin: 'DISCIPLINED' }));
    expect(rec.twin).toBe('DISCIPLINED');
  });
});

describe('shadowWalkForwardFramework — computeShadowWindowMetrics', () => {
  beforeEach(() => { vi.resetModules(); });

  it('빈 입력 sampleSize=0', async () => {
    const f = await loadFramework();
    const m = f.computeShadowWindowMetrics([]);
    expect(m.sampleSize).toBe(0);
    expect(m.winRate).toBe(0);
  });

  it('isWin 비율 정확', async () => {
    const f = await loadFramework();
    const records = [
      { closedAt: '2026-04-15', returnPct: 10, status: 'CLOSED' as const, isWin: true,  source: 'REJECTION' as const },
      { closedAt: '2026-04-15', returnPct: 5,  status: 'CLOSED' as const, isWin: true,  source: 'REJECTION' as const },
      { closedAt: '2026-04-15', returnPct: -3, status: 'CLOSED' as const, isWin: false, source: 'REJECTION' as const },
    ];
    const m = f.computeShadowWindowMetrics(records);
    expect(m.sampleSize).toBe(3);
    expect(m.winRate).toBeCloseTo(2 / 3, 3);
    expect(m.avgReturn).toBeCloseTo(4, 2);
  });
});

describe('shadowWalkForwardFramework — computeShadowSummary', () => {
  beforeEach(() => { vi.resetModules(); });

  function makeWin(degradation: number, ts: string) {
    return {
      windowId: `shadow_${ts}`,
      inSampleStart: '', inSampleEnd: '', outSampleStart: '', outSampleEnd: '',
      isMetrics: { sampleSize: 10, winRate: 0.6, avgReturn: 1, totalReturn: 5, sharpe: 0.3, maxDrawdown: 5 },
      oosMetrics: { sampleSize: 10, winRate: 0.5, avgReturn: 1, totalReturn: 5, sharpe: 0.3, maxDrawdown: 5 },
      degradation,
      computedAt: ts,
    };
  }

  it('빈 windows → INSUFFICIENT', async () => {
    const f = await loadFramework();
    const s = f.computeShadowSummary([]);
    expect(s.totalWindows).toBe(0);
    expect(s.decayTrend).toBe('INSUFFICIENT');
  });

  it('overfitFlagged > 15%p 카운트', async () => {
    const f = await loadFramework();
    const windows = [
      makeWin(5, '2026-01-01T00:00:00Z'),
      makeWin(20, '2026-01-08T00:00:00Z'),
      makeWin(18, '2026-01-15T00:00:00Z'),
    ];
    const s = f.computeShadowSummary(windows);
    expect(s.overfitFlagged).toBe(2);
    expect(s.totalWindows).toBe(3);
  });

  it('avgDegradation + medianDegradation 정확', async () => {
    const f = await loadFramework();
    const windows = [
      makeWin(2, '2026-01-01T00:00:00Z'),
      makeWin(4, '2026-01-08T00:00:00Z'),
      makeWin(6, '2026-01-15T00:00:00Z'),
    ];
    const s = f.computeShadowSummary(windows);
    expect(s.avgDegradation).toBeCloseTo(4, 3);
    expect(s.medianDegradation).toBeCloseTo(4, 3);
  });
});

describe('shadowWalkForwardFramework — runShadowWalkForward', () => {
  let tmpDir: string;
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shadow-fw-'));
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
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('SHADOW_WALK_FORWARD_DISABLED=true → skipped DISABLED', async () => {
    process.env.SHADOW_WALK_FORWARD_DISABLED = 'true';
    vi.resetModules();
    const f = await loadFramework();
    const result = await f.runShadowWalkForward();
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('DISABLED');
  });

  it('records 0건 → skipped NO_RECORDS', async () => {
    vi.doMock('./rejectionShadowTracker.js', () => ({ getAllRejectionShadow: () => [] }));
    vi.doMock('./counterfactualTwinPortfolio.js', () => ({ getAllTwinEntries: () => [] }));
    const f = await loadFramework();
    const result = await f.runShadowWalkForward({ now: Date.parse('2026-04-28T00:00:00Z') });
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('NO_RECORDS');
  });

  it('REJECTION + TWIN 합산 — 표본 충분 시 윈도우 영속', async () => {
    const now = Date.parse('2026-04-28T00:00:00Z');
    const rejs: RejectionShadowEntry[] = [];
    const twins: TwinEntry[] = [];
    for (let i = 0; i < 30; i += 1) {
      const offset = i * 5;
      const t = new Date(now - offset * 86400000).toISOString().slice(0, 10);
      rejs.push(makeRejection({ signalDate: t, currentReturnPct: i % 2 === 0 ? 7 : -2, closed: true }));
      twins.push(makeTwin({ signalDate: t, currentReturnPct: i % 2 === 0 ? 6 : -3, status: 'CLOSED' }));
    }
    vi.doMock('./rejectionShadowTracker.js', () => ({ getAllRejectionShadow: () => rejs }));
    vi.doMock('./counterfactualTwinPortfolio.js', () => ({ getAllTwinEntries: () => twins }));
    const f = await loadFramework();
    const result = await f.runShadowWalkForward({ now });
    expect(result.skipped).toBe(false);
    expect(result.results).toBeDefined();
    expect(result.results!.windows.length).toBeGreaterThan(0);
    // windowId 가 'shadow_' prefix
    for (const w of result.results!.windows) {
      expect(w.windowId.startsWith('shadow_')).toBe(true);
    }
  });

  it('source=REJECTION — Twin 미사용', async () => {
    const now = Date.parse('2026-04-28T00:00:00Z');
    const rejs: RejectionShadowEntry[] = [];
    for (let i = 0; i < 30; i += 1) {
      rejs.push(makeRejection({
        signalDate: new Date(now - i * 5 * 86400000).toISOString().slice(0, 10),
        currentReturnPct: 4, closed: true,
      }));
    }
    const getTwinSpy = vi.fn(() => []);
    vi.doMock('./rejectionShadowTracker.js', () => ({ getAllRejectionShadow: () => rejs }));
    vi.doMock('./counterfactualTwinPortfolio.js', () => ({ getAllTwinEntries: getTwinSpy }));
    const f = await loadFramework();
    const result = await f.runShadowWalkForward({ now, source: 'REJECTION' });
    expect(result.skipped).toBe(false);
    expect(getTwinSpy).not.toHaveBeenCalled();
  });

  it('source=TWIN — Rejection 미사용', async () => {
    const now = Date.parse('2026-04-28T00:00:00Z');
    const twins: TwinEntry[] = [];
    for (let i = 0; i < 30; i += 1) {
      twins.push(makeTwin({
        signalDate: new Date(now - i * 5 * 86400000).toISOString().slice(0, 10),
        currentReturnPct: 4, status: 'CLOSED',
      }));
    }
    const getRejSpy = vi.fn(() => []);
    vi.doMock('./rejectionShadowTracker.js', () => ({ getAllRejectionShadow: getRejSpy }));
    vi.doMock('./counterfactualTwinPortfolio.js', () => ({ getAllTwinEntries: () => twins }));
    const f = await loadFramework();
    const result = await f.runShadowWalkForward({ now, source: 'TWIN' });
    expect(result.skipped).toBe(false);
    expect(getRejSpy).not.toHaveBeenCalled();
  });

  it('getShadowResolvedConfig — ENV 반영', async () => {
    process.env.SHADOW_WALK_FORWARD_IS_DAYS = '90';
    process.env.SHADOW_WALK_FORWARD_OOS_DAYS = '21';
    vi.resetModules();
    const f = await loadFramework();
    const c = f.getShadowResolvedConfig();
    expect(c.isDays).toBe(90);
    expect(c.oosDays).toBe(21);
  });

  it('getShadowResolvedConfig — 잘못된 ENV → default', async () => {
    process.env.SHADOW_WALK_FORWARD_IS_DAYS = 'NOT_A_NUMBER';
    vi.resetModules();
    const f = await loadFramework();
    const c = f.getShadowResolvedConfig();
    expect(c.isDays).toBe(60);
  });
});
