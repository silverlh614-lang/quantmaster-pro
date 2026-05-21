export type MarketSession = 'REGULAR' | 'AFTERMARKET';
export type DisplaySession = 'REGULAR' | 'AFTERMARKET_SELL_ONLY';
export type EntryBlockMode = 'NORMAL' | 'R6_DEFENSE_SELL_ONLY' | 'SELL_ONLY';
export type TechnicalIndicatorStatus = 'COMPUTED' | 'PARTIAL' | 'NOT_COMPUTED' | 'MISSING' | 'STALE';

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
  };
}

export interface UnifiedSourceSnapshot {
  snapshotId: string;
  asOf: string;
  marketSession: MarketSession;
  displaySession: DisplaySession;
  candidates: CandidateSnapshot[];
  featuresBySymbol: Record<string, FeatureSnapshot>;
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
  policyStatus: 'LIVE_ALLOWED' | 'LIVE_BLOCKED_ONLY';
}

export interface GateDiagnostics {
  gateStatus: CommonGateResult['gate1Result'];
  sessionAgnostic: true;
  quote: FeatureSnapshot['quoteStatus'];
  tradable: FeatureSnapshot['tradableStatus'];
  liquidity: FeatureSnapshot['liquidityStatus'];
}

export interface PolicyDiagnostics {
  policyStatus: PolicyResult['policyStatus'];
  marketSession: MarketSession;
  displaySession: DisplaySession;
  entryBlockMode: EntryBlockMode;
  blockReasons: string[];
}

export function createSnapshotId(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const base = `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}_${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}`;
  return `scan_${base}_${Math.random().toString(36).slice(2, 7)}`;
}

export function evaluateCommonGate(input: { snapshotId: string; candidate: CandidateSnapshot; feature: FeatureSnapshot }): CommonGateResult {
  const reasons: string[] = [];
  const gate1Result = input.feature.quoteStatus === 'VERIFIED' && input.feature.tradableStatus === 'TRADABLE' && input.feature.liquidityStatus === 'PASS' ? 'OK' : 'DATA_INCOMPLETE';
  const gate2Result = input.feature.technicalIndicators.status === 'MISSING' ? 'DATA_INCOMPLETE' : 'PASS';
  const gate3Result = input.feature.technicalIndicators.status === 'COMPUTED' ? 'PASS' : 'WARN';
  if (input.feature.technicalIndicators.status !== 'COMPUTED') reasons.push('technicalTrendMissing');
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
  const blockReasons: string[] = [];
  let liveBuyAllowed = true;
  if (input.marketSession === 'AFTERMARKET') {
    liveBuyAllowed = false;
    blockReasons.push('AFTERMARKET_BUY_BLOCKED');
  }
  if (input.entryBlockMode === 'R6_DEFENSE_SELL_ONLY' || input.entryBlockMode === 'SELL_ONLY') {
    liveBuyAllowed = false;
    blockReasons.push(input.entryBlockMode);
  }

  return {
    snapshotId: input.snapshotId,
    liveBuyAllowed,
    liveSellAllowed: true,
    realOrderAllowed: liveBuyAllowed,
    shadowSignalAllowed: true,
    diagnosticAllowed: true,
    counterfactualAllowed: true,
    entryBlockMode: input.entryBlockMode,
    blockReasons,
    policyStatus: liveBuyAllowed ? 'LIVE_ALLOWED' : 'LIVE_BLOCKED_ONLY',
  };
}

export function buildGate1Diag(result: CommonGateResult, feature: FeatureSnapshot): GateDiagnostics {
  return {
    gateStatus: result.gate1Result,
    sessionAgnostic: true,
    quote: feature.quoteStatus,
    tradable: feature.tradableStatus,
    liquidity: feature.liquidityStatus,
  };
}

export function buildPolicyDiag(policy: PolicyResult, marketSession: MarketSession, displaySession: DisplaySession): PolicyDiagnostics {
  return {
    policyStatus: policy.policyStatus,
    marketSession,
    displaySession,
    entryBlockMode: policy.entryBlockMode,
    blockReasons: policy.blockReasons,
  };
}

export function hashCommonGate(result: CommonGateResult): string {
  return JSON.stringify(result);
}

export function hashPolicy(result: PolicyResult): string {
  return JSON.stringify(result);
}
