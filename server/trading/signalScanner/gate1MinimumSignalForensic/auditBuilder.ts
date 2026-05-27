/**
 * @responsibility ADR-0505 audit builder surface.
 */

import type {
  MinimumSignalScoreTrace,
  SignalScoreComponentTrace,
  SignalScoreComponentCode,
  SignalScoreComponentConfidence,
} from '../minimumSignalScoreTrace.js';
import type {
  CandidateEntryTrace,
  SupplyConfluenceState,
  SupplyProviderHealthTrace,
} from '../entryFilterDecomposition.js';
import type { SectorEnergyExecutionImpactResult } from '../../../clients/sectorEnergyExecutionImpact.js';
import { resolveWatchlistUpstreamScore } from '../watchlistUpstreamScoreResolver.js';
import { conditionResultsTraceToMap, type GateConditionResultTrace } from '../gateConditionResultTrace.js';
import {
  evaluateInvestorFlowSemanticAvailabilityV2,
  extractFlatInvestorFlowRow,
  hasActualInvestorNumericRow,
  shouldEmitSupplySemanticWireDiagLog,
  type InvestorFlowSemanticAvailabilityReason,
  type InvestorFlowSemanticAvailabilityResult,
  type InvestorFlowFieldKeyDiscoveryDiagnostic,
  type SanitizedInvestorFlowSemanticRow,
} from '../../../supply/investorFlowSemanticAvailability.js';
import type { InvestorRowMaterializationClass } from '../investorFlowProviderRouterAdr0477.js';
import { shouldSuppressNoise, recordNoiseSuppressed } from '../../../utils/logger.js';
import type {
  BuildGate1MinimumSignalForensicInput,
  ComponentForensicDetail,
  DominantFailureReason,
  Gate1EvaluationState,
  Gate1ForensicTraceSourcePath,
  Gate1MinimumSignalForensicAuditAdr0505,
  MissingPositiveSource,
  WatchlistBreakPointAdr0510,
  QuoteHydrationBreakPointAdr0510,
  ConditionResultsBreakPointAdr0510,
  SectorEnergyForensicAudit,
  WouldPassIfFlags,
} from './types.js';
import { buildFeatureHydrationAuditAdr0509 } from './featureHydrationAudit.js';
import { buildSupplyScopeAudit } from './supplyScopeAudit.js';

export function isGate1MinimumSignalForensicAuditDisabled(): boolean {
  return process.env.GATE1_MINIMUM_SIGNAL_FORENSIC_ADR_0505_DISABLED === 'true';
}

/* ───────── Schema SSOT (사용자 명시 직접 반영, literal types 강제) ───────── */

const POSITIVE_COMPONENT_CODES: ReadonlySet<SignalScoreComponentCode> = new Set([
  'PRICE_MOMENTUM',
  'VOLUME_LIQUIDITY',
  'TECHNICAL_TREND',
  'RELATIVE_STRENGTH',
  'WATCHLIST_UPSTREAM_SCORE',
  'BREAKOUT_STRUCTURE',
  'SUPPLY_CONFLUENCE',
  'INVESTOR_FLOW',
  'SECTOR_ENERGY',
  'MARKET_REGIME',
  'NEWS_OR_CATALYST',
  'WATCHLIST_PRIORITY',
]);

const PENALTY_COMPONENT_CODES: ReadonlySet<SignalScoreComponentCode> = new Set([
  'MACRO_RISK',
  'DATA_QUALITY',
  'SESSION_STATUS',
  'RISK_PENALTY',
  'UNKNOWN_DATA_PENALTY',
  'SOFT_FAIL_PENALTY',
]);

const MISSING_CONFIDENCE: ReadonlySet<SignalScoreComponentConfidence> = new Set([
  'MISSING',
  'UNKNOWN',
  'DIAGNOSTIC_ONLY',
]);

/* ───────── 입력 schema ───────── */

export function resolveGate1EvaluationStateAdr0510(input: {
  totalCandidates: number;
  traceWithQuoteCount?: number;
  traceWithSymbolFeaturesCount?: number;
  traceWithConditionResultsCount?: number;
  candidateTraceContainerCount?: number;
  conditionResultsContainerCount?: number;
  computedTechnicalTraceCount?: number;
  minSignalScoreTraceAvailableCount?: number;
  buyListLoopEntered?: boolean;
  gateEvaluationOutputAvailableCount?: number;
  sellOnlyMode?: boolean;
  orderBlocked?: boolean;
}): Gate1EvaluationState {
  const total = input.totalCandidates;
  const quote = input.traceWithQuoteCount ?? 0;
  const symbolFeatures = input.traceWithSymbolFeaturesCount ?? 0;
  const conditionResults = input.traceWithConditionResultsCount ?? 0;
  const gateOutputs = input.gateEvaluationOutputAvailableCount ?? conditionResults;
  const minTrace = input.minSignalScoreTraceAvailableCount ?? 0;
  if (total <= 0) return 'UNKNOWN';
  if (input.orderBlocked) return 'NOT_EVALUATED_ORDER_BLOCKED';
  if (input.buyListLoopEntered === false) return 'NOT_EVALUATED_BUYLIST_NOT_REACHED';
  if (conditionResults > 0 || gateOutputs > 0) return 'EVALUATED';
  if (minTrace === 0) return 'NOT_EVALUATED_PRECHECK_ONLY';
  if (quote === 0 && conditionResults === 0 && symbolFeatures > 0) return 'PARTIAL_TRACE_ONLY';
  return 'UNKNOWN';
}

/* ───────── 핵심 SSOT — buildGate1MinimumSignalForensicAuditAdr0505 ───────── */

/**
 * 종목별 forensic audit 생성.
 *
 * 호출자 측 invariant — 본 함수가 throw 하지 않도록 호출자가 try/catch 격리.
 * ENV 우회 활성 시 호출자는 본 함수를 호출하지 *않아야* 한다 (호출자 책임).
 * 본 함수 자체는 항상 동작.
 */
export function buildGate1MinimumSignalForensicAuditAdr0505(
  input: BuildGate1MinimumSignalForensicInput,
): Gate1MinimumSignalForensicAuditAdr0505 {
  const { trace, supplyProviderHealth, kisFlow, quoteSymbol, sectorEnergyImpact } = input;
  const projectedConditionResults = input.conditionResults ?? conditionResultsTraceToMap(input.conditionResultsTrace);
  const candidate = input.candidate && (projectedConditionResults || input.conditionResultsTrace || input.conditionKeys)
    ? {
        ...input.candidate,
        ...(input.conditionResultsTrace ? { conditionResultsTrace: input.conditionResultsTrace } : {}),
        ...(projectedConditionResults ? { conditionResults: projectedConditionResults } : {}),
        ...(input.conditionKeys ? { conditionKeys: input.conditionKeys } : {}),
      } satisfies CandidateEntryTrace
    : input.candidate;

  // 1) 컴포넌트 분류 — positive vs penalty
  const positiveComponents: Record<string, ComponentForensicDetail> = {};
  const penaltyComponents: Record<string, ComponentForensicDetail> = {};
  const missingPositiveSources: MissingPositiveSource[] = [];

  for (const c of trace.components ?? []) {
    const detail: ComponentForensicDetail = {
      weightedScore: c.weightedScore ?? 0,
      maxScore: c.maxScore ?? 0,
      confidence: c.confidence,
      providerIssue: Boolean(c.providerIssue),
      marketSignal: Boolean(c.marketSignal),
      penaltyApplied: Boolean(c.penaltyApplied),
      penaltyReason: c.penaltyReason,
      message: c.message ?? '',
    };

    const isPositive = POSITIVE_COMPONENT_CODES.has(c.code);
    const isExplicitPenalty = PENALTY_COMPONENT_CODES.has(c.code);

    // penaltyApplied=true 또는 weightedScore<0 또는 explicit penalty code → penaltyComponents
    if (isExplicitPenalty || (c.weightedScore ?? 0) < 0 || detail.penaltyApplied) {
      penaltyComponents[c.code] = detail;
    } else if (isPositive) {
      positiveComponents[c.code] = detail;

      // missing positive source 분류 — weightedScore=0 + MISSING/UNKNOWN/DIAGNOSTIC_ONLY confidence
      if ((c.weightedScore ?? 0) === 0 && MISSING_CONFIDENCE.has(c.confidence)) {
        const missingCode = mapToMissingPositiveSource(c.code);
        if (missingCode) missingPositiveSources.push(missingCode);
      }
    }
  }

  // 2) dominantFailureReason 결정 트리
  const dominantFailureReason = computeDominantFailureReason({
    trace,
    missingPositiveSources,
    penaltyComponents,
  });

  // 3) supplyScopeAudit
  const supplyScopeAudit = buildSupplyScopeAudit({
    trace,
    candidate,
    supplyProviderHealth,
    kisFlow,
    actualInvestorFlowRows: input.actualInvestorFlowRows,
    actualInvestorFlowRowCount: input.actualInvestorFlowRowCount,
    actualInvestorFlowRowSourcePath: input.actualInvestorFlowRowSourcePath,
    actualInvestorFlowFieldKeys: input.actualInvestorFlowFieldKeys,
    actualInvestorFlowNumericKeys: input.actualInvestorFlowNumericKeys,
    actualInvestorFlowNumericStringKeys: input.actualInvestorFlowNumericStringKeys,
    actualInvestorFlowCarried: input.actualInvestorFlowCarried,
    selectedCandidate: input.selectedCandidate,
    sellOnlyBySymbolPayloadAvailable: input.sellOnlyBySymbolPayloadAvailable,
    sellOnlyBySymbolPayloadMerged: input.sellOnlyBySymbolPayloadMerged,
    sellOnlyCarryBreakPoint: input.sellOnlyCarryBreakPoint,
    supplySemanticSkipReason: input.supplySemanticSkipReason,
    quoteSymbol,
  });

  // 4) ADR-0509 hydration audit — diagnostic-only, scoring 영향 0
  const hydrationAuditAdr0509 = buildFeatureHydrationAuditAdr0509(candidate, trace);

  const sourcePath = input.sourcePath ?? inferTraceSourcePath(candidate);
  const watchlistBreakPoint = resolveWatchlistBreakPoint(candidate, trace);
  const quoteHydrationBreakPoint = resolveQuoteHydrationBreakPoint(candidate, sourcePath);
  const conditionResultsBreakPoint = resolveConditionResultsBreakPoint(candidate, sourcePath);

  // 5) sectorEnergyAudit
  const sectorEnergyAudit = buildSectorEnergyAudit({ candidate, sectorEnergyImpact });

  // 6) wouldPassIf flags
  const wouldPassIf = computeWouldPassIf({ trace, missingPositiveSources });

  return {
    symbol: trace.symbol,
    name: trace.name,
    scoreSystem: 'MINIMUM_SIGNAL_SCORE_100_SCALE',
    requiredScore: trace.requiredScore,
    actualScore: trace.actualScore,
    scoreGap: trace.scoreGap,
    passed: trace.passed,
    positiveComponents,
    penaltyComponents,
    missingPositiveSources,
    dominantFailureReason,
    supplyScopeAudit,
    hydrationAuditAdr0509,
    sourcePath,
    watchlistBreakPoint,
    quoteHydrationBreakPoint,
    conditionResultsBreakPoint,
    sectorEnergyAudit,
    wouldPassIf,
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    policyPromotionMode: 'SHADOW_ONLY',
  };
}


function inferTraceSourcePath(candidate?: CandidateEntryTrace): Gate1ForensicTraceSourcePath {
  if (!candidate) return 'UNKNOWN';
  if (candidate.gate1Trace) return 'ENTRY_FILTER_GATE1_CANDIDATE_TRACE';
  if (candidate.stageReached === 'UNIVERSE') return 'PREFLIGHT_UNIVERSE_SNAPSHOT';
  if (candidate.stageReached === 'WATCHLIST') return 'WATCHLIST_CANDIDATE';
  return 'ENTRY_FILTER_CANDIDATE_TRACE';
}

function resolveWatchlistBreakPoint(candidate: CandidateEntryTrace | undefined, trace: MinimumSignalScoreTrace): WatchlistBreakPointAdr0510 {
  if (!candidate) return 'SOURCE_FIELD_NONE';
  const record = candidate as unknown as Record<string, unknown>;
  const hasNum = (key: string) => typeof record[key] === 'number' && Number.isFinite(record[key] as number);
  const features = record.symbolFeatures && typeof record.symbolFeatures === 'object' ? record.symbolFeatures as Record<string, unknown> : undefined;
  const traceHasWatchlist = (trace.components ?? []).some((c) => c.code === 'WATCHLIST_UPSTREAM_SCORE' && (c.weightedScore ?? 0) > 0);
  const entry = hasNum('watchlistScore') || hasNum('watchlistUpstreamScore') || typeof features?.watchlistScore === 'number';
  const stage2 = hasNum('stage2Score') || hasNum('totalGateScore') || hasNum('gateScore');
  const promotion = hasNum('priorityScore') || hasNum('qualScore') || hasNum('upstreamCandidateScore') || hasNum('upstreamScore');
  if (traceHasWatchlist) return 'UNKNOWN';
  if (entry) return 'FORENSIC_INPUT_MISSING_SCORE';
  if (promotion) return 'ENTRY_FILTER_TRACE_MISSING_SCORE';
  if (stage2 && !entry && !promotion) return 'PROMOTION_SCORE_NOT_COPIED';
  return 'WATCHLIST_ENTRY_MISSING_SCORE';
}

function resolveQuoteHydrationBreakPoint(candidate: CandidateEntryTrace | undefined, sourcePath: Gate1ForensicTraceSourcePath): QuoteHydrationBreakPointAdr0510 {
  if (sourcePath === 'PREFLIGHT_UNIVERSE_SNAPSHOT') return 'PRECHECK_ONLY_TRACE';
  if (!candidate) return 'QUOTE_NOT_FETCHED';
  if (!candidate.quote) return 'QUOTE_NOT_FETCHED';
  return candidate.symbolFeatures ? 'UNKNOWN' : 'SAFE_QUOTE_FEATURES_NOT_BUILT';
}

function resolveConditionResultsBreakPoint(candidate: CandidateEntryTrace | undefined, sourcePath: Gate1ForensicTraceSourcePath): ConditionResultsBreakPointAdr0510 {
  if (sourcePath === 'PREFLIGHT_UNIVERSE_SNAPSHOT') return 'PRECHECK_ONLY_TRACE';
  const record = candidate as unknown as Record<string, unknown> | undefined;
  const hasResults = Boolean(record?.conditionResults && typeof record.conditionResults === 'object')
    || Boolean(Array.isArray(record?.conditionResultsTrace) && record?.conditionResultsTrace.length > 0);
  if (hasResults) return 'CONDITION_RESULTS_PROJECTED';
  if (candidate?.gate1Trace) return 'CONDITION_RESULTS_SKELETON_ONLY';
  if (!candidate?.gate1Trace) return 'EVALUATE_SERVER_GATE_NOT_CALLED';
  return 'CONDITION_RESULTS_NOT_PROJECTED';
}

export function bump<K extends string>(record: Record<K, number>, key: K): void {
  record[key] = (record[key] ?? 0) + 1;
}

/* ───────── 분류 헬퍼 SSOT ───────── */

function mapToMissingPositiveSource(code: SignalScoreComponentCode): MissingPositiveSource | null {
  switch (code) {
    case 'WATCHLIST_UPSTREAM_SCORE':
      return 'WATCHLIST_UPSTREAM_SCORE_MISSING';
    case 'RELATIVE_STRENGTH':
      return 'RELATIVE_STRENGTH_MISSING';
    case 'BREAKOUT_STRUCTURE':
      return 'BREAKOUT_STRUCTURE_MISSING';
    case 'PRICE_MOMENTUM':
      return 'PRICE_MOMENTUM_MISSING';
    case 'TECHNICAL_TREND':
      return 'TECHNICAL_TREND_MISSING';
    case 'VOLUME_LIQUIDITY':
      return 'VOLUME_LIQUIDITY_MISSING';
    default:
      return null;
  }
}

function computeDominantFailureReason(input: {
  trace: MinimumSignalScoreTrace;
  missingPositiveSources: MissingPositiveSource[];
  penaltyComponents: Record<string, ComponentForensicDetail>;
}): DominantFailureReason {
  const { trace, missingPositiveSources, penaltyComponents } = input;

  if (trace.passed) return 'UNKNOWN'; // 통과 케이스 — 부검 부적합

  const core3Missing =
    missingPositiveSources.includes('WATCHLIST_UPSTREAM_SCORE_MISSING') &&
    missingPositiveSources.includes('RELATIVE_STRENGTH_MISSING') &&
    missingPositiveSources.includes('BREAKOUT_STRUCTURE_MISSING');

  if (core3Missing) return 'POSITIVE_SCORE_STARVATION';

  // 단일 missing 우세
  if (missingPositiveSources.length === 1) {
    const only = missingPositiveSources[0];
    if (only === 'WATCHLIST_UPSTREAM_SCORE_MISSING') return 'WATCHLIST_SCORE_NOT_IMPORTED';
    if (only === 'RELATIVE_STRENGTH_MISSING') return 'RELATIVE_STRENGTH_SOURCE_MISSING';
    if (only === 'BREAKOUT_STRUCTURE_MISSING') return 'BREAKOUT_STRUCTURE_SOURCE_MISSING';
  }

  // penalty 우세
  const supply = penaltyComponents['SUPPLY_CONFLUENCE'];
  if (supply && supply.weightedScore < 0) return 'SUPPLY_PROVIDER_UNKNOWN_PENALTY';

  const investor = penaltyComponents['INVESTOR_FLOW'];
  if (investor && investor.weightedScore < 0) return 'INVESTOR_FLOW_UNKNOWN_PENALTY';

  const sector = penaltyComponents['SECTOR_ENERGY'];
  if (sector && (sector.weightedScore < 0 || sector.penaltyApplied)) {
    return 'SECTOR_ENERGY_DIAGNOSTIC_PENALTY';
  }

  // ceiling 미달
  const totalPossibleCeiling = trace.positiveScoreTotal + trace.penaltyTotal;
  if (totalPossibleCeiling < trace.requiredScore && missingPositiveSources.length === 0) {
    return 'SCORE_CEILING_BELOW_THRESHOLD';
  }

  // 복합
  if (missingPositiveSources.length >= 2 || Object.keys(penaltyComponents).length >= 2) {
    return 'MIXED';
  }

  return 'UNKNOWN';
}

/* ───────── supplyScopeAudit SSOT ───────── */

function buildSectorEnergyAudit(input: {
  candidate?: CandidateEntryTrace;
  sectorEnergyImpact?: SectorEnergyExecutionImpactResult;
}): SectorEnergyForensicAudit {
  const { candidate, sectorEnergyImpact } = input;

  return {
    registeredInEvaluateServerGateRegistry: false,
    layer: 'SECTOR_BOOST_PROMOTION_MINIMUM_SCORE_LAYER',
    leadershipScore: null, // ADR-0399 + ADR-0423 별도 SSOT
    sectorBoost: typeof candidate?.sectorBoost === 'number' ? candidate.sectorBoost : null,
    leadershipConfidence: null,
    sectorBoostAllowed: sectorEnergyImpact?.sectorBoostAllowed ?? null,
    strongBuyAllowed: sectorEnergyImpact?.strongBuyAllowed ?? null,
    diagnosticStatus: sectorEnergyImpact?.diagnosticStatus ?? candidate?.sectorEnergyState ?? null,
    scoringImpact: sectorEnergyImpact?.scoringImpact ?? null,
    executionImpact: sectorEnergyImpact?.executionImpact ?? null,
    directRawGateScoreImpact: 0,
  };
}

/* ───────── wouldPassIf SSOT ───────── */

function computeWouldPassIf(input: {
  trace: MinimumSignalScoreTrace;
  missingPositiveSources: MissingPositiveSource[];
}): WouldPassIfFlags {
  const { trace, missingPositiveSources } = input;

  return {
    unknownNeutral: Boolean(trace.wouldPassIfUnknownNeutral),
    providerPenaltyRemoved: Boolean(trace.wouldPassIfProviderPenaltyRemoved),
    sectorPenaltyRemoved: Boolean(trace.wouldPassIfSectorPenaltyRemoved),
    softFailPenaltyRemoved: Boolean(trace.wouldPassIfSoftFailPenaltyRemoved),
    // 단순 가설 — 점수 gap 이 5 이내였으면 watchlist +5 로 통과
    watchlistImportedPlus5:
      missingPositiveSources.includes('WATCHLIST_UPSTREAM_SCORE_MISSING') && trace.scoreGap >= -5,
    relativeStrengthRestoredPlus7:
      missingPositiveSources.includes('RELATIVE_STRENGTH_MISSING') && trace.scoreGap >= -7,
    breakoutStructureRestoredPlus5:
      missingPositiveSources.includes('BREAKOUT_STRUCTURE_MISSING') && trace.scoreGap >= -5,
    // 모든 missing source 복원 시 통과 가설 — 단순 합산
    allPositiveSourcesRestored:
      missingPositiveSources.length > 0 &&
      missingPositiveSources.length * 5 + trace.actualScore >= trace.requiredScore,
  };
}

/* ───────── 집계 SSOT — buildGate1MinimumSignalForensicSummaryAdr0505 ───────── */
