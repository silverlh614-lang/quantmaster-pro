import { describe, expect, it } from 'vitest';
import {
  detectKisOfficialQuoteDrift,
  normalizeKisOfficialQuotePayload,
} from './kisOfficialQuoteMapper.js';

function kisPricePayload(overrides: Record<string, string> = {}) {
  return {
    rt_cd: '0',
    msg_cd: 'MCA00000',
    output: {
      stck_prpr: '73500',
      stck_oprc: '73000',
      stck_hgpr: '74000',
      stck_lwpr: '72800',
      prdy_vrss: '500',
      prdy_ctrt: '0.68',
      acml_vol: '12345678',
      acml_tr_pbmn: '901234567000',
      stck_sdpr: '73000',
      ...overrides,
    },
  };
}

describe('KIS official inquire-price quote mapper', () => {
  it('normalizes official KIS quote fields into QMP quote coverage', () => {
    const coverage = normalizeKisOfficialQuotePayload(kisPricePayload(), {
      symbol: '005930',
      marketDivCode: 'J',
      fetchedAt: '2026-05-19T09:31:00+09:00',
    });

    expect(coverage.normalizedQuote).toMatchObject({
      symbol: '005930',
      currentPrice: 73500,
      price: 73500,
      open: 73000,
      high: 74000,
      low: 72800,
      change: 500,
      changePercent: 0.68,
      volume: 12345678,
      tradingValue: 901234567000,
      provider: 'KIS_OFFICIAL',
      providerStatus: 'OK_WITH_DATA',
      dataConfidence: 'VERIFIED',
      marketDivCode: 'J',
    });
    expect(coverage.allRequiredFieldsPresent).toBe(true);
    expect(coverage.providerStatus).toBe('OK_WITH_DATA');
    expect(coverage.confidence).toBe('VERIFIED');
    expect(coverage.marketSignal).toBe(false);
  });

  it('classifies successful empty KIS output as missing coverage without market signal', () => {
    const coverage = normalizeKisOfficialQuotePayload({
      rt_cd: '0',
      msg_cd: 'MCA00000',
      output: {},
    });

    expect(coverage.providerStatus).toBe('OK_EMPTY');
    expect(coverage.confidence).toBe('MISSING');
    expect(coverage.providerIssue).toBe(false);
    expect(coverage.marketSignal).toBe(false);
    expect(coverage.executionImpact).toBe('DIAGNOSTIC_ONLY');
  });

  it('marks required official quote fields missing without making a bearish signal', () => {
    const coverage = normalizeKisOfficialQuotePayload(kisPricePayload({
      stck_prpr: '',
      acml_vol: '',
    }));

    expect(coverage.providerStatus).toBe('FIELD_MISSING');
    expect(coverage.missingFields).toEqual(expect.arrayContaining(['currentPrice', 'volume']));
    expect(coverage.allRequiredFieldsPresent).toBe(false);
    expect(coverage.marketSignal).toBe(false);
  });

  it('records official endpoint drift but does not auto-replace provider config', () => {
    const drift = detectKisOfficialQuoteDrift({
      path: '/uapi/domestic-stock/v1/quotations/wrong-price',
      trId: 'WRONG_TR_ID',
    });

    expect(drift).toMatchObject({
      type: 'KIS_OFFICIAL_DRIFT_DETECTED',
      api: 'INQUIRE_PRICE',
      expectedPath: '/uapi/domestic-stock/v1/quotations/inquire-price',
      actualPath: '/uapi/domestic-stock/v1/quotations/wrong-price',
      expectedTrId: 'FHKST01010100',
      actualTrId: 'WRONG_TR_ID',
      action: 'DO_NOT_AUTO_REPLACE_REQUIRE_REVIEW',
    });
  });
});
