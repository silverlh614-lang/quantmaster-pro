// @responsibility Verify unchanged research inputs avoid expensive recomputation.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ directory: '', build: vi.fn() }));
vi.mock('../../persistence/paths.js', () => ({ get DATA_DIR() { return state.directory; } }));
vi.mock('./paperResearch.js', () => ({ buildPaperResearch: state.build }));
vi.mock('./paperIndexCollection.js', () => ({ getPaperIndexSeries: () => ({ series: [], inventory: null }) }));
vi.mock('../../persistence/krxStockMasterRepo.js', () => ({ getStockByCode: () => null }));
afterEach(() => {
  vi.useRealTimers();
  if (state.directory && path.dirname(path.resolve(state.directory)) === path.resolve(os.tmpdir())) fs.rmSync(state.directory, { recursive: true, force: true });
});
it('skips unchanged hourly inputs but recomputes on source changes, a new day or explicit force', async () => {
  vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime('2026-10-03T01:00:00Z');
  state.directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qmp-refresh-'));
  state.build.mockReset().mockImplementation((_archive, asOf) => ({ view: { asOf } }));
  const { refreshPaperResearch, getPaperResearchView } = await import('./paperResearchRuntime.js');
  refreshPaperResearch(); expect(state.build).toHaveBeenCalledTimes(1);
  const original = getPaperResearchView();
  vi.setSystemTime('2026-10-03T02:00:00Z'); refreshPaperResearch();
  expect(state.build).toHaveBeenCalledTimes(1); expect(getPaperResearchView()).toBe(original);
  fs.writeFileSync(path.join(state.directory, 'news-supply-log.json'), '[]');
  vi.setSystemTime('2026-10-03T03:00:00Z'); refreshPaperResearch(); expect(state.build).toHaveBeenCalledTimes(2);
  vi.setSystemTime('2026-10-04T03:00:00Z'); refreshPaperResearch(); expect(state.build).toHaveBeenCalledTimes(3);
  refreshPaperResearch([], true); expect(state.build).toHaveBeenCalledTimes(4);
});
