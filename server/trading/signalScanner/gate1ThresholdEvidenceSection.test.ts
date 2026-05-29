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
    expect(text).toContain('window: D1/D3/D5/D10');
    expect(text).toContain('matureSamplesD10: N/A');
    expect(text).toContain('thresholdAutoChanged: false');
    expect(text).toContain('operatorApprovalRequired: true');
    expect(text).toContain('liveExecutionAllowed: false');
    expect(text).toContain('executionImpact: NONE');
    expect(text).toContain('confidence: INSUFFICIENT_SAMPLE');
    expect(text).toContain('recommendedAction: OBSERVE_MORE');
    expect(text).toContain('Threshold Policy Split:');
    expect(text).toContain('liveRequiredScore=70');
    expect(text).toContain('shadowObservationEligible!=shadowBuyAllowed');
    expect(text).toContain('totalSamples: N/A');
    expect(text).toContain('pendingSamples: N/A');
    expect(text).toContain('countSum: N/A');
    expect(text).toContain('count: N/A');
    expect(text).toContain('expectancyR: N/A');
  });
});

describe('formatGate1ThresholdEvidenceSection — with summary', () => {
  const summary: Gate1ThresholdEvidenceSummary = {
    sampleWindow: '1D/3D/5D/10D',
    totalSamples: 250,
    pendingSamples: 30,
    ledgerRowsCreated: 250,
    scoreBandCountSum: 250,
    evidenceLedgerMatch: true,
    scoreBandLedgerMatch: true,
    maturity: {
      schedulerHealthy: true,
      status: 'DUE_PENDING_RUN',
      pendingD1: 30,
      pendingD3: 30,
      pendingD5: 30,
      pendingD10: 30,
      dueNow: 10,
      stalePending: 0,
      nextMaturityRunAt: '2026-05-28',
      lastMaturityRunAt: 'N/A',
      dataUnavailable: false,
      lastErrorSanitized: 'NONE',
      executionImpact: 'NONE',
    },
    matureSamplesD1: 250,
    matureSamplesD3: 240,
    matureSamplesD5: 220,
    matureSamplesD10: 0,
    bestDryRunThreshold: 70,
    recommendedAction: 'KEEP_THRESHOLD',
    confidence: 'OBSERVING',
    reviewReady: false,
    reviewBlockers: ['MFE_MAE_TIMING_SPLIT_INSUFFICIENT'],
    liveRequiredScore: 70,
    shadowObservationMode: 'ON',
    shadowObservationBands: ['60~65', '65~70', '70+'],
    liveThresholdAutoChanged: false,
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
    expect(text).toContain('matureSamplesD10: 0');
    expect(text).toContain('confidence: OBSERVING');
    expect(text).toContain('recommendedAction: KEEP_THRESHOLD');
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

  it('renders the evidence↔ledger integrity and maturity-scheduler blocks', () => {
    expect(text).toContain('Gate1 Threshold Evidence Integrity:');
    expect(text).toContain('ledgerRowsCreated: 250');
    expect(text).toContain('scoreBandCountSum: 250');
    expect(text).toContain('evidenceLedgerMatch: true');
    expect(text).toContain('scoreBandLedgerMatch: true');
    expect(text).toContain('Gate1 Evidence Maturity Scheduler:');
    expect(text).toContain('schedulerHealthy: true');
    expect(text).toContain('status: DUE_PENDING_RUN');
    expect(text).toContain('pendingD1: 30');
    expect(text).toContain('pendingD10: 30');
    expect(text).toContain('nextMaturityRunAt: 2026-05-28');
  });
});

describe('buildGate1ThresholdEvidenceSummary — reads pending ADR-0476 ledger rows', () => {
  function pendingRow(dryRunScore: number): Gate1DryRunObservationRow {
    return { status: 'PENDING', dryRunScore, forDate: '2026-05-27' } as unknown as Gate1DryRunObservationRow;
  }
  // 13 pending rows: 0×70+, 2×65~70, 3×60~65, 4×55~60, 4×below55 (mirrors the operator's Page 17).
  const rows: Gate1DryRunObservationRow[] = [
    pendingRow(67), pendingRow(66),
    pendingRow(64), pendingRow(62), pendingRow(60),
    pendingRow(59), pendingRow(57), pendingRow(56), pendingRow(55),
    pendingRow(54), pendingRow(50), pendingRow(40), pendingRow(30),
  ];
  // Fixed clock = forDate so no horizon is due yet (NOT_YET_DUE, all 13 pending each horizon).
  const summary = buildGate1ThresholdEvidenceSummary(rows, new Date('2026-05-27T10:00:00Z'));

  it('counts all created rows as totalSamples/pendingSamples (not just D5-matured)', () => {
    expect(summary.totalSamples).toBe(13);
    expect(summary.pendingSamples).toBe(13);
    expect(summary.matureSamplesD1).toBe(0);
    expect(summary.matureSamplesD3).toBe(0);
    expect(summary.matureSamplesD5).toBe(0);
    expect(summary.matureSamplesD10).toBe(0);
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

  it('reports evidence↔ledger count invariant matches (P2)', () => {
    expect(summary.ledgerRowsCreated).toBe(13);
    expect(summary.scoreBandCountSum).toBe(13);
    expect(summary.evidenceLedgerMatch).toBe(true);
    expect(summary.scoreBandLedgerMatch).toBe(true);
  });

  it('derives a NOT_YET_DUE maturity schedule with all horizons pending (P4)', () => {
    expect(summary.maturity.status).toBe('NOT_YET_DUE');
    expect(summary.maturity.schedulerHealthy).toBe(true);
    expect(summary.maturity.pendingD1).toBe(13);
    expect(summary.maturity.pendingD3).toBe(13);
    expect(summary.maturity.pendingD5).toBe(13);
    expect(summary.maturity.pendingD10).toBe(13);
    expect(summary.maturity.dueNow).toBe(0);
    expect(summary.maturity.stalePending).toBe(0);
    expect(summary.maturity.dataUnavailable).toBe(false);
    expect(summary.maturity.executionImpact).toBe('NONE');
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
