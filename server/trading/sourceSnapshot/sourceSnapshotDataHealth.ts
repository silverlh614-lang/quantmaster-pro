// @responsibility Source Snapshot data health with technical-trend penalty classification.

export type TechnicalTrendMissingReason =
  | 'KIS_QUOTE_VERIFIED_BUT_OHLCV_NOT_FETCHED'
  | 'KIS_OHLCV_FETCHED_BUT_INDICATOR_NOT_COMPUTED'
  | 'INDICATOR_COMPUTED_BUT_FEATURE_SNAPSHOT_DROPPED'
  | 'FEATURE_SNAPSHOT_PRESENT_BUT_GATE_MAPPING_DROPPED'
  | 'FIELD_PATH_MISMATCH'
  | 'REAL_TECH_DATA_MISSING';

export interface TechnicalTrendMissingClassification {
  total: number;
  reasons: Record<TechnicalTrendMissingReason, number>;
}

export interface DiagnosticPenaltyBreakdown {
  softFailPenalty: number;
  dataPipelineIssue: number;
  wiringDiagnosticOnly: number;
  scoreImpactNotApplied: number;
}

export interface SourceSnapshotDataHealth {
  quote: {
    source: 'KIS_API' | 'UNKNOWN';
    status: 'VERIFIED' | 'MISSING' | 'DEGRADED' | 'STALE' | 'UNKNOWN';
    rows: string;
  };
  ohlcvDaily: {
    source: 'KIS_API' | 'NONE' | 'UNKNOWN';
    status: 'NOT_FETCHED' | 'VERIFIED' | 'MISSING' | 'STALE';
    rows: string;
    requiredCandles: number;
  };
  technicalIndicators: {
    status: 'NOT_COMPUTED' | 'COMPUTED' | 'PARTIAL' | 'MISSING';
    rowsComputed: string;
    source: 'COMPUTED_FROM_KIS_OHLCV' | 'NOT_COMPUTED';
    missingReason: string | null;
  };
}

const EMPTY_REASONS: Record<TechnicalTrendMissingReason, number> = {
  KIS_QUOTE_VERIFIED_BUT_OHLCV_NOT_FETCHED: 0,
  KIS_OHLCV_FETCHED_BUT_INDICATOR_NOT_COMPUTED: 0,
  INDICATOR_COMPUTED_BUT_FEATURE_SNAPSHOT_DROPPED: 0,
  FEATURE_SNAPSHOT_PRESENT_BUT_GATE_MAPPING_DROPPED: 0,
  FIELD_PATH_MISMATCH: 0,
  REAL_TECH_DATA_MISSING: 0,
};

export function emptyTechnicalTrendMissingClassification(): TechnicalTrendMissingClassification {
  return {
    total: 0,
    reasons: { ...EMPTY_REASONS },
  };
}

export function classifyTechnicalTrendMissing(input: {
  quoteVerified: boolean;
  ohlcvFetched: boolean;
  indicatorComputed: boolean;
  featureSnapshotPresent: boolean;
  gateMappingPresent: boolean;
  fieldPathMismatch?: boolean;
}): TechnicalTrendMissingReason {
  if (input.fieldPathMismatch) return 'FIELD_PATH_MISMATCH';
  if (input.indicatorComputed && !input.featureSnapshotPresent) return 'INDICATOR_COMPUTED_BUT_FEATURE_SNAPSHOT_DROPPED';
  if (input.featureSnapshotPresent && !input.gateMappingPresent) return 'FEATURE_SNAPSHOT_PRESENT_BUT_GATE_MAPPING_DROPPED';
  if (input.ohlcvFetched && !input.indicatorComputed) return 'KIS_OHLCV_FETCHED_BUT_INDICATOR_NOT_COMPUTED';
  if (input.quoteVerified && !input.ohlcvFetched) return 'KIS_QUOTE_VERIFIED_BUT_OHLCV_NOT_FETCHED';
  return 'REAL_TECH_DATA_MISSING';
}

export function buildDiagnosticPenaltyBreakdown(
  classification: TechnicalTrendMissingClassification,
): DiagnosticPenaltyBreakdown {
  const dataPipelineIssue = classification.reasons.KIS_QUOTE_VERIFIED_BUT_OHLCV_NOT_FETCHED
    + classification.reasons.KIS_OHLCV_FETCHED_BUT_INDICATOR_NOT_COMPUTED;
  const wiringDiagnosticOnly = classification.reasons.INDICATOR_COMPUTED_BUT_FEATURE_SNAPSHOT_DROPPED
    + classification.reasons.FEATURE_SNAPSHOT_PRESENT_BUT_GATE_MAPPING_DROPPED
    + classification.reasons.FIELD_PATH_MISMATCH;
  return {
    softFailPenalty: classification.reasons.REAL_TECH_DATA_MISSING,
    dataPipelineIssue,
    wiringDiagnosticOnly,
    scoreImpactNotApplied: dataPipelineIssue + wiringDiagnosticOnly,
  };
}

export function buildSourceSnapshotDataHealth(input: {
  totalCandidates: number;
  quoteVerifiedRows?: number;
  ohlcvDailyRows?: number;
  technicalIndicatorRowsComputed?: number;
  requiredCandles?: number;
}): SourceSnapshotDataHealth {
  const total = Math.max(0, Math.floor(input.totalCandidates));
  const quoteRows = Math.max(0, Math.floor(input.quoteVerifiedRows ?? 0));
  const ohlcvRows = Math.max(0, Math.floor(input.ohlcvDailyRows ?? 0));
  const indicatorRows = Math.max(0, Math.floor(input.technicalIndicatorRowsComputed ?? 0));
  const ohlcvStatus = ohlcvRows === 0 ? 'NOT_FETCHED' : ohlcvRows >= total ? 'VERIFIED' : 'MISSING';
  const technicalStatus = indicatorRows === 0
    ? 'NOT_COMPUTED'
    : indicatorRows >= total
      ? 'COMPUTED'
      : 'PARTIAL';

  return {
    quote: {
      source: quoteRows > 0 ? 'KIS_API' : 'UNKNOWN',
      status: quoteRows >= total && total > 0 ? 'VERIFIED' : quoteRows > 0 ? 'DEGRADED' : 'UNKNOWN',
      rows: `${quoteRows}/${total}`,
    },
    ohlcvDaily: {
      source: ohlcvRows > 0 ? 'KIS_API' : 'NONE',
      status: ohlcvStatus,
      rows: `${ohlcvRows}/${total}`,
      requiredCandles: input.requiredCandles ?? 60,
    },
    technicalIndicators: {
      status: technicalStatus,
      rowsComputed: `${indicatorRows}/${total}`,
      source: indicatorRows > 0 ? 'COMPUTED_FROM_KIS_OHLCV' : 'NOT_COMPUTED',
      missingReason: technicalStatus === 'NOT_COMPUTED' ? 'OHLCV_LAYER_NOT_READY' : null,
    },
  };
}
