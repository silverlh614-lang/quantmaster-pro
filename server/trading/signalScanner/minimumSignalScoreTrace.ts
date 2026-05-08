/**
 * @responsibility ADR-0466 Minimum Signal Score Decomposition diagnostics.
 *
 * Counterfactual/advisory-only score tracing for Gate1 minimum signal score.
 * Does not relax thresholds, route orders, or mutate trading state.
 */
import type { MacroGateState } from './scanDiagnostics.js';
import type { CandidateEntryTrace, Gate1CandidateTrace, Gate1ConditionTrace, SupplyConfluenceState, SupplyProviderHealthTrace } from './entryFilterDecomposition.js';

export type SignalScoreComponentCode =
  | 'PRICE_MOMENTUM'
  | 'VOLUME_LIQUIDITY'
  | 'TECHNICAL_TREND'
  | 'RELATIVE_STRENGTH'
  | 'SUPPLY_CONFLUENCE'
  | 'INVESTOR_FLOW'
  | 'SECTOR_ENERGY'
  | 'MARKET_REGIME'
  | 'MACRO_RISK'
  | 'DATA_QUALITY'
  | 'SESSION_STATUS'
  | 'NEWS_OR_CATALYST'
  | 'WATCHLIST_PRIORITY'
  | 'RISK_PENALTY'
  | 'UNKNOWN_DATA_PENALTY'
  | 'SOFT_FAIL_PENALTY'
  | 'OTHER';

export type SignalScoreComponentConfidence =
  | 'VERIFIED'
  | 'DEGRADED'
  | 'STALE'
  | 'UNKNOWN'
  | 'MISSING'
  | 'DIAGNOSTIC_ONLY';

export interface SignalScoreComponentTrace {
  code: SignalScoreComponentCode;
  rawValue?: unknown;
  normalizedScore: number;
  weight: number;
  weightedScore: number;
  maxScore: number;
  contributionPct: number;
  confidence: SignalScoreComponentConfidence;
  providerIssue: boolean;
  marketSignal: boolean;
  penaltyApplied: boolean;
  penaltyReason?: string;
  message: string;
}

export interface MinimumSignalScoreTrace {
  symbol: string;
  name?: string;
  requiredScore: number;
  actualScore: number;
  scoreGap: number;
  passed: boolean;
  components: SignalScoreComponentTrace[];
  positiveScoreTotal: number;
  penaltyTotal: number;
  unknownPenaltyTotal: number;
  providerIssuePenaltyTotal: number;
  sessionPenaltyTotal: number;
  sectorPenaltyTotal: number;
  riskPenaltyTotal: number;
  softFailPenaltyTotal: number;
  topMissingContributors: string[];
  topPenaltyContributors: string[];
  wouldPassIfUnknownNeutral: boolean;
  wouldPassIfProviderPenaltyRemoved: boolean;
  wouldPassIfSessionPenaltyRemoved: boolean;
  wouldPassIfRiskPenaltyCapped: boolean;
  wouldPassIfSectorPenaltyRemoved: boolean;
  wouldPassIfSoftFailPenaltyRemoved: boolean;
}

export type UnknownDataTreatment = 'NEUTRAL' | 'EXCLUDED_FROM_DENOMINATOR' | 'ZERO_SCORE' | 'PENALTY' | 'BEARISH_EQUIVALENT';

export interface UnknownDataTreatmentAudit {
  symbol: string;
  unknownFields: {
    field: string;
    treatment: UnknownDataTreatment;
    scoreImpact: number;
    allowed: boolean;
    message: string;
  }[];
  hasBearishEquivalentUnknown: boolean;
  totalUnknownScoreImpact: number;
}

export type SoftFailCode =
  | 'PROVIDER_UNKNOWN'
  | 'SUPPLY_UNKNOWN'
  | 'SECTOR_DIAGNOSTIC'
  | 'MIN_SIGNAL_GAP'
  | 'DATA_STALE'
  | 'RISK_PENALTY'
  | 'SESSION_SOFT_BLOCK'
  | 'LOW_CONFIDENCE'
  | 'OTHER';

export interface SoftFailAccumulationTrace {
  symbol: string;
  softFails: {
    code: SoftFailCode;
    weight: number;
    severityScore: number;
    reason: string;
    providerIssue: boolean;
    marketSignal: boolean;
  }[];
  totalSoftFailScore: number;
  softFailThreshold: number;
  failedBySoftAccumulation: boolean;
  wouldPassIfProviderSoftFailsExcluded: boolean;
  wouldPassIfSessionSoftFailsExcluded: boolean;
  wouldPassIfSectorSoftFailsExcluded: boolean;
  wouldPassIfRiskSoftFailsCapped: boolean;
}

export interface RiskPenaltyTrace {
  symbol: string;
  regimeMultiplier: number;
  fomcMultiplier: number;
  sectorMultiplier: number;
  riskMultiplier: number;
  finalKelly: number;
  signalScoreRiskPenalty: number;
  sizingRiskPenalty: number;
  doubleCountWarning: boolean;
  wouldPassIfRiskPenaltyCapped: boolean;
}

export type SignalScoreCalibrationScenario =
  | 'UNKNOWN_NEUTRAL'
  | 'PROVIDER_PENALTY_REMOVED'
  | 'SESSION_PENALTY_REMOVED'
  | 'RISK_PENALTY_CAPPED'
  | 'SECTOR_PENALTY_REMOVED'
  | 'SOFT_FAIL_PENALTY_REMOVED'
  | 'MIN_SIGNAL_THRESHOLD_MINUS_5'
  | 'MIN_SIGNAL_THRESHOLD_MINUS_10'
  | 'R3_EARLY_ADAPTIVE_THRESHOLD';

export interface SignalScoreCalibrationResult {
  scenario: SignalScoreCalibrationScenario;
  hypotheticalSurvivors: number;
  survivorExamples: {
    symbol: string;
    name?: string;
    actualScore: number;
    adjustedScore: number;
    requiredScore: number;
    reason: string[];
  }[];
  executionImpact: 'NONE';
}

export interface MinSignalScoreDecompositionReport {
  timestamp: string;
  forDate: string;
  regime: string;
  marketSession: string;
  totalCandidates: number;
  minSignalFailed: number;
  requiredScoreAvg: number;
  actualScoreAvg: number;
  actualScoreMin: number;
  actualScoreMax: number;
  avgScoreGap: number;
  topScoreDeficits: { code: SignalScoreComponentCode; avgImpact: number; affectedCount: number }[];
  topPenaltyContributors: { code: SignalScoreComponentCode; avgPenalty: number; affectedCount: number }[];
  unknownTreatmentWarnings: number;
  wouldPassIfUnknownNeutral: number;
  wouldPassIfProviderPenaltyRemoved: number;
  wouldPassIfSessionPenaltyRemoved: number;
  wouldPassIfRiskPenaltyCapped: number;
  wouldPassIfSoftFailPenaltyRemoved: number;
  recommendedAction:
    | 'NO_ACTION'
    | 'DIAGNOSTIC_ONLY'
    | 'FIX_UNKNOWN_TREATMENT'
    | 'REMOVE_SESSION_FROM_SIGNAL_SCORE'
    | 'CAP_RISK_PENALTY'
    | 'REVIEW_MIN_SIGNAL_THRESHOLD'
    | 'REVIEW_SOFT_FAIL_ACCUMULATION';
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function component(input: Omit<SignalScoreComponentTrace, 'contributionPct'>): SignalScoreComponentTrace {
  return {
    ...input,
    contributionPct: input.maxScore === 0 ? 0 : round1((input.weightedScore / input.maxScore) * 100),
  };
}

export function buildMinimumSignalScoreTrace(input: {
  trace: CandidateEntryTrace;
  hasGate1Blocker: boolean;
  regime: string;
  marketSession: string;
  macroGateState?: MacroGateState;
  supplyProviderHealth: SupplyProviderHealthTrace;
  supplyConfluenceState: SupplyConfluenceState;
  hasSectorEnergyDiagnostic: boolean;
}): MinimumSignalScoreTrace {
  const requiredScore = input.trace.minSignalRequiredScore ?? 70;
  const riskMultiplier = input.macroGateState?.finalKellyMultiplier !== undefined
    ? input.macroGateState.finalKellyMultiplier / Math.max(0.000001, (input.macroGateState.kellyMultiplierFromRegime || 1) * (input.macroGateState.fomcKellyMultiplier || 1))
    : 1;
  const riskPenalty = riskMultiplier < 0.8 ? -round1((0.8 - riskMultiplier) * 15) : 0;
  const supplyUnknown = input.supplyConfluenceState === 'UNKNOWN' || input.supplyConfluenceState === 'UNAVAILABLE';
  const supplyBearish = input.supplyConfluenceState === 'BEARISH';
  const investorUnknown = input.supplyProviderHealth.status !== 'VERIFIED';
  const softFailPenalty = input.hasGate1Blocker ? -5 : 0;
  const components: SignalScoreComponentTrace[] = [
    component({
      code: 'PRICE_MOMENTUM',
      rawValue: input.trace.gateScore,
      normalizedScore: input.trace.gateScore ?? (input.hasGate1Blocker ? 9 : 15),
      weight: 1,
      weightedScore: input.trace.gateScore !== undefined ? Math.min(20, Math.max(0, input.trace.gateScore * 0.25)) : (input.hasGate1Blocker ? 9 : 15),
      maxScore: 20,
      confidence: input.trace.priceDataFresh === false ? 'STALE' : 'VERIFIED',
      providerIssue: false,
      marketSignal: false,
      penaltyApplied: input.trace.priceDataFresh === false,
      penaltyReason: input.trace.priceDataFresh === false ? 'PRICE_DATA_STALE' : undefined,
      message: 'Price momentum contribution is recorded separately from provider/session blockers.',
    }),
    component({
      code: 'VOLUME_LIQUIDITY',
      rawValue: input.trace.volumeLiquidityPassed,
      normalizedScore: input.trace.volumeLiquidityPassed === false ? 4 : 12,
      weight: 1,
      weightedScore: input.trace.volumeLiquidityPassed === false ? 4 : 12,
      maxScore: 12,
      confidence: input.trace.volumeLiquidityPassed === false ? 'DEGRADED' : 'VERIFIED',
      providerIssue: false,
      marketSignal: input.trace.volumeLiquidityPassed === false,
      penaltyApplied: input.trace.volumeLiquidityPassed === false,
      penaltyReason: input.trace.volumeLiquidityPassed === false ? 'LIQUIDITY_LOW' : undefined,
      message: 'Liquidity contribution is a market-signal component only when actual liquidity is low.',
    }),
    component({ code: 'TECHNICAL_TREND', normalizedScore: input.hasGate1Blocker ? 8 : 14, weight: 1, weightedScore: input.hasGate1Blocker ? 8 : 14, maxScore: 14, confidence: 'VERIFIED', providerIssue: false, marketSignal: false, penaltyApplied: false, message: 'Technical trend proxy from legacy Gate1 path.' }),
    component({ code: 'RELATIVE_STRENGTH', normalizedScore: input.hasGate1Blocker ? 6 : 10, weight: 1, weightedScore: input.hasGate1Blocker ? 6 : 10, maxScore: 10, confidence: 'VERIFIED', providerIssue: false, marketSignal: false, penaltyApplied: false, message: 'Relative strength proxy from candidate ranking.' }),
    component({ code: 'WATCHLIST_PRIORITY', normalizedScore: input.trace.symbol === 'UNIVERSE_SUMMARY' ? 0 : 8, weight: 1, weightedScore: input.trace.symbol === 'UNIVERSE_SUMMARY' ? 0 : 8, maxScore: 8, confidence: input.trace.symbol === 'UNIVERSE_SUMMARY' ? 'MISSING' : 'VERIFIED', providerIssue: false, marketSignal: false, penaltyApplied: input.trace.symbol === 'UNIVERSE_SUMMARY', penaltyReason: input.trace.symbol === 'UNIVERSE_SUMMARY' ? 'WATCHLIST_MISSING' : undefined, message: 'Watchlist row priority contribution.' }),
    component({
      code: 'SUPPLY_CONFLUENCE',
      rawValue: input.supplyConfluenceState,
      normalizedScore: input.supplyConfluenceState === 'BULLISH' ? 8 : input.supplyConfluenceState === 'NEUTRAL' ? 4 : 0,
      weight: 1,
      weightedScore: input.supplyConfluenceState === 'BULLISH' ? 8 : input.supplyConfluenceState === 'NEUTRAL' ? 4 : supplyBearish ? -10 : -10,
      maxScore: 8,
      confidence: supplyUnknown ? 'UNKNOWN' : 'VERIFIED',
      providerIssue: supplyUnknown,
      marketSignal: supplyBearish,
      penaltyApplied: supplyUnknown || supplyBearish,
      penaltyReason: supplyBearish ? 'ACTUAL_BEARISH_SUPPLY' : supplyUnknown ? 'UNKNOWN_SUPPLY_CONFLUENCE_CONFIDENCE_PENALTY_NOT_BEARISH' : undefined,
      message: supplyUnknown ? 'UNKNOWN supply confluence is penalized for confidence only; it is not bearish-equivalent.' : 'Supply confluence contribution.',
    }),
    component({
      code: 'INVESTOR_FLOW',
      rawValue: input.supplyProviderHealth.status,
      normalizedScore: investorUnknown ? 0 : 8,
      weight: 1,
      weightedScore: investorUnknown ? -8 : 8,
      maxScore: 8,
      confidence: investorUnknown ? (input.supplyProviderHealth.status === 'NO_RECENT_SAMPLE' ? 'STALE' : 'UNKNOWN') : 'VERIFIED',
      providerIssue: investorUnknown,
      marketSignal: false,
      penaltyApplied: investorUnknown,
      penaltyReason: investorUnknown ? 'PROVIDER_ISSUE_INVESTOR_FLOW_UNKNOWN_NOT_MARKET_WEAKNESS' : undefined,
      message: investorUnknown ? 'Investor-flow UNKNOWN/STALE is provider issue, not market bearishness.' : 'Investor-flow sample verified.',
    }),
    component({
      code: 'SECTOR_ENERGY',
      rawValue: input.trace.sectorEnergyState,
      normalizedScore: input.hasSectorEnergyDiagnostic ? 0 : 2,
      weight: 1,
      weightedScore: input.hasSectorEnergyDiagnostic ? -2 : 2,
      maxScore: 2,
      confidence: input.hasSectorEnergyDiagnostic ? 'DIAGNOSTIC_ONLY' : 'VERIFIED',
      providerIssue: input.hasSectorEnergyDiagnostic,
      marketSignal: false,
      penaltyApplied: input.hasSectorEnergyDiagnostic,
      penaltyReason: input.hasSectorEnergyDiagnostic ? 'SECTOR_ENERGY_DIAGNOSTIC_STRONG_BUY_ONLY' : undefined,
      message: input.hasSectorEnergyDiagnostic ? 'SectorEnergy diagnostic penalty is advisory/STRONG_BUY_ONLY scoped.' : 'SectorEnergy confidence verified.',
    }),
    component({ code: 'MARKET_REGIME', rawValue: input.regime, normalizedScore: input.macroGateState?.emergencyStop ? 0 : 6, weight: 1, weightedScore: input.macroGateState?.emergencyStop ? -6 : 6, maxScore: 6, confidence: 'VERIFIED', providerIssue: false, marketSignal: Boolean(input.macroGateState?.emergencyStop), penaltyApplied: Boolean(input.macroGateState?.emergencyStop), penaltyReason: input.macroGateState?.emergencyStop ? 'EMERGENCY_STOP' : undefined, message: 'Market regime contribution; emergency stop is the hard risk signal.' }),
    component({ code: 'SESSION_STATUS', rawValue: input.marketSession, normalizedScore: 0, weight: 0, weightedScore: 0, maxScore: 0, confidence: input.marketSession === 'SELL_ONLY' ? 'DIAGNOSTIC_ONLY' : 'VERIFIED', providerIssue: false, marketSignal: false, penaltyApplied: false, message: 'Session status is execution eligibility only; SELL_ONLY must not reduce signal score.' }),
    component({ code: 'RISK_PENALTY', rawValue: { riskMultiplier }, normalizedScore: riskPenalty, weight: 1, weightedScore: riskPenalty, maxScore: 0, confidence: riskPenalty < 0 ? 'DEGRADED' : 'VERIFIED', providerIssue: false, marketSignal: riskPenalty < 0, penaltyApplied: riskPenalty < 0, penaltyReason: riskPenalty < 0 ? 'LOW_RISK_MULTIPLIER_SIGNAL_CALIBRATION_CHECK' : undefined, message: 'Risk multiplier impact is traced to detect double-counting with Kelly sizing.' }),
    component({ code: 'SOFT_FAIL_PENALTY', rawValue: input.hasGate1Blocker, normalizedScore: softFailPenalty, weight: 1, weightedScore: softFailPenalty, maxScore: 0, confidence: softFailPenalty < 0 ? 'DEGRADED' : 'VERIFIED', providerIssue: false, marketSignal: false, penaltyApplied: softFailPenalty < 0, penaltyReason: softFailPenalty < 0 ? 'LEGACY_GATE1_SOFT_FAIL_ACCUMULATION' : undefined, message: 'Legacy Gate1 aggregate soft fail penalty is separated from hard risk.' }),
  ];
  const computedScore = round1(components.reduce((sum, c) => sum + c.weightedScore, 0));
  const actualScore = input.trace.gateScore !== undefined
    ? input.trace.gateScore
    : input.hasGate1Blocker ? computedScore : Math.max(requiredScore, computedScore);
  const positiveScoreTotal = round1(components.filter((c) => c.weightedScore > 0).reduce((sum, c) => sum + c.weightedScore, 0));
  const penaltyTotal = round1(components.filter((c) => c.weightedScore < 0).reduce((sum, c) => sum + c.weightedScore, 0));
  const unknownPenaltyTotal = round1(components.filter((c) => c.penaltyApplied && ['UNKNOWN', 'MISSING', 'STALE'].includes(c.confidence)).reduce((sum, c) => sum + c.weightedScore, 0));
  const providerIssuePenaltyTotal = round1(components.filter((c) => c.providerIssue && c.weightedScore < 0).reduce((sum, c) => sum + c.weightedScore, 0));
  const sessionPenaltyTotal = round1(components.filter((c) => c.code === 'SESSION_STATUS' && c.weightedScore < 0).reduce((sum, c) => sum + c.weightedScore, 0));
  const sectorPenaltyTotal = round1(components.filter((c) => c.code === 'SECTOR_ENERGY' && c.weightedScore < 0).reduce((sum, c) => sum + c.weightedScore, 0));
  const riskPenaltyTotal = round1(components.filter((c) => c.code === 'RISK_PENALTY' && c.weightedScore < 0).reduce((sum, c) => sum + c.weightedScore, 0));
  const softFailPenaltyTotal = round1(components.filter((c) => c.code === 'SOFT_FAIL_PENALTY' && c.weightedScore < 0).reduce((sum, c) => sum + c.weightedScore, 0));
  const scoreGap = round1(actualScore - requiredScore);
  const passAt = (delta: number) => round1(actualScore - delta) >= requiredScore;
  return {
    symbol: input.trace.symbol,
    name: input.trace.name,
    requiredScore,
    actualScore: round1(actualScore),
    scoreGap,
    passed: actualScore >= requiredScore,
    components,
    positiveScoreTotal,
    penaltyTotal,
    unknownPenaltyTotal,
    providerIssuePenaltyTotal,
    sessionPenaltyTotal,
    sectorPenaltyTotal,
    riskPenaltyTotal,
    softFailPenaltyTotal,
    topMissingContributors: components.filter((c) => ['UNKNOWN', 'MISSING', 'STALE', 'DIAGNOSTIC_ONLY'].includes(c.confidence)).map((c) => c.code).slice(0, 5),
    topPenaltyContributors: components.filter((c) => c.weightedScore < 0).sort((a, b) => a.weightedScore - b.weightedScore).map((c) => c.code).slice(0, 5),
    wouldPassIfUnknownNeutral: passAt(unknownPenaltyTotal),
    wouldPassIfProviderPenaltyRemoved: passAt(providerIssuePenaltyTotal),
    wouldPassIfSessionPenaltyRemoved: passAt(sessionPenaltyTotal),
    wouldPassIfRiskPenaltyCapped: passAt(Math.min(riskPenaltyTotal, -3)),
    wouldPassIfSectorPenaltyRemoved: passAt(sectorPenaltyTotal),
    wouldPassIfSoftFailPenaltyRemoved: passAt(softFailPenaltyTotal),
  };
}

export function buildUnknownDataTreatmentAudit(trace: MinimumSignalScoreTrace): UnknownDataTreatmentAudit {
  const unknownFields = trace.components
    .filter((c) => ['UNKNOWN', 'MISSING', 'STALE', 'DIAGNOSTIC_ONLY'].includes(c.confidence))
    .map((c) => {
      const treatment: UnknownDataTreatment = c.marketSignal && c.providerIssue ? 'BEARISH_EQUIVALENT' : c.weightedScore < 0 ? 'PENALTY' : c.weightedScore === 0 ? 'NEUTRAL' : 'EXCLUDED_FROM_DENOMINATOR';
      return {
        field: c.code,
        treatment,
        scoreImpact: c.weightedScore,
        allowed: treatment !== 'BEARISH_EQUIVALENT',
        message: treatment === 'BEARISH_EQUIVALENT'
          ? `${c.code} UNKNOWN is being treated as bearish-equivalent; audit warning required.`
          : `${c.code} ${c.confidence} treatment=${treatment}; providerIssue=${c.providerIssue}, marketSignal=${c.marketSignal}.`,
      };
    });
  return {
    symbol: trace.symbol,
    unknownFields,
    hasBearishEquivalentUnknown: unknownFields.some((f) => f.treatment === 'BEARISH_EQUIVALENT'),
    totalUnknownScoreImpact: round1(unknownFields.reduce((sum, f) => sum + f.scoreImpact, 0)),
  };
}

function softFailCodeForCondition(condition: Gate1ConditionTrace, minTrace: MinimumSignalScoreTrace): SoftFailCode {
  if (condition.code === 'MIN_SIGNAL_SCORE_PASS') return 'MIN_SIGNAL_GAP';
  if (condition.code === 'TRADING_SESSION_PASS') return 'SESSION_SOFT_BLOCK';
  if (condition.code === 'SUPPLY_CONFLUENCE_PASS') return 'SUPPLY_UNKNOWN';
  if (condition.code === 'SUPPLY_PROVIDER_HEALTH_PASS' || condition.code === 'INVESTOR_FLOW_SAMPLE_PASS') return 'PROVIDER_UNKNOWN';
  if (condition.code === 'SECTOR_ENERGY_CONFIDENCE_PASS') return 'SECTOR_DIAGNOSTIC';
  if (condition.code === 'PRICE_DATA_FRESH_PASS') return 'DATA_STALE';
  if (condition.code === 'RISK_BLOCK_PASS') return 'RISK_PENALTY';
  return 'OTHER';
}

export function buildSoftFailAccumulationTrace(input: {
  symbol: string;
  conditions: Gate1ConditionTrace[];
  minSignalScoreTrace: MinimumSignalScoreTrace;
  threshold: number;
}): SoftFailAccumulationTrace {
  const softFails = input.conditions
    .filter((c) => !c.passed && (c.severity === 'SOFT_FAIL' || c.severity === 'DIAGNOSTIC_ONLY'))
    .map((c) => ({
      code: softFailCodeForCondition(c, input.minSignalScoreTrace),
      weight: c.severity === 'DIAGNOSTIC_ONLY' ? 0.5 : 1,
      severityScore: c.severity === 'DIAGNOSTIC_ONLY' ? 0.5 : 1,
      reason: c.message,
      providerIssue: c.providerIssue,
      marketSignal: c.marketSignal,
    }));
  const totalSoftFailScore = round1(softFails.reduce((sum, f) => sum + f.weight * f.severityScore, 0));
  const without = (predicate: (code: SoftFailCode) => boolean) => round1(softFails.filter((f) => !predicate(f.code)).reduce((sum, f) => sum + f.weight * f.severityScore, 0)) < input.threshold;
  return {
    symbol: input.symbol,
    softFails,
    totalSoftFailScore,
    softFailThreshold: input.threshold,
    failedBySoftAccumulation: totalSoftFailScore >= input.threshold,
    wouldPassIfProviderSoftFailsExcluded: without((code) => code === 'PROVIDER_UNKNOWN' || code === 'SUPPLY_UNKNOWN'),
    wouldPassIfSessionSoftFailsExcluded: without((code) => code === 'SESSION_SOFT_BLOCK'),
    wouldPassIfSectorSoftFailsExcluded: without((code) => code === 'SECTOR_DIAGNOSTIC'),
    wouldPassIfRiskSoftFailsCapped: without((code) => code === 'RISK_PENALTY'),
  };
}

export function buildRiskPenaltyTrace(input: {
  symbol: string;
  macroGateState?: MacroGateState;
  minSignalScoreTrace: MinimumSignalScoreTrace;
}): RiskPenaltyTrace {
  const regimeMultiplier = input.macroGateState?.kellyMultiplierFromRegime ?? 1;
  const fomcMultiplier = input.macroGateState?.fomcKellyMultiplier ?? 1;
  const sectorMultiplier = 1;
  const riskMultiplier = input.macroGateState?.finalKellyMultiplier !== undefined
    ? input.macroGateState.finalKellyMultiplier / Math.max(0.000001, regimeMultiplier * fomcMultiplier)
    : 1;
  const finalKelly = regimeMultiplier * fomcMultiplier * sectorMultiplier * riskMultiplier;
  const signalScoreRiskPenalty = input.minSignalScoreTrace.riskPenaltyTotal;
  const sizingRiskPenalty = riskMultiplier < 1 ? round1((1 - riskMultiplier) * 100) : 0;
  return {
    symbol: input.symbol,
    regimeMultiplier,
    fomcMultiplier,
    sectorMultiplier,
    riskMultiplier,
    finalKelly,
    signalScoreRiskPenalty,
    sizingRiskPenalty,
    doubleCountWarning: signalScoreRiskPenalty < 0 && sizingRiskPenalty > 0,
    wouldPassIfRiskPenaltyCapped: input.minSignalScoreTrace.wouldPassIfRiskPenaltyCapped,
  };
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return round1(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function buildMinSignalScoreDecompositionReport(input: {
  nowIso: string;
  forDate: string;
  regime: string;
  marketSession: string;
  traces: Gate1CandidateTrace[];
}): MinSignalScoreDecompositionReport {
  const minTraces = input.traces.map((t) => t.minSignalScoreTrace).filter((t): t is MinimumSignalScoreTrace => Boolean(t));
  const penaltyByCode = new Map<SignalScoreComponentCode, { total: number; count: number }>();
  const deficitByCode = new Map<SignalScoreComponentCode, { total: number; count: number }>();
  for (const trace of minTraces) {
    for (const c of trace.components) {
      if (c.weightedScore < 0) {
        const current = penaltyByCode.get(c.code) ?? { total: 0, count: 0 };
        current.total += c.weightedScore;
        current.count += 1;
        penaltyByCode.set(c.code, current);
      }
      if (c.confidence !== 'VERIFIED' || c.weightedScore <= 0) {
        const current = deficitByCode.get(c.code) ?? { total: 0, count: 0 };
        current.total += c.weightedScore;
        current.count += 1;
        deficitByCode.set(c.code, current);
      }
    }
  }
  const unknownTreatmentWarnings = input.traces
    .map((t) => t.unknownDataTreatmentAudit)
    .filter((a): a is UnknownDataTreatmentAudit => Boolean(a))
    .filter((a) => a.hasBearishEquivalentUnknown).length;
  const sessionPenaltyCount = minTraces.filter((t) => t.sessionPenaltyTotal < 0).length;
  const riskDoubleCountWarnings = input.traces.filter((t) => t.riskPenaltyTrace?.doubleCountWarning).length;
  const softAccumulationFailures = input.traces.filter((t) => t.softFailAccumulationTrace?.failedBySoftAccumulation).length;
  return {
    timestamp: input.nowIso,
    forDate: input.forDate,
    regime: input.regime,
    marketSession: input.marketSession,
    totalCandidates: minTraces.length,
    minSignalFailed: minTraces.filter((t) => !t.passed).length,
    requiredScoreAvg: average(minTraces.map((t) => t.requiredScore)),
    actualScoreAvg: average(minTraces.map((t) => t.actualScore)),
    actualScoreMin: minTraces.length > 0 ? Math.min(...minTraces.map((t) => t.actualScore)) : 0,
    actualScoreMax: minTraces.length > 0 ? Math.max(...minTraces.map((t) => t.actualScore)) : 0,
    avgScoreGap: average(minTraces.map((t) => t.scoreGap)),
    topScoreDeficits: Array.from(deficitByCode.entries())
      .map(([code, value]) => ({ code, avgImpact: round1(value.total / value.count), affectedCount: value.count }))
      .sort((a, b) => a.avgImpact - b.avgImpact || b.affectedCount - a.affectedCount)
      .slice(0, 5),
    topPenaltyContributors: Array.from(penaltyByCode.entries())
      .map(([code, value]) => ({ code, avgPenalty: round1(value.total / value.count), affectedCount: value.count }))
      .sort((a, b) => a.avgPenalty - b.avgPenalty || b.affectedCount - a.affectedCount)
      .slice(0, 5),
    unknownTreatmentWarnings,
    wouldPassIfUnknownNeutral: minTraces.filter((t) => t.wouldPassIfUnknownNeutral).length,
    wouldPassIfProviderPenaltyRemoved: minTraces.filter((t) => t.wouldPassIfProviderPenaltyRemoved).length,
    wouldPassIfSessionPenaltyRemoved: minTraces.filter((t) => t.wouldPassIfSessionPenaltyRemoved).length,
    wouldPassIfRiskPenaltyCapped: minTraces.filter((t) => t.wouldPassIfRiskPenaltyCapped).length,
    wouldPassIfSoftFailPenaltyRemoved: minTraces.filter((t) => t.wouldPassIfSoftFailPenaltyRemoved).length,
    recommendedAction: unknownTreatmentWarnings > 0
      ? 'FIX_UNKNOWN_TREATMENT'
      : sessionPenaltyCount > 0
        ? 'REMOVE_SESSION_FROM_SIGNAL_SCORE'
        : riskDoubleCountWarnings > 0
          ? 'CAP_RISK_PENALTY'
          : softAccumulationFailures > 0
            ? 'REVIEW_SOFT_FAIL_ACCUMULATION'
            : minTraces.some((t) => !t.passed)
              ? 'REVIEW_MIN_SIGNAL_THRESHOLD'
              : 'NO_ACTION',
  };
}

export function buildSignalScoreCalibrationResults(input: {
  regime: string;
  traces: Gate1CandidateTrace[];
}): SignalScoreCalibrationResult[] {
  const minTraces = input.traces.map((t) => t.minSignalScoreTrace).filter((t): t is MinimumSignalScoreTrace => Boolean(t));
  const scenarioDelta = (trace: MinimumSignalScoreTrace, scenario: SignalScoreCalibrationScenario): { adjustedScore: number; reason: string[] } => {
    switch (scenario) {
      case 'UNKNOWN_NEUTRAL': return { adjustedScore: round1(trace.actualScore - trace.unknownPenaltyTotal), reason: ['UNKNOWN_NEUTRAL_ADVISORY_ONLY'] };
      case 'PROVIDER_PENALTY_REMOVED': return { adjustedScore: round1(trace.actualScore - trace.providerIssuePenaltyTotal), reason: ['PROVIDER_PENALTY_REMOVED_ADVISORY_ONLY'] };
      case 'SESSION_PENALTY_REMOVED': return { adjustedScore: round1(trace.actualScore - trace.sessionPenaltyTotal), reason: ['SESSION_PENALTY_REMOVED_ADVISORY_ONLY'] };
      case 'RISK_PENALTY_CAPPED': return { adjustedScore: round1(trace.actualScore - Math.min(trace.riskPenaltyTotal, -3)), reason: ['RISK_PENALTY_CAPPED_ADVISORY_ONLY'] };
      case 'SECTOR_PENALTY_REMOVED': return { adjustedScore: round1(trace.actualScore - trace.sectorPenaltyTotal), reason: ['SECTOR_PENALTY_REMOVED_ADVISORY_ONLY'] };
      case 'SOFT_FAIL_PENALTY_REMOVED': return { adjustedScore: round1(trace.actualScore - trace.softFailPenaltyTotal), reason: ['SOFT_FAIL_PENALTY_REMOVED_ADVISORY_ONLY'] };
      case 'MIN_SIGNAL_THRESHOLD_MINUS_5': return { adjustedScore: trace.actualScore, reason: ['THRESHOLD_MINUS_5_ADVISORY_ONLY'] };
      case 'MIN_SIGNAL_THRESHOLD_MINUS_10': return { adjustedScore: trace.actualScore, reason: ['THRESHOLD_MINUS_10_ADVISORY_ONLY'] };
      case 'R3_EARLY_ADAPTIVE_THRESHOLD': return { adjustedScore: trace.actualScore, reason: ['R3_EARLY_ADAPTIVE_THRESHOLD_ADVISORY_ONLY'] };
    }
  };
  const requiredFor = (trace: MinimumSignalScoreTrace, scenario: SignalScoreCalibrationScenario): number => {
    if (scenario === 'MIN_SIGNAL_THRESHOLD_MINUS_5') return trace.requiredScore - 5;
    if (scenario === 'MIN_SIGNAL_THRESHOLD_MINUS_10') return trace.requiredScore - 10;
    if (scenario === 'R3_EARLY_ADAPTIVE_THRESHOLD') return input.regime === 'R3_EARLY' ? trace.requiredScore - 7 : trace.requiredScore;
    return trace.requiredScore;
  };
  const scenarios: SignalScoreCalibrationScenario[] = [
    'UNKNOWN_NEUTRAL',
    'PROVIDER_PENALTY_REMOVED',
    'SESSION_PENALTY_REMOVED',
    'RISK_PENALTY_CAPPED',
    'SECTOR_PENALTY_REMOVED',
    'SOFT_FAIL_PENALTY_REMOVED',
    'MIN_SIGNAL_THRESHOLD_MINUS_5',
    'MIN_SIGNAL_THRESHOLD_MINUS_10',
    'R3_EARLY_ADAPTIVE_THRESHOLD',
  ];
  return scenarios.map((scenario) => {
    const survivors = minTraces
      .map((trace) => ({ trace, ...scenarioDelta(trace, scenario), required: requiredFor(trace, scenario) }))
      .filter((x) => x.adjustedScore >= x.required);
    return {
      scenario,
      hypotheticalSurvivors: survivors.length,
      survivorExamples: survivors.slice(0, 5).map((x) => ({
        symbol: x.trace.symbol,
        name: x.trace.name,
        actualScore: x.trace.actualScore,
        adjustedScore: x.adjustedScore,
        requiredScore: x.required,
        reason: x.reason,
      })),
      executionImpact: 'NONE',
    };
  });
}

