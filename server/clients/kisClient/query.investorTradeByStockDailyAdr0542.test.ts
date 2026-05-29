// @responsibility ADR-0542 fetchKisInvestorTradeByStockDaily output1/output2 버킷 합성 회귀 테스트.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const _realDataKisGet = vi.fn();
const _getKisOverrides = vi.fn();
const _HAS_REAL_DATA_CLIENT = { value: false };

vi.mock('./http.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./http.js')>();
  return {
    ...actual,
    realDataKisGet: (trId: string, path: string, params: Record<string, string>) =>
      _realDataKisGet(trId, path, params),
  };
});

vi.mock('./overrides.js', () => ({
  getKisOverrides: () => _getKisOverrides(),
}));

vi.mock('./constants.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./constants.js')>();
  return {
    ...actual,
    get HAS_REAL_DATA_CLIENT() { return _HAS_REAL_DATA_CLIENT.value; },
  };
});

let fetchKisInvestorTradeByStockDaily: typeof import('./query.js').fetchKisInvestorTradeByStockDaily;

async function load(): Promise<void> {
  vi.resetModules();
  const mod = await import('./query.js');
  fetchKisInvestorTradeByStockDaily = mod.fetchKisInvestorTradeByStockDaily;
}

beforeEach(async () => {
  _realDataKisGet.mockReset();
  _getKisOverrides.mockReset();
  _getKisOverrides.mockReturnValue({});
  _HAS_REAL_DATA_CLIENT.value = false;
  process.env.KIS_APP_KEY = 'test-key';
  delete process.env.KIS_INVESTOR_OUTPUT_BUCKET_FIX;
  delete process.env.KIS_ONLY_TRACE;
  await load();
});

afterEach(() => {
  delete process.env.KIS_APP_KEY;
  delete process.env.KIS_INVESTOR_OUTPUT_BUCKET_FIX;
  delete process.env.KIS_ONLY_TRACE;
  vi.clearAllMocks();
});

describe('fetchKisInvestorTradeByStockDaily — ADR-0542 output 버킷 합성', () => {
  it('단일 output2 row (외인+기관 동시) → materialized (기존 무회귀)', async () => {
    _realDataKisGet.mockResolvedValue({
      output2: [
        { stck_bsop_date: '20260508', frgn_ntby_qty: '1000', orgn_ntby_qty: '2000', prsn_ntby_qty: '-3000' },
      ],
    });
    const result = await fetchKisInvestorTradeByStockDaily('005930');
    expect(result).not.toBeNull();
    expect(result?.foreignNetBuy).toBe(1000);
    expect(result?.institutionalNetBuy).toBe(2000);
    expect(result?.individualNetBuy).toBe(-3000);
    expect(result?.tradingDate).toBe('2026-05-08');
    expect(result?.source).toBe('KIS_API');
  });

  it('output2(외인) + output1(기관) 분리 → 정확 합성 (2/11 회귀 제거 핵심)', async () => {
    _realDataKisGet.mockResolvedValue({
      output1: { orgn_ntby_qty: '5000', prsn_ntby_qty: '-1000' },
      output2: [{ stck_bsop_date: '20260508', frgn_ntby_qty: '1200' }],
    });
    const result = await fetchKisInvestorTradeByStockDaily('005930');
    expect(result).not.toBeNull();
    expect(result?.foreignNetBuy).toBe(1200);
    expect(result?.institutionalNetBuy).toBe(5000);
  });

  it('output1 only (요약 row 단일) → materialized', async () => {
    _realDataKisGet.mockResolvedValue({
      output1: { stck_bsop_date: '20260508', frgn_ntby_qty: '300', orgn_ntby_qty: '400' },
    });
    const result = await fetchKisInvestorTradeByStockDaily('005930');
    expect(result).not.toBeNull();
    expect(result?.foreignNetBuy).toBe(300);
    expect(result?.institutionalNetBuy).toBe(400);
  });

  it('두 버킷 모두 net-buy 부재 → null (PROVIDER_EMPTY_RESPONSE)', async () => {
    _realDataKisGet.mockResolvedValue({
      output1: { stck_prpr: '70000', acml_vol: '1000000' },
      output2: [{ stck_bsop_date: '20260508', stck_clpr: '70000' }],
    });
    const result = await fetchKisInvestorTradeByStockDaily('005930');
    expect(result).toBeNull();
  });

  it('외인만 있고 기관 부재 → null (둘 다 필수 보존)', async () => {
    _realDataKisGet.mockResolvedValue({
      output2: [{ stck_bsop_date: '20260508', frgn_ntby_qty: '1000' }],
    });
    const result = await fetchKisInvestorTradeByStockDaily('005930');
    expect(result).toBeNull();
  });

  it('금액 alias (_tr_pbmn) 도 합성 — 콤마 포함 숫자 파싱', async () => {
    _realDataKisGet.mockResolvedValue({
      output2: [{ stck_bsop_date: '20260508', frgn_ntby_tr_pbmn: '1,234,000', orgn_ntby_tr_pbmn: '-2,000' }],
    });
    const result = await fetchKisInvestorTradeByStockDaily('005930');
    expect(result?.foreignNetBuy).toBe(1_234_000);
    expect(result?.institutionalNetBuy).toBe(-2000);
  });

  it('ENV OFF (KIS_INVESTOR_OUTPUT_BUCKET_FIX=false) → 단일 버킷 동작 (byte-equivalent)', async () => {
    process.env.KIS_INVESTOR_OUTPUT_BUCKET_FIX = 'false';
    await load();
    // 분리 응답: output2 외인만 / output1 기관만 — OFF 면 합성 안 함 → 기관 부재 → null.
    _realDataKisGet.mockResolvedValue({
      output1: { orgn_ntby_qty: '5000' },
      output2: [{ stck_bsop_date: '20260508', frgn_ntby_qty: '1200' }],
    });
    const result = await fetchKisInvestorTradeByStockDaily('005930');
    expect(result).toBeNull();
  });

  it('ENV OFF + 단일 버킷 완전 응답 → 정상 (직전 동작 보존)', async () => {
    process.env.KIS_INVESTOR_OUTPUT_BUCKET_FIX = 'false';
    await load();
    _realDataKisGet.mockResolvedValue({
      output2: [{ stck_bsop_date: '20260508', frgn_ntby_qty: '1000', orgn_ntby_qty: '2000' }],
    });
    const result = await fetchKisInvestorTradeByStockDaily('005930');
    expect(result?.foreignNetBuy).toBe(1000);
    expect(result?.institutionalNetBuy).toBe(2000);
  });

  it('KIS_APP_KEY 미설정 + 실계좌 부재 → null (realDataKisGet 미호출)', async () => {
    delete process.env.KIS_APP_KEY;
    _HAS_REAL_DATA_CLIENT.value = false;
    await load();
    const result = await fetchKisInvestorTradeByStockDaily('005930');
    expect(result).toBeNull();
    expect(_realDataKisGet).not.toHaveBeenCalled();
  });

  it('realDataKisGet throw → null 안전 흡수', async () => {
    _realDataKisGet.mockRejectedValue(new Error('KIS 회로차단'));
    const result = await fetchKisInvestorTradeByStockDaily('005930');
    expect(result).toBeNull();
  });

  it('actualInvestorFlowRowCarrier sourcePath 가 base 버킷 반영', async () => {
    _realDataKisGet.mockResolvedValue({
      output2: [{ stck_bsop_date: '20260508', frgn_ntby_qty: '1000', orgn_ntby_qty: '2000' }],
    });
    const result = await fetchKisInvestorTradeByStockDaily('005930');
    expect(result?.actualInvestorFlowRowCarrier?.rowSourcePath).toContain('output2');
  });
});
