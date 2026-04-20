/**
 * krxClient.test.ts — 아이디어 2 검증
 *
 * 검증 목표:
 *   1. KRX_API_DISABLED=true 면 네트워크 호출 없이 빈 배열.
 *   2. fetch가 네트워크 오류·비정상 상태코드·이상한 본문일 때 throw 하지 않고 [] 반환.
 *   3. 정상 JSON 응답은 KrxInvestorRow / KrxPerPbrRow / KrxShortBalanceRow 로 정확히 매핑.
 *   4. 종목코드에 'A' 접두어가 있어도 숫자 6자리로 정규화.
 *   5. 동일 날짜 재호출은 메모리 캐시(TTL 10분)로 fetch 재호출 없음.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('krxClient — 네트워크 내성 및 캐시', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    // 각 테스트 시작 전 환경변수·캐시 초기화.
    delete process.env.KRX_API_DISABLED;
    const mod = await import('./krxClient.js');
    mod.resetKrxCache();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('KRX_API_DISABLED=true 일 때 fetch를 호출하지 않고 빈 배열을 반환한다', async () => {
    process.env.KRX_API_DISABLED = 'true';
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    // 모듈을 다시 import해 KRX_DISABLED가 평가되도록 한다.
    vi.resetModules();
    const { fetchInvestorTrading } = await import('./krxClient.js');

    const rows = await fetchInvestorTrading('20250419');
    expect(rows).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('HTTP 500 응답이면 빈 배열을 반환하고 throw하지 않는다', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => '',
    }) as unknown as typeof fetch;

    vi.resetModules();
    const { fetchPerPbr } = await import('./krxClient.js');
    await expect(fetchPerPbr('20250419')).resolves.toEqual([]);
  });

  it('이상한(JSON 아님) 본문은 빈 배열로 흡수한다', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '<html>error page</html>',
    }) as unknown as typeof fetch;

    vi.resetModules();
    const { fetchShortBalance } = await import('./krxClient.js');
    await expect(fetchShortBalance('20250419')).resolves.toEqual([]);
  });

  it('정상 투자자 응답을 KrxInvestorRow 로 매핑하고 A 접두어를 제거한다', async () => {
    const body = {
      OutBlock_1: [
        {
          ISU_SRT_CD: 'A005930',
          ISU_ABBRV: '삼성전자',
          FORN_INVSTR_NETBY_QTY: '1,234,567',
          ORGN_INVSTR_NETBY_QTY: '-5,000',
          INDIV_INVSTR_NETBY_QTY: '10,000',
        },
        {
          ISU_SRT_CD: '000660',
          ISU_ABBRV: 'SK하이닉스',
          FORN_NETBY_QTY: '777',
          ORGN_NETBY_QTY: '888',
          PRVT_NETBY_QTY: '-1,100',
        },
      ],
    };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(body),
    }) as unknown as typeof fetch;

    vi.resetModules();
    const { fetchInvestorTrading } = await import('./krxClient.js');
    const rows = await fetchInvestorTrading('20250419');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      code: '005930',
      name: '삼성전자',
      foreignNetBuy: 1234567,
      institutionNetBuy: -5000,
      individualNetBuy: 10000,
    });
    expect(rows[1]).toMatchObject({
      code: '000660',
      name: 'SK하이닉스',
      foreignNetBuy: 777,
      institutionNetBuy: 888,
      individualNetBuy: -1100,
    });
  });

  it('동일 날짜 재호출은 캐시 히트로 fetch 를 한 번만 사용한다', async () => {
    const body = { OutBlock_1: [] };
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(body),
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    vi.resetModules();
    const { fetchPerPbr } = await import('./krxClient.js');
    await fetchPerPbr('20250419');
    await fetchPerPbr('20250419');
    await fetchPerPbr('20250419');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('잘못된 형식의 date 인자는 오늘 날짜로 대체된다(throw 없음)', async () => {
    const body = { OutBlock_1: [] };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(body),
    }) as unknown as typeof fetch;

    vi.resetModules();
    const { fetchInvestorTrading } = await import('./krxClient.js');
    await expect(fetchInvestorTrading('bad-date')).resolves.toEqual([]);
  });
});

// ── 블루프린트 파사드 검증 (경로 A: KRX Open API 인증) ──────────────────────
describe('krxClient — 블루프린트 파사드', () => {
  const ORIG_FETCH = globalThis.fetch;
  const ORIG_ENV = {
    KRX_API_KEY: process.env.KRX_API_KEY,
    KRX_OPENAPI_AUTH_KEY: process.env.KRX_OPENAPI_AUTH_KEY,
    KRX_API_DISABLED: process.env.KRX_API_DISABLED,
    KRX_OPENAPI_DISABLED: process.env.KRX_OPENAPI_DISABLED,
  };

  beforeEach(() => {
    process.env.KRX_API_KEY = 'blueprint-key';
    delete process.env.KRX_OPENAPI_AUTH_KEY;
    delete process.env.KRX_API_DISABLED;
    delete process.env.KRX_OPENAPI_DISABLED;
  });

  afterEach(() => {
    globalThis.fetch = ORIG_FETCH;
    process.env.KRX_API_KEY = ORIG_ENV.KRX_API_KEY;
    process.env.KRX_OPENAPI_AUTH_KEY = ORIG_ENV.KRX_OPENAPI_AUTH_KEY;
    process.env.KRX_API_DISABLED = ORIG_ENV.KRX_API_DISABLED;
    process.env.KRX_OPENAPI_DISABLED = ORIG_ENV.KRX_OPENAPI_DISABLED;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('getKrxAuthKey()는 KRX_API_KEY 를 우선으로, 없으면 레거시 KRX_OPENAPI_AUTH_KEY 를 반환한다', async () => {
    vi.resetModules();
    const mod = await import('./krxClient.js');
    expect(mod.getKrxAuthKey()).toBe('blueprint-key');

    delete process.env.KRX_API_KEY;
    process.env.KRX_OPENAPI_AUTH_KEY = 'legacy-key';
    vi.resetModules();
    const mod2 = await import('./krxClient.js');
    expect(mod2.getKrxAuthKey()).toBe('legacy-key');
  });

  it('fetchKrxDailyOhlcv(code)는 KOSPI 일별매매에서 일치 종목을 반환한다', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        OutBlock_1: [
          { BAS_DD: '20260417', ISU_SRT_CD: 'A005930', ISU_NM: '삼성전자',
            MKT_NM: 'KOSPI', TDD_CLSPRC: '72,400', MKTCAP: '432000000000000',
            LIST_SHRS: '5969782550' },
        ],
      }),
    }) as unknown as typeof fetch;

    vi.resetModules();
    const openApi = await import('./krxOpenApi.js');
    openApi._resetKrxOpenApiBreaker();
    openApi.resetKrxOpenApiCache();
    const { fetchKrxDailyOhlcv } = await import('./krxClient.js');
    const row = await fetchKrxDailyOhlcv('005930', '20260417');
    expect(row).not.toBeNull();
    expect(row?.code).toBe('005930');
    expect(row?.close).toBe(72400);
  });

  it('fetchKrxDailyOhlcv(code)는 6자리가 아니면 null', async () => {
    vi.resetModules();
    const { fetchKrxDailyOhlcv } = await import('./krxClient.js');
    await expect(fetchKrxDailyOhlcv('12345')).resolves.toBeNull();
    await expect(fetchKrxDailyOhlcv('abcdef')).resolves.toBeNull();
  });

  it('fetchKrxSectorIndices()는 KRX 시리즈를 우선 사용한다', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        OutBlock_1: [
          { BAS_DD: '20260417', IDX_IND_CD: '2001', IDX_NM: 'KRX 에너지',
            CLSPRC_IDX: '1,234.56' },
        ],
      }),
    }) as unknown as typeof fetch;

    vi.resetModules();
    const openApi = await import('./krxOpenApi.js');
    openApi._resetKrxOpenApiBreaker();
    openApi.resetKrxOpenApiCache();
    const { fetchKrxSectorIndices } = await import('./krxClient.js');
    const rows = await fetchKrxSectorIndices('20260417');
    expect(rows).toHaveLength(1);
    expect(rows[0].indexName).toBe('KRX 에너지');
  });

  it('fetchKrxMarketCap()은 marketCap 이 0 인 행을 제거하고 원 단위 정수로 반환한다', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        OutBlock_1: [
          { BAS_DD: '20260417', ISU_SRT_CD: '005930', ISU_NM: '삼성전자',
            MKT_NM: 'KOSPI', MKTCAP: '432,000,000,000,000', LIST_SHRS: '5,969,782,550',
            TDD_CLSPRC: '72,400' },
          { BAS_DD: '20260417', ISU_SRT_CD: '999999', ISU_NM: 'ZERO',
            MKT_NM: 'KOSPI', MKTCAP: '0', LIST_SHRS: '0', TDD_CLSPRC: '0' },
        ],
      }),
    }) as unknown as typeof fetch;

    vi.resetModules();
    const openApi = await import('./krxOpenApi.js');
    openApi._resetKrxOpenApiBreaker();
    openApi.resetKrxOpenApiCache();
    const { fetchKrxMarketCap } = await import('./krxClient.js');
    const rows = await fetchKrxMarketCap('20260417');
    // KOSPI 한 건 + KOSDAQ(동일 mock 본문) 한 건 = 0 건 제거 후 2 건.
    // (동일 fetch mock 이 두 호출에 동일 본문을 반환하므로 삼성전자가 두 번 포함됨)
    expect(rows.every(r => r.marketCap > 0)).toBe(true);
    expect(rows[0]).toMatchObject({
      code: '005930',
      marketCap: 432000000000000,
      listedShares: 5969782550,
      market: 'KOSPI',
    });
  });

  it('fetchKrxInvestorTrading / fetchKrxPerPbr / fetchKrxShortBalance 는 레거시 함수와 동일 참조', async () => {
    vi.resetModules();
    const mod = await import('./krxClient.js');
    expect(mod.fetchKrxInvestorTrading).toBe(mod.fetchInvestorTrading);
    expect(mod.fetchKrxPerPbr).toBe(mod.fetchPerPbr);
    expect(mod.fetchKrxShortBalance).toBe(mod.fetchShortBalance);
  });
});
