/**
 * @responsibility 단일 SourceSnapshot에서 공통 게이트·정책·진단 결과를 산출하는 SSOT 파이프라인을 정의한다.
 */

export type MarketSession = 'REGULAR' | 'AFTERMARKET';
export type DisplaySession = 'REGULAR' | 'AFTERMARKET_SELL_ONLY';
export type EntryBlockMode = 'NORMAL' | 'R6_DEFENSE_SELL_ONLY' | 'SELL_ONLY';
type TechnicalIndicatorStatus = 'COMPUTED' | 'PARTIAL' | 'NOT_COMPUTED' | 'MISSING' | 'STALE';

export interface CandidateSnapshot {
  snapshotId: string;
  candidateId: string;
  symbol: string;
  name: string;
  market: string;
  source: string;
  candidateReason: string[];
}

export interface FeatureSnapshot {
  snapshotId: string;
  symbol: string;
  quoteStatus: 'VERIFIED' | 'MISSING';
  tradableStatus: 'TRADABLE' | 'UNTRADABLE';
  liquidityStatus: 'PASS' | 'FAIL';
  technicalIndicators: {
    status: TechnicalIndicatorStatus;
    source: 'COMPUTED_FROM_KIS_OHLCV' | 'COMPUTED_FROM_OTHER_OHLCV' | 'NOT_COMPUTED';
    technicalTrend?: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    rowsComputed?: number;
    requiredCandles?: number;
    missingReasons?: string[];
  };
  ohlcvDaily?: {
    status: 'VERIFIED' | 'PARTIAL' | 'NOT_FETCHED';
    rows: number;
    requiredCandles: number;
    apiPath?: string;
    trId?: string;
    outputShape?: string;
  };
}

export interface CommonGateResult {
  snapshotId: string;
  symbol: string;
  gate1Result: 'OK' | 'DATA_INCOMPLETE';
  gate2Result: 'PASS' | 'DATA_INCOMPLETE';
  gate3Result: 'PASS' | 'WARN';
  quoteStatus: FeatureSnapshot['quoteStatus'];
  technicalIndicatorStatus: TechnicalIndicatorStatus;
  qualityDecision: 'PASS' | 'FAIL';
  reasons: string[];
  sessionAgnostic: true;
}

export interface PolicyResult {
  snapshotId: string;
  liveBuyAllowed: boolean;
  liveSellAllowed: boolean;
  realOrderAllowed: boolean;
  shadowSignalAllowed: boolean;
  diagnosticAllowed: boolean;
  counterfactualAllowed: boolean;
  entryBlockMode: EntryBlockMode;
  blockReasons: string[];
  legacyIgnoredReasons?: string[];
  legacyPolicyInputs?: string[];
  legacyPolicyIgnored: true;
  policyStatus: 'LIVE_ALLOWED' | 'LIVE_BLOCKED_ONLY';
}

export interface GateDiagnostics {
  gateStatus: CommonGateResult['gate1Result'];
  sessionAgnostic: true;
  quote: FeatureSnapshot['quoteStatus'];
  tradable: FeatureSnapshot['tradableStatus'];
  liquidity: FeatureSnapshot['liquidityStatus'];
  technicalStatus: TechnicalIndicatorStatus;
  dataIssues: string[];
}

export interface PolicyDiagnostics {
  policyStatus: PolicyResult['policyStatus'];
  marketSession: MarketSession;
  displaySession: DisplaySession;
  entryBlockMode: EntryBlockMode;
  blockReasons: string[];
  legacyIgnoredReasons?: string[];
  legacyPolicyInputs?: string[];
  legacyPolicyIgnored: true;
}

export function evaluateCommonGate(input: { snapshotId: string; candidate: CandidateSnapshot; feature: FeatureSnapshot }): CommonGateResult {
  const reasons: string[] = [];
  const techMissingReasons = Array.from(new Set(input.feature.technicalIndicators.missingReasons ?? []));
  const ohlcvNotFetched = input.feature.ohlcvDaily?.status === 'NOT_FETCHED';
  const gate1Result = input.feature.quoteStatus === 'VERIFIED' && input.feature.tradableStatus === 'TRADABLE' && input.feature.liquidityStatus === 'PASS' ? 'OK' : 'DATA_INCOMPLETE';
  const gate2Result = (input.feature.technicalIndicators.status === 'MISSING' || ohlcvNotFetched) ? 'DATA_INCOMPLETE' : 'PASS';
  const gate3Result = input.feature.technicalIndicators.status === 'COMPUTED' ? 'PASS' : 'WARN';
  if (input.feature.technicalIndicators.status !== 'COMPUTED') reasons.push('technicalTrendMissing');
  reasons.push(...techMissingReasons);
  if (ohlcvNotFetched) reasons.push('OHLCV_PROVIDER_NOT_CALLED');
  return {
    snapshotId: input.snapshotId,
    symbol: input.candidate.symbol,
    gate1Result,
    gate2Result,
    gate3Result,
    quoteStatus: input.feature.quoteStatus,
    technicalIndicatorStatus: input.feature.technicalIndicators.status,
    qualityDecision: gate1Result === 'OK' ? 'PASS' : 'FAIL',
    reasons,
    sessionAgnostic: true,
  };
}

export function resolvePolicy(input: {
  snapshotId: string;
  commonGateResult: CommonGateResult;
  marketSession: MarketSession;
  displaySession: DisplaySession;
  entryBlockMode: EntryBlockMode;
}): PolicyResult {
  const legacyPolicyInputs: string[] = [];
  if (input.displaySession === 'AFTERMARKET_SELL_ONLY') {
    legacyPolicyInputs.push('AFTERMARKET_SELL_ONLY_REMOVED');
  }
  if (input.entryBlockMode === 'SELL_ONLY') {
    legacyPolicyInputs.push('SELL_ONLY_REMOVED');
  }
  if (input.entryBlockMode === 'R6_DEFENSE_SELL_ONLY') {
    legacyPolicyInputs.push('R6_DEFENSE_SELL_ONLY_REMOVED');
  }
  const liveBuyAllowed = input.commonGateResult.qualityDecision === 'PASS';
  const blockReasons = liveBuyAllowed ? [] : ['COMMON_GATE_QUALITY_FAIL'];
  const uniqueLegacyPolicyInputs = Array.from(new Set(legacyPolicyInputs));

  return {
    snapshotId: input.snapshotId,
    liveBuyAllowed,
    liveSellAllowed: true,
    realOrderAllowed: liveBuyAllowed,
    shadowSignalAllowed: true,
    diagnosticAllowed: true,
    counterfactualAllowed: true,
    entryBlockMode: 'NORMAL',
    blockReasons,
    legacyIgnoredReasons: uniqueLegacyPolicyInputs,
    legacyPolicyInputs: uniqueLegacyPolicyInputs,
    legacyPolicyIgnored: true,
    policyStatus: liveBuyAllowed ? 'LIVE_ALLOWED' : 'LIVE_BLOCKED_ONLY',
  };
}

export function buildGate1Diag(result: CommonGateResult, feature: FeatureSnapshot): GateDiagnostics {
  const technicalStatus = feature.technicalIndicators.status;
  const sourceReasons = feature.technicalIndicators.missingReasons ?? [];
  const ohlcvNotFetched = feature.ohlcvDaily?.status === 'NOT_FETCHED';
  const dataIssues = Array.from(new Set([
    ...sourceReasons,
    ...(technicalStatus !== 'COMPUTED' ? ['technicalTrendMissing'] : []),
    ...(ohlcvNotFetched ? ['OHLCV_PROVIDER_NOT_CALLED'] : []),
  ]));

  return {
    gateStatus: result.gate1Result,
    sessionAgnostic: true,
    quote: feature.quoteStatus,
    tradable: feature.tradableStatus,
    liquidity: feature.liquidityStatus,
    technicalStatus,
    dataIssues,
  };
}

export function buildPolicyDiag(policy: PolicyResult, marketSession: MarketSession, displaySession: DisplaySession): PolicyDiagnostics {
  return {
    policyStatus: policy.policyStatus,
    marketSession,
    displaySession: 'REGULAR',
    entryBlockMode: policy.entryBlockMode,
    blockReasons: policy.blockReasons,
    legacyIgnoredReasons: policy.legacyIgnoredReasons,
    legacyPolicyInputs: policy.legacyPolicyInputs,
    legacyPolicyIgnored: policy.legacyPolicyIgnored,
  };
}

export function hashCommonGate(result: CommonGateResult): string {
  return JSON.stringify(result);
}

export function hashPolicy(result: PolicyResult): string {
  return JSON.stringify(result);
}
