/**
 * @responsibility krxClient.fetchInvestorTradingDetail 회귀 테스트 — ADR-0141 Stage 1.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('fetchInvestorTradingDetail (ADR-0141 Stage 1)', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    delete process.env.KRX_API_DISABLED;
    delete process.env.KRX_BLD_INVESTOR_DETAIL;
    vi.resetModules();
    const mod = await import('./krxClient.js');
    mod.resetKrxCache();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.KRX_BLD_INVESTOR_DETAIL;
    vi.restoreAllMocks();
  });

  function krxMock(rows: Array<Record<string, unknown>>) {
    return {
      ok: true,
      status: 200,
      json: async () => ({ output: rows }),
      text: async () => JSON.stringify({ output: rows }),
    };
  }

  it('KRX_API_DISABLED=true 시 빈 배열 (네트워크 호출 0)', async () => {
    process.env.KRX_API_DISABLED = 'true';
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    vi.resetModules();
    const { fetchInvestorTradingDetail } = await import('./krxClient.js');
    const rows = await fetchInvestorTradingDetail();
    expect(rows).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('정상 응답 — 11 카테고리 raw 한글 키 매핑', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(krxMock([
      { INVSTR_NM: '외국인', NETBY_QTY: '100000', NETBY_TR_PBMN: '5000000000' },
      { INVSTR_NM: '금융투자', NETBY_QTY: '-50000', NETBY_TR_PBMN: '-2500000000' },
      { INVSTR_NM: '연기금 등', NETBY_QTY: '30000', NETBY_TR_PBMN: '1500000000' },
    ])) as unknown as typeof fetch;
    const { fetchInvestorTradingDetail } = await import('./krxClient.js');
    const rows = await fetchInvestorTradingDetail();
    expect(rows).toHaveLength(3);
    expect(rows[0].category).toBe('외국인');
    expect(rows[0].netBuyQty).toBe(100000);
    expect(rows[0].netBuyKrw).toBe(5_000_000_000);
    expect(rows[1].category).toBe('금융투자');
    expect(rows[1].netBuyKrw).toBe(-2_500_000_000);
  });

  it('카테고리 키 다중 fallback (INVSTR_TP_NM / TRDR_NM)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(krxMock([
      { INVSTR_TP_NM: '투신', NETBY_QTY: '10000', NETBY_TR_PBMN: '500000000' },
      { TRDR_NM: '보험', NETBY_QTY: '20000', NETBY_TR_PBMN: '1000000000' },
    ])) as unknown as typeof fetch;
    const { fetchInvestorTradingDetail } = await import('./krxClient.js');
    const rows = await fetchInvestorTradingDetail();
    expect(rows.map((r) => r.category)).toEqual(['투신', '보험']);
  });

  it('빈 카테고리명 (한글 키 모두 부재) → silent skip', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(krxMock([
      { NETBY_QTY: '1000', NETBY_TR_PBMN: '50000000' },  // INVSTR_NM 부재
      { INVSTR_NM: '개인', NETBY_QTY: '500', NETBY_TR_PBMN: '25000000' },
    ])) as unknown as typeof fetch;
    const { fetchInvestorTradingDetail } = await import('./krxClient.js');
    const rows = await fetchInvestorTradingDetail();
    expect(rows).toHaveLength(1);
    expect(rows[0].category).toBe('개인');
  });

  it('netBuy 수량/거래대금 다중 키 fallback (NETBY_TRDVOL/NETBY_TRDVAL)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(krxMock([
      { INVSTR_NM: '은행', NETBY_TRDVOL: '5000', NETBY_TRDVAL: '250000000' },
    ])) as unknown as typeof fetch;
    const { fetchInvestorTradingDetail } = await import('./krxClient.js');
    const rows = await fetchInvestorTradingDetail();
    expect(rows[0].netBuyQty).toBe(5000);
    expect(rows[0].netBuyKrw).toBe(250_000_000);
  });

  it('빈 응답 → 빈 배열', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(krxMock([])) as unknown as typeof fetch;
    const { fetchInvestorTradingDetail } = await import('./krxClient.js');
    const rows = await fetchInvestorTradingDetail();
    expect(rows).toEqual([]);
  });

  it('fetch throw → 빈 배열 안전 흡수 (silent degradation 차단은 호출자 책임)', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network')) as unknown as typeof fetch;
    const { fetchInvestorTradingDetail } = await import('./krxClient.js');
    const rows = await fetchInvestorTradingDetail();
    expect(rows).toEqual([]);
  });

  it('캐시 — 두 번째 호출 시 fetch 재호출 0 (TTL 10분)', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(krxMock([
      { INVSTR_NM: '외국인', NETBY_QTY: '100', NETBY_TR_PBMN: '5000' },
    ]));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const { fetchInvestorTradingDetail } = await import('./krxClient.js');
    const r1 = await fetchInvestorTradingDetail('20260429');
    const r2 = await fetchInvestorTradingDetail('20260429');
    expect(r1).toEqual(r2);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('ENV KRX_BLD_INVESTOR_DETAIL override 적용', async () => {
    process.env.KRX_BLD_INVESTOR_DETAIL = 'dbms/MDC/STAT/standard/CUSTOM_BLD';
    vi.resetModules();
    const fetchSpy = vi.fn().mockResolvedValue(krxMock([]));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const { fetchInvestorTradingDetail } = await import('./krxClient.js');
    await fetchInvestorTradingDetail();
    // URL 또는 body 에 CUSTOM_BLD 포함 여부
    const callArgs = fetchSpy.mock.calls[0]?.[1] as { body?: string };
    const bodyStr = typeof callArgs?.body === 'string' ? callArgs.body : '';
    expect(bodyStr).toContain('CUSTOM_BLD');
  });

  it('default BLD = MDCSTAT02301', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(krxMock([]));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const { fetchInvestorTradingDetail } = await import('./krxClient.js');
    await fetchInvestorTradingDetail();
    const callArgs = fetchSpy.mock.calls[0]?.[1] as { body?: string };
    const bodyStr = typeof callArgs?.body === 'string' ? callArgs.body : '';
    expect(bodyStr).toContain('MDCSTAT02301');
  });
});
