// @responsibility Verify strategy integration preserves independent baseline observations.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaperExperimentLedger } from '../../../src/types/paperExperiment.js';
import type { PaperStrategyLedger } from '../../../src/types/paperStrategy.js';
const state = vi.hoisted(() => ({
  baseline: { schemaVersion: 1, experiments: [], lastRun: null } as PaperExperimentLedger,
  strategy: { schemaVersion: 1, trades: [], latestDecisions: [], lastRun: null } as PaperStrategyLedger,
  collect: vi.fn(), saveBaseline: vi.fn(), saveStrategy: vi.fn(), loadStrategy: vi.fn(), loadBaseline: vi.fn(),
}));
vi.mock('../../persistence/paperExperimentRepo.js', () => ({
  loadPaperExperimentLedger: state.loadBaseline, savePaperExperimentLedger: state.saveBaseline,
}));
vi.mock('../../persistence/paperStrategyRepo.js', () => ({ loadPaperStrategyLedger: state.loadStrategy, savePaperStrategyLedger: state.saveStrategy }));
vi.mock('../../persistence/krxStockMasterRepo.js', () => ({ getStockByCode: () => ({ market: 'KOSPI' }) }));
vi.mock('./paperExperimentCollector.js', () => ({ collectPaperExperimentSnapshot: state.collect }));
import { emptyStrategyLedger, matureStrategySamples, strategyTestSnapshot } from './paperStrategyFixtures.js';

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  state.baseline = { schemaVersion: 1, experiments: matureStrategySamples(), lastRun: null };
  state.strategy = emptyStrategyLedger();
  state.loadBaseline.mockReset().mockImplementation(() => structuredClone(state.baseline));
  state.collect.mockReset().mockResolvedValue(strategyTestSnapshot());
  state.saveBaseline.mockReset().mockImplementation((ledger: PaperExperimentLedger) => { state.baseline = structuredClone(ledger); });
  state.saveStrategy.mockReset().mockImplementation((ledger: PaperStrategyLedger) => { state.strategy = structuredClone(ledger); });
  state.loadStrategy.mockReset().mockImplementation(() => structuredClone(state.strategy));
});

describe('strategy integration in the default Shadow runner', () => {
  it('runs actual strategy entries on the same snapshot after baseline persistence', async () => {
    const runner = await import('./paperExperimentRunner.js');
    const result = await runner.runPaperExperimentScan();
    expect(result).toMatchObject({ openedCount: 1, strategy: { openedCount: 1 } });
    expect(state.collect).toHaveBeenCalledOnce();
    expect(state.saveBaseline.mock.invocationCallOrder[0]).toBeLessThan(state.saveStrategy.mock.invocationCallOrder[0]);
    expect(state.strategy.trades[0].entrySnapshotId).toBe(state.baseline.lastRun!.snapshotId);
    expect(runner.getPaperExperimentView()).toMatchObject({ totalCount: 13, strategy: { totalCount: 1, openCount: 1 } });
  });

  it('keeps baseline sampling when the strategy lacks evidence', async () => {
    state.baseline.experiments = [];
    const runner = await import('./paperExperimentRunner.js');
    expect(await runner.runPaperExperimentScan()).toMatchObject({ openedCount: 1, strategy: { openedCount: 0, waitingCount: 1 } });
    expect(state.strategy.latestDecisions[0].reasonCode).toBe('INSUFFICIENT_MATURE_SAMPLES');
    expect(state.baseline.experiments).toHaveLength(1);
  });

  it('cannot use newly observed baseline outcomes to buy in the same snapshot', async () => {
    const snapshot = strategyTestSnapshot();
    const samples = matureStrategySamples();
    const symbols = [...new Set(samples.map((item) => item.symbol))];
    for (const symbol of symbols) {
      snapshot.observations.push({ ...structuredClone(snapshot.observations[0]), symbol, price: null,
        dailyCloses: samples.filter((item) => item.symbol === symbol).map((item) => {
          const outcome = item.outcomes.find((result) => result.horizon === 5)!;
          return { tradingDate: outcome.tradingDate, close: outcome.exitPrice, availableAt: snapshot.asOf };
        }) });
    }
    state.baseline.experiments = samples.map((item) => ({ ...item, status: 'OPEN', outcomes: item.outcomes.filter((outcome) => outcome.horizon !== 5) }));
    state.collect.mockResolvedValue(snapshot);
    const runner = await import('./paperExperimentRunner.js');
    expect(await runner.runPaperExperimentScan()).toMatchObject({ completedCount: 12, strategy: { openedCount: 0 } });
    expect(state.strategy.latestDecisions.find((item) => item.symbol === '005930')!.reasonCode).toBe('INSUFFICIENT_MATURE_SAMPLES');
    snapshot.asOf = '2026-09-18T01:01:00Z'; snapshot.id = 'next-scan';
    expect(await runner.runPaperExperimentScan()).toMatchObject({ strategy: { openedCount: 1 } });
  });

  it('does not overwrite corrupt strategy state or interrupt baseline persistence', async () => {
    state.loadStrategy.mockImplementation(() => { throw new Error('corrupt strategy ledger'); });
    const runner = await import('./paperExperimentRunner.js');
    const result = await runner.runPaperExperimentScan();
    expect(result.openedCount).toBe(1);
    expect(result.strategy!.error).toContain('corrupt strategy ledger');
    expect(state.saveBaseline).toHaveBeenCalledOnce();
    expect(state.saveStrategy).not.toHaveBeenCalled();
    expect(runner.getPaperExperimentView().strategy!.error).toContain('corrupt strategy ledger');
    expect(runner.getPaperExperimentView(true).strategy!.error).toContain('corrupt strategy ledger');
  });

  it('reports failed strategy writes, then retries without duplicate fills', async () => {
    state.saveStrategy.mockImplementationOnce(() => { throw new Error('disk full'); });
    const runner = await import('./paperExperimentRunner.js');
    const failed = await runner.runPaperExperimentScan();
    expect(failed).toMatchObject({ openedCount: 1, strategy: { openedCount: 0 } });
    expect(failed.strategy!.error).toContain('disk full');
    expect(state.strategy.trades).toHaveLength(0);
    expect(runner.getPaperExperimentView().strategy!.error).toContain('disk full');
    expect(runner.getPaperExperimentView(true).strategy!.error).toContain('disk full');
    expect(await runner.runPaperExperimentScan()).toMatchObject({ openedCount: 0, strategy: { openedCount: 1 } });
    expect(runner.getPaperExperimentView().strategy!.error).toBeUndefined();
    expect(await runner.runPaperExperimentScan()).toMatchObject({ strategy: { openedCount: 0, holdingCount: 1 } });
    vi.resetModules();
    const restarted = await import('./paperExperimentRunner.js');
    expect(await restarted.runPaperExperimentScan()).toMatchObject({ strategy: { openedCount: 0, holdingCount: 1 } });
    expect(state.strategy.trades).toHaveLength(1);
  });

  it('keeps watching strategy-only symbols and closes outside entry hours at the exact planned close', async () => {
    const runner = await import('./paperExperimentRunner.js');
    await runner.runPaperExperimentScan();
    state.baseline.experiments = matureStrategySamples();
    const snapshot = strategyTestSnapshot();
    snapshot.id = 'exit-scan'; snapshot.asOf = '2026-09-23T07:00:00Z'; snapshot.tradingDate = '2026-09-23'; snapshot.marketOpen = false;
    snapshot.observations[0].price = null;
    snapshot.observations[0].dailyCloses = [{ tradingDate: '2026-09-23', close: 9500, availableAt: snapshot.asOf }];
    state.collect.mockResolvedValue(snapshot);
    expect(await runner.runPaperExperimentScan()).toMatchObject({ openedCount: 0, strategy: { closedCount: 1 } });
    expect(state.collect).toHaveBeenLastCalledWith(['005930'], expect.any(Function));
    expect(runner.getPaperExperimentView().strategy!.performance.meanNetReturnPct).toBeLessThan(-5);
    const savedExit = structuredClone(state.strategy.trades[0].exit);
    expect(await runner.runPaperExperimentScan()).toMatchObject({ strategy: { closedCount: 0 } });
    expect(state.strategy.trades[0].exit).toEqual(savedExit);
    vi.resetModules();
    const restarted = await import('./paperExperimentRunner.js');
    expect(await restarted.runPaperExperimentScan()).toMatchObject({ strategy: { closedCount: 0 } });
    expect(state.strategy.trades[0].exit).toEqual(savedExit);
  });
  it('reads every saved record for the bot while keeping the UI limited to 200', async () => {
    const runner = await import('./paperExperimentRunner.js');
    await runner.runPaperExperimentScan();
    const exitSnapshot = strategyTestSnapshot();
    exitSnapshot.id = 'old-trade-exit';
    exitSnapshot.asOf = '2026-09-23T07:00:00Z';
    exitSnapshot.tradingDate = '2026-09-23';
    exitSnapshot.marketOpen = false;
    exitSnapshot.observations[0].price = null;
    exitSnapshot.observations[0].dailyCloses = [{
      tradingDate: '2026-09-23', close: 9500, availableAt: exitSnapshot.asOf,
    }];
    state.collect.mockResolvedValue(exitSnapshot);
    expect(await runner.runPaperExperimentScan()).toMatchObject({ strategy: { closedCount: 1 } });
    const oldestTrade = structuredClone(state.strategy.trades[0]);
    const oldestBaseline = structuredClone(state.baseline.experiments[0]);
    state.strategy.trades = [oldestTrade, ...Array.from({ length: 200 }, (_, index) => {
      const symbol = String(100000 + index);
      const id = oldestTrade.strategyVersion + ':' + oldestTrade.tradingDate + ':' + symbol;
      return {
        ...structuredClone(oldestTrade), id, symbol,
        entryObservation: { ...structuredClone(oldestTrade.entryObservation), symbol },
        entryDecision: { ...structuredClone(oldestTrade.entryDecision), symbol, tradeId: id },
        exit: { ...structuredClone(oldestTrade.exit!), decision: { ...structuredClone(oldestTrade.exit!.decision), symbol, tradeId: id } },
      };
    })];
    state.baseline.experiments = [oldestBaseline, ...Array.from({ length: 200 }, (_, index) => {
      const symbol = String(200000 + index);
      return {
        ...structuredClone(oldestBaseline), id: oldestBaseline.strategyVersion + ':' + oldestBaseline.tradingDate + ':' + symbol,
        symbol, entryObservation: { ...structuredClone(oldestBaseline.entryObservation), symbol },
      };
    })];
    const originalBaseline = structuredClone(state.baseline);
    const originalStrategy = structuredClone(state.strategy);
    vi.clearAllMocks();

    const ui = runner.getPaperExperimentView();
    expect(ui.experiments).toHaveLength(200);
    expect(ui.strategy!.trades).toHaveLength(200);
    expect(ui.experiments.some(item => item.id === oldestBaseline.id)).toBe(false);
    expect(ui.strategy!.trades.some(item => item.id === oldestTrade.id)).toBe(false);
    expect(state.loadBaseline).toHaveBeenCalledTimes(1);
    expect(state.loadStrategy).toHaveBeenCalledTimes(1);

    const bot = runner.getPaperExperimentView(true);
    expect(bot.experiments).toHaveLength(201);
    expect(bot.strategy!.trades).toHaveLength(201);
    expect(bot.totalCount).toBe(201);
    expect(bot.strategy!.totalCount).toBe(201);
    expect(bot.experiments.at(-1)).toEqual(oldestBaseline);
    expect(bot.strategy!.trades.at(-1)).toEqual(oldestTrade);
    expect(bot.strategy!.trades.at(-1)!.exit!.decisionAt).toBe(exitSnapshot.asOf);
    expect(bot.strategy!.trades.slice(0, 200)).toEqual(ui.strategy!.trades);
    expect(bot.experiments.slice(0, 200)).toEqual(ui.experiments);
    expect(state.loadBaseline).toHaveBeenCalledTimes(2);
    expect(state.loadStrategy).toHaveBeenCalledTimes(2);
    expect(state.collect).not.toHaveBeenCalled();
    expect(state.saveBaseline).not.toHaveBeenCalled();
    expect(state.saveStrategy).not.toHaveBeenCalled();
    expect(state.baseline).toEqual(originalBaseline);
    expect(state.strategy).toEqual(originalStrategy);
  });

});
