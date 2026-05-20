/**
 * @responsibility ADR-0464 entry filter schema surface.
 */

import type {
  MacroGateState,
  WaitDistribution,
  GatePassDistribution,
} from "../scanDiagnostics.js";
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
} from "../minimumSignalScoreTrace.js";
import {
  buildEntryDecisionLedgerScoreCeilingRepairSummaryFromScore,
  type EntryDecisionLedgerScoreCeilingRepairSummary,
} from "../gate1ScoreCeilingRepair.js";
import {
  buildEntryDecisionLedgerPenaltyDedupSummaryFromScore,
  type EntryDecisionLedgerPenaltyDedupSummary,
} from "../gate1PenaltyDeduplication.js";
import {
  buildEntryDecisionLedgerRiskDoubleCountSummaryFromScore,
  type EntryDecisionLedgerRiskDoubleCountSummary,
} from "../gate1RiskDoubleCount.js";
import {
  buildEntryDecisionLedgerFinalCalibrationSummaryFromScore,
  type EntryDecisionLedgerFinalCalibrationSummary,
} from "../gate1FinalCalibration.js";
import {
  buildEntryDecisionLedgerPositiveSourceWiringSummaryFromScore,
  type EntryDecisionLedgerPositiveSourceWiringSummary,
} from "../gate1PositiveSourceWiringAdr0475.js";
import {
  resolveWatchlistUpstreamScore,
  type ResolvedWatchlistUpstreamScore,
} from "../watchlistUpstreamScoreResolver.js";
import type { GateConditionResultTrace } from "../gateConditionResultTrace.js";
import type { SanitizedInvestorFlowSemanticRow } from "../../../supply/investorFlowSemanticAvailability.js";

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
  | "MISSING"
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
  requestSymbol?: string | null;
  candidateSymbol?: string | null;
  quoteSymbol?: string | null;
  providerSymbol?: string | null;
  normalizedSymbol?: string | null;
  providerScope?: "SYMBOL_LEVEL" | "MARKET_LEVEL" | "SECTOR_LEVEL" | "UNKNOWN";
  routePurpose?: string;
  materialized?: boolean;
  usableForRouter?: boolean;
  usableForGate?: false;
  usableForLive?: false;
  usableForShadow?: true;
  semanticNetBuyStatus?: string;
  semanticNetBuySignal?: string;
  semanticRow?: SanitizedInvestorFlowSemanticRow | null;
  actualInvestorRow?: Record<string, unknown> | null;
  diagnosticActualInvestorRow?: Record<string, unknown> | null;
  normalizedInvestorRow?: Record<string, unknown> | null;
  semanticInvestorRow?: SanitizedInvestorFlowSemanticRow | Record<string, unknown> | null;
  supplySemanticRow?: SanitizedInvestorFlowSemanticRow | Record<string, unknown> | null;
  sanitizedInvestorFlowRows?: Array<Record<string, unknown>>;
  actualInvestorFlowRows?: Array<Record<string, unknown>>;
  actualInvestorFlowRowCount?: number;
  actualInvestorFlowRowSourcePath?: string | null;
  actualInvestorFlowFieldKeys?: string[];
  actualInvestorFlowNumericKeys?: string[];
  actualInvestorFlowNumericStringKeys?: string[];
  actualInvestorFlowCarried?: boolean;
  selectedCandidate?: Record<string, unknown> | null;
  selectedActualRowPath?: string | null;
  selectedActualRowFieldKeys?: string[];
  selectedActualNumericFieldKeys?: string[];
  selectedActualNumericStringFieldKeys?: string[];
  selectedActualPlaceholderFieldKeys?: string[];
  kisRawRowAvailableAtAdapter?: boolean;
  kisNormalizedRowAvailableAtRouter?: boolean;
  kisSelectedCandidateCarriesSemanticRow?: boolean;
  forensicInputCarriesSemanticRow?: boolean;
  semanticRowBreakPoint?: string;
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
  currentPrice?: number;
  high5d?: number;
  high20d?: number;
  high60?: number;
  volumeRatio?: number;
  aboveMA20?: boolean;
  aboveMA60?: boolean;
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
  watchlistScore?: ResolvedWatchlistUpstreamScore;
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
  conditionResultsTrace?: GateConditionResultTrace[];
  conditionResults?: Record<string, unknown>;
  conditionKeys?: string[];
  gateRawScore?: number;
  normalizedGateScore?: number;
  availableMaxScore?: number;
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
  upstreamCandidateScore?: number;
  watchlistRank?: number;
  totalCandidates?: number;
  stage2Score?: number;
  watchlistScore?: number;
  stage1Score?: number;
  priorityScore?: number;
  qualScore?: number;
  score?: number;
  conditionKeys?: string[];
  conditionResultsTrace?: GateConditionResultTrace[];
  gateRawScore?: number;
  normalizedGateScore?: number;
  availableMaxScore?: number;
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
        symbol?: string;
        code?: string;
        price?: number;
        currentPrice?: number;
        changePercent?: number;
        high5d?: number;
        high20d?: number;
        high20?: number;
        high60?: number;
        ma5?: number;
        ma20?: number;
        ma60?: number;
        volume?: number;
        avgVolume?: number;
        volumeRatio?: number;
        rsi14?: number;
        atr?: number;
        atr20avg?: number;
        bbWidthCurrent?: number;
        bbWidth20dAvg?: number;
        vol5dAvg?: number;
        vol20dAvg?: number;
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
  currentPrice?: number;
  high5d?: number;
  high20d?: number;
  high60?: number;
  volumeRatio?: number;
  aboveMA20?: boolean;
  aboveMA60?: boolean;
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
  currentPrice?: number;
  high5d?: number;
  high20d?: number;
  high60?: number;
  volumeRatio?: number;
  aboveMA20?: boolean;
  aboveMA60?: boolean;
  ma20?: number;
  ma60?: number;
  rsi14?: number;
  atr?: number;
  atr20avg?: number;
  totalGateScore?: number;
  watchlistUpstreamScore?: number;
  upstreamScore?: number;
  upstreamCandidateScore?: number;
  watchlistRank?: number;
  totalCandidates?: number;
  stage2Score?: number;
  watchlistScore?: number;
  stage1Score?: number;
  priorityScore?: number;
  qualScore?: number;
  score?: number;
  conditionKeys?: string[];
  conditionResultsTrace?: GateConditionResultTrace[];
  gateRawScore?: number;
  normalizedGateScore?: number;
  availableMaxScore?: number;
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
        symbol?: string;
        code?: string;
        price?: number;
        currentPrice?: number;
        changePercent?: number;
        high5d?: number;
        high20d?: number;
        high20?: number;
        high60?: number;
        ma5?: number;
        ma20?: number;
        ma60?: number;
        volume?: number;
        avgVolume?: number;
        volumeRatio?: number;
        rsi14?: number;
        atr?: number;
        atr20avg?: number;
        bbWidthCurrent?: number;
        bbWidth20dAvg?: number;
        vol5dAvg?: number;
        vol20dAvg?: number;
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

export interface BuildDecompositionInput {
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
