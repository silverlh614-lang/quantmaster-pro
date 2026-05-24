// @responsibility KIS sector index daily query contract regression tests.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const _realDataKisGet = vi.fn();
const _getKisOverrides = vi.fn();
const _refreshKisToken = vi.fn();
const _fetch = vi.fn();
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
  KIS_BASE: 'https://openapivts.koreainvestment.com:29443',
  KIS_IS_REAL: false,
  REAL_DATA_BASE: 'https://openapi.koreainvestment.com:9443',
}));

vi.mock('./auth.js', () => ({
  refreshKisToken: () => _refreshKisToken(),
  refreshRealDataToken: () => _refreshKisToken(),
  getKisTokenRemainingHours: () => 22,
  getRealDataTokenRemainingHours: () => 22,
}));

let mod: typeof import('./query.js');

beforeEach(async () => {
  vi.resetModules();
  _realDataKisGet.mockReset();
  _getKisOverrides.mockReset();
  _refreshKisToken.mockReset();
  _refreshKisToken.mockResolvedValue('test-token');
  _fetch.mockReset();
  vi.stubGlobal('fetch', _fetch);
  _getKisOverrides.mockReturnValue({});
  _HAS_REAL_DATA_CLIENT.value = false;
  delete process.env.KIS_SECTOR_INDEX_DAILY_ENABLED;
  delete process.env.KIS_SECTOR_INDEX_DAILY_TR_ID;
  delete process.env.KIS_SECTOR_INDEX_CURRENT_ENABLED;
  delete process.env.KIS_SECTOR_INDEX_CURRENT_TR_ID;
  delete process.env.KIS_SECTOR_INDEX_VERIFY_MODE;
  process.env.KIS_APP_KEY = 'test-key';
  process.env.KIS_APP_SECRET = 'test-secret';
  mod = await import('./query.js');
});

afterEach(() => {
  delete process.env.KIS_APP_KEY;
  delete process.env.KIS_APP_SECRET;
  delete process.env.KIS_SECTOR_INDEX_DAILY_ENABLED;
  delete process.env.KIS_SECTOR_INDEX_DAILY_TR_ID;
  delete process.env.KIS_SECTOR_INDEX_CURRENT_ENABLED;
  delete process.env.KIS_SECTOR_INDEX_CURRENT_TR_ID;
  delete process.env.KIS_SECTOR_INDEX_VERIFY_MODE;
  delete process.env.KIS_SECTOR_INDEX_VERIFY_SEND_DEBUG_VARIANTS;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('isKisSectorIndexDailyDisabled', () => {
  it('enables only exact true', () => {
    expect(mod.isKisSectorIndexDailyDisabled()).toBe(true);
    process.env.KIS_SECTOR_INDEX_DAILY_ENABLED = 'true';
    expect(mod.isKisSectorIndexDailyDisabled()).toBe(false);
    process.env.KIS_SECTOR_INDEX_DAILY_ENABLED = 'TRUE';
    expect(mod.isKisSectorIndexDailyDisabled()).toBe(true);
  });
});

describe('KIS_SECTOR_ISCD_MAP', () => {
  it('keeps 12 sectors and probe-verified FINANCE/IT codes', () => {
    expect(mod.KIS_SECTOR_ISCD_MAP).toHaveLength(12);
    expect(new Set(mod.KIS_SECTOR_ISCD_MAP.map((row) => row.sectorKey))).toHaveLength(12);
    for (const row of mod.KIS_SECTOR_ISCD_MAP) expect(row.iscd).toMatch(/^\d{4}$/);
    expect(mod.KIS_SECTOR_ISCD_MAP.find((row) => row.sectorKey === 'FINANCE')).toMatchObject({
      iscd: '0021',
      verified: true,
      source: 'KIS_ISCD_PROBE_VERIFIED_20260514',
    });
    expect(mod.KIS_SECTOR_ISCD_MAP.find((row) => row.sectorKey === 'IT_INTERNET')).toMatchObject({
      iscd: '0029',
      verified: true,
      source: 'KIS_ISCD_PROBE_VERIFIED_20260514',
    });
  });
});

describe('fetchKisSectorIndexDaily', () => {
  it('returns null when ENV is off', async () => {
    await expect(mod.fetchKisSectorIndexDaily('0001')).resolves.toBeNull();
    expect(_realDataKisGet).not.toHaveBeenCalled();
  });

  it('uses VTS override first', async () => {
    process.env.KIS_SECTOR_INDEX_DAILY_ENABLED = 'true';
    const mockResult = { sectorIscd: '0001', sectorName: '종합', currentIndex: 2700, changePct: 1.2, series: [], fetchedAt: '2026-05-14T03:00:00.000Z', source: 'KIS_API' as const };
    _getKisOverrides.mockReturnValue({ fetchKisSectorIndexDaily: vi.fn().mockResolvedValue(mockResult) });
    await expect(mod.fetchKisSectorIndexDaily('0001')).resolves.toEqual(mockResult);
    expect(_realDataKisGet).not.toHaveBeenCalled();
  });

  it('parses output1/output2 rows and calls the KIS sector index endpoint', async () => {
    process.env.KIS_SECTOR_INDEX_DAILY_ENABLED = 'true';
    _realDataKisGet.mockResolvedValue({
      output1: [{ hts_kor_isnm: '종합', bstp_nmix_prpr: '2700.50', bstp_nmix_prdy_ctrt: '1.23' }],
      output2: [
        { stck_bsop_date: '20260514', bstp_nmix_prpr: '2700.50', bstp_nmix_oprc: '2680.00', bstp_nmix_hgpr: '2710.00', bstp_nmix_lwpr: '2675.00', acml_vol: '500000000', acml_tr_pbmn: '8000000000000' },
        { stck_bsop_date: 'BADDATE', bstp_nmix_prpr: '999' },
      ],
    });

    const result = await mod.fetchKisSectorIndexDaily('0001');

    expect(result).toMatchObject({
      sectorIscd: '0001',
      sectorName: '종합',
      currentIndex: 2700.5,
      changePct: 1.23,
      source: 'KIS_API',
    });
    expect(result?.series).toHaveLength(1);
    expect(_realDataKisGet).toHaveBeenCalledOnce();
    const [trId, path, params] = _realDataKisGet.mock.calls[0];
    expect(trId).toBe('FHKUP03500100');
    expect(path).toBe('/uapi/domestic-stock/v1/quotations/inquire-daily-indexchartprice');
    expect(params.FID_COND_MRKT_DIV_CODE).toBe('U');
    expect(params.FID_INPUT_ISCD).toBe('0001');
    expect(params.FID_PERIOD_DIV_CODE).toBe('D');
  });

  it('returns null on provider throw', async () => {
    process.env.KIS_SECTOR_INDEX_DAILY_ENABLED = 'true';
    _realDataKisGet.mockRejectedValue(new Error('circuit open'));
    await expect(mod.fetchKisSectorIndexDaily('0001')).resolves.toBeNull();
  });
});

describe('fetchKisSectorIndexCurrentPrice', () => {
  it('returns null when ENV is off', async () => {
    await expect(mod.fetchKisSectorIndexCurrentPrice('0001')).resolves.toBeNull();
    expect(_realDataKisGet).not.toHaveBeenCalled();
  });

  it('uses VTS override first', async () => {
    process.env.KIS_SECTOR_INDEX_CURRENT_ENABLED = 'true';
    const mockResult = {
      sectorIscd: '0001',
      sectorName: 'KOSPI',
      currentIndex: 2700,
      changePct: 1.2,
      fetchedAt: '2026-05-23T00:00:00.000Z',
      source: 'KIS_API' as const,
      rawFieldKeys: ['bstp_nmix_prpr'],
    };
    _getKisOverrides.mockReturnValue({ fetchKisSectorIndexCurrentPrice: vi.fn().mockResolvedValue(mockResult) });
    await expect(mod.fetchKisSectorIndexCurrentPrice('0001')).resolves.toEqual(mockResult);
    expect(_realDataKisGet).not.toHaveBeenCalled();
  });

  it('calls the official current sector index endpoint and parses output', async () => {
    process.env.KIS_SECTOR_INDEX_CURRENT_ENABLED = 'true';
    _realDataKisGet.mockResolvedValue({
      output: [{ hts_kor_isnm: 'KOSPI', bstp_nmix_prpr: '2700.50', bstp_nmix_prdy_ctrt: '1.23' }],
    });

    const result = await mod.fetchKisSectorIndexCurrentPrice('0001');

    expect(result).toMatchObject({
      sectorIscd: '0001',
      sectorName: 'KOSPI',
      currentIndex: 2700.5,
      changePct: 1.23,
      source: 'KIS_API',
      rawFieldKeys: ['hts_kor_isnm', 'bstp_nmix_prpr', 'bstp_nmix_prdy_ctrt'],
    });
    const [trId, path, params] = _realDataKisGet.mock.calls[0];
    expect(trId).toBe('FHPUP02100000');
    expect(path).toBe('/uapi/domestic-stock/v1/quotations/inquire-index-price');
    expect(params.FID_COND_MRKT_DIV_CODE).toBe('U');
    expect(params.FID_INPUT_ISCD).toBe('0001');
  });
});

describe('fetchKisSectorIndexCurrentPriceProbe', () => {
  it('tries idx_code and idx_div+idx_code variants until one verifies', async () => {
    process.env.KIS_SECTOR_INDEX_CURRENT_ENABLED = 'true';
    _fetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ rt_cd: '1', msg_cd: 'INVALID', msg1: 'bad code', output: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        rt_cd: '0',
        msg_cd: 'MCA00000',
        msg1: 'OK',
        output: [{ hts_kor_isnm: 'chemical', bstp_nmix_prpr: '1234.56', bstp_nmix_prdy_ctrt: '1.2' }],
      }), { status: 200 }));

    const result = await mod.fetchKisSectorIndexCurrentPriceProbe(['0000', '80000', '8:0000', '8-0000']);

    expect(result).toMatchObject({
      verified: true,
      selectedInputIscd: '80000',
      currentIndex: 1234.56,
      reasonCode: 'VERIFY_SUCCESS',
      verifyVariantPolicy: {
        enabled: true,
        triedVariants: ['idxCode', 'idxDivCompact'],
        debugOnlyVariants: ['colon', 'hyphen'],
        colonHyphenSent: false,
      },
    });
    expect(result?.attempts).toHaveLength(2);
    expect(result?.attempts[0]).toMatchObject({
      fidCondMrktDivCode: 'U',
      fidInputIscd: '0000',
      method: 'GET',
      requestBuilt: true,
      requestSent: true,
      httpStatus: 200,
      transportStage: 'HTTP_RESPONSE_RECEIVED',
      rtCd: '1',
      msgCd: 'INVALID',
      msg1: 'bad code',
      reasonCode: 'KIS_INDEX_API_REJECTED_CODE',
      verified: false,
    });
    expect(result?.attempts[1]).toMatchObject({
      fidInputIscd: '80000',
      outputPresent: true,
      indexValueFieldPresent: true,
      indexValueFieldName: 'bstp_nmix_prpr',
      transportStage: 'VERIFY_SUCCESS',
      verified: true,
      reasonCode: 'VERIFY_SUCCESS',
    });
    expect(_fetch).toHaveBeenCalledTimes(2);
    expect(String(_fetch.mock.calls[1][0])).toContain('FID_COND_MRKT_DIV_CODE=U');
    expect(String(_fetch.mock.calls[1][0])).toContain('FID_INPUT_ISCD=80000');
    expect(_fetch.mock.calls[1][1]).toMatchObject({
      method: 'GET',
    });
  });

  it('reports schema mismatch when KIS succeeds but index value fields are absent', async () => {
    process.env.KIS_SECTOR_INDEX_CURRENT_ENABLED = 'true';
    _fetch.mockResolvedValue(new Response(JSON.stringify({
      rt_cd: '0',
      msg_cd: 'MCA00000',
      msg1: 'OK',
      output: [{ hts_kor_isnm: 'chemical', unknown_field: '123' }],
    }), { status: 200 }));

    const result = await mod.fetchKisSectorIndexCurrentPriceProbe(['0000']);

    expect(result).toMatchObject({
      verified: false,
      reasonCode: 'VERIFY_VARIANTS_EXHAUSTED',
      selectedFailureReason: 'KIS_INDEX_API_SCHEMA_MISMATCH',
    });
    expect(result?.attempts[0]).toMatchObject({
      fidInputIscd: '0000',
      rtCd: '0',
      msgCd: 'MCA00000',
      httpStatus: 200,
      outputPresent: true,
      indexValueFieldPresent: false,
      outputKeys: ['hts_kor_isnm', 'unknown_field'],
      transportStage: 'HTTP_RESPONSE_RECEIVED',
      reasonCode: 'KIS_INDEX_API_SCHEMA_MISMATCH',
    });
  });

  it('treats a finite zero index value as a schema-valid verify response', async () => {
    _fetch.mockResolvedValue(new Response(JSON.stringify({
      rt_cd: '0',
      msg_cd: 'MCA00000',
      msg1: 'OK',
      output: [{ hts_kor_isnm: 'chemical', bstp_nmix_prpr: '0.00' }],
    }), { status: 200 }));

    const result = await mod.fetchKisSectorIndexCurrentPriceProbe(['0000']);

    expect(result).toMatchObject({
      verified: true,
      selectedInputIscd: '0000',
      currentIndex: 0,
      reasonCode: 'VERIFY_SUCCESS',
    });
    expect(result?.attempts[0]).toMatchObject({
      indexValueFieldPresent: true,
      indexValueFieldName: 'bstp_nmix_prpr',
      currentIndex: 0,
      transportStage: 'VERIFY_SUCCESS',
      reasonCode: 'VERIFY_SUCCESS',
    });
  });

  it('separates client disabled before request transport', async () => {
    process.env.KIS_SECTOR_INDEX_CURRENT_ENABLED = 'false';
    const result = await mod.fetchKisSectorIndexCurrentPriceProbe(['0000']);

    expect(result).toMatchObject({
      verified: false,
      selectedFailureReason: 'KIS_INDEX_API_CLIENT_DISABLED',
      clientStatus: {
        enabled: false,
        verifyMode: 'OBSERVE',
        livePromotionFromVerify: false,
        authReady: false,
        canCall: false,
        disabledReason: 'KIS_SECTOR_INDEX_CURRENT_ENABLED_FALSE',
      },
    });
    expect(result?.attempts[0]).toMatchObject({
      requestBuilt: false,
      requestSent: false,
      transportStage: 'CLIENT_DISABLED',
      reasonCode: 'KIS_INDEX_API_CLIENT_DISABLED',
      httpStatus: null,
    });
    expect(_fetch).not.toHaveBeenCalled();
  });

  it('enables the verify probe by default in observe mode and sends a request when auth is ready', async () => {
    _fetch.mockResolvedValue(new Response(JSON.stringify({
      rt_cd: '1',
      msg_cd: 'INVALID',
      msg1: 'bad code',
      output: [],
    }), { status: 200 }));

    const result = await mod.fetchKisSectorIndexCurrentPriceProbe(['0000']);

    expect(result).toMatchObject({
      verified: false,
      selectedFailureReason: 'KIS_INDEX_API_REJECTED_CODE',
      clientStatus: {
        enabled: true,
        verifyMode: 'OBSERVE',
        livePromotionFromVerify: false,
        authReady: true,
        tokenPresent: true,
        tokenProvider: 'KIS_SHARED_TOKEN_PROVIDER',
        canCall: true,
      },
    });
    expect(result?.attempts[0]).toMatchObject({
      requestBuilt: true,
      requestSent: true,
      transportStage: 'HTTP_RESPONSE_RECEIVED',
      reasonCode: 'KIS_INDEX_API_REJECTED_CODE',
    });
    expect(_fetch).toHaveBeenCalledTimes(1);
  });

  it('separates auth-not-ready before sending a request', async () => {
    delete process.env.KIS_APP_SECRET;

    const result = await mod.fetchKisSectorIndexCurrentPriceProbe(['0000']);

    expect(result).toMatchObject({
      selectedFailureReason: 'KIS_INDEX_API_AUTH_ERROR',
      clientStatus: {
        enabled: true,
        verifyMode: 'OBSERVE',
        authReady: false,
        canCall: false,
        disabledReason: 'KIS_APP_KEY_OR_SECRET_MISSING',
      },
    });
    expect(result?.attempts[0]).toMatchObject({
      requestBuilt: false,
      requestSent: false,
      transportStage: 'AUTH_NOT_READY',
      reasonCode: 'KIS_INDEX_API_AUTH_ERROR',
    });
    expect(_fetch).not.toHaveBeenCalled();
  });

  it('captures timeout transport failures with sanitized exception detail', async () => {
    process.env.KIS_SECTOR_INDEX_CURRENT_ENABLED = 'true';
    _fetch.mockRejectedValue(Object.assign(new Error('operation aborted after timeout token=SECRET'), { name: 'AbortError' }));

    const result = await mod.fetchKisSectorIndexCurrentPriceProbe(['0000']);

    expect(result).toMatchObject({
      selectedFailureReason: 'KIS_INDEX_API_TIMEOUT',
    });
    expect(result?.attempts[0]).toMatchObject({
      requestBuilt: true,
      requestSent: true,
      transportStage: 'TIMEOUT',
      reasonCode: 'KIS_INDEX_API_TIMEOUT',
      exceptionClass: 'AbortError',
    });
    expect(result?.attempts[0]?.exceptionMessageSanitized).toContain('token=<masked>');
  });
});
