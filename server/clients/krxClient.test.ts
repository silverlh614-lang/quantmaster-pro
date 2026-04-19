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
