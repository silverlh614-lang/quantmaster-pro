import { describe, it, expect } from 'vitest';
import {
  buildGate1ThresholdEvidenceSummary,
  formatGate1ThresholdEvidenceSection,
  type Gate1DryRunObservationRow,
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
    expect(text).toContain('pendingSamples: N/A');
    expect(text).toContain('countSum: N/A');
    expect(text).toContain('count: N/A');
    expect(text).toContain('expectancyR: N/A');
  });
});

describe('formatGate1ThresholdEvidenceSection — with summary', () => {
  const summary: Gate1ThresholdEvidenceSummary = {
    sampleWindow: '1D/3D/5D',
    totalSamples: 250,
    pendingSamples: 30,
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

  it('shows pendingSamples and a countSum equal to totalSamples', () => {
    expect(text).toContain('pendingSamples: 30');
    expect(text).toContain('countSum: 250');
  });
});

describe('buildGate1ThresholdEvidenceSummary — reads pending ADR-0476 ledger rows', () => {
  function pendingRow(dryRunScore: number): Gate1DryRunObservationRow {
    return { status: 'PENDING', dryRunScore } as unknown as Gate1DryRunObservationRow;
  }
  // 13 pending rows: 0×70+, 2×65~70, 3×60~65, 4×55~60, 4×below55 (mirrors the operator's Page 17).
  const rows: Gate1DryRunObservationRow[] = [
    pendingRow(67), pendingRow(66),
    pendingRow(64), pendingRow(62), pendingRow(60),
    pendingRow(59), pendingRow(57), pendingRow(56), pendingRow(55),
    pendingRow(54), pendingRow(50), pendingRow(40), pendingRow(30),
  ];
  const summary = buildGate1ThresholdEvidenceSummary(rows);

  it('counts all created rows as totalSamples/pendingSamples (not just D5-matured)', () => {
    expect(summary.totalSamples).toBe(13);
    expect(summary.pendingSamples).toBe(13);
    expect(summary.matureSamplesD1).toBe(0);
    expect(summary.matureSamplesD3).toBe(0);
    expect(summary.matureSamplesD5).toBe(0);
  });

  it('distributes the 13 rows across score bands so counts sum to totalSamples', () => {
    const byBand = Object.fromEntries(summary.scoreBandTable.map((b) => [b.band, b.count]));
    expect(byBand['70+']).toBe(0);
    expect(byBand['65~70']).toBe(2);
    expect(byBand['60~65']).toBe(3);
    expect(byBand['55~60']).toBe(4);
    expect(byBand.below55).toBe(4);
    const countSum = summary.scoreBandTable.reduce((sum, b) => sum + b.count, 0);
    expect(countSum).toBe(summary.totalSamples);
  });

  it('keeps pending-only state at INSUFFICIENT_SAMPLE / OBSERVE_MORE with returns N/A', () => {
    expect(summary.confidence).toBe('INSUFFICIENT_SAMPLE');
    expect(summary.recommendedAction).toBe('OBSERVE_MORE');
    expect(summary.thresholdAutoChanged).toBe(false);
    expect(summary.liveExecutionImpact).toBe('NONE');
    expect(summary.scoreBandTable.every((b) => b.avgReturnD5 === 'N/A')).toBe(true);
    const text = formatGate1ThresholdEvidenceSection(summary);
    expect(text).toContain('totalSamples: 13');
    expect(text).toContain('pendingSamples: 13');
    expect(text).toContain('countSum: 13');
  });
});
