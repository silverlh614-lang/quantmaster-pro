// @responsibility Verify minimal paper collection and closed-bar cache provenance.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ quote: vi.fn(), bars: vi.fn(), flow: vi.fn(), program: vi.fn(), dart: vi.fn(), market: vi.fn() }));
vi.mock('../clients/kisClient.js', () => ({
  fetchKisStockFullQuote: mocks.quote, fetchKisStockDailyBars: mocks.bars,
  fetchKisInvestorTradeByStockDaily: mocks.flow, fetchKisStockProgramTrade: mocks.program,
}));
vi.mock('../persistence/macroStateRepo.js', () => ({ loadMacroState: () => null }));
vi.mock('../persistence/krxStockMasterRepo.js', () => ({ getAllStockEntries: () => [] }));
vi.mock('./gate2/gate2DartCanonicalSlot.js', () => ({ buildSymbolDartFinancialsSlot: mocks.dart }));
vi.mock('./signalScanner/marketProgramFlowProvider.js', () => ({ resolveMarketProgramFlow: mocks.market }));

beforeEach(() => {
  vi.resetModules(); vi.resetAllMocks(); vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-18T01:00:00Z'));
  vi.stubEnv('USE_UNIFIED_SOURCE_SNAPSHOT', 'true');
  mocks.quote.mockImplementation(async (code: string) => ({ code, currentPrice: 10000, fetchedAt: new Date().toISOString() }));
  mocks.bars.mockResolvedValue([{ date: '2026-09-18', close: 10000 }, { date: '2026-09-17', close: 9000 }]);
  mocks.flow.mockResolvedValue(null); mocks.program.mockResolvedValue(null);
  mocks.dart.mockResolvedValue(null); mocks.market.mockResolvedValue(undefined);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('paper collection profile', () => {
  it('uses the same KIS quote/history channel, omits unused calls and reports real progress', async () => {
    const { collectUnifiedSnapshot } = await import('./symbolDataCollector.js');
    const onProgress = vi.fn();
    const result = await collectUnifiedSnapshot(['005930', '000660'], { profile: 'PAPER', onProgress });
    expect(mocks.quote).toHaveBeenCalledTimes(2);
    expect(mocks.bars).toHaveBeenCalledTimes(2);
    expect(mocks.flow).toHaveBeenCalledTimes(2);
    expect(mocks.flow).toHaveBeenCalledWith('005930', 'LOW', '2026-09-17');
    for (const mock of [mocks.program, mocks.dart, mocks.market]) expect(mock).not.toHaveBeenCalled();
    expect(result.perSymbol['005930']).toMatchObject({ quote: { currentPrice: 10000 }, investorFlow: null, programTrade: null, dartFinancials: null });
    expect(onProgress.mock.calls).toEqual([[0, 2], [1, 2], [2, 2]]);
  });

  it('reuses only closed bars, fetches every current quote and isolates cached values from snapshots', async () => {
    const { collectUnifiedSnapshot } = await import('./symbolDataCollector.js');
    const first = await collectUnifiedSnapshot(['005930'], { profile: 'PAPER' });
    expect(first.perSymbol['005930'].dailyBars).toEqual([{ date: '2026-09-17', close: 9000 }]);
    first.perSymbol['005930'].dailyBars[0].close = 1;
    vi.setSystemTime(new Date('2026-09-18T01:01:00Z'));
    const next = await collectUnifiedSnapshot(['005930'], { profile: 'PAPER' });
    expect(next.perSymbol['005930'].dailyBars[0].close).toBe(9000);
    expect(next.perSymbol['005930'].quote?.fetchedAt).toBe('2026-09-18T01:01:00.000Z');
    expect(mocks.quote).toHaveBeenCalledTimes(2);
    expect(mocks.bars).toHaveBeenCalledTimes(1);
  });

  it('retains all default collection calls and never substitutes the paper cache for full history', async () => {
    const { collectUnifiedSnapshot } = await import('./symbolDataCollector.js');
    await collectUnifiedSnapshot(['005930'], { profile: 'PAPER' });
    const full = await collectUnifiedSnapshot(['005930']);
    expect(mocks.bars).toHaveBeenCalledTimes(2);
    expect(mocks.flow).toHaveBeenCalledTimes(2);
    for (const mock of [mocks.program, mocks.dart, mocks.market]) expect(mock).toHaveBeenCalledTimes(1);
    expect(full.perSymbol['005930'].dailyBars[0].date).toBe('2026-09-18');
  });

  it('refreshes expired bars and invalidates the cache at the close even within the TTL', async () => {
    const { collectUnifiedSnapshot } = await import('./symbolDataCollector.js');
    await collectUnifiedSnapshot(['005930'], { profile: 'PAPER' });
    vi.setSystemTime(new Date('2026-09-18T02:00:00Z'));
    await collectUnifiedSnapshot(['005930'], { profile: 'PAPER' });
    expect(mocks.bars).toHaveBeenCalledTimes(2);
    vi.setSystemTime(new Date('2026-09-18T06:29:00Z'));
    await collectUnifiedSnapshot(['005930'], { profile: 'PAPER' });
    vi.setSystemTime(new Date('2026-09-18T06:31:00Z'));
    const closed = await collectUnifiedSnapshot(['005930'], { profile: 'PAPER' });
    expect(mocks.bars).toHaveBeenCalledTimes(4);
    expect(closed.perSymbol['005930'].dailyBars[0].date).toBe('2026-09-18');
  });

  it('does not finalize a candle requested before close or cache delayed/empty responses', async () => {
    const { collectUnifiedSnapshot } = await import('./symbolDataCollector.js');
    vi.setSystemTime(new Date('2026-09-18T06:29:00Z'));
    mocks.bars.mockImplementationOnce(async () => {
      vi.setSystemTime(new Date('2026-09-18T06:31:00Z'));
      return [{ date: '2026-09-18', close: 10000 }, { date: '2026-09-17', close: 9000 }];
    });
    const crossing = await collectUnifiedSnapshot(['005930'], { profile: 'PAPER' });
    expect(crossing.perSymbol['005930'].dailyBars.map(bar => bar.date)).toEqual(['2026-09-17']);
    mocks.bars.mockResolvedValueOnce([{ date: '2026-09-17', close: 9000 }]).mockResolvedValueOnce([]);
    await collectUnifiedSnapshot(['005930'], { profile: 'PAPER' });
    await collectUnifiedSnapshot(['005930'], { profile: 'PAPER' });
    const recovered = await collectUnifiedSnapshot(['005930'], { profile: 'PAPER' });
    expect(mocks.bars).toHaveBeenCalledTimes(4);
    expect(recovered.perSymbol['005930'].dailyBars[0].date).toBe('2026-09-18');
  });

  it('keeps previous trading-day bars over a weekend and isolates a failed symbol', async () => {
    const { collectUnifiedSnapshot } = await import('./symbolDataCollector.js');
    vi.setSystemTime(new Date('2026-09-21T00:05:00Z'));
    mocks.quote.mockRejectedValueOnce(new Error('quote unavailable'));
    const onProgress = vi.fn();
    const result = await collectUnifiedSnapshot(['005930', '000660'], { profile: 'PAPER', onProgress });
    expect(result.perSymbol['005930'].quote).toBeNull();
    expect(result.perSymbol['000660'].quote?.currentPrice).toBe(10000);
    expect(result.perSymbol['005930'].dailyBars[0].date).toBe('2026-09-18');
    expect(onProgress).toHaveBeenLastCalledWith(2, 2);
  });
});
