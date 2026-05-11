// @responsibility KIS raw supply diagnostic reason split tests.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const _realDataKisGet = vi.fn();
const _HAS_REAL_DATA_CLIENT = { value: true };

vi.mock('./http.js', () => ({
  realDataKisGet: (trId: string, path: string, params: Record<string, string>, priority?: string) =>
    _realDataKisGet(trId, path, params, priority),
}));

vi.mock('./constants.js', () => ({
  get HAS_REAL_DATA_CLIENT() { return _HAS_REAL_DATA_CLIENT.value; },
}));

describe('diagnoseKisStockProgramRaw reason split', () => {
  beforeEach(() => {
    vi.resetModules();
    _realDataKisGet.mockReset();
    _HAS_REAL_DATA_CLIENT.value = true;
    process.env.KIS_APP_KEY = 'test-key';
  });

  it.each([
    ['OUTPUT_EMPTY', { rt_cd: '0', msg_cd: 'OTHER_OK', output: [] }],
    ['ACCEPTED_EMPTY', { rt_cd: '0', msg_cd: 'MCA00000', output: [] }],
    ['FIELD_MISSING', { rt_cd: '0', msg_cd: '0', output: { stck_prpr: '1000' } }],
    ['SESSION_UNAVAILABLE', { rt_cd: '1', msg_cd: 'EGW00123', msg1: 'token expired', output: [] }],
    ['PARAM_ERROR', { rt_cd: '1', msg_cd: 'OPSQ2001', msg1: 'ERROR INVALID FID_COND_MRKT_DIV_CODE' }],
    ['PROVIDER_ERROR', { rt_cd: '1', msg_cd: 'KIS99999', msg1: 'temporary provider failure' }],
  ])('classifies %s separately', async (expected, payload) => {
    const { diagnoseKisStockProgramRaw } = await import('./supplyDiagnostics.js');
    _realDataKisGet.mockResolvedValue(payload);

    const diag = await diagnoseKisStockProgramRaw('005930');

    expect(diag.zeroReason).toBe(expected);
  });
});
