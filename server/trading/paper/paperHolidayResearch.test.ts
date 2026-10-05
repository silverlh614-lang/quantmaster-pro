// @responsibility Verify stored-evidence holiday research scheduling.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(), view: vi.fn(), baseline: vi.fn(), strategy: vi.fn(), maintenance: vi.fn(), queue: vi.fn(),
  collect: vi.fn(), index: vi.fn(), advance: vi.fn(), save: vi.fn(),
}));
vi.mock('./paperResearchRuntime.js', () => ({ refreshPaperResearch: mocks.refresh, getPaperResearchView: mocks.view }));
vi.mock('../../persistence/paperExperimentRepo.js', () => ({ loadPaperExperimentLedger: mocks.baseline, savePaperExperimentLedger: mocks.save }));
vi.mock('../../persistence/paperStorageMaintenance.js', () => ({ runPaperStorageMaintenance: mocks.maintenance }));
vi.mock('./paperStrategyRuntime.js', () => ({ loadPaperStrategyState: mocks.strategy, advancePaperStrategy: mocks.advance }));
vi.mock('./paperProgramResearch.js', () => ({ queuePaperProgramResearch: mocks.queue }));
vi.mock('./paperExperimentCollector.js', () => ({ collectPaperExperimentSnapshot: mocks.collect }));
vi.mock('./paperIndexCollection.js', () => ({ refreshPaperIndexSeries: mocks.index }));
vi.mock('../../persistence/paperStrategyRepo.js', () => ({ savePaperStrategyLedger: mocks.save }));

const date = (at: string) => new Date(at);
const sunday = '2026-10-04T08:00:00+09:00';
const load = async () => (await import('./paperHolidayResearch.js')).runPaperHolidayResearch;

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  mocks.refresh.mockReturnValue(true);
  mocks.view.mockReturnValue({ asOf: sunday });
  mocks.baseline.mockReturnValue({ experiments: [], lastRun: { asOf: '2026-10-02T06:30:00Z' } });
  mocks.strategy.mockReturnValue({ ledger: {
    trades: [{ id: 'held', status: 'OPEN', entryAt: '2026-10-02T00:10:00Z' }],
    lastRun: { asOf: '2026-10-02T06:30:00Z' }, adaptive: { evaluatedAt: '2026-10-02T00:00:00Z' },
  } });
  mocks.queue.mockResolvedValue(undefined);
});

describe('holiday research without market collection', () => {
  it('uses stored evidence without collecting prices, changing trades, or replacing observation timestamps', async () => {
    const run = await load(), baseline = mocks.baseline(), strategy = mocks.strategy();
    const before = structuredClone({ baseline, strategy });
    await run(date(sunday));
    expect(mocks.refresh).toHaveBeenCalledExactlyOnceWith();
    expect(mocks.maintenance).toHaveBeenCalledExactlyOnceWith(baseline, strategy.ledger, date(sunday), false);
    expect(mocks.queue).toHaveBeenCalledExactlyOnceWith(strategy.ledger.adaptive,
      { asOf: date(sunday).toISOString(), marketOpen: false });
    expect({ baseline, strategy }).toEqual(before);
    for (const call of [mocks.collect, mocks.index, mocks.advance, mocks.save]) expect(call).not.toHaveBeenCalled();
  });

  it('only checks inputs hourly, avoiding heavy work when inputs stay unchanged across holiday dates', async () => {
    mocks.refresh.mockReturnValueOnce(true).mockReturnValue(false);
    const run = await load();
    await run(date(sunday));
    await run(date('2026-10-04T08:01:00+09:00'));
    await run(date('2026-10-04T08:59:59+09:00'));
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    await run(date('2026-10-04T09:00:00+09:00'));
    await run(date('2026-10-05T00:00:00+09:00'));
    expect(mocks.refresh).toHaveBeenCalledTimes(3);
    expect(mocks.baseline).toHaveBeenCalledTimes(1);
    expect(mocks.maintenance).toHaveBeenCalledTimes(1);
    expect(mocks.queue).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent calls while the existing research queue is running', async () => {
    let finish!: () => void;
    mocks.queue.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
    const run = await load(), first = run(date(sunday));
    expect(run(date('2026-10-04T08:01:00+09:00'))).toBe(first);
    await Promise.resolve();
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    finish();
    await first;
  });

  it('restores a report after restart without restarting maintenance or AI for unchanged data', async () => {
    await (await load())(date(sunday));
    vi.resetModules();
    mocks.refresh.mockReturnValue(false);
    await (await load())(date('2026-10-04T08:15:00+09:00'));
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
    expect(mocks.maintenance).toHaveBeenCalledTimes(1);
    expect(mocks.queue).toHaveBeenCalledTimes(1);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('processes newly saved evidence on a later hourly check', async () => {
    mocks.refresh.mockReturnValueOnce(false).mockReturnValueOnce(true);
    const run = await load();
    await run(date(sunday));
    expect(mocks.baseline).not.toHaveBeenCalled();
    await run(date('2026-10-04T09:00:00+09:00'));
    expect(mocks.queue).toHaveBeenCalledTimes(1);
  });

  it('propagates research errors and prevents heavy work from retrying every minute', async () => {
    mocks.view.mockReturnValueOnce({ error: 'archive unavailable' });
    const run = await load();
    await expect(run(date(sunday))).rejects.toThrow('archive unavailable');
    expect(mocks.baseline).not.toHaveBeenCalled();
    await run(date('2026-10-04T08:01:00+09:00'));
    await run(date('2026-10-04T08:59:59+09:00'));
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    await run(date('2026-10-04T09:00:00+09:00'));
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
    expect(mocks.queue).toHaveBeenCalledTimes(1);
  });

  it('preserves an unreadable strategy ledger and reports its error', async () => {
    mocks.strategy.mockReturnValueOnce({ ledger: null, error: 'invalid strategy ledger' });
    const run = await load();
    await expect(run(date(sunday))).rejects.toThrow('invalid strategy ledger');
    expect(mocks.maintenance).not.toHaveBeenCalled();
    expect(mocks.queue).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    mocks.refresh.mockReturnValue(false);
    await run(date('2026-10-04T09:00:00+09:00'));
    expect(mocks.queue).toHaveBeenCalledTimes(1);
  });

  it('refreshes stored research without requiring an adaptive model', async () => {
    mocks.strategy.mockReturnValue({ ledger: { trades: [], lastRun: null } });
    await (await load())(date(sunday));
    expect(mocks.maintenance).toHaveBeenCalledTimes(1);
    expect(mocks.queue).not.toHaveBeenCalled();
  });

  it('does not start holiday work on a trading day or an invalid timestamp', async () => {
    const run = await load();
    await run(date('2026-10-06T08:00:00+09:00'));
    await expect(run(new Date('invalid'))).rejects.toThrow('기준 시각');
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
