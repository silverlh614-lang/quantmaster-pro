// @responsibility Verify paper scan lifecycle.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaperExperimentLedger, PaperSnapshot } from '../../../src/types/paperExperiment.js';
const state = vi.hoisted(() => ({ ledger: { schemaVersion: 1, experiments: [], lastRun: null } as PaperExperimentLedger, collect: vi.fn() }));
vi.mock('./paperStrategyRuntime.js', () => ({
  loadPaperStrategyState: () => ({ ledger: { trades: [] } }),
  advancePaperStrategy: () => ({ openedCount: 0, closedCount: 0, waitingCount: 1, holdingCount: 0 }),
  readPaperStrategyView: () => undefined,
}));
vi.mock('../../persistence/paperExperimentRepo.js', () => ({
  loadPaperExperimentLedger: () => structuredClone(state.ledger),
  savePaperExperimentLedger: (ledger: PaperExperimentLedger) => { state.ledger = structuredClone(ledger); },
}));
vi.mock('../../persistence/krxStockMasterRepo.js', () => ({ getStockByCode: () => ({ market: 'KOSPI' }) }));
vi.mock('./paperExperimentCollector.js', () => ({ collectPaperExperimentSnapshot: state.collect }));
const sample = (): PaperSnapshot => ({
  id: 'scan', asOf: '2026-09-18T01:00:00Z', tradingDate: '2026-09-18', marketOpen: true,
  observations: [{ symbol: '005930', name: 'Samsung', price: 10000, observedAt: '2026-09-18T01:00:00Z',
    source: 'KIS', return1dPct: null, return5dPct: null, aboveMa20: null, news: [], dailyCloses: [] }],
});
beforeEach(() => {
  vi.resetModules();
  state.ledger = { schemaVersion: 1, experiments: [], lastRun: null };
  state.collect.mockReset().mockResolvedValue(sample());
});

describe('paper runner', () => {
  it('deduplicates repeated scans and restart, then opens again on the next trading day', async () => {
    let runner = await import('./paperExperimentRunner.js');
    expect((await runner.runPaperExperimentScan()).openedCount).toBe(1);
    expect((await runner.runPaperExperimentScan()).openedCount).toBe(0);
    vi.resetModules();
    runner = await import('./paperExperimentRunner.js');
    expect((await runner.runPaperExperimentScan()).openedCount).toBe(0);
    const next = sample();
    next.tradingDate = '2026-09-21'; next.asOf = '2026-09-21T01:00:00Z';
    state.collect.mockResolvedValue(next);
    expect((await runner.runPaperExperimentScan()).openedCount).toBe(1);
    expect(state.ledger.experiments).toHaveLength(2);
  });

  it('coalesces concurrent scans and releases the lock after failure', async () => {
    const runner = await import('./paperExperimentRunner.js');
    let finish!: (snapshot: PaperSnapshot) => void;
    state.collect.mockImplementationOnce((_symbols, progress) => new Promise<PaperSnapshot>((resolve) => {
      progress(3, 10); finish = resolve;
    }));
    const first = runner.runPaperExperimentScan();
    const second = runner.runPaperExperimentScan();
    expect(first).toBe(second);
    expect(runner.getPaperExperimentView().collection).toMatchObject({ completed: 3, total: 10 });
    finish(sample());
    await first;
    expect(runner.getPaperExperimentView().collection).toBeUndefined();
    expect(state.ledger.lastRun?.durationMs).toBeGreaterThanOrEqual(0);
    expect(state.collect).toHaveBeenCalledTimes(1);
    state.collect.mockRejectedValueOnce(new Error('provider failure'));
    await expect(runner.runPaperExperimentScan()).rejects.toThrow('provider failure');
    expect(runner.getPaperExperimentView().collection).toBeUndefined();
    await expect(runner.runPaperExperimentScan()).resolves.toMatchObject({ openedCount: 0 });
  });

  it('monitors open symbols after watchlist removal and completes at D5 outside market hours', async () => {
    const runner = await import('./paperExperimentRunner.js');
    await runner.runPaperExperimentScan();
    const later = sample();
    later.asOf = '2026-09-29T07:00:00Z'; later.tradingDate = '2026-09-29'; later.marketOpen = false;
    later.observations[0].price = null;
    later.observations[0].dailyCloses = [{ tradingDate: '2026-09-29', close: 11000, availableAt: later.asOf }];
    state.collect.mockResolvedValue(later);
    expect(await runner.runPaperExperimentScan()).toMatchObject({ completedCount: 1, openedCount: 0, missingPriceCount: 1 });
    expect(state.collect).toHaveBeenLastCalledWith(['005930'], expect.any(Function));
    expect(runner.getPaperExperimentView().outcomes.find((item) => item.horizon === 5)!.count).toBe(1);
  });
});
