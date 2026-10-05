// @responsibility Verify durable reuse of archived research results.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ResearchInventory, ResearchSeries } from '../../../src/types/paperResearch.js';
const state = vi.hoisted(() => ({ directory: '', build: vi.fn(), index: {
  series: [] as ResearchSeries[], inventory: null as ResearchInventory | null,
} }));
vi.mock('../../persistence/paths.js', () => ({ get DATA_DIR() { return state.directory; } }));
vi.mock('./paperResearch.js', () => ({ buildPaperResearch: state.build }));
vi.mock('./paperIndexCollection.js', () => ({ getPaperIndexSeries: () => state.index }));
vi.mock('../../persistence/krxStockMasterRepo.js', () => ({ getStockByCode: () => null }));
const load = () => import('./paperResearchRuntime.js');
const at = (value: string) => vi.setSystemTime(value);

beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); at('2026-10-03T01:00:00Z');
  state.directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qmp-refresh-'));
  state.index = { series: [], inventory: null };
  state.build.mockReset().mockImplementation((_archive, asOf) => ({ view: { asOf,
    symbols: 0, seriesCount: 0, newsCount: 0, sampleCount: 0, learningSampleCount: 0,
    firstDate: null, lastDate: null, skipped: {}, inventory: [], groups: [], validation: [], notes: [],
  } }));
});
afterEach(() => {
  vi.useRealTimers(); vi.restoreAllMocks();
  if (state.directory && path.dirname(path.resolve(state.directory)) === path.resolve(os.tmpdir())) fs.rmSync(state.directory, { recursive: true, force: true });
});

it('reuses unchanged data across consecutive holidays while preserving the original research time', async () => {
  const { refreshPaperResearch, getPaperResearchView } = await load();
  expect(refreshPaperResearch()).toBe(true);
  const original = getPaperResearchView();
  for (const now of ['2026-10-03T02:00:00Z', '2026-10-04T03:00:00Z', '2026-10-05T03:00:00Z']) {
    at(now);
    expect(refreshPaperResearch()).toBe(false);
    expect(getPaperResearchView()).toBe(original);
  }
  expect(state.build).toHaveBeenCalledTimes(1);
});

it('restores a verified report after restart without rebuilding the archive or claiming new freshness', async () => {
  const first = await load();
  first.refreshPaperResearch();
  const original = structuredClone(first.getPaperResearchView());
  const archive = path.join(state.directory, 'paper-research-archive.json');
  const stat = fs.statSync(archive, { bigint: true });
  vi.resetModules(); at('2026-10-05T03:00:00Z');
  const restarted = await load();
  expect(restarted.refreshPaperResearch()).toBe(false);
  expect(restarted.getPaperResearchView()).toEqual(original);
  expect(state.build).toHaveBeenCalledTimes(1);
  expect(fs.statSync(archive, { bigint: true }).mtimeNs).toBe(stat.mtimeNs);
  // Report restoration alone does not authorize trimming archive bars that this process has not verified.
  expect(restarted.getArchivedPaperBarCheck()).toBeNull();
});

it('recalculates when stored inputs change and on explicit manual force', async () => {
  const runtime = await load();
  runtime.refreshPaperResearch();
  fs.writeFileSync(path.join(state.directory, 'news-supply-log.json'), '[]');
  at('2026-10-03T02:00:00Z');
  expect(runtime.refreshPaperResearch()).toBe(true);
  expect(state.build).toHaveBeenCalledTimes(2);
  expect(runtime.refreshPaperResearch([], true)).toBe(true);
  expect(state.build).toHaveBeenCalledTimes(3);
});

it('rejects a persisted cache when sources changed while the process was stopped', async () => {
  (await load()).refreshPaperResearch();
  fs.writeFileSync(path.join(state.directory, 'news-supply-log.json'), '[]');
  vi.resetModules(); at('2026-10-04T03:00:00Z');
  expect((await load()).refreshPaperResearch()).toBe(true);
  expect(state.build).toHaveBeenCalledTimes(2);
});

it('preserves trading-day reevaluation even when no source file changed', async () => {
  const runtime = await load();
  runtime.refreshPaperResearch();
  at('2026-10-06T00:00:00Z');
  expect(runtime.refreshPaperResearch()).toBe(true);
  at('2026-10-06T01:00:00Z');
  expect(runtime.refreshPaperResearch()).toBe(false);
  at('2026-10-07T00:00:00Z');
  expect(runtime.refreshPaperResearch()).toBe(true);
  expect(state.build).toHaveBeenCalledTimes(3);
});

it('does not treat an empty index process cache after restart as changed benchmark evidence', async () => {
  state.index = { series: [{ id: 'kis-index:^KS11', symbol: '^KS11', source: 'KIS_SNAPSHOT',
    retrievedAt: '2026-10-02T07:00:00Z', closes: [{ date: '2026-10-02', close: 3000 }] }],
    inventory: { file: 'index', records: 1, status: 'FOUND' } };
  (await load()).refreshPaperResearch();
  state.index = { series: [], inventory: null };
  vi.resetModules(); at('2026-10-04T03:00:00Z');
  const runtime = await load();
  expect(runtime.refreshPaperResearch()).toBe(false);
  expect(state.build).toHaveBeenCalledTimes(1);
  state.index = { series: [], inventory: { file: 'index', records: 0, status: 'ERROR' } };
  at('2026-10-04T04:00:00Z');
  expect(runtime.refreshPaperResearch()).toBe(true);
  expect(state.build).toHaveBeenCalledTimes(2);
});

it.each(['report', 'metadata'])('recovers from corrupt %s cache by rebuilding from stored sources', async (target) => {
  (await load()).refreshPaperResearch();
  const file = target === 'report' ? 'paper-research-report.json' : 'paper-research-cache.json';
  fs.writeFileSync(path.join(state.directory, file), target === 'report' ? '{"asOf":"2026-10-04T03:00:00Z"}' : '{');
  vi.resetModules(); at('2026-10-04T03:00:00Z');
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const runtime = await load();
  expect(runtime.refreshPaperResearch()).toBe(true);
  expect(state.build).toHaveBeenCalledTimes(2);
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('저장 결과 재사용 실패'), expect.any(String));
  expect(runtime.getPaperResearchView()?.error).toBeUndefined();
});
