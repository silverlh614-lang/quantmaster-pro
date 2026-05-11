/**
 * @responsibility ADR-0464 Entry Filter Conservatism Decomposition.
 *
 * Diagnostic-only SSOT that decomposes why buy candidates did not become live
 * entries. It does not relax any gate, route orders, or mutate trading state.
 */
import type {
  MacroGateState,
  WaitDistribution,
  GatePassDistribution,
} from "./scanDiagnostics.js";
import {
  buildMinimumSignalScoreTrace,
  buildMinSignalScoreDecompositionReport,
  buildRiskPenaltyTrace,
  buildSignalScoreCalibrationResults,
  buildSoftFailAccumulationTrace,
  buildUnknownDataTreatmentAudit,
  type MinimumSignalScoreTrace,
  type MinSignalScoreDecompositionReport,
  type RiskPenaltyTrace,
  type SignalScoreCalibrationResult,
  type SoftFailAccumulationTrace,
  type UnknownDataTreatmentAudit,
} from "./minimumSignalScoreTrace.js";
import {
  buildEntryDecisionLedgerScoreCeilingRepairSummaryFromScore,
  type EntryDecisionLedgerScoreCeilingRepairSummary,
} from "./gate1ScoreCeilingRepair.js";
import {
  buildEntryDecisionLedgerPenaltyDedupSummaryFromScore,
  type EntryDecisionLedgerPenaltyDedupSummary,
} from "./gate1PenaltyDeduplication.js";
import {
  buildEntryDecisionLedgerRiskDoubleCountSummaryFromScore,
  type EntryDecisionLedgerRiskDoubleCountSummary,
} from "./gate1RiskDoubleCount.js";
import {
  buildEntryDecisionLedgerFinalCalibrationSummaryFromScore,
  type EntryDecisionLedgerFinalCalibrationSummary,
} from "./gate1FinalCalibration.js";
import {
  buildEntryDecisionLedgerPositiveSourceWiringSummaryFromScore,
  type EntryDecisionLedgerPositiveSourceWiringSummary,
} from "./gate1PositiveSourceWiringAdr0475.js";

export const GATE1_PROVIDER_ISSUE_SOFT_FAIL_ENABLED = true;
export const GATE1_SOFT_FAIL_ACCUMULATION_THRESHOLD = 3;

export type Gate1ConditionCode =
  | "MARKET_REGIME_PASS"
  | "TRADING_SESSION_PASS"
  | "AUTO_TRADE_ENABLED_PASS"
  | "WATCHLIST_VALID_PASS"
  | "PRICE_DATA_FRESH_PASS"
  | "VOLUME_LIQUIDITY_PASS"
  | "SUPPLY_PROVIDER_HEALTH_PASS"
  | "INVESTOR_FLOW_SAMPLE_PASS"
  | "SUPPLY_CONFLUENCE_PASS"
  | "SECTOR_LEADERSHIP_PASS"
  | "SECTOR_ENERGY_CONFIDENCE_PASS"
  | "RISK_BLOCK_PASS"
  | "MIN_SIGNAL_SCORE_PASS"
  | "DUPLICATE_POSITION_PASS"
  | "SIZING_PRECHECK_PASS"
  | "UNKNOWN_GATE1_CONDITION";

export type Gate1ConditionSeverity =
  | "INFO"
  | "SOFT_FAIL"
  | "HARD_FAIL"
  | "DIAGNOSTIC_ONLY"
  | "NOT_APPLICABLE";

export interface Gate1ConditionTrace {
  code: Gate1ConditionCode;
  passed: boolean;
  severity: Gate1ConditionSeverity;
  message: string;
  providerIssue: boolean;
  marketSignal: boolean;
  executionBlocking: boolean;
  learningBlocking: boolean;
  value?: unknown;
  expected?: unknown;
  source?: string;
}

export type Gate1EvaluationMode =
  | "SIGNAL_ELIGIBILITY"
  | "EXECUTION_ELIGIBILITY";

export type SupplyProviderHealthStatus =
  | "VERIFIED"
  | "DEGRADED"
  | "STALE"
  | "NO_RECENT_SAMPLE"
  | "EMPTY"
  | "ERROR"
  | "UNKNOWN";

export interface SupplyProviderHealthTrace {
  status: SupplyProviderHealthStatus;
  providerName?: string;
  lastSampleAt?: string;
  ageMinutes?: number;
  expectedMaxAgeMinutes?: number;
  sampleCountToday?: number;
  sampleCountRecent?: number;
  hasInstitutionFlow?: boolean;
  hasForeignFlow?: boolean;
  hasProgramFlow?: boolean;
  providerIssue: boolean;
  marketSignal: boolean;
  gate1Severity: "NONE" | "SOFT_FAIL" | "HARD_FAIL" | "DIAGNOSTIC_ONLY";
  investorFlowRouterStatus?: string;
  selectedInvestorFlowProvider?: string;
  providerTried?: string[];
  semanticNetBuyStatus?: string;
  semanticNetBuySignal?: string;
  routeCoverage?: {
    available: number;
    total: number;
    missing: number;
    stale: number;
    acceptedEmpty: number;
    providerMismatch: number;
    notWired: number;
  };
  freshness?: {
    cacheState: string;
    sourceState: string;
    sourceAgeTradingDays: number | null;
    oldestSourceAgeTradingDays: number | null;
    lastSourceDate: string | null;
  };
  diagnostics?: string[];
  reason: string[];
}

export type SupplyConfluenceState =
  | "BULLISH"
  | "NEUTRAL"
  | "BEARISH"
  | "UNKNOWN"
  | "UNAVAILABLE";

export interface Gate1SymbolFeatures {
  price?: number;
  ma20?: number;
  ma60?: number;
  return5d?: number;
  return20d?: number;
  volume?: number;
  avgVolume?: number;
  projectedVolume?: number;
  rsi14?: number;
  atr?: number;
  atr20avg?: number;
  kospi20dReturn?: number;
  sector?: string;
  gateScore?: number;
  stage1Score?: number;
  stage2Score?: number;
  totalGateScore?: number;
  watchlistPriorityScore?: number;
}

export interface Gate1CandidateTrace {
  symbol: string;
  name?: string;
  regime: string;
  marketSession: string;
  gate1Passed: boolean;
  hardFailCount: number;
  softFailCount: number;
  diagnosticOnlyCount: number;
  primaryFailCode?: Gate1ConditionCode;
  conditions: Gate1ConditionTrace[];
  wouldPassIfProviderIssueSoftened: boolean;
  wouldPassIfSupplySampleIgnored: boolean;
  wouldPassIfSectorEnergyIgnored: boolean;
  wouldPassIfTimeWindowIgnored: boolean;
  minSignalScoreTrace?: MinimumSignalScoreTrace;
  unknownDataTreatmentAudit?: UnknownDataTreatmentAudit;
  softFailAccumulationTrace?: SoftFailAccumulationTrace;
  riskPenaltyTrace?: RiskPenaltyTrace;
  calibrationTags?: string[];
  symbolFeatures?: Gate1SymbolFeatures;
  executionImpact: "NONE" | "PAPER_ONLY" | "LIVE_READY";
}

export interface Gate1CounterfactualSurvivorReport {
  totalCandidates: number;
  actualGate1Survivors: number;
  ifProviderIssueSoftened: number;
  ifSupplySampleIgnored: number;
  ifSectorEnergyIgnored: number;
  ifTimeWindowIgnored: number;
  ifSoftFailsIgnoredOnly: number;
  candidateExamples: {
    symbol: string;
    name?: string;
    actualPrimaryFail: string;
    counterfactualPassReason: string[];
  }[];
}

export interface Gate1DecompositionReport {
  timestamp: string;
  forDate: string;
  regime: string;
  marketSession: string;
  totalCandidates: number;
  gate1Passed: number;
  gate1Failed: number;
  hardFailDistribution: Record<string, number>;
  softFailDistribution: Record<string, number>;
  providerIssueDistribution: Record<string, number>;
  marketSignalDistribution: Record<string, number>;
  wouldPassIfProviderIssueSoftened: number;
  wouldPassIfSupplySampleIgnored: number;
  wouldPassIfSectorEnergyIgnored: number;
  topPrimaryFailCodes: { code: string; count: number; examples: string[] }[];
  recommendedAction:
    | "NO_ACTION"
    | "DIAGNOSTIC_ONLY"
    | "REPAIR_PROVIDER_HEALTH"
    | "RECLASSIFY_PROVIDER_ISSUE_AS_SOFT_FAIL"
    | "REVIEW_GATE1_THRESHOLDS"
    | "REVIEW_SUPPLY_CONFLUENCE";
}

export type ExecutionBlockScope =
  | "NONE"
  | "STRONG_BUY_ONLY"
  | "NEW_BUY_ONLY"
  | "ALL_EXECUTION";

export type EntryBlockerCategory =
  | "TIME_WINDOW"
  | "OPERATOR_CONTROL"
  | "MARKET_RISK"
  | "PROVIDER_ISSUE"
  | "SECTOR_ENERGY"
  | "GATE1"
  | "GATE2"
  | "GATE3"
  | "KELLY_SIZING"
  | "POSITION_LIMIT"
  | "WATCHLIST"
  | "ORDER_ROUTE"
  | "DATA_QUALITY"
  | "UNKNOWN";

export type EntryBlockerSeverity =
  | "INFO"
  | "SOFT_BLOCK"
  | "HARD_BLOCK"
  | "DIAGNOSTIC_ONLY";

export interface EntryBlocker {
  category: EntryBlockerCategory;
  code: string;
  severity: EntryBlockerSeverity;
  message: string;
  executionBlocking: boolean | ExecutionBlockScope;
  learningBlocking: boolean;
  expectedInRegime?: boolean;
}

export type CandidateEntryStage =
  | "UNIVERSE"
  | "WATCHLIST"
  | "BEFORE_GATE1"
  | "GATE1"
  | "GATE2"
  | "GATE3"
  | "BEFORE_SIZING"
  | "SIZING"
  | "BEFORE_ORDER"
  | "ORDER_BLOCKED"
  | "ORDER_READY";

export interface CandidateEntryTrace {
  symbol: string;
  name?: string;
  stageReached: CandidateEntryStage;
  regime?: string;
  marketSession?: string;
  gate1Passed?: boolean;
  gate2Passed?: boolean;
  gate3Passed?: boolean;
  kellyRaw?: number;
  kellyAdjusted?: number;
  finalSize?: number;
  sectorBoost?: number;
  sectorEnergyState?: string;
  supplyProviderHealth?: Partial<SupplyProviderHealthTrace>;
  supplyConfluenceState?: SupplyConfluenceState;
  minSignalScorePassed?: boolean;
  minSignalRequiredScore?: number;
  gateScore?: number;
  symbolFeatures?: Gate1SymbolFeatures;
  totalGateScore?: number;
  watchlistUpstreamScore?: number;
  upstreamScore?: number;
  stage2Score?: number;
  watchlistScore?: number;
  stage1Score?: number;
  priorityScore?: number;
  conditionKeys?: string[];
  watchlistReason?: string[];
  relativeStrengthScore?: number;
  relativeStrength?: number;
  rsRankPct?: number;
  return20d?: number;
  return5d?: number;
  marketRelativeReturn?: number;
  kospiRelativeReturn?: number;
  relativeReturn20d?: number;
  kospi20dReturn?: number;
  quote?:
    | {
        return20d?: number;
        return5d?: number;
        price?: number;
        ma20?: number;
        ma60?: number;
        volume?: number;
        avgVolume?: number;
        rsi14?: number;
        atr?: number;
        atr20avg?: number;
      }
    | Record<string, unknown>;
  macroState?: { kospi20dReturn?: number } | Record<string, unknown>;
  breakoutSignals?: Record<string, unknown>;
  conditionResults?: Record<string, unknown>;
  breakout_momentum?: unknown;
  turtle_high?: unknown;
  volume_breakout?: unknown;
  volume_surge?: unknown;
  vcp?: unknown;
  trend_acceleration?: unknown;
  priceDataFresh?: boolean;
  volumeLiquidityPassed?: boolean;
  volume?: number;
  avgVolume?: number;
  projectedVolume?: number;
  price?: number;
  ma20?: number;
  ma60?: number;
  rsi14?: number;
  atr?: number;
  atr20avg?: number;
  blockers: EntryBlocker[];
  wouldEnterIfNoTimeBlock?: boolean;
  wouldEnterIfNoOrderBlock?: boolean;
  wouldEnterIfSectorEnergyIgnored?: boolean;
  wouldEnterIfKellyMinApplied?: boolean;
  gate1Trace?: Gate1CandidateTrace;
  executionImpact: "NONE" | "PAPER_ONLY" | "LIVE_READY";
}

export interface CounterfactualEntryTrace {
  timestamp: string;
  forDate: string;
  symbol: string;
  name?: string;
  hypotheticalEntryPrice?: number;
  hypotheticalStopLoss?: number;
  hypotheticalTarget?: number;
  wouldEnterReason: string[];
  actualBlockers: EntryBlocker[];
  executionImpact: "NONE";
  trackingHorizonDays: number;
  source: "ADR-0464_ENTRY_TRACE";
}

export interface FilterConservatismReport {
  date: string;
  regime: string;
  marketGreen: boolean;
  watchlistCount: number;
  entryCount: number;
  missedSignalCount: number;
  ghostOpenCount: number;
  filterTooConservativeScore: number;
  primaryConservativeFilters: {
    code: string;
    count: number;
    examples: string[];
  }[];
  recommendedAction:
    | "NO_ACTION"
    | "DIAGNOSTIC_ONLY"
    | "REVIEW_THRESHOLDS"
    | "LOWER_SOFT_FILTER_WEIGHT"
    | "ADD_COUNTERFACTUAL_ONLY";
}

export interface KellySizingTrace {
  symbol: string;
  kellyRaw: number;
  regimeMultiplier: number;
  fomcMultiplier: number;
  sectorMultiplier: number;
  riskMultiplier: number;
  finalKelly: number;
  minPositionThreshold: number;
  finalPositionSize: number;
  blockedBySizing: boolean;
  reason?: string;
}

export interface WatchlistHealthReport {
  count: number;
  refreshedAt?: string;
  ageMinutes?: number;
  isStale: boolean;
  source: string;
  candidatesFromUniverse: number;
  candidatesAfterPreFilter: number;
  reasonIfEmpty?: string;
}

export interface EntryDecisionLedgerRow {
  timestamp: string;
  forDate: string;
  symbol: string;
  name?: string;
  regime: string;
  marketSession: string;
  stageReached: string;
  finalDecision:
    | "ENTER_READY"
    | "BLOCKED_BY_TIME"
    | "BLOCKED_BY_GATE"
    | "BLOCKED_BY_SIZING"
    | "BLOCKED_BY_ORDER_ROUTE"
    | "DIAGNOSTIC_ONLY"
    | "NO_SIGNAL";
  blockers: EntryBlocker[];
  wouldEnterIfNoTimeBlock: boolean;
  wouldEnterIfNoOrderBlock: boolean;
  counterfactualRecorded: boolean;
  minSignalScoreSummary?: {
    requiredScore: number;
    actualScore: number;
    scoreGap: number;
    unknownPenaltyTotal: number;
    providerIssuePenaltyTotal: number;
    riskPenaltyTotal: number;
    softFailPenaltyTotal: number;
    tags: string[];
    executionImpact: "NONE";
  };
  scoreCeilingRepairSummary?: EntryDecisionLedgerScoreCeilingRepairSummary;
  penaltyDedupSummary?: EntryDecisionLedgerPenaltyDedupSummary;
  riskDoubleCountSummary?: EntryDecisionLedgerRiskDoubleCountSummary;
  finalCalibrationSummary?: EntryDecisionLedgerFinalCalibrationSummary;
  positiveSourceWiringSummary?: EntryDecisionLedgerPositiveSourceWiringSummary;
  gate1TraceSummary?: {
    primaryGate1FailCode?: Gate1ConditionCode;
    providerIssue: boolean;
    marketSignal: boolean;
    hardFailCount: number;
    softFailCount: number;
    tags: string[];
  };
  primaryGate1FailCode?: Gate1ConditionCode;
  providerIssue?: boolean;
  executionImpact: "NONE" | "PAPER_ONLY" | "LIVE_READY";
}

export interface EntryFilterDecomposition {
  universeCandidates: number;
  watchlistCandidates: number;
  tracedCandidates: number;
  entryReady: number;
  blockedBeforeGate1: number;
  blockedByTimeWindow: number;
  blockedByGate1: number;
  blockedByGate2: number;
  blockedByGate3: number;
  blockedByKellySizing: number;
  blockedBySectorEnergyOnly: number;
  providerIssueDowngraded: number;
  blockedByOrderRoute: number;
  learningBlocked: number;
  counterfactualRecorded: number;
  counterfactualReady: number;
  ledgerRowsCreated: number;
  wouldEnterIfNoTimeBlock: number;
  wouldEnterIfNoOrderBlock: number;
  wouldEnterIfSectorEnergyIgnored: number;
  wouldEnterIfKellyMinApplied: number;
  topBlockers: { code: string; count: number }[];
  candidateTraces: CandidateEntryTrace[];
  counterfactualTraces: CounterfactualEntryTrace[];
  ledgerRows: EntryDecisionLedgerRow[];
  kellySizingTraces: KellySizingTrace[];
  watchlistHealth: WatchlistHealthReport;
  filterConservatismReport?: FilterConservatismReport;
  gate1CandidateTraces: Gate1CandidateTrace[];
  gate1DecompositionReport: Gate1DecompositionReport;
  gate1CounterfactualSurvivorReport: Gate1CounterfactualSurvivorReport;
  minSignalScoreTraces: MinimumSignalScoreTrace[];
  unknownDataTreatmentAudits: UnknownDataTreatmentAudit[];
  softFailAccumulationTraces: SoftFailAccumulationTrace[];
  riskPenaltyTraces: RiskPenaltyTrace[];
  minSignalScoreDecompositionReport: MinSignalScoreDecompositionReport;
  signalScoreCalibrationResults: SignalScoreCalibrationResult[];
  supplyProviderHealth: SupplyProviderHealthTrace;
}

export interface CandidateSnapshot {
  symbol: string;
  name?: string;
  stageReached?: CandidateEntryStage;
  gateScore?: number;
  symbolFeatures?: Gate1SymbolFeatures;
  minSignalRequiredScore?: number;
  gate1Passed?: boolean;
  gate2Passed?: boolean;
  gate3Passed?: boolean;
  sectorBoost?: number;
  sectorEnergyState?: string;
  supplyProviderHealth?: Partial<SupplyProviderHealthTrace>;
  supplyConfluenceState?: SupplyConfluenceState;
  minSignalScorePassed?: boolean;
  priceDataFresh?: boolean;
  volumeLiquidityPassed?: boolean;
  volume?: number;
  avgVolume?: number;
  projectedVolume?: number;
  price?: number;
  ma20?: number;
  ma60?: number;
  rsi14?: number;
  atr?: number;
  atr20avg?: number;
  totalGateScore?: number;
  watchlistUpstreamScore?: number;
  upstreamScore?: number;
  stage2Score?: number;
  watchlistScore?: number;
  stage1Score?: number;
  priorityScore?: number;
  conditionKeys?: string[];
  watchlistReason?: string[];
  relativeStrengthScore?: number;
  relativeStrength?: number;
  rsRankPct?: number;
  return20d?: number;
  return5d?: number;
  marketRelativeReturn?: number;
  kospiRelativeReturn?: number;
  relativeReturn20d?: number;
  kospi20dReturn?: number;
  quote?:
    | {
        return20d?: number;
        return5d?: number;
        price?: number;
        ma20?: number;
        ma60?: number;
        volume?: number;
        avgVolume?: number;
        rsi14?: number;
        atr?: number;
        atr20avg?: number;
      }
    | Record<string, unknown>;
  macroState?: { kospi20dReturn?: number } | Record<string, unknown>;
  breakoutSignals?: Record<string, unknown>;
  conditionResults?: Record<string, unknown>;
  breakout_momentum?: unknown;
  turtle_high?: unknown;
  volume_breakout?: unknown;
  volume_surge?: unknown;
  vcp?: unknown;
  trend_acceleration?: unknown;
}

interface BuildDecompositionInput {
  now: Date;
  universeCandidates: number;
  watchlistCandidates: number;
  entries: number;
  waitDistribution?: WaitDistribution;
  gatePassDistribution?: GatePassDistribution;
  macroGateState?: MacroGateState;
  candidateSnapshots?: CandidateSnapshot[];
  counterfactualRecordedToday?: number;
  sectorEnergyQuality?: string;
  ghostOpenCount?: number;
  filterTooConservativeScore?: number;
  supplyProviderHealth?: Partial<SupplyProviderHealthTrace>;
  watchlistRefreshedAt?: string;
  watchlistSource?: string;
}

export function blocker(
  input: Omit<EntryBlocker, "learningBlocking"> & {
    learningBlocking?: boolean;
  },
): EntryBlocker {
  return { ...input, learningBlocking: input.learningBlocking ?? false };
}

function addBlockersRoundRobin(
  traces: CandidateEntryTrace[],
  count: number,
  make: (idx: number) => EntryBlocker,
  stage: CandidateEntryStage,
  gatePatch?: Partial<CandidateEntryTrace>,
): void {
  if (traces.length === 0) return;
  for (let i = 0; i < Math.min(count, traces.length); i += 1) {
    const trace = traces[i % traces.length];
    trace.blockers.push(make(i));
    trace.stageReached = stage;
    Object.assign(trace, gatePatch ?? {});
  }
}

function hasExecutionBlocker(
  trace: CandidateEntryTrace,
  category?: EntryBlockerCategory,
): boolean {
  return trace.blockers.some((b) => {
    const scope = b.executionBlocking;
    const blocks =
      scope === true || scope === "NEW_BUY_ONLY" || scope === "ALL_EXECUTION";
    return blocks && (category === undefined || b.category === category);
  });
}

function nonTimeHardBlocked(trace: CandidateEntryTrace): boolean {
  return trace.blockers.some((b) => {
    if (b.category === "TIME_WINDOW") return false;
    const scope = b.executionBlocking;
    return (
      scope === true || scope === "NEW_BUY_ONLY" || scope === "ALL_EXECUTION"
    );
  });
}

function isRiskOff(regime: string): boolean {
  return ["CRISIS", "RISK_OFF", "R6_DEFENSE", "R5_CAUTION"].includes(regime);
}

function isGreenish(regime: string): boolean {
  return ["GREEN", "R1_TURBO", "R2_BULL", "R3_EARLY", "FOMC_NORMAL"].includes(
    regime,
  );
}

function makeCondition(input: Gate1ConditionTrace): Gate1ConditionTrace {
  return { ...input, learningBlocking: input.learningBlocking ?? false };
}

function classifySupplyProviderHealth(
  input?: Partial<SupplyProviderHealthTrace>,
): SupplyProviderHealthTrace {
  const status = input?.status ?? "UNKNOWN";
  const providerIssue = input?.providerIssue ?? status !== "VERIFIED";
  const marketSignal = input?.marketSignal ?? false;
  const gate1Severity =
    input?.gate1Severity ??
    (status === "VERIFIED"
      ? "NONE"
      : status === "UNKNOWN"
        ? "DIAGNOSTIC_ONLY"
        : "SOFT_FAIL");
  const reason =
    input?.reason ??
    (status === "NO_RECENT_SAMPLE"
      ? ["no recent investor-flow provider sample"]
      : status === "VERIFIED"
        ? ["provider verified"]
        : [`supply provider status=${status}`]);
  return {
    status,
    providerName: input?.providerName ?? "investor-flow",
    lastSampleAt: input?.lastSampleAt,
    ageMinutes: input?.ageMinutes,
    expectedMaxAgeMinutes: input?.expectedMaxAgeMinutes ?? 30,
    sampleCountToday: input?.sampleCountToday,
    sampleCountRecent: input?.sampleCountRecent,
    hasInstitutionFlow: input?.hasInstitutionFlow,
    hasForeignFlow: input?.hasForeignFlow,
    hasProgramFlow: input?.hasProgramFlow,
    providerIssue,
    marketSignal,
    gate1Severity,
    reason,
  };
}

function conditionBlocksGate1(c: Gate1ConditionTrace): boolean {
  return (
    !c.passed && (c.severity === "HARD_FAIL" || c.severity === "SOFT_FAIL")
  );
}

function countByCondition(
  traces: Gate1CandidateTrace[],
  predicate: (condition: Gate1ConditionTrace) => boolean,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const trace of traces) {
    for (const condition of trace.conditions) {
      if (!predicate(condition)) continue;
      out[condition.code] = (out[condition.code] ?? 0) + 1;
    }
  }
  return out;
}

function canPassIgnoring(
  trace: Gate1CandidateTrace,
  ignore: (condition: Gate1ConditionTrace) => boolean,
): boolean {
  return !trace.conditions.some(
    (condition) => conditionBlocksGate1(condition) && !ignore(condition),
  );
}

function buildGate1CandidateTrace(input: {
  trace: CandidateEntryTrace;
  regime: string;
  marketSession: string;
  macroGateState?: MacroGateState;
  supplyProviderHealth: SupplyProviderHealthTrace;
  supplyConfluenceState: SupplyConfluenceState;
  gate1SoftFailThreshold: number;
}): Gate1CandidateTrace {
  const {
    trace,
    regime,
    marketSession,
    macroGateState,
    supplyProviderHealth,
    supplyConfluenceState,
  } = input;
  const conditions: Gate1ConditionTrace[] = [];
  const hasGate1Blocker = trace.blockers.some((b) => b.category === "GATE1");
  const hasSectorEnergyDiagnostic = trace.blockers.some(
    (b) => b.category === "SECTOR_ENERGY",
  );
  conditions.push(
    makeCondition({
      code: "MARKET_REGIME_PASS",
      passed: !macroGateState?.emergencyStop,
      severity: macroGateState?.emergencyStop ? "HARD_FAIL" : "INFO",
      message: macroGateState?.emergencyStop
        ? "Emergency stop blocks Gate1 execution eligibility."
        : "Market regime did not hard-block Gate1 signal eligibility.",
      providerIssue: false,
      marketSignal: Boolean(macroGateState?.emergencyStop),
      executionBlocking: Boolean(macroGateState?.emergencyStop),
      learningBlocking: false,
      value: regime,
      source: "macroGateState",
    }),
  );
  conditions.push(
    makeCondition({
      code: "TRADING_SESSION_PASS",
      passed: marketSession !== "SELL_ONLY",
      severity: marketSession === "SELL_ONLY" ? "SOFT_FAIL" : "INFO",
      message:
        marketSession === "SELL_ONLY"
          ? "SELL_ONLY is recorded as execution time-window blocker; signal eligibility remains separately decomposed."
          : "Trading session allows new buy execution.",
      providerIssue: false,
      marketSignal: false,
      executionBlocking: marketSession === "SELL_ONLY",
      learningBlocking: false,
      value: marketSession,
      expected: "NORMAL",
      source: "macroGateState.sellOnlyMode",
    }),
  );
  conditions.push(
    makeCondition({
      code: "AUTO_TRADE_ENABLED_PASS",
      passed: macroGateState?.autoTradeEnabled !== false,
      severity:
        macroGateState?.autoTradeEnabled === false ? "HARD_FAIL" : "INFO",
      message:
        macroGateState?.autoTradeEnabled === false
          ? "Auto-trade disabled by operator."
          : "Auto-trade control is enabled or unavailable.",
      providerIssue: false,
      marketSignal: false,
      executionBlocking: macroGateState?.autoTradeEnabled === false,
      learningBlocking: false,
      value: macroGateState?.autoTradeEnabled,
      expected: true,
      source: "macroGateState.autoTradeEnabled",
    }),
  );
  conditions.push(
    makeCondition({
      code: "WATCHLIST_VALID_PASS",
      passed: trace.symbol !== "UNIVERSE_SUMMARY",
      severity: trace.symbol === "UNIVERSE_SUMMARY" ? "SOFT_FAIL" : "INFO",
      message:
        trace.symbol === "UNIVERSE_SUMMARY"
          ? "No watchlist row was available for this universe summary."
          : "Watchlist candidate row exists.",
      providerIssue: false,
      marketSignal: false,
      executionBlocking: trace.symbol === "UNIVERSE_SUMMARY",
      learningBlocking: false,
      source: "entryFilterDecomposition",
    }),
  );
  conditions.push(
    makeCondition({
      code: "PRICE_DATA_FRESH_PASS",
      passed: trace.blockers.every((b) => b.code !== "PRICE_DATA_STALE"),
      severity: trace.blockers.some((b) => b.code === "PRICE_DATA_STALE")
        ? "HARD_FAIL"
        : "INFO",
      message: trace.blockers.some((b) => b.code === "PRICE_DATA_STALE")
        ? "Price data stale/missing."
        : "No price freshness blocker was recorded.",
      providerIssue: false,
      marketSignal: false,
      executionBlocking: trace.blockers.some(
        (b) => b.code === "PRICE_DATA_STALE",
      ),
      learningBlocking: false,
      source: "entryBlockers",
    }),
  );
  conditions.push(
    makeCondition({
      code: "VOLUME_LIQUIDITY_PASS",
      passed: trace.blockers.every((b) => b.code !== "LIQUIDITY_LOW"),
      severity: trace.blockers.some((b) => b.code === "LIQUIDITY_LOW")
        ? "HARD_FAIL"
        : "INFO",
      message: trace.blockers.some((b) => b.code === "LIQUIDITY_LOW")
        ? "Absolute liquidity minimum failed."
        : "No absolute liquidity blocker was recorded.",
      providerIssue: false,
      marketSignal: trace.blockers.some((b) => b.code === "LIQUIDITY_LOW"),
      executionBlocking: trace.blockers.some((b) => b.code === "LIQUIDITY_LOW"),
      learningBlocking: false,
      source: "entryBlockers",
    }),
  );
  const supplyProviderPassed = supplyProviderHealth.status === "VERIFIED";
  const supplySeverity =
    supplyProviderHealth.gate1Severity === "NONE"
      ? "INFO"
      : supplyProviderHealth.gate1Severity;
  conditions.push(
    makeCondition({
      code: "SUPPLY_PROVIDER_HEALTH_PASS",
      passed: supplyProviderPassed,
      severity: supplySeverity,
      message: supplyProviderHealth.reason.join("; "),
      providerIssue: supplyProviderHealth.providerIssue,
      marketSignal: supplyProviderHealth.marketSignal,
      executionBlocking: supplyProviderHealth.gate1Severity === "HARD_FAIL",
      learningBlocking: false,
      value: supplyProviderHealth.status,
      expected: "VERIFIED",
      source: supplyProviderHealth.providerName,
    }),
  );
  conditions.push(
    makeCondition({
      code: "INVESTOR_FLOW_SAMPLE_PASS",
      passed:
        supplyProviderHealth.status === "VERIFIED" ||
        (supplyProviderHealth.sampleCountRecent ?? 0) > 0,
      severity:
        supplyProviderHealth.status === "NO_RECENT_SAMPLE" ||
        supplyProviderHealth.status === "EMPTY"
          ? "SOFT_FAIL"
          : supplySeverity,
      message:
        supplyProviderHealth.status === "NO_RECENT_SAMPLE"
          ? "Investor-flow sample is missing/too old; classify as provider issue, not bearish supply."
          : "Investor-flow sample status recorded.",
      providerIssue: supplyProviderHealth.providerIssue,
      marketSignal: false,
      executionBlocking: false,
      learningBlocking: false,
      value: {
        lastSampleAt: supplyProviderHealth.lastSampleAt ?? "unknown",
        ageMinutes: supplyProviderHealth.ageMinutes,
        expectedMaxAgeMinutes: supplyProviderHealth.expectedMaxAgeMinutes,
      },
      expected: { sampleCountRecent: ">0" },
      source: supplyProviderHealth.providerName,
    }),
  );
  conditions.push(
    makeCondition({
      code: "SUPPLY_CONFLUENCE_PASS",
      passed:
        supplyConfluenceState !== "BEARISH" &&
        supplyConfluenceState !== "UNAVAILABLE" &&
        supplyConfluenceState !== "UNKNOWN",
      severity:
        supplyConfluenceState === "BEARISH"
          ? "HARD_FAIL"
          : supplyConfluenceState === "UNKNOWN" ||
              supplyConfluenceState === "UNAVAILABLE"
            ? "SOFT_FAIL"
            : "INFO",
      message:
        supplyConfluenceState === "BEARISH"
          ? "Supply confluence is bearish from actual flow data."
          : supplyConfluenceState === "UNKNOWN" ||
              supplyConfluenceState === "UNAVAILABLE"
            ? "Supply confluence is unknown/unavailable, not bearish; confidence downgrade only."
            : "Supply confluence is not bearish.",
      providerIssue:
        supplyConfluenceState === "UNKNOWN" ||
        supplyConfluenceState === "UNAVAILABLE",
      marketSignal: supplyConfluenceState === "BEARISH",
      executionBlocking: supplyConfluenceState === "BEARISH",
      learningBlocking: false,
      value: supplyConfluenceState,
      expected: "BULLISH_OR_NEUTRAL",
      source: "supplyConfluenceState",
    }),
  );
  conditions.push(
    makeCondition({
      code: "SECTOR_ENERGY_CONFIDENCE_PASS",
      passed: !hasSectorEnergyDiagnostic,
      severity: hasSectorEnergyDiagnostic ? "DIAGNOSTIC_ONLY" : "INFO",
      message: hasSectorEnergyDiagnostic
        ? "SectorEnergy degraded is diagnostic/STRONG_BUY_ONLY per ADR-0462."
        : "No SectorEnergy confidence diagnostic blocker recorded.",
      providerIssue: hasSectorEnergyDiagnostic,
      marketSignal: false,
      executionBlocking: false,
      learningBlocking: false,
      value: trace.sectorEnergyState,
      source: "sectorEnergyQuality",
    }),
  );
  conditions.push(
    makeCondition({
      code: "RISK_BLOCK_PASS",
      passed: !macroGateState?.emergencyStop,
      severity: macroGateState?.emergencyStop ? "HARD_FAIL" : "INFO",
      message: macroGateState?.emergencyStop
        ? "Severe risk block active."
        : "No severe risk block active.",
      providerIssue: false,
      marketSignal: Boolean(macroGateState?.emergencyStop),
      executionBlocking: Boolean(macroGateState?.emergencyStop),
      learningBlocking: false,
      source: "macroGateState",
    }),
  );
  const minSignalScoreTrace = buildMinimumSignalScoreTrace({
    trace,
    hasGate1Blocker,
    regime,
    marketSession,
    macroGateState,
    supplyProviderHealth,
    supplyConfluenceState,
    hasSectorEnergyDiagnostic,
  });
  conditions.push(
    makeCondition({
      code: "MIN_SIGNAL_SCORE_PASS",
      passed: minSignalScoreTrace.passed,
      severity: minSignalScoreTrace.passed ? "INFO" : "SOFT_FAIL",
      message: minSignalScoreTrace.passed
        ? `Minimum signal score passed: actual ${minSignalScoreTrace.actualScore} / required ${minSignalScoreTrace.requiredScore}.`
        : `Minimum signal score failed: actual ${minSignalScoreTrace.actualScore} / required ${minSignalScoreTrace.requiredScore}, gap ${minSignalScoreTrace.scoreGap}.`,
      providerIssue: false,
      marketSignal: false,
      executionBlocking: false,
      learningBlocking: false,
      value: {
        actualScore: minSignalScoreTrace.actualScore,
        requiredScore: minSignalScoreTrace.requiredScore,
        scoreGap: minSignalScoreTrace.scoreGap,
      },
      expected: { requiredScore: minSignalScoreTrace.requiredScore },
      source: "ADR-0466_minimumSignalScoreTrace",
    }),
  );
  conditions.push(
    makeCondition({
      code: "DUPLICATE_POSITION_PASS",
      passed: true,
      severity: "NOT_APPLICABLE",
      message:
        "No duplicate-position blocker was provided to ADR-0465 decomposition.",
      providerIssue: false,
      marketSignal: false,
      executionBlocking: false,
      learningBlocking: false,
      source: "entryFilterDecomposition",
    }),
  );
  conditions.push(
    makeCondition({
      code: "SIZING_PRECHECK_PASS",
      passed: !trace.blockers.some((b) => b.category === "KELLY_SIZING"),
      severity: trace.blockers.some((b) => b.category === "KELLY_SIZING")
        ? "SOFT_FAIL"
        : "INFO",
      message: trace.blockers.some((b) => b.category === "KELLY_SIZING")
        ? "Sizing precheck below minimum."
        : "Sizing precheck did not block before Gate1 decomposition.",
      providerIssue: false,
      marketSignal: false,
      executionBlocking: trace.blockers.some(
        (b) => b.category === "KELLY_SIZING",
      ),
      learningBlocking: false,
      source: "kellySizingTrace",
    }),
  );
  const hardFailCount = conditions.filter(
    (c) => !c.passed && c.severity === "HARD_FAIL",
  ).length;
  const softFailCount = conditions.filter(
    (c) => !c.passed && c.severity === "SOFT_FAIL",
  ).length;
  const diagnosticOnlyCount = conditions.filter(
    (c) => !c.passed && c.severity === "DIAGNOSTIC_ONLY",
  ).length;
  const primaryFail =
    conditions.find((c) => !c.passed && c.severity === "HARD_FAIL") ??
    conditions.find((c) => !c.passed && c.providerIssue) ??
    conditions.find((c) => !c.passed && c.severity === "SOFT_FAIL") ??
    conditions.find((c) => !c.passed);
  const wouldPassIfProviderIssueSoftened = canPassIgnoring(
    { conditions } as Gate1CandidateTrace,
    (c) =>
      c.providerIssue ||
      c.code === "TRADING_SESSION_PASS" ||
      c.code === "MIN_SIGNAL_SCORE_PASS",
  );
  const wouldPassIfSupplySampleIgnored = canPassIgnoring(
    { conditions } as Gate1CandidateTrace,
    (c) =>
      c.code === "SUPPLY_PROVIDER_HEALTH_PASS" ||
      c.code === "INVESTOR_FLOW_SAMPLE_PASS" ||
      c.code === "SUPPLY_CONFLUENCE_PASS" ||
      c.code === "TRADING_SESSION_PASS",
  );
  const wouldPassIfSectorEnergyIgnored = canPassIgnoring(
    { conditions } as Gate1CandidateTrace,
    (c) =>
      c.code === "SECTOR_ENERGY_CONFIDENCE_PASS" ||
      c.code === "TRADING_SESSION_PASS",
  );
  const wouldPassIfTimeWindowIgnored = canPassIgnoring(
    { conditions } as Gate1CandidateTrace,
    (c) => c.code === "TRADING_SESSION_PASS",
  );
  const softFailAccumulationTrace = buildSoftFailAccumulationTrace({
    symbol: trace.symbol,
    conditions,
    minSignalScoreTrace,
    threshold: input.gate1SoftFailThreshold,
  });
  const riskPenaltyTrace = buildRiskPenaltyTrace({
    symbol: trace.symbol,
    macroGateState,
    minSignalScoreTrace,
  });
  return {
    symbol: trace.symbol,
    name: trace.name,
    regime,
    marketSession,
    gate1Passed:
      trace.gate1Passed === true ||
      (!hasGate1Blocker &&
        hardFailCount === 0 &&
        softFailCount < input.gate1SoftFailThreshold),
    hardFailCount,
    softFailCount,
    diagnosticOnlyCount,
    primaryFailCode: primaryFail?.code,
    conditions,
    wouldPassIfProviderIssueSoftened,
    wouldPassIfSupplySampleIgnored,
    wouldPassIfSectorEnergyIgnored,
    wouldPassIfTimeWindowIgnored,
    minSignalScoreTrace,
    unknownDataTreatmentAudit:
      buildUnknownDataTreatmentAudit(minSignalScoreTrace),
    softFailAccumulationTrace,
    riskPenaltyTrace,
    symbolFeatures: trace.symbolFeatures,
    calibrationTags: [
      ...(minSignalScoreTrace.scoreGap < 0
        ? ["CASE_MIN_SIGNAL_SCORE_GAP"]
        : []),
      ...(minSignalScoreTrace.unknownPenaltyTotal < 0
        ? ["CASE_UNKNOWN_DATA_PENALTY"]
        : []),
      ...(softFailAccumulationTrace.failedBySoftAccumulation
        ? ["CASE_SOFT_FAIL_ACCUMULATION"]
        : []),
      ...(riskPenaltyTrace.doubleCountWarning
        ? ["CASE_RISK_PENALTY_DOUBLE_COUNT_WARNING"]
        : []),
      ...(regime === "R3_EARLY" &&
      minSignalScoreTrace.scoreGap < 0 &&
      minSignalScoreTrace.scoreGap >= -10
        ? ["CASE_R3_EARLY_ADAPTIVE_THRESHOLD_CANDIDATE"]
        : []),
    ],
    executionImpact: "NONE",
  };
}

function buildGate1Reports(input: {
  nowIso: string;
  forDate: string;
  regime: string;
  marketSession: string;
  traces: Gate1CandidateTrace[];
}): {
  report: Gate1DecompositionReport;
  counterfactual: Gate1CounterfactualSurvivorReport;
} {
  const { traces } = input;
  const primaryMap = new Map<string, { count: number; examples: string[] }>();
  for (const trace of traces) {
    if (!trace.primaryFailCode) continue;
    const current = primaryMap.get(trace.primaryFailCode) ?? {
      count: 0,
      examples: [],
    };
    current.count += 1;
    if (current.examples.length < 3) current.examples.push(trace.symbol);
    primaryMap.set(trace.primaryFailCode, current);
  }
  const actualGate1Survivors = traces.filter((t) => t.gate1Passed).length;
  const counterfactual: Gate1CounterfactualSurvivorReport = {
    totalCandidates: traces.length,
    actualGate1Survivors,
    ifProviderIssueSoftened: traces.filter(
      (t) => t.wouldPassIfProviderIssueSoftened,
    ).length,
    ifSupplySampleIgnored: traces.filter(
      (t) => t.wouldPassIfSupplySampleIgnored,
    ).length,
    ifSectorEnergyIgnored: traces.filter(
      (t) => t.wouldPassIfSectorEnergyIgnored,
    ).length,
    ifTimeWindowIgnored: traces.filter((t) => t.wouldPassIfTimeWindowIgnored)
      .length,
    ifSoftFailsIgnoredOnly: traces.filter((t) => t.hardFailCount === 0).length,
    candidateExamples: traces
      .filter(
        (t) =>
          t.wouldPassIfProviderIssueSoftened ||
          t.wouldPassIfSupplySampleIgnored,
      )
      .slice(0, 5)
      .map((t) => ({
        symbol: t.symbol,
        name: t.name,
        actualPrimaryFail: t.primaryFailCode ?? "UNKNOWN_GATE1_CONDITION",
        counterfactualPassReason: [
          ...(t.wouldPassIfProviderIssueSoftened
            ? ["CASE_GATE1_PROVIDER_SOFTENED_SURVIVOR"]
            : []),
          ...(t.wouldPassIfSupplySampleIgnored
            ? ["CASE_SUPPLY_SAMPLE_UNKNOWN"]
            : []),
        ],
      })),
  };
  const providerIssueCount = Object.values(
    countByCondition(traces, (c) => !c.passed && c.providerIssue),
  ).reduce((a, b) => a + b, 0);
  const marketSignalCount = Object.values(
    countByCondition(traces, (c) => !c.passed && c.marketSignal),
  ).reduce((a, b) => a + b, 0);
  const report: Gate1DecompositionReport = {
    timestamp: input.nowIso,
    forDate: input.forDate,
    regime: input.regime,
    marketSession: input.marketSession,
    totalCandidates: traces.length,
    gate1Passed: actualGate1Survivors,
    gate1Failed: traces.length - actualGate1Survivors,
    hardFailDistribution: countByCondition(
      traces,
      (c) => !c.passed && c.severity === "HARD_FAIL",
    ),
    softFailDistribution: countByCondition(
      traces,
      (c) => !c.passed && c.severity === "SOFT_FAIL",
    ),
    providerIssueDistribution: countByCondition(
      traces,
      (c) => !c.passed && c.providerIssue,
    ),
    marketSignalDistribution: countByCondition(
      traces,
      (c) => !c.passed && c.marketSignal,
    ),
    wouldPassIfProviderIssueSoftened: counterfactual.ifProviderIssueSoftened,
    wouldPassIfSupplySampleIgnored: counterfactual.ifSupplySampleIgnored,
    wouldPassIfSectorEnergyIgnored: counterfactual.ifSectorEnergyIgnored,
    topPrimaryFailCodes: Array.from(primaryMap.entries())
      .map(([code, value]) => ({
        code,
        count: value.count,
        examples: value.examples,
      }))
      .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code)),
    recommendedAction:
      providerIssueCount > 0 && providerIssueCount >= marketSignalCount
        ? GATE1_PROVIDER_ISSUE_SOFT_FAIL_ENABLED
          ? "REPAIR_PROVIDER_HEALTH"
          : "RECLASSIFY_PROVIDER_ISSUE_AS_SOFT_FAIL"
        : marketSignalCount > 0
          ? "REVIEW_GATE1_THRESHOLDS"
          : "DIAGNOSTIC_ONLY",
  };
  return { report, counterfactual };
}

export function createKellySizingTrace(input: {
  symbol: string;
  kellyRaw: number;
  regimeMultiplier: number;
  fomcMultiplier: number;
  sectorMultiplier?: number;
  riskMultiplier?: number;
  minPositionThreshold?: number;
  finalPositionSize?: number;
}): KellySizingTrace {
  const sectorMultiplier = input.sectorMultiplier ?? 1;
  const riskMultiplier = input.riskMultiplier ?? 1;
  const finalKelly =
    input.kellyRaw *
    input.regimeMultiplier *
    input.fomcMultiplier *
    sectorMultiplier *
    riskMultiplier;
  const minPositionThreshold = input.minPositionThreshold ?? 0.01;
  const finalPositionSize = input.finalPositionSize ?? finalKelly;
  const blockedBySizing =
    finalKelly < minPositionThreshold || finalPositionSize <= 0;
  return {
    symbol: input.symbol,
    kellyRaw: input.kellyRaw,
    regimeMultiplier: input.regimeMultiplier,
    fomcMultiplier: input.fomcMultiplier,
    sectorMultiplier,
    riskMultiplier,
    finalKelly,
    minPositionThreshold,
    finalPositionSize,
    blockedBySizing,
    reason: blockedBySizing ? "KELLY_ADJUSTED_TOO_LOW" : undefined,
  };
}

function finiteFeature(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function quoteFeature(c: CandidateSnapshot, key: string): number | undefined {
  const quote = c.quote;
  if (!quote || typeof quote !== "object") return undefined;
  return finiteFeature((quote as Record<string, unknown>)[key]);
}

function buildSymbolFeatures(
  c: CandidateSnapshot,
): Gate1SymbolFeatures | undefined {
  const provided = c.symbolFeatures ?? {};
  const features: Gate1SymbolFeatures = {
    ...provided,
    price: provided.price ?? finiteFeature(c.price) ?? quoteFeature(c, "price"),
    ma20: provided.ma20 ?? finiteFeature(c.ma20) ?? quoteFeature(c, "ma20"),
    ma60: provided.ma60 ?? finiteFeature(c.ma60) ?? quoteFeature(c, "ma60"),
    return5d:
      provided.return5d ??
      finiteFeature(c.return5d) ??
      quoteFeature(c, "return5d"),
    return20d:
      provided.return20d ??
      finiteFeature(c.return20d) ??
      quoteFeature(c, "return20d"),
    volume:
      provided.volume ?? finiteFeature(c.volume) ?? quoteFeature(c, "volume"),
    avgVolume:
      provided.avgVolume ??
      finiteFeature(c.avgVolume) ??
      quoteFeature(c, "avgVolume"),
    projectedVolume:
      provided.projectedVolume ?? finiteFeature(c.projectedVolume),
    rsi14: provided.rsi14 ?? finiteFeature(c.rsi14) ?? quoteFeature(c, "rsi14"),
    atr: provided.atr ?? finiteFeature(c.atr) ?? quoteFeature(c, "atr"),
    atr20avg:
      provided.atr20avg ??
      finiteFeature(c.atr20avg) ??
      quoteFeature(c, "atr20avg"),
    kospi20dReturn:
      provided.kospi20dReturn ??
      finiteFeature(c.kospi20dReturn) ??
      quoteFeature(c, "kospi20dReturn"),
    sector:
      provided.sector ??
      (typeof (c as unknown as Record<string, unknown>).sector === "string"
        ? (c as unknown as Record<string, string>).sector
        : undefined),
    gateScore: provided.gateScore ?? finiteFeature(c.gateScore),
    stage1Score: provided.stage1Score ?? finiteFeature(c.stage1Score),
    stage2Score: provided.stage2Score ?? finiteFeature(c.stage2Score),
    totalGateScore: provided.totalGateScore ?? finiteFeature(c.totalGateScore),
    watchlistPriorityScore:
      provided.watchlistPriorityScore ??
      finiteFeature(c.priorityScore) ??
      finiteFeature(c.watchlistScore) ??
      finiteFeature(c.watchlistUpstreamScore),
  };
  return Object.values(features).some((value) => value !== undefined)
    ? features
    : undefined;
}

export function buildEntryFilterDecomposition(
  input: BuildDecompositionInput,
): EntryFilterDecomposition {
  const nowIso = input.now.toISOString();
  const forDate = nowIso.slice(0, 10);
  const regime = input.macroGateState?.regime ?? "UNKNOWN";
  const marketSession = input.macroGateState?.sellOnlyMode
    ? "SELL_ONLY"
    : "NORMAL";
  const wd = input.waitDistribution;
  const gp = input.gatePassDistribution;
  const candidateSnapshots = input.candidateSnapshots ?? [];
  const fallbackCount = input.watchlistCandidates;
  const defaultSupplyProviderHealth = classifySupplyProviderHealth(
    input.supplyProviderHealth,
  );
  const traces: CandidateEntryTrace[] = (
    candidateSnapshots.length > 0
      ? candidateSnapshots
      : Array.from(
          { length: fallbackCount },
          (_, i): CandidateSnapshot => ({ symbol: `WATCHLIST_${i + 1}` }),
        )
  ).map((c): CandidateEntryTrace => {
    const symbolFeatures = buildSymbolFeatures(c);
    return {
      symbol: c.symbol,
      name: c.name,
      stageReached: c.stageReached ?? "WATCHLIST",
      regime,
      marketSession,
      gate1Passed: c.gate1Passed,
      gate2Passed: c.gate2Passed,
      gate3Passed: c.gate3Passed,
      sectorBoost: c.sectorBoost,
      sectorEnergyState: c.sectorEnergyState ?? input.sectorEnergyQuality,
      supplyProviderHealth: c.supplyProviderHealth,
      supplyConfluenceState: c.supplyConfluenceState,
      minSignalScorePassed: c.minSignalScorePassed,
      minSignalRequiredScore: c.minSignalRequiredScore,
      gateScore: c.gateScore,
      symbolFeatures,
      totalGateScore: c.totalGateScore,
      watchlistUpstreamScore: c.watchlistUpstreamScore,
      upstreamScore: c.upstreamScore,
      stage2Score: c.stage2Score,
      stage1Score: c.stage1Score,
      priorityScore: c.priorityScore,
      conditionKeys: c.conditionKeys,
      watchlistScore: c.watchlistScore,
      watchlistReason: c.watchlistReason,
      relativeStrengthScore: c.relativeStrengthScore,
      relativeStrength: c.relativeStrength,
      rsRankPct: c.rsRankPct,
      return20d: c.return20d,
      return5d: c.return5d,
      marketRelativeReturn: c.marketRelativeReturn,
      kospiRelativeReturn: c.kospiRelativeReturn,
      relativeReturn20d: c.relativeReturn20d,
      kospi20dReturn: c.kospi20dReturn,
      quote: c.quote,
      macroState: c.macroState,
      breakoutSignals: c.breakoutSignals,
      conditionResults: c.conditionResults,
      breakout_momentum: c.breakout_momentum,
      turtle_high: c.turtle_high,
      volume_breakout: c.volume_breakout,
      volume_surge: c.volume_surge,
      vcp: c.vcp,
      trend_acceleration: c.trend_acceleration,
      priceDataFresh: c.priceDataFresh,
      volumeLiquidityPassed: c.volumeLiquidityPassed,
      volume: c.volume ?? symbolFeatures?.volume,
      avgVolume: c.avgVolume ?? symbolFeatures?.avgVolume,
      projectedVolume: c.projectedVolume ?? symbolFeatures?.projectedVolume,
      price: c.price ?? symbolFeatures?.price,
      ma20: c.ma20 ?? symbolFeatures?.ma20,
      ma60: c.ma60 ?? symbolFeatures?.ma60,
      rsi14: c.rsi14 ?? symbolFeatures?.rsi14,
      atr: c.atr ?? symbolFeatures?.atr,
      atr20avg: c.atr20avg ?? symbolFeatures?.atr20avg,
      blockers: [],
      executionImpact: "NONE",
    };
  });

  if (traces.length === 0 && input.universeCandidates > 0) {
    traces.push({
      symbol: "UNIVERSE_SUMMARY",
      stageReached: "UNIVERSE",
      regime,
      marketSession,
      blockers: [
        blocker({
          category: "WATCHLIST",
          code: "WATCHLIST_EMPTY_OR_STALE",
          severity: "SOFT_BLOCK",
          message:
            "Universe candidates existed but watchlist/pre-filter produced no candidate rows.",
          executionBlocking: "NEW_BUY_ONLY",
        }),
      ],
      executionImpact: "NONE",
    });
  }

  if (input.macroGateState?.sellOnlyMode) {
    for (const trace of traces) {
      trace.blockers.push(
        blocker({
          category: "TIME_WINDOW",
          code: "SELL_ONLY_TIME_WINDOW",
          severity: "HARD_BLOCK",
          message:
            "SELL_ONLY market session blocks new live buy execution only.",
          executionBlocking: "NEW_BUY_ONLY",
          expectedInRegime: true,
        }),
      );
    }
  }

  if (input.macroGateState && !input.macroGateState.autoTradeEnabled) {
    for (const trace of traces) {
      trace.blockers.push(
        blocker({
          category: "OPERATOR_CONTROL",
          code: "AUTOTRADE_DISABLED",
          severity: "HARD_BLOCK",
          message: "Operator control disabled automated live buys.",
          executionBlocking: "NEW_BUY_ONLY",
        }),
      );
    }
  }

  if (input.macroGateState?.emergencyStop) {
    for (const trace of traces) {
      trace.blockers.push(
        blocker({
          category: "MARKET_RISK",
          code: "EMERGENCY_STOP",
          severity: "HARD_BLOCK",
          message:
            "Emergency stop blocks live execution; learning remains available.",
          executionBlocking: "ALL_EXECUTION",
        }),
      );
    }
  }

  const gate1Fail = Math.max(
    0,
    (wd?.gateFail ?? 0) ||
      Math.max(
        0,
        input.watchlistCandidates -
          (gp?.gate1Pass ?? input.watchlistCandidates),
      ),
  );
  addBlockersRoundRobin(
    traces,
    gate1Fail,
    () =>
      blocker({
        category: "GATE1",
        code: "GATE1_FAIL",
        severity: "SOFT_BLOCK",
        message: "Candidate failed Gate1 or live revalidation.",
        executionBlocking: "NEW_BUY_ONLY",
      }),
    "GATE1",
    { gate1Passed: false },
  );

  const gate2Fail = Math.max(0, (gp?.gate1Pass ?? 0) - (gp?.gate2Pass ?? 0));
  addBlockersRoundRobin(
    traces.slice(gate1Fail),
    gate2Fail,
    () =>
      blocker({
        category: "GATE2",
        code: "GATE2_FAIL",
        severity: "SOFT_BLOCK",
        message:
          "Candidate survived Gate1 but failed Gate2 leadership/timing confirmation.",
        executionBlocking: "NEW_BUY_ONLY",
      }),
    "GATE2",
    { gate1Passed: true, gate2Passed: false },
  );

  const gate3Fail = Math.max(0, (gp?.gate2Pass ?? 0) - (gp?.gate3Pass ?? 0));
  addBlockersRoundRobin(
    traces.slice(gate1Fail + gate2Fail),
    gate3Fail,
    () =>
      blocker({
        category: "GATE3",
        code: "GATE3_FAIL",
        severity: "SOFT_BLOCK",
        message:
          "Candidate survived Gate2 but failed final trigger/Gate3 confirmation.",
        executionBlocking: "NEW_BUY_ONLY",
      }),
    "GATE3",
    { gate1Passed: true, gate2Passed: true, gate3Passed: false },
  );

  const sizingFail = wd?.sizingBlocked ?? 0;
  addBlockersRoundRobin(
    traces.slice(gate1Fail + gate2Fail + gate3Fail),
    sizingFail,
    () =>
      blocker({
        category: "KELLY_SIZING",
        code: "KELLY_ADJUSTED_TOO_LOW",
        severity: "SOFT_BLOCK",
        message:
          "Kelly-adjusted position size fell below the minimum tradable position threshold.",
        executionBlocking: "NEW_BUY_ONLY",
      }),
    "SIZING",
  );

  if (
    input.sectorEnergyQuality === "DEGRADED" ||
    input.sectorEnergyQuality === "STALE" ||
    input.sectorEnergyQuality === "FAILED"
  ) {
    const sectorCount = Math.max(0, Math.min(3, traces.length));
    addBlockersRoundRobin(
      traces,
      sectorCount,
      () =>
        blocker({
          category: "SECTOR_ENERGY",
          code: "SECTOR_ENERGY_DIAGNOSTIC_ONLY",
          severity: "DIAGNOSTIC_ONLY",
          message:
            "SectorEnergy is diagnostic/degraded; STRONG_BUY may be blocked, general BUY/counterfactual is preserved.",
          executionBlocking: "STRONG_BUY_ONLY",
        }),
      "WATCHLIST",
    );
  }

  const kellyTrace = createKellySizingTrace({
    symbol: "SCAN_MULTIPLIER",
    kellyRaw: 1,
    regimeMultiplier: input.macroGateState?.kellyMultiplierFromRegime ?? 1,
    fomcMultiplier: input.macroGateState?.fomcKellyMultiplier ?? 1,
    sectorMultiplier: 1,
    riskMultiplier:
      input.macroGateState?.finalKellyMultiplier !== undefined
        ? input.macroGateState.finalKellyMultiplier /
          Math.max(
            0.000001,
            (input.macroGateState.kellyMultiplierFromRegime || 1) *
              (input.macroGateState.fomcKellyMultiplier || 1),
          )
        : 1,
    minPositionThreshold: 0.01,
    finalPositionSize: input.macroGateState?.finalKellyMultiplier ?? 1,
  });

  const gate1CandidateTraces = traces.map((trace) => {
    const supplyProviderHealth = classifySupplyProviderHealth(
      trace.supplyProviderHealth ?? defaultSupplyProviderHealth,
    );
    const supplyConfluenceState =
      trace.supplyConfluenceState ??
      (supplyProviderHealth.status === "VERIFIED" ? "NEUTRAL" : "UNKNOWN");
    const gate1Trace = buildGate1CandidateTrace({
      trace,
      regime,
      marketSession,
      macroGateState: input.macroGateState,
      supplyProviderHealth,
      supplyConfluenceState,
      gate1SoftFailThreshold: GATE1_SOFT_FAIL_ACCUMULATION_THRESHOLD,
    });
    trace.gate1Trace = gate1Trace;
    return gate1Trace;
  });
  const {
    report: gate1DecompositionReport,
    counterfactual: gate1CounterfactualSurvivorReport,
  } = buildGate1Reports({
    nowIso,
    forDate,
    regime,
    marketSession,
    traces: gate1CandidateTraces,
  });
  const minSignalScoreDecompositionReport =
    buildMinSignalScoreDecompositionReport({
      nowIso,
      forDate,
      regime,
      marketSession,
      traces: gate1CandidateTraces,
    });
  const signalScoreCalibrationResults = buildSignalScoreCalibrationResults({
    regime,
    traces: gate1CandidateTraces,
  });

  for (const trace of traces) {
    const onlyTimeBlocked =
      hasExecutionBlocker(trace, "TIME_WINDOW") && !nonTimeHardBlocked(trace);
    trace.wouldEnterIfNoTimeBlock =
      onlyTimeBlocked ||
      (!hasExecutionBlocker(trace, "TIME_WINDOW") &&
        !nonTimeHardBlocked(trace));
    const hasOrderRouteBlocker = trace.blockers.some(
      (b) => b.category === "ORDER_ROUTE" || b.category === "OPERATOR_CONTROL",
    );
    const nonOrderExecutionBlocked = trace.blockers.some((b) => {
      if (b.category === "ORDER_ROUTE" || b.category === "OPERATOR_CONTROL")
        return false;
      const scope = b.executionBlocking;
      return (
        scope === true || scope === "NEW_BUY_ONLY" || scope === "ALL_EXECUTION"
      );
    });
    trace.wouldEnterIfNoOrderBlock =
      hasOrderRouteBlocker && !nonOrderExecutionBlocked;
    trace.wouldEnterIfSectorEnergyIgnored = !trace.blockers.some(
      (b) =>
        b.category !== "SECTOR_ENERGY" &&
        b.category !== "TIME_WINDOW" &&
        (b.executionBlocking === true ||
          b.executionBlocking === "NEW_BUY_ONLY" ||
          b.executionBlocking === "ALL_EXECUTION"),
    );
    trace.wouldEnterIfKellyMinApplied = !trace.blockers.some(
      (b) =>
        b.category !== "KELLY_SIZING" &&
        b.category !== "TIME_WINDOW" &&
        (b.executionBlocking === true ||
          b.executionBlocking === "NEW_BUY_ONLY" ||
          b.executionBlocking === "ALL_EXECUTION"),
    );
    if (
      trace.wouldEnterIfNoTimeBlock &&
      hasExecutionBlocker(trace, "TIME_WINDOW")
    )
      trace.stageReached = "ORDER_BLOCKED";
    if (input.entries > 0 && !hasExecutionBlocker(trace))
      trace.executionImpact = "LIVE_READY";
  }

  const counterfactualTraces = traces
    .filter(
      (trace) =>
        trace.wouldEnterIfNoTimeBlock ||
        hasExecutionBlocker(trace, "TIME_WINDOW"),
    )
    .map(
      (trace): CounterfactualEntryTrace => ({
        timestamp: nowIso,
        forDate,
        symbol: trace.symbol,
        name: trace.name,
        wouldEnterReason: trace.wouldEnterIfNoTimeBlock
          ? ["WOULD_ENTER_IF_NO_TIME_BLOCK"]
          : ["ACTUAL_BLOCKERS_RECORDED_FOR_LEARNING"],
        actualBlockers: trace.blockers,
        executionImpact: "NONE",
        trackingHorizonDays: 20,
        source: "ADR-0464_ENTRY_TRACE",
      }),
    );

  const ledgerRows = traces.map((trace): EntryDecisionLedgerRow => {
    let finalDecision: EntryDecisionLedgerRow["finalDecision"] = "NO_SIGNAL";
    if (!hasExecutionBlocker(trace) && input.entries > 0)
      finalDecision = "ENTER_READY";
    else if (hasExecutionBlocker(trace, "TIME_WINDOW"))
      finalDecision = "BLOCKED_BY_TIME";
    else if (trace.blockers.some((b) => b.category === "KELLY_SIZING"))
      finalDecision = "BLOCKED_BY_SIZING";
    else if (
      trace.blockers.some(
        (b) =>
          b.category === "ORDER_ROUTE" || b.category === "OPERATOR_CONTROL",
      )
    )
      finalDecision = "BLOCKED_BY_ORDER_ROUTE";
    else if (
      trace.blockers.some(
        (b) =>
          b.category === "GATE1" ||
          b.category === "GATE2" ||
          b.category === "GATE3",
      )
    )
      finalDecision = "BLOCKED_BY_GATE";
    else if (trace.blockers.some((b) => b.severity === "DIAGNOSTIC_ONLY"))
      finalDecision = "DIAGNOSTIC_ONLY";
    return {
      timestamp: nowIso,
      forDate,
      symbol: trace.symbol,
      name: trace.name,
      regime,
      marketSession,
      stageReached: trace.stageReached,
      finalDecision,
      blockers: trace.blockers,
      wouldEnterIfNoTimeBlock: trace.wouldEnterIfNoTimeBlock ?? false,
      wouldEnterIfNoOrderBlock: trace.wouldEnterIfNoOrderBlock ?? false,
      counterfactualRecorded: counterfactualTraces.some(
        (cf) => cf.symbol === trace.symbol,
      ),
      minSignalScoreSummary: trace.gate1Trace?.minSignalScoreTrace
        ? {
            requiredScore: trace.gate1Trace.minSignalScoreTrace.requiredScore,
            actualScore: trace.gate1Trace.minSignalScoreTrace.actualScore,
            scoreGap: trace.gate1Trace.minSignalScoreTrace.scoreGap,
            unknownPenaltyTotal:
              trace.gate1Trace.minSignalScoreTrace.unknownPenaltyTotal,
            providerIssuePenaltyTotal:
              trace.gate1Trace.minSignalScoreTrace.providerIssuePenaltyTotal,
            riskPenaltyTotal:
              trace.gate1Trace.minSignalScoreTrace.riskPenaltyTotal,
            softFailPenaltyTotal:
              trace.gate1Trace.minSignalScoreTrace.softFailPenaltyTotal,
            tags: trace.gate1Trace.calibrationTags ?? [],
            executionImpact: "NONE",
          }
        : undefined,
      scoreCeilingRepairSummary: trace.gate1Trace?.minSignalScoreTrace
        ? buildEntryDecisionLedgerScoreCeilingRepairSummaryFromScore({
            requiredScore: trace.gate1Trace.minSignalScoreTrace.requiredScore,
            configuredPositiveMaxScore:
              trace.gate1Trace.minSignalScoreTrace.positiveScoreTotal,
            watchlistScoreNotImported: true,
            relativeStrengthZeroContribution: true,
            breakoutStructureZeroContribution: true,
            otherPositiveTooLarge: true,
          })
        : undefined,
      penaltyDedupSummary: trace.gate1Trace?.minSignalScoreTrace
        ? buildEntryDecisionLedgerPenaltyDedupSummaryFromScore({
            symbol: trace.symbol,
            grossPositiveScore:
              trace.gate1Trace.minSignalScoreTrace.positiveScoreTotal,
            originalPenaltyTotal: Math.abs(
              trace.gate1Trace.minSignalScoreTrace.penaltyTotal,
            ),
            originalNetScore: trace.gate1Trace.minSignalScoreTrace.actualScore,
            requiredScore: trace.gate1Trace.minSignalScoreTrace.requiredScore,
          })
        : undefined,
      riskDoubleCountSummary: trace.gate1Trace?.minSignalScoreTrace
        ? buildEntryDecisionLedgerRiskDoubleCountSummaryFromScore({
            symbol: trace.symbol,
            originalSignalScore:
              trace.gate1Trace.minSignalScoreTrace.actualScore,
            signalRiskPenalty:
              trace.gate1Trace.minSignalScoreTrace.riskPenaltyTotal,
            kellyMultiplier: 0.26,
            requiredScore: trace.gate1Trace.minSignalScoreTrace.requiredScore,
          })
        : undefined,
      finalCalibrationSummary: trace.gate1Trace?.minSignalScoreTrace
        ? buildEntryDecisionLedgerFinalCalibrationSummaryFromScore({
            symbol: trace.symbol,
            requiredScore: trace.gate1Trace.minSignalScoreTrace.requiredScore,
            netScore: trace.gate1Trace.minSignalScoreTrace.actualScore,
          })
        : undefined,
      positiveSourceWiringSummary: trace.gate1Trace?.minSignalScoreTrace
        ? buildEntryDecisionLedgerPositiveSourceWiringSummaryFromScore({
            watchlistUpstreamScore: 0,
            relativeStrengthScore: 0,
            breakoutStructureScore: 0,
            beforeScoreRange: 4,
            afterScoreRange: 8,
            otherPositiveRaw:
              trace.gate1Trace.minSignalScoreTrace.positiveScoreTotal,
            remainingOtherPositive:
              trace.gate1Trace.minSignalScoreTrace.positiveScoreTotal * 0.1,
          })
        : undefined,
      gate1TraceSummary: trace.gate1Trace
        ? {
            primaryGate1FailCode: trace.gate1Trace.primaryFailCode,
            providerIssue: trace.gate1Trace.conditions.some(
              (c) => !c.passed && c.providerIssue,
            ),
            marketSignal: trace.gate1Trace.conditions.some(
              (c) => !c.passed && c.marketSignal,
            ),
            hardFailCount: trace.gate1Trace.hardFailCount,
            softFailCount: trace.gate1Trace.softFailCount,
            tags: [
              ...(trace.gate1Trace.wouldPassIfProviderIssueSoftened
                ? ["CASE_GATE1_PROVIDER_SOFTENED_SURVIVOR"]
                : []),
              ...(trace.gate1Trace.conditions.some(
                (c) =>
                  !c.passed &&
                  (c.code === "INVESTOR_FLOW_SAMPLE_PASS" ||
                    c.code === "SUPPLY_CONFLUENCE_PASS"),
              )
                ? ["CASE_SUPPLY_SAMPLE_UNKNOWN"]
                : []),
              ...(gate1DecompositionReport.gate1Passed === 0
                ? ["CASE_GATE1_ZERO_SURVIVOR"]
                : []),
              ...(trace.gate1Trace.calibrationTags ?? []),
            ],
          }
        : undefined,
      primaryGate1FailCode: trace.gate1Trace?.primaryFailCode,
      providerIssue: trace.gate1Trace?.conditions.some(
        (c) => !c.passed && c.providerIssue,
      ),
      executionImpact: trace.executionImpact,
    };
  });

  const topMap = new Map<string, number>();
  for (const trace of traces)
    for (const b of trace.blockers)
      topMap.set(b.code, (topMap.get(b.code) ?? 0) + 1);
  const topBlockers = Array.from(topMap.entries())
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
  const providerIssueDowngraded = traces.filter((t) =>
    t.blockers.some((b) => b.category === "PROVIDER_ISSUE"),
  ).length;
  const blockedBySectorEnergyOnly = traces.filter(
    (t) =>
      t.blockers.some((b) => b.category === "SECTOR_ENERGY") &&
      !nonTimeHardBlocked(t),
  ).length;
  const learningBlocked = traces.filter((t) =>
    t.blockers.some((b) => b.learningBlocking),
  ).length;
  const watchlistAge = input.watchlistRefreshedAt
    ? Math.max(
        0,
        Math.round(
          (input.now.getTime() - Date.parse(input.watchlistRefreshedAt)) /
            60000,
        ),
      )
    : undefined;
  const watchlistHealth: WatchlistHealthReport = {
    count: input.watchlistCandidates,
    refreshedAt: input.watchlistRefreshedAt,
    ageMinutes: watchlistAge,
    isStale: watchlistAge !== undefined ? watchlistAge > 60 : false,
    source: input.watchlistSource ?? "signalScanner",
    candidatesFromUniverse: input.universeCandidates,
    candidatesAfterPreFilter: input.watchlistCandidates,
    reasonIfEmpty:
      input.watchlistCandidates === 0
        ? watchlistAge !== undefined && watchlistAge > 60
          ? "STALE"
          : "EMPTY_AFTER_PREFILTER"
        : undefined,
  };

  const conservativeFilters = topBlockers
    .map(({ code, count }) => ({
      code: mapConservativeCode(code),
      count,
      examples: traces
        .filter((t) => t.blockers.some((b) => b.code === code))
        .slice(0, 3)
        .map((t) => t.symbol),
    }))
    .filter((x) => x.code !== null) as {
    code: string;
    count: number;
    examples: string[];
  }[];
  const marketGreen = isGreenish(regime) && !isRiskOff(regime);
  const shouldReportConservatism =
    marketGreen && input.watchlistCandidates > 0 && input.entries === 0;
  const filterConservatismReport = shouldReportConservatism
    ? ({
        date: forDate,
        regime,
        marketGreen,
        watchlistCount: input.watchlistCandidates,
        entryCount: input.entries,
        missedSignalCount: input.watchlistCandidates - input.entries,
        ghostOpenCount: input.ghostOpenCount ?? 0,
        filterTooConservativeScore:
          input.filterTooConservativeScore ??
          Math.min(
            1,
            (input.watchlistCandidates - input.entries) /
              Math.max(1, input.watchlistCandidates),
          ),
        primaryConservativeFilters: conservativeFilters,
        recommendedAction: "DIAGNOSTIC_ONLY" as const,
      } satisfies FilterConservatismReport)
    : undefined;

  return {
    universeCandidates: input.universeCandidates,
    watchlistCandidates: input.watchlistCandidates,
    tracedCandidates: traces.length,
    entryReady: input.entries,
    blockedBeforeGate1: Math.max(
      0,
      input.watchlistCandidates - (gp?.gate1Pass ?? 0),
    ),
    blockedByTimeWindow: traces.filter((t) =>
      t.blockers.some((b) => b.code === "SELL_ONLY_TIME_WINDOW"),
    ).length,
    blockedByGate1: traces.filter((t) =>
      t.blockers.some((b) => b.category === "GATE1"),
    ).length,
    blockedByGate2: traces.filter((t) =>
      t.blockers.some((b) => b.category === "GATE2"),
    ).length,
    blockedByGate3: traces.filter((t) =>
      t.blockers.some((b) => b.category === "GATE3"),
    ).length,
    blockedByKellySizing: traces.filter((t) =>
      t.blockers.some((b) => b.category === "KELLY_SIZING"),
    ).length,
    blockedBySectorEnergyOnly,
    providerIssueDowngraded,
    blockedByOrderRoute: traces.filter((t) =>
      t.blockers.some(
        (b) =>
          b.category === "ORDER_ROUTE" || b.category === "OPERATOR_CONTROL",
      ),
    ).length,
    learningBlocked,
    counterfactualRecorded: Math.max(
      input.counterfactualRecordedToday ?? 0,
      counterfactualTraces.length,
    ),
    counterfactualReady: counterfactualTraces.filter((t) =>
      t.wouldEnterReason.includes("WOULD_ENTER_IF_NO_TIME_BLOCK"),
    ).length,
    ledgerRowsCreated: ledgerRows.length,
    wouldEnterIfNoTimeBlock: traces.filter((t) => t.wouldEnterIfNoTimeBlock)
      .length,
    wouldEnterIfNoOrderBlock: traces.filter((t) => t.wouldEnterIfNoOrderBlock)
      .length,
    wouldEnterIfSectorEnergyIgnored: traces.filter(
      (t) => t.wouldEnterIfSectorEnergyIgnored,
    ).length,
    wouldEnterIfKellyMinApplied: traces.filter(
      (t) => t.wouldEnterIfKellyMinApplied,
    ).length,
    topBlockers,
    candidateTraces: traces,
    counterfactualTraces,
    ledgerRows,
    kellySizingTraces: [kellyTrace],
    watchlistHealth,
    gate1CandidateTraces,
    gate1DecompositionReport,
    gate1CounterfactualSurvivorReport,
    minSignalScoreTraces: gate1CandidateTraces
      .map((t) => t.minSignalScoreTrace)
      .filter((t): t is MinimumSignalScoreTrace => Boolean(t)),
    unknownDataTreatmentAudits: gate1CandidateTraces
      .map((t) => t.unknownDataTreatmentAudit)
      .filter((t): t is UnknownDataTreatmentAudit => Boolean(t)),
    softFailAccumulationTraces: gate1CandidateTraces
      .map((t) => t.softFailAccumulationTrace)
      .filter((t): t is SoftFailAccumulationTrace => Boolean(t)),
    riskPenaltyTraces: gate1CandidateTraces
      .map((t) => t.riskPenaltyTrace)
      .filter((t): t is RiskPenaltyTrace => Boolean(t)),
    minSignalScoreDecompositionReport,
    signalScoreCalibrationResults,
    supplyProviderHealth: defaultSupplyProviderHealth,
    ...(filterConservatismReport ? { filterConservatismReport } : {}),
  };
}

function mapConservativeCode(code: string): string | null {
  switch (code) {
    case "GATE1_FAIL":
      return "GATE1_TOO_STRICT";
    case "GATE2_FAIL":
      return "GATE2_TOO_STRICT";
    case "SECTOR_ENERGY_DIAGNOSTIC_ONLY":
      return "SECTOR_ENERGY_STRONG_BUY_BLOCK_ONLY";
    case "KELLY_ADJUSTED_TOO_LOW":
      return "KELLY_MULTIPLIER_TOO_LOW";
    case "SELL_ONLY_TIME_WINDOW":
      return "SELL_ONLY_MASKING_ENTRY_SIGNAL";
    case "WATCHLIST_EMPTY_OR_STALE":
      return "WATCHLIST_EMPTY_OR_STALE";
    case "AUTOTRADE_DISABLED":
      return "ORDER_ROUTE_BLOCKED_BY_OPERATOR";
    default:
      return null;
  }
}

export function formatEntryFilterDecompositionSection(
  d?: EntryFilterDecomposition,
): string | null {
  if (!d) return null;
  const lines: string[] = [];
  lines.push("📊 <b>Entry Filter Decomposition (ADR-0464)</b>");
  const sample = d.candidateTraces[0];
  lines.push(`• regime: ${sample?.regime ?? "UNKNOWN"}`);
  lines.push(`• marketSession: ${sample?.marketSession ?? "UNKNOWN"}`);
  lines.push(`• universeCandidates: ${d.universeCandidates}`);
  lines.push(`• watchlistCandidates: ${d.watchlistCandidates}`);
  lines.push(`• tracedCandidates: ${d.tracedCandidates}`);
  lines.push(`• entryReady: ${d.entryReady}`);
  lines.push(`• counterfactualReady: ${d.counterfactualReady}`);
  lines.push(`• ledgerRowsCreated: ${d.ledgerRowsCreated}`);
  lines.push("");
  lines.push("차단 분포:");
  lines.push(`1. SELL_ONLY_TIME_WINDOW: ${d.blockedByTimeWindow}`);
  lines.push(`2. GATE1_FAIL: ${d.blockedByGate1}`);
  lines.push(`3. GATE2_FAIL: ${d.blockedByGate2}`);
  lines.push(`4. GATE3_FAIL: ${d.blockedByGate3}`);
  lines.push(`5. KELLY_ADJUSTED_TOO_LOW: ${d.blockedByKellySizing}`);
  lines.push(
    `6. SECTOR_ENERGY_DIAGNOSTIC_ONLY: ${d.blockedBySectorEnergyOnly}`,
  );
  lines.push(`7. ORDER_ROUTE_OPERATOR_BLOCK: ${d.blockedByOrderRoute}`);
  lines.push(`8. PROVIDER_ISSUE_DOWNGRADED: ${d.providerIssueDowngraded}`);
  lines.push(`9. learningBlocked: ${d.learningBlocked}`);
  lines.push(`10. counterfactualRecorded: ${d.counterfactualRecorded}`);
  if (d.topBlockers.length > 0) {
    lines.push("");
    lines.push("TOP blockers:");
    d.topBlockers
      .slice(0, 5)
      .forEach((b, idx) => lines.push(`${idx + 1}. ${b.code}: ${b.count}`));
  }
  const g1 = d.gate1DecompositionReport;
  const cf = d.gate1CounterfactualSurvivorReport;
  lines.push("");
  lines.push("🧩 <b>Gate1 Survivor Decomposition (ADR-0465)</b>");
  const gate1HardSurvivors = d.gate1CandidateTraces.filter((t) => t.gate1Passed && t.hardFailCount === 0 && t.softFailCount === 0).length;
  const gate1SoftSurvivors = d.gate1CandidateTraces.filter((t) => t.gate1Passed && t.softFailCount > 0).length;
  lines.push(`• candidates: ${g1.totalCandidates}`);
  lines.push(`• gate1Passed: ${g1.gate1Passed}`);
  lines.push(`• gate1HardSurvivors: ${gate1HardSurvivors}`);
  lines.push(`• gate1SoftSurvivors: ${gate1SoftSurvivors}`);
  lines.push(`• gate1Failed: ${g1.gate1Failed}`);
  lines.push(
    `• hardFailCandidates: ${d.gate1CandidateTraces.filter((t) => t.hardFailCount > 0).length}`,
  );
  lines.push(
    `• softFailOnlyCandidates: ${d.gate1CandidateTraces.filter((t) => t.hardFailCount === 0 && t.softFailCount > 0).length}`,
  );
  lines.push(
    `• providerIssueCandidates: ${d.gate1CandidateTraces.filter((t) => t.conditions.some((c) => !c.passed && c.providerIssue)).length}`,
  );
  const gate1Reasons = [
    ...Object.entries(g1.hardFailDistribution),
    ...Object.entries(g1.softFailDistribution),
    ...Object.entries(g1.providerIssueDistribution).filter(
      ([code]) =>
        !(code in g1.softFailDistribution) &&
        !(code in g1.hardFailDistribution),
    ),
  ].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (gate1Reasons.length > 0) {
    lines.push("");
    lines.push("Gate1 실패 원인:");
    gate1Reasons
      .slice(0, 7)
      .forEach(([code, count], idx) =>
        lines.push(`${idx + 1}. ${code}: ${count}`),
      );
  }
  lines.push("");
  lines.push("Provider Health:");
  lines.push(`• status: ${d.supplyProviderHealth.status}`);
  lines.push(`• providerIssue: ${d.supplyProviderHealth.providerIssue}`);
  lines.push(`• marketSignal: ${d.supplyProviderHealth.marketSignal}`);
  lines.push(
    `• lastSampleAt: ${d.supplyProviderHealth.lastSampleAt ?? "unknown"}`,
  );
  lines.push(
    `• ageMinutes: ${d.supplyProviderHealth.ageMinutes ?? "unknown"} / expectedMaxAgeMinutes: ${d.supplyProviderHealth.expectedMaxAgeMinutes ?? "unknown"}`,
  );
  lines.push(`• gate1Severity: ${d.supplyProviderHealth.gate1Severity}`);
  lines.push(
    `• supplyConfluence: ${d.gate1CandidateTraces[0]?.conditions.find((c) => c.code === "SUPPLY_CONFLUENCE_PASS")?.value ?? "UNKNOWN"}`,
  );
  lines.push("");
  lines.push("Counterfactual Survivor:");
  lines.push(`• actualGate1Survivors: ${cf.actualGate1Survivors}`);
  lines.push(`• ifProviderIssueSoftened: ${cf.ifProviderIssueSoftened}`);
  lines.push(`• ifSupplySampleIgnored: ${cf.ifSupplySampleIgnored}`);
  lines.push(`• ifSectorEnergyIgnored: ${cf.ifSectorEnergyIgnored}`);
  const min = d.minSignalScoreDecompositionReport;
  const thresholdMinus5 =
    d.signalScoreCalibrationResults.find(
      (r) => r.scenario === "MIN_SIGNAL_THRESHOLD_MINUS_5",
    )?.hypotheticalSurvivors ?? 0;
  const thresholdMinus10 =
    d.signalScoreCalibrationResults.find(
      (r) => r.scenario === "MIN_SIGNAL_THRESHOLD_MINUS_10",
    )?.hypotheticalSurvivors ?? 0;
  const r3Adaptive =
    d.signalScoreCalibrationResults.find(
      (r) => r.scenario === "R3_EARLY_ADAPTIVE_THRESHOLD",
    )?.hypotheticalSurvivors ?? 0;
  lines.push("");
  lines.push("📐 <b>Min Signal Score Decomposition (ADR-0466)</b>");
  lines.push(`• candidates: ${min.totalCandidates}`);
  const minSignalLivePass = Math.max(0, min.totalCandidates - min.minSignalFailed);
  const minSignalShadowEligible = d.gate1CandidateTraces.filter((t) => t.hardFailCount === 0).length;
  lines.push(`• minSignalFailed: ${min.minSignalFailed}`);
  lines.push(`• minSignalLivePass: ${minSignalLivePass}`);
  lines.push(`• minSignalShadowEligible: ${minSignalShadowEligible}`);
  lines.push("• note: Gate1 survivor는 Live pass가 아니라 Shadow/Watch 생존 후보입니다.");
  lines.push("• note: MinSignalScore failed는 live score threshold 미달이며, hard fail과 다릅니다.");
  lines.push(`• requiredScoreAvg: ${min.requiredScoreAvg.toFixed(1)}`);
  lines.push(`• actualScoreAvg: ${min.actualScoreAvg.toFixed(1)}`);
  lines.push(
    `• actualScoreMin/Max: ${min.actualScoreMin.toFixed(1)} / ${min.actualScoreMax.toFixed(1)}`,
  );
  lines.push(`• avgScoreGap: ${min.avgScoreGap.toFixed(1)}`);
  if (min.topScoreDeficits.length > 0) {
    lines.push("");
    lines.push("점수 부족 TOP:");
    min.topScoreDeficits.forEach((item, idx) =>
      lines.push(
        `${idx + 1}. ${item.code}: avg ${item.avgImpact.toFixed(1)} / ${item.affectedCount}`,
      ),
    );
  }
  lines.push("");
  lines.push("마스킹/보정 시나리오:");
  lines.push(`• wouldPassIfUnknownNeutral: ${min.wouldPassIfUnknownNeutral}`);
  lines.push(
    `• wouldPassIfProviderPenaltyRemoved: ${min.wouldPassIfProviderPenaltyRemoved}`,
  );
  lines.push(
    `• wouldPassIfSessionPenaltyRemoved: ${min.wouldPassIfSessionPenaltyRemoved}`,
  );
  lines.push(
    `• wouldPassIfRiskPenaltyCapped: ${min.wouldPassIfRiskPenaltyCapped}`,
  );
  lines.push(
    `• wouldPassIfSoftFailPenaltyRemoved: ${min.wouldPassIfSoftFailPenaltyRemoved}`,
  );
  lines.push(`• thresholdMinus5Survivors: ${thresholdMinus5}`);
  lines.push(`• thresholdMinus10Survivors: ${thresholdMinus10}`);
  lines.push(`• r3EarlyAdaptiveThresholdSurvivors: ${r3Adaptive}`);
  lines.push(`• unknownAsBearishWarnings: ${min.unknownTreatmentWarnings}`);
  lines.push("");
  lines.push("판정:");
  lines.push(
    g1.recommendedAction === "REPAIR_PROVIDER_HEALTH"
      ? "• Gate1 zero survivor는 시장 약세보다 provider freshness 문제의 영향이 큽니다."
      : "• Gate1 zero survivor 원인을 provider/market/supply 축으로 분리해 추적합니다.",
  );
  lines.push(
    "• 수급 sample 없음은 bearish가 아니라 unknown/provider issue입니다.",
  );
  lines.push(
    `• live execution은 보류하고, provider-softened survivor ${cf.ifProviderIssueSoftened}개를 counterfactual로 추적합니다.`,
  );
  lines.push("");
  lines.push("operatorAction:");
  lines.push("• investor-flow provider warmup 상태 점검");
  lines.push("• provider sample age / cache key 확인");
  lines.push(
    `• provider issue soft-fail 적용 시 예상 survivor ${cf.ifProviderIssueSoftened}개 (executionImpact=NONE)`,
  );
  lines.push("• threshold 변경 전 3영업일 counterfactual 성과 확인");
  lines.push("");
  lines.push("마스킹 해제 분석:");
  lines.push(`• wouldEnterIfNoTimeBlock: ${d.wouldEnterIfNoTimeBlock}`);
  lines.push(`• wouldEnterIfNoOrderBlock: ${d.wouldEnterIfNoOrderBlock}`);
  lines.push(
    `• wouldEnterIfSectorEnergyIgnored: ${d.wouldEnterIfSectorEnergyIgnored}`,
  );
  lines.push(`• wouldEnterIfKellyMinApplied: ${d.wouldEnterIfKellyMinApplied}`);
  if (d.kellySizingTraces[0]) {
    const k = d.kellySizingTraces[0];
    lines.push("");
    lines.push("Kelly/Sizing zero 분해:");
    lines.push(
      `• regime ×${k.regimeMultiplier.toFixed(2)} / FOMC ×${k.fomcMultiplier.toFixed(2)} / sector ×${k.sectorMultiplier.toFixed(2)} / risk ×${k.riskMultiplier.toFixed(2)} → finalKelly ${k.finalKelly.toFixed(4)}`,
    );
  }
  if (d.filterConservatismReport) {
    lines.push("");
    lines.push("판정:");
    lines.push(
      `• FILTER_TOO_CONSERVATIVE 후보: ${
        d.filterConservatismReport.primaryConservativeFilters
          .map((f) => f.code)
          .slice(0, 3)
          .join(" / ") || "DIAGNOSTIC_ONLY"
      }`,
    );
    lines.push("• threshold 변경 전 counterfactual 결과 확인 권장");
  }
  return lines.join("\n");
}
