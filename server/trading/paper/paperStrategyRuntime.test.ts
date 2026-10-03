// @responsibility Verify strategy integration preserves independent baseline observations.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaperExperimentLedger } from '../../../src/types/paperExperiment.js';
import type { PaperStrategyLedger, PaperTradeMeasurementHistory } from '../../../src/types/paperStrategy.js';
const state = vi.hoisted(() => ({
  baseline: { schemaVersion: 1, experiments: [], lastRun: null } as PaperExperimentLedger,
  strategy: { schemaVersion: 1, trades: [], latestDecisions: [], lastRun: null } as PaperStrategyLedger,
  collect: vi.fn(), saveBaseline: vi.fn(), saveStrategy: vi.fn(), loadStrategy: vi.fn(), loadBaseline: vi.fn(),
  saveBatch: vi.fn(), recordFailure: vi.fn(), readHistory: vi.fn(), maintain: vi.fn(),
  measurementHistory: { lastRecordedAt: null, failedBatchCount: 0, unrecordedPointCount: 0 } as PaperTradeMeasurementHistory,
  archived: null as null | ((symbol: string, date: string, close: number) => boolean),
}));
vi.mock('./paperResearchRuntime.js', async (original) => ({
  ...(await original<typeof import('./paperResearchRuntime.js')>()), getArchivedPaperBarCheck: () => state.archived,
}));
vi.mock('./paperMorningRuntime.js', () => ({ capturePaperMorningSource: vi.fn(), capturePaperMorningTracking: vi.fn(), linkPaperMorningRecommendations: vi.fn() }));
vi.mock('../../persistence/paperExperimentRepo.js', () => ({
  loadPaperExperimentLedger: state.loadBaseline, savePaperExperimentLedger: state.saveBaseline,
}));
vi.mock('../../persistence/paperStrategyRepo.js', () => ({ loadPaperStrategyLedger: state.loadStrategy, savePaperStrategyLedger: state.saveStrategy }));
vi.mock('../../persistence/paperTradeMeasurementRepo.js', () => ({
  savePaperTradeMeasurementBatch: state.saveBatch, recordPaperTradeMeasurementFailure: state.recordFailure,
  readPaperTradeMeasurementHistory: state.readHistory,
}));
vi.mock('../../persistence/krxStockMasterRepo.js', () => ({ getStockByCode: () => ({ market: 'KOSPI' }) }));
vi.mock('./paperExperimentCollector.js', () => ({ collectPaperExperimentSnapshot: state.collect, isPaperMarketOpen: () => false }));
vi.mock('../../persistence/paperStorageMaintenance.js', () => ({
  runPaperStorageMaintenance: state.maintain, readPaperStorageMaintenance: () => undefined,
}));
import { emptyStrategyLedger } from './paperStrategyFixtures.js';
import { matureAdaptiveSamples as matureStrategySamples, adaptiveTestSnapshot as strategyTestSnapshot } from './paperAdaptiveFixtures.js';
import { previousKrxTradingDay } from '../../calendar/krxTradingCalendar.js';

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  state.archived = null;
  state.baseline = { schemaVersion: 1, experiments: matureStrategySamples(), lastRun: null };
  state.strategy = emptyStrategyLedger();
  state.loadBaseline.mockReset().mockImplementation(() => structuredClone(state.baseline));
  state.collect.mockReset().mockResolvedValue(strategyTestSnapshot());
  state.saveBaseline.mockReset().mockImplementation((ledger: PaperExperimentLedger) => { state.baseline = structuredClone(ledger); });
  state.saveStrategy.mockReset().mockImplementation((ledger: PaperStrategyLedger) => { state.strategy = structuredClone(ledger); });
  state.loadStrategy.mockReset().mockImplementation(() => structuredClone(state.strategy));
  state.saveBatch.mockReset();
  state.recordFailure.mockReset();
  state.measurementHistory = { lastRecordedAt: null, failedBatchCount: 0, unrecordedPointCount: 0 };
  state.readHistory.mockReset().mockImplementation(() => structuredClone(state.measurementHistory));
});
function preserveScheduledFixture(): void {
  state.strategy.trades[0].policy.exitModel = 'SCHEDULED_CLOSE';
  delete state.strategy.trades[0].exitPolicy; delete state.strategy.trades[0].exitResearch;
}

describe('strategy integration in the default Shadow runner', () => {
  it('collects a closed strategy-only symbol until its forward comparison is complete', async () => {
    const runner = await import('./paperExperimentRunner.js');
    await runner.runPaperExperimentScan();
    const snapshot = strategyTestSnapshot();
    snapshot.id = 'observed-exit'; snapshot.asOf = '2026-09-18T01:05:00Z';
    snapshot.observations[0].observedAt = snapshot.asOf; snapshot.observations[0].price = 9400;
    snapshot.observations[0].features!.asOf = snapshot.asOf;
    state.collect.mockResolvedValue(snapshot);
    expect(await runner.runPaperExperimentScan()).toMatchObject({ strategy: { closedCount: 1 } });
    const frozen = structuredClone(state.strategy.trades[0].exit);
    state.baseline.experiments = [];
    snapshot.id = 'post-exit'; snapshot.asOf = '2026-09-18T01:10:00Z';
    snapshot.observations[0].observedAt = snapshot.asOf; snapshot.observations[0].price = 9200;
    snapshot.observations[0].features!.asOf = snapshot.asOf;
    await runner.runPaperExperimentScan();
    expect(state.collect).toHaveBeenLastCalledWith(['005930'], expect.any(Function));
    expect(state.strategy.trades[0].exit).toEqual(frozen);
    expect(state.strategy.trades[0].exitResearch!.outcomes.PATIENT?.price).toBe(9200);
    expect(state.strategy.trades[0].measurement!.latest.kind).toBe('ADAPTIVE_EXIT');
  });

  it('runs actual strategy entries on the same snapshot after baseline persistence', async () => {
    const runner = await import('./paperExperimentRunner.js');
    const result = await runner.runPaperExperimentScan();
    expect(result).toMatchObject({ openedCount: 1, strategy: { openedCount: 1 } });
    expect(state.collect).toHaveBeenCalledOnce();
    expect(state.maintain).toHaveBeenCalledOnce();
    expect(state.maintain.mock.invocationCallOrder[0]).toBeLessThan(state.collect.mock.invocationCallOrder[0]);
    expect(state.saveBaseline.mock.invocationCallOrder[0]).toBeLessThan(state.saveStrategy.mock.invocationCallOrder[0]);
    expect(state.saveStrategy.mock.invocationCallOrder[0]).toBeLessThan(state.saveBatch.mock.invocationCallOrder[0]);
    expect(state.saveBatch).toHaveBeenCalledWith([expect.objectContaining({ kind: 'ENTRY', action: 'BUY',
      snapshotId: strategyTestSnapshot().id, tradeId: state.strategy.trades[0].id })], state.strategy.trades);
    expect(state.strategy.trades[0].measurement).toMatchObject({ fromEntry: true, pointCount: 1 });
    expect(state.strategy.trades[0].entrySnapshotId).toBe(state.baseline.lastRun!.snapshotId);
    expect(runner.getPaperExperimentView()).toMatchObject({ totalCount: 257, strategy: { totalCount: 1, openCount: 1, strategyVersion: 'adaptive-features-v1' } });
  }, 15_000);

  it('keeps baseline sampling and registers exploration before buying on a later fresh snapshot', async () => {
    state.baseline.experiments = [];
    const runner = await import('./paperExperimentRunner.js');
    expect(await runner.runPaperExperimentScan()).toMatchObject({ openedCount: 1, strategy: { openedCount: 0, waitingCount: 1 } });
    expect(state.strategy.latestDecisions[0].reasonCode).toBe('ADAPTIVE_FEATURE_UNAVAILABLE');
    expect(state.baseline.experiments).toHaveLength(1);
    expect(state.strategy.adaptive!.candidates.every(item => !item.active)).toBe(true);
    expect(state.strategy.adaptive!.exploration!.rules.length).toBeGreaterThan(0);
    const registered = structuredClone(state.strategy.adaptive!.exploration);
    const snapshot = strategyTestSnapshot();
    snapshot.id = 'exploration-next-scan'; snapshot.asOf = '2026-09-18T01:01:00Z';
    snapshot.observations[0].observedAt = snapshot.asOf; snapshot.observations[0].features!.asOf = snapshot.asOf;
    state.collect.mockResolvedValue(snapshot);
    vi.resetModules();
    const restarted = await import('./paperExperimentRunner.js');
    expect(await restarted.runPaperExperimentScan()).toMatchObject({ openedCount: 0, strategy: { openedCount: 1 } });
    expect(state.strategy.adaptive!.exploration).toEqual(registered);
    expect(state.strategy.trades[0].entryDecision).toMatchObject({ reasonCode: 'ADAPTIVE_EXPLORATION_SELECTED',
      explorationEvidence: { registeredAt: '2026-09-18T01:00:00Z', candidate: { active: false } } });
    expect(state.strategy.trades[0].entryDecision.adaptiveEvidence).toBeUndefined();
    expect(state.baseline.experiments).toHaveLength(1);
    expect(await restarted.runPaperExperimentScan()).toMatchObject({ strategy: { openedCount: 0, holdingCount: 1 } });
    expect(state.strategy.trades).toHaveLength(1);
  });

  it('cannot treat newly observed baseline outcomes as verified evidence in the same snapshot', async () => {
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
    state.baseline.experiments = samples.map((item) => ({ ...item, status: 'OPEN', outcomes: [] }));
    state.collect.mockResolvedValue(snapshot);
    const runner = await import('./paperExperimentRunner.js');
    expect(await runner.runPaperExperimentScan()).toMatchObject({ completedCount: 256, strategy: { openedCount: 0 } });
    expect(state.strategy.latestDecisions.find((item) => item.symbol === '005930')!.reasonCode).toBe('ADAPTIVE_FEATURE_UNAVAILABLE');
    expect(state.strategy.adaptive!.matureSampleCount).toBe(0);
    snapshot.asOf = '2026-09-18T01:01:00Z'; snapshot.id = 'next-scan';
    expect(await runner.runPaperExperimentScan()).toMatchObject({ strategy: { openedCount: 0 } });
    expect(state.strategy.adaptive!.matureSampleCount).toBe(0);
    snapshot.asOf = '2026-09-21T01:00:00Z'; snapshot.tradingDate = '2026-09-21';
    for (const observation of snapshot.observations) observation.observedAt = snapshot.asOf;
    await runner.runPaperExperimentScan();
    expect(state.strategy.adaptive!.matureSampleCount).toBe(256);
    // Late labels cannot be backdated into the training period preceding their confirmation.
    expect(state.strategy.adaptive!.candidates.every(item => !item.active)).toBe(true);
  });

  it('does not overwrite corrupt strategy state or interrupt baseline persistence', async () => {
    state.loadStrategy.mockImplementation(() => { throw new Error('corrupt strategy ledger'); });
    const runner = await import('./paperExperimentRunner.js');
    const result = await runner.runPaperExperimentScan();
    expect(result.openedCount).toBe(1);
    expect(result.strategy!.error).toContain('corrupt strategy ledger');
    expect(state.saveBaseline).toHaveBeenCalledOnce();
    expect(state.saveStrategy).not.toHaveBeenCalled();
    expect(state.saveBatch).not.toHaveBeenCalled();
    expect(state.recordFailure).not.toHaveBeenCalled();
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
    expect(state.saveBatch).not.toHaveBeenCalled();
    expect(state.recordFailure).not.toHaveBeenCalled();
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

  it('preserves committed BUY and EXIT results when detailed measurement storage fails', async () => {
    const storageError = new Error('measurement disk unavailable');
    state.saveBatch.mockImplementation(() => { throw storageError; });
    const runner = await import('./paperExperimentRunner.js');
    const entryResult = await runner.runPaperExperimentScan();
    expect(entryResult.strategy).toMatchObject({ openedCount: 1, closedCount: 0 });
    expect(entryResult.strategy!.error).toBeUndefined();
    expect(state.strategy.trades[0]).toMatchObject({ status: 'OPEN', measurement: { fromEntry: true, pointCount: 1 } });
    expect(state.recordFailure).toHaveBeenCalledWith(strategyTestSnapshot().id, strategyTestSnapshot().asOf, 1, storageError, state.strategy.trades);
    expect(state.saveStrategy.mock.invocationCallOrder[0]).toBeLessThan(state.recordFailure.mock.invocationCallOrder[0]);
    expect(runner.getPaperExperimentView().strategy!.error).toBeUndefined();
    const entryDecision = structuredClone(state.strategy.trades[0].entryDecision);

    const exit = strategyTestSnapshot();
    exit.id = 'measurement-failed-exit'; exit.asOf = '2026-09-18T01:05:00Z';
    exit.observations[0].price = 9400; exit.observations[0].observedAt = exit.asOf;
    exit.observations[0].features!.asOf = exit.asOf;
    state.collect.mockResolvedValue(exit);
    const exitResult = await runner.runPaperExperimentScan();
    expect(exitResult.strategy).toMatchObject({ openedCount: 0, closedCount: 1 });
    expect(exitResult.strategy!.error).toBeUndefined();
    expect(state.strategy.trades[0]).toMatchObject({ status: 'CLOSED', exit: { price: 9400 },
      measurement: { pointCount: 2, latest: { kind: 'ADAPTIVE_EXIT' } } });
    expect(state.strategy.trades[0].entryDecision).toEqual(entryDecision);
    expect(state.recordFailure).toHaveBeenLastCalledWith(exit.id, exit.asOf, 1, storageError, state.strategy.trades);
    expect(state.recordFailure).toHaveBeenCalledTimes(2);
    expect(runner.getPaperExperimentView().strategy!.error).toBeUndefined();
    const committed = structuredClone(state.strategy.trades[0]);
    vi.resetModules();
    const restarted = await import('./paperExperimentRunner.js');
    expect(await restarted.runPaperExperimentScan()).toMatchObject({ strategy: { openedCount: 0, closedCount: 0 } });
    expect(state.strategy.trades[0]).toEqual(committed);
    expect(state.saveBatch).toHaveBeenCalledTimes(2);
  });

  it('exposes measurement history diagnostics without treating them as strategy failures', async () => {
    state.measurementHistory = { lastRecordedAt: '2026-09-18T01:00:00Z', failedBatchCount: 2,
      unrecordedPointCount: 7, error: '상세 관측 기록 일부 누락' };
    const runtime = await import('./paperStrategyRuntime.js');
    const view = runtime.readPaperStrategyView();
    expect(view.measurementHistory).toEqual(state.measurementHistory);
    expect(state.readHistory).toHaveBeenCalledWith(state.strategy);
    expect(view.error).toBeUndefined();
    expect(state.saveBatch).not.toHaveBeenCalled();
    expect(state.recordFailure).not.toHaveBeenCalled();
  });

  it('keeps watching strategy-only symbols and closes outside entry hours at the exact planned close', async () => {
    const runner = await import('./paperExperimentRunner.js');
    await runner.runPaperExperimentScan();
    preserveScheduledFixture();
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
    preserveScheduledFixture();
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


  it('trims a trade\'s entry bars once the archive confirms them, without changing its decision', async () => {
    let date = '2026-09-18';
    const bars = Array.from({ length: 30 }, (_, i) => {
      date = previousKrxTradingDay(new Date(`${date}T12:00:00+09:00`));
      return { tradingDate: date, close: 9000 + i, availableAt: '2026-09-17T07:00:00Z' };
    });
    const snapshot = strategyTestSnapshot();
    snapshot.observations[0].dailyCloses = bars;
    state.collect.mockResolvedValue(snapshot);
    let runner = await import('./paperExperimentRunner.js');
    await runner.runPaperExperimentScan();
    expect(state.strategy.trades[0].entryObservation.dailyCloses).toHaveLength(30);
    const decision = structuredClone(state.strategy.trades[0].entryDecision);
    state.archived = () => true;
    vi.resetModules();
    runner = await import('./paperExperimentRunner.js');
    await runner.runPaperExperimentScan();
    expect(state.strategy.trades[0].entryObservation.dailyCloses).toEqual(bars.slice(0, 21));
    expect(state.strategy.trades[0].entryDecision).toEqual(decision);
    expect(state.baseline.experiments.find((item) => item.tradingDate === '2026-09-18')!.entryObservation.dailyCloses).toEqual(bars.slice(0, 21));
  });
});
