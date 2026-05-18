// @responsibility Normal supply preview data-shape types.
import {
  NORMAL_SUPPLY_DIAGNOSTIC_FULL_PREVIEW_MODE,
  NORMAL_SUPPLY_DIAGNOSTIC_PREVIEW_MODE,
} from './constants.js';
import type {
  ActivePassiveConfluence,
  ActivePassiveConfluenceCounts,
  ProgramFlowDiagnostic,
  ProgramFlowDiagnosticsSummary,
  ProgramFlowDryRunDiagnostic,
  ProgramFlowEvidenceTrace,
  ProgramFlowSignal,
  ProgramFlowSourceProvider,
  ProgramFlowUpstreamPopulationTrace,
  ProgramFlowValueReason,
} from './programFlowTypes.js';
import type {
  CandidateWithSupplyContext,
  PerSymbolSupplyContext,
  PerSymbolSupplyInjectionStats,
  SupplyProviderHealth,
  SupplySignal,
} from '../injectPerSymbolSupplyContext.js';

export type NormalSupplyPreviewMode = typeof NORMAL_SUPPLY_DIAGNOSTIC_PREVIEW_MODE;
export type NormalSupplyPreviewFullMode = typeof NORMAL_SUPPLY_DIAGNOSTIC_FULL_PREVIEW_MODE;

export type NormalSupplyPreviewEngineMode =
  | 'NORMAL'
  | 'SELL_ONLY'
  | 'MACRO_LIVE_BLOCK'
  | 'PRE_FLIGHT_BLOCK'
  | 'HARD_BLOCK'
  | 'POSITION_FULL'
  | 'UNKNOWN'
  | string;

export interface NormalSupplyPreviewCandidate {
  symbol: string;
  name?: string;
  sourceProvider: PerSymbolSupplyContext['provider'];
  dataStatus: SupplyProviderHealth;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
  supplyProviderHealth: SupplyProviderHealth;
  supplySignal: SupplySignal;
  providerIssue: boolean;
  marketSignal: boolean;
  executionImpact: PerSymbolSupplyContext['executionImpact'];
  supplyScore: number;
  summary: string;
  reason: string;
  invalidBearishReason?: 'PROVIDER_ISSUE_SHOULD_NOT_BE_BEARISH';
  invalidBullishReason?: 'PROVIDER_ISSUE_SHOULD_NOT_BE_BULLISH';
  usedForLiveDecision: false;
  strongBuyAllowed: false;
  watchlistPriorityBoost: number;
  shadowTracking: boolean;
  foreignNetBuyAmount?: number;
  institutionNetBuyAmount?: number;
  stockProgramNetBuyAmount?: number;
  stockProgramNetBuy?: number;
  programNetBuy?: number;
  programNetBuyAmount?: number;
  nonProgramNetBuyAmount?: number;
  programFlow?: ProgramFlowDiagnostic;
  programFlowDryRun: ProgramFlowDryRunDiagnostic;
  activeFlow: string;
  passiveFlow: string;
  activePassiveConfluence: ActivePassiveConfluence;
  programMissingAsBearish: false;
  programValueReason?: ProgramFlowValueReason;
  fetchedAt?: string;
  rawStatus?: string;
  semanticRowAvailable: boolean;
  rawInvestorRowAvailable: boolean;
  selectedCandidateCarriesSemanticRow: boolean;
  selectedCandidateCarriesActualRow: boolean;
}

export interface NormalSupplySignalSourceSplit {
  bullishFromMarketSignal: number;
  bullishFromProviderIssue: number;
  accumulatingFromMarketSignal: number;
  accumulatingFromProviderIssue: number;
  bearishFromMarketSignal: number;
  bearishFromProviderIssue: number;
  neutralFromVerifiedData: number;
  unusableFromDataQuality: number;
}

export interface NormalSupplyFieldAvailability {
  total: number;
  foreignNetBuyField: number;
  institutionNetBuyField: number;
  programNetBuyField: number;
  stockProgramNetBuyField: number;
  stockProgramAvailable: number;
  stockProgramRowsAvailable: number;
  stockProgramRowsWithAnyProgramKey: number;
  stockProgramRowsWithNumericProgramValue: number;
  stockProgramRowsWithParsableProgramValue: number;
  stockProgramValueReasonDistribution: Record<string, number>;
  stockProgramValueReasonTop: string;
  stockProgramSanitizedSampleTop: string[];
  stockProgramFieldKeysTop: string;
  stockProgramBreakPoint: ProgramFlowEvidenceTrace['stockLevel']['breakPoint'];
  marketProgramAvailable: boolean;
  marketProgramSignal: ProgramFlowSignal;
  marketProgramSource: ProgramFlowSourceProvider;
  marketProgramContextFound: boolean;
  marketProgramBreakPoint: ProgramFlowEvidenceTrace['marketLevel']['breakPoint'];
  marketProgramParsableFieldsFound: string[];
  marketProgramValueReasonTop: string;
  marketProgramSanitizedSample?: string;
  missingProgramFlowAsBearish: false;
  marketProgramProviderIssue: boolean;
  marketProgramMarketSignal: boolean;
  programPenaltyApplied: false;
  programFlowUsedForLiveDecision: false;
  passiveProxyUsedForLiveDecision: false;
  providerCallsAdded: 0;
  executionImpact: 'NONE';
  semanticRowAvailable: number;
  rawInvestorRowAvailable: number;
  selectedCandidateCarriesSemanticRow: number;
  selectedCandidateCarriesActualRow: number;
}

export interface NormalSupplyPreviewSafety {
  providerIssueAsBearish: false;
  unknownPenaltyApplied: false;
  staleAsBearish: false;
  missingAsBearish: false;
  realOrderAllowed: false;
  accumulatingUsedForLiveDecision: false;
  accumulatingAllowsStrongBuy: false;
  accumulatingAllowsWatchlistBoost: true;
  accumulatingAllowsShadowTracking: true;
}

export interface NormalSupplyPreview {
  capturedAt: string;
  engineMode: NormalSupplyPreviewEngineMode;
  previewMode: NormalSupplyPreviewMode;
  source: 'PREFLIGHT_ABORT_DIAGNOSTIC' | 'RUNTIME_DIAGNOSTIC' | 'COMMAND';
  reason?: string;
  preflightDecision?: string;
  liveExecutionAllowed: false;
  realOrderAllowed: false;
  strongBuyAllowed: false;
  shadowObservableAllowed: true;
  executionImpact: 'NONE';
  candidateCount: number;
  supplyInjection: PerSymbolSupplyInjectionStats;
  healthCounts: Record<SupplyProviderHealth, number>;
  signalCounts: Record<SupplySignal, number>;
  candidates: NormalSupplyPreviewCandidate[];
  topCandidates: NormalSupplyPreviewCandidate[];
  signalSourceSplit: NormalSupplySignalSourceSplit;
  fieldAvailability: NormalSupplyFieldAvailability;
  activePassiveConfluenceCounts: ActivePassiveConfluenceCounts;
  programFlowDiagnostics: ProgramFlowDiagnosticsSummary;
  programFlowEvidenceTrace: ProgramFlowEvidenceTrace;
  programFlowUpstreamPopulationTrace: ProgramFlowUpstreamPopulationTrace;
  safety: NormalSupplyPreviewSafety;
}

export interface PersistNormalSupplyPreviewInput<T extends CandidateWithSupplyContext = CandidateWithSupplyContext> {
  engineMode: NormalSupplyPreviewEngineMode;
  source: NormalSupplyPreview['source'];
  candidates: T[];
  supplyInjection?: PerSymbolSupplyInjectionStats;
  reason?: string;
  preflightDecision?: string;
  capturedAt?: string;
  topN?: number;
  marketProgramFlow?: unknown;
  marketProgramCarrySource?: unknown;
}
