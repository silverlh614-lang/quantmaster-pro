import { describe, expect, it } from 'vitest';
import { buildGate3ConsolidatedDiagnostic } from './gate3ConsolidatedDiagnostic.js';

function baseGate3(): any {
  return {
    sourceCoverage: { allDeclaredInputsAvailable: true, allRequiredDataAvailable: true, missingInputs: [], missingRequiredData: [], providerIssues: [], calculationIssues: [] },
    externalDataCoverage: {
      technicalIndicators: { status: 'VERIFIED' },
      volumeTiming: { status: 'VERIFIED', breakoutVolume: { status: 'PASS' } },
      priceStructure: { status: 'VERIFIED', breakout: { status: 'PASS' }, turtle: { status: 'FAIL' } },
      momentumIndicators: { status: 'VERIFIED', alignment: 'CONFIRMED', overheat: { status: 'NORMAL' } },
      pullbackSupport: { status: 'OPTIONAL', pullbackQuality: { status: 'HEALTHY_PULLBACK' } },
      falseBreakout: { status: 'OPTIONAL', falseBreakout: { status: 'LOW_RISK' }, divergence: { status: 'NONE' }, exhaustion: { status: 'NORMAL' } },
      lastTrigger: { status: 'FIRED', fired: true, reason: 'FIRED', executionReady: true, liveBuyAllowed: true, shadowObservableAllowed: true, counterfactualAllowed: true, executionImpact: 'NONE' },
      entryPriceGuard: { priceFreshness: 'VERIFIED', executionImpact: 'NONE' },
      rrrCheck: { status: 'PASS', rrr: 2.4 },
      executionReadiness: { status: 'READY', executionImpact: 'NONE' },
      intradayTiming: { status: 'STAGE_NOT_FETCHED', dataMode: 'EOD_ONLY', quoteFreshness: { status: 'FRESH' }, lastTick: { status: 'FRESH' } },
    },
  };
}

describe('gate3 consolidated diagnostic', () => {
  it('normal ok/warn path with marketSignal fixed false', () => {
    const d = buildGate3ConsolidatedDiagnostic({ gate3: baseGate3() });
    expect(['OK', 'WARN']).toContain(d.health);
    expect(d.timingAlignment.volume).toBe('CONFIRMED');
    expect(d.timingAlignment.priceBreakout).toBe('CONFIRMED');
    expect(d.marketSignal).toBe(false);
  });

  it('uses computed volumeRatio when breakoutVolume status is missing due trading value coverage', () => {
    const g = baseGate3();
    g.externalDataCoverage.volumeTiming = {
      status: 'CALCULATION_MISSING',
      values: {
        volume: 2_000_000,
        avgVolume: 1_000_000,
        volumeRatio: 2,
        tradingValue: 20_000_000_000,
        tradingValueRatio: null,
      },
      breakoutVolume: { status: 'MISSING', volumeRatio: 2, tradingValueRatio: null },
      vcp: { status: 'MISSING' },
    };

    const d = buildGate3ConsolidatedDiagnostic({ gate3: g });

    expect(d.timingAlignment.volume).toBe('CONFIRMED');
    expect(d.compactText).toContain('volume=CONFIRMED');
    expect(d.primaryIssue).not.toBe('VOLUME_TIMING_UNAVAILABLE');
    expect(d.marketSignal).toBe(false);
  });

  it('volume missing conflict or incomplete', () => {
    const g = baseGate3();
    g.externalDataCoverage.volumeTiming.status = 'MISSING';
    g.externalDataCoverage.volumeTiming.breakoutVolume.status = 'MISSING';
    const d = buildGate3ConsolidatedDiagnostic({ gate3: g });
    expect(['CONFLICT', 'DATA_INCOMPLETE']).toContain(d.health);
    expect(d.primaryIssue).toBe('VOLUME_TIMING_UNAVAILABLE');
    expect(d.timingAlignment.volume).toBe('MISSING');
    expect(d.marketSignal).toBe(false);
  });

  it('momentum missing', () => {
    const g = baseGate3();
    g.externalDataCoverage.momentumIndicators.status = 'MISSING';
    const d = buildGate3ConsolidatedDiagnostic({ gate3: g });
    expect(d.health).toBe('DATA_INCOMPLETE');
    expect(d.operatorAction).toBe('CHECK_MOMENTUM_INDICATORS');
  });

  it('false breakout and stale intraday advisory', () => {
    const g = baseGate3();
    g.externalDataCoverage.falseBreakout.falseBreakout.status = 'HIGH_RISK';
    const d = buildGate3ConsolidatedDiagnostic({ gate3: g });
    expect(['WARN', 'CONFLICT']).toContain(d.health);
    expect(d.primaryIssue).toBe('FALSE_BREAKOUT_RISK');
    expect(d.marketSignal).toBe(false);
  });

  it('lastTrigger BLOCKED is reflected without promoting marketSignal', () => {
    const g = baseGate3();
    g.externalDataCoverage.lastTrigger = { status: 'THRESHOLD_NOT_MET', fired: false, reason: 'RRR_BELOW_2_0', executionReady: false, liveBuyAllowed: false, shadowObservableAllowed: true, counterfactualAllowed: true, executionImpact: 'NONE' };
    g.externalDataCoverage.rrrCheck = { status: 'FAIL', rrr: 1.6 };

    const d = buildGate3ConsolidatedDiagnostic({ gate3: g });

    expect(d.timingReadiness).toBe('BLOCKED');
    expect(d.lastTrigger.fired).toBe(false);
    expect(d.compactText).toContain('Gate3: BLOCKED');
    expect(d.compactText).toContain('rrr=1.6');
    expect(d.marketSignal).toBe(false);
    expect(d.executionImpact).toBe('NONE');
  });

  it('renders LastTrigger price and volume confirmation details with ratio', () => {
    const g = baseGate3();
    g.externalDataCoverage.lastTrigger = {
      status: 'THRESHOLD_NOT_MET',
      fired: false,
      reason: 'NEAR_BREAKOUT_DRY_UP',
      executionReady: false,
      liveBuyAllowed: false,
      shadowObservableAllowed: true,
      counterfactualAllowed: true,
      executionImpact: 'DIAGNOSTIC_ONLY',
      priceConfirmation: { status: 'NEAR_BREAKOUT' },
      volumeConfirmationDetail: { status: 'DRY_UP', volumeRatio20d: 0.42 },
    };
    g.externalDataCoverage.rrrCheck = { status: 'PASS', rrr: 2.05, source: 'FALLBACK_PERCENT' };

    const d = buildGate3ConsolidatedDiagnostic({ gate3: g });

    expect(d.timingReadiness).toBe('WAIT');
    expect(d.timingAlignment.priceBreakout).toBe('NEAR_BREAKOUT');
    expect(d.timingAlignment.volume).toBe('DRY_UP');
    expect(d.compactText).toContain('price=NEAR_BREAKOUT');
    expect(d.compactText).toContain('volume=DRY_UP 0.42x');
    expect(d.marketSignal).toBe(false);
  });

  it('separates Gate3 READY from live policy block', () => {
    const g = baseGate3();
    g.externalDataCoverage.lastTrigger = {
      ...g.externalDataCoverage.lastTrigger,
      liveBuyAllowed: false,
      shadowObservableAllowed: true,
      priceConfirmation: { status: 'BREAKOUT_CONFIRMED' },
      volumeConfirmationDetail: { status: 'CONFIRMED', volumeRatio20d: 1.8 },
    };
    g.externalDataCoverage.executionReadiness = {
      status: 'READY',
      liveBuyAllowed: false,
      policyBlockReason: 'BLOCKED_SHADOW_ONLY',
      executionImpact: 'DIAGNOSTIC_ONLY',
    };

    const d = buildGate3ConsolidatedDiagnostic({ gate3: g });

    expect(d.timingReadiness).toBe('READY');
    expect(d.compactText).toContain('Gate3: READY');
    expect(d.compactText).toContain('livePolicy=BLOCKED_SHADOW_ONLY');
    expect(d.compactText).toContain('shadowAllowed=true');
    expect(d.marketSignal).toBe(false);
  });

  it('entry price stale is live-buy-only execution impact', () => {
    const g = baseGate3();
    g.externalDataCoverage.lastTrigger = { status: 'THRESHOLD_NOT_MET', fired: false, reason: 'ENTRY_PRICE_STALE', executionReady: false, liveBuyAllowed: false, shadowObservableAllowed: true, counterfactualAllowed: true, executionImpact: 'LIVE_BUY_BLOCKED_ONLY' };
    g.externalDataCoverage.entryPriceGuard = { priceFreshness: 'STALE', blockReason: 'ENTRY_PRICE_STALE', executionImpact: 'LIVE_BUY_BLOCKED_ONLY' };

    const d = buildGate3ConsolidatedDiagnostic({ gate3: g });

    expect(d.timingReadiness).toBe('DATA_INCOMPLETE');
    expect(d.executionImpact).toBe('LIVE_BUY_BLOCKED_ONLY');
    expect(d.compactText).toContain('ENTRY_PRICE_STALE');
    expect(d.marketSignal).toBe(false);
  });
});
