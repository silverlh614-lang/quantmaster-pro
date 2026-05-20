/**
 * @responsibility ADR-0505 forensic schema surface.
 */

import type {
  MinimumSignalScoreTrace,
  SignalScoreComponentConfidence,
} from '../minimumSignalScoreTrace.js';
import type {
  CandidateEntryTrace,
  SupplyConfluenceState,
  SupplyProviderHealthTrace,
} from '../entryFilterDecomposition.js';
import type { SectorEnergyExecutionImpactResult } from '../../../clients/sectorEnergyExecutionImpact.js';
import type { GateConditionResultTrace } from '../gateConditionResultTrace.js';
import type { InvestorRowMaterializationClass } from '../investorFlowProviderRouterAdr0477.js';
import type {
  InvestorFlowFieldKeyDiscoveryDiagnostic,
  InvestorFlowSemanticAvailabilityReason,
  SanitizedInvestorFlowSemanticRow,
} from '../../../supply/investorFlowSemanticAvailability.js';

export type MissingPositiveSource =
  | 'WATCHLIST_UPSTREAM_SCORE_MISSING'
  | 'RELATIVE_STRENGTH_MISSING'
  | 'BREAKOUT_STRUCTURE_MISSING'
  | 'PRICE_MOMENTUM_MISSING'
  | 'TECHNICAL_TREND_MISSING'
  | 'VOLUME_LIQUIDITY_MISSING';

export type DominantFailureReason =
  | 'POSITIVE_SCORE_STARVATION'
  | 'WATCHLIST_SCORE_NOT_IMPORTED'
  | 'RELATIVE_STRENGTH_SOURCE_MISSING'
  | 'BREAKOUT_STRUCTURE_SOURCE_MISSING'
  | 'SUPPLY_PROVIDER_UNKNOWN_PENALTY'
  | 'INVESTOR_FLOW_UNKNOWN_PENALTY'
  | 'SECTOR_ENERGY_DIAGNOSTIC_PENALTY'
  | 'SCORE_CEILING_BELOW_THRESHOLD'
  | 'MIXED'
  | 'UNKNOWN';

export type SupplyScopeWarning =
  | 'NONE'
  | 'KIS_FLOW_SYMBOL_MISMATCH'
  | 'KIS_FLOW_SYMBOL_MISSING'
  | 'KIS_FLOW_SEMANTIC_UNAVAILABLE'
  | 'POSSIBLE_MARKET_WIDE_FLOW_IN_SYMBOL_SLOT';

export interface ComponentForensicDetail {
  weightedScore: number;
  maxScore: number;
  confidence: SignalScoreComponentConfidence;
  providerIssue: boolean;
  marketSignal: boolean;
  penaltyApplied: boolean;
  penaltyReason?: string;
  message: string;
}

export interface SupplyScopeAudit {
  /** 사용자 명시 핵심 불변식 — 절대 변경 금지. */
  expectedScope: 'SYMBOL_LEVEL_INVESTOR_FLOW';
  /** CandidateEntryTrace.symbol — symbol-level supply 검증의 기준 축. */
  candidateSymbol?: string | null;
  /** quote.symbol — quote payload 가 종목 단위인지 확인하는 보조 축. */
  quoteSymbol?: string | null;
  requestSymbol?: string | null;
  providerSymbol?: string | null;
  normalizedSymbol?: string | null;
  providerScope?: 'SYMBOL_LEVEL' | 'MARKET_LEVEL' | 'SECTOR_LEVEL' | 'UNKNOWN';
  routePurpose?: string | null;
  selectedProvider?: string | null;
  materialized?: boolean;
  usableForRouter?: boolean;
  usableForGate?: false;
  usableForLive?: false;
  usableForShadow?: true;
  kisFlowSymbol?: string | null;
  /** candidate/quote/kisFlow/request symbol 이 확인될 때만 true. */
  symbolMatched: boolean | null;
  inferredSymbolMatched?: boolean;
  foreignNetBuy: number | null;
  institutionalNetBuy: number | null;
  programNetBuy?: number | null;
  individualNetBuy?: number | null;
  semanticAvailable: boolean;
  semanticDiagnosticAvailable?: boolean;
  semanticRowAvailable?: boolean;
  semanticRowMetadataOnly?: boolean;
  rawInvestorRowAvailable?: boolean;
  /**
   * ADR-0477 supply actual row carry diagnostic — adapter (KIS) row 가 router 까지 carry 됐고
   * selectedProvider != 'KIS_API' 인 경우. 사용자 명시 #6 단절 진단 — adapter 보유 vs router
   * carry 정합성 가시화. true 시 selectedProvider (KRX/NAVER/CACHE 등) 의 CORE 결정과 무관하게
   * KIS adapter row 가 diagnostic / SHADOW_SCORE 전용으로 propagate 된 상태.
   */
  adapterRowsForwardedAcrossProviders?: boolean;
  /**
   * INVESTOR-FLOW-ACTUAL-ROW-CARRY-WIRING-001 — adapter actual row 가 forensic 단계까지
   * carry 됐는지 (selectedProvider 무관). DIAGNOSTIC_ONLY scope — executionImpact='NONE'.
   */
  diagnosticActualInvestorRowCarried?: boolean;
  actualInvestorRowProvider?: 'KIS_API' | 'NAVER_INVESTOR_TREND' | 'UNKNOWN' | null;
  actualInvestorRowUseScope?: 'SELECTED_PROVIDER' | 'DIAGNOSTIC_ONLY' | 'SHADOW_SCORE';
  investorRowMaterializationClass?: InvestorRowMaterializationClass;
  diagnosticActualInvestorRowFromNormalized?: boolean;
  selectedCandidateCarriesSemanticRow?: boolean;
  forensicInputCarriesSemanticRow?: boolean;
  forensicInputCarriesActualInvestorRows?: boolean;
  sellOnlyBySymbolPayloadAvailable?: boolean;
  sellOnlyBySymbolPayloadMerged?: boolean;
  sellOnlyCarryBreakPoint?: SellOnlyCarryBreakPointAdr0507;
  supplySemanticSkipReason?: 'DIAGNOSTIC_SKIPPED_PSEUDO_SYMBOL';
  selectedActualRowPath?: string | null;
  selectedActualRowFieldKeys?: string[];
  selectedActualNumericFieldKeys?: string[];
  selectedActualNumericStringFieldKeys?: string[];
  selectedActualPlaceholderFieldKeys?: string[];
  semanticRowBreakPoint?: string;
  semanticReason?: InvestorFlowSemanticAvailabilityReason;
  materializedCount?: number;
  normalizedCount?: number;
  sourceFields?: Record<string, string>;
  rowCount?: number;
  investorTypesDetected?: string[];
  foreignRowFound?: boolean;
  institutionalRowFound?: boolean;
  individualRowFound?: boolean;
  rowMappingConfidence?: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';
  fieldKeyDiagnostics?: InvestorFlowFieldKeyDiscoveryDiagnostic;
  providerIssue?: boolean;
  marketSignal?: false;
  wouldBeNeutralIfZeroButMaterialized?: boolean;
  wouldBeEligibleIfForeignOrInstitutionFieldMapped?: boolean;
  wouldBeSemanticAvailableIfFieldMapped?: boolean;
  wouldBeZeroNeutralIfAllZero?: boolean;
  /** symbol 확인 실패 수급은 SHADOW_ONLY diagnostic 으로만 표기한다. */
  scoreUsage?: 'ELIGIBLE_AFTER_SEMANTIC_MATCH' | 'SHADOW_ONLY' | 'DIAGNOSTIC_ONLY';
  executionImpact?: 'NONE';
  warning: SupplyScopeWarning;
}

export type HydrationMissingReason =
  | 'CANDIDATE_TRACE_MISSING'
  | 'FIELD_MISSING'
  | 'QUOTE_MISSING'
  | 'SYMBOL_FEATURES_MISSING'
  | 'CONDITION_RESULTS_MISSING';

export type RsHydrationSourceAdr0509 =
  | 'QUOTE_RETURN'
  | 'SYMBOL_FEATURES'
  | 'CONDITION_RESULTS'
  | 'EXPLICIT_RELATIVE_RETURN'
  | 'WATCHLIST_PROXY'
  | 'MISSING';

export type BreakoutHydrationSourceAdr0509 =
  | 'QUOTE_OHLCV'
  | 'SYMBOL_FEATURES'
  | 'CONDITION_RESULTS'
  | 'CONDITION_KEYS'
  | 'WATCHLIST_REASON_PROXY'
  | 'MISSING';

export type Gate1EvaluationState =
  | 'EVALUATED'
  | 'NOT_EVALUATED_SELL_ONLY'
  | 'NOT_EVALUATED_ORDER_BLOCKED'
  | 'NOT_EVALUATED_BUYLIST_NOT_REACHED'
  | 'NOT_EVALUATED_PRECHECK_ONLY'
  | 'PARTIAL_TRACE_ONLY'
  | 'UNKNOWN';

export type SellOnlyCarryBreakPointAdr0507 =
  | 'BYSYMBOL_PAYLOAD_MISSING'
  | 'BYSYMBOL_PAYLOAD_STALE'
  | 'BYSYMBOL_PAYLOAD_FOUND_NOT_MERGED'
  | 'BYSYMBOL_PAYLOAD_MERGED_BUT_FORENSIC_DROPPED'
  | 'MERGED_BUT_FORENSIC_DROPPED'
  | 'PSEUDO_SYMBOL_NOT_RESOLVED'
  | 'CARRIED_TO_FORENSIC'
  | 'UNKNOWN';

export type Gate1ForensicTraceSourcePath =
  | 'ENTRY_FILTER_GATE1_CANDIDATE_TRACE'
  | 'ENTRY_FILTER_CANDIDATE_TRACE'
  | 'WATCHLIST_CANDIDATE'
  | 'PREFLIGHT_UNIVERSE_SNAPSHOT'
  | 'SELL_ONLY_DIAGNOSTIC_SNAPSHOT'
  | 'UNKNOWN';

export type WatchlistBreakPointAdr0510 =
  | 'WATCHLIST_ENTRY_MISSING_SCORE'
  | 'STAGE2_SCORE_NOT_COPIED'
  | 'PROMOTION_SCORE_NOT_COPIED'
  | 'ENTRY_FILTER_TRACE_MISSING_SCORE'
  | 'FORENSIC_INPUT_MISSING_SCORE'
  | 'SOURCE_FIELD_NONE'
  | 'UNKNOWN';

export type QuoteHydrationBreakPointAdr0510 =
  | 'QUOTE_NOT_FETCHED'
  | 'QUOTE_FETCHED_NOT_COPIED'
  | 'SAFE_QUOTE_FEATURES_NOT_BUILT'
  | 'SELL_ONLY_SKIPPED_QUOTE_EVALUATION'
  | 'PRECHECK_ONLY_TRACE'
  | 'UNKNOWN';

export type ConditionResultsBreakPointAdr0510 =
  | 'NONE'
  | 'CONDITION_RESULTS_PROJECTED'
  | 'EVALUATE_SERVER_GATE_NOT_CALLED'
  | 'GATE_OUTPUTS_NOT_COPIED'
  | 'CONDITION_RESULTS_NOT_PROJECTED'
  | 'SELL_ONLY_SKIPPED_GATE_EVALUATION'
  | 'PRECHECK_ONLY_TRACE'
  | 'UNKNOWN';

export interface WatchlistHydrationAuditAdr0509 {
  sourceAvailable: boolean;
  sourceField: string | null;
  scoreImported: boolean;
  rawScore?: number | null;
  normalizedWatchlistScore?: number | null;
  scoreScale?: string | null;
  stage2Score?: number | null;
  watchlistScore?: number | null;
  upstreamCandidateScore?: number | null;
  watchlistRank?: number | null;
  totalCandidates?: number | null;
  watchlistReason?: string[];
  watchlistSourceField?: string | null;
  missingReason?: string;
}

export interface FeatureHydrationAuditAdr0509 {
  rsAvailable: boolean;
  breakoutAvailable: boolean;
  rsScoreUsable: boolean;
  breakoutScoreUsable: boolean;
  rsSource: RsHydrationSourceAdr0509;
  breakoutSource: BreakoutHydrationSourceAdr0509;
  rsMissingReasons: HydrationMissingReason[];
  breakoutMissingReasons: HydrationMissingReason[];
  rsMissingFields: string[];
  breakoutMissingFields: string[];
  missingFields: string[];
  candidateTraceHasQuote: boolean;
  candidateTraceHasSymbolFeatures: boolean;
  candidateTraceHasConditionResults: boolean;
  candidateTraceHasWatchlistScore: boolean;
  candidateTraceHasSupplyContext: boolean;
  candidateTraceHasMinSignalScoreTrace: boolean;
  watchlist: WatchlistHydrationAuditAdr0509;
  conditionKeyStatus?: Record<string, 'FIRED' | 'DATA_UNAVAILABLE' | 'THRESHOLD_NOT_MET' | 'PROVIDER_DEGRADED' | 'ERROR'>;
  breakoutConditionKeys?: string[];
}

export interface SectorEnergyForensicAudit {
  /** 사용자 명시 — defaultRegistry evaluator 에 sector_energy 직접 등록 없음. */
  registeredInEvaluateServerGateRegistry: false;
  /** 사용자 명시 — sectorBoost / promotion / minimumScore / STRONG_BUY gating layer. */
  layer: 'SECTOR_BOOST_PROMOTION_MINIMUM_SCORE_LAYER';
  leadershipScore?: number | null;
  sectorBoost?: number | null;
  leadershipConfidence?: string | null;
  sectorBoostAllowed?: boolean | null;
  strongBuyAllowed?: boolean | null;
  diagnosticStatus?: string | null;
  scoringImpact?: string | null;
  executionImpact?: string | null;
  /** 사용자 명시 — SectorEnergy 가 raw gate score 직접 영향 절대 금지 (literal type). */
  directRawGateScoreImpact: 0;
}

export interface WouldPassIfFlags {
  unknownNeutral: boolean;
  providerPenaltyRemoved: boolean;
  sectorPenaltyRemoved: boolean;
  softFailPenaltyRemoved: boolean;
  watchlistImportedPlus5: boolean;
  relativeStrengthRestoredPlus7: boolean;
  breakoutStructureRestoredPlus5: boolean;
  allPositiveSourcesRestored: boolean;
}

/** ADR-0505 종목별 forensic audit 결과. */
export interface Gate1MinimumSignalForensicAuditAdr0505 {
  symbol: string;
  name?: string;

  /** 100-scale minimum signal score 체계. raw evaluateServerGate score 와 분리. */
  scoreSystem: 'MINIMUM_SIGNAL_SCORE_100_SCALE';
  requiredScore: number;
  actualScore: number;
  scoreGap: number;
  passed: boolean;

  positiveComponents: Record<string, ComponentForensicDetail>;
  penaltyComponents: Record<string, ComponentForensicDetail>;

  missingPositiveSources: MissingPositiveSource[];
  dominantFailureReason: DominantFailureReason;

  supplyScopeAudit: SupplyScopeAudit;
  hydrationAuditAdr0509?: FeatureHydrationAuditAdr0509;
  sourcePath?: Gate1ForensicTraceSourcePath;
  watchlistBreakPoint?: WatchlistBreakPointAdr0510;
  quoteHydrationBreakPoint?: QuoteHydrationBreakPointAdr0510;
  conditionResultsBreakPoint?: ConditionResultsBreakPointAdr0510;
  sectorEnergyAudit: SectorEnergyForensicAudit;

  wouldPassIf: WouldPassIfFlags;

  /** literal 강제 — TypeScript 컴파일 타임 invariant. */
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  policyPromotionMode: 'SHADOW_ONLY';
}

/** ScanSummary 집계 — 종목별 audit 의 분포. */
export interface Gate1MinimumSignalForensicSummaryAdr0505 {
  totalCandidates: number;
  failedCandidates: number;
  evaluationState?: Gate1EvaluationState;
  evaluatedCandidateCount?: number;
  traceOnlyCandidateCount?: number;
  buyListLoopEntered?: boolean;
  perSymbolEvaluationEntered?: boolean;
  gateEvaluationOutputAvailableCount?: number;
  minSignalScoreTraceAvailableCount?: number;
  requiredScoreAvg: number;
  actualScoreAvg: number;
  avgScoreGap: number;

  dominantFailureDistribution: Record<DominantFailureReason, number>;

  missingPositiveSourceCounts: {
    watchlistUpstreamMissing: number;
    relativeStrengthMissing: number;
    breakoutStructureMissing: number;
    priceMomentumMissing: number;
    technicalTrendMissing: number;
    volumeLiquidityMissing: number;
  };

  penaltyCounts: {
    supplyUnknownPenalty: number;
    investorFlowUnknownPenalty: number;
    sectorEnergyPenaltyOrBlocked: number;
    unknownDataPenalty: number;
    softFailPenalty: number;
    riskPenalty: number;
  };

  supplyScopeWarnings: Record<SupplyScopeWarning, number>;
  supplySymbolMatchedCount?: number;
  rsHydrationAvailableCount?: number;
  breakoutHydrationAvailableCount?: number;
  rsMissingReasonDistribution?: Record<HydrationMissingReason, number>;
  breakoutMissingReasonDistribution?: Record<HydrationMissingReason, number>;
  topHydrationMissingFields?: string[];
  candidateTraceHasQuote?: number;
  candidateTraceHasSymbolFeatures?: number;
  candidateTraceHasConditionResults?: number;
  watchlistSourceAvailableCount?: number;
  watchlistSourceFieldDistribution?: Record<string, number>;
  watchlistScoreImportedCount?: number;
  watchlistMissingReasonTop?: string[];
  watchlistScoreScaleDistribution?: Record<string, number>;
  watchlistScoreAvg?: number;
  watchlistDiagnosticConflict?: boolean;
  adr0467WatchlistVerifiedCount?: number;
  adr0505WatchlistImportedCount?: number;
  conflictReason?: 'DIFFERENT_SOURCE_PATH' | 'FALLBACK_PROXY_NOT_IMPORTED' | 'TRACE_FIELD_MISSING' | 'UNKNOWN';
  quoteFeatureAvailableCount?: number;
  quoteMissingReasonTop?: string[];
  quoteFeatureFieldCoverage?: Record<string, number>;
  conditionResultsAvailableCount?: number;
  conditionResultsKeyCoverage?: Record<string, number>;
  conditionResultStatusDistribution?: Record<string, number>;
  breakoutConditionKeyCoverage?: Record<string, number>;
  breakoutConditionStatusDistribution?: Record<string, number>;
  rsTraceAvailableCount?: number;
  rsScoreUsableCount?: number;
  rsMissingFieldsTop?: string[];
  rsSourceDistribution?: Record<RsHydrationSourceAdr0509, number>;
  rsConditionStatusDistribution?: Record<string, number>;
  breakoutTraceAvailableCount?: number;
  breakoutScoreUsableCount?: number;
  breakoutMissingFieldsTop?: string[];
  breakoutSourceDistribution?: Record<BreakoutHydrationSourceAdr0509, number>;
  candidateSymbolAvailableCount?: number;
  quoteSymbolAvailableCount?: number;
  requestSymbolAvailableCount?: number;
  providerSymbolAvailableCount?: number;
  symbolMatchedCount?: number;
  inferredSymbolMatchedCount?: number;
  symbolMissingCount?: number;
  symbolMismatchCount?: number;
  providerScopeDistribution?: Record<string, number>;
  scoreUsage?: 'SHADOW_ONLY';
  supplySemanticAvailable?: number;
  supplyDiagnosticAvailable?: number;
  semanticReasonDistribution?: Record<InvestorFlowSemanticAvailabilityReason, number>;
  foreignNetBuyAvailable?: number;
  institutionalNetBuyAvailable?: number;
  zeroButMaterializedCount?: number;
  kisRawFieldKeysTop?: Record<string, number>;
  actualRawFieldKeysTop?: Record<string, number>;
  actualNumericStringFieldKeysTop?: Record<string, number>;
  actualNumberFieldKeysTop?: Record<string, number>;
  actualPlaceholderFieldKeysTop?: Record<string, number>;
  candidateNetBuyFieldKeysTop?: Record<string, number>;
  selectedActualRawFieldKeysTop?: Record<string, number>;
  selectedNumericStringFieldKeysTop?: Record<string, number>;
  rejectedWrapperPathsTop?: Record<string, number>;
  rowCandidateCount?: number;
  selectedRowScoreAvg?: number;
  wrapperOnlyCount?: number;
  numericCandidateCount?: number;
  aliasCandidateCount?: number;
  selectedPathTop?: Record<string, number>;
  kisNormalizedFieldKeysTop?: Record<string, number>;
  sampleValueKindDistribution?: Record<string, number>;
  semanticRowAvailableCount?: number;
  semanticRowMetadataOnlyCount?: number;
  rawInvestorRowAvailableCount?: number;
  selectedCandidateCarriesSemanticRowCount?: number;
  selectedCandidateCarriesActualRowCount?: number;
  /**
   * ADR-0477 supply actual row carry diagnostic — adapter (KIS) 가 row 보유 시 router 가
   * selectedProvider 무관 carry 한 candidate 수. 사용자 명시 #6: adapter=N/47 vs router=0/47
   * 단절을 가시화 + 정합성 진단.
   */
  adapterRowsForwardedAcrossProvidersCount?: number;
  /**
   * INVESTOR-FLOW-ACTUAL-ROW-CARRY-WIRING-001 — diagnostic actual numeric row 가 forensic
   * 단계까지 carry + 숫자 필드 검증 통과한 candidate 수 (selectedProvider 무관). 사용자 보고
   * adapterCarriesActualRow=46/46 vs forensicCarriesActualRow=0/46 단절 가시화.
   */
  diagnosticActualInvestorRowCarriedCount?: number;
  selectedProviderActualRowCount?: number;
  diagnosticOnlyActualRowCount?: number;
  actualInvestorRowProviderDistribution?: Record<string, number>;
  actualInvestorRowUseScopeDistribution?: Record<string, number>;
  kisNormalizedRowsMaterialized?: number;
  kisSemanticRowsMaterialized?: number;
  normalizedRowsPromotedToDiagnosticActualRow?: number;
  normalizedMetadataOnlyRows?: number;
  semanticMetadataOnlyRows?: number;
  bySymbolDiagnosticActualRowFromNormalized?: number;
  sellOnlyBySymbolPayloadFromNormalized?: number;
  semanticFromNormalizedActualRow?: number;
  investorRowMaterializationClassDistribution?: Record<string, number>;
  forensicInputCarriesSemanticRowCount?: number;
  semanticRowBreakPointDistribution?: Record<string, number>;
  forensicInputCarriesActualInvestorRowsCount?: number;
  actualInvestorRowPathDistribution?: Record<string, number>;
  actualInvestorRowFieldKeysTop?: Record<string, number>;
  actualInvestorNumericStringKeysTop?: Record<string, number>;
  actualInvestorNumberKeysTop?: Record<string, number>;
  kisSemanticFieldKeysTop?: Record<string, number>;
  mappedFieldDistribution?: {
    foreign: Record<string, number>;
    institution: Record<string, number>;
    individual: Record<string, number>;
  };
  scoreUsageDistribution?: Record<string, number>;
  supplyUnknownRootCauseDistribution?: Record<string, number>;
  supplyRouterForensicConflict?: boolean;
  routerStatus?: string;
  routerSignal?: string;
  forensicSemanticAvailable?: string;
  routerForensicConflictReason?: string;
  shadowEligibleSupplyCount?: number;
  candidateTraceCount?: number;
  traceWithQuoteCount?: number;
  traceWithSymbolFeaturesCount?: number;
  traceWithConditionResultsCount?: number;
  traceWithWatchlistScoreCount?: number;
  traceWithSupplyContextCount?: number;
  traceWithMinSignalScoreTraceCount?: number;
  traceDominantFailureReason?: 'TRACE_HYDRATION_MISSING';
  sourcePathDistribution?: Record<Gate1ForensicTraceSourcePath, number>;
  sourcePathTopMissingFields?: Record<string, string[]>;
  sourcePathWithWatchlistScore?: Record<Gate1ForensicTraceSourcePath, number>;
  sourcePathWithQuote?: Record<Gate1ForensicTraceSourcePath, number>;
  sourcePathWithConditionResults?: Record<Gate1ForensicTraceSourcePath, number>;
  watchlistBreakPointDistribution?: Record<WatchlistBreakPointAdr0510, number>;
  watchlistEntryScoreAvailable?: number;
  stage2ScoreAvailable?: number;
  promotionScoreAvailable?: number;
  entryFilterTraceScoreAvailable?: number;
  forensicInputScoreAvailable?: number;
  quoteHydrationBreakPointDistribution?: Record<QuoteHydrationBreakPointAdr0510, number>;
  conditionResultsBreakPointDistribution?: Record<ConditionResultsBreakPointAdr0510, number>;
  sectorEnergyStrongBuyBlockedCount: number;
  sectorEnergyHardBlockCount: number;
  sellOnlyBySymbolPayloadAvailableCount?: number;
  sellOnlyBySymbolPayloadMergedCount?: number;
  sellOnlyActualRowsCarriedCount?: number;
  sellOnlyCarryBreakPointDistribution?: Record<SellOnlyCarryBreakPointAdr0507, number>;

  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  policyPromotionMode: 'SHADOW_ONLY';
}

/* ───────── 컴포넌트 분류 정책 SSOT (사용자 명시 절대 변경 금지) ───────── */

export interface BuildGate1MinimumSignalForensicInput {
  trace: MinimumSignalScoreTrace;
  candidate?: CandidateEntryTrace;
  conditionResultsTrace?: GateConditionResultTrace[];
  conditionResults?: Record<string, unknown>;
  conditionKeys?: string[];
  supplyProviderHealth?: Partial<SupplyProviderHealthTrace>;
  supplyConfluence?: SupplyConfluenceState;
  actualInvestorFlowRows?: Array<Record<string, unknown>>;
  actualInvestorFlowRowCount?: number;
  actualInvestorFlowRowSourcePath?: string | null;
  actualInvestorFlowFieldKeys?: string[];
  actualInvestorFlowNumericKeys?: string[];
  actualInvestorFlowNumericStringKeys?: string[];
  actualInvestorFlowCarried?: boolean;
  actualInvestorRow?: Record<string, unknown> | null;
  diagnosticActualInvestorRow?: Record<string, unknown> | null;
  normalizedInvestorRow?: Record<string, unknown> | null;
  semanticInvestorRow?: SanitizedInvestorFlowSemanticRow | Record<string, unknown> | null;
  supplySemanticRow?: SanitizedInvestorFlowSemanticRow | Record<string, unknown> | null;
  selectedCandidate?: {
    actualInvestorFlowRows?: Array<Record<string, unknown>>;
    actualInvestorFlowRowCount?: number;
    actualInvestorFlowRowSourcePath?: string | null;
    actualInvestorFlowFieldKeys?: string[];
    actualInvestorFlowNumericKeys?: string[];
    actualInvestorFlowNumericStringKeys?: string[];
    actualInvestorFlowCarried?: boolean;
    actualInvestorRow?: Record<string, unknown> | null;
    diagnosticActualInvestorRow?: Record<string, unknown> | null;
    normalizedInvestorRow?: Record<string, unknown> | null;
    semanticInvestorRow?: SanitizedInvestorFlowSemanticRow | Record<string, unknown> | null;
    supplySemanticRow?: SanitizedInvestorFlowSemanticRow | Record<string, unknown> | null;
    [key: string]: unknown;
  } | null;
  kisFlow?: {
    symbol?: string | null;
    requestSymbol?: string | null;
    candidateSymbol?: string | null;
    quoteSymbol?: string | null;
    providerSymbol?: string | null;
    normalizedSymbol?: string | null;
    providerScope?: 'SYMBOL_LEVEL' | 'MARKET_LEVEL' | 'SECTOR_LEVEL' | 'UNKNOWN';
    routePurpose?: string;
    selectedProvider?: string;
    materialized?: boolean;
    usableForRouter?: boolean;
    usableForGate?: false;
    usableForLive?: false;
    usableForShadow?: true;
    foreignNetBuy?: number | null;
    institutionalNetBuy?: number | null;
    programNetBuy?: number | null;
    individualNetBuy?: number | null;
    semanticRow?: SanitizedInvestorFlowSemanticRow | null;
    investorFlowSemanticRow?: SanitizedInvestorFlowSemanticRow | null;
    actualInvestorRow?: Record<string, unknown> | null;
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
    /**
     * ADR-0477 supply actual row carry diagnostic — KIS adapter 가 actual row 보유했지만
     * selectedProvider 가 KIS_API 가 아닌 경우 router 가 진단용으로 carry 했음을 표시.
     * 사용자 명시 #6 단절 진단 (adapterCarriesActualRow=47/47 vs routerCarriesActualRow=0/47).
     * CORE 결정 무영향 — diagnostic / SHADOW_SCORE 전용.
     */
    adapterRowsForwardedAcrossProviders?: boolean;
    /**
     * INVESTOR-FLOW-ACTUAL-ROW-CARRY-WIRING-001 — adapter actual row 를 selectedProvider
     * 와 무관하게 carry (selectedProvider==='NONE' 포함). DIAGNOSTIC_ONLY scope.
     */
    diagnosticActualInvestorRow?: Record<string, unknown> | null;
    selectedProviderActualInvestorRow?: Record<string, unknown> | null;
    actualInvestorRowProvider?: 'KIS_API' | 'NAVER_INVESTOR_TREND' | 'UNKNOWN' | null;
    actualInvestorRowUseScope?: 'SELECTED_PROVIDER' | 'DIAGNOSTIC_ONLY' | 'SHADOW_SCORE';
    bySymbol?: Record<string, Record<string, unknown>>;
    kisRawRowAvailableAtAdapter?: boolean;
    kisNormalizedRowAvailableAtRouter?: boolean;
    kisSelectedCandidateCarriesSemanticRow?: boolean;
    forensicInputCarriesSemanticRow?: boolean;
    forensicInputCarriesActualInvestorRows?: boolean;
    selectedActualRowPath?: string | null;
    selectedActualRowFieldKeys?: string[];
    selectedActualNumericFieldKeys?: string[];
    selectedActualNumericStringFieldKeys?: string[];
    selectedActualPlaceholderFieldKeys?: string[];
    semanticRowBreakPoint?: string;
    semanticAvailable?: boolean;
    stale?: boolean;
    [key: string]: unknown;
  };
  quoteSymbol?: string | null;
  sectorEnergyImpact?: SectorEnergyExecutionImpactResult;
  sourcePath?: Gate1ForensicTraceSourcePath;
  sellOnlyBySymbolPayloadAvailable?: boolean;
  sellOnlyBySymbolPayloadMerged?: boolean;
  sellOnlyCarryBreakPoint?: SellOnlyCarryBreakPointAdr0507;
  supplySemanticSkipReason?: 'DIAGNOSTIC_SKIPPED_PSEUDO_SYMBOL';
}
