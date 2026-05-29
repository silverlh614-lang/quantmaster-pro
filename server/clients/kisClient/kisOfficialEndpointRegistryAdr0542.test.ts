// @responsibility ADR-0542 registry 드리프트 정정 검증 — investor-trade-by-stock-daily outputBuckets SSOT 정합.
import { describe, expect, it } from 'vitest';
import { KIS_OFFICIAL_ENDPOINTS } from './kisOfficialEndpointRegistry.js';

describe('kisOfficialEndpointRegistry — ADR-0542 outputBuckets 정합', () => {
  it('investorTradeByStockDaily outputBuckets 가 output1/output2 를 선언 (공식 spec 정합)', () => {
    const spec = KIS_OFFICIAL_ENDPOINTS.investorTradeByStockDaily;
    expect(spec.trId).toBe('FHPTJ04160001');
    expect(spec.outputBuckets).toContain('output1');
    expect(spec.outputBuckets).toContain('output2');
    expect(spec.executionImpact).toBe('NONE');
    expect(spec.providerIssueMeansMarketSignal).toBe(false);
  });

  it('investorTrendEstimate 는 ADR-0543 분리 대상 — 본 PR 미수정 (ESTIMATED/L4 보존)', () => {
    const spec = KIS_OFFICIAL_ENDPOINTS.investorTrendEstimate;
    expect(spec.confidenceClass).toBe('ESTIMATED');
    // ADR-0543 에서 정정 예정 — 본 PR 은 requiredParams 손대지 않음.
    expect(spec.requiredParams).toEqual(['FID_COND_MRKT_DIV_CODE', 'FID_INPUT_ISCD']);
  });
});
