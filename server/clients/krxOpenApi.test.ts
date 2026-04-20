/**
 * krxOpenApi.test.ts — 인증 KRX OpenAPI 어댑터 내성 검증.
 *
 * 검증 포인트:
 *   1. AUTH_KEY 미설정이면 fetch 호출 없이 즉시 [] 반환.
 *   2. KRX_OPENAPI_DISABLED=true 면 fetch 건너뛰고 [] 반환.
 *   3. 정상 JSON(OutBlock_1) → KrxStockDailyRow 로 정확 매핑, A 접두어 제거.
 *   4. HTTP 500 → throw 없이 [] 반환.
 *   5. 동일 basDd 재호출은 캐시 히트 (빈 결과는 캐시 안 함 → 성공 후 재호출 시 1회).
 *   6. 지수 엔드포인트(kospi_dd_trd)도 동일 패턴으로 매핑.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIG_FETCH = globalThis.fetch;
const BASE_ENV = {
  KRX_OPENAPI_AUTH_KEY: process.env.KRX_OPENAPI_AUTH_KEY,
  KRX_OPENAPI_DISABLED: process.env.KRX_OPENAPI_DISABLED,
};

describe('krxOpenApi — 인증·캐시·매핑', () => {
  beforeEach(() => {
    process.env.KRX_OPENAPI_AUTH_KEY = 'test-key';
    delete process.env.KRX_OPENAPI_DISABLED;
  });

  afterEach(() => {
    globalThis.fetch = ORIG_FETCH;
    process.env.KRX_OPENAPI_AUTH_KEY = BASE_ENV.KRX_OPENAPI_AUTH_KEY;
    process.env.KRX_OPENAPI_DISABLED = BASE_ENV.KRX_OPENAPI_DISABLED;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('AUTH_KEY 미설정이면 fetch를 호출하지 않고 빈 배열을 반환한다', async () => {
    delete process.env.KRX_OPENAPI_AUTH_KEY;
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    vi.resetModules();
    const mod = await import('./krxOpenApi.js');
    mod._resetKrxOpenApiBreaker();
    mod.resetKrxOpenApiCache();

    const rows = await mod.fetchKospiDailyTrade('20260417');
    expect(rows).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mod.isKrxOpenApiHealthy()).toBe(false);
  });

  it('KRX_OPENAPI_DISABLED=true 이면 네트워크 없이 빈 배열', async () => {
    process.env.KRX_OPENAPI_DISABLED = 'true';
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    vi.resetModules();
    const mod = await import('./krxOpenApi.js');
    mod._resetKrxOpenApiBreaker();
    mod.resetKrxOpenApiCache();

    const rows = await mod.fetchKosdaqDailyTrade('20260417');
    expect(rows).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('정상 OutBlock_1 응답을 KrxStockDailyRow 로 매핑하고 A 접두어를 제거한다', async () => {
    const body = {
      OutBlock_1: [
        {
          BAS_DD: '20260417',
          ISU_CD: 'KR7005930003',
          ISU_SRT_CD: 'A005930',
          ISU_NM: '삼성전자',
          MKT_NM: 'KOSPI',
          SECT_TP_NM: '전기전자',
          TDD_CLSPRC: '72,400',
          CMPPREVDD_PRC: '-300',
          FLUC_RT: '-0.41',
          TDD_OPNPRC: '72,700',
          TDD_HGPRC: '72,900',
          TDD_LWPRC: '71,900',
          ACC_TRDVOL: '12,345,678',
          ACC_TRDVAL: '900,000,000,000',
          MKTCAP: '432,000,000,000,000',
          LIST_SHRS: '5,969,782,550',
        },
      ],
    };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(body),
    }) as unknown as typeof fetch;

    vi.resetModules();
    const mod = await import('./krxOpenApi.js');
    mod._resetKrxOpenApiBreaker();
    mod.resetKrxOpenApiCache();

    const rows = await mod.fetchKospiDailyTrade('20260417');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      baseDate: '20260417',
      code: '005930',
      name: '삼성전자',
      close: 72400,
      change: -300,
      changePct: -0.41,
      open: 72700,
      high: 72900,
      low: 71900,
      volume: 12345678,
      listedShares: 5969782550,
      market: 'KOSPI',
    });
  });

  it('HTTP 500 이면 throw 없이 [] 반환하고 인증키는 헤더로 전달된다', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => '',
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    vi.resetModules();
    const mod = await import('./krxOpenApi.js');
    mod._resetKrxOpenApiBreaker();
    mod.resetKrxOpenApiCache();

    await expect(mod.fetchKospiDailyTrade('20260417')).resolves.toEqual([]);
    // 첫 번째 호출 인자에서 AUTH_KEY 헤더 확인
    const call = fetchSpy.mock.calls[0];
    expect(call).toBeTruthy();
    const init = call![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.AUTH_KEY).toBe('test-key');
  });

  it('정상 응답 후 동일 basDd 재호출은 캐시 히트로 fetch 1회만', async () => {
    const body = {
      OutBlock_1: [
        {
          BAS_DD: '20260417',
          ISU_SRT_CD: '000660',
          ISU_CD: 'KR7000660001',
          ISU_NM: 'SK하이닉스',
          TDD_CLSPRC: '170,000',
          TDD_OPNPRC: '169,000',
          TDD_HGPRC: '171,000',
          TDD_LWPRC: '168,000',
          ACC_TRDVOL: '5,000,000',
        },
      ],
    };
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(body),
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    vi.resetModules();
    const mod = await import('./krxOpenApi.js');
    mod._resetKrxOpenApiBreaker();
    mod.resetKrxOpenApiCache();

    await mod.fetchKospiDailyTrade('20260417');
    await mod.fetchKospiDailyTrade('20260417');
    await mod.fetchKospiDailyTrade('20260417');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('지수 일별시세(kospi_dd_trd) 응답을 KrxIndexDailyRow 로 매핑한다', async () => {
    const body = {
      OutBlock_1: [
        {
          BAS_DD: '20260417',
          IDX_IND_CD: '1001',
          IDX_NM: '코스피',
          CLSPRC_IDX: '2,750.15',
          CMPPREVDD_IDX: '-5.30',
          FLUC_RT: '-0.19',
          OPNPRC_IDX: '2,755.00',
          HGPRC_IDX: '2,760.40',
          LWPRC_IDX: '2,740.10',
          ACC_TRDVOL: '500,000,000',
          ACC_TRDVAL: '9,000,000,000,000',
          MKTCAP: '2,300,000,000,000,000',
        },
      ],
    };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(body),
    }) as unknown as typeof fetch;

    vi.resetModules();
    const mod = await import('./krxOpenApi.js');
    mod._resetKrxOpenApiBreaker();
    mod.resetKrxOpenApiCache();

    const rows = await mod.fetchKospiIndexDaily('20260417');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      baseDate: '20260417',
      indexCode: '1001',
      indexName: '코스피',
      close: 2750.15,
      change: -5.3,
      changePct: -0.19,
      open: 2755,
      high: 2760.4,
      low: 2740.1,
    });
  });

  it('이상한(JSON 아님) 본문은 빈 배열로 흡수한다', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '<html>maintenance</html>',
    }) as unknown as typeof fetch;

    vi.resetModules();
    const mod = await import('./krxOpenApi.js');
    mod._resetKrxOpenApiBreaker();
    mod.resetKrxOpenApiCache();

    await expect(mod.fetchKospiDailyTrade('20260417')).resolves.toEqual([]);
  });

  it('5회 연속 실패 시 서킷 OPEN → isKrxOpenApiHealthy=false', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => '',
    }) as unknown as typeof fetch;

    vi.resetModules();
    const mod = await import('./krxOpenApi.js');
    mod._resetKrxOpenApiBreaker();
    mod.resetKrxOpenApiCache();

    // 매번 다른 basDd 로 캐시 회피하며 5회 실패 유도.
    for (const d of ['20260401', '20260402', '20260403', '20260404', '20260405']) {
      await mod.fetchKospiDailyTrade(d);
    }
    const status = mod.getKrxOpenApiStatus();
    expect(status.circuitState).toBe('OPEN');
    expect(mod.isKrxOpenApiHealthy()).toBe(false);
  });
});
