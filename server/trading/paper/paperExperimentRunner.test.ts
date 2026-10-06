// @responsibility Verify paper scan lifecycle.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaperExperimentLedger, PaperSnapshot } from '../../../src/types/paperExperiment.js';
import { previousKrxTradingDay } from '../../calendar/krxTradingCalendar.js';
const state = vi.hoisted(() => ({ ledger: { schemaVersion: 1, experiments: [], lastRun: null } as PaperExperimentLedger, collect: vi.fn(),
  readStrategy: vi.fn(), indexSeries: vi.fn(() => ({ series: [], inventory: null })),
  archived: null as null | ((symbol: string, date: string, close: number) => boolean) }));
vi.mock('./paperResearchRuntime.js', () => ({
  refreshPaperResearch: () => undefined, getPaperResearchView: () => undefined, getArchivedPaperBarCheck: () => state.archived,
}));
vi.mock('./paperIndexCollection.js', () => ({
  refreshPaperIndexSeries: async () => false, getPaperIndexSeries: state.indexSeries,
}));
vi.mock('./paperStrategyRuntime.js', () => ({
  loadPaperStrategyState: () => ({ ledger: { trades: [] } }),
  advancePaperStrategy: () => ({ openedCount: 0, closedCount: 0, waitingCount: 1, holdingCount: 0 }),
  readPaperStrategyView: state.readStrategy,
}));
vi.mock('../../persistence/paperExperimentRepo.js', () => ({
  loadPaperExperimentLedger: () => structuredClone(state.ledger),
  savePaperExperimentLedger: (ledger: PaperExperimentLedger) => { state.ledger = structuredClone(ledger); },
}));
vi.mock('../../persistence/krxStockMasterRepo.js', () => ({ getStockByCode: () => ({ market: 'KOSPI' }) }));
vi.mock('../../persistence/paperStorageMaintenance.js', () => ({
  runPaperStorageMaintenance: vi.fn(), readPaperStorageMaintenance: () => undefined,
}));
vi.mock('./paperExperimentCollector.js', () => ({ collectPaperExperimentSnapshot: state.collect, isPaperMarketOpen: () => false }));
const sample = (): PaperSnapshot => ({
  id: 'scan', asOf: '2026-09-18T01:00:00Z', tradingDate: '2026-09-18', marketOpen: true,
  observations: [{ symbol: '005930', name: 'Samsung', price: 10000, observedAt: '2026-09-18T01:00:00Z',
    source: 'KIS', return1dPct: null, return5dPct: null, aboveMa20: null, news: [], dailyCloses: [] }],
});
beforeEach(() => {
  vi.resetModules();
  state.readStrategy.mockReset(); state.indexSeries.mockClear();
  state.archived = null;
  state.ledger = { schemaVersion: 1, experiments: [], lastRun: null };
  state.collect.mockReset().mockResolvedValue(sample());
});

describe('paper runner', () => {
  it('omits comparison research only on request while preserving complete observation records', async () => {
    const runner = await import('./paperExperimentRunner.js');
    await runner.runPaperExperimentScan();
    const full = runner.getPaperExperimentView(true);
    expect(full.relativeStrengthStudy).toBeDefined();
    expect(state.readStrategy).toHaveBeenLastCalledWith(true, state.ledger.experiments, { ledger: { trades: [] } });
    const light = runner.getPaperExperimentView(true, { includeComparisons: false });
    expect(light).toEqual({ ...full, relativeStrengthStudy: undefined });
    expect(light.experiments).toHaveLength(1);
    expect(state.readStrategy).toHaveBeenLastCalledWith(true, undefined, { ledger: { trades: [] } });
    expect(state.indexSeries).toHaveBeenCalledTimes(1);
  });
  it('exposes an explicit holiday stop and resumes the ten-minute interval on a trading day', async () => {
    vi.useFakeTimers();
    try {
      const runner = await import('./paperExperimentRunner.js');
      vi.setSystemTime('2026-10-05T10:00:00+09:00');
      expect(runner.getPaperExperimentView().scanIntervalSeconds).toBeNull();
      vi.setSystemTime('2026-10-06T12:00:00+09:00');
      expect(runner.getPaperExperimentView().scanIntervalSeconds).toBe(600);
      expect(state.collect).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
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

  it('trims entry bars only after the research archive confirms them', async () => {
    let date = '2026-09-18';
    const bars = Array.from({ length: 30 }, (_, i) => {
      date = previousKrxTradingDay(new Date(`${date}T12:00:00+09:00`));
      return { tradingDate: date, close: 100 + i, availableAt: '2026-09-17T07:00:00Z' };
    });
    state.collect.mockResolvedValue({ ...sample(), observations: [{ ...sample().observations[0], dailyCloses: bars }] });
    let runner = await import('./paperExperimentRunner.js');
    await runner.runPaperExperimentScan();
    expect(state.ledger.experiments[0].entryObservation.dailyCloses).toHaveLength(30);
    state.archived = () => true;
    vi.resetModules();
    runner = await import('./paperExperimentRunner.js');
    await runner.runPaperExperimentScan();
    expect(state.ledger.experiments[0].entryObservation.dailyCloses).toEqual(bars.slice(0, 21));
  });
});
