// @responsibility shadowWalkForwardResultsRepo 회귀 테스트 — atomic write + FIFO + 손상 fallback.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

async function loadModule() {
  return import('./shadowWalkForwardResultsRepo.js');
}

describe('shadowWalkForwardResultsRepo', () => {
  let tmpDir: string;
  const originalDataDir = process.env.PERSIST_DATA_DIR;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shadow-wf-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    vi.resetModules();
  });

  afterEach(() => {
    if (originalDataDir === undefined) delete process.env.PERSIST_DATA_DIR;
    else process.env.PERSIST_DATA_DIR = originalDataDir;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
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
    const result = mod.loadShadowWalkForwardResults();
    expect(result.windows).toEqual([]);
    expect(result.summary.totalWindows).toBe(0);
    expect(result.schemaVersion).toBe(mod.SHADOW_WALK_FORWARD_SCHEMA_VERSION);
  });

  it('save → load round-trip 정합', async () => {
    const mod = await loadModule();
    mod.saveShadowWalkForwardResults({
      schemaVersion: mod.SHADOW_WALK_FORWARD_SCHEMA_VERSION,
      generatedAt: '2026-04-28T00:00:00Z',
      windows: [makeWindow('shadow_w1')],
      summary: { totalWindows: 1, avgDegradation: 10, medianDegradation: 10, overfitFlagged: 0, decayTrend: 'STABLE' },
    });
    const loaded = mod.loadShadowWalkForwardResults();
    expect(loaded.windows).toHaveLength(1);
    expect(loaded.windows[0].windowId).toBe('shadow_w1');
  });

  it('appendShadowWalkForwardWindow — 신규 + 동일 ID 덮어쓰기', async () => {
    const mod = await loadModule();
    let r = mod.loadShadowWalkForwardResults();
    r = mod.appendShadowWalkForwardWindow(r, makeWindow('shadow_w1', '2026-01-01T00:00:00Z'), 24);
    r = mod.appendShadowWalkForwardWindow(r, makeWindow('shadow_w1', '2026-04-28T00:00:00Z'), 24);
    expect(r.windows).toHaveLength(1);
    expect(r.windows[0].computedAt).toBe('2026-04-28T00:00:00Z');
  });

  it('FIFO trim — max 3, 5개 추가 → 마지막 3개', async () => {
    const mod = await loadModule();
    let r = mod.loadShadowWalkForwardResults();
    for (let i = 1; i <= 5; i += 1) {
      r = mod.appendShadowWalkForwardWindow(r, makeWindow(`shadow_w${i}`), 3);
    }
    expect(r.windows).toHaveLength(3);
    expect(r.windows.map((w) => w.windowId)).toEqual(['shadow_w3', 'shadow_w4', 'shadow_w5']);
  });

  it('손상 JSON → 빈 결과 fallback', async () => {
    const mod = await loadModule();
    fs.mkdirSync(path.dirname(mod.SHADOW_WALK_FORWARD_PATHS.resultsFile), { recursive: true });
    fs.writeFileSync(mod.SHADOW_WALK_FORWARD_PATHS.resultsFile, 'NOT_JSON{{{');
    const result = mod.loadShadowWalkForwardResults();
    expect(result.windows).toEqual([]);
  });

  it('clearShadowWalkForwardResults — 파일 제거', async () => {
    const mod = await loadModule();
    mod.saveShadowWalkForwardResults({
      schemaVersion: mod.SHADOW_WALK_FORWARD_SCHEMA_VERSION,
      generatedAt: '2026-04-28T00:00:00Z',
      windows: [makeWindow('shadow_w1')],
      summary: { totalWindows: 1, avgDegradation: 10, medianDegradation: 10, overfitFlagged: 0, decayTrend: 'STABLE' },
    });
    expect(fs.existsSync(mod.SHADOW_WALK_FORWARD_PATHS.resultsFile)).toBe(true);
    mod.clearShadowWalkForwardResults();
    expect(fs.existsSync(mod.SHADOW_WALK_FORWARD_PATHS.resultsFile)).toBe(false);
  });

  it('schema 호환 — 기존 walkForwardResultsRepo 와 동일 WalkForwardWindow', async () => {
    const mod = await loadModule();
    const baseRepo = await import('./walkForwardResultsRepo.js');
    expect(mod.SHADOW_WALK_FORWARD_SCHEMA_VERSION).toBe(baseRepo.WALK_FORWARD_SCHEMA_VERSION);
  });
});
