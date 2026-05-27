import { describe, it, expect } from 'vitest';
import {
  formatGate1ThresholdEvidenceSection,
  type Gate1ThresholdEvidenceSummary,
} from './gate1DryRunObservationLedgerAdr0476.js';

function band(
  key: Gate1ThresholdEvidenceSummary['scoreBandTable'][number]['band'],
  count: number,
): Gate1ThresholdEvidenceSummary['scoreBandTable'][number] {
  return {
    band: key,
    count,
    matureD1: count,
    matureD3: count,
    matureD5: count,
    avgReturnD1: 1.1,
    avgReturnD3: 2.2,
    avgReturnD5: 3.3,
    winRateD5: 55,
    hitPlus3PctRate: 40,
    hitMinus3PctRate: 10,
    avgMFE: 5.5,
    avgMAE: -2.2,
    expectancyR: 1.1,
    falseNegativeRate: 40,
  };
}

describe('formatGate1ThresholdEvidenceSection — skeleton (no summary)', () => {
  const text = formatGate1ThresholdEvidenceSection(undefined);

  it('renders the Gate1-specific header, never the Gate3 one', () => {
    expect(text.startsWith('Gate1 Threshold Evidence\n------------------------')).toBe(true);
    expect(text).not.toContain('Gate3 Threshold Evidence');
  });

  it('shows all five score bands and the splits', () => {
    expect(text).toContain('scoreBandTable:');
    for (const b of ['70+:', '65~70:', '60~65:', '55~60:', 'below55:']) {
      expect(text).toContain(b);
    }
    expect(text).toContain('Regime Split:');
    expect(text).toContain('- R3_EARLY: N/A');
    expect(text).toContain('- SHADOW_ONLY: N/A');
    expect(text).toContain('Data Quality Split:');
    expect(text).toContain('- supplyGateScoreEligible=true: N/A');
    expect(text).toContain('- supplyGateScoreEligible=false: N/A');
  });

  it('shows fixed safety lines and the INSUFFICIENT_SAMPLE / OBSERVE_MORE fallback', () => {
    expect(text).toContain('window: D1/D3/D5');
    expect(text).toContain('thresholdAutoChanged: false');
    expect(text).toContain('operatorApprovalRequired: true');
    expect(text).toContain('liveExecutionAllowed: false');
    expect(text).toContain('executionImpact: NONE');
    expect(text).toContain('confidence: INSUFFICIENT_SAMPLE');
    expect(text).toContain('recommendedAction: OBSERVE_MORE');
    expect(text).toContain('totalSamples: N/A');
    expect(text).toContain('count: N/A');
    expect(text).toContain('expectancyR: N/A');
  });
});

describe('formatGate1ThresholdEvidenceSection — with summary', () => {
  const summary: Gate1ThresholdEvidenceSummary = {
    sampleWindow: '1D/3D/5D',
    totalSamples: 250,
    matureSamplesD1: 250,
    matureSamplesD3: 240,
    matureSamplesD5: 220,
    bestDryRunThreshold: 70,
    recommendedAction: 'KEEP_THRESHOLD_70',
    confidence: 'MEDIUM',
    scoreBandTable: [
      band('70+', 100),
      band('65~70', 60),
      band('60~65', 40),
      band('55~60', 30),
      band('below55', 20),
    ],
    liveExecutionImpact: 'NONE',
    thresholdAutoChanged: false,
    operatorApprovalRequired: true,
  };
  const text = formatGate1ThresholdEvidenceSection(summary);

  it('renders real sample counts and band values', () => {
    expect(text).toContain('totalSamples: 250');
    expect(text).toContain('matureSamplesD5: 220');
    expect(text).toContain('confidence: MEDIUM');
    expect(text).toContain('recommendedAction: KEEP_THRESHOLD_70');
    expect(text).toContain('count: 100');
    expect(text).toContain('winRateD5: 55');
    expect(text).toContain('expectancyR: 1.1');
  });

  it('keeps live-execution safety invariants fixed regardless of summary', () => {
    expect(text).toContain('liveExecutionAllowed: false');
    expect(text).toContain('executionImpact: NONE');
    expect(text).toContain('thresholdAutoChanged: false');
  });
});
