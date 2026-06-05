import { beforeEach, describe, expect, it, vi } from 'vitest';

const _realDataKisGet = vi.fn();
const _getKisOverrides = vi.fn();
const _HAS_REAL_DATA_CLIENT = { value: true };

// seed-4452bd3 이후 query.ts 의 transitive import 가 orderGateway 의 kisPost/kisGet 를 끌어온다.
// bare stub 은 export 부재로 import 실패하므로 importOriginal spread 로 실 export 보존 후
// 테스트가 호출하는 realDataKisGet 만 스파이로 교체. (queryHolidayCalendar.test.ts 동일 패턴)
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

// importOriginal spread: transitive orderGateway import 가 KIS_IS_REAL 등 실 상수를 요구하므로
// 보존하고, 테스트가 토글하는 HAS_REAL_DATA_CLIENT 만 동적 getter 로 override.
vi.mock('./constants.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./constants.js')>();
  return {
    ...actual,
    get HAS_REAL_DATA_CLIENT() { return _HAS_REAL_DATA_CLIENT.value; },
  };
});

describe('fetchKisMarketProgramTrade smtn field materialization', () => {
  beforeEach(() => {
    vi.resetModules();
    _realDataKisGet.mockReset();
    _getKisOverrides.mockReset();
    _getKisOverrides.mockReturnValue({});
    process.env.KIS_APP_KEY = 'test-key';
  });

  it('parses whole, arbitrage, non-arbitrage, buy, and sell amounts without fake quantity', async () => {
    const { fetchKisMarketProgramTrade } = await import('./query.js');
    _realDataKisGet.mockResolvedValue({
      output: [{
        arbt_smtn_seln_tr_pbmn: '1,000',
        arbt_smtn_shnu_tr_pbmn: '1,500',
        nabt_smtn_seln_tr_pbmn: '2,000',
        nabt_smtn_shnu_tr_pbmn: '3,000',
        arbt_smtn_ntby_tr_pbmn: '500',
        nabt_smtn_ntby_tr_pbmn: '1,000',
        whol_smtn_ntby_tr_pbmn: '1,500',
      }],
    });

    const result = await fetchKisMarketProgramTrade();

    expect(result?.programNetBuyQty).toBeNull();
    expect(result?.programNetBuyAmount).toBe(3_000);
    expect(result?.programArbitrageNetBuy).toBe(1_000);
    expect(result?.programNonArbitrageNetBuy).toBe(2_000);
    expect(result?.programSellAmount).toBe(3_000);
    expect(result?.programBuyAmount).toBe(4_500);
  });

  it('keeps kospi(11)+kosdaq(19) split metadata in aggregateDiagnostic bundle', async () => {
    const { fetchKisMarketProgramTrade } = await import('./query.js');
    _realDataKisGet
      .mockResolvedValueOnce({ output: Array.from({ length: 11 }, (_, i) => ({ bsop_hour: String(100000 + i), whol_smtn_ntby_tr_pbmn: '1' })) })
      .mockResolvedValueOnce({ output: Array.from({ length: 19 }, (_, i) => ({ bsop_hour: String(100000 + i), whol_smtn_ntby_tr_pbmn: '2' })) });
    const result = await fetchKisMarketProgramTrade();
    const diag = (result?.aggregateDiagnostic ?? {}) as Record<string, unknown>;
    const bundle = (diag.rowBreakdownBundle ?? {}) as Record<string, unknown>;
    expect(((bundle.kospi as Record<string, unknown>)?.outputLength)).toBe(11);
    expect(((bundle.kosdaq as Record<string, unknown>)?.outputLength)).toBe(19);
    expect((diag.combinedSource)).toBe('KOSPI_PLUS_KOSDAQ');
    expect((diag.splitAvailable)).toBe(true);
    expect((diag.combinedOnly)).toBe(false);
  });
});
