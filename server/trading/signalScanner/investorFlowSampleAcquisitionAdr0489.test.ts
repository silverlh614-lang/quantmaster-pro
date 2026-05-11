import { describe, expect, it } from 'vitest';
import { buildInvestorFlowSampleAcquisitionReportAdr0489, materializeKisInvestorFlowSampleAdr0489 } from './investorFlowSampleAcquisitionAdr0489.js';

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

  it('materializes KIS investor_trade_by_stock_daily as VERIFIED symbol-level shadow sample', () => {
    const sample = materializeKisInvestorFlowSampleAdr0489({
      symbol: '005930',
      investorTradeByStockDaily: { tradingDate: '2026-05-11', foreignNetBuy: 10, institutionalNetBuy: 20, individualNetBuy: -30 },
      marketSupply: { foreignNetBuy: 999, institutionNetBuy: 999 },
    });

    expect(sample).toMatchObject({
      symbol: '005930',
      provider: 'KIS_API',
      sourceDate: '2026-05-11',
      foreignNetBuy: 10,
      institutionNetBuy: 20,
      individualNetBuy: -30,
      confidence: 'HIGH',
      status: 'SAMPLE_READY',
    });
    expect(sample?.diagnostics?.join(' ')).toContain('VERIFIED');
  });

  it('materializes KIS foreign_institution_total as DEGRADED without fake-zero individual flow', () => {
    const sample = materializeKisInvestorFlowSampleAdr0489({
      symbol: '005930',
      foreignInstitutionTotal: { foreignNetBuy: 100, institutionalNetBuy: -50 },
    });

    expect(sample?.foreignNetBuy).toBe(100);
    expect(sample?.institutionNetBuy).toBe(-50);
    expect(sample?.individualNetBuy).toBeNull();
    expect(sample?.confidence).toBe('MEDIUM');
    expect(sample?.status).toBe('SAMPLE_READY');
    expect(sample?.diagnostics?.join(' ')).toContain('DEGRADED');
  });

  it('does not disguise marketSupply or estimate-only KIS data as selected symbol samples', () => {
    expect(materializeKisInvestorFlowSampleAdr0489({ symbol: '005930', marketSupply: { foreignNetBuy: 1 } })).toBeNull();

    const estimate = materializeKisInvestorFlowSampleAdr0489({
      symbol: '005930',
      investorTrendEstimate: { foreignNetBuyEstimate: 1, institutionalNetBuyEstimate: 2 },
    });
    expect(estimate?.status).toBe('DATA_UNAVAILABLE');
    expect(estimate?.confidence).toBe('LOW');
    expect(estimate?.diagnostics?.join(' ')).toContain('ESTIMATED/advisory only');
  });

  it('keeps UNKNOWN diagnostic-only rather than converting it bullish or bearish', () => {
    const report = buildInvestorFlowSampleAcquisitionReportAdr0489({ samples: [{ symbol: '000000', provider: 'CACHE' }] });
    expect(report.status).toBe('DATA_UNAVAILABLE');
    expect(report.samples[0]?.signal).toBe('UNKNOWN');
    expect(report.selectedSample).toBeNull();
  });
});
