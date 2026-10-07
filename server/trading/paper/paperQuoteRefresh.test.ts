// @responsibility Verify bounded price refresh without fabricating quote provenance.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ multi: vi.fn(), single: vi.fn() }));
vi.mock('../../clients/kisClient.js', () => ({ fetchKisMultiQuotes: mocks.multi, fetchKisStockFullQuote: mocks.single, KIS_MULTI_QUOTE_LIMIT: 30 }));
import { refreshPaperQuotes } from './paperQuoteRefresh.js';

const start = Date.parse('2026-10-07T01:00:00Z');
const target = (symbol = '005930') => ({ symbol, quote: { code: symbol, currentPrice: 100, per: 10, fetchedAt: new Date(start).toISOString() } });
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(start + 300_000);
  mocks.multi.mockImplementation(async (codes: string[]) => new Map(codes.map(code => [code,
    { code, currentPrice: 110, fetchedAt: new Date().toISOString() }])));
  mocks.single.mockResolvedValue(null);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('paper final quote refresh', () => {
  it('refreshes oldest quotes first in batches of 30 without mutating source quotes', async () => {
    const targets = Array.from({ length: 61 }, (_, i) => target(String(i).padStart(6, '0')));
    targets[0].quote.fetchedAt = new Date(start + 200_000).toISOString();
    const original = structuredClone(targets);
    const result = await refreshPaperQuotes(targets, start);
    expect(mocks.multi.mock.calls.map(call => call[0].length)).toEqual([30, 30, 1]);
    expect(mocks.multi.mock.calls[0][0][0]).toBe('000001');
    expect(result.size).toBe(61); expect(targets).toEqual(original);
    expect(result.get('000000')).toMatchObject({ currentPrice: 110, per: null, fetchedAt: new Date().toISOString() });
    expect(mocks.single).not.toHaveBeenCalled();
  });
  it('recomputes PER at a multi-quote price from the scan EPS, never reusing the old PER', async () => {
    const targets = ['005930', '000660', '035420', '207940'].map((symbol, index) => {
      const item = target(symbol);
      return { ...item, quote: { ...item.quote, eps: [8, -5, 0, null][index] } };
    });
    const result = await refreshPaperQuotes(targets, start);
    expect(result.get('005930')).toMatchObject({ currentPrice: 110, per: 13.75 });
    for (const symbol of ['000660', '035420', '207940']) expect(result.get(symbol)?.per).toBeNull();
  });
  it('does not requery fresh quotes or legitimize pre-scan cached data', async () => {
    vi.setSystemTime(start + 89_999);
    expect((await refreshPaperQuotes([target()], start)).size).toBe(0);
    vi.setSystemTime(start + 300_000);
    expect((await refreshPaperQuotes([target()], start + 1)).size).toBe(0);
    expect(mocks.multi).not.toHaveBeenCalled(); expect(mocks.single).not.toHaveBeenCalled();
  });
  it.each(['missing', 'price', 'symbol', 'cached', 'future', 'invalidTime'])('falls back for %s multi quotes using genuine single quote fields', async issue => {
    const quote = { code: '005930', currentPrice: 110, fetchedAt: new Date().toISOString() };
    if (issue === 'price') quote.currentPrice = 0;
    if (issue === 'symbol') quote.code = '000660';
    if (issue === 'cached') quote.fetchedAt = new Date(Date.now() - 1).toISOString();
    if (issue === 'future') quote.fetchedAt = new Date(Date.now() + 1).toISOString();
    if (issue === 'invalidTime') quote.fetchedAt = 'invalid';
    mocks.multi.mockResolvedValue(issue === 'missing' ? null : new Map([['005930', quote]]));
    mocks.single.mockResolvedValue({ code: '005930', currentPrice: 120, per: 12, eps: 9, fetchedAt: new Date().toISOString() });
    const source = target();
    expect((await refreshPaperQuotes([{ ...source, quote: { ...source.quote, eps: 8 } }], start)).get('005930'))
      .toMatchObject({ currentPrice: 120, per: 12 });
    expect(mocks.single).toHaveBeenCalledWith('005930');
  });
  it('keeps a halt reported by the single-quote fallback with its frozen price', async () => {
    mocks.multi.mockResolvedValue(null);
    mocks.single.mockImplementation(async (code: string) => ({ code, currentPrice: 120, per: 12,
      fetchedAt: new Date().toISOString(), tradingHalted: code === '005930' }));
    const result = await refreshPaperQuotes([target('005930'), target('000660')], start);
    expect(result.get('005930')).toMatchObject({ currentPrice: 120, tradingHalted: true });
    expect(result.get('000660')).not.toHaveProperty('tradingHalted');
  });
  it('stops starting requests at the budget without relabeling unanswered prices', async () => {
    mocks.multi.mockImplementation(async (codes: string[]) => {
      const fetchedAt = new Date().toISOString(); vi.setSystemTime(Date.now() + 20_000);
      return new Map([[codes[0], { code: codes[0], currentPrice: 110, fetchedAt }]]);
    });
    const result = await refreshPaperQuotes(Array.from({ length: 65 }, (_, i) => target(String(i).padStart(6, '0'))), start);
    expect(result.size).toBe(1); expect(mocks.multi).toHaveBeenCalledTimes(1); expect(mocks.single).not.toHaveBeenCalled();
    expect(result.get('000000')?.fetchedAt).toBe(new Date(start + 300_000).toISOString());
  });
  it('bounds unavailable-multi fallback to five concurrent requests and the same time budget', async () => {
    mocks.multi.mockResolvedValue(null);
    const complete: Array<() => void> = [];
    mocks.single.mockImplementation(() => new Promise(resolve => complete.push(() => resolve(null))));
    const request = refreshPaperQuotes(Array.from({ length: 65 }, (_, i) => target(String(i).padStart(6, '0'))), start);
    await vi.waitFor(() => expect(mocks.single).toHaveBeenCalledTimes(5));
    vi.setSystemTime(start + 320_000); complete.forEach(resolve => resolve());
    expect((await request).size).toBe(0);
    expect(mocks.multi).toHaveBeenCalledTimes(1); expect(mocks.single).toHaveBeenCalledTimes(5);
  });
  it('isolates provider exceptions without manufacturing fresh observations', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.multi.mockRejectedValue(new Error('unavailable')); mocks.single.mockRejectedValue(new Error('unavailable'));
    const source = target();
    expect((await refreshPaperQuotes([source], start)).size).toBe(0);
    expect(source.quote.fetchedAt).toBe(new Date(start).toISOString()); expect(warn).toHaveBeenCalledTimes(2);
  });
});
