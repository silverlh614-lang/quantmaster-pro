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

describe('KIS endpoint trace semantic classification', () => {
  beforeEach(() => {
    vi.resetModules();
    _realDataKisGet.mockReset();
    _HAS_REAL_DATA_CLIENT.value = true;
    process.env.KIS_APP_KEY = 'test-key';
  });

  it('classifies FHKST01010300 quote-like output as diagnostic only', async () => {
    const { diagnoseKisInvestorEndpointTraces } = await import('./supplyDiagnostics.js');
    _realDataKisGet.mockImplementation(async (trId: string) => {
      if (trId === 'FHKST01010300') {
        return { rt_cd: '0', msg_cd: 'MCA00000', output: { stck_cntg_hour: '090001', stck_prpr: '1000', cntg_vol: '10' } };
      }
      return { rt_cd: '0', msg_cd: 'MCA00000', output: [] };
    });

    const traces = await diagnoseKisInvestorEndpointTraces('005930');
    const inquire = traces.find((trace) => trace.sourceKind === 'INQUIRE_INVESTOR');

    expect(inquire?.blockedReason).toBe('QUOTE_LIKE_OUTPUT');
    expect(inquire?.materialized).toBe(false);
    expect(inquire?.parsedFields).toEqual([]);
  });

  it('classifies OPSQ2001 as PARAM_ERROR and uses non-blank investor daily params', async () => {
    const { diagnoseKisInvestorEndpointTraces } = await import('./supplyDiagnostics.js');
    _realDataKisGet.mockImplementation(async (trId: string) => {
      if (trId === 'FHPTJ04160001') return { rt_cd: '2', msg_cd: 'OPSQ2001', msg1: 'invalid request' };
      return { rt_cd: '0', msg_cd: 'MCA00000', output: [] };
    });

    const traces = await diagnoseKisInvestorEndpointTraces('005930');
    const daily = traces.find((trace) => trace.sourceKind === 'INVESTOR_TRADE_BY_STOCK_DAILY');

    expect(daily?.blockedReason).toBe('PARAM_ERROR');
    expect(daily?.params.FID_ORG_ADJ_PRC).toBe('0');
    expect(daily?.params.FID_ETC_CLS_CODE).toBe('0');
    expect(daily?.msg1).toBe('invalid request');
  });

  it('maps short sale alternate KIS field names instead of reporting FIELD_MISSING', async () => {
    const { diagnoseKisShortSaleDateTraces } = await import('./supplyDiagnostics.js');
    _realDataKisGet.mockResolvedValue({
      rt_cd: '0',
      msg_cd: 'MCA00000',
      output: { stck_bsop_date: '20260508', shts_cntg_qty: '10', shts_tr_pbmn: '10000', stss_rate: '1.5' },
    });

    const [trace] = await diagnoseKisShortSaleDateTraces('005930', ['2026-05-08']);

    expect(trace.blockedReason).toBe('MATERIALIZED');
    expect(trace.parsedFields).toEqual(['shortSaleQty', 'shortSaleAmount', 'shortSaleRatio']);
    expect(trace.outputKeys).toContain('shts_cntg_qty');
  });

  it('reports all output buckets and selects investor output2 over quote-like output1', async () => {
    const { diagnoseKisInvestorEndpointTraces } = await import('./supplyDiagnostics.js');
    _realDataKisGet.mockImplementation(async (trId: string) => {
      if (trId === 'FHPTJ04160001') {
        return {
          rt_cd: '0',
          msg_cd: 'MCA00000',
          output1: [{ stck_prpr: '1000', prdy_vrss: '1', prdy_vrss_sign: '2', prdy_ctrt: '0.1', acml_vol: '10' }],
          output2: [{ stck_bsop_date: '20260508', frgn_ntby_qty: '1', orgn_ntby_qty: '2', prsn_ntby_qty: '-3' }],
        };
      }
      return { rt_cd: '0', msg_cd: 'MCA00000', output: [] };
    });

    const traces = await diagnoseKisInvestorEndpointTraces('005930');
    const daily = traces.find((trace) => trace.sourceKind === 'INVESTOR_TRADE_BY_STOCK_DAILY');

    expect(daily?.blockedReason).toBe('MATERIALIZED');
    expect(daily?.selectedBucket).toBe('output2');
    expect(daily?.rootKeys).toEqual(expect.arrayContaining(['rt_cd', 'msg_cd', 'output1', 'output2']));
    expect(daily?.output1Keys).toContain('stck_prpr');
    expect(daily?.output2Keys).toContain('frgn_ntby_qty');
  });

  it('diagnoses investor daily quote-like output1 without output2 as NO_INVESTOR_BUCKET', async () => {
    const { diagnoseKisInvestorEndpointTraces } = await import('./supplyDiagnostics.js');
    _realDataKisGet.mockImplementation(async (trId: string) => {
      if (trId === 'FHPTJ04160001') {
        return {
          rt_cd: '0',
          msg_cd: 'MCA00000',
          output1: [{ stck_prpr: '1000', prdy_vrss: '1', prdy_vrss_sign: '2', prdy_ctrt: '0.1', acml_vol: '10' }],
        };
      }
      return { rt_cd: '0', msg_cd: 'MCA00000', output: [] };
    });

    const traces = await diagnoseKisInvestorEndpointTraces('005930');
    const daily = traces.find((trace) => trace.sourceKind === 'INVESTOR_TRADE_BY_STOCK_DAILY');

    expect(daily?.blockedReason).toBe('NO_INVESTOR_BUCKET');
    expect(daily?.selectedBucket).toBe('output1');
    expect(daily?.output2Length).toBe(0);
  });

  it('reports short output2 selection separately from quote-like output1', async () => {
    const { diagnoseKisShortSaleDateTraces } = await import('./supplyDiagnostics.js');
    _realDataKisGet.mockResolvedValue({
      rt_cd: '0',
      msg_cd: 'MCA00000',
      output1: [{ stck_prpr: '1000', prdy_vrss: '1', prdy_vrss_sign: '2', prdy_ctrt: '0.1', acml_vol: '10' }],
      output2: [{ stck_bsop_date: '20260508', ssts_cntg_qty: '10', ssts_tr_pbmn: '10000', ssts_tr_pbmn_rlim: '1.5' }],
    });

    const [trace] = await diagnoseKisShortSaleDateTraces('005930', ['2026-05-08']);

    expect(trace.blockedReason).toBe('MATERIALIZED');
    expect(trace.selectedBucket).toBe('output2');
    expect(trace.output1Keys).toContain('stck_prpr');
    expect(trace.output2Keys).toContain('ssts_cntg_qty');
  });

});
