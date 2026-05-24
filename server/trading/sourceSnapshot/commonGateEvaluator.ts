// @responsibility Source Snapshot SSOT common gate evaluator. No session/execution-policy inputs.

export type CommonGateStatus = 'OK' | 'DATA_INCOMPLETE' | 'WARN';
export type TechnicalLayerStatus = 'COMPUTED' | 'PARTIAL' | 'NOT_COMPUTED' | 'MISSING' | 'UNKNOWN';

export interface CandidateSnapshot {
  symbol: string;
  quoteStatus?: 'VERIFIED' | 'DEGRADED' | 'MISSING' | 'STALE' | 'UNKNOWN';
  tradabilityStatus?: 'TRADABLE' | 'HALTED' | 'SUSPENDED' | 'UNKNOWN';
  liquidityStatus?: 'PASS' | 'WARN' | 'FAIL' | 'UNKNOWN';
}

export interface FeatureSnapshot {
  technicalIndicators?: {
    status?: TechnicalLayerStatus;
    ma20?: number | null;
    ma60?: number | null;
    rsi14?: number | null;
    atr14?: number | null;
  } | null;
}

export interface EvaluateCommonGateInput {
  snapshotId: string;
  candidate: CandidateSnapshot;
  feature?: FeatureSnapshot | null;
}

export interface CommonGateResult {
  snapshotId: string;
  symbol: string;
  gateStatus: CommonGateStatus;
  sessionAgnostic: true;
  inputs: 'OK' | 'MISSING';
  quote: string;
  tradable: string;
  liquidity: string;
  technicalStatus: TechnicalLayerStatus;
  dataIssues: string[];
}

function finite(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

function resolveTechnicalStatus(feature?: FeatureSnapshot | null): TechnicalLayerStatus {
  const technical = feature?.technicalIndicators;
  if (!technical) return 'NOT_COMPUTED';
  if (technical.status) return technical.status;
  const required = [technical.ma20, technical.ma60, technical.rsi14, technical.atr14];
  const computed = required.filter(finite).length;
  if (computed === required.length) return 'COMPUTED';
  if (computed > 0) return 'PARTIAL';
  return 'MISSING';
}

export function evaluateCommonGate(input: EvaluateCommonGateInput): CommonGateResult {
  const quote = input.candidate.quoteStatus ?? 'UNKNOWN';
  const tradable = input.candidate.tradabilityStatus ?? 'UNKNOWN';
  const liquidity = input.candidate.liquidityStatus ?? 'UNKNOWN';
  const technicalStatus = resolveTechnicalStatus(input.feature);
  const hardDataIssues = [
    quote === 'MISSING' || quote === 'UNKNOWN' ? `quote=${quote}` : null,
    tradable !== 'TRADABLE' ? `tradable=${tradable}` : null,
    liquidity === 'FAIL' ? `liquidity=${liquidity}` : null,
  ].filter((issue): issue is string => issue != null);
  const dataIssues = [
    ...hardDataIssues,
    quote !== 'VERIFIED' && quote !== 'MISSING' && quote !== 'UNKNOWN' ? `quote=${quote}` : null,
    liquidity !== 'PASS' && liquidity !== 'FAIL' ? `liquidity=${liquidity}` : null,
    technicalStatus !== 'COMPUTED' ? `technicalIndicators=${technicalStatus}:diagnosticOnly` : null,
  ].filter((issue): issue is string => issue != null);

  return {
    snapshotId: input.snapshotId,
    symbol: input.candidate.symbol,
    gateStatus: hardDataIssues.length > 0 ? 'DATA_INCOMPLETE' : dataIssues.length > 0 ? 'WARN' : 'OK',
    sessionAgnostic: true,
    inputs: quote === 'MISSING' || tradable === 'UNKNOWN' ? 'MISSING' : 'OK',
    quote,
    tradable,
    liquidity,
    technicalStatus,
    dataIssues,
  };
}
