import { describe, it, expect } from 'vitest';
import {
  buildGate1ThresholdEvidenceReport,
  formatGate1ThresholdEvidenceSection,
  type Gate1ThresholdSample,
} from './gate1ThresholdEvidence.js';

describe('buildGate1ThresholdEvidenceReport — skeleton (no samples)', () => {
  const report = buildGate1ThresholdEvidenceReport();

  it('reports INSUFFICIENT_SAMPLE / OBSERVE_MORE with safety invariants fixed', () => {
    expect(report.confidence).toBe('INSUFFICIENT_SAMPLE');
    expect(report.recommendedAction).toBe('OBSERVE_MORE');
    expect(report.thresholdAutoChanged).toBe(false);
    expect(report.operatorApprovalRequired).toBe(true);
    expect(report.liveExecutionAllowed).toBe(false);
    expect(report.executionImpact).toBe('NONE');
    expect(report.totalSamples).toBeNull();
  });

  it('exposes all five score bands with null stats', () => {
    expect(Object.keys(report.scoreBandTable)).toEqual(['70+', '65~70', '60~65', '55~60', 'below55']);
    expect(report.scoreBandTable['70+'].count).toBeNull();
    expect(report.scoreBandTable.below55.expectancyR).toBeNull();
  });
});

describe('formatGate1ThresholdEvidenceSection — always renders', () => {
  const text = formatGate1ThresholdEvidenceSection(undefined);

  it('renders the Gate1-specific header (not the Gate3 one)', () => {
    expect(text).toContain('Gate1 Threshold Evidence');
    expect(text).not.toContain('Gate3 Threshold Evidence');
  });

  it('shows the score band table with all five bands', () => {
    expect(text).toContain('scoreBandTable:');
    expect(text).toContain('70+:');
    expect(text).toContain('65~70:');
    expect(text).toContain('60~65:');
    expect(text).toContain('55~60:');
    expect(text).toContain('below55:');
  });

  it('shows fixed safety lines and skeleton fallback values', () => {
    expect(text).toContain('window: D1/D3/D5');
    expect(text).toContain('thresholdAutoChanged: false');
    expect(text).toContain('operatorApprovalRequired: true');
    expect(text).toContain('liveExecutionAllowed: false');
    expect(text).toContain('executionImpact: NONE');
    expect(text).toContain('confidence: INSUFFICIENT_SAMPLE');
    expect(text).toContain('recommendedAction: OBSERVE_MORE');
    expect(text).toContain('totalSamples: N/A');
    expect(text).toContain('expectancyR: N/A');
    expect(text).toContain('falseNegativeRate: N/A');
  });

  it('renders regime split and data quality split blocks', () => {
    expect(text).toContain('Regime Split:');
    expect(text).toContain('- R3_EARLY: N/A');
    expect(text).toContain('- SHADOW_ONLY: N/A');
    expect(text).toContain('Data Quality Split:');
    expect(text).toContain('- supplyGateScoreEligible=true: N/A');
    expect(text).toContain('- supplyGateScoreEligible=false: N/A');
  });
});

describe('buildGate1ThresholdEvidenceReport — with samples', () => {
  function sample(partial: Partial<Gate1ThresholdSample> & { gate1Score: number }): Gate1ThresholdSample {
    return {
      maturedD1: true,
      maturedD3: true,
      maturedD5: true,
      returnD1: 1,
      returnD3: 2,
      returnD5: 4,
      mfe: 5,
      mae: -2,
      rMultiple: 1,
      regime: 'R3_EARLY',
      dataQuality: 'FULL_COMPUTED',
      supplyGateScoreEligible: true,
      ...partial,
    };
  }

  it('buckets samples into correct bands and computes win rate', () => {
    const samples = [
      sample({ gate1Score: 75 }),
      sample({ gate1Score: 72, returnD5: -1 }),
      sample({ gate1Score: 67 }),
      sample({ gate1Score: 62 }),
      sample({ gate1Score: 57 }),
      sample({ gate1Score: 50 }),
    ];
    const report = buildGate1ThresholdEvidenceReport(samples);
    expect(report.totalSamples).toBe(6);
    expect(report.scoreBandTable['70+'].count).toBe(2);
    expect(report.scoreBandTable['70+'].winRateD5).toBe(50); // one +4, one -1
    expect(report.scoreBandTable['65~70'].count).toBe(1);
    expect(report.scoreBandTable.below55.count).toBe(1);
    expect(report.regimeSplit.R3_EARLY).toBe(6);
    expect(report.dataQualitySplit.FULL_COMPUTED).toBe(6);
  });

  it('escalates confidence and recommends REJECT when just-below-gate expectancy is negative', () => {
    const winners = Array.from({ length: 120 }, () => sample({ gate1Score: 72, rMultiple: 2 }));
    const losers = Array.from({ length: 40 }, () =>
      sample({ gate1Score: 62, rMultiple: -1.5, returnD5: -5 }),
    );
    const report = buildGate1ThresholdEvidenceReport([...winners, ...losers]);
    expect(report.confidence).toBe('MEDIUM');
    expect(report.recommendedAction).toBe('REJECT_THRESHOLD_RELAXATION');
  });

  it('proposes R3-only dry run when 65~70 band is profitable with high false-negative loss', () => {
    const gateWinners = Array.from({ length: 80 }, () => sample({ gate1Score: 72, rMultiple: 1.5 }));
    const relaxBand = Array.from({ length: 40 }, (_, i) =>
      sample({ gate1Score: 67, rMultiple: 1.2, returnD5: 6, falseNegative: i % 2 === 0 }),
    );
    const report = buildGate1ThresholdEvidenceReport([...gateWinners, ...relaxBand]);
    expect(report.confidence).toBe('MEDIUM');
    expect(report.recommendedAction).toBe('DRY_RUN_THRESHOLD_65_R3_ONLY');
  });
});
