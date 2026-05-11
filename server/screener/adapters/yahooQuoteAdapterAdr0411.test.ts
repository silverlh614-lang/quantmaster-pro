// @responsibility ADR-0411/0502 Yahoo diagnostic-only when KIS official price is fresh.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/egressGuard.js', () => ({
  guardedFetch: vi.fn(),
}));

vi.mock('./kisQuoteAdapter.js', () => ({
  fetchKisIntraday: vi.fn(),
}));

vi.mock('../../calendar/krxTradingCalendar.js', async () => {
  const actual = await vi.importActual<typeof import('../../calendar/krxTradingCalendar.js')>(
    '../../calendar/krxTradingCalendar.js',
  );
  return {
    ...actual,
    previousKrxTradingDay: vi.fn(() => '2026-05-08'),
  };
});

const { fetchYahooQuote } = await import('./yahooQuoteAdapter.js');
const { guardedFetch } = await import('../../utils/egressGuard.js');
const { fetchKisIntraday } = await import('./kisQuoteAdapter.js');

function makeYahooResponse(opts: {
  yahooPrice: number;
  closes?: number[];
  prevClose?: number;
  lastTimestampOffsetDays?: number;
}): Response {
  const count = 80;
  const yahooPrice = opts.yahooPrice;
  const prevClose = opts.prevClose ?? yahooPrice;
  const closes = opts.closes ?? Array.from({ length: count }, (_, i) => {
    if (i === count - 1) return yahooPrice;
    if (i === count - 2) return prevClose;
    return yahooPrice;
  });
  const highs = closes.map(c => c + 1);
  const lows = closes.map(c => c - 1);
  const volumes = Array.from({ length: closes.length }, () => 1000);
  const nowSec = Math.floor(Date.now() / 1000);
  const lastOffset = opts.lastTimestampOffsetDays ?? 0;
  return new Response(JSON.stringify({
    chart: {
      result: [{
        meta: {
          regularMarketPrice: yahooPrice,
          regularMarketPreviousClose: prevClose,
          regularMarketOpen: yahooPrice,
          regularMarketTime: nowSec,
        },
        timestamp: closes.map((_, i) => nowSec - ((closes.length - 1 - i) + lastOffset) * 86400),
        indicators: { quote: [{ close: closes, high: highs, low: lows, volume: volumes }] },
      }],
    },
  }), { status: 200 });
}

const ORIGINAL_DEBUG = process.env.DEBUG_PRICE_DIVERGENCE;
const ORIGINAL_RECOVERY = process.env.ADR_0411_KIS_RECOVERY_DISABLED;
const ORIGINAL_DIVERGENCE = process.env.YAHOO_KIS_PRICE_DIVERGENCE_DISABLED;

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.DEBUG_PRICE_DIVERGENCE;
  delete process.env.ADR_0411_KIS_RECOVERY_DISABLED;
  delete process.env.YAHOO_KIS_PRICE_DIVERGENCE_DISABLED;
});

afterEach(() => {
  if (ORIGINAL_DEBUG === undefined) delete process.env.DEBUG_PRICE_DIVERGENCE;
  else process.env.DEBUG_PRICE_DIVERGENCE = ORIGINAL_DEBUG;
  if (ORIGINAL_RECOVERY === undefined) delete process.env.ADR_0411_KIS_RECOVERY_DISABLED;
  else process.env.ADR_0411_KIS_RECOVERY_DISABLED = ORIGINAL_RECOVERY;
  if (ORIGINAL_DIVERGENCE === undefined) delete process.env.YAHOO_KIS_PRICE_DIVERGENCE_DISABLED;
  else process.env.YAHOO_KIS_PRICE_DIVERGENCE_DISABLED = ORIGINAL_DIVERGENCE;
});

describe('ADR-0502 KIS official price primary', () => {
  it('uses KIS price when KIS exists and Yahoo diverges by 90 percent without provider degrade', async () => {
    (guardedFetch as any).mockResolvedValue(makeYahooResponse({ yahooPrice: 10 }));
    (fetchKisIntraday as any).mockResolvedValue({ price: 100, prevClose: 95, dayOpen: 98, volume: 1234 });

    const result = await fetchYahooQuote('000001.KS');

    expect(result).not.toBeNull();
    expect(result!.price).toBe(100);
    expect(result!.priceProvider).toBe('KIS_PRICE');
    expect(result!.priceMetadata?.source).toBe('KIS_REALTIME');
    expect(result!.dataQuality).toBe('KIS_PRIMARY_YAHOO_STALE_DETECTED');
    expect(result!.yahooDiagnosticOnly).toBe(true);
    expect(result!.noProviderDegrade).toBe(true);
    expect(result!.yahooDerivedIndicatorsReliable).toBe(true);
    expect(result!.yahooKisRecovery?.divergencePct).toBeCloseTo(90, 0);
  });

  it('uses KIS price when KIS exists and Yahoo is close', async () => {
    (guardedFetch as any).mockResolvedValue(makeYahooResponse({ yahooPrice: 100 }));
    (fetchKisIntraday as any).mockResolvedValue({ price: 105, prevClose: 100, dayOpen: 101, volume: 1234 });

    const result = await fetchYahooQuote('000002.KS');

    expect(result).not.toBeNull();
    expect(result!.price).toBe(105);
    expect(result!.dataQuality).toBe('KIS_PRIMARY_YAHOO_DIAGNOSTIC_STALE');
    expect(result!.yahooDiagnosticOnly).toBe(true);
    expect(result!.noProviderDegrade).toBe(true);
    expect(result!.yahooKisRecovery).toBeUndefined();
  });

  it('does not restore legacy return-null behavior when KIS is fresh', async () => {
    process.env.ADR_0411_KIS_RECOVERY_DISABLED = 'true';
    (guardedFetch as any).mockResolvedValue(makeYahooResponse({ yahooPrice: 10 }));
    (fetchKisIntraday as any).mockResolvedValue({ price: 100, prevClose: 95, dayOpen: 98, volume: 1234 });

    const result = await fetchYahooQuote('000003.KS');

    expect(result).not.toBeNull();
    expect(result!.price).toBe(100);
    expect(result!.noProviderDegrade).toBe(true);
  });

  it('DEBUG_PRICE_DIVERGENCE logs diagnostics but does not block or degrade', async () => {
    process.env.DEBUG_PRICE_DIVERGENCE = 'true';
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    (guardedFetch as any).mockResolvedValue(makeYahooResponse({ yahooPrice: 100 }));
    (fetchKisIntraday as any).mockResolvedValue({ price: 105, prevClose: 100, dayOpen: 101, volume: 1234 });

    const result = await fetchYahooQuote('000004.KS');

    expect(result).not.toBeNull();
    expect(result!.price).toBe(105);
    expect(result!.noProviderDegrade).toBe(true);
    expect(infoSpy).toHaveBeenCalled();
  });

  it('falls back to Yahoo when KIS is missing and Yahoo is valid', async () => {
    (guardedFetch as any).mockResolvedValue(makeYahooResponse({ yahooPrice: 100 }));
    (fetchKisIntraday as any).mockResolvedValue(null);

    const result = await fetchYahooQuote('000005.KS');

    expect(result).not.toBeNull();
    expect(result!.price).toBe(100);
    expect(result!.priceProvider).toBe('YAHOO');
    expect(result!.dataQuality).toBe('YAHOO_FALLBACK_KIS_MISSING');
    expect(result!.yahooDiagnosticOnly).toBe(false);
    expect(result!.noProviderDegrade).toBe(false);
  });

  it('keeps Yahoo-only stale indicators eligible for provider degradation', async () => {
    (guardedFetch as any).mockResolvedValue(makeYahooResponse({ yahooPrice: 100, prevClose: 1000 }));
    (fetchKisIntraday as any).mockResolvedValue(null);

    const result = await fetchYahooQuote('000006.KS');

    expect(result).not.toBeNull();
    expect(result!.dataQuality).toBe('STALE_BASE');
    expect(result!.yahooDerivedIndicatorsReliable).toBe(false);
    expect(result!.noProviderDegrade).toBe(false);
  });

  it('does not call KIS for non-Korean symbols', async () => {
    (guardedFetch as any).mockResolvedValue(makeYahooResponse({ yahooPrice: 100 }));
    (fetchKisIntraday as any).mockResolvedValue({ price: 200, prevClose: 190, dayOpen: 195, volume: 1234 });

    const result = await fetchYahooQuote('AAPL');

    expect(result).not.toBeNull();
    expect(result!.price).toBe(100);
    expect(fetchKisIntraday).not.toHaveBeenCalled();
    expect(result!.dataQuality).toBe('OK');
  });
});
