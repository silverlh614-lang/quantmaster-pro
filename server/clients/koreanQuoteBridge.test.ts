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
    // PR-29 EgressGuard 가 KR 심볼·장외에서 outbound 를 차단하므로 본 테스트는 우회.
    // 본 테스트는 KRX/Yahoo 분기 로직 자체를 검증하며 시장시간과 무관하다.
    process.env.EGRESS_GUARD_DISABLED = 'true';
  });

  afterEach(() => {
    globalThis.fetch = ORIG_FETCH;
    process.env.KRX_OPENAPI_AUTH_KEY = BASE_ENV.KRX_OPENAPI_AUTH_KEY;
    process.env.KRX_OPENAPI_DISABLED = BASE_ENV.KRX_OPENAPI_DISABLED;
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
