// @responsibility KIS official supply pack source client parsing tests.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const _realDataKisGet = vi.fn();
const _getKisOverrides = vi.fn();
const _HAS_REAL_DATA_CLIENT = { value: false };

// seed-4452bd3 이후 query.ts 의 transitive import 가 orderGateway 의 kisPost/kisGet 를 끌어온다.
// bare stub 은 export 부재로 import 실패하므로 importOriginal spread 로 실 export 보존 후
// 테스트가 호출하는 realDataKisGet 만 스파이로 교체. (queryHolidayCalendar.test.ts 동일 패턴)
vi.mock('./http.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./http.js')>();
  return {
    ...actual,
    realDataKisGet: (trId: string, path: string, params: Record<string, string>, priority?: string) =>
      _realDataKisGet(trId, path, params, priority),
  };
});

vi.mock('./overrides.js', () => ({
  getKisOverrides: () => _getKisOverrides(),
}));

// importOriginal spread: transitive orderGateway import 가 KIS_IS_REAL 등 실 상수를 요구하므로
// 보존하고, 테스트가 토글하는 HAS_REAL_DATA_CLIENT 만 동적 getter 로 override.
vi.mock('./constants.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./constants.js')>();
  return {
    ...actual,
    get HAS_REAL_DATA_CLIENT() { return _HAS_REAL_DATA_CLIENT.value; },
  };
});

let mod: typeof import('./query.js');

beforeEach(async () => {
  vi.resetModules();
  _realDataKisGet.mockReset();
  _getKisOverrides.mockReset();
  _getKisOverrides.mockReturnValue({});
  _HAS_REAL_DATA_CLIENT.value = false;
  process.env.KIS_APP_KEY = 'test-key';
  mod = await import('./query.js');
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.KIS_APP_KEY;
  vi.clearAllMocks();
});

describe('KIS official short/loan/credit read-only sources', () => {
  it('daily short sale parses real fields and does not fake missing values as zero', async () => {
    _realDataKisGet.mockResolvedValue({
      output2: [
        { stck_bsop_date: '20260508', ssts_cntg_qty: '1,300', ssts_tr_pbmn: '13000000', ssts_tr_pbmn_rlim: '3.2' },
        { stck_bsop_date: '20260507', ssts_cntg_qty: '1,000', ssts_tr_pbmn: '10000000', ssts_tr_pbmn_rlim: '2.1' },
      ],
    });

    const result = await mod.fetchKisDailyShortSale('5930');

    expect(result).toMatchObject({
      stockCode: '005930',
      tradingDate: '2026-05-08',
      shortSaleQty: 1300,
      shortSaleAmount: 13_000_000,
      shortSaleRatio: 3.2,
      trend: 'INCREASING',
      source: 'KIS_API',
    });
    expect(result?.shortSaleIncreaseRate).toBeCloseTo(30);
    expect(_realDataKisGet).toHaveBeenCalledWith(
      'FHPST04830000',
      '/uapi/domestic-stock/v1/quotations/daily-short-sale',
      expect.objectContaining({ FID_INPUT_ISCD: '005930', FID_COND_MRKT_DIV_CODE: 'J' }),
      'LOW',
    );
  });

  it('daily short sale accepted-empty returns null instead of zero-filled data', async () => {
    _realDataKisGet.mockResolvedValue({ rt_cd: '0', msg_cd: 'MCA00000', output2: [] });
    const result = await mod.fetchKisDailyShortSale('005930');
    expect(result).toBeNull();
  });

  it('daily loan transaction parses balance and increase rate', async () => {
    _realDataKisGet.mockResolvedValue({
      output1: [
        { bsop_date: '20260508', rmnd_stcn: '1,400', rmnd_amt: '14000000' },
        { bsop_date: '20260507', rmnd_stcn: '1,000', rmnd_amt: '10000000' },
      ],
    });

    const result = await mod.fetchKisDailyLoanTransaction('005930');

    expect(result?.loanBalanceQty).toBe(1400);
    expect(result?.loanBalanceAmount).toBe(14_000_000);
    expect(result?.loanIncreaseRate).toBeCloseTo(40);
    expect(result?.trend).toBe('INCREASING');
    expect(_realDataKisGet).toHaveBeenCalledWith(
      'HHPST074500C0',
      '/uapi/domestic-stock/v1/quotations/daily-loan-trans',
      expect.objectContaining({ MRKT_DIV_CLS_CODE: '3', MKSC_SHRN_ISCD: '005930' }),
      'LOW',
    );
  });

  it('daily credit balance parses credit fields and preserves missing as undefined', async () => {
    _realDataKisGet.mockResolvedValue({
      output: [
        { deal_date: '20260508', whol_loan_rmnd_stcn: '1,500', whol_loan_rmnd_amt: '15000000' },
        { deal_date: '20260507', whol_loan_rmnd_stcn: '1,000', whol_loan_rmnd_amt: '10000000' },
      ],
    });

    const result = await mod.fetchKisDailyCreditBalance('005930');

    expect(result?.creditBalanceQty).toBe(1500);
    expect(result?.creditBalanceAmount).toBe(15_000_000);
    expect(result?.creditBalanceRatio).toBeUndefined();
    expect(result?.creditIncreaseRate).toBeCloseTo(50);
    expect(result?.trend).toBe('INCREASING');
  });

  it('investor daily by stock uses official daily endpoint and requires real fields', async () => {
    _realDataKisGet.mockResolvedValue({
      output2: [
        { stck_bsop_date: '20260508', frgn_ntby_qty: '10', orgn_ntby_qty: '20', prsn_ntby_qty: '-30', accountNo: 'PRIVATE' },
      ],
    });

    const result = await mod.fetchKisInvestorTradeByStockDaily('005930');

    expect(result).toMatchObject({
      stockCode: '005930',
      tradingDate: '2026-05-08',
      foreignNetBuy: 10,
      institutionalNetBuy: 20,
      individualNetBuy: -30,
    });
    expect(result?.actualRows?.[0]).toMatchObject({
      foreignNetBuy: 10,
      institutionNetBuy: 20,
      institutionalNetBuy: 20,
      individualNetBuy: -30,
      frgn_ntby_qty: '10',
      orgn_ntby_qty: '20',
      prsn_ntby_qty: '-30',
    });
    expect(result?.actualInvestorFlowRowCarrier?.actualRows).toHaveLength(1);
    expect(result?.actualInvestorFlowRowCarrier?.actualRows[0]).toMatchObject({
      foreignNetBuy: 10,
      institutionNetBuy: 20,
      institutionalNetBuy: 20,
      individualNetBuy: -30,
    });
    expect(result?.actualInvestorFlowRowCarrier?.numberFieldKeys).toContain('foreignNetBuy');
    expect(result?.actualInvestorFlowRowCarrier?.numericStringFieldKeys).toContain('frgn_ntby_qty');
    expect(JSON.stringify(result?.actualInvestorFlowRowCarrier)).not.toContain('accountNo');
    expect(_realDataKisGet).toHaveBeenCalledWith(
      'FHPTJ04160001',
      '/uapi/domestic-stock/v1/quotations/investor-trade-by-stock-daily',
      expect.objectContaining({ FID_INPUT_ISCD: '005930', FID_COND_MRKT_DIV_CODE: 'J', FID_ORG_ADJ_PRC: '0', FID_ETC_CLS_CODE: '0' }),
      'LOW',
    );
  });

  it('investor daily uses previous trading day before open and never sends blank FIDs', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-10T23:30:00.000Z')); // 2026-05-11 08:30 KST, PRE_OPEN
    _realDataKisGet.mockResolvedValue({ output2: [{ stck_bsop_date: '20260508', frgn_ntby_qty: '1' }] });

    await mod.fetchKisInvestorTradeByStockDaily('005930');

    expect(_realDataKisGet).toHaveBeenCalledWith(
      'FHPTJ04160001',
      '/uapi/domestic-stock/v1/quotations/investor-trade-by-stock-daily',
      expect.objectContaining({
        FID_INPUT_DATE_1: '20260508',
        FID_ORG_ADJ_PRC: '0',
        FID_ETC_CLS_CODE: '0',
      }),
      'LOW',
    );
  });

  it('investor daily tries today during regular session then falls back to previous trading day', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-11T01:00:00.000Z')); // 2026-05-11 10:00 KST, REGULAR
    _realDataKisGet
      .mockRejectedValueOnce(new Error('OPSQ2001'))
      .mockResolvedValueOnce({ output2: [{ stck_bsop_date: '20260508', frgn_ntby_qty: '1', orgn_ntby_qty: '2' }] });

    const result = await mod.fetchKisInvestorTradeByStockDaily('005930');

    expect(result?.tradingDate).toBe('2026-05-08');
    expect(_realDataKisGet.mock.calls.map((call) => call[2].FID_INPUT_DATE_1)).toEqual(['20260511', '20260508']);
  });

  it('investor daily ignores quote-like output1 and materializes investor output2', async () => {
    _realDataKisGet.mockResolvedValue({
      output1: [{ stck_prpr: '1000', prdy_vrss: '10', prdy_vrss_sign: '2', prdy_ctrt: '1.0', acml_vol: '100' }],
      output2: [{ stck_bsop_date: '20260508', frgn_ntby_qty: '10', orgn_ntby_qty: '20', prsn_ntby_qty: '-30' }],
    });

    const result = await mod.fetchKisInvestorTradeByStockDaily('005930');

    expect(result).toMatchObject({
      tradingDate: '2026-05-08',
      foreignNetBuy: 10,
      institutionalNetBuy: 20,
      individualNetBuy: -30,
    });
    expect(result?.actualInvestorFlowRowCarrier?.actualRows).toHaveLength(1);
    expect(result?.actualInvestorFlowRowCarrier?.numericStringFieldKeys).toContain('frgn_ntby_qty');
    expect(JSON.stringify(result?.actualInvestorFlowRowCarrier)).not.toContain('accountNo');
  });

  it('investor daily does not materialize quote-like output1 when output2 is missing', async () => {
    _realDataKisGet.mockResolvedValue({
      output1: [{ stck_prpr: '1000', prdy_vrss: '10', prdy_vrss_sign: '2', prdy_ctrt: '1.0', acml_vol: '100' }],
    });

    const result = await mod.fetchKisInvestorTradeByStockDaily('005930');

    expect(result).toBeNull();
  });

  it('daily short sale ignores quote-like output1 and materializes short output2', async () => {
    _realDataKisGet.mockResolvedValue({
      output1: [{ stck_prpr: '1000', prdy_vrss: '10', prdy_vrss_sign: '2', prdy_ctrt: '1.0', acml_vol: '100' }],
      output2: [
        { stck_bsop_date: '20260508', ssts_cntg_qty: '1,300', ssts_tr_pbmn: '13000000', ssts_tr_pbmn_rlim: '3.2' },
        { stck_bsop_date: '20260507', ssts_cntg_qty: '1,000', ssts_tr_pbmn: '10000000', ssts_tr_pbmn_rlim: '2.1' },
      ],
    });

    const result = await mod.fetchKisDailyShortSale('005930');

    expect(result).toMatchObject({
      tradingDate: '2026-05-08',
      shortSaleQty: 1300,
      shortSaleAmount: 13_000_000,
      shortSaleRatio: 3.2,
    });
  });

  it('daily short sale does not materialize quote-like-only buckets', async () => {
    _realDataKisGet.mockResolvedValue({
      output1: [{ stck_prpr: '1000', prdy_vrss: '10', prdy_vrss_sign: '2', prdy_ctrt: '1.0', acml_vol: '100' }],
    });

    const result = await mod.fetchKisDailyShortSale('005930');

    expect(result).toBeNull();
  });

});
