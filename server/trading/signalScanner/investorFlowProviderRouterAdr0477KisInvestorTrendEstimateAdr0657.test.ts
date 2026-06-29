// @responsibility ADR-0657 KIS estimate SHADOW-only fallback router wiring regression (4 cases).
import { afterEach, describe, expect, it } from 'vitest';
import { buildInvestorFlowProviderRouteResultAdr0477 } from './investorFlowProviderRouterAdr0477.js';
import type { InvestorFlowRouterInputWithEstimateAdr0657 } from './investorFlowProviderRouterAdr0477/kisInvestorTrendEstimateAdapterAdr0657.js';

const FLAG = 'KIS_INVESTOR_TREND_ESTIMATE_SHADOW_FALLBACK_ENABLED';

function withFlag(value: 'true' | 'false' | undefined, fn: () => void): void {
  const prev = process.env[FLAG];
  if (value === undefined) delete process.env[FLAG];
  else process.env[FLAG] = value;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env[FLAG];
    else process.env[FLAG] = prev;
  }
}

// 일별 미정산(shadow-only) 행 — KIS daily(FHPTJ04160001) raw 미공급 + estimate 가용.
function dailyUnsettledInputWithEstimate(): InvestorFlowRouterInputWithEstimateAdr0657 {
  return {
    code: '005930',
    collectedAt: '2026-06-29T00:26:00.000Z',
    kisInvestorRaw: null,
    kisTriedForInvestorFlow: true,
    kisInvestorTrendEstimateAdr0657: {
      foreignNetBuyEstimate: 12000,
      institutionalNetBuyEstimate: -3400,
      individualNetBuyEstimate: -8600,
      confidence: 'ESTIMATED',
      useScope: 'SHADOW_ONLY',
      sourceDate: '2026-06-29',
    },
  };
}

// 일별 정산(materialized) 행 — KIS daily raw 공급(VERIFIED) + estimate 도 가용.
function dailySettledInputWithEstimate(): InvestorFlowRouterInputWithEstimateAdr0657 {
  return {
    code: '005930',
    collectedAt: '2026-06-29T00:26:00.000Z',
    kisInvestorRaw: {
      symbol: '005930',
      sourceDate: '2026-06-27',
      frgn_ntby_tr_pbmn: '1,234',
      orgn_ntby_tr_pbmn: '-2,000',
      indv_ntby_tr_pbmn: '766',
    },
    kisTriedForInvestorFlow: true,
    kisInvestorTrendEstimateAdr0657: {
      foreignNetBuyEstimate: 99999,
      institutionalNetBuyEstimate: 88888,
      individualNetBuyEstimate: -188887,
      confidence: 'ESTIMATED',
      useScope: 'SHADOW_ONLY',
      sourceDate: '2026-06-29',
    },
  };
}

describe('ADR-0657 KIS investor-trend estimate SHADOW-only fallback router wiring', () => {
  afterEach(() => {
    delete process.env[FLAG];
  });

  it('1. OFF = byte-identical (chain + result identical; estimate fields unset; selectedProvider unchanged)', () => {
    const offUnset = withFlagResult(undefined, dailyUnsettledInputWithEstimate);
    const offFalse = withFlagResult('false', dailyUnsettledInputWithEstimate);

    // estimate must be fully unrecognized in chain
    expect(offUnset.providerTried).not.toContain('KIS_INVESTOR_TREND_ESTIMATE');
    expect(offFalse.providerTried).not.toContain('KIS_INVESTOR_TREND_ESTIMATE');
    // additive result fields stay unset (undefined) — byte-identical
    expect(offUnset.estimateShadowFallbackUsed).toBeUndefined();
    expect(offUnset.estimateProvider).toBeUndefined();
    expect(offUnset.estimateUseScope).toBeUndefined();
    expect(offUnset.estimateConfidence).toBeUndefined();
    // OFF unset vs OFF =false produce identical serialization
    expect(JSON.stringify(offUnset)).toBe(JSON.stringify(offFalse));
    // estimate sample must not leak into provider statuses
    expect(offUnset.providerStatuses.KIS_INVESTOR_TREND_ESTIMATE).toBeUndefined();
    expect(offUnset.selectedProvider).not.toBe('KIS_INVESTOR_TREND_ESTIMATE');
  });

  it('2. ON + daily settled = daily primary, estimate NOT used (ADR-0561)', () => {
    withFlag('true', () => {
      const route = buildInvestorFlowProviderRouteResultAdr0477(dailySettledInputWithEstimate());
      expect(route.selectedProvider).toBe('KIS_API');
      expect(route.estimateShadowFallbackUsed).toBe(false);
      expect(route.estimateProvider).toBeNull();
      expect(route.estimateConfidence).toBe('NONE');
      // estimate value must never override the daily semantic row
      expect(route.semanticRow?.foreignNetBuy).toBe(1234);
      expect(route.providerStatuses.KIS_INVESTOR_TREND_ESTIMATE).toBeUndefined();
      // chain shows estimate step but it was not promoted
      expect(route.providerTried).toContain('KIS_INVESTOR_TREND_ESTIMATE');
    });
  });

  it('3. ON + daily unsettled + estimate available = row filled (SHADOW_ONLY_ESTIMATE/LOW, useForLive=false, selectedProvider unchanged)', () => {
    withFlag('true', () => {
      const baselineInput: InvestorFlowRouterInputWithEstimateAdr0657 = {
        ...dailyUnsettledInputWithEstimate(),
        kisInvestorTrendEstimateAdr0657: null,
      };
      const baseline = buildInvestorFlowProviderRouteResultAdr0477(baselineInput);
      const route = buildInvestorFlowProviderRouteResultAdr0477(dailyUnsettledInputWithEstimate());

      expect(route.estimateShadowFallbackUsed).toBe(true);
      expect(route.estimateProvider).toBe('KIS_INVESTOR_TREND_ESTIMATE');
      expect(route.estimateUseScope).toBe('SHADOW_ONLY_ESTIMATE');
      expect(route.estimateConfidence).toBe('LOW');
      // live/gate guards unchanged
      expect(route.usableForLive).toBe(false);
      expect(route.usableForGate).toBe(false);
      expect(route.usableForShadow).toBe(true);
      expect(route.liveExecutionAllowed).toBe(false);
      expect(route.executionImpact).toBe('NONE');
      // selectedProvider must NOT be promoted to estimate (it stays whatever daily-unsettled selection was)
      expect(route.selectedProvider).not.toBe('KIS_INVESTOR_TREND_ESTIMATE');
      expect(route.selectedProvider).toBe(baseline.selectedProvider);
      // estimate sample carried only as SHADOW-only diagnostic
      expect(route.providerStatuses.KIS_INVESTOR_TREND_ESTIMATE).toBe('OBSERVING');
    });
  });

  it('4. ON + estimate unavailable = graceful null (deficit != bearish; UNKNOWN preserved)', () => {
    withFlag('true', () => {
      const missingEstimateInput: InvestorFlowRouterInputWithEstimateAdr0657 = {
        ...dailyUnsettledInputWithEstimate(),
        kisInvestorTrendEstimateAdr0657: { confidence: 'MISSING', useScope: 'DIAGNOSTIC_ONLY' },
      };
      const route = buildInvestorFlowProviderRouteResultAdr0477(missingEstimateInput);
      expect(route.estimateShadowFallbackUsed).toBe(false);
      expect(route.estimateProvider).toBeNull();
      expect(route.estimateConfidence).toBe('NONE');
      expect(route.estimateUseScope).toBeUndefined();
      // deficit is not bearish — signal stays UNKNOWN, marketSignal-equivalent guards preserved
      expect(route.signal).toBe('UNKNOWN');
      expect(route.liveExecutionAllowed).toBe(false);
      expect(route.providerStatuses.KIS_INVESTOR_TREND_ESTIMATE).toBeUndefined();
      expect(route.selectedProvider).not.toBe('KIS_INVESTOR_TREND_ESTIMATE');
    });
  });
});

function withFlagResult(
  value: 'true' | 'false' | undefined,
  inputFn: () => InvestorFlowRouterInputWithEstimateAdr0657,
): ReturnType<typeof buildInvestorFlowProviderRouteResultAdr0477> {
  let result!: ReturnType<typeof buildInvestorFlowProviderRouteResultAdr0477>;
  withFlag(value, () => {
    result = buildInvestorFlowProviderRouteResultAdr0477(inputFn());
  });
  return result;
}
