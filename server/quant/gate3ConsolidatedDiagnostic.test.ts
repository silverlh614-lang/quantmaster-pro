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
});
