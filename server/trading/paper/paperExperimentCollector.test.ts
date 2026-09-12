// @responsibility Verify paper observation provenance.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ watchlist: vi.fn(), news: vi.fn(), dart: vi.fn(), collect: vi.fn() }));
vi.mock('../../persistence/watchlistRepo.js', () => ({ loadWatchlist: mocks.watchlist }));
vi.mock('../../learning/newsSupplyLogger.js', () => ({ loadNewsSupplyRecords: mocks.news }));
vi.mock('../../persistence/dartRepo.js', () => ({ loadDartAlerts: mocks.dart }));
vi.mock('../symbolDataCollector.js', () => ({ collectUnifiedSnapshot: mocks.collect }));
import { collectPaperExperimentSnapshot, isPaperMarketOpen } from './paperExperimentCollector.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-18T01:00:00Z'));
  mocks.watchlist.mockReturnValue([{ code: '005930', name: 'Samsung', section: 'MOMENTUM' }]);
  mocks.news.mockReturnValue([]);
  mocks.dart.mockReturnValue([]);
  mocks.collect.mockImplementation(async (codes: string[]) => ({ perSymbol: Object.fromEntries(codes.map((code) => [code, {
    name: code, quote: { code, currentPrice: 10000, fetchedAt: new Date().toISOString() },
    dailyBars: [{ date: '20260917', close: 9000 }, { date: '20260918', close: 20000 }, { date: '20260921', close: 50000 }],
  }])) }));
});
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

describe('paper observation collector', () => {
  it('collects the union of all watchlist sections, observable news, and open experiments once', async () => {
    mocks.news.mockReturnValue([
      { id: 'n1', koreanStockCodes: ['000660.KS'], detectedAt: '2026-09-18T00:00:00Z', newsHeadline: 'news', source: 'SUPPLY_CHAIN', t5StockAvg: 99 },
      { id: 'future', koreanStockCodes: ['123456.KQ'], detectedAt: '2026-09-18T02:00:00Z', newsHeadline: 'future', source: 'SUPPLY_CHAIN' },
    ]);
    mocks.dart.mockReturnValue([{ stock_code: '035420', rcept_no: 'd1', report_nm: 'disclosure', alertedAt: '2026-09-18T00:00:00Z' }]);
    const result = await collectPaperExperimentSnapshot(['005930', '051910']);
    expect(mocks.collect).toHaveBeenCalledTimes(1);
    expect(mocks.collect.mock.calls[0][0]).toEqual(['005930', '000660', '035420', '051910']);
    expect(result.observations.find((item) => item.symbol === '000660')!.news).toEqual([
      { id: 'n1', headline: 'news', observedAt: '2026-09-18T00:00:00Z', source: 'SUPPLY_CHAIN' },
    ]);
    expect(JSON.stringify(result)).not.toContain('t5StockAvg');
  });

  it('keeps completed historical bars and excludes current intraday/future closes', async () => {
    const result = await collectPaperExperimentSnapshot([]);
    expect(result.observations[0].dailyCloses).toEqual([{ tradingDate: '2026-09-17', close: 9000, availableAt: '2026-09-18T01:00:00.000Z' }]);
    expect(result.observations[0].return1dPct).toBeCloseTo(11.111111);
    expect(result.observations[0].return5dPct).toBeNull();
  });

  it('never turns a cached price or daily close into a current entry price', async () => {
    mocks.collect.mockResolvedValue({ perSymbol: { '005930': {
      quote: { code: '005930', currentPrice: 10000, fetchedAt: '2026-09-17T01:00:00Z' }, dailyBars: [{ date: '20260917', close: 9000 }],
    } } });
    const result = await collectPaperExperimentSnapshot([]);
    expect(result.observations[0]).toMatchObject({ price: null, issue: 'CURRENT_QUOTE_UNAVAILABLE' });
  });

  it('does not classify a bar requested before the closing auction as finalized', async () => {
    vi.setSystemTime(new Date('2026-09-18T06:29:00Z'));
    mocks.collect.mockImplementationOnce(async () => {
      vi.setSystemTime(new Date('2026-09-18T06:31:00Z'));
      return { perSymbol: { '005930': { quote: null, dailyBars: [{ date: '20260918', close: 10000 }] } } };
    });
    const result = await collectPaperExperimentSnapshot([]);
    expect(result.marketOpen).toBe(false);
    expect(result.observations[0].dailyCloses).toEqual([]);
  });

  it('uses actual calendar hours even when data-fetch override flags are present', () => {
    vi.stubEnv('DATA_FETCH_FORCE_MARKET', 'true');
    expect(isPaperMarketOpen(new Date('2026-09-24T01:00:00Z'))).toBe(false);
    expect(isPaperMarketOpen(new Date('2026-09-18T06:30:00Z'))).toBe(false);
    expect(isPaperMarketOpen(new Date('2026-09-18T01:00:00Z'))).toBe(true);
    vi.unstubAllEnvs();
  });
});
