/**
 * @responsibility ADR-0411 yahooQuoteAdapter Yahoo↔KIS 50% 괴리 KIS recovery + dataQuality marker 회귀
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
    previousKrxTradingDay: vi.fn(() => '2026-05-02'),
  };
});

const { fetchYahooQuote } = await import('./yahooQuoteAdapter.js');
const { guardedFetch } = await import('../../utils/egressGuard.js');
const { fetchKisIntraday } = await import('./kisQuoteAdapter.js');

function makeYahooResponse(opts: {
  yahooPrice: number;
  closes?: number[];
  /** prevClose 명시 — 미명시 시 yahooPrice 와 동일 (sanity 정상). */
  prevClose?: number;
}): Response {
  const N = 80;
  const yahooPrice = opts.yahooPrice;
  const prevClose = opts.prevClose ?? yahooPrice;
  // yahooPrice 주변으로 자연스러운 closes 배열 — prev=prevClose, last=yahooPrice, 그 외 yahooPrice 주변.
  const closes = opts.closes ?? Array.from({ length: N }, (_, i) => {
    if (i === N - 1) return yahooPrice;
    if (i === N - 2) return prevClose;
    return yahooPrice; // 안정적 base — sanity 위반 차단
  });
  const highs = closes.map(c => c + 1);
  const lows = closes.map(c => c - 1);
  const volumes = Array.from({ length: closes.length }, () => 1000);
  return new Response(JSON.stringify({
    chart: {
      result: [{
        meta: {
          regularMarketPrice: yahooPrice,
          regularMarketPreviousClose: prevClose,
          regularMarketOpen: yahooPrice,
          regularMarketTime: Math.floor(Date.now() / 1000),
        },
        timestamp: closes.map((_, i) => Math.floor(Date.now() / 1000) - (closes.length - 1 - i) * 86400),
        indicators: { quote: [{ close: closes, high: highs, low: lows, volume: volumes }] },
      }],
    },
  }), { status: 200 });
}

const ORIGINAL_DIVERGENCE_ENV = process.env.YAHOO_KIS_PRICE_DIVERGENCE_DISABLED;
const ORIGINAL_RECOVERY_ENV = process.env.ADR_0411_KIS_RECOVERY_DISABLED;

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.YAHOO_KIS_PRICE_DIVERGENCE_DISABLED;
  delete process.env.ADR_0411_KIS_RECOVERY_DISABLED;
});

afterEach(() => {
  if (ORIGINAL_DIVERGENCE_ENV === undefined) delete process.env.YAHOO_KIS_PRICE_DIVERGENCE_DISABLED;
  else process.env.YAHOO_KIS_PRICE_DIVERGENCE_DISABLED = ORIGINAL_DIVERGENCE_ENV;
  if (ORIGINAL_RECOVERY_ENV === undefined) delete process.env.ADR_0411_KIS_RECOVERY_DISABLED;
  else process.env.ADR_0411_KIS_RECOVERY_DISABLED = ORIGINAL_RECOVERY_ENV;
});

describe('ADR-0411 — Yahoo↔KIS 50% 초과 괴리 KIS recovery', () => {
  it('정상 5% 괴리 → recovery 미발동, dataQuality=OK + Yahoo 가격 유지', async () => {
    (guardedFetch as any).mockResolvedValue(makeYahooResponse({ yahooPrice: 100 }));
    // kisSnap.prevClose=0 → ADR-0221 Yahoo prevClose fallback (KRX calendar age 검증 회피).
    (fetchKisIntraday as any).mockResolvedValue({ price: 105, prevClose: 0, dayOpen: 100 });

    const result = await fetchYahooQuote('000001.KS');
    expect(result).not.toBeNull();
    expect(result!.price).toBe(100); // Yahoo 가격 유지
    expect(result!.dataQuality).toBe('OK');
    expect(result!.yahooDerivedIndicatorsReliable).toBe(true);
    expect(result!.yahooKisRecovery).toBeUndefined();
    expect(result!.priceMetadata?.source).toBe('YAHOO_INTRADAY');
  });

  it('60% 괴리 → KIS 가격 채택 recovery + dataQuality=KIS_PRIMARY_YAHOO_STALE_DETECTED', async () => {
    // Yahoo=100, KIS=200 → divergence = 100/200 = 50% — boundary 미초과 (괴리율 = abs/KIS).
    // 60% 가 되려면 Yahoo=80, KIS=200 → abs(80-200)/200 = 0.6
    (guardedFetch as any).mockResolvedValue(makeYahooResponse({ yahooPrice: 80 }));
    (fetchKisIntraday as any).mockResolvedValue({ price: 200, prevClose: 0, dayOpen: 200 });

    const result = await fetchYahooQuote('000002.KS');
    expect(result).not.toBeNull();
    expect(fetchKisIntraday).toHaveBeenCalled();
    expect(result!.price).toBe(200); // KIS 가격 채택
    expect(result!.dataQuality).toBe('KIS_PRIMARY_YAHOO_STALE_DETECTED');
    expect(result!.yahooDerivedIndicatorsReliable).toBe(false);
    expect(result!.yahooKisRecovery).toBeDefined();
    expect(result!.yahooKisRecovery?.originalYahooPrice).toBe(80);
    expect(result!.yahooKisRecovery?.recoveredKisPrice).toBe(200);
    expect(result!.yahooKisRecovery?.divergencePct).toBeCloseTo(60, 0);
    expect(result!.priceMetadata?.source).toBe('KIS_REALTIME');
  });

  it('50% 정확 boundary — divergence > 0.5 (strict) 이라 50% 정확은 recovery 미발동', async () => {
    // abs(100 - 200) / 200 = 0.5 — strict greater than 미충족
    (guardedFetch as any).mockResolvedValue(makeYahooResponse({ yahooPrice: 100 }));
    (fetchKisIntraday as any).mockResolvedValue({ price: 200, prevClose: 0, dayOpen: 200 });

    const result = await fetchYahooQuote('000003.KS');
    expect(result).not.toBeNull();
    expect(result!.price).toBe(100); // Yahoo 가격 유지
    expect(result!.dataQuality).toBe('OK');
    expect(result!.yahooDerivedIndicatorsReliable).toBe(true);
    expect(result!.yahooKisRecovery).toBeUndefined();
  });

  it('50.1% 괴리 → recovery 발동', async () => {
    // abs(99.8 - 200) / 200 = 0.501
    (guardedFetch as any).mockResolvedValue(makeYahooResponse({ yahooPrice: 99.8 }));
    (fetchKisIntraday as any).mockResolvedValue({ price: 200, prevClose: 0, dayOpen: 200 });

    const result = await fetchYahooQuote('000004.KS');
    expect(result).not.toBeNull();
    expect(result!.price).toBe(200);
    expect(result!.dataQuality).toBe('KIS_PRIMARY_YAHOO_STALE_DETECTED');
    expect(result!.yahooDerivedIndicatorsReliable).toBe(false);
  });

  it('ENV ADR_0411_KIS_RECOVERY_DISABLED=true 시 ADR-0263 원안 — return null (legacy)', async () => {
    process.env.ADR_0411_KIS_RECOVERY_DISABLED = 'true';
    (guardedFetch as any).mockResolvedValue(makeYahooResponse({ yahooPrice: 80 }));
    (fetchKisIntraday as any).mockResolvedValue({ price: 200, prevClose: 0, dayOpen: 200 });

    const result = await fetchYahooQuote('000005.KS');
    expect(result).toBeNull(); // legacy 동작 — universe 손실
  });

  it('ENV YAHOO_KIS_PRICE_DIVERGENCE_DISABLED=true 시 divergence 검증 자체 스킵', async () => {
    process.env.YAHOO_KIS_PRICE_DIVERGENCE_DISABLED = 'true';
    (guardedFetch as any).mockResolvedValue(makeYahooResponse({ yahooPrice: 80 }));
    (fetchKisIntraday as any).mockResolvedValue({ price: 200, prevClose: 0, dayOpen: 200 });

    const result = await fetchYahooQuote('000006.KS');
    expect(result).not.toBeNull();
    expect(result!.price).toBe(80); // Yahoo 가격 그대로 (divergence 검증 스킵)
    expect(result!.dataQuality).toBe('OK');
    expect(result!.yahooDerivedIndicatorsReliable).toBe(true);
  });

  it('KIS 호출 실패 (null 반환) 시 divergence 검증 자체 스킵 — Yahoo 가격 유지', async () => {
    (guardedFetch as any).mockResolvedValue(makeYahooResponse({ yahooPrice: 100 }));
    (fetchKisIntraday as any).mockResolvedValue(null);

    const result = await fetchYahooQuote('000007.KS');
    expect(result).not.toBeNull();
    expect(result!.price).toBe(100);
    expect(result!.dataQuality).toBe('OK');
    expect(result!.yahooDerivedIndicatorsReliable).toBe(true);
  });

  it('비KR 종목 (.KS/.KQ 미매칭) 시 divergence 검증 자체 미진입', async () => {
    (guardedFetch as any).mockResolvedValue(makeYahooResponse({ yahooPrice: 100 }));
    (fetchKisIntraday as any).mockResolvedValue({ price: 200, prevClose: 0, dayOpen: 200 });

    const result = await fetchYahooQuote('AAPL');
    expect(result).not.toBeNull();
    expect(result!.price).toBe(100);
    expect(fetchKisIntraday).not.toHaveBeenCalled(); // 비KR 종목은 KIS 호출 자체 안 함
  });
});

describe('ADR-0411 — yahooDerivedIndicatorsReliable marker 산출', () => {
  it('KIS recovery 발동 시 false', async () => {
    (guardedFetch as any).mockResolvedValue(makeYahooResponse({ yahooPrice: 80 }));
    (fetchKisIntraday as any).mockResolvedValue({ price: 200, prevClose: 0, dayOpen: 200 });

    const result = await fetchYahooQuote('000008.KS');
    expect(result?.yahooDerivedIndicatorsReliable).toBe(false);
  });

  it('정상 응답 시 true', async () => {
    (guardedFetch as any).mockResolvedValue(makeYahooResponse({ yahooPrice: 100 }));
    (fetchKisIntraday as any).mockResolvedValue({ price: 100, prevClose: 0, dayOpen: 100 });

    const result = await fetchYahooQuote('000009.KS');
    expect(result?.yahooDerivedIndicatorsReliable).toBe(true);
  });
});
