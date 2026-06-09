// @responsibility ADR-0593 sectorIndex breadth 추출 회귀 — fetchKospiCompositeIntradayQuote 가 동일 응답 row 에서 ascn/down_issu_cnt(상승·하락종목수) 추출, 부재 시 undefined(보수).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const _realDataKisGet = vi.fn();
const _getKisOverrides = vi.fn();
const _refreshKisToken = vi.fn();
const _HAS_REAL_DATA_CLIENT = { value: false };

vi.mock('../http.js', () => ({
  realDataKisGet: (trId: string, path: string, params: Record<string, string>) =>
    _realDataKisGet(trId, path, params),
}));
vi.mock('../overrides.js', () => ({
  getKisOverrides: () => _getKisOverrides(),
}));
vi.mock('../constants.js', () => ({
  get HAS_REAL_DATA_CLIENT() { return _HAS_REAL_DATA_CLIENT.value; },
  KIS_BASE: 'https://openapivts.koreainvestment.com:29443',
  KIS_IS_REAL: false,
  REAL_DATA_BASE: 'https://openapi.koreainvestment.com:9443',
}));
vi.mock('../auth.js', () => ({
  refreshKisToken: () => _refreshKisToken(),
  refreshRealDataToken: () => _refreshKisToken(),
  getKisTokenRemainingHours: () => 22,
  getRealDataTokenRemainingHours: () => 22,
}));

let mod: typeof import('./sectorIndex.js');

beforeEach(async () => {
  vi.resetModules();
  _realDataKisGet.mockReset();
  _getKisOverrides.mockReset();
  _refreshKisToken.mockReset();
  _refreshKisToken.mockResolvedValue('test-token');
  _getKisOverrides.mockReturnValue({});
  _HAS_REAL_DATA_CLIENT.value = false;
  process.env.KIS_APP_KEY = 'test-key';
  process.env.KIS_APP_SECRET = 'test-secret';
  process.env.R6_KOSPI_INTRADAY_QUOTE_ENABLED = 'true';
  mod = await import('./sectorIndex.js');
});

afterEach(() => {
  delete process.env.KIS_APP_KEY;
  delete process.env.KIS_APP_SECRET;
  delete process.env.R6_KOSPI_INTRADAY_QUOTE_ENABLED;
});

describe('ADR-0593 fetchKospiCompositeIntradayQuote breadth extraction', () => {
  it('응답 row 의 ascn_issu_cnt / down_issu_cnt 를 advanceCount / declineCount 로 추출', async () => {
    _realDataKisGet.mockResolvedValue({
      output: [{
        bstp_nmix_prpr: '2800.5',
        bstp_nmix_prdy_ctrt: '4.2',
        stck_bsop_date: '20260609',
        ascn_issu_cnt: '650',
        down_issu_cnt: '210',
      }],
    });
    const quote = await mod.fetchKospiCompositeIntradayQuote();
    expect(quote).not.toBeNull();
    expect(quote?.advanceCount).toBe(650);
    expect(quote?.declineCount).toBe(210);
    expect(quote?.changePct).toBeCloseTo(4.2, 5);
    expect(quote?.tradeDate).toBe('2026-06-09');
  });

  it('등락종목수 필드 부재 → advanceCount/declineCount undefined (보수), current/changePct 정상', async () => {
    _realDataKisGet.mockResolvedValue({
      output: [{
        bstp_nmix_prpr: '2800.5',
        bstp_nmix_prdy_ctrt: '4.2',
        stck_bsop_date: '20260609',
      }],
    });
    const quote = await mod.fetchKospiCompositeIntradayQuote();
    expect(quote).not.toBeNull();
    expect(quote?.advanceCount).toBeUndefined();
    expect(quote?.declineCount).toBeUndefined();
    expect(quote?.current).toBeCloseTo(2800.5, 5);
  });

  it('음수/비유한 등락종목수 → undefined (보수)', async () => {
    _realDataKisGet.mockResolvedValue({
      output: [{
        bstp_nmix_prpr: '2800.5',
        bstp_nmix_prdy_ctrt: '4.2',
        stck_bsop_date: '20260609',
        ascn_issu_cnt: '-1',
        down_issu_cnt: 'NaN',
      }],
    });
    const quote = await mod.fetchKospiCompositeIntradayQuote();
    expect(quote?.advanceCount).toBeUndefined();
    expect(quote?.declineCount).toBeUndefined();
  });
});
