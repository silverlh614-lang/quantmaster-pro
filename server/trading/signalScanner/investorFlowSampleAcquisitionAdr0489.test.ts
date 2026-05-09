import { describe, expect, it } from 'vitest';
import { buildInvestorFlowSampleAcquisitionReportAdr0489 } from './investorFlowSampleAcquisitionAdr0489.js';

describe('ADR-0489 investor flow sample acquisition', () => {
  it('builds sanitized diagnostic-only semantic samples without raw payload persistence', () => {
    const report = buildInvestorFlowSampleAcquisitionReportAdr0489({
      generatedAt: '2026-05-09T00:00:00.000Z',
      samples: [{ symbol: '005930', provider: 'NAVER', foreignNetBuy: 10, institutionNetBuy: -2 }],
    });
    expect(report.status).toBe('SAMPLE_READY');
    expect(report.selectedSample?.signal).toBe('BULLISH');
    expect(report.executionImpact).toBe('NONE');
    expect(report.liveExecutionAllowed).toBe(false);
    expect(report.policyPromotionMode).toBe('OBSERVE');
    expect(report.operatorApprovalRequired).toBe(true);
    expect(report.rawPayloadPersistenceAllowed).toBe(false);
  });

  it('keeps UNKNOWN diagnostic-only rather than converting it bullish or bearish', () => {
    const report = buildInvestorFlowSampleAcquisitionReportAdr0489({ samples: [{ symbol: '000000', provider: 'CACHE' }] });
    expect(report.status).toBe('DATA_UNAVAILABLE');
    expect(report.samples[0]?.signal).toBe('UNKNOWN');
    expect(report.selectedSample).toBeNull();
  });
});
