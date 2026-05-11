import fs from 'fs';
import { describe, expect, it } from 'vitest';
import {
  buildInvestorFlowSanitizedSampleAdr0496,
  buildSupplyCoverageReportAdr0496,
  normalizeSemanticNetBuyAdr0496,
} from './investorFlowSemanticNetBuyAdr0496.js';
import { buildInvestorFlowSampleAcquisitionReportAdr0489 } from './investorFlowSampleAcquisitionAdr0489.js';
import {
  buildPromotionAuditInputForDataLineAdr0494,
  evaluateFreshDataPromotionAuditsAdr0494,
} from './freshDataPromotionAuditWiringAdr0494.js';

describe('ADR-0496 investor flow semantic net-buy normalization', () => {
  it('sanitized_sample_preserves_null_and_zero', () => {
    const sample = buildInvestorFlowSanitizedSampleAdr0496({
      sampleId: 's1',
      provider: 'NAVER',
      foreignNetBuy: null,
      institutionNetBuy: 0,
      retailNetBuy: 10,
    });
    expect(sample.foreignNetBuy).toBeNull();
    expect(sample.institutionNetBuy).toBe(0);
    const semantic = normalizeSemanticNetBuyAdr0496(sample);
    expect(semantic.foreignDirection).toBe('UNKNOWN');
    expect(semantic.institutionDirection).toBe('NEUTRAL');
    expect(semantic.nullZeroSeparationPassed).toBe(true);
  });

  it('provider_error_is_not_market_signal', () => {
    const sample = buildInvestorFlowSanitizedSampleAdr0496({ provider: 'NAVER', status: 'PROVIDER_ERROR', providerError: true });
    expect(sample.isProviderIssue).toBe(true);
    expect(sample.isMarketSignal).toBe(false);
    expect(sample.liveExecutionAllowed).toBe(false);
    expect(sample.executionImpact).toBe('NONE');
  });

  it('semantic_net_buy_unknown_is_not_bearish', () => {
    const sample = buildInvestorFlowSanitizedSampleAdr0496({ provider: 'CACHE', status: 'UNKNOWN' });
    const semantic = normalizeSemanticNetBuyAdr0496(sample);
    expect(sample.isProviderIssue).toBe(false);
    expect(semantic.foreignDirection).toBe('UNKNOWN');
    expect(semantic.institutionDirection).toBe('UNKNOWN');
    expect(semantic.retailDirection).toBe('UNKNOWN');
    expect(semantic.confluence).toBe('UNKNOWN');
    expect(semantic.providerIssueIsMarketSignal).toBe(false);
  });

  it('semantic_net_buy_detects_foreign_institution_confluence', () => {
    const semantic = normalizeSemanticNetBuyAdr0496(buildInvestorFlowSanitizedSampleAdr0496({
      foreignNetBuy: 100,
      institutionNetBuy: 50,
      retailNetBuy: -20,
    }));
    expect(semantic.confluence).toBe('FOREIGN_INSTITUTION_BOTH_BUY');
  });

  it('semantic_net_sell_does_not_trigger_live_sell', () => {
    const semantic = normalizeSemanticNetBuyAdr0496(buildInvestorFlowSanitizedSampleAdr0496({
      foreignNetBuy: -100,
      institutionNetBuy: -50,
      retailNetBuy: 0,
    }));
    expect(semantic.foreignDirection).toBe('NET_SELL');
    expect(semantic.liveExecutionAllowed).toBe(false);
    expect(semantic.executionImpact).toBe('NONE');
  });

  it('supply_coverage_after_can_increase_without_live_effect', () => {
    const sample = buildInvestorFlowSanitizedSampleAdr0496({ foreignNetBuy: 0, institutionNetBuy: 1, retailNetBuy: null });
    const semantic = normalizeSemanticNetBuyAdr0496(sample);
    const report = buildSupplyCoverageReportAdr0496({ samples: [sample], semanticSamples: [semantic], coverageBefore: 0 });
    expect(report.coverageAfter).toBeGreaterThan(0);
    expect(report.normalizedSampleCount).toBe(1);
    expect(report.semanticNetBuyCount).toBe(1);
    expect(report.rawCount).toBe(1);
    expect(report.normalizedCount).toBe(1);
    expect(report.materializedCount).toBe(1);
    expect(report.routerUsableCount).toBe(2);
    expect(report.liveExecutionAllowed).toBe(false);
    expect(report.executionImpact).toBe('NONE');
    expect(report.marketSignalCount).toBe(0);
  });

  it('semantic placeholder count is separated from materialized normalized count', () => {
    const sample = buildInvestorFlowSanitizedSampleAdr0496({ provider: 'CACHE', status: 'UNKNOWN' });
    const placeholder = {
      ...normalizeSemanticNetBuyAdr0496(sample),
      normalized: false,
    };
    const report = buildSupplyCoverageReportAdr0496({ samples: [sample], semanticSamples: [placeholder] });

    expect(report.semanticPlaceholderCount).toBe(1);
    expect(report.semanticNetBuyCount).toBe(0);
    expect(report.normalizedSampleCount).toBe(0);
    expect(report.routerUsableCount).toBe(0);
    expect(report.providerIssueCount).toBe(0);
    expect(report.marketSignalCount).toBe(0);
  });

  it('semantic materialized normalized output contributes to semantic and normalized counts', () => {
    const sample = buildInvestorFlowSanitizedSampleAdr0496({ provider: 'NAVER', status: 'FRESH', foreignNetBuy: null, institutionNetBuy: null, retailNetBuy: null });
    const semantic = normalizeSemanticNetBuyAdr0496(sample);
    const report = buildSupplyCoverageReportAdr0496({ samples: [sample], semanticSamples: [semantic] });

    expect(report.semanticNetBuyCount).toBe(1);
    expect(report.normalizedSampleCount).toBeGreaterThanOrEqual(report.semanticNetBuyCount);
    expect(report.routerUsableSampleCount).toBeGreaterThanOrEqual(1);
    expect(report.providerIssueCount).toBe(0);
  });

  it('raw_payload_not_persisted', () => {
    const rawInput = { rawPayload: { secret: 'provider-json' }, foreignNetBuy: 1 };
    const sample = buildInvestorFlowSanitizedSampleAdr0496(rawInput);
    expect(JSON.stringify(sample)).not.toContain('provider-json');
    expect(sample.rawPayloadPersistenceAllowed).toBe(false);
  });

  it('adr0489_uses_adr0496_normalization', () => {
    const report = buildInvestorFlowSampleAcquisitionReportAdr0489({
      samples: [{ symbol: '005930', provider: 'NAVER', foreignNetBuy: 1, institutionNetBuy: 2, programNetBuy: null }],
    });
    expect(report.adr0496SanitizedSamples).toHaveLength(1);
    expect(report.adr0496SemanticNetBuySamples[0]?.confluence).toBe('FOREIGN_INSTITUTION_BOTH_BUY');
    expect(report.adr0496SupplyCoverage.semanticNetBuyCount).toBe(1);
  });

  it('adr0494_investor_flow_audit_uses_adr0496_evidence', () => {
    const report = buildInvestorFlowSampleAcquisitionReportAdr0489({
      samples: [{ symbol: '005930', provider: 'NAVER', foreignNetBuy: 0, institutionNetBuy: null, programNetBuy: null }],
    });
    const input = buildPromotionAuditInputForDataLineAdr0494({ sourceType: 'INVESTOR_FLOW', report });
    expect(input.totalSnapshots).toBe(report.adr0496SupplyCoverage.sampleCount);
    expect(input.shadowContributionScore).toBe(report.adr0496SupplyCoverage.coverageAfter);
    expect(input.providerMarketSignalMixedCount).toBe(0);
    expect(input.nullZeroSeparationPassed).toBe(true);
  });

  it('promotion_remains_blocked_without_history', () => {
    const report = buildInvestorFlowSampleAcquisitionReportAdr0489({
      samples: [{ symbol: '005930', provider: 'NAVER', foreignNetBuy: 10, institutionNetBuy: 5, programNetBuy: null }],
    });
    const input = buildPromotionAuditInputForDataLineAdr0494({ sourceType: 'INVESTOR_FLOW', report, tradingDaysObserved: 0 });
    const [audit] = evaluateFreshDataPromotionAuditsAdr0494([input], { store: null });
    expect(audit.result.decision).toBe('KEEP_CURRENT_STAGE');
    expect(audit.result.recommendedStage).toBe(input.currentStage);
  });

  it('no_gate_kelly_order_changes', () => {
    const source = fs.readFileSync('server/trading/signalScanner/investorFlowSemanticNetBuyAdr0496.ts', 'utf-8');
    expect(source).not.toMatch(/(^import .*kis)|(placeOrder|createLiveOrder|executeOrder|setLiveGate|mutateGate|kelly|strongBuyUnlock|sectorBoostAllowed|supplyBoostAllowed)/im);
  });

  it('execution_impact_none', () => {
    const sample = buildInvestorFlowSanitizedSampleAdr0496({ status: 'PROVIDER_ERROR', providerError: true });
    const semantic = normalizeSemanticNetBuyAdr0496(sample);
    const report = buildSupplyCoverageReportAdr0496({ samples: [sample], semanticSamples: [semantic] });
    expect(sample.executionImpact).toBe('NONE');
    expect(semantic.executionImpact).toBe('NONE');
    expect(report.executionImpact).toBe('NONE');
  });
});
