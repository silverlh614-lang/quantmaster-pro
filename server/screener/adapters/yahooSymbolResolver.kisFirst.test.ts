import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../persistence/krxStockMasterRepo.js', () => ({
  getStockByCode: (code: string) => ({ code, name: 'Samsung Electronics', market: 'KOSPI' as const }),
}));

vi.mock('../../persistence/yahooFreshnessLedger.js', () => ({
  updateYahooFreshness: vi.fn(),
}));

const mocks = vi.hoisted(() => ({
  fetchKisQuoteFallback: vi.fn(),
}));

vi.mock('./kisQuoteAdapter.js', () => ({
  fetchKisQuoteFallback: mocks.fetchKisQuoteFallback,
}));

const { fetchYahooQuoteWithMarketFallback } = await import('./yahooSymbolResolver.js');

function makeQuote(price: number): any {
  return {
    price,
    dayOpen: price,
    prevClose: price - 100,
    changePercent: 0.14,
    volume: 1000,
    avgVolume: 1000,
    ma5: price,
    ma20: price,
    ma60: price,
    high5d: price,
    high20d: price,
    high60d: price,
    atr: 1,
    atr20avg: 1,
    per: 0,
    rsi14: 50,
    macd: 0,
    macdSignal: 0,
    macdHistogram: 0,
    rsi5dAgo: 50,
    weeklyRSI: 50,
    ma60TrendUp: false,
    macd5dHistAgo: 0,
    return5d: 0,
    return20d: 0,
    bbWidthCurrent: 0,
    bbWidth20dAvg: 0,
    vol5dAvg: 0,
    vol20dAvg: 0,
    atr5d: 0,
    monthlyAboveEMA12: false,
    monthlyEMARising: false,
    weeklyAboveCloud: false,
    weeklyLaggingSpanUp: false,
    dailyVolumeDrying: false,
    isHighRisk: false,
  };
}

describe('yahooSymbolResolver KIS-first quote selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses fresh KIS quote before Yahoo, even when Yahoo would be stale', async () => {
    mocks.fetchKisQuoteFallback.mockResolvedValue(makeQuote(70000));
    const yahooFetcher = vi.fn(async () => ({ ...makeQuote(1), dataQuality: 'STALE_BASE' }));

    const quote = await fetchYahooQuoteWithMarketFallback('005930', yahooFetcher);

    expect(quote?.price).toBe(70000);
    expect(quote?.priceMetadata?.source).toBe('KIS_REALTIME');
    expect(yahooFetcher).not.toHaveBeenCalled();
  });
});
