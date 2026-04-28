// @responsibility walkForwardResultsRepo 회귀 테스트 — atomic write + FIFO trim + 손상 fallback.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// 동적 import 로 PERSIST_DATA_DIR 격리 — paths.ts 가 환경변수를 처음 import 시점에만 읽기 때문.
async function loadModule() {
  return import('./walkForwardResultsRepo.js');
}

describe('walkForwardResultsRepo', () => {
  let tmpDir: string;
  const originalDataDir = process.env.PERSIST_DATA_DIR;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-repo-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    vi.resetModules();
  });

  afterEach(() => {
    if (originalDataDir === undefined) {
      delete process.env.PERSIST_DATA_DIR;
    } else {
      process.env.PERSIST_DATA_DIR = originalDataDir;
    }
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  function makeWindow(id: string, ts: string = '2026-04-28T00:00:00Z') {
    return {
      windowId: id,
      inSampleStart: '2026-01-01',
      inSampleEnd: '2026-03-01',
      outSampleStart: '2026-03-01',
      outSampleEnd: '2026-04-01',
      isMetrics: { sampleSize: 10, winRate: 0.6, avgReturn: 1.5, totalReturn: 16, sharpe: 0.4, maxDrawdown: 5 },
      oosMetrics: { sampleSize: 6, winRate: 0.5, avgReturn: 1.2, totalReturn: 8, sharpe: 0.3, maxDrawdown: 3 },
      degradation: 10,
      computedAt: ts,
    };
  }

  it('파일 부재 시 빈 결과 fallback', async () => {
    const mod = await loadModule();
    const result = mod.loadWalkForwardResults();
    expect(result.windows).toEqual([]);
    expect(result.summary.totalWindows).toBe(0);
    expect(result.schemaVersion).toBe(mod.WALK_FORWARD_SCHEMA_VERSION);
  });

  it('save → load round-trip 정합', async () => {
    const mod = await loadModule();
    const w1 = makeWindow('w1');
    mod.saveWalkForwardResults({
      schemaVersion: mod.WALK_FORWARD_SCHEMA_VERSION,
      generatedAt: '2026-04-28T00:00:00Z',
      windows: [w1],
      summary: { totalWindows: 1, avgDegradation: 10, medianDegradation: 10, overfitFlagged: 0, decayTrend: 'STABLE' },
    });
    const loaded = mod.loadWalkForwardResults();
    expect(loaded.windows).toHaveLength(1);
    expect(loaded.windows[0].windowId).toBe('w1');
    expect(loaded.summary.avgDegradation).toBe(10);
  });

  it('appendWalkForwardWindow — 신규 추가', async () => {
    const mod = await loadModule();
    const initial = mod.loadWalkForwardResults();
    const updated = mod.appendWalkForwardWindow(initial, makeWindow('w1'), 24);
    expect(updated.windows).toHaveLength(1);
    expect(updated.windows[0].windowId).toBe('w1');
  });

  it('appendWalkForwardWindow — 동일 windowId 덮어쓰기 (idempotent)', async () => {
    const mod = await loadModule();
    let results = mod.loadWalkForwardResults();
    results = mod.appendWalkForwardWindow(results, makeWindow('w1', '2026-04-01T00:00:00Z'), 24);
    results = mod.appendWalkForwardWindow(results, makeWindow('w1', '2026-04-28T00:00:00Z'), 24);
    expect(results.windows).toHaveLength(1);
    expect(results.windows[0].computedAt).toBe('2026-04-28T00:00:00Z');
  });

  it('appendWalkForwardWindow — FIFO trim (max 3, 5개 추가 → 마지막 3개)', async () => {
    const mod = await loadModule();
    let results = mod.loadWalkForwardResults();
    for (let i = 1; i <= 5; i += 1) {
      results = mod.appendWalkForwardWindow(results, makeWindow(`w${i}`), 3);
    }
    expect(results.windows).toHaveLength(3);
    expect(results.windows.map((w) => w.windowId)).toEqual(['w3', 'w4', 'w5']);
  });

  it('appendWalkForwardWindow — maxWindows ≤ 0 도 안전 (최소 1)', async () => {
    const mod = await loadModule();
    let results = mod.loadWalkForwardResults();
    results = mod.appendWalkForwardWindow(results, makeWindow('w1'), 0);
    expect(results.windows).toHaveLength(1);
  });

  it('손상 JSON → 빈 결과 fallback (시스템 무중단)', async () => {
    const mod = await loadModule();
    fs.mkdirSync(path.dirname(mod.WALK_FORWARD_PATHS.resultsFile), { recursive: true });
    fs.writeFileSync(mod.WALK_FORWARD_PATHS.resultsFile, 'NOT_JSON{{{');
    const result = mod.loadWalkForwardResults();
    expect(result.windows).toEqual([]);
  });

  it('clearWalkForwardResults — 파일 제거', async () => {
    const mod = await loadModule();
    mod.saveWalkForwardResults({
      schemaVersion: mod.WALK_FORWARD_SCHEMA_VERSION,
      generatedAt: '2026-04-28T00:00:00Z',
      windows: [makeWindow('w1')],
      summary: { totalWindows: 1, avgDegradation: 10, medianDegradation: 10, overfitFlagged: 0, decayTrend: 'STABLE' },
    });
    expect(fs.existsSync(mod.WALK_FORWARD_PATHS.resultsFile)).toBe(true);
    mod.clearWalkForwardResults();
    expect(fs.existsSync(mod.WALK_FORWARD_PATHS.resultsFile)).toBe(false);
  });
});
