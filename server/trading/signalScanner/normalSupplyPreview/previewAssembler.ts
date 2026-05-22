// @responsibility Normal supply preview in-memory result assembly.
import { NORMAL_SUPPLY_DIAGNOSTIC_PREVIEW_MODE } from './constants.js';
import type {
  ActivePassiveConfluence,
  ActivePassiveConfluenceCounts,
  ProgramFlowDiagnosticsSummary,
  ProgramFlowEvidenceTrace,
  ProgramFlowUpstreamPopulationTrace,
} from './programFlowTypes.js';
import type {
  NormalSupplyFieldAvailability,
  NormalSupplyPreview,
  NormalSupplyPreviewCandidate,
  NormalSupplyPreviewEngineMode,
  NormalSupplySignalSourceSplit,
} from './types.js';

const CONFLUENCE_LABELS: ActivePassiveConfluence[] = [
  'ACTIVE_PASSIVE_CONFIRMED_BUY',
  'ACTIVE_BUYING_ONLY',
  'PASSIVE_BUYING_ONLY',
  'ACTIVE_PASSIVE_CONFIRMED_SELL',
  'ACTIVE_SELLING_ONLY',
  'PASSIVE_SELLING_ONLY',
  'MIXED_FLOW',
  'NEUTRAL_FLOW',
  'PROGRAM_FLOW_UNAVAILABLE',
];

export interface AssembleNormalSupplyPreviewInput {
  capturedAt: string;
  engineMode: NormalSupplyPreviewEngineMode;
  source: NormalSupplyPreview['source'];
  reason?: string;
  preflightDecision?: string;
  candidates: NormalSupplyPreviewCandidate[];
  supplyInjection?: NormalSupplyPreview['supplyInjection'];
  fieldAvailability: NormalSupplyFieldAvailability;
  programFlowDiagnostics: ProgramFlowDiagnosticsSummary;
  programFlowEvidenceTrace: ProgramFlowEvidenceTrace;
  programFlowUpstreamPopulationTrace: ProgramFlowUpstreamPopulationTrace;
  topN?: number;
}

export function assembleNormalSupplyPreview(input: AssembleNormalSupplyPreviewInput): NormalSupplyPreview {
  const healthCounts = countHealth(input.candidates);
  const signalCounts = countSignals(input.candidates);
  const supplyInjection = input.supplyInjection ?? buildSupplyInjectionFromCandidates(input.candidates, healthCounts);
  const topCandidates = [...input.candidates]
    .sort((a, b) => b.supplyScore - a.supplyScore || a.symbol.localeCompare(b.symbol))
    .slice(0, input.topN ?? 5);

  return {
    capturedAt: input.capturedAt,
    engineMode: input.engineMode,
    previewMode: NORMAL_SUPPLY_DIAGNOSTIC_PREVIEW_MODE,
    source: input.source,
    reason: input.reason,
    preflightDecision: input.preflightDecision,
    liveExecutionAllowed: false,
    realOrderAllowed: false,
    strongBuyAllowed: false,
    shadowObservableAllowed: true,
    executionImpact: 'NONE',
    candidateCount: input.candidates.length,
    supplyInjection,
    healthCounts,
    signalCounts,
    candidates: input.candidates,
    topCandidates,
    signalSourceSplit: buildSignalSourceSplit(input.candidates),
    fieldAvailability: input.fieldAvailability,
    activePassiveConfluenceCounts: buildActivePassiveConfluenceCounts(input.candidates),
    programFlowDiagnostics: input.programFlowDiagnostics,
    programFlowEvidenceTrace: input.programFlowEvidenceTrace,
    programFlowUpstreamPopulationTrace: input.programFlowUpstreamPopulationTrace,
    safety: {
      providerIssueAsBearish: false,
      unknownPenaltyApplied: false,
      staleAsBearish: false,
      missingAsBearish: false,
      realOrderAllowed: false,
      accumulatingUsedForLiveDecision: false,
      accumulatingAllowsStrongBuy: false,
      accumulatingAllowsWatchlistBoost: true,
      accumulatingAllowsShadowTracking: true,
    },
    runtimePermission: {
      gatePolicyLiveAllowed: true,
      macroLiveAllowed: input.engineMode !== 'MACRO_LIVE_BLOCK',
      engineMode: input.engineMode,
      brokerOrderAllowed: false,
      operatorOrderAllowed: false,
      actualLiveOrderAllowed: false,
      liveBlockReason: input.engineMode === 'MACRO_LIVE_BLOCK'
        ? 'MACRO_LIVE_BLOCK'
        : input.engineMode === 'SELL_ONLY'
          ? 'SELL_ONLY_MODE'
          : 'SHADOW_ONLY_MODE',
      shadowAllowed: true,
      counterfactualAllowed: true,
      executionImpact: 'NONE',
    },
  };
}

function buildActivePassiveConfluenceCounts(candidates: NormalSupplyPreviewCandidate[]): ActivePassiveConfluenceCounts {
  const counts = Object.fromEntries(CONFLUENCE_LABELS.map((label) => [label, 0])) as ActivePassiveConfluenceCounts;
  for (const candidate of candidates) counts[candidate.activePassiveConfluence] += 1;
  return counts;
}

function countHealth(candidates: NormalSupplyPreviewCandidate[]): NormalSupplyPreview['healthCounts'] {
  const counts: NormalSupplyPreview['healthCounts'] = {
    VERIFIED: 0,
    DEGRADED: 0,
    STALE: 0,
    MISSING: 0,
    UNKNOWN: 0,
  };
  for (const candidate of candidates) counts[candidate.supplyProviderHealth] += 1;
  return counts;
}

function countSignals(candidates: NormalSupplyPreviewCandidate[]): NormalSupplyPreview['signalCounts'] {
  const counts: NormalSupplyPreview['signalCounts'] = {
    BULLISH: 0,
    ACCUMULATING: 0,
    NEUTRAL: 0,
    BEARISH: 0,
    UNUSABLE: 0,
  };
  for (const candidate of candidates) counts[candidate.supplySignal] += 1;
  return counts;
}

function buildSignalSourceSplit(candidates: NormalSupplyPreviewCandidate[]): NormalSupplySignalSourceSplit {
  const split: NormalSupplySignalSourceSplit = {
    bullishFromMarketSignal: 0,
    bullishFromProviderIssue: 0,
    accumulatingFromMarketSignal: 0,
    accumulatingFromProviderIssue: 0,
    bearishFromMarketSignal: 0,
    bearishFromProviderIssue: 0,
    neutralFromVerifiedData: 0,
    unusableFromDataQuality: 0,
  };
  for (const candidate of candidates) {
    if (candidate.supplySignal === 'BULLISH') {
      if (candidate.providerIssue) split.bullishFromProviderIssue += 1;
      else if (candidate.marketSignal) split.bullishFromMarketSignal += 1;
    } else if (candidate.supplySignal === 'ACCUMULATING') {
      if (candidate.providerIssue) split.accumulatingFromProviderIssue += 1;
      else if (candidate.marketSignal) split.accumulatingFromMarketSignal += 1;
    } else if (candidate.supplySignal === 'BEARISH') {
      if (candidate.providerIssue) split.bearishFromProviderIssue += 1;
      else if (candidate.marketSignal) split.bearishFromMarketSignal += 1;
    } else if (candidate.supplySignal === 'NEUTRAL' && candidate.supplyProviderHealth === 'VERIFIED') {
      split.neutralFromVerifiedData += 1;
    } else if (
      candidate.supplySignal === 'UNUSABLE' ||
      candidate.supplyProviderHealth === 'MISSING' ||
      candidate.supplyProviderHealth === 'STALE' ||
      candidate.supplyProviderHealth === 'UNKNOWN'
    ) {
      split.unusableFromDataQuality += 1;
    }
  }
  return split;
}

function buildSupplyInjectionFromCandidates(
  candidates: NormalSupplyPreviewCandidate[],
  health: NormalSupplyPreview['healthCounts'],
): NormalSupplyPreview['supplyInjection'] {
  return {
    totalCandidates: candidates.length,
    requestedSymbols: candidates.length,
    receivedResults: candidates.length,
    injected: health.VERIFIED,
    verified: health.VERIFIED,
    degraded: health.DEGRADED,
    stale: health.STALE,
    missing: health.MISSING,
    unknown: health.UNKNOWN,
    routerConnected: candidates.length > 0,
    gateContextConnected: candidates.length > 0,
  };
}
