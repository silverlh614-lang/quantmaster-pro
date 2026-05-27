// @responsibility Gate1 minimum-signal threshold forward-outcome evidence report (score-band table); diagnostic emit-only, suggest-only, executionImpact=NONE.

export type Gate1ThresholdEvidenceConfidence = 'INSUFFICIENT_SAMPLE' | 'LOW' | 'MEDIUM' | 'HIGH';

export type Gate1ThresholdEvidenceRecommendedAction =
  | 'OBSERVE_MORE'
  | 'KEEP_THRESHOLD_70'
  | 'DRY_RUN_THRESHOLD_65_R3_ONLY'
  | 'REJECT_THRESHOLD_RELAXATION';

export type Gate1ScoreBandKey = '70+' | '65~70' | '60~65' | '55~60' | 'below55';

export const GATE1_SCORE_BAND_ORDER: readonly Gate1ScoreBandKey[] = [
  '70+',
  '65~70',
  '60~65',
  '55~60',
  'below55',
];

export interface Gate1ScoreBandStats {
  count: number | null;
  matureD1: number | null;
  matureD3: number | null;
  matureD5: number | null;
  avgReturnD1: number | null;
  avgReturnD3: number | null;
  avgReturnD5: number | null;
  winRateD5: number | null;
  hitPlus3PctRate: number | null;
  hitMinus3PctRate: number | null;
  avgMFE: number | null;
  avgMAE: number | null;
  expectancyR: number | null;
  falseNegativeRate: number | null;
}

export interface Gate1ThresholdEvidenceRegimeSplit {
  R3_EARLY: number | null;
  R5_CAUTION: number | null;
  R6_RECOVERY_WATCH: number | null;
  SHADOW_ONLY: number | null;
}

export interface Gate1ThresholdEvidenceDataQualitySplit {
  FULL_COMPUTED: number | null;
  SKELETON_ONLY: number | null;
  supplyGateScoreEligibleTrue: number | null;
  supplyGateScoreEligibleFalse: number | null;
}

export interface Gate1ThresholdEvidenceReport {
  window: 'D1/D3/D5';
  totalSamples: number | null;
  matureSamplesD1: number | null;
  matureSamplesD3: number | null;
  matureSamplesD5: number | null;
  thresholdAutoChanged: false;
  operatorApprovalRequired: true;
  liveExecutionAllowed: false;
  executionImpact: 'NONE';
  confidence: Gate1ThresholdEvidenceConfidence;
  recommendedAction: Gate1ThresholdEvidenceRecommendedAction;
  scoreBandTable: Record<Gate1ScoreBandKey, Gate1ScoreBandStats>;
  regimeSplit: Gate1ThresholdEvidenceRegimeSplit;
  dataQualitySplit: Gate1ThresholdEvidenceDataQualitySplit;
}

/** Per-candidate forward-outcome sample keyed off its realized Gate1 minimum-signal score. */
export interface Gate1ThresholdSample {
  gate1Score: number;
  regime?: string;
  dataQuality?: 'FULL_COMPUTED' | 'SKELETON_ONLY';
  supplyGateScoreEligible?: boolean;
  maturedD1?: boolean;
  maturedD3?: boolean;
  maturedD5?: boolean;
  returnD1?: number | null;
  returnD3?: number | null;
  returnD5?: number | null;
  mfe?: number | null;
  mae?: number | null;
  rMultiple?: number | null;
  /** Blocked at requiredScore=70 but would have been a winner (gate too strict on this sample). */
  falseNegative?: boolean;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function rate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return round1((numerator / denominator) * 100);
}

function avg(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return round2(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function emptyBand(): Gate1ScoreBandStats {
  return {
    count: null,
    matureD1: null,
    matureD3: null,
    matureD5: null,
    avgReturnD1: null,
    avgReturnD3: null,
    avgReturnD5: null,
    winRateD5: null,
    hitPlus3PctRate: null,
    hitMinus3PctRate: null,
    avgMFE: null,
    avgMAE: null,
    expectancyR: null,
    falseNegativeRate: null,
  };
}

function emptyScoreBandTable(): Record<Gate1ScoreBandKey, Gate1ScoreBandStats> {
  return {
    '70+': emptyBand(),
    '65~70': emptyBand(),
    '60~65': emptyBand(),
    '55~60': emptyBand(),
    below55: emptyBand(),
  };
}

function bandKeyForScore(score: number): Gate1ScoreBandKey {
  if (score >= 70) return '70+';
  if (score >= 65) return '65~70';
  if (score >= 60) return '60~65';
  if (score >= 55) return '55~60';
  return 'below55';
}

function buildBandStats(samples: readonly Gate1ThresholdSample[]): Gate1ScoreBandStats {
  if (samples.length === 0) return emptyBand();
  const matureD1 = samples.filter((s) => s.maturedD1);
  const matureD3 = samples.filter((s) => s.maturedD3);
  const matureD5 = samples.filter((s) => s.maturedD5);
  const returnsD1 = matureD1.map((s) => s.returnD1).filter(finite);
  const returnsD3 = matureD3.map((s) => s.returnD3).filter(finite);
  const returnsD5 = matureD5.map((s) => s.returnD5).filter(finite);
  const d5Returns = matureD5.map((s) => s.returnD5).filter(finite);
  const winnersD5 = d5Returns.filter((r) => r > 0).length;
  const hitPlus3 = d5Returns.filter((r) => r >= 3).length;
  const hitMinus3 = d5Returns.filter((r) => r <= -3).length;
  return {
    count: samples.length,
    matureD1: matureD1.length,
    matureD3: matureD3.length,
    matureD5: matureD5.length,
    avgReturnD1: avg(returnsD1),
    avgReturnD3: avg(returnsD3),
    avgReturnD5: avg(returnsD5),
    winRateD5: rate(winnersD5, d5Returns.length),
    hitPlus3PctRate: rate(hitPlus3, d5Returns.length),
    hitMinus3PctRate: rate(hitMinus3, d5Returns.length),
    avgMFE: avg(samples.map((s) => s.mfe).filter(finite)),
    avgMAE: avg(samples.map((s) => s.mae).filter(finite)),
    expectancyR: avg(samples.map((s) => s.rMultiple).filter(finite)),
    falseNegativeRate: rate(samples.filter((s) => s.falseNegative).length, samples.length),
  };
}

function resolveConfidence(matureD5Total: number): Gate1ThresholdEvidenceConfidence {
  if (matureD5Total < 30) return 'INSUFFICIENT_SAMPLE';
  if (matureD5Total < 100) return 'LOW';
  if (matureD5Total < 300) return 'MEDIUM';
  return 'HIGH';
}

function resolveRecommendedAction(
  confidence: Gate1ThresholdEvidenceConfidence,
  bands: Record<Gate1ScoreBandKey, Gate1ScoreBandStats>,
): Gate1ThresholdEvidenceRecommendedAction {
  if (confidence === 'INSUFFICIENT_SAMPLE') return 'OBSERVE_MORE';
  const relaxBandExpectancy = bands['65~70'].expectancyR;
  const relaxBandFalseNegative = bands['65~70'].falseNegativeRate;
  const belowBandExpectancy = bands['60~65'].expectancyR;
  // Negative expectancy just below the gate ⟹ relaxation would import losers.
  if (finite(belowBandExpectancy) && belowBandExpectancy < 0) return 'REJECT_THRESHOLD_RELAXATION';
  if (finite(relaxBandExpectancy) && relaxBandExpectancy < 0) return 'REJECT_THRESHOLD_RELAXATION';
  // Positive expectancy + meaningful false-negative loss in 65~70 ⟹ propose R3-only dry run (suggest-only).
  if (finite(relaxBandExpectancy) && relaxBandExpectancy > 0 && (relaxBandFalseNegative ?? 0) >= 20) {
    return 'DRY_RUN_THRESHOLD_65_R3_ONLY';
  }
  return 'KEEP_THRESHOLD_70';
}

function countRegime(samples: readonly Gate1ThresholdSample[], regime: string): number | null {
  const total = samples.filter((s) => String(s.regime ?? '').toUpperCase() === regime).length;
  return samples.length === 0 ? null : total;
}

/**
 * Builds the Gate1 minimum-signal threshold evidence report from forward-outcome samples.
 * With no samples (the current emit-only state) it returns the INSUFFICIENT_SAMPLE / OBSERVE_MORE
 * skeleton with N/A bands. Pure + suggest-only: never mutates requiredScore=70, executionImpact=NONE.
 */
export function buildGate1ThresholdEvidenceReport(
  samples: readonly Gate1ThresholdSample[] = [],
): Gate1ThresholdEvidenceReport {
  const base = {
    window: 'D1/D3/D5',
    thresholdAutoChanged: false,
    operatorApprovalRequired: true,
    liveExecutionAllowed: false,
    executionImpact: 'NONE',
  } as const;

  if (samples.length === 0) {
    return {
      ...base,
      totalSamples: null,
      matureSamplesD1: null,
      matureSamplesD3: null,
      matureSamplesD5: null,
      confidence: 'INSUFFICIENT_SAMPLE',
      recommendedAction: 'OBSERVE_MORE',
      scoreBandTable: emptyScoreBandTable(),
      regimeSplit: { R3_EARLY: null, R5_CAUTION: null, R6_RECOVERY_WATCH: null, SHADOW_ONLY: null },
      dataQualitySplit: {
        FULL_COMPUTED: null,
        SKELETON_ONLY: null,
        supplyGateScoreEligibleTrue: null,
        supplyGateScoreEligibleFalse: null,
      },
    };
  }

  const scoreBandTable = emptyScoreBandTable();
  for (const key of GATE1_SCORE_BAND_ORDER) {
    scoreBandTable[key] = buildBandStats(samples.filter((s) => bandKeyForScore(s.gate1Score) === key));
  }

  const matureD5Total = samples.filter((s) => s.maturedD5).length;
  const confidence = resolveConfidence(matureD5Total);

  return {
    ...base,
    totalSamples: samples.length,
    matureSamplesD1: samples.filter((s) => s.maturedD1).length,
    matureSamplesD3: samples.filter((s) => s.maturedD3).length,
    matureSamplesD5: matureD5Total,
    confidence,
    recommendedAction: resolveRecommendedAction(confidence, scoreBandTable),
    scoreBandTable,
    regimeSplit: {
      R3_EARLY: countRegime(samples, 'R3_EARLY'),
      R5_CAUTION: countRegime(samples, 'R5_CAUTION'),
      R6_RECOVERY_WATCH: countRegime(samples, 'R6_RECOVERY_WATCH'),
      SHADOW_ONLY: countRegime(samples, 'SHADOW_ONLY'),
    },
    dataQualitySplit: {
      FULL_COMPUTED: samples.filter((s) => s.dataQuality === 'FULL_COMPUTED').length,
      SKELETON_ONLY: samples.filter((s) => s.dataQuality === 'SKELETON_ONLY').length,
      supplyGateScoreEligibleTrue: samples.filter((s) => s.supplyGateScoreEligible === true).length,
      supplyGateScoreEligibleFalse: samples.filter((s) => s.supplyGateScoreEligible === false).length,
    },
  };
}

function intText(value: number | null): string {
  return value === null ? 'N/A' : String(value);
}

function signedPctText(value: number | null): string {
  if (value === null) return 'N/A';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function pctText(value: number | null): string {
  return value === null ? 'N/A' : `${value.toFixed(1)}%`;
}

function rText(value: number | null): string {
  return value === null ? 'N/A' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}R`;
}

function formatBandBlock(key: Gate1ScoreBandKey, band: Gate1ScoreBandStats): string[] {
  return [
    `${key}:`,
    `  count: ${intText(band.count)}`,
    `  matureD1: ${intText(band.matureD1)}`,
    `  matureD3: ${intText(band.matureD3)}`,
    `  matureD5: ${intText(band.matureD5)}`,
    `  avgReturnD1: ${signedPctText(band.avgReturnD1)}`,
    `  avgReturnD3: ${signedPctText(band.avgReturnD3)}`,
    `  avgReturnD5: ${signedPctText(band.avgReturnD5)}`,
    `  winRateD5: ${pctText(band.winRateD5)}`,
    `  hitPlus3PctRate: ${pctText(band.hitPlus3PctRate)}`,
    `  hitMinus3PctRate: ${pctText(band.hitMinus3PctRate)}`,
    `  avgMFE: ${signedPctText(band.avgMFE)}`,
    `  avgMAE: ${signedPctText(band.avgMAE)}`,
    `  expectancyR: ${rText(band.expectancyR)}`,
    `  falseNegativeRate: ${pctText(band.falseNegativeRate)}`,
  ];
}

/**
 * Renders the Gate1 Threshold Evidence section for /scan_blockers full.
 * ALWAYS returns the section (never null) — with no/insufficient samples it renders the
 * INSUFFICIENT_SAMPLE / OBSERVE_MORE skeleton (all bands N/A). Distinct from "Gate3 Threshold Evidence".
 */
export function formatGate1ThresholdEvidenceSection(
  report?: Gate1ThresholdEvidenceReport | null,
): string {
  const r = report ?? buildGate1ThresholdEvidenceReport();
  const lines: string[] = [
    'Gate1 Threshold Evidence',
    '------------------------',
    `window: ${r.window}`,
    `totalSamples: ${intText(r.totalSamples)}`,
    `matureSamplesD1: ${intText(r.matureSamplesD1)}`,
    `matureSamplesD3: ${intText(r.matureSamplesD3)}`,
    `matureSamplesD5: ${intText(r.matureSamplesD5)}`,
    `thresholdAutoChanged: ${r.thresholdAutoChanged}`,
    `operatorApprovalRequired: ${r.operatorApprovalRequired}`,
    `liveExecutionAllowed: ${r.liveExecutionAllowed}`,
    `executionImpact: ${r.executionImpact}`,
    `confidence: ${r.confidence}`,
    `recommendedAction: ${r.recommendedAction}`,
    '',
    'scoreBandTable:',
  ];
  for (const key of GATE1_SCORE_BAND_ORDER) {
    lines.push(...formatBandBlock(key, r.scoreBandTable[key]));
  }
  lines.push(
    '',
    'Regime Split:',
    `- R3_EARLY: ${intText(r.regimeSplit.R3_EARLY)}`,
    `- R5_CAUTION: ${intText(r.regimeSplit.R5_CAUTION)}`,
    `- R6_RECOVERY_WATCH: ${intText(r.regimeSplit.R6_RECOVERY_WATCH)}`,
    `- SHADOW_ONLY: ${intText(r.regimeSplit.SHADOW_ONLY)}`,
    '',
    'Data Quality Split:',
    `- FULL_COMPUTED: ${intText(r.dataQualitySplit.FULL_COMPUTED)}`,
    `- SKELETON_ONLY: ${intText(r.dataQualitySplit.SKELETON_ONLY)}`,
    `- supplyGateScoreEligible=true: ${intText(r.dataQualitySplit.supplyGateScoreEligibleTrue)}`,
    `- supplyGateScoreEligible=false: ${intText(r.dataQualitySplit.supplyGateScoreEligibleFalse)}`,
  );
  return lines.join('\n');
}
