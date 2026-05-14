// @responsibility fetchKisSectorIndexDaily 회귀 테스트 — KIS 국내업종 기간별 지수 시세.
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

let fetchKisSectorIndexDaily: typeof import('./query.js').fetchKisSectorIndexDaily;
let isKisSectorIndexDailyDisabled: typeof import('./query.js').isKisSectorIndexDailyDisabled;
let KIS_SECTOR_INDEX_ISCD: typeof import('./query.js').KIS_SECTOR_INDEX_ISCD;

beforeEach(async () => {
  vi.resetModules();
  _realDataKisGet.mockReset();
  _getKisOverrides.mockReset();
  _getKisOverrides.mockReturnValue({});
  _HAS_REAL_DATA_CLIENT.value = false;
  delete process.env.KIS_SECTOR_INDEX_DAILY_ENABLED;
  delete process.env.KIS_SECTOR_INDEX_DAILY_TR_ID;
  process.env.KIS_APP_KEY = 'test-key';

  const mod = await import('./query.js');
  fetchKisSectorIndexDaily = mod.fetchKisSectorIndexDaily;
  isKisSectorIndexDailyDisabled = mod.isKisSectorIndexDailyDisabled;
  KIS_SECTOR_INDEX_ISCD = mod.KIS_SECTOR_INDEX_ISCD;
});

afterEach(() => {
  delete process.env.KIS_APP_KEY;
  delete process.env.KIS_SECTOR_INDEX_DAILY_ENABLED;
  delete process.env.KIS_SECTOR_INDEX_DAILY_TR_ID;
  vi.clearAllMocks();
});

describe('isKisSectorIndexDailyDisabled — ADR-0157 정확 비교', () => {
  it('ENV 미설정 시 disabled (default OFF)', () => {
    expect(isKisSectorIndexDailyDisabled()).toBe(true);
  });

  it("ENV='true' 시에만 enabled", () => {
    process.env.KIS_SECTOR_INDEX_DAILY_ENABLED = 'true';
    expect(isKisSectorIndexDailyDisabled()).toBe(false);
  });

  it("ENV='1'/'TRUE'/'yes' 는 거부 (정확 비교)", () => {
    for (const v of ['1', 'TRUE', 'yes', 'True']) {
      process.env.KIS_SECTOR_INDEX_DAILY_ENABLED = v;
      expect(isKisSectorIndexDailyDisabled()).toBe(true);
    }
  });
});

describe('KIS_SECTOR_INDEX_ISCD SSOT', () => {
  it('well-known 업종 상세코드 노출', () => {
    expect(KIS_SECTOR_INDEX_ISCD.KOSPI).toBe('0001');
    expect(KIS_SECTOR_INDEX_ISCD.KOSDAQ).toBe('1001');
    expect(KIS_SECTOR_INDEX_ISCD.KOSPI200).toBe('2001');
  });
});

describe('fetchKisSectorIndexDaily', () => {
  it('ENV default OFF 시 null + KIS 호출 0건', async () => {
    const result = await fetchKisSectorIndexDaily('0001');
    expect(result).toBeNull();
    expect(_realDataKisGet).not.toHaveBeenCalled();
  });

  it('overrides 우선 적용 (VTS mock)', async () => {
    process.env.KIS_SECTOR_INDEX_DAILY_ENABLED = 'true';
    const mockResult = {
      sectorIscd: '0001',
      sectorName: '코스피',
      currentIndex: 2700,
      changePct: 1.2,
      series: [],
      fetchedAt: '2026-05-14T03:00:00.000Z',
      source: 'KIS_API' as const,
    };
    _getKisOverrides.mockReturnValue({
      fetchKisSectorIndexDaily: vi.fn().mockResolvedValue(mockResult),
    });
    const result = await fetchKisSectorIndexDaily('0001');
    expect(result).toEqual(mockResult);
    expect(_realDataKisGet).not.toHaveBeenCalled();
  });

  it('KIS_APP_KEY 미설정 + 실계좌 클라이언트 부재 시 null', async () => {
    process.env.KIS_SECTOR_INDEX_DAILY_ENABLED = 'true';
    delete process.env.KIS_APP_KEY;
    _HAS_REAL_DATA_CLIENT.value = false;
    const result = await fetchKisSectorIndexDaily('0001');
    expect(result).toBeNull();
    expect(_realDataKisGet).not.toHaveBeenCalled();
  });

  it('빈 sectorIscd 시 null', async () => {
    process.env.KIS_SECTOR_INDEX_DAILY_ENABLED = 'true';
    const result = await fetchKisSectorIndexDaily('  ');
    expect(result).toBeNull();
    expect(_realDataKisGet).not.toHaveBeenCalled();
  });

  it('output1 스냅샷 + output2 시계열 파싱', async () => {
    process.env.KIS_SECTOR_INDEX_DAILY_ENABLED = 'true';
    _realDataKisGet.mockResolvedValue({
      output1: [
        {
          hts_kor_isnm: '코스피',
          bstp_nmix_prpr: '2700.50',
          bstp_nmix_prdy_ctrt: '1.23',
        },
      ],
      output2: [
        {
          stck_bsop_date: '20260514',
          bstp_nmix_prpr: '2700.50',
          bstp_nmix_oprc: '2680.00',
          bstp_nmix_hgpr: '2710.00',
          bstp_nmix_lwpr: '2675.00',
          acml_vol: '500000000',
          acml_tr_pbmn: '8000000000000',
        },
        {
          stck_bsop_date: '20260513',
          bstp_nmix_prpr: '2667.00',
          bstp_nmix_oprc: '2650.00',
          bstp_nmix_hgpr: '2670.00',
          bstp_nmix_lwpr: '2645.00',
          acml_vol: '480000000',
          acml_tr_pbmn: '7500000000000',
        },
        { stck_bsop_date: 'BADDATE', bstp_nmix_prpr: '999' },
      ],
    });
    const result = await fetchKisSectorIndexDaily('0001');
    expect(result).not.toBeNull();
    expect(result?.sectorIscd).toBe('0001');
    expect(result?.sectorName).toBe('코스피');
    expect(result?.currentIndex).toBe(2700.5);
    expect(result?.changePct).toBe(1.23);
    expect(result?.series).toHaveLength(2); // BADDATE row filtered
    expect(result?.series[0]).toEqual({
      baseDate: '20260514',
      close: 2700.5,
      open: 2680,
      high: 2710,
      low: 2675,
      volume: 500000000,
      value: 8000000000000,
    });
    expect(result?.source).toBe('KIS_API');
    expect(_realDataKisGet).toHaveBeenCalledOnce();
    const [trId, path, params] = _realDataKisGet.mock.calls[0];
    expect(trId).toBe('FHKUP03500100');
    expect(path).toBe('/uapi/domestic-stock/v1/quotations/inquire-daily-indexchartprice');
    expect(params.FID_COND_MRKT_DIV_CODE).toBe('U');
    expect(params.FID_INPUT_ISCD).toBe('0001');
    expect(params.FID_PERIOD_DIV_CODE).toBe('D');
    expect(params.FID_INPUT_DATE_1).toMatch(/^\d{8}$/);
    expect(params.FID_INPUT_DATE_2).toMatch(/^\d{8}$/);
  });

  it('output2 부재 시 output 으로 fallback (스냅샷·시계열 공용)', async () => {
    process.env.KIS_SECTOR_INDEX_DAILY_ENABLED = 'true';
    _realDataKisGet.mockResolvedValue({
      output: [
        {
          stck_bsop_date: '20260514',
          bstp_nmix_prpr: '2700.00',
        },
      ],
    });
    const result = await fetchKisSectorIndexDaily('0001');
    expect(result).not.toBeNull();
    expect(result?.sectorName).toBe(''); // hts_kor_isnm 부재
    expect(result?.currentIndex).toBe(2700); // output[0] 스냅샷 공용
    expect(result?.changePct).toBeNull(); // bstp_nmix_prdy_ctrt 부재
    expect(result?.series).toHaveLength(1);
    expect(result?.series[0].baseDate).toBe('20260514');
  });

  it('빈 응답 시 스냅샷 부재 — null/빈값 graceful', async () => {
    process.env.KIS_SECTOR_INDEX_DAILY_ENABLED = 'true';
    _realDataKisGet.mockResolvedValue({ output1: [], output2: [] });
    const result = await fetchKisSectorIndexDaily('0001');
    expect(result).not.toBeNull();
    expect(result?.sectorName).toBe('');
    expect(result?.currentIndex).toBeNull();
    expect(result?.changePct).toBeNull();
    expect(result?.series).toHaveLength(0);
  });

  it('KIS throw 시 null (graceful)', async () => {
    process.env.KIS_SECTOR_INDEX_DAILY_ENABLED = 'true';
    _realDataKisGet.mockRejectedValue(new Error('circuit open'));
    const result = await fetchKisSectorIndexDaily('0001');
    expect(result).toBeNull();
  });

  it('명시 fromDate/toDate 사용 + 잘못된 형식은 기본 윈도우 fallback', async () => {
    process.env.KIS_SECTOR_INDEX_DAILY_ENABLED = 'true';
    _realDataKisGet.mockResolvedValue({ output1: [], output2: [] });
    await fetchKisSectorIndexDaily('0001', '20260101', '20260201');
    expect(_realDataKisGet.mock.calls[0][2].FID_INPUT_DATE_1).toBe('20260101');
    expect(_realDataKisGet.mock.calls[0][2].FID_INPUT_DATE_2).toBe('20260201');

    _realDataKisGet.mockClear();
    await fetchKisSectorIndexDaily('0001', 'bad', 'bad');
    expect(_realDataKisGet.mock.calls[0][2].FID_INPUT_DATE_1).toMatch(/^\d{8}$/);
    expect(_realDataKisGet.mock.calls[0][2].FID_INPUT_DATE_2).toMatch(/^\d{8}$/);
  });

  it('KIS_SECTOR_INDEX_DAILY_TR_ID ENV 우회', async () => {
    process.env.KIS_SECTOR_INDEX_DAILY_ENABLED = 'true';
    process.env.KIS_SECTOR_INDEX_DAILY_TR_ID = 'CUSTOM00001';
    vi.resetModules();
    const mod = await import('./query.js');
    _realDataKisGet.mockResolvedValue({ output1: [], output2: [] });
    await mod.fetchKisSectorIndexDaily('0001');
    expect(_realDataKisGet.mock.calls[0][0]).toBe('CUSTOM00001');
  });
});
