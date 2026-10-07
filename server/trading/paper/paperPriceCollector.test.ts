// @responsibility Verify fresh quote collection with provider failure isolation.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ quote: vi.fn(), multi: vi.fn(), open: true }));
vi.mock('../../clients/kisClient.js', () => ({ fetchKisStockFullQuote: mocks.quote, fetchKisMultiQuotes: mocks.multi,
  KIS_MULTI_QUOTE_LIMIT: 30 }));
vi.mock('./paperExperimentCollector.js', () => ({ isPaperMarketOpen: () => mocks.open }));
import { collectPaperPriceSnapshot } from './paperPriceCollector.js';
import { __resetPaperTradingHaltsForTest, paperTradingHaltStatus, recordPaperTradingHalt } from './paperTradingHalts.js';
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime('2026-09-18T01:01:00Z'); mocks.open = true; __resetPaperTradingHaltsForTest();
  mocks.quote.mockReset(); mocks.multi.mockReset(); mocks.multi.mockResolvedValue(null);
});
afterEach(() => vi.useRealTimers());
it('accepts fresh matching quotes without fabricating features', async () => {
  mocks.quote.mockResolvedValue({ code: '005930', currentPrice: 100, fetchedAt: new Date().toISOString() });
  const result = await collectPaperPriceSnapshot([{ symbol: '005930', name: '삼성전자' }]);
  expect(result).toMatchObject({ quoteOnly: true, marketOpen: true, observations: [{ price: 100 }] });
  expect(result.observations[0].features).toBeUndefined();
});
it.each([
  { code: '000000', currentPrice: 100, fetchedAt: '2026-09-18T01:01:00Z' },
  { code: '005930', currentPrice: 0, fetchedAt: '2026-09-18T01:01:00Z' },
  { code: '005930', currentPrice: 100, fetchedAt: '2026-09-18T01:00:59Z' },
  { code: '005930', currentPrice: 100, fetchedAt: '2026-09-18T01:01:01Z' },
  { code: '005930', currentPrice: 100 },
])('rejects invalid quote %j', async quote => {
  mocks.quote.mockResolvedValue(quote);
  expect((await collectPaperPriceSnapshot([{ symbol: '005930', name: '삼성전자' }])).observations[0]).toMatchObject({ price: null, issue: 'CURRENT_QUOTE_UNAVAILABLE' });
});
it('isolates provider errors and rejects a batch that finishes outside market hours', async () => {
  const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
  mocks.quote.mockImplementation(async () => { mocks.open = false; throw new Error('offline'); });
  const result = await collectPaperPriceSnapshot([{ symbol: '005930', name: '삼성전자' }]);
  expect(result).toMatchObject({ marketOpen: false, observations: [{ price: null }] }); log.mockRestore();
});
it('prices up to 30 holdings per multi-stock request and keeps single quotes only for unanswered codes', async () => {
  const at = new Date().toISOString();
  const targets = Array.from({ length: 31 }, (_, index) => ({ symbol: String(index).padStart(6, '0'), name: `종목${index}` }));
  for (const { symbol } of targets) recordPaperTradingHalt(symbol, false, '2026-09-18T01:00:00Z');
  mocks.multi.mockImplementation(async (codes: string[]) => new Map(codes.filter(code => code !== '000001')
    .map(code => [code, { code, currentPrice: code === '000002' ? null : 1000, fetchedAt: at }])));
  mocks.quote.mockResolvedValue({ code: '000001', currentPrice: 900, fetchedAt: at });
  const result = await collectPaperPriceSnapshot(targets);
  expect(mocks.multi.mock.calls.map(([codes]) => codes.length)).toEqual([30, 1]);
  expect(mocks.quote.mock.calls).toEqual([['000001']]);
  const bySymbol = new Map(result.observations.map(item => [item.symbol, item]));
  expect(result.observations).toHaveLength(31);
  expect(bySymbol.get('000000')).toMatchObject({ price: 1000, observedAt: at, source: 'KIS_REST_REQUEST_OBSERVED' });
  expect(bySymbol.get('000001')).toMatchObject({ price: 900 });
  expect(bySymbol.get('000002')).toMatchObject({ price: null, issue: 'CURRENT_QUOTE_UNAVAILABLE' });
  expect(bySymbol.get('000030')).toMatchObject({ price: 1000 });
});
it('checks halted and not-yet-confirmed holdings with the single quote that reports halts', async () => {
  const at = new Date().toISOString();
  recordPaperTradingHalt('000660', false, '2026-09-18T01:00:00Z');
  recordPaperTradingHalt('035420', true, '2026-09-18T01:00:00Z');
  mocks.multi.mockImplementation(async (codes: string[]) => new Map(codes.map(code => [code, { code, currentPrice: 1000, fetchedAt: at }])));
  mocks.quote.mockImplementation(async (code: string) => ({ code, currentPrice: 500, fetchedAt: at, tradingHalted: code === '035420' }));
  const result = await collectPaperPriceSnapshot(['005930', '000660', '035420'].map(symbol => ({ symbol, name: symbol })));
  expect(mocks.multi.mock.calls).toEqual([[['000660']]]);
  expect(mocks.quote.mock.calls.map(([code]) => code).sort()).toEqual(['005930', '035420']);
  const bySymbol = new Map(result.observations.map(item => [item.symbol, item]));
  expect(bySymbol.get('005930')).toMatchObject({ price: 500 }); expect(bySymbol.get('005930')!.issue).toBeUndefined();
  expect(bySymbol.get('000660')).toMatchObject({ price: 1000 });
  // The frozen price of a halted holding is neither a valuation update nor a sale price.
  expect(bySymbol.get('035420')).toMatchObject({ price: null, observedAt: at, issue: 'TRADING_HALTED' });
  expect([paperTradingHaltStatus('005930'), paperTradingHaltStatus('035420')]).toEqual([false, true]);
});
it('returns a holding to the multi-stock quote once the single quote shows the halt lifted', async () => {
  recordPaperTradingHalt('035420', true, '2026-09-18T01:00:00Z');
  mocks.quote.mockImplementation(async (code: string) => ({ code, currentPrice: 450, fetchedAt: new Date().toISOString(), tradingHalted: false }));
  const resumed = await collectPaperPriceSnapshot([{ symbol: '035420', name: 'NAVER' }]);
  expect(resumed.observations[0]).toMatchObject({ price: 450 }); expect(resumed.observations[0].issue).toBeUndefined();
  mocks.multi.mockImplementation(async (codes: string[]) => new Map(codes.map(code => [code, { code, currentPrice: 460, fetchedAt: new Date().toISOString() }])));
  vi.setSystemTime('2026-09-18T01:02:00Z');
  expect((await collectPaperPriceSnapshot([{ symbol: '035420', name: 'NAVER' }])).observations[0]).toMatchObject({ price: 460 });
  expect(mocks.quote).toHaveBeenCalledTimes(1); expect(mocks.multi).toHaveBeenCalledWith(['035420']);
});
