/**
 * koreanQuoteBridge.test.ts — KRX 우선 · Yahoo 폴백 브릿지 검증.
 *
 *   1. KRX OpenAPI 가 healthy 하고 KOSPI 목록에 코드가 있으면 source='krx-openapi'.
 *   2. KRX 가 disabled 면 바로 Yahoo 호출 → source='yahoo'.
 *   3. KRX·Yahoo 모두 실패면 source='none'.
 *   4. 지수: alias KOSPI → KRX 우선, 폴백 시 ^KS11 Yahoo.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIG_FETCH = globalThis.fetch;
const BASE_ENV = {
  KRX_OPENAPI_AUTH_KEY: process.env.KRX_OPENAPI_AUTH_KEY,
  KRX_OPENAPI_DISABLED: process.env.KRX_OPENAPI_DISABLED,
  KIS_OHLCV_PRIMARY_ENABLED: process.env.KIS_OHLCV_PRIMARY_ENABLED,
};

function krxKospiResponse(code: string, close: number) {
  return {
    OutBlock_1: [
      {
        BAS_DD: '20260417',
        ISU_SRT_CD: code,
        ISU_CD: `KR7${code}001`,
        ISU_NM: `종목${code}`,
        MKT_NM: 'KOSPI',
        TDD_CLSPRC: String(close),
        CMPPREVDD_PRC: '100',
        FLUC_RT: '1.0',
        TDD_OPNPRC: String(close - 100),
        TDD_HGPRC: String(close + 200),
        TDD_LWPRC: String(close - 200),
        ACC_TRDVOL: '1,000,000',
      },
    ],
  };
}

function yahooChartResponse(symbol: string, close: number) {
  return {
    chart: {
      result: [
        {
          meta: {
            symbol,
            shortName: `Yahoo ${symbol}`,
            regularMarketPrice: close,
            regularMarketPreviousClose: close - 500,
            regularMarketDayHigh: close + 100,
            regularMarketDayLow: close - 300,
            regularMarketVolume: 999999,
          },
          indicators: {
            quote: [
              {
                open: [close - 400],
                high: [close + 100],
                low: [close - 300],
                close: [close],
                volume: [999999],
              },
            ],
          },
        },
      ],
    },
  };
}

function buildFetchMock(
  responder: (url: string) => Promise<{ ok: boolean; status: number; text?: string; json?: unknown } | undefined>,
) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : String(input);
    const r = await responder(urlStr);
    if (!r) {
      return { ok: false, status: 500, text: async () => 'no match' } as unknown as Response;
    }
    return {
      ok: r.ok,
      status: r.status,
      text: async () => r.text ?? JSON.stringify(r.json ?? {}),
      json: async () => r.json ?? JSON.parse(r.text ?? '{}'),
    } as unknown as Response;
  });
}

describe('koreanQuoteBridge — KRX 우선·Yahoo 폴백', () => {
  const ORIG_EGRESS_DISABLED = process.env.EGRESS_GUARD_DISABLED;

  beforeEach(() => {
    process.env.KRX_OPENAPI_AUTH_KEY = 'test-key';
    delete process.env.KRX_OPENAPI_DISABLED;
    // ADR-0561 정합 정정: kisPrimaryFlag SSOT 는 미설정=ON(KIS 2차 시도). 기존 KRX→Yahoo 경로
    // 테스트는 ='false' 명시 롤백으로 고정(미설정=ON 경로는 전용 테스트에서 검증).
    process.env.KIS_OHLCV_PRIMARY_ENABLED = 'false';
    // PR-29 EgressGuard 가 KR 심볼·장외에서 outbound 를 차단하므로 본 테스트는 우회.
    // 본 테스트는 KRX/Yahoo 분기 로직 자체를 검증하며 시장시간과 무관하다.
    process.env.EGRESS_GUARD_DISABLED = 'true';
  });

  afterEach(() => {
    globalThis.fetch = ORIG_FETCH;
    process.env.KRX_OPENAPI_AUTH_KEY = BASE_ENV.KRX_OPENAPI_AUTH_KEY;
    process.env.KRX_OPENAPI_DISABLED = BASE_ENV.KRX_OPENAPI_DISABLED;
    if (BASE_ENV.KIS_OHLCV_PRIMARY_ENABLED === undefined) delete process.env.KIS_OHLCV_PRIMARY_ENABLED;
    else process.env.KIS_OHLCV_PRIMARY_ENABLED = BASE_ENV.KIS_OHLCV_PRIMARY_ENABLED;
    vi.doUnmock('../screener/kisChartDataFetcher.js');
    if (ORIG_EGRESS_DISABLED === undefined) delete process.env.EGRESS_GUARD_DISABLED;
    else process.env.EGRESS_GUARD_DISABLED = ORIG_EGRESS_DISABLED;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('KRX 가 healthy 하고 KOSPI 목록에 있으면 source=krx-openapi', async () => {
    globalThis.fetch = buildFetchMock(async (url) => {
      if (url.includes('/sto/stk_bydd_trd')) {
        return { ok: true, status: 200, json: krxKospiResponse('005930', 72400) };
      }
      if (url.includes('/sto/ksq_bydd_trd')) {
        return { ok: true, status: 200, json: { OutBlock_1: [] } };
      }
      return { ok: false, status: 404 };
    }) as unknown as typeof fetch;

    vi.resetModules();
    const krx = await import('./krxOpenApi.js');
    krx._resetKrxOpenApiBreaker();
    krx.resetKrxOpenApiCache();
    const { fetchKoreanDailyQuote } = await import('./koreanQuoteBridge.js');

    const quote = await fetchKoreanDailyQuote('005930');
    expect(quote.source).toBe('krx-openapi');
    expect(quote.code).toBe('005930');
    expect(quote.close).toBe(72400);
    expect(quote.baseDate).toBe('20260417');
  });

  it('KRX_OPENAPI_DISABLED=true 면 곧바로 Yahoo 호출 → source=yahoo', async () => {
    process.env.KRX_OPENAPI_DISABLED = 'true';
    const fetchSpy = buildFetchMock(async (url) => {
      if (url.includes('query') && url.includes('005930.KS')) {
        return { ok: true, status: 200, json: yahooChartResponse('005930.KS', 72000) };
      }
      if (url.includes('query') && url.includes('005930.KQ')) {
        return { ok: false, status: 404 };
      }
      return { ok: false, status: 404 };
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    vi.resetModules();
    const krx = await import('./krxOpenApi.js');
    krx._resetKrxOpenApiBreaker();
    krx.resetKrxOpenApiCache();
    const { fetchKoreanDailyQuote } = await import('./koreanQuoteBridge.js');

    const quote = await fetchKoreanDailyQuote('005930');
    expect(quote.source).toBe('yahoo');
    expect(quote.close).toBe(72000);
    // KRX 로는 전혀 나가지 않아야 함.
    const krxCalls = fetchSpy.mock.calls.filter((c) => String(c[0]).includes('data-dbg.krx.co.kr'));
    expect(krxCalls).toHaveLength(0);
  });

  it('KRX·Yahoo 모두 실패면 source=none', async () => {
    process.env.KRX_OPENAPI_DISABLED = 'true'; // Yahoo 만 남김
    globalThis.fetch = buildFetchMock(async () => ({ ok: false, status: 500 })) as unknown as typeof fetch;

    vi.resetModules();
    const krx = await import('./krxOpenApi.js');
    krx._resetKrxOpenApiBreaker();
    krx.resetKrxOpenApiCache();
    const { fetchKoreanDailyQuote } = await import('./koreanQuoteBridge.js');

    const quote = await fetchKoreanDailyQuote('005930');
    expect(quote.source).toBe('none');
    expect(quote.close).toBe(0);
  });

  it("[ADR-0564] flag OFF(='false' 명시 롤백): KRX 실패 시 KIS 건너뛰고 Yahoo (byte-equal)", async () => {
    process.env.KIS_OHLCV_PRIMARY_ENABLED = 'false';
    process.env.KRX_OPENAPI_DISABLED = 'true';
    // flag OFF 면 fetchFromKis 블록이 skip 되어야 함 — KIS 가 호출되면 테스트 실패.
    vi.resetModules();
    vi.doMock('../screener/kisChartDataFetcher.js', () => ({
      fetchKisDailyCandles: vi.fn(async () => {
        throw new Error('flag OFF 인데 KIS 가 호출됨 — byte-equal 위반');
      }),
    }));
    globalThis.fetch = buildFetchMock(async (url) => {
      if (url.includes('query') && url.includes('005930.KS')) {
        return { ok: true, status: 200, json: yahooChartResponse('005930.KS', 71000) };
      }
      return { ok: false, status: 404 };
    }) as unknown as typeof fetch;

    const krx = await import('./krxOpenApi.js');
    krx._resetKrxOpenApiBreaker();
    krx.resetKrxOpenApiCache();
    const { fetchKoreanDailyQuote } = await import('./koreanQuoteBridge.js');

    const quote = await fetchKoreanDailyQuote('005930');
    expect(quote.source).toBe('yahoo'); // KIS skip → 기존 Yahoo 경로(byte-equal)
    expect(quote.close).toBe(71000);
  });

  it('[ADR-0564] flag ON: KRX 실패 시 KIS 일봉 2차 → source=kis (Yahoo 앞 강등)', async () => {
    process.env.KIS_OHLCV_PRIMARY_ENABLED = 'true';
    process.env.KRX_OPENAPI_DISABLED = 'true';
    vi.resetModules();
    const kisMock = vi.fn(async () => [
      { date: '20260416', open: 70000, high: 71000, low: 69500, close: 70500, volume: 111 },
      { date: '20260417', open: 70500, high: 72000, low: 70000, close: 71800, volume: 222 },
    ]);
    vi.doMock('../screener/kisChartDataFetcher.js', () => ({ fetchKisDailyCandles: kisMock }));
    // Yahoo 가 호출되면(잘못) 다른 close 값 — KIS 가 먼저 성공해야 하므로 미사용 기대.
    globalThis.fetch = buildFetchMock(async (url) => {
      if (url.includes('query')) {
        return { ok: true, status: 200, json: yahooChartResponse('005930.KS', 99999) };
      }
      return { ok: false, status: 404 };
    }) as unknown as typeof fetch;

    const krx = await import('./krxOpenApi.js');
    krx._resetKrxOpenApiBreaker();
    krx.resetKrxOpenApiCache();
    const { fetchKoreanDailyQuote } = await import('./koreanQuoteBridge.js');

    const quote = await fetchKoreanDailyQuote('005930');
    expect(quote.source).toBe('kis');
    expect(quote.close).toBe(71800); // 최신(과거→최신 정렬 마지막) 캔들
    expect(quote.open).toBe(70500);
    expect(quote.high).toBe(72000);
    expect(quote.baseDate).toBe('20260417');
    expect(kisMock).toHaveBeenCalled();
  });

  it('[ADR-0561 정합 정정] flag 미설정(undefined) === ON: KRX 실패 시 KIS 2차 → source=kis', async () => {
    delete process.env.KIS_OHLCV_PRIMARY_ENABLED; // kisPrimaryFlag SSOT — 미설정=ON(KIS-first)
    process.env.KRX_OPENAPI_DISABLED = 'true';
    vi.resetModules();
    const kisMock = vi.fn(async () => [
      { date: '20260417', open: 70500, high: 72000, low: 70000, close: 71800, volume: 222 },
    ]);
    vi.doMock('../screener/kisChartDataFetcher.js', () => ({ fetchKisDailyCandles: kisMock }));
    globalThis.fetch = buildFetchMock(async (url) => {
      if (url.includes('query')) {
        return { ok: true, status: 200, json: yahooChartResponse('005930.KS', 99999) };
      }
      return { ok: false, status: 404 };
    }) as unknown as typeof fetch;

    const krx = await import('./krxOpenApi.js');
    krx._resetKrxOpenApiBreaker();
    krx.resetKrxOpenApiCache();
    const { fetchKoreanDailyQuote } = await import('./koreanQuoteBridge.js');

    const quote = await fetchKoreanDailyQuote('005930');
    expect(quote.source).toBe('kis'); // 미설정 = ON — Yahoo(99999) 미사용
    expect(quote.close).toBe(71800);
    expect(kisMock).toHaveBeenCalled();
  });

  it('지수: KOSPI alias → KRX 인증 엔드포인트 우선', async () => {
    globalThis.fetch = buildFetchMock(async (url) => {
      if (url.includes('/idx/kospi_dd_trd')) {
        return {
          ok: true,
          status: 200,
          json: {
            OutBlock_1: [
              {
                BAS_DD: '20260417',
                IDX_IND_CD: '1001',
                IDX_NM: '코스피',
                CLSPRC_IDX: '2,750.15',
                CMPPREVDD_IDX: '-5.30',
                FLUC_RT: '-0.19',
                OPNPRC_IDX: '2,755',
                HGPRC_IDX: '2,760',
                LWPRC_IDX: '2,740',
              },
            ],
          },
        };
      }
      return { ok: false, status: 404 };
    }) as unknown as typeof fetch;

    vi.resetModules();
    const krx = await import('./krxOpenApi.js');
    krx._resetKrxOpenApiBreaker();
    krx.resetKrxOpenApiCache();
    const { fetchKoreanIndexDailyQuote } = await import('./koreanQuoteBridge.js');

    const quote = await fetchKoreanIndexDailyQuote('KOSPI');
    expect(quote.source).toBe('krx-openapi');
    expect(quote.name).toBe('코스피');
    expect(quote.close).toBe(2750.15);
  });

  it('지수: KRX 비활성 시 Yahoo ^KS11 로 폴백', async () => {
    process.env.KRX_OPENAPI_DISABLED = 'true';
    globalThis.fetch = buildFetchMock(async (url) => {
      if (url.includes('%5EKS11')) {
        return { ok: true, status: 200, json: yahooChartResponse('^KS11', 2750) };
      }
      return { ok: false, status: 404 };
    }) as unknown as typeof fetch;

    vi.resetModules();
    const krx = await import('./krxOpenApi.js');
    krx._resetKrxOpenApiBreaker();
    krx.resetKrxOpenApiCache();
    const { fetchKoreanIndexDailyQuote } = await import('./koreanQuoteBridge.js');

    const quote = await fetchKoreanIndexDailyQuote('KOSPI');
    expect(quote.source).toBe('yahoo');
    expect(quote.close).toBe(2750);
    expect(quote.code).toBe('KOSPI');
  });
});
