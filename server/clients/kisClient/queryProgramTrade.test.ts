// @responsibility fetchKisStockProgramTrade 회귀 테스트 — ADR-0137 KIS Open API comp-program-trade-today.
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

let fetchKisStockProgramTrade: typeof import('./query.js').fetchKisStockProgramTrade;

beforeEach(async () => {
  vi.resetModules();
  _realDataKisGet.mockReset();
  _getKisOverrides.mockReset();
  _getKisOverrides.mockReturnValue({});
  _HAS_REAL_DATA_CLIENT.value = false;
  delete process.env.KIS_STOCK_PROGRAM_TRADE_TR_ID;
  process.env.KIS_APP_KEY = 'test-key';

  const mod = await import('./query.js');
  fetchKisStockProgramTrade = mod.fetchKisStockProgramTrade;
});

afterEach(() => {
  delete process.env.KIS_APP_KEY;
  delete process.env.KIS_STOCK_PROGRAM_TRADE_TR_ID;
  vi.clearAllMocks();
});

describe('fetchKisStockProgramTrade (ADR-0137)', () => {
  it('KIS_APP_KEY 미설정 + 실계좌 클라이언트 부재 시 null', async () => {
    delete process.env.KIS_APP_KEY;
    _HAS_REAL_DATA_CLIENT.value = false;
    const result = await fetchKisStockProgramTrade('005930');
    expect(result).toBeNull();
    expect(_realDataKisGet).not.toHaveBeenCalled();
  });

  it('overrides.fetchKisStockProgramTrade 우선 적용 (VTS mock)', async () => {
    const mockResult = {
      stockCode: '005930',
      programNetBuyQty: 1000,
      programNetBuyAmount: 80_000_000,
      programBuyRatio: 12.5,
      fetchedAt: '2026-05-01T03:00:00.000Z',
      source: 'KIS_API' as const,
    };
    _getKisOverrides.mockReturnValue({
      fetchKisStockProgramTrade: vi.fn(async () => mockResult),
    });
    const result = await fetchKisStockProgramTrade('005930');
    expect(result).toEqual(mockResult);
    // realDataKisGet 우회 — override 사용
    expect(_realDataKisGet).not.toHaveBeenCalled();
  });

  it('realDataKisGet null 응답 시 null', async () => {
    _realDataKisGet.mockResolvedValue(null);
    const result = await fetchKisStockProgramTrade('005930');
    expect(result).toBeNull();
  });

  it('output 부재 시 null', async () => {
    _realDataKisGet.mockResolvedValue({ /* no output */ });
    const result = await fetchKisStockProgramTrade('005930');
    expect(result).toBeNull();
  });

  it('정상 응답 — 한글 약어 필드 + 양수 프로그램 순매수', async () => {
    _realDataKisGet.mockResolvedValue({
      output: {
        prgm_ntby_qty: '1500',
        prgm_ntby_tr_pbmn: '120000000',
        prgm_byov_rate: '15.5',
      },
    });
    const result = await fetchKisStockProgramTrade('005930');
    expect(result).not.toBeNull();
    expect(result?.stockCode).toBe('005930');
    expect(result?.programNetBuyQty).toBe(1500);
    expect(result?.programNetBuyAmount).toBe(120_000_000);
    expect(result?.programBuyRatio).toBe(15.5);
    expect(result?.source).toBe('KIS_API');
    expect(result?.fetchedAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it('output 필드 다중 키 매칭 — _2 변형 필드명 자동 흡수', async () => {
    _realDataKisGet.mockResolvedValue({
      output: {
        prgm_ntby_qty_2: '500',
        prgm_ntby_tr_pbmn_2: '40000000',
        prgm_byov_rate_2: '8.0',
      },
    });
    const result = await fetchKisStockProgramTrade('005930');
    expect(result?.programNetBuyQty).toBe(500);
    expect(result?.programNetBuyAmount).toBe(40_000_000);
    expect(result?.programBuyRatio).toBe(8.0);
  });

  it('output 필드 다중 키 매칭 — 영문 약어 대문자 필드명 자동 흡수', async () => {
    _realDataKisGet.mockResolvedValue({
      output: {
        PRGM_NTBY_QTY: '2500',
        PRGM_NTBY_TR_PBMN: '200000000',
        PRGM_BYOV_RATE: '20.0',
      },
    });
    const result = await fetchKisStockProgramTrade('005930');
    expect(result?.programNetBuyQty).toBe(2500);
    expect(result?.programNetBuyAmount).toBe(200_000_000);
    expect(result?.programBuyRatio).toBe(20.0);
  });

  it('음수 프로그램 순매수 보존 (순매도)', async () => {
    _realDataKisGet.mockResolvedValue({
      output: {
        prgm_ntby_qty: '-3000',
        prgm_ntby_tr_pbmn: '-240000000',
        prgm_byov_rate: '5.5',
      },
    });
    const result = await fetchKisStockProgramTrade('005930');
    expect(result?.programNetBuyQty).toBe(-3000);
    expect(result?.programNetBuyAmount).toBe(-240_000_000);
  });

  it('programBuyRatio 부재 시 null (강제 0 fallback 차단)', async () => {
    _realDataKisGet.mockResolvedValue({
      output: {
        prgm_ntby_qty: '100',
        prgm_ntby_tr_pbmn: '8000000',
        // prgm_byov_rate 부재
      },
    });
    const result = await fetchKisStockProgramTrade('005930');
    expect(result?.programNetBuyQty).toBe(100);
    expect(result?.programBuyRatio).toBeNull();
  });

  it('비중 NaN/잘못된 형식 시 null', async () => {
    _realDataKisGet.mockResolvedValue({
      output: {
        prgm_ntby_qty: '100',
        prgm_ntby_tr_pbmn: '8000000',
        prgm_byov_rate: 'invalid',
      },
    });
    const result = await fetchKisStockProgramTrade('005930');
    expect(result?.programBuyRatio).toBeNull();
  });

  it('realDataKisGet throw → null 안전 흡수', async () => {
    _realDataKisGet.mockRejectedValue(new Error('KIS 회로차단'));
    const result = await fetchKisStockProgramTrade('005930');
    expect(result).toBeNull();
  });

  it('종목코드 자동 6자리 zero-padding', async () => {
    _realDataKisGet.mockResolvedValue({
      output: {
        prgm_ntby_qty: '0',
        prgm_ntby_tr_pbmn: '0',
      },
    });
    await fetchKisStockProgramTrade('5930');
    // 호출 시 padStart 적용 확인
    expect(_realDataKisGet).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ FID_INPUT_ISCD: '005930' }),
    );
  });

  it('TR ID default = FHPPG04650201 (KIS 공식 endpoint)', async () => {
    _realDataKisGet.mockResolvedValue({ output: { prgm_ntby_qty: '0', prgm_ntby_tr_pbmn: '0' } });
    await fetchKisStockProgramTrade('005930');
    expect(_realDataKisGet).toHaveBeenCalledWith(
      'FHPPG04650201',
      '/uapi/domestic-stock/v1/quotations/comp-program-trade-today',
      expect.any(Object),
    );
  });

  it('ENV KIS_STOCK_PROGRAM_TRADE_TR_ID override 적용', async () => {
    process.env.KIS_STOCK_PROGRAM_TRADE_TR_ID = 'CUSTOM_TR_ID_001';
    vi.resetModules();
    const mod = await import('./query.js');
    _realDataKisGet.mockResolvedValue({ output: { prgm_ntby_qty: '0', prgm_ntby_tr_pbmn: '0' } });
    await mod.fetchKisStockProgramTrade('005930');
    expect(_realDataKisGet).toHaveBeenCalledWith(
      'CUSTOM_TR_ID_001',
      expect.any(String),
      expect.any(Object),
    );
  });

  it('콤마 포함 숫자 파싱 정확 — KIS 응답 천단위 콤마 대응', async () => {
    _realDataKisGet.mockResolvedValue({
      output: {
        prgm_ntby_qty: '1,234,567',
        prgm_ntby_tr_pbmn: '987,654,321',
        prgm_byov_rate: '12.50',
      },
    });
    const result = await fetchKisStockProgramTrade('005930');
    expect(result?.programNetBuyQty).toBe(1_234_567);
    expect(result?.programNetBuyAmount).toBe(987_654_321);
    expect(result?.programBuyRatio).toBe(12.50);
  });
});
