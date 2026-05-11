// @responsibility KIS official supply pack source client parsing tests.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const _realDataKisGet = vi.fn();
const _getKisOverrides = vi.fn();
const _HAS_REAL_DATA_CLIENT = { value: false };

vi.mock('./http.js', () => ({
  realDataKisGet: (trId: string, path: string, params: Record<string, string>, priority?: string) =>
    _realDataKisGet(trId, path, params, priority),
}));

vi.mock('./overrides.js', () => ({
  getKisOverrides: () => _getKisOverrides(),
}));

vi.mock('./constants.js', () => ({
  get HAS_REAL_DATA_CLIENT() { return _HAS_REAL_DATA_CLIENT.value; },
}));

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
        { stck_bsop_date: '20260508', frgn_ntby_qty: '10', orgn_ntby_qty: '20', prsn_ntby_qty: '-30' },
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
    expect(_realDataKisGet).toHaveBeenCalledWith(
      'FHPTJ04160001',
      '/uapi/domestic-stock/v1/quotations/investor-trade-by-stock-daily',
      expect.objectContaining({ FID_INPUT_ISCD: '005930', FID_COND_MRKT_DIV_CODE: 'J' }),
      'LOW',
    );
  });
});
