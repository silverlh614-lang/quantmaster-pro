import { describe, expect, it } from 'vitest';
import { buildInvestorFlowSampleAcquisitionProbeAdr0489 } from './investorFlowSampleAcquisitionAdr0489.js';

describe('ADR-0489 investor-flow sample acquisition probe', () => {
  it('keeps related program sample independent from semantic investor-flow selection', () => {
    const report = buildInvestorFlowSampleAcquisitionProbeAdr0489({
      selectedProvider: 'NONE',
      semanticSampleAvailable: false,
      relatedProgramSampleAvailable: true,
      relatedProgramSampleProvider: 'KIS',
      semanticSignal: 'BULLISH',
    });
    expect(report.relatedProgramSampleAvailable).toBe(true);
    expect(report.selectedProvider).toBe('NONE');
    expect(report.semanticSampleAvailable).toBe(false);
    expect(report.signal).toBe('UNKNOWN');
    expect(report.executionImpact).toBe('NONE');
    expect(report.liveExecutionAllowed).toBe(false);
  });
});
