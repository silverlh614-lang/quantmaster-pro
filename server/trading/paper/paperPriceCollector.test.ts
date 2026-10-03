// @responsibility Verify fresh quote collection with provider failure isolation.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ quote: vi.fn(), open: true }));
vi.mock('../../clients/kisClient.js', () => ({ fetchKisStockFullQuote: mocks.quote }));
vi.mock('./paperExperimentCollector.js', () => ({ isPaperMarketOpen: () => mocks.open }));
import { collectPaperPriceSnapshot } from './paperPriceCollector.js';
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime('2026-09-18T01:01:00Z'); mocks.open = true; mocks.quote.mockReset(); });
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
