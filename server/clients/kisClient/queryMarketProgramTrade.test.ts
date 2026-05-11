// @responsibility fetchKisMarketProgramTrade 회귀 테스트 — ADR-0138 + ADR-0144 정정.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const _realDataKisGet = vi.fn();
const _getKisOverrides = vi.fn();
const _HAS_REAL_DATA_CLIENT = { value: false };

vi.mock('./http.js', () => ({
  realDataKisGet: (trId: string, path: string, params: Record<string, string>) =>
    _realDataKisGet(trId, path, params),
}));

vi.mock('./overrides.js', () => ({
  getKisOverrides: () => _getKisOverrides(),
}));

vi.mock('./constants.js', () => ({
  get HAS_REAL_DATA_CLIENT() { return _HAS_REAL_DATA_CLIENT.value; },
}));

let fetchKisMarketProgramTrade: typeof import('./query.js').fetchKisMarketProgramTrade;

beforeEach(async () => {
  vi.resetModules();
  _realDataKisGet.mockReset();
  _getKisOverrides.mockReset();
  _getKisOverrides.mockReturnValue({});
  _HAS_REAL_DATA_CLIENT.value = false;
  delete process.env.KIS_MARKET_PROGRAM_TRADE_TR_ID;
  delete process.env.KIS_MARKET_PROGRAM_TRADE_PATH;
  process.env.KIS_APP_KEY = 'test-key';

  const mod = await import('./query.js');
  fetchKisMarketProgramTrade = mod.fetchKisMarketProgramTrade;
});

afterEach(() => {
  delete process.env.KIS_APP_KEY;
  delete process.env.KIS_MARKET_PROGRAM_TRADE_TR_ID;
  delete process.env.KIS_MARKET_PROGRAM_TRADE_PATH;
  vi.clearAllMocks();
});

describe('fetchKisMarketProgramTrade (ADR-0138)', () => {
  it('KIS_APP_KEY 미설정 + 실계좌 클라이언트 부재 시 null', async () => {
    delete process.env.KIS_APP_KEY;
    _HAS_REAL_DATA_CLIENT.value = false;
    const result = await fetchKisMarketProgramTrade();
    expect(result).toBeNull();
    expect(_realDataKisGet).not.toHaveBeenCalled();
  });

  it('overrides.fetchKisMarketProgramTrade 우선 적용 (VTS mock)', async () => {
    const mockResult = {
      programNetBuyQty: 50000,
      programNetBuyAmount: 5_000_000_000,
      programArbitrageNetBuy: 1_000_000_000,
      fetchedAt: '2026-05-01T03:00:00.000Z',
      source: 'KIS_API' as const,
    };
    _getKisOverrides.mockReturnValue({
      fetchKisMarketProgramTrade: vi.fn(async () => mockResult),
    });
    const result = await fetchKisMarketProgramTrade();
    expect(result).toEqual(mockResult);
    expect(_realDataKisGet).not.toHaveBeenCalled();
  });

  it('realDataKisGet null 응답 시 null', async () => {
    _realDataKisGet.mockResolvedValue(null);
    const result = await fetchKisMarketProgramTrade();
    expect(result).toBeNull();
  });

  it('output 부재 시 null', async () => {
    _realDataKisGet.mockResolvedValue({ /* no output */ });
    const result = await fetchKisMarketProgramTrade();
    expect(result).toBeNull();
  });


  it('parses comp-program-trade-today output[0] amount fields without FIELD_MISSING semantics', async () => {
    _realDataKisGet.mockResolvedValue({
      rt_cd: '0',
      msg_cd: 'MCA00000',
      output: [{
        arbt_smtn_seln_tr_pbmn: '100',
        arbt_smtn_shnu_tr_pbmn: '250',
        nabt_smtn_seln_tr_pbmn: '300',
        nabt_smtn_shnu_tr_pbmn: '450',
        arbt_smtn_ntby_tr_pbmn: '150',
        nabt_smtn_ntby_tr_pbmn: '150',
        whol_smtn_ntby_tr_pbmn: '300',
      }],
    });

    const result = await fetchKisMarketProgramTrade();

    expect(result).not.toBeNull();
    expect(result?.programNetBuyQty).toBeNull();
    expect(result?.programNetBuyAmount).toBe(300);
    expect(result?.programArbitrageNetBuy).toBe(150);
    expect(result?.programNonArbitrageNetBuy).toBe(150);
    expect(result?.programSellAmount).toBe(400);
    expect(result?.programBuyAmount).toBe(700);
  });

  it('정상 응답 — output 단일 객체 (한글 약어)', async () => {
    _realDataKisGet.mockResolvedValue({
      output: {
        prgm_ntby_qty: '50000',
        prgm_ntby_tr_pbmn: '5000000000',
        arbt_ntby_tr_pbmn: '1000000000',
      },
    });
    const result = await fetchKisMarketProgramTrade();
    expect(result).not.toBeNull();
    expect(result?.programNetBuyQty).toBe(50000);
    expect(result?.programNetBuyAmount).toBe(5_000_000_000);
    expect(result?.programArbitrageNetBuy).toBe(1_000_000_000);
    expect(result?.source).toBe('KIS_API');
    expect(result?.fetchedAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it('정상 응답 — output1 (당일 객체) 우선 매칭', async () => {
    _realDataKisGet.mockResolvedValue({
      output1: {
        prgm_ntby_qty: '30000',
        prgm_ntby_tr_pbmn: '3000000000',
      },
    });
    const result = await fetchKisMarketProgramTrade();
    expect(result?.programNetBuyQty).toBe(30000);
    expect(result?.programNetBuyAmount).toBe(3_000_000_000);
    expect(result?.programArbitrageNetBuy).toBeNull();
  });

  it('정상 응답 — output2 배열 첫 요소 매칭', async () => {
    _realDataKisGet.mockResolvedValue({
      output2: [
        {
          prgm_ntby_qty: '20000',
          prgm_ntby_tr_pbmn: '2000000000',
          arbt_ntby_tr_pbmn: '500000000',
        },
        { /* 이전 일자 — 무시 */ },
      ],
    });
    const result = await fetchKisMarketProgramTrade();
    expect(result?.programNetBuyQty).toBe(20000);
    expect(result?.programArbitrageNetBuy).toBe(500_000_000);
  });

  it('output 다중 키 매칭 — _2 변형 + 영문 약어 자동 흡수', async () => {
    _realDataKisGet.mockResolvedValue({
      output: {
        PRGM_NTBY_QTY: '10000',
        prgm_ntby_tr_pbmn_2: '1500000000',
        ARBT_NTBY_TR_PBMN: '300000000',
      },
    });
    const result = await fetchKisMarketProgramTrade();
    expect(result?.programNetBuyQty).toBe(10000);
    expect(result?.programNetBuyAmount).toBe(1_500_000_000);
    expect(result?.programArbitrageNetBuy).toBe(300_000_000);
  });

  it('음수 보존 (시장 프로그램 순매도)', async () => {
    _realDataKisGet.mockResolvedValue({
      output: {
        prgm_ntby_qty: '-80000',
        prgm_ntby_tr_pbmn: '-7500000000',
        arbt_ntby_tr_pbmn: '-2000000000',
      },
    });
    const result = await fetchKisMarketProgramTrade();
    expect(result?.programNetBuyQty).toBe(-80000);
    expect(result?.programNetBuyAmount).toBe(-7_500_000_000);
    expect(result?.programArbitrageNetBuy).toBe(-2_000_000_000);
  });

  it('programArbitrageNetBuy 부재 시 null (강제 0 fallback 차단)', async () => {
    _realDataKisGet.mockResolvedValue({
      output: {
        prgm_ntby_qty: '10000',
        prgm_ntby_tr_pbmn: '1000000000',
        // arbt_ntby_tr_pbmn 부재
      },
    });
    const result = await fetchKisMarketProgramTrade();
    expect(result?.programArbitrageNetBuy).toBeNull();
  });

  it('차익 NaN/잘못된 형식 시 null', async () => {
    _realDataKisGet.mockResolvedValue({
      output: {
        prgm_ntby_qty: '10000',
        prgm_ntby_tr_pbmn: '1000000000',
        arbt_ntby_tr_pbmn: 'invalid',
      },
    });
    const result = await fetchKisMarketProgramTrade();
    expect(result?.programArbitrageNetBuy).toBeNull();
  });

  it('realDataKisGet throw → null 안전 흡수', async () => {
    _realDataKisGet.mockRejectedValue(new Error('KIS 회로차단'));
    const result = await fetchKisMarketProgramTrade();
    expect(result).toBeNull();
  });

  it('ADR-0144 — TR ID + endpoint default = comp-program-trade-today (시간)', async () => {
    _realDataKisGet.mockResolvedValue({ output: { prgm_ntby_qty: '0', prgm_ntby_tr_pbmn: '0' } });
    await fetchKisMarketProgramTrade();
    expect(_realDataKisGet).toHaveBeenCalledWith(
      'FHPPG04600101',
      '/uapi/domestic-stock/v1/quotations/comp-program-trade-today',
      expect.objectContaining({
        FID_COND_MRKT_DIV_CODE: 'J',
        FID_INPUT_ISCD: '0001',       // 코스피
      }),
    );
  });

  it('ENV KIS_MARKET_PROGRAM_TRADE_TR_ID + PATH override', async () => {
    process.env.KIS_MARKET_PROGRAM_TRADE_TR_ID = 'CUSTOM_MARKET_TR';
    process.env.KIS_MARKET_PROGRAM_TRADE_PATH = '/uapi/custom/path';
    vi.resetModules();
    const mod = await import('./query.js');
    _realDataKisGet.mockResolvedValue({ output: { prgm_ntby_qty: '0', prgm_ntby_tr_pbmn: '0' } });
    await mod.fetchKisMarketProgramTrade();
    expect(_realDataKisGet).toHaveBeenCalledWith(
      'CUSTOM_MARKET_TR',
      '/uapi/custom/path',
      expect.any(Object),
    );
  });

  it('콤마 포함 숫자 파싱 — 시장 단위 거래대금 천단위 콤마', async () => {
    _realDataKisGet.mockResolvedValue({
      output: {
        prgm_ntby_qty: '1,500,000',
        prgm_ntby_tr_pbmn: '12,345,678,901',
        arbt_ntby_tr_pbmn: '2,000,000,000',
      },
    });
    const result = await fetchKisMarketProgramTrade();
    expect(result?.programNetBuyQty).toBe(1_500_000);
    expect(result?.programNetBuyAmount).toBe(12_345_678_901);
    expect(result?.programArbitrageNetBuy).toBe(2_000_000_000);
  });

  it('output2 빈 배열 시 null (배열 첫 요소 부재)', async () => {
    _realDataKisGet.mockResolvedValue({ output2: [] });
    const result = await fetchKisMarketProgramTrade();
    expect(result).toBeNull();
  });
});
