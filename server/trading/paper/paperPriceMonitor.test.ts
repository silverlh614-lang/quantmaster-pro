// @responsibility Verify independent holding monitoring with fresh-ledger commits.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { legacyStrategyLedger } from './paperStrategyFixtures.js';
import type { PaperSnapshot } from '../../../src/types/paperExperiment.js';
import type { PaperStrategyTrade } from '../../../src/types/paperStrategy.js';
const mocks = vi.hoisted(() => ({ load: vi.fn(), advance: vi.fn(), collect: vi.fn(), paused: false, open: true }));
vi.mock('../../state.js', () => ({ getAutoTradePaused: () => mocks.paused }));
vi.mock('./paperExperimentCollector.js', () => ({ isPaperMarketOpen: () => mocks.open }));
vi.mock('./paperPriceCollector.js', () => ({ collectPaperPriceSnapshot: mocks.collect }));
vi.mock('./paperStrategyRuntime.js', () => ({ loadPaperStrategyState: mocks.load, advancePaperStrategy: mocks.advance }));
const snapshot = (): PaperSnapshot => ({ id: 'paper_prices_test', quoteOnly: true, asOf: new Date().toISOString(),
  tradingDate: '2026-09-18', marketOpen: true, observations: [] });
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime('2026-09-18T01:01:00Z');
  mocks.paused = false; mocks.open = true;
  mocks.load.mockReturnValue({ ledger: legacyStrategyLedger() });
  mocks.collect.mockImplementation(async () => snapshot()); mocks.advance.mockReturnValue({ closedCount: 0 });
});
afterEach(() => vi.useRealTimers());
describe('holding price monitor', () => {
  it('coalesces overlap and reads the ledger after collection finishes', async () => {
    let resolve!: (value: PaperSnapshot) => void;
    mocks.collect.mockImplementation(() => new Promise<PaperSnapshot>(done => { resolve = done; }));
    const { runPaperPriceMonitor } = await import('./paperPriceMonitor.js');
    const first = runPaperPriceMonitor();
    expect(runPaperPriceMonitor()).toBe(first);
    const latest = { ledger: { ...legacyStrategyLedger(), trades: [] } };
    mocks.load.mockReturnValue(latest);
    resolve(snapshot()); await first;
    expect(mocks.advance).toHaveBeenCalledWith(latest, [], expect.objectContaining({ quoteOnly: true }));
    expect(mocks.collect).toHaveBeenCalledOnce();
  });
  it.each(['paused', 'closed'] as const)('does no price collection when %s', async mode => {
    mocks.paused = mode === 'paused'; mocks.open = mode !== 'closed';
    const { runPaperPriceMonitor } = await import('./paperPriceMonitor.js');
    await runPaperPriceMonitor(); expect(mocks.collect).not.toHaveBeenCalled();
  });
  it('discards an in-flight result after pause', async () => {
    mocks.collect.mockImplementation(async () => { mocks.paused = true; return snapshot(); });
    const { runPaperPriceMonitor } = await import('./paperPriceMonitor.js');
    await runPaperPriceMonitor(); expect(mocks.advance).not.toHaveBeenCalled();
  });
  it('rotates unfinished holdings after its time budget instead of starving them', async () => {
    const ledger = legacyStrategyLedger();
    ledger.trades = Array.from({ length: 35 }, (_, index) => ({ ...ledger.trades[0], symbol: String(index).padStart(6, '0') }));
    mocks.load.mockReturnValue({ ledger });
    mocks.collect.mockImplementation(async () => { vi.setSystemTime(Date.now() + 21_000); return snapshot(); });
    const { runPaperPriceMonitor, readPaperPriceMonitor } = await import('./paperPriceMonitor.js');
    await runPaperPriceMonitor(); await runPaperPriceMonitor();
    expect(mocks.collect.mock.calls[0][0]).toHaveLength(30);
    expect(mocks.collect.mock.calls[1][0][0].symbol).toBe('000030');
    expect(readPaperPriceMonitor()).toMatchObject({ heldCount: 35, staleCount: 35, running: false });
  });
  it('quotes held observed-exit positions before research-only symbols in every cycle', async () => {
    const ledger = legacyStrategyLedger(), base = ledger.trades[0];
    const research = Array.from({ length: 30 }, (_, index) => ({ ...base, symbol: String(index).padStart(6, '0'), status: 'CLOSED',
      exitResearch: { completedAt: null, watchUntilAt: '2026-09-25T06:30:00.000Z' } }));
    const held = ['900001', '900000'].map(symbol => ({ ...base, symbol, policy: { ...base.policy, exitModel: 'ADAPTIVE_OBSERVED' } }));
    ledger.trades = [...research, ...held] as unknown as PaperStrategyTrade[];
    mocks.load.mockReturnValue({ ledger });
    mocks.collect.mockImplementation(async () => { vi.setSystemTime(Date.now() + 21_000); return snapshot(); });
    const { runPaperPriceMonitor } = await import('./paperPriceMonitor.js');
    await runPaperPriceMonitor(); await runPaperPriceMonitor();
    const symbols = (call: number) => mocks.collect.mock.calls[call][0].map((item: { symbol: string }) => item.symbol);
    expect(symbols(0).slice(0, 3)).toEqual(['900000', '900001', '000000']);
    // Held positions stay ahead of research symbols that were never attempted.
    expect(symbols(1).slice(0, 3)).toEqual(['900000', '900001', '000028']);
  });
  it('reports minute monitoring and marks a held quote late only after two scheduled intervals', async () => {
    const quoteAt = Date.now(), ledger = legacyStrategyLedger();
    mocks.load.mockReturnValue({ ledger });
    mocks.collect.mockImplementation(async () => ({ ...snapshot(), observations: [{
      ...ledger.trades[0].entryObservation, observedAt: new Date(quoteAt).toISOString(),
    }] }));
    const { runPaperPriceMonitor, readPaperPriceMonitor } = await import('./paperPriceMonitor.js');
    expect(readPaperPriceMonitor()).toMatchObject({ intervalSeconds: 60, staleCount: 1 });
    await runPaperPriceMonitor();
    vi.setSystemTime(quoteAt + 61_000);
    expect(readPaperPriceMonitor()).toMatchObject({ intervalSeconds: 60, staleCount: 0, validCount: 1 });
    vi.setSystemTime(quoteAt + 120_000);
    expect(readPaperPriceMonitor().staleCount).toBe(0);
    vi.setSystemTime(quoteAt + 120_001);
    expect(readPaperPriceMonitor().staleCount).toBe(1);
  });
  it('records failure and permits the next cycle', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.collect.mockRejectedValueOnce(new Error('provider down'));
    const { runPaperPriceMonitor, readPaperPriceMonitor } = await import('./paperPriceMonitor.js');
    await expect(runPaperPriceMonitor()).rejects.toThrow('provider down');
    expect(readPaperPriceMonitor().error).toBe('provider down');
    await runPaperPriceMonitor(); expect(readPaperPriceMonitor().error).toBeUndefined(); log.mockRestore();
  });
});
