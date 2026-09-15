// @responsibility Verify paper observation provenance.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ universe: vi.fn(), watchlist: vi.fn(), news: vi.fn(), dart: vi.fn(), collect: vi.fn() }));
vi.mock('../../screener/dynamicUniverseExpander.js', () => ({ getExpandedUniverse: mocks.universe }));
vi.mock('../../persistence/watchlistRepo.js', () => ({ loadWatchlist: mocks.watchlist }));
vi.mock('../../learning/newsSupplyLogger.js', () => ({ loadNewsSupplyRecords: mocks.news }));
vi.mock('../../persistence/dartRepo.js', () => ({ loadDartAlerts: mocks.dart }));
vi.mock('../symbolDataCollector.js', () => ({ collectUnifiedSnapshot: mocks.collect }));
import { collectPaperExperimentSnapshot, isPaperMarketOpen } from './paperExperimentCollector.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-18T01:00:00Z'));
  mocks.universe.mockReturnValue([]);
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
  it('pairs dated investor share quantities with same-day volume from the shared snapshot', async () => {
    mocks.collect.mockResolvedValue({ perSymbol: { '005930': { quote: null,
      investorFlow: { stockCode: '005930', source: 'KIS_API', tradingDate: '2026-09-17', fetchedAt: '2026-09-18T00:59:00Z',
        foreignNetBuy: 999999, institutionalNetBuy: 888888,
        actualRows: [{ stck_bsop_date: '20260917', frgn_ntby_qty: '10', orgn_ntby_qty: '-20' }] },
      dailyBars: [{ date: '20260917', close: 100, volume: 1000 }] } } });
    const result = await collectPaperExperimentSnapshot([]);
    expect(result.observations[0].investorFlow).toMatchObject({ tradingDate: '2026-09-17', unit: 'SHARES',
      foreignNetShares: 10, institutionalNetShares: -20, volume: 1000, issue: null });
    expect(result.observations[0].price).toBeNull();
    expect(mocks.collect).toHaveBeenCalledTimes(1);
  });

  it('collects the union of all watchlist sections, observable news, and open experiments once', async () => {
    mocks.news.mockReturnValue([
      { id: 'n1', koreanStockCodes: ['000660.KS'], detectedAt: '2026-09-18T00:00:00Z', newsHeadline: 'news', source: 'SUPPLY_CHAIN', t5StockAvg: 99 },
      { id: 'future', koreanStockCodes: ['123456.KQ'], detectedAt: '2026-09-18T02:00:00Z', newsHeadline: 'future', source: 'SUPPLY_CHAIN' },
    ]);
    mocks.dart.mockReturnValue([{ stock_code: '035420', rcept_no: 'd1', report_nm: 'disclosure', alertedAt: '2026-09-18T00:00:00Z' }]);
    const result = await collectPaperExperimentSnapshot(['005930', '051910']);
    expect(mocks.collect).toHaveBeenCalledTimes(1);
    expect(mocks.collect.mock.calls[0][1].profile).toBe('PAPER');
    expect(mocks.collect.mock.calls[0][0]).toEqual(['005930', '000660', '035420', '051910']);
    expect(result.observations.find((item) => item.symbol === '000660')!.news).toMatchObject([
      { id: 'n1', headline: 'news', observedAt: '2026-09-18T00:00:00Z', source: 'SUPPLY_CHAIN' },
    ]);
    expect(JSON.stringify(result)).not.toContain('t5StockAvg');
    expect(result.observations.find((item) => item.symbol === '000660')!.news[0].assessment).toMatchObject({ direction: 'UNKNOWN', assessedAt: '2026-09-18T01:00:00.000Z' });
  });

  it('independently assesses disclosures instead of copying legacy sentiment or later returns', async () => {
    mocks.dart.mockReturnValue([{ stock_code: '005930', rcept_no: 'd1', report_nm: '상장폐지', alertedAt: '2026-09-18T00:00:00Z', sentiment: 'POSITIVE' }]);
    const result = await collectPaperExperimentSnapshot([]);
    expect(result.observations[0].news[0]).toMatchObject({ source: 'DART', assessment: { direction: 'NEGATIVE', method: 'DISCLOSURE_TITLE_RULES' } });
  });

  it('observes the expanded universe even when the legacy watchlist has no admitted stocks', async () => {
    mocks.watchlist.mockReturnValue([]);
    mocks.universe.mockReturnValue([{ code: '000660', name: 'SK Hynix' }, { code: '005930', name: 'Samsung' }]);
    const result = await collectPaperExperimentSnapshot(['005930']);
    expect(mocks.collect.mock.calls[0][0]).toEqual(['000660', '005930']);
    expect(result.observations).toHaveLength(2);
    expect(result.observations.every(item => item.price === 10000)).toBe(true);
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
    expect(result.observations[0]).toMatchObject({ price: null, issue: 'CURRENT_QUOTE_STALE' });
  });

  it.each([
    [null, 'CURRENT_QUOTE_UNAVAILABLE'],
    [{ code: '005930', currentPrice: null, fetchedAt: '2026-09-18T01:00:00Z' }, 'CURRENT_QUOTE_INVALID_PRICE'],
    [{ code: '005930', currentPrice: 0, fetchedAt: '2026-09-18T01:00:00Z' }, 'CURRENT_QUOTE_INVALID_PRICE'],
    [{ code: '000660', currentPrice: 10000, fetchedAt: '2026-09-18T01:00:00Z' }, 'CURRENT_QUOTE_SYMBOL_MISMATCH'],
    [{ code: '005930', currentPrice: 10000, fetchedAt: 'bad-time' }, 'CURRENT_QUOTE_TIME_INVALID'],
    [{ code: '005930', currentPrice: 10000, fetchedAt: '2026-09-18T02:00:00Z' }, 'CURRENT_QUOTE_TIME_INVALID'],
  ])('separates quote failures without manufacturing an entry price (%s)', async (quote, issue) => {
    mocks.collect.mockResolvedValue({ perSymbol: { '005930': { quote, dailyBars: [] } } });
    const result = await collectPaperExperimentSnapshot([]);
    expect(result.observations[0]).toMatchObject({ price: null, issue });
  });

  it('forwards real collection progress and preserves the opening boundary', async () => {
    vi.setSystemTime(new Date('2026-09-17T23:59:00Z'));
    mocks.collect.mockImplementationOnce(async (_codes, options) => {
      options.onProgress(1, 1);
      vi.setSystemTime(new Date('2026-09-18T00:01:00Z'));
      return { perSymbol: {} };
    });
    const progress = vi.fn();
    const result = await collectPaperExperimentSnapshot([], progress);
    expect(progress).toHaveBeenCalledWith(1, 1);
    expect(result.marketOpen).toBe(false);
  });

  it('preserves closed OHLCV and market from the same collector snapshot for later research', async () => {
    mocks.collect.mockResolvedValue({ perSymbol: { '005930': { market: 'KOSPI', quote: null,
      dailyBars: [{ date: '20260917', close: 100, open: 95, high: 110, low: 90, volume: 0 },
        { date: '20260918', close: 150, high: 200, low: 80, volume: 1000 }] } } });
    const result = await collectPaperExperimentSnapshot([]);
    expect(result.observations[0]).toMatchObject({ market: 'KOSPI', dailyCloses: [
      { tradingDate: '2026-09-17', close: 100, open: 95, high: 110, low: 90, volume: 0 },
    ] });
    expect(result.observations[0].dailyCloses).toHaveLength(1);
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
