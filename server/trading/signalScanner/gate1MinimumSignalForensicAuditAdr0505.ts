/**
 * @responsibility ADR-0505 Gate1 Minimum Signal Forensic Audit SSOT — diagnostic-only.
 *
 * 사용자 명시 ADR-0502 → 실제 발급 ADR-0505 (INDEX SSOT 정합).
 * 충돌 그룹 0502a/b/c 이미 머지 완료 상태로 의미상 후속 ADR 신규 발급.
 *
 * 본 모듈은 ADR-0466 `buildMinimumSignalScoreTrace()` 결과를 *부검*한다.
 * 점수 기준 완화 / requiredScore 변경 / Gate1 survivor 강제 생성 / 실거래
 * 판단 / 주문 / KIS order path 모두 *영구 금지*. executionImpact: 'NONE'
 * literal type 강제 (TypeScript 컴파일 타임).
 *
 * 책임 분리 (ADR-0148 §"단일 책임"):
 *   - 본 SSOT — 부검 결과 분해 + 종목별 detail + 집계 (compute only, 영속 X)
 *   - 호출자 측 — `persistScanResults` 안 try/catch 격리 wiring (ADR-0500 패턴)
 *   - 별도 영속 — `appendGate1MinimumSignalForensicTrace()` (FIFO 200 + 7일 TTL)
 *
 * 외부 의존성 0건 (KIS / KRX / Yahoo / Naver outbound) — read-only consumer.
 */

import type {
  MinimumSignalScoreTrace,
  SignalScoreComponentTrace,
  SignalScoreComponentCode,
  SignalScoreComponentConfidence,
} from './minimumSignalScoreTrace.js';
import type {
  CandidateEntryTrace,
  SupplyConfluenceState,
  SupplyProviderHealthTrace,
} from './entryFilterDecomposition.js';
import type { SectorEnergyExecutionImpactResult } from '../../clients/sectorEnergyExecutionImpact.js';
import { resolveWatchlistUpstreamScore } from './watchlistUpstreamScoreResolver.js';
import { conditionResultsTraceToMap, type GateConditionResultTrace } from './gateConditionResultTrace.js';
import {
  evaluateInvestorFlowSemanticAvailabilityV2,
  type InvestorFlowSemanticAvailabilityReason,
  type InvestorFlowSemanticAvailabilityResult,
  type InvestorFlowFieldKeyDiscoveryDiagnostic,
  type SanitizedInvestorFlowSemanticRow,
} from '../../supply/investorFlowSemanticAvailability.js';

/* ───────── ENV 우회 SSOT (ADR-0157 정확 비교) ───────── */

/**
 * ENV `GATE1_MINIMUM_SIGNAL_FORENSIC_ADR_0505_DISABLED=true` (default OFF).
 *
 * ADR-0157 정확 비교 의무 — `'1'` / `'TRUE'` / `'yes'` 모두 거부.
 * `=== 'true'` 만 활성으로 인정.
 *
 * 활성 시 forensic audit builder 가 `undefined` 를 반환해 호출자 측 ScanSummary
 * 영속 자체 skip → ADR-0500 동작 100% 보존.
 */
export function isGate1MinimumSignalForensicAuditDisabled(): boolean {
  return process.env.GATE1_MINIMUM_SIGNAL_FORENSIC_ADR_0505_DISABLED === 'true';
}

/* ───────── Schema SSOT (사용자 명시 직접 반영, literal types 강제) ───────── */

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
  selectedCandidateCarriesSemanticRow?: boolean;
  forensicInputCarriesSemanticRow?: boolean;
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
  forensicInputCarriesSemanticRowCount?: number;
  semanticRowBreakPointDistribution?: Record<string, number>;
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

  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  policyPromotionMode: 'SHADOW_ONLY';
}

/* ───────── 컴포넌트 분류 정책 SSOT (사용자 명시 절대 변경 금지) ───────── */

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

export interface BuildGate1MinimumSignalForensicInput {
  trace: MinimumSignalScoreTrace;
  candidate?: CandidateEntryTrace;
  conditionResultsTrace?: GateConditionResultTrace[];
  conditionResults?: Record<string, unknown>;
  conditionKeys?: string[];
  supplyProviderHealth?: Partial<SupplyProviderHealthTrace>;
  supplyConfluence?: SupplyConfluenceState;
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
    kisRawRowAvailableAtAdapter?: boolean;
    kisNormalizedRowAvailableAtRouter?: boolean;
    kisSelectedCandidateCarriesSemanticRow?: boolean;
    forensicInputCarriesSemanticRow?: boolean;
    semanticRowBreakPoint?: string;
    semanticAvailable?: boolean;
    stale?: boolean;
    [key: string]: unknown;
  };
  quoteSymbol?: string | null;
  sectorEnergyImpact?: SectorEnergyExecutionImpactResult;
  sourcePath?: Gate1ForensicTraceSourcePath;
}

export function resolveGate1EvaluationStateAdr0510(input: {
  totalCandidates: number;
  traceWithQuoteCount?: number;
  traceWithSymbolFeaturesCount?: number;
  traceWithConditionResultsCount?: number;
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
  if (input.sellOnlyMode) return 'NOT_EVALUATED_SELL_ONLY';
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
  if (candidate.marketSession === 'SELL_ONLY') return 'SELL_ONLY_DIAGNOSTIC_SNAPSHOT';
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
  if (stage2) return 'PROMOTION_SCORE_NOT_COPIED';
  return 'WATCHLIST_ENTRY_MISSING_SCORE';
}

function resolveQuoteHydrationBreakPoint(candidate: CandidateEntryTrace | undefined, sourcePath: Gate1ForensicTraceSourcePath): QuoteHydrationBreakPointAdr0510 {
  if (sourcePath === 'SELL_ONLY_DIAGNOSTIC_SNAPSHOT') return 'SELL_ONLY_SKIPPED_QUOTE_EVALUATION';
  if (sourcePath === 'PREFLIGHT_UNIVERSE_SNAPSHOT') return 'PRECHECK_ONLY_TRACE';
  if (!candidate) return 'QUOTE_NOT_FETCHED';
  if (!candidate.quote) return 'QUOTE_NOT_FETCHED';
  return candidate.symbolFeatures ? 'UNKNOWN' : 'SAFE_QUOTE_FEATURES_NOT_BUILT';
}

function resolveConditionResultsBreakPoint(candidate: CandidateEntryTrace | undefined, sourcePath: Gate1ForensicTraceSourcePath): ConditionResultsBreakPointAdr0510 {
  if (sourcePath === 'SELL_ONLY_DIAGNOSTIC_SNAPSHOT') return 'SELL_ONLY_SKIPPED_GATE_EVALUATION';
  if (sourcePath === 'PREFLIGHT_UNIVERSE_SNAPSHOT') return 'PRECHECK_ONLY_TRACE';
  const record = candidate as unknown as Record<string, unknown> | undefined;
  const hasResults = Boolean(record?.conditionResults && typeof record.conditionResults === 'object')
    || Boolean(Array.isArray(record?.conditionResultsTrace) && record?.conditionResultsTrace.length > 0);
  if (hasResults) return 'CONDITION_RESULTS_PROJECTED';
  if (!candidate?.gate1Trace) return 'EVALUATE_SERVER_GATE_NOT_CALLED';
  return 'CONDITION_RESULTS_NOT_PROJECTED';
}

function bump<K extends string>(record: Record<K, number>, key: K): void {
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

function buildSupplyScopeAudit(input: {
  trace: MinimumSignalScoreTrace;
  candidate?: CandidateEntryTrace;
  conditionResultsTrace?: GateConditionResultTrace[];
  conditionResults?: Record<string, unknown>;
  conditionKeys?: string[];
  supplyProviderHealth?: Partial<SupplyProviderHealthTrace>;
  kisFlow?: BuildGate1MinimumSignalForensicInput['kisFlow'];
  quoteSymbol?: string | null;
}): SupplyScopeAudit {
  const { trace, candidate, kisFlow, quoteSymbol, supplyProviderHealth } = input;

  const kisSymbol = normalizeSymbol(kisFlow?.symbol ?? null);
  const candidateSymbol = normalizeSymbol(kisFlow?.candidateSymbol ?? candidate?.symbol ?? trace.symbol ?? null);
  const quoteObject = candidate?.quote && typeof candidate.quote === 'object'
    ? (candidate.quote as Record<string, unknown>)
    : undefined;
  const qSymbol = normalizeSymbol(kisFlow?.quoteSymbol ?? quoteSymbol ?? (quoteObject?.symbol as string | null | undefined) ?? supplyProviderHealth?.quoteSymbol ?? null);
  const traceSymbol = normalizeSymbol(trace.symbol);
  const requestSymbol = normalizeSymbol(kisFlow?.requestSymbol ?? supplyProviderHealth?.requestSymbol ?? null);
  const providerSymbol = normalizeSymbol(kisFlow?.providerSymbol ?? supplyProviderHealth?.providerSymbol ?? kisSymbol ?? null);
  const normalizedSymbol = normalizeSymbol(kisFlow?.normalizedSymbol ?? supplyProviderHealth?.normalizedSymbol ?? providerSymbol ?? requestSymbol ?? null);
  const providerScope = kisFlow?.providerScope ?? supplyProviderHealth?.providerScope ?? 'UNKNOWN';
  const routePurpose = kisFlow?.routePurpose ?? supplyProviderHealth?.routePurpose ?? null;
  const selectedProvider = kisFlow?.selectedProvider ?? supplyProviderHealth?.selectedInvestorFlowProvider ?? supplyProviderHealth?.providerName ?? null;

  // symbolMatched 판정 — provider/normalized symbol 이 있을 때는 strict, SYMBOL_LEVEL request inference 는 별도 표기.
  let symbolMatched: boolean | null = null;
  const expectedSymbol = candidateSymbol ?? qSymbol ?? traceSymbol;
  const comparableProviderSymbol = providerSymbol ?? kisSymbol ?? normalizedSymbol;
  if (comparableProviderSymbol && expectedSymbol) {
    symbolMatched = comparableProviderSymbol === expectedSymbol && (!qSymbol || qSymbol === expectedSymbol);
  }
  const inferredSymbolMatched = symbolMatched !== true
    && providerScope === 'SYMBOL_LEVEL'
    && Boolean(requestSymbol && expectedSymbol && requestSymbol === expectedSymbol);

  const semanticRowCandidate = (kisFlow?.semanticRow ?? kisFlow?.investorFlowSemanticRow) as SanitizedInvestorFlowSemanticRow | Record<string, unknown> | null | undefined;
  const sanitizedSemanticRow = semanticRowCandidate && typeof semanticRowCandidate === 'object' && 'sourceFields' in semanticRowCandidate && 'rawFieldKeys' in semanticRowCandidate
    ? semanticRowCandidate as SanitizedInvestorFlowSemanticRow
    : null;
  const flowForSemantic = kisFlow ?? sanitizedSemanticRow ?? null;
  const rawInvestorRowAvailable = kisFlow?.kisRawRowAvailableAtAdapter ?? (flowForSemantic != null && typeof flowForSemantic === 'object');
  const selectedCandidateCarriesSemanticRow = kisFlow?.kisSelectedCandidateCarriesSemanticRow ?? Boolean(kisFlow?.semanticRow ?? kisFlow?.investorFlowSemanticRow);
  const forensicInputCarriesSemanticRow = kisFlow?.forensicInputCarriesSemanticRow ?? Boolean(kisFlow?.semanticRow ?? kisFlow?.investorFlowSemanticRow);
  const semantic = evaluateInvestorFlowSemanticAvailabilityV2({
    flow: flowForSemantic,
    symbolMatched,
    inferredSymbolMatched,
    providerScope,
    stale: kisFlow?.stale === true,
    providerIssue: false,
    rawInvestorRowAvailable,
    semanticRowExpected: selectedCandidateCarriesSemanticRow,
    semanticRowDropped: kisFlow?.semanticRowBreakPoint === 'ROUTER_DROPPED_RAW_ROW' || kisFlow?.semanticRowBreakPoint === 'ROUTER_DROPPED_SEMANTIC_ROW',
    forensicInputDroppedSemanticRow: kisFlow?.semanticRowBreakPoint === 'FORENSIC_INPUT_DROPPED_SEMANTIC_ROW',
  });
  const foreignNetBuy = semantic.foreignNetBuy;
  const institutionalNetBuy = semantic.institutionalNetBuy;
  const programNetBuy = semantic.programNetBuy ?? null;
  const individualNetBuy = semantic.individualNetBuy;
  const semanticAvailable = semantic.available;

  // warning 우선순위 결정 트리 (사용자 명시 절대 변경 금지)
  let warning: SupplyScopeWarning = 'NONE';

  if (!comparableProviderSymbol && !inferredSymbolMatched) {
    warning = 'KIS_FLOW_SYMBOL_MISSING';
  } else if (symbolMatched === false && !inferredSymbolMatched) {
    warning = 'KIS_FLOW_SYMBOL_MISMATCH';
  } else if (kisFlow !== undefined && !semanticAvailable) {
    warning = 'KIS_FLOW_SEMANTIC_UNAVAILABLE';
  }

  // POSSIBLE_MARKET_WIDE_FLOW_IN_SYMBOL_SLOT — providerName / providerTried 에
  // 'MARKET_WIDE' 또는 'AGGREGATE' 키워드 검출 시. Market/sector scope is never injected as candidate symbol.
  const providerSignals: string[] = [];
  if (supplyProviderHealth?.providerName) providerSignals.push(supplyProviderHealth.providerName);
  if (supplyProviderHealth?.selectedInvestorFlowProvider) {
    providerSignals.push(supplyProviderHealth.selectedInvestorFlowProvider);
  }
  if (supplyProviderHealth?.providerTried) {
    providerSignals.push(...supplyProviderHealth.providerTried);
  }
  const hasMarketWideSignal = providerScope === 'MARKET_LEVEL' || providerScope === 'SECTOR_LEVEL' || providerSignals.some((sig) => {
    const lower = (sig ?? '').toLowerCase();
    return lower.includes('market_wide') || lower.includes('market-wide') || lower.includes('aggregate');
  });
  if (hasMarketWideSignal && warning === 'NONE') {
    warning = 'POSSIBLE_MARKET_WIDE_FLOW_IN_SYMBOL_SLOT';
  }

  return {
    expectedScope: 'SYMBOL_LEVEL_INVESTOR_FLOW',
    candidateSymbol,
    quoteSymbol: qSymbol,
    requestSymbol,
    providerSymbol,
    normalizedSymbol,
    providerScope,
    routePurpose,
    selectedProvider,
    materialized: kisFlow?.materialized ?? supplyProviderHealth?.materialized,
    usableForRouter: kisFlow?.usableForRouter ?? supplyProviderHealth?.usableForRouter,
    usableForGate: false,
    usableForLive: false,
    usableForShadow: true,
    kisFlowSymbol: kisSymbol,
    symbolMatched,
    inferredSymbolMatched,
    foreignNetBuy,
    institutionalNetBuy,
    programNetBuy,
    individualNetBuy,
    semanticAvailable,
    semanticDiagnosticAvailable: semantic.diagnosticAvailable,
    semanticRowAvailable: semantic.foreignNetBuy !== null || semantic.institutionalNetBuy !== null || semantic.individualNetBuy !== null,
    semanticRowMetadataOnly: semantic.reason === 'SEMANTIC_ROW_METADATA_ONLY',
    rawInvestorRowAvailable,
    selectedCandidateCarriesSemanticRow,
    forensicInputCarriesSemanticRow,
    semanticRowBreakPoint: kisFlow?.semanticRowBreakPoint ?? semantic.semanticRowBreakPoint ?? (semantic.reason === 'SEMANTIC_ROW_METADATA_ONLY' ? 'ONLY_WRAPPER_METADATA' : semantic.reason === 'FIELD_ALIAS_NOT_MAPPED' ? 'NESTED_ROW_UNWRAPPED_BUT_ALIAS_NOT_MAPPED' : 'UNKNOWN'),
    semanticReason: semantic.reason,
    materializedCount: semantic.materializedCount,
    normalizedCount: semantic.normalizedCount,
    sourceFields: semantic.sourceFields,
    rowCount: semantic.rowCount,
    investorTypesDetected: semantic.investorTypesDetected,
    foreignRowFound: semantic.foreignRowFound,
    institutionalRowFound: semantic.institutionalRowFound,
    individualRowFound: semantic.individualRowFound,
    rowMappingConfidence: semantic.rowMappingConfidence,
    fieldKeyDiagnostics: sanitizedSemanticRow
      ? {
          kisRawFieldKeysTop: sanitizedSemanticRow.rawFieldKeys,
          kisNormalizedFieldKeysTop: sanitizedSemanticRow.normalizedFieldKeys,
          sampleValueKinds: semantic.fieldKeyDiagnostics?.sampleValueKinds ?? { number: 0, numericString: 0, empty: 0, placeholder: 0 },
          candidateMappedFields: {
            foreign: sanitizedSemanticRow.sourceFields.foreign ? [sanitizedSemanticRow.sourceFields.foreign] : [],
            institution: sanitizedSemanticRow.sourceFields.institutional ? [sanitizedSemanticRow.sourceFields.institutional] : [],
            individual: sanitizedSemanticRow.sourceFields.individual ? [sanitizedSemanticRow.sourceFields.individual] : [],
          },
        }
      : semantic.fieldKeyDiagnostics,
    providerIssue: semantic.providerIssue,
    marketSignal: false,
    wouldBeNeutralIfZeroButMaterialized: semantic.wouldBeNeutralIfZeroButMaterialized,
    wouldBeEligibleIfForeignOrInstitutionFieldMapped: semantic.wouldBeEligibleIfForeignOrInstitutionFieldMapped,
    wouldBeSemanticAvailableIfFieldMapped: semantic.wouldBeSemanticAvailableIfFieldMapped,
    wouldBeZeroNeutralIfAllZero: semantic.wouldBeZeroNeutralIfAllZero,
    scoreUsage: semantic.scoreUsage,
    executionImpact: 'NONE',
    warning,
  };
}

function resolveSupplyUnknownRootCause(audit: SupplyScopeAudit): string {
  if (!audit.kisFlowSymbol && !audit.providerSymbol && !audit.normalizedSymbol && audit.inferredSymbolMatched !== true) return 'SUPPLY_SYMBOL_MISSING';
  if (audit.symbolMatched === false && audit.inferredSymbolMatched !== true) return 'SUPPLY_SYMBOL_MISMATCH';
  if (audit.semanticReason === 'ONLY_MARKET_LEVEL_FLOW' || audit.semanticReason === 'ONLY_SECTOR_LEVEL_FLOW' || audit.semanticReason === 'PROVIDER_SCOPE_NOT_SYMBOL_LEVEL') return 'SUPPLY_PROVIDER_SCOPE_NOT_SYMBOL';
  if (audit.semanticReason === 'SEMANTIC_ROW_METADATA_ONLY') return 'SUPPLY_SEMANTIC_ROW_METADATA_ONLY';
  if (audit.semanticReason === 'RAW_INVESTOR_ROW_MISSING') return 'SUPPLY_RAW_INVESTOR_ROW_MISSING';
  if (audit.semanticReason === 'ROUTER_DROPPED_SEMANTIC_ROW') return 'SUPPLY_ROUTER_DROPPED_SEMANTIC_ROW';
  if (audit.semanticReason === 'FORENSIC_INPUT_DROPPED_SEMANTIC_ROW') return 'SUPPLY_FORENSIC_INPUT_DROPPED_SEMANTIC_ROW';
  if (audit.semanticReason === 'FIELD_ALIAS_NOT_MAPPED') return 'SUPPLY_FIELD_ALIAS_NOT_MAPPED';
  if (audit.semanticReason === 'PLACEHOLDER_ONLY') return 'SUPPLY_PLACEHOLDER_ONLY';
  if (audit.semanticReason === 'STALE_ONLY') return 'SUPPLY_STALE_ONLY';
  if (audit.semanticReason === 'ZERO_BUT_MATERIALIZED') return 'SUPPLY_ZERO_NEUTRAL_BUT_NOT_PROMOTED';
  if (audit.symbolMatched === true || audit.inferredSymbolMatched === true) return 'SUPPLY_ROUTER_VERIFIED_BUT_GATE_SEMANTIC_UNUSABLE';
  return 'SUPPLY_SEMANTIC_FIELD_MISSING';
}

function normalizeSymbol(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function recordValue(input: unknown, key: string): unknown {
  return input && typeof input === 'object' ? (input as Record<string, unknown>)[key] : undefined;
}

function hasValue(input: unknown, key: string): boolean {
  const value = recordValue(input, key);
  return value !== undefined && value !== null;
}

function hasNestedValue(input: unknown, path: string): boolean {
  const value = path.split('.').reduce<unknown>((current, part) => recordValue(current, part), input);
  return value !== undefined && value !== null;
}

function hasAny(candidate: CandidateEntryTrace, fields: readonly string[]): boolean {
  return fields.some((field) => field.includes('.') ? hasNestedValue(candidate, field) : hasHydrationField(candidate, field));
}

function hasWatchlistReasonProxy(candidate: CandidateEntryTrace, pattern: RegExp): boolean {
  const reason = (candidate as unknown as Record<string, unknown>).watchlistReason;
  return Array.isArray(reason) && reason.some((item) => typeof item === 'string' && pattern.test(item));
}

const RS_HYDRATION_FIELDS = [
  'return20d',
  'return5d',
  'kospi20dReturn',
  'relativeReturn20d',
  'marketRelativeReturn',
  'rsRankPct',
  'relativeStrengthScore',
] as const;

const BREAKOUT_HYDRATION_FIELDS = [
  'price',
  'currentPrice',
  'high5d',
  'high20d',
  'high60',
  'volume',
  'avgVolume',
  'volumeRatio',
  'ma20',
  'ma60',
  'aboveMA20',
  'aboveMA60',
  'breakout_momentum',
  'turtle_high',
  'volume_breakout',
  'volume_surge',
  'vcp',
  'trend_acceleration',
  'breakoutSignals',
  'conditionResults',
  'conditionKeys',
] as const;

function hasHydrationField(candidate: CandidateEntryTrace, field: string): boolean {
  const record = candidate as unknown as Record<string, unknown>;
  const direct = record[field];
  if (direct !== undefined && direct !== null) return true;
  const quote = record.quote;
  if (quote && typeof quote === 'object' && (quote as Record<string, unknown>)[field] != null) return true;
  const symbolFeatures = record.symbolFeatures;
  if (symbolFeatures && typeof symbolFeatures === 'object' && (symbolFeatures as Record<string, unknown>)[field] != null) {
    return true;
  }
  const macroState = record.macroState;
  if (macroState && typeof macroState === 'object' && (macroState as Record<string, unknown>)[field] != null) return true;
  return false;
}


const REQUIRED_CONDITION_KEYS = [
  'momentum',
  'ma_alignment',
  'volume_breakout',
  'turtle_high',
  'relative_strength',
  'breakout_momentum',
  'vcp',
  'volume_surge',
  'rsi_zone',
  'macd_bull',
  'pullback',
  'ma60_rising',
  'weekly_rsi_zone',
  'supply_confluence',
  'earnings_quality',
  'trend_acceleration',
] as const;

const BREAKOUT_CONDITION_KEYS: ReadonlySet<string> = new Set([
  'breakout_momentum',
  'turtle_high',
  'volume_breakout',
  'volume_surge',
  'vcp',
  'trend_acceleration',
]);

type ConditionStatus = 'FIRED' | 'DATA_UNAVAILABLE' | 'THRESHOLD_NOT_MET' | 'PROVIDER_DEGRADED' | 'ERROR';

function numericValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function conditionRecord(candidate: CandidateEntryTrace, key: string): Record<string, unknown> | undefined {
  const raw = candidate as unknown as Record<string, unknown>;
  const results = raw.conditionResults && typeof raw.conditionResults === 'object'
    ? raw.conditionResults
    : conditionResultsTraceToMap(Array.isArray(raw.conditionResultsTrace) ? raw.conditionResultsTrace as GateConditionResultTrace[] : undefined);
  if (!results || typeof results !== 'object') return undefined;
  const value = (results as Record<string, unknown>)[key];
  return value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}

function conditionStatus(candidate: CandidateEntryTrace, key: string): ConditionStatus | undefined {
  const record = conditionRecord(candidate, key);
  if (!record) return undefined;
  const explicit = typeof record.status === 'string' ? record.status.toUpperCase() : undefined;
  if (explicit === 'FIRED' || explicit === 'PASS' || explicit === 'PASSED') return 'FIRED';
  if (explicit === 'DATA_UNAVAILABLE' || explicit === 'UNAVAILABLE' || explicit === 'MISSING') return 'DATA_UNAVAILABLE';
  if (explicit === 'THRESHOLD_NOT_MET' || explicit === 'NOT_MET' || explicit === 'FALSE') return 'THRESHOLD_NOT_MET';
  if (explicit === 'PROVIDER_DEGRADED' || explicit === 'DEGRADED') return 'PROVIDER_DEGRADED';
  if (explicit === 'ERROR') return 'ERROR';
  if (record.fired === true || record.passed === true) return 'FIRED';
  if (record.unavailable === true || record.hadRequiredData === false) return 'DATA_UNAVAILABLE';
  if (record.providerDegraded === true) return 'PROVIDER_DEGRADED';
  if (record.thresholdNotMet === true || record.fired === false || record.passed === false) return 'THRESHOLD_NOT_MET';
  return numericValue(record.score) !== undefined || numericValue(record.normalizedScore) !== undefined ? 'THRESHOLD_NOT_MET' : 'DATA_UNAVAILABLE';
}

function hasConditionNumericScore(candidate: CandidateEntryTrace, key: string): boolean {
  const record = conditionRecord(candidate, key);
  return Boolean(record && (numericValue(record.score) !== undefined || numericValue(record.normalizedScore) !== undefined));
}

function hasPositiveConditionScore(candidate: CandidateEntryTrace, key: string): boolean {
  const record = conditionRecord(candidate, key);
  const score = numericValue(record?.score) ?? numericValue(record?.normalizedScore);
  return score !== undefined && score > 0;
}

function classifyRsSource(candidate: CandidateEntryTrace): RsHydrationSourceAdr0509 {
  if (conditionRecord(candidate, 'relative_strength')) return 'CONDITION_RESULTS';
  if (hasNestedValue(candidate, 'quote.return20d') || hasNestedValue(candidate, 'quote.return5d')) return 'QUOTE_RETURN';
  if (hasAny(candidate, ['return20d', 'return5d', 'kospi20dReturn', 'rsRankPct', 'relativeStrengthScore'])) return 'SYMBOL_FEATURES';
  if (hasAny(candidate, ['relativeReturn20d', 'marketRelativeReturn', 'kospiRelativeReturn'])) return 'EXPLICIT_RELATIVE_RETURN';
  if (hasWatchlistReasonProxy(candidate, /relative|rs|leader|leading|강세|주도주/i)) return 'WATCHLIST_PROXY';
  return 'MISSING';
}

function classifyBreakoutSource(candidate: CandidateEntryTrace): BreakoutHydrationSourceAdr0509 {
  if ([...BREAKOUT_CONDITION_KEYS].some((key) => conditionRecord(candidate, key))) return 'CONDITION_RESULTS';
  const keys = (candidate as unknown as Record<string, unknown>).conditionKeys;
  if (Array.isArray(keys) && keys.some((key) => BREAKOUT_CONDITION_KEYS.has(String(key)))) return 'CONDITION_KEYS';
  if (hasAny(candidate, ['quote.price', 'quote.currentPrice', 'quote.high5d', 'quote.high20d', 'quote.high60', 'quote.volume', 'quote.avgVolume', 'quote.volumeRatio', 'quote.ma20', 'quote.ma60'])) return 'QUOTE_OHLCV';
  if (hasAny(candidate, ['price', 'currentPrice', 'high5d', 'high20d', 'high60', 'volume', 'avgVolume', 'volumeRatio', 'ma20', 'ma60', 'aboveMA20', 'aboveMA60', 'breakoutSignals'])) return 'SYMBOL_FEATURES';
  if (hasWatchlistReasonProxy(candidate, /breakout|new high|vcp|turtle|volume surge|volume breakout|돌파|거래량/i)) return 'WATCHLIST_REASON_PROXY';
  return 'MISSING';
}

function buildFeatureHydrationAuditAdr0509(
  candidate: CandidateEntryTrace | undefined,
  trace?: MinimumSignalScoreTrace,
): FeatureHydrationAuditAdr0509 {
  if (!candidate) {
    return {
      rsAvailable: false,
      breakoutAvailable: false,
      rsScoreUsable: false,
      breakoutScoreUsable: false,
      rsSource: 'MISSING',
      breakoutSource: 'MISSING',
      rsMissingReasons: ['CANDIDATE_TRACE_MISSING'],
      breakoutMissingReasons: ['CANDIDATE_TRACE_MISSING'],
      rsMissingFields: [...RS_HYDRATION_FIELDS],
      breakoutMissingFields: [...BREAKOUT_HYDRATION_FIELDS],
      missingFields: [...RS_HYDRATION_FIELDS, ...BREAKOUT_HYDRATION_FIELDS],
      candidateTraceHasQuote: false,
      candidateTraceHasSymbolFeatures: false,
      candidateTraceHasConditionResults: false,
      candidateTraceHasWatchlistScore: false,
      candidateTraceHasSupplyContext: false,
      candidateTraceHasMinSignalScoreTrace: Boolean(trace),
      watchlist: { sourceAvailable: false, sourceField: null, scoreImported: false, missingReason: 'CANDIDATE_TRACE_MISSING' },
    };
  }
  const record = candidate as unknown as Record<string, unknown>;
  const candidateTraceHasQuote = Boolean(record.quote && typeof record.quote === 'object');
  const candidateTraceHasSymbolFeatures = Boolean(record.symbolFeatures && typeof record.symbolFeatures === 'object');
  const candidateTraceHasConditionResults = Boolean((record.conditionResults && typeof record.conditionResults === 'object') || (Array.isArray(record.conditionResultsTrace) && record.conditionResultsTrace.length > 0));
  const candidateTraceHasSupplyContext = Boolean(record.supplyConfluenceState || record.supplyProviderHealth);
  const resolvedWatchlist = resolveWatchlistUpstreamScore(candidate);
  const candidateTraceHasWatchlistScore = resolvedWatchlist.confidence === 'VERIFIED';
  const rsMissingFields = RS_HYDRATION_FIELDS.filter((field) => !hasHydrationField(candidate, field));
  const breakoutMissingFields = BREAKOUT_HYDRATION_FIELDS.filter((field) => !hasHydrationField(candidate, field));
  const rsSource = classifyRsSource(candidate);
  const breakoutSource = classifyBreakoutSource(candidate);
  const rsAvailable = rsSource !== 'MISSING';
  const breakoutAvailable = breakoutSource !== 'MISSING';
  const conditionKeyStatus: Record<string, ConditionStatus> = {};
  for (const key of REQUIRED_CONDITION_KEYS) {
    const status = conditionStatus(candidate, key);
    if (status) conditionKeyStatus[key] = status;
  }
  const conditionKeys = Array.isArray(record.conditionKeys) ? record.conditionKeys.map(String) : [];
  const breakoutConditionKeys = [
    ...Object.keys(conditionKeyStatus).filter((key) => BREAKOUT_CONDITION_KEYS.has(key)),
    ...conditionKeys.filter((key) => BREAKOUT_CONDITION_KEYS.has(key)),
  ].filter((key, index, arr) => arr.indexOf(key) === index);
  const rsStatus = conditionStatus(candidate, 'relative_strength');
  const rsScoreUsable = rsSource === 'CONDITION_RESULTS'
    ? rsStatus === 'FIRED' || (rsStatus === undefined && hasPositiveConditionScore(candidate, 'relative_strength'))
    : rsAvailable && trace?.components?.some((c) => c.code === 'RELATIVE_STRENGTH' && c.confidence !== 'MISSING') === true;
  const breakoutScoreUsable = breakoutSource === 'CONDITION_RESULTS'
    ? breakoutConditionKeys.some((key) => {
        const status = conditionStatus(candidate, key);
        return status === 'FIRED' || (status === undefined && hasPositiveConditionScore(candidate, key));
      })
    : breakoutAvailable && trace?.components?.some((c) => c.code === 'BREAKOUT_STRUCTURE' && c.confidence !== 'MISSING') === true;
  const rsMissingReasons: HydrationMissingReason[] = [];
  const breakoutMissingReasons: HydrationMissingReason[] = [];
  if (!rsAvailable) rsMissingReasons.push('FIELD_MISSING');
  if (!candidateTraceHasQuote) rsMissingReasons.push('QUOTE_MISSING');
  if (!candidateTraceHasSymbolFeatures) rsMissingReasons.push('SYMBOL_FEATURES_MISSING');
  if (!breakoutAvailable) breakoutMissingReasons.push('FIELD_MISSING');
  if (!candidateTraceHasConditionResults) breakoutMissingReasons.push('CONDITION_RESULTS_MISSING');
  if (!candidateTraceHasSymbolFeatures) breakoutMissingReasons.push('SYMBOL_FEATURES_MISSING');
  return {
    rsAvailable,
    breakoutAvailable,
    rsScoreUsable,
    breakoutScoreUsable,
    rsSource,
    breakoutSource,
    rsMissingReasons,
    breakoutMissingReasons,
    rsMissingFields,
    breakoutMissingFields,
    missingFields: [...rsMissingFields, ...breakoutMissingFields],
    candidateTraceHasQuote,
    candidateTraceHasSymbolFeatures,
    candidateTraceHasConditionResults,
    candidateTraceHasWatchlistScore,
    candidateTraceHasSupplyContext,
    candidateTraceHasMinSignalScoreTrace: Boolean(trace),
    watchlist: {
      sourceAvailable: resolvedWatchlist.confidence === 'VERIFIED',
      sourceField: resolvedWatchlist.sourceField ?? null,
      scoreImported: resolvedWatchlist.confidence === 'VERIFIED' && resolvedWatchlist.sourceField !== undefined,
      rawScore: resolvedWatchlist.rawScore ?? null,
      normalizedWatchlistScore: resolvedWatchlist.confidence === 'VERIFIED' ? resolvedWatchlist.normalized100 : null,
      scoreScale: resolvedWatchlist.scoreScale ?? null,
      stage2Score: numericValue(record.stage2Score) ?? null,
      watchlistScore: numericValue(record.watchlistScore) ?? null,
      upstreamCandidateScore: numericValue(record.upstreamCandidateScore) ?? numericValue(record.upstreamScore) ?? null,
      watchlistRank: numericValue(record.watchlistRank) ?? null,
      totalCandidates: numericValue(record.totalCandidates) ?? null,
      watchlistReason: Array.isArray(record.watchlistReason) ? record.watchlistReason.filter((item): item is string => typeof item === 'string') : undefined,
      watchlistSourceField: resolvedWatchlist.sourceField ?? null,
      missingReason: resolvedWatchlist.confidence === 'VERIFIED' ? undefined : resolvedWatchlist.reason ?? 'WATCHLIST_SCORE_MISSING',
    },
    conditionKeyStatus,
    breakoutConditionKeys,
  };
}

const EMPTY_HYDRATION_REASON_DISTRIBUTION: Record<HydrationMissingReason, number> = {
  CANDIDATE_TRACE_MISSING: 0,
  FIELD_MISSING: 0,
  QUOTE_MISSING: 0,
  SYMBOL_FEATURES_MISSING: 0,
  CONDITION_RESULTS_MISSING: 0,
};

/* ───────── sectorEnergyAudit SSOT ───────── */

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

const EMPTY_DOMINANT_DISTRIBUTION: Record<DominantFailureReason, number> = {
  POSITIVE_SCORE_STARVATION: 0,
  WATCHLIST_SCORE_NOT_IMPORTED: 0,
  RELATIVE_STRENGTH_SOURCE_MISSING: 0,
  BREAKOUT_STRUCTURE_SOURCE_MISSING: 0,
  SUPPLY_PROVIDER_UNKNOWN_PENALTY: 0,
  INVESTOR_FLOW_UNKNOWN_PENALTY: 0,
  SECTOR_ENERGY_DIAGNOSTIC_PENALTY: 0,
  SCORE_CEILING_BELOW_THRESHOLD: 0,
  MIXED: 0,
  UNKNOWN: 0,
};

const EMPTY_SUPPLY_SCOPE_WARNINGS: Record<SupplyScopeWarning, number> = {
  NONE: 0,
  KIS_FLOW_SYMBOL_MISMATCH: 0,
  KIS_FLOW_SYMBOL_MISSING: 0,
  KIS_FLOW_SEMANTIC_UNAVAILABLE: 0,
  POSSIBLE_MARKET_WIDE_FLOW_IN_SYMBOL_SLOT: 0,
};

const EMPTY_SEMANTIC_REASON_DISTRIBUTION: Record<InvestorFlowSemanticAvailabilityReason, number> = {
  AVAILABLE: 0,
  NO_FOREIGN_OR_INSTITUTION_FIELD: 0,
  SEMANTIC_ROW_METADATA_ONLY: 0,
  FIELD_ALIAS_NOT_MAPPED: 0,
  ONLY_WRAPPER_OBJECT_SELECTED: 0,
  NO_ACTUAL_ROW_FOUND: 0,
  DEEP_UNWRAP_NO_NUMERIC_FIELDS: 0,
  NUMERIC_FIELDS_FOUND_BUT_ALIAS_UNKNOWN: 0,
  ALIAS_MAPPED_FOREIGN_ONLY: 0,
  ALIAS_MAPPED_INSTITUTION_ONLY: 0,
  ALIAS_MAPPED_BOTH: 0,
  INVESTOR_TYPE_ROW_MAPPING_FAILED: 0,
  RAW_INVESTOR_ROW_MISSING: 0,
  ROUTER_DROPPED_SEMANTIC_ROW: 0,
  FORENSIC_INPUT_DROPPED_SEMANTIC_ROW: 0,
  SYMBOL_NOT_MATCHED: 0,
  PROVIDER_SCOPE_NOT_SYMBOL_LEVEL: 0,
  ONLY_MARKET_LEVEL_FLOW: 0,
  ONLY_SECTOR_LEVEL_FLOW: 0,
  PLACEHOLDER_ONLY: 0,
  STALE_ONLY: 0,
  ZERO_BUT_MATERIALIZED: 0,
  ROW_MAPPING_FAILED: 0,
  UNKNOWN: 0,
};

export function buildGate1MinimumSignalForensicSummaryAdr0505(
  audits: ReadonlyArray<Gate1MinimumSignalForensicAuditAdr0505>,
): Gate1MinimumSignalForensicSummaryAdr0505 {
  const totalCandidates = audits.length;
  const failed = audits.filter((a) => !a.passed);
  const failedCandidates = failed.length;

  // 평균 계산 — 0건 시 0 fallback (NaN 차단)
  const requiredScoreAvg =
    totalCandidates > 0
      ? audits.reduce((sum, a) => sum + a.requiredScore, 0) / totalCandidates
      : 0;
  const actualScoreAvg =
    totalCandidates > 0 ? audits.reduce((sum, a) => sum + a.actualScore, 0) / totalCandidates : 0;
  const avgScoreGap =
    totalCandidates > 0 ? audits.reduce((sum, a) => sum + a.scoreGap, 0) / totalCandidates : 0;

  // 분포 집계 (failed only)
  const dominantFailureDistribution = { ...EMPTY_DOMINANT_DISTRIBUTION };
  for (const a of failed) {
    dominantFailureDistribution[a.dominantFailureReason] += 1;
  }

  const missingPositiveSourceCounts = {
    watchlistUpstreamMissing: 0,
    relativeStrengthMissing: 0,
    breakoutStructureMissing: 0,
    priceMomentumMissing: 0,
    technicalTrendMissing: 0,
    volumeLiquidityMissing: 0,
  };
  for (const a of failed) {
    for (const m of a.missingPositiveSources) {
      switch (m) {
        case 'WATCHLIST_UPSTREAM_SCORE_MISSING':
          missingPositiveSourceCounts.watchlistUpstreamMissing += 1;
          break;
        case 'RELATIVE_STRENGTH_MISSING':
          missingPositiveSourceCounts.relativeStrengthMissing += 1;
          break;
        case 'BREAKOUT_STRUCTURE_MISSING':
          missingPositiveSourceCounts.breakoutStructureMissing += 1;
          break;
        case 'PRICE_MOMENTUM_MISSING':
          missingPositiveSourceCounts.priceMomentumMissing += 1;
          break;
        case 'TECHNICAL_TREND_MISSING':
          missingPositiveSourceCounts.technicalTrendMissing += 1;
          break;
        case 'VOLUME_LIQUIDITY_MISSING':
          missingPositiveSourceCounts.volumeLiquidityMissing += 1;
          break;
      }
    }
  }

  const penaltyCounts = {
    supplyUnknownPenalty: 0,
    investorFlowUnknownPenalty: 0,
    sectorEnergyPenaltyOrBlocked: 0,
    unknownDataPenalty: 0,
    softFailPenalty: 0,
    riskPenalty: 0,
  };
  for (const a of failed) {
    if (a.penaltyComponents['SUPPLY_CONFLUENCE']?.weightedScore < 0) penaltyCounts.supplyUnknownPenalty += 1;
    if (a.penaltyComponents['INVESTOR_FLOW']?.weightedScore < 0) penaltyCounts.investorFlowUnknownPenalty += 1;
    if (
      a.penaltyComponents['SECTOR_ENERGY']?.weightedScore < 0 ||
      a.sectorEnergyAudit.strongBuyAllowed === false
    ) {
      penaltyCounts.sectorEnergyPenaltyOrBlocked += 1;
    }
    if (a.penaltyComponents['UNKNOWN_DATA_PENALTY']) penaltyCounts.unknownDataPenalty += 1;
    if (a.penaltyComponents['SOFT_FAIL_PENALTY']) penaltyCounts.softFailPenalty += 1;
    if (a.penaltyComponents['RISK_PENALTY']) penaltyCounts.riskPenalty += 1;
  }

  const supplyScopeWarnings = { ...EMPTY_SUPPLY_SCOPE_WARNINGS };
  let supplySymbolMatchedCount = 0;
  let inferredSymbolMatchedCount = 0;
  let candidateSymbolAvailableCount = 0;
  let quoteSymbolAvailableCount = 0;
  let requestSymbolAvailableCount = 0;
  let providerSymbolAvailableCount = 0;
  let symbolMissingCount = 0;
  let symbolMismatchCount = 0;
  const providerScopeDistribution: Record<string, number> = {};
  const semanticReasonDistribution = { ...EMPTY_SEMANTIC_REASON_DISTRIBUTION };
  const scoreUsageDistribution: Record<string, number> = {};
  const supplyUnknownRootCauseDistribution: Record<string, number> = {};
  const kisRawFieldKeysTop: Record<string, number> = {};
  const actualRawFieldKeysTop: Record<string, number> = {};
  const actualNumericStringFieldKeysTop: Record<string, number> = {};
  const actualNumberFieldKeysTop: Record<string, number> = {};
  const actualPlaceholderFieldKeysTop: Record<string, number> = {};
  const candidateNetBuyFieldKeysTop: Record<string, number> = {};
  const selectedActualRawFieldKeysTop: Record<string, number> = {};
  const selectedNumericStringFieldKeysTop: Record<string, number> = {};
  const rejectedWrapperPathsTop: Record<string, number> = {};
  let rowCandidateCount = 0;
  let selectedRowScoreSum = 0;
  let selectedRowScoreCount = 0;
  let wrapperOnlyCount = 0;
  let numericCandidateCount = 0;
  let aliasCandidateCount = 0;
  const selectedPathTop: Record<string, number> = {};
  const kisNormalizedFieldKeysTop: Record<string, number> = {};
  const kisSemanticFieldKeysTop: Record<string, number> = {};
  const semanticRowBreakPointDistribution: Record<string, number> = {};
  let semanticRowAvailableCount = 0;
  let semanticRowMetadataOnlyCount = 0;
  let rawInvestorRowAvailableCount = 0;
  let selectedCandidateCarriesSemanticRowCount = 0;
  let forensicInputCarriesSemanticRowCount = 0;
  const sampleValueKindDistribution: Record<string, number> = {};
  const mappedFieldDistribution: { foreign: Record<string, number>; institution: Record<string, number>; individual: Record<string, number> } = {
    foreign: {},
    institution: {},
    individual: {},
  };
  let supplySemanticAvailable = 0;
  let supplyDiagnosticAvailable = 0;
  let foreignNetBuyAvailable = 0;
  let institutionalNetBuyAvailable = 0;
  let zeroButMaterializedCount = 0;
  let shadowEligibleSupplyCount = 0;
  let rsHydrationAvailableCount = 0;
  let breakoutHydrationAvailableCount = 0;
  const rsMissingReasonDistribution = { ...EMPTY_HYDRATION_REASON_DISTRIBUTION };
  const breakoutMissingReasonDistribution = { ...EMPTY_HYDRATION_REASON_DISTRIBUTION };
  const hydrationMissingFieldCounts: Record<string, number> = {};
  const rsMissingFieldCounts: Record<string, number> = {};
  const breakoutMissingFieldCounts: Record<string, number> = {};
  const watchlistSourceFieldDistribution: Record<string, number> = {};
  const watchlistMissingReasonCounts: Record<string, number> = {};
  const watchlistScoreScaleDistribution: Record<string, number> = {};
  let watchlistScoreSum = 0;
  const quoteMissingReasonCounts: Record<string, number> = {};
  const quoteFeatureFieldCoverage: Record<string, number> = { return5d: 0, return20d: 0, high5d: 0, high20d: 0, volume: 0, avgVolume: 0, ma20: 0, ma60: 0 };
  let quoteFeatureAvailableCount = 0;
  const conditionResultsKeyCoverage: Record<string, number> = {};
  const conditionResultStatusDistribution: Record<string, number> = { FIRED: 0, DATA_UNAVAILABLE: 0, THRESHOLD_NOT_MET: 0, PROVIDER_DEGRADED: 0, ERROR: 0 };
  const rsConditionStatusDistribution: Record<string, number> = {};
  const breakoutConditionStatusDistribution: Record<string, number> = {};
  let conditionResultsAvailableCount = 0;
  const breakoutConditionKeyCoverage: Record<string, number> = {};
  const rsSourceDistribution: Record<RsHydrationSourceAdr0509, number> = {
    QUOTE_RETURN: 0,
    SYMBOL_FEATURES: 0,
    CONDITION_RESULTS: 0,
    EXPLICIT_RELATIVE_RETURN: 0,
    WATCHLIST_PROXY: 0,
    MISSING: 0,
  };
  const breakoutSourceDistribution: Record<BreakoutHydrationSourceAdr0509, number> = {
    QUOTE_OHLCV: 0,
    SYMBOL_FEATURES: 0,
    CONDITION_RESULTS: 0,
    CONDITION_KEYS: 0,
    WATCHLIST_REASON_PROXY: 0,
    MISSING: 0,
  };
  let watchlistSourceAvailableCount = 0;
  let watchlistScoreImportedCount = 0;
  let rsScoreUsableCount = 0;
  let breakoutScoreUsableCount = 0;
  let candidateTraceHasQuote = 0;
  let candidateTraceHasSymbolFeatures = 0;
  let candidateTraceHasConditionResults = 0;
  const sourcePathDistribution: Record<Gate1ForensicTraceSourcePath, number> = {
    ENTRY_FILTER_GATE1_CANDIDATE_TRACE: 0,
    ENTRY_FILTER_CANDIDATE_TRACE: 0,
    WATCHLIST_CANDIDATE: 0,
    PREFLIGHT_UNIVERSE_SNAPSHOT: 0,
    SELL_ONLY_DIAGNOSTIC_SNAPSHOT: 0,
    UNKNOWN: 0,
  };
  const sourcePathWithWatchlistScore: Record<Gate1ForensicTraceSourcePath, number> = { ...sourcePathDistribution };
  const sourcePathWithQuote: Record<Gate1ForensicTraceSourcePath, number> = { ...sourcePathDistribution };
  const sourcePathWithConditionResults: Record<Gate1ForensicTraceSourcePath, number> = { ...sourcePathDistribution };
  const sourcePathMissingFieldCounts: Record<string, Record<string, number>> = {};
  const watchlistBreakPointDistribution: Record<WatchlistBreakPointAdr0510, number> = {
    WATCHLIST_ENTRY_MISSING_SCORE: 0,
    STAGE2_SCORE_NOT_COPIED: 0,
    PROMOTION_SCORE_NOT_COPIED: 0,
    ENTRY_FILTER_TRACE_MISSING_SCORE: 0,
    FORENSIC_INPUT_MISSING_SCORE: 0,
    SOURCE_FIELD_NONE: 0,
    UNKNOWN: 0,
  };
  const quoteHydrationBreakPointDistribution: Record<QuoteHydrationBreakPointAdr0510, number> = {
    QUOTE_NOT_FETCHED: 0,
    QUOTE_FETCHED_NOT_COPIED: 0,
    SAFE_QUOTE_FEATURES_NOT_BUILT: 0,
    SELL_ONLY_SKIPPED_QUOTE_EVALUATION: 0,
    PRECHECK_ONLY_TRACE: 0,
    UNKNOWN: 0,
  };
  const conditionResultsBreakPointDistribution: Record<ConditionResultsBreakPointAdr0510, number> = {
    NONE: 0,
    CONDITION_RESULTS_PROJECTED: 0,
    EVALUATE_SERVER_GATE_NOT_CALLED: 0,
    GATE_OUTPUTS_NOT_COPIED: 0,
    CONDITION_RESULTS_NOT_PROJECTED: 0,
    SELL_ONLY_SKIPPED_GATE_EVALUATION: 0,
    PRECHECK_ONLY_TRACE: 0,
    UNKNOWN: 0,
  };
  let watchlistEntryScoreAvailable = 0;
  let stage2ScoreAvailable = 0;
  let promotionScoreAvailable = 0;
  let entryFilterTraceScoreAvailable = 0;
  let forensicInputScoreAvailable = 0;
  let sectorEnergyStrongBuyBlockedCount = 0;
  let sectorEnergyHardBlockCount = 0;

  for (const a of failed) {
    const sourcePath = a.sourcePath ?? 'UNKNOWN';
    bump(sourcePathDistribution, sourcePath);
    bump(watchlistBreakPointDistribution, a.watchlistBreakPoint ?? 'UNKNOWN');
    bump(quoteHydrationBreakPointDistribution, a.quoteHydrationBreakPoint ?? 'UNKNOWN');
    bump(conditionResultsBreakPointDistribution, a.conditionResultsBreakPoint ?? 'UNKNOWN');
    if (a.hydrationAuditAdr0509?.watchlist.scoreImported) {
      sourcePathWithWatchlistScore[sourcePath] += 1;
      forensicInputScoreAvailable += 1;
    }
    if (a.hydrationAuditAdr0509?.watchlist.watchlistScore != null) watchlistEntryScoreAvailable += 1;
    if (a.hydrationAuditAdr0509?.watchlist.stage2Score != null) stage2ScoreAvailable += 1;
    if (a.hydrationAuditAdr0509?.watchlist.upstreamCandidateScore != null) promotionScoreAvailable += 1;
    if (a.hydrationAuditAdr0509?.watchlist.sourceAvailable) entryFilterTraceScoreAvailable += 1;
    if (a.hydrationAuditAdr0509?.candidateTraceHasQuote) sourcePathWithQuote[sourcePath] += 1;
    if (a.hydrationAuditAdr0509?.candidateTraceHasConditionResults) sourcePathWithConditionResults[sourcePath] += 1;
    for (const field of a.hydrationAuditAdr0509?.missingFields ?? []) {
      const byField = sourcePathMissingFieldCounts[sourcePath] ?? {};
      byField[field] = (byField[field] ?? 0) + 1;
      sourcePathMissingFieldCounts[sourcePath] = byField;
    }
    supplyScopeWarnings[a.supplyScopeAudit.warning] += 1;
    if (a.supplyScopeAudit.symbolMatched === true) supplySymbolMatchedCount += 1;
    if (a.supplyScopeAudit.inferredSymbolMatched === true) inferredSymbolMatchedCount += 1;
    if (a.supplyScopeAudit.candidateSymbol) candidateSymbolAvailableCount += 1;
    if (a.supplyScopeAudit.quoteSymbol) quoteSymbolAvailableCount += 1;
    if (a.supplyScopeAudit.requestSymbol) requestSymbolAvailableCount += 1;
    if (a.supplyScopeAudit.providerSymbol || a.supplyScopeAudit.kisFlowSymbol || a.supplyScopeAudit.normalizedSymbol) providerSymbolAvailableCount += 1;
    if (a.supplyScopeAudit.warning === 'KIS_FLOW_SYMBOL_MISSING') symbolMissingCount += 1;
    if (a.supplyScopeAudit.warning === 'KIS_FLOW_SYMBOL_MISMATCH') symbolMismatchCount += 1;
    const scopeKey = a.supplyScopeAudit.providerScope ?? 'UNKNOWN';
    providerScopeDistribution[scopeKey] = (providerScopeDistribution[scopeKey] ?? 0) + 1;
    if (a.supplyScopeAudit.semanticAvailable) supplySemanticAvailable += 1;
    if (a.supplyScopeAudit.semanticDiagnosticAvailable) supplyDiagnosticAvailable += 1;
    if (a.supplyScopeAudit.semanticRowAvailable) semanticRowAvailableCount += 1;
    if (a.supplyScopeAudit.semanticRowMetadataOnly) semanticRowMetadataOnlyCount += 1;
    if (a.supplyScopeAudit.rawInvestorRowAvailable) rawInvestorRowAvailableCount += 1;
    if (a.supplyScopeAudit.selectedCandidateCarriesSemanticRow) selectedCandidateCarriesSemanticRowCount += 1;
    if (a.supplyScopeAudit.forensicInputCarriesSemanticRow) forensicInputCarriesSemanticRowCount += 1;
    const breakPoint = a.supplyScopeAudit.semanticRowBreakPoint ?? 'UNKNOWN';
    semanticRowBreakPointDistribution[breakPoint] = (semanticRowBreakPointDistribution[breakPoint] ?? 0) + 1;
    if (a.supplyScopeAudit.foreignNetBuy !== null) foreignNetBuyAvailable += 1;
    if (a.supplyScopeAudit.institutionalNetBuy !== null) institutionalNetBuyAvailable += 1;
    const semanticReason = a.supplyScopeAudit.semanticReason ?? 'UNKNOWN';
    semanticReasonDistribution[semanticReason] = (semanticReasonDistribution[semanticReason] ?? 0) + 1;
    if (semanticReason === 'ZERO_BUT_MATERIALIZED') zeroButMaterializedCount += 1;
    const scoreUsageKey = a.supplyScopeAudit.scoreUsage ?? 'SHADOW_ONLY';
    scoreUsageDistribution[scoreUsageKey] = (scoreUsageDistribution[scoreUsageKey] ?? 0) + 1;
    if (a.supplyScopeAudit.wouldBeEligibleIfForeignOrInstitutionFieldMapped) shadowEligibleSupplyCount += 1;
    const fieldDiagnostics = a.supplyScopeAudit.fieldKeyDiagnostics;
    for (const key of fieldDiagnostics?.kisRawFieldKeysTop ?? []) kisRawFieldKeysTop[key] = (kisRawFieldKeysTop[key] ?? 0) + 1;
    for (const key of fieldDiagnostics?.actualRawFieldKeysTop ?? []) actualRawFieldKeysTop[key] = (actualRawFieldKeysTop[key] ?? 0) + 1;
    for (const key of fieldDiagnostics?.actualNumericStringFieldKeysTop ?? []) actualNumericStringFieldKeysTop[key] = (actualNumericStringFieldKeysTop[key] ?? 0) + 1;
    for (const key of fieldDiagnostics?.actualNumberFieldKeysTop ?? []) actualNumberFieldKeysTop[key] = (actualNumberFieldKeysTop[key] ?? 0) + 1;
    for (const key of fieldDiagnostics?.actualPlaceholderFieldKeysTop ?? []) actualPlaceholderFieldKeysTop[key] = (actualPlaceholderFieldKeysTop[key] ?? 0) + 1;
    for (const key of fieldDiagnostics?.candidateNetBuyFieldKeysTop ?? []) candidateNetBuyFieldKeysTop[key] = (candidateNetBuyFieldKeysTop[key] ?? 0) + 1;
    for (const key of fieldDiagnostics?.selectedActualRawFieldKeysTop ?? []) selectedActualRawFieldKeysTop[key] = (selectedActualRawFieldKeysTop[key] ?? 0) + 1;
    for (const key of fieldDiagnostics?.selectedNumericStringFieldKeysTop ?? []) selectedNumericStringFieldKeysTop[key] = (selectedNumericStringFieldKeysTop[key] ?? 0) + 1;
    for (const key of fieldDiagnostics?.rejectedWrapperPathsTop ?? []) rejectedWrapperPathsTop[key] = (rejectedWrapperPathsTop[key] ?? 0) + 1;
    rowCandidateCount += fieldDiagnostics?.rowCandidateCount ?? 0;
    if (typeof fieldDiagnostics?.selectedRowScore === 'number') {
      selectedRowScoreSum += fieldDiagnostics.selectedRowScore;
      selectedRowScoreCount += 1;
    }
    wrapperOnlyCount += fieldDiagnostics?.wrapperOnlyCount ?? 0;
    numericCandidateCount += fieldDiagnostics?.numericCandidateCount ?? 0;
    aliasCandidateCount += fieldDiagnostics?.aliasCandidateCount ?? 0;
    if (fieldDiagnostics?.selectedPath) selectedPathTop[fieldDiagnostics.selectedPath] = (selectedPathTop[fieldDiagnostics.selectedPath] ?? 0) + 1;
    for (const key of fieldDiagnostics?.kisNormalizedFieldKeysTop ?? []) {
      kisNormalizedFieldKeysTop[key] = (kisNormalizedFieldKeysTop[key] ?? 0) + 1;
      kisSemanticFieldKeysTop[key] = (kisSemanticFieldKeysTop[key] ?? 0) + 1;
    }
    for (const [kind, count] of Object.entries(fieldDiagnostics?.sampleValueKinds ?? {})) {
      sampleValueKindDistribution[kind] = (sampleValueKindDistribution[kind] ?? 0) + Number(count);
    }
    for (const key of fieldDiagnostics?.candidateMappedFields.foreign ?? []) mappedFieldDistribution.foreign[key] = (mappedFieldDistribution.foreign[key] ?? 0) + 1;
    for (const key of fieldDiagnostics?.candidateMappedFields.institution ?? []) mappedFieldDistribution.institution[key] = (mappedFieldDistribution.institution[key] ?? 0) + 1;
    for (const key of fieldDiagnostics?.candidateMappedFields.individual ?? []) mappedFieldDistribution.individual[key] = (mappedFieldDistribution.individual[key] ?? 0) + 1;
    if (a.penaltyComponents['SUPPLY_CONFLUENCE']?.weightedScore < 0) {
      const rootCause = resolveSupplyUnknownRootCause(a.supplyScopeAudit);
      supplyUnknownRootCauseDistribution[rootCause] = (supplyUnknownRootCauseDistribution[rootCause] ?? 0) + 1;
    }
    if (a.hydrationAuditAdr0509?.watchlist.sourceAvailable) watchlistSourceAvailableCount += 1;
    if (a.hydrationAuditAdr0509?.watchlist.scoreImported) watchlistScoreImportedCount += 1;
    const watchlistField = a.hydrationAuditAdr0509?.watchlist.sourceField ?? 'none';
    watchlistSourceFieldDistribution[watchlistField] = (watchlistSourceFieldDistribution[watchlistField] ?? 0) + 1;
    const watchlistScale = a.hydrationAuditAdr0509?.watchlist.scoreScale ?? 'none';
    watchlistScoreScaleDistribution[watchlistScale] = (watchlistScoreScaleDistribution[watchlistScale] ?? 0) + 1;
    if (a.hydrationAuditAdr0509?.watchlist.scoreImported && typeof a.hydrationAuditAdr0509.watchlist.normalizedWatchlistScore === 'number') {
      watchlistScoreSum += a.hydrationAuditAdr0509.watchlist.normalizedWatchlistScore;
    }
    const watchlistMissingReason = a.hydrationAuditAdr0509?.watchlist.missingReason;
    if (watchlistMissingReason) watchlistMissingReasonCounts[watchlistMissingReason] = (watchlistMissingReasonCounts[watchlistMissingReason] ?? 0) + 1;
    if (!a.hydrationAuditAdr0509?.candidateTraceHasQuote) quoteMissingReasonCounts.QUOTE_MISSING = (quoteMissingReasonCounts.QUOTE_MISSING ?? 0) + 1;
    let candidateHasQuoteFeature = false;
    for (const field of Object.keys(quoteFeatureFieldCoverage)) {
      if (!a.hydrationAuditAdr0509?.rsMissingFields.includes(field) || !a.hydrationAuditAdr0509?.breakoutMissingFields.includes(field)) {
        quoteFeatureFieldCoverage[field] += 1;
        candidateHasQuoteFeature = true;
      }
    }
    if (candidateHasQuoteFeature) quoteFeatureAvailableCount += 1;
    for (const [key, value] of Object.entries(a.hydrationAuditAdr0509?.conditionKeyStatus ?? {})) {
      conditionResultsKeyCoverage[key] = (conditionResultsKeyCoverage[key] ?? 0) + 1;
      const status = value || 'DATA_UNAVAILABLE';
      conditionResultStatusDistribution[status] = (conditionResultStatusDistribution[status] ?? 0) + 1;
      if (key === 'relative_strength') rsConditionStatusDistribution[status] = (rsConditionStatusDistribution[status] ?? 0) + 1;
      if (BREAKOUT_CONDITION_KEYS.has(key)) breakoutConditionStatusDistribution[status] = (breakoutConditionStatusDistribution[status] ?? 0) + 1;
      conditionResultsAvailableCount += 1;
    }
    for (const key of a.hydrationAuditAdr0509?.breakoutConditionKeys ?? []) {
      breakoutConditionKeyCoverage[key] = (breakoutConditionKeyCoverage[key] ?? 0) + 1;
    }
    if (a.hydrationAuditAdr0509?.rsAvailable) rsHydrationAvailableCount += 1;
    if (a.hydrationAuditAdr0509?.breakoutAvailable) breakoutHydrationAvailableCount += 1;
    if (a.hydrationAuditAdr0509?.rsScoreUsable) rsScoreUsableCount += 1;
    if (a.hydrationAuditAdr0509?.breakoutScoreUsable) breakoutScoreUsableCount += 1;
    if (a.hydrationAuditAdr0509?.rsSource) rsSourceDistribution[a.hydrationAuditAdr0509.rsSource] += 1;
    if (a.hydrationAuditAdr0509?.breakoutSource) breakoutSourceDistribution[a.hydrationAuditAdr0509.breakoutSource] += 1;
    for (const reason of a.hydrationAuditAdr0509?.rsMissingReasons ?? []) rsMissingReasonDistribution[reason] += 1;
    for (const reason of a.hydrationAuditAdr0509?.breakoutMissingReasons ?? []) breakoutMissingReasonDistribution[reason] += 1;
    for (const field of a.hydrationAuditAdr0509?.missingFields ?? []) {
      hydrationMissingFieldCounts[field] = (hydrationMissingFieldCounts[field] ?? 0) + 1;
    }
    for (const field of a.hydrationAuditAdr0509?.rsMissingFields ?? []) {
      rsMissingFieldCounts[field] = (rsMissingFieldCounts[field] ?? 0) + 1;
    }
    for (const field of a.hydrationAuditAdr0509?.breakoutMissingFields ?? []) {
      breakoutMissingFieldCounts[field] = (breakoutMissingFieldCounts[field] ?? 0) + 1;
    }
    if (a.hydrationAuditAdr0509?.candidateTraceHasQuote) candidateTraceHasQuote += 1;
    if (a.hydrationAuditAdr0509?.candidateTraceHasSymbolFeatures) candidateTraceHasSymbolFeatures += 1;
    if (a.hydrationAuditAdr0509?.candidateTraceHasConditionResults) candidateTraceHasConditionResults += 1;
    if (a.sectorEnergyAudit.strongBuyAllowed === false) sectorEnergyStrongBuyBlockedCount += 1;
    // 사용자 명시 — SectorEnergy hardBlock 절대 금지. 본 카운터는 *항상* 0 이어야 함.
    if (a.sectorEnergyAudit.executionImpact === 'HARD_BLOCK') {
      sectorEnergyHardBlockCount += 1;
    }
  }

  return {
    totalCandidates,
    failedCandidates,
    evaluationState: resolveGate1EvaluationStateAdr0510({
      totalCandidates,
      traceWithQuoteCount: candidateTraceHasQuote,
      traceWithSymbolFeaturesCount: candidateTraceHasSymbolFeatures,
      traceWithConditionResultsCount: candidateTraceHasConditionResults,
      minSignalScoreTraceAvailableCount: totalCandidates,
      buyListLoopEntered: totalCandidates > 0,
      gateEvaluationOutputAvailableCount: candidateTraceHasConditionResults,
    }),
    evaluatedCandidateCount: candidateTraceHasConditionResults,
    traceOnlyCandidateCount: Math.max(0, totalCandidates - candidateTraceHasConditionResults),
    buyListLoopEntered: totalCandidates > 0,
    perSymbolEvaluationEntered: totalCandidates > 0,
    gateEvaluationOutputAvailableCount: candidateTraceHasConditionResults,
    minSignalScoreTraceAvailableCount: totalCandidates,
    requiredScoreAvg: round1(requiredScoreAvg),
    actualScoreAvg: round1(actualScoreAvg),
    avgScoreGap: round1(avgScoreGap),
    dominantFailureDistribution,
    missingPositiveSourceCounts,
    penaltyCounts,
    supplyScopeWarnings,
    supplySymbolMatchedCount,
    rsHydrationAvailableCount,
    breakoutHydrationAvailableCount,
    rsMissingReasonDistribution,
    breakoutMissingReasonDistribution,
    topHydrationMissingFields: Object.entries(hydrationMissingFieldCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([field]) => field),
    candidateTraceHasQuote,
    candidateTraceHasSymbolFeatures,
    candidateTraceHasConditionResults,
    watchlistSourceAvailableCount,
    watchlistSourceFieldDistribution,
    watchlistScoreImportedCount,
    watchlistMissingReasonTop: Object.entries(watchlistMissingReasonCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([reason]) => reason),
    rsTraceAvailableCount: rsHydrationAvailableCount,
    rsScoreUsableCount,
    rsMissingFieldsTop: Object.entries(rsMissingFieldCounts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([field]) => field),
    rsSourceDistribution,
    rsConditionStatusDistribution,
    breakoutTraceAvailableCount: breakoutHydrationAvailableCount,
    breakoutScoreUsableCount,
    breakoutMissingFieldsTop: Object.entries(breakoutMissingFieldCounts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([field]) => field),
    breakoutSourceDistribution,
    breakoutConditionStatusDistribution,
    candidateSymbolAvailableCount,
    quoteSymbolAvailableCount,
    requestSymbolAvailableCount,
    providerSymbolAvailableCount,
    symbolMatchedCount: supplySymbolMatchedCount,
    inferredSymbolMatchedCount,
    symbolMissingCount,
    symbolMismatchCount,
    providerScopeDistribution,
    scoreUsage: 'SHADOW_ONLY',
    supplySemanticAvailable,
    supplyDiagnosticAvailable,
    semanticReasonDistribution,
    foreignNetBuyAvailable,
    institutionalNetBuyAvailable,
    zeroButMaterializedCount,
    kisRawFieldKeysTop,
    actualRawFieldKeysTop,
    actualNumericStringFieldKeysTop,
    actualNumberFieldKeysTop,
    actualPlaceholderFieldKeysTop,
    candidateNetBuyFieldKeysTop,
    selectedActualRawFieldKeysTop,
    selectedNumericStringFieldKeysTop,
    rejectedWrapperPathsTop,
    rowCandidateCount,
    selectedRowScoreAvg: selectedRowScoreCount > 0 ? selectedRowScoreSum / selectedRowScoreCount : 0,
    wrapperOnlyCount,
    numericCandidateCount,
    aliasCandidateCount,
    selectedPathTop,
    kisNormalizedFieldKeysTop,
    kisSemanticFieldKeysTop,
    semanticRowAvailableCount,
    semanticRowMetadataOnlyCount,
    rawInvestorRowAvailableCount,
    selectedCandidateCarriesSemanticRowCount,
    forensicInputCarriesSemanticRowCount,
    semanticRowBreakPointDistribution,
    sampleValueKindDistribution,
    mappedFieldDistribution,
    scoreUsageDistribution,
    supplyUnknownRootCauseDistribution,
    supplyRouterForensicConflict: supplyDiagnosticAvailable > 0 && supplySemanticAvailable === 0,
    routerStatus: supplyDiagnosticAvailable > 0 ? 'VERIFIED' : undefined,
    routerSignal: 'NEUTRAL',
    forensicSemanticAvailable: `${supplySemanticAvailable}/${totalCandidates}`,
    routerForensicConflictReason: supplyDiagnosticAvailable > 0 && supplySemanticAvailable === 0
      ? semanticReasonDistribution.STALE_ONLY > 0
        ? 'ROUTER_VERIFIED_BUT_SHADOW_ONLY_STALE'
        : semanticRowMetadataOnlyCount > 0
          ? 'ROUTER_VERIFIED_BUT_SELECTED_CANDIDATE_METADATA_ONLY'
          : Object.keys(semanticRowBreakPointDistribution).some((key) => key.includes('DROPPED') && semanticRowBreakPointDistribution[key] > 0)
            ? 'ROUTER_VERIFIED_BUT_SEMANTIC_ROW_DROPPED'
            : semanticReasonDistribution.FIELD_ALIAS_NOT_MAPPED > 0
              ? 'ROUTER_VERIFIED_BUT_FIELD_ALIAS_NOT_MAPPED'
              : semanticReasonDistribution.ONLY_MARKET_LEVEL_FLOW > 0 || semanticReasonDistribution.ONLY_SECTOR_LEVEL_FLOW > 0
                ? 'ROUTER_VERIFIED_BUT_MARKET_LEVEL_ONLY'
                : 'ROUTER_VERIFIED_BUT_SEMANTIC_FIELDS_MISSING'
      : undefined,
    shadowEligibleSupplyCount,
    candidateTraceCount: totalCandidates,
    traceWithQuoteCount: candidateTraceHasQuote,
    traceWithSymbolFeaturesCount: candidateTraceHasSymbolFeatures,
    traceWithConditionResultsCount: candidateTraceHasConditionResults,
    traceWithWatchlistScoreCount: watchlistScoreImportedCount,
    watchlistScoreScaleDistribution,
    watchlistScoreAvg: watchlistScoreImportedCount > 0 ? round1(watchlistScoreSum / watchlistScoreImportedCount) : 0,
    watchlistDiagnosticConflict: watchlistSourceAvailableCount !== watchlistScoreImportedCount || missingPositiveSourceCounts.watchlistUpstreamMissing > 0 && watchlistScoreImportedCount > 0,
    adr0467WatchlistVerifiedCount: watchlistSourceAvailableCount,
    adr0505WatchlistImportedCount: watchlistScoreImportedCount,
    conflictReason: watchlistSourceAvailableCount !== watchlistScoreImportedCount
      ? 'DIFFERENT_SOURCE_PATH'
      : missingPositiveSourceCounts.watchlistUpstreamMissing > 0 && watchlistScoreImportedCount > 0
        ? 'TRACE_FIELD_MISSING'
        : undefined,
    quoteFeatureAvailableCount,
    quoteMissingReasonTop: Object.entries(quoteMissingReasonCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([reason]) => reason),
    quoteFeatureFieldCoverage,
    conditionResultsAvailableCount,
    conditionResultsKeyCoverage,
    conditionResultStatusDistribution,
    breakoutConditionKeyCoverage,
    traceWithSupplyContextCount: audits.filter((a) => a.hydrationAuditAdr0509?.candidateTraceHasSupplyContext).length,
    traceWithMinSignalScoreTraceCount: audits.filter((a) => a.hydrationAuditAdr0509?.candidateTraceHasMinSignalScoreTrace).length,
    ...(totalCandidates > 0 && candidateTraceHasQuote === 0 && candidateTraceHasSymbolFeatures === 0 && candidateTraceHasConditionResults === 0
      ? { traceDominantFailureReason: 'TRACE_HYDRATION_MISSING' as const }
      : {}),
    sourcePathDistribution,
    sourcePathTopMissingFields: Object.fromEntries(Object.entries(sourcePathMissingFieldCounts).map(([source, counts]) => [
      source,
      Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([field]) => field),
    ])),
    sourcePathWithWatchlistScore,
    sourcePathWithQuote,
    sourcePathWithConditionResults,
    watchlistBreakPointDistribution,
    watchlistEntryScoreAvailable,
    stage2ScoreAvailable,
    promotionScoreAvailable,
    entryFilterTraceScoreAvailable,
    forensicInputScoreAvailable,
    quoteHydrationBreakPointDistribution,
    conditionResultsBreakPointDistribution,
    sectorEnergyStrongBuyBlockedCount,
    sectorEnergyHardBlockCount,
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    policyPromotionMode: 'SHADOW_ONLY',
  };
}

/* ───────── /scan_blockers compact section formatter SSOT ───────── */

/**
 * Telegram-safe compact line — 사용자 명시 형식 정확 정합.
 * 4000-char budget (ADR-0478) 차원에서 12~14 줄 한도 의무.
 * 빈 entries 시 null 반환 (잡음 차단).
 */
export function formatGate1MinimumSignalForensicSection(
  summary: Gate1MinimumSignalForensicSummaryAdr0505 | undefined,
): string | null {
  if (!summary || summary.totalCandidates === 0) return null;

  const lines: string[] = [];
  lines.push('🧬 Gate1 Minimum Signal Forensic (ADR-0505)');
  lines.push(`- evaluationState=${summary.evaluationState} evaluated=${summary.evaluatedCandidateCount}/${summary.totalCandidates} traceOnly=${summary.traceOnlyCandidateCount}`);
  if (summary.evaluationState === 'EVALUATED') {
    lines.push(`- candidates=${summary.totalCandidates} failed=${summary.failedCandidates}`);
    lines.push(
      `- requiredAvg=${summary.requiredScoreAvg.toFixed(1)} actualAvg=${summary.actualScoreAvg.toFixed(1)} gap=${summary.avgScoreGap.toFixed(1)}`,
    );
  } else {
    lines.push(`- candidates=${summary.totalCandidates} failed=n/a (not live failure)`);
    lines.push(`- minScore=n/a diagnosticFallback=${summary.actualScoreAvg.toFixed(1)}`);
  }

  // dominant — failed > 0 일 때만 표시
  if (summary.failedCandidates > 0) {
    const dominant = pickTopDominant(summary.dominantFailureDistribution);
    if (dominant) lines.push(`- dominant=${dominant}`);
  }

  // missing — 1개 이상일 때만 표시
  const m = summary.missingPositiveSourceCounts;
  const missingParts: string[] = [];
  if (m.watchlistUpstreamMissing > 0) missingParts.push(`watchlist=${m.watchlistUpstreamMissing}`);
  if (m.relativeStrengthMissing > 0) missingParts.push(`rs=${m.relativeStrengthMissing}`);
  if (m.breakoutStructureMissing > 0) missingParts.push(`breakout=${m.breakoutStructureMissing}`);
  if (missingParts.length > 0) lines.push(`- missing: ${missingParts.join(' ')}`);

  // penalties — 1개 이상일 때만 표시
  const p = summary.penaltyCounts;
  const penaltyParts: string[] = [];
  if (p.supplyUnknownPenalty > 0) penaltyParts.push(`supplyUnknown=${p.supplyUnknownPenalty}`);
  if (p.investorFlowUnknownPenalty > 0) penaltyParts.push(`investorUnknown=${p.investorFlowUnknownPenalty}`);
  if (p.sectorEnergyPenaltyOrBlocked > 0) penaltyParts.push(`sectorBlocked=${p.sectorEnergyPenaltyOrBlocked}`);
  if (penaltyParts.length > 0) lines.push(`- penalties: ${penaltyParts.join(' ')}`);

  // supplyScopeWarnings — 1개 이상일 때만 표시
  const w = summary.supplyScopeWarnings;
  const warnParts: string[] = [];
  if (w.KIS_FLOW_SYMBOL_MISSING > 0) warnParts.push(`symbolMissing=${w.KIS_FLOW_SYMBOL_MISSING}`);
  if (w.KIS_FLOW_SYMBOL_MISMATCH > 0) warnParts.push(`mismatch=${w.KIS_FLOW_SYMBOL_MISMATCH}`);
  if (w.KIS_FLOW_SEMANTIC_UNAVAILABLE > 0) warnParts.push(`semanticUnavailable=${w.KIS_FLOW_SEMANTIC_UNAVAILABLE}`);
  if (w.POSSIBLE_MARKET_WIDE_FLOW_IN_SYMBOL_SLOT > 0) {
    warnParts.push(`marketWide=${w.POSSIBLE_MARKET_WIDE_FLOW_IN_SYMBOL_SLOT}`);
  }
  if (warnParts.length > 0) lines.push(`- supplyScopeWarnings: ${warnParts.join(' ')}`);

  lines.push(
    `- supplySemantic: available=${summary.supplySemanticAvailable ?? 0}/${summary.totalCandidates} diagnosticAvailable=${summary.supplyDiagnosticAvailable ?? 0}/${summary.totalCandidates}`,
  );
  lines.push(
    `- supplySemanticFields: foreignField=${summary.foreignNetBuyAvailable ?? 0}/${summary.totalCandidates} institutionField=${summary.institutionalNetBuyAvailable ?? 0}/${summary.totalCandidates} zeroButMaterialized=${summary.zeroButMaterializedCount ?? 0}`,
  );
  lines.push(`- semanticRowAvailable: ${summary.semanticRowAvailableCount ?? 0}/${summary.totalCandidates}`);
  lines.push(`- semanticRowMetadataOnly: ${summary.semanticRowMetadataOnlyCount ?? 0}/${summary.totalCandidates}`);
  lines.push(`- rawInvestorRowAvailable: ${summary.rawInvestorRowAvailableCount ?? 0}/${summary.totalCandidates}`);
  lines.push(`- selectedCandidateCarriesSemanticRow: ${summary.selectedCandidateCarriesSemanticRowCount ?? 0}/${summary.totalCandidates}`);
  lines.push(`- forensicInputCarriesSemanticRow: ${summary.forensicInputCarriesSemanticRowCount ?? 0}/${summary.totalCandidates}`);
  if (summary.semanticReasonDistribution) lines.push(`- semanticReasonDistribution: ${formatDistribution(summary.semanticReasonDistribution)}`);
  if (summary.kisRawFieldKeysTop) lines.push(`- kisRawFieldKeysTop: ${formatDistribution(summary.kisRawFieldKeysTop)}`);
  lines.push('- Supply Semantic Unwrap:');
  lines.push(`  - unwrapRows: ${Object.values(summary.selectedPathTop ?? {}).reduce((sum, count) => sum + count, 0)}/${summary.totalCandidates}`);
  lines.push(`  - rowCandidateCount: ${summary.rowCandidateCount ?? 0}`);
  lines.push(`  - selectedRowScore: ${(summary.selectedRowScoreAvg ?? 0).toFixed(1)}`);
  if (summary.selectedPathTop) lines.push(`  - selectedPathTop: ${formatDistribution(summary.selectedPathTop)}`);
  if (summary.actualNumericStringFieldKeysTop) lines.push(`  - actualNumericStringFieldKeysTop: ${formatDistribution(summary.actualNumericStringFieldKeysTop)}`);
  if (summary.actualRawFieldKeysTop) lines.push(`  - actualRawFieldKeysTop: ${formatDistribution(summary.actualRawFieldKeysTop)}`);
  if (summary.selectedActualRawFieldKeysTop) lines.push(`  - selectedActualRawFieldKeysTop: ${formatDistribution(summary.selectedActualRawFieldKeysTop)}`);
  if (summary.selectedNumericStringFieldKeysTop) lines.push(`  - selectedNumericStringFieldKeysTop: ${formatDistribution(summary.selectedNumericStringFieldKeysTop)}`);
  if (summary.actualNumberFieldKeysTop) lines.push(`  - actualNumberFieldKeysTop: ${formatDistribution(summary.actualNumberFieldKeysTop)}`);
  if (summary.actualPlaceholderFieldKeysTop) lines.push(`  - actualPlaceholderFieldKeysTop: ${formatDistribution(summary.actualPlaceholderFieldKeysTop)}`);
  if (summary.candidateNetBuyFieldKeysTop) lines.push(`  - candidateNetBuyFieldKeysTop: ${formatDistribution(summary.candidateNetBuyFieldKeysTop)}`);
  if (summary.rejectedWrapperPathsTop) lines.push(`  - rejectedWrapperPathsTop: ${formatDistribution(summary.rejectedWrapperPathsTop)}`);
  lines.push(`  - wrapperOnlyCount: ${summary.wrapperOnlyCount ?? 0}`);
  lines.push(`  - numericCandidateCount: ${summary.numericCandidateCount ?? 0}`);
  lines.push(`  - aliasCandidateCount: ${summary.aliasCandidateCount ?? 0}`);
  if (summary.semanticRowBreakPointDistribution) lines.push(`  - semanticRowBreakPointDistribution: ${formatDistribution(summary.semanticRowBreakPointDistribution)}`);
  lines.push(`  - semanticAvailable: ${summary.supplySemanticAvailable ?? 0}/${summary.totalCandidates}`);
  lines.push(`  - zeroButMaterialized: ${summary.zeroButMaterializedCount ?? 0}`);
  lines.push(`  - nextAction: ${resolveSupplySemanticUnwrapNextAction(summary)}`);
  if (summary.kisNormalizedFieldKeysTop) lines.push(`- kisNormalizedFieldKeysTop: ${formatDistribution(summary.kisNormalizedFieldKeysTop)}`);
  if (summary.kisSemanticFieldKeysTop) lines.push(`- kisSemanticFieldKeysTop: ${formatDistribution(summary.kisSemanticFieldKeysTop)}`);
  if (summary.semanticRowBreakPointDistribution) lines.push(`- semanticRowBreakPointDistribution: ${formatDistribution(summary.semanticRowBreakPointDistribution)}`);
  if (summary.sampleValueKindDistribution) lines.push(`- sampleValueKinds: ${formatDistribution(summary.sampleValueKindDistribution)}`);
  if (summary.mappedFieldDistribution) {
    lines.push(`- mappedFieldDistribution: foreign=${formatDistribution(summary.mappedFieldDistribution.foreign)} institution=${formatDistribution(summary.mappedFieldDistribution.institution)} individual=${formatDistribution(summary.mappedFieldDistribution.individual)}`);
  }
  if (summary.providerScopeDistribution) lines.push(`- providerScopeDistribution: ${formatDistribution(summary.providerScopeDistribution)}`);
  if (summary.scoreUsageDistribution) lines.push(`- scoreUsageDistribution: ${formatDistribution(summary.scoreUsageDistribution)}`);
  if (summary.supplyUnknownRootCauseDistribution) lines.push(`- supplyUnknownRootCause: ${formatDistribution(summary.supplyUnknownRootCauseDistribution)}`);
  lines.push(
    `- supplyRouterForensicConflict=${summary.supplyRouterForensicConflict === true} routerStatus=${summary.routerStatus ?? 'UNKNOWN'} routerSignal=${summary.routerSignal ?? 'UNKNOWN'} forensicSemanticAvailable=${summary.forensicSemanticAvailable ?? `${summary.supplySemanticAvailable ?? 0}/${summary.totalCandidates}`} conflictReason=${summary.routerForensicConflictReason ?? 'NONE'}`,
  );

  lines.push(`- watchlistImported: ${summary.watchlistScoreImportedCount ?? 0}/${summary.totalCandidates}`);
  lines.push(`- rsScoreUsable: ${summary.rsScoreUsableCount ?? summary.rsHydrationAvailableCount ?? 0}/${summary.totalCandidates}`);
  lines.push(`- breakoutScoreUsable: ${summary.breakoutScoreUsableCount ?? summary.breakoutHydrationAvailableCount ?? 0}/${summary.totalCandidates}`);
  lines.push(`- supplySymbolMatched: ${summary.symbolMatchedCount ?? summary.supplySymbolMatchedCount ?? 0}/${summary.totalCandidates}`);
  lines.push(`- supplySymbolInferred: ${summary.inferredSymbolMatchedCount ?? 0}/${summary.totalCandidates}`);
  lines.push(
    `- traceCompleteness: quote ${summary.traceWithQuoteCount ?? summary.candidateTraceHasQuote ?? 0}/${summary.totalCandidates}, symbolFeatures ${summary.traceWithSymbolFeaturesCount ?? summary.candidateTraceHasSymbolFeatures ?? 0}/${summary.totalCandidates}, conditionResults ${summary.traceWithConditionResultsCount ?? summary.candidateTraceHasConditionResults ?? 0}/${summary.totalCandidates}`,
  );
  const topHydrationMissingFields = summary.topHydrationMissingFields ?? [];
  if (topHydrationMissingFields.length > 0) {
    lines.push(`- topMissingFields: ${topHydrationMissingFields.slice(0, 4).join(', ')}`);
  }
  lines.push(`- rsTraceAvailable: ${summary.rsTraceAvailableCount ?? summary.rsHydrationAvailableCount ?? 0}/${summary.totalCandidates}`);
  lines.push(`- breakoutTraceAvailable: ${summary.breakoutTraceAvailableCount ?? summary.breakoutHydrationAvailableCount ?? 0}/${summary.totalCandidates}`);
  if (summary.watchlistSourceFieldDistribution) {
    lines.push(`- watchlistSourceFieldDistribution: ${formatDistribution(summary.watchlistSourceFieldDistribution)}`);
  }
  if (summary.watchlistScoreScaleDistribution) {
    lines.push(`- watchlistScoreScaleDistribution: ${formatDistribution(summary.watchlistScoreScaleDistribution)}`);
  }
  lines.push(`- watchlistScoreAvg: ${(summary.watchlistScoreAvg ?? 0).toFixed(1)}`);
  lines.push(`- traceWithQuoteCount: ${summary.traceWithQuoteCount ?? summary.candidateTraceHasQuote ?? 0}/${summary.totalCandidates}`);
  lines.push(`- traceWithConditionResultsCount: ${summary.traceWithConditionResultsCount ?? summary.candidateTraceHasConditionResults ?? 0}/${summary.totalCandidates}`);
  if (summary.sourcePathDistribution) lines.push(`- sourcePathDistribution: ${formatDistribution(summary.sourcePathDistribution)}`);
  if (summary.watchlistBreakPointDistribution) lines.push(`- watchlistBreakPoint: ${formatDistribution(summary.watchlistBreakPointDistribution)}`);
  if (summary.quoteHydrationBreakPointDistribution) lines.push(`- quoteHydrationBreakPoint: ${formatDistribution(summary.quoteHydrationBreakPointDistribution)}`);
  if (summary.conditionResultsBreakPointDistribution) lines.push(`- conditionResultsBreakPoint: ${formatDistribution(summary.conditionResultsBreakPointDistribution)}`);
  lines.push(`- nextAction: ${resolveGate1ForensicNextAction(summary)}`);

  // SectorEnergy — 강제 노출 (운영자 인지 의무)
  lines.push(
    `- SectorEnergy: boost=0 strongBuyBlocked=${summary.sectorEnergyStrongBuyBlockedCount} hardBlock=${summary.sectorEnergyHardBlockCount}`,
  );
  lines.push('- executionImpact=NONE live=false');

  return lines.join('\n');
}

/* ───────── 보조 헬퍼 ───────── */

export function resolveGate1ForensicNextAction(summary: Gate1MinimumSignalForensicSummaryAdr0505): string {
  const total = summary.totalCandidates;
  const topSemanticReason = pickTopDistributionKey(summary.semanticReasonDistribution ?? {});
  if (topSemanticReason === 'SEMANTIC_ROW_METADATA_ONLY') return 'WIRE_KIS_SELECTED_CANDIDATE_SEMANTIC_ROW';
  if (topSemanticReason === 'ROUTER_DROPPED_SEMANTIC_ROW') return 'WIRE_KIS_SELECTED_CANDIDATE_SEMANTIC_ROW';
  if (topSemanticReason === 'FORENSIC_INPUT_DROPPED_SEMANTIC_ROW') return 'WIRE_KIS_SELECTED_CANDIDATE_SEMANTIC_ROW';
  if (topSemanticReason === 'FIELD_ALIAS_NOT_MAPPED') return 'MAP_KIS_NETBUY_FIELDS';
  if (topSemanticReason === 'NO_FOREIGN_OR_INSTITUTION_FIELD') return 'MAP_KIS_NETBUY_FIELDS';
  if (topSemanticReason === 'ROW_MAPPING_FAILED') return 'MAP_INVESTOR_TYPE_ROWS_TO_NETBUY';
  if (topSemanticReason === 'ONLY_MARKET_LEVEL_FLOW' || topSemanticReason === 'ONLY_SECTOR_LEVEL_FLOW') return 'REJECT_MARKET_LEVEL_FLOW_FOR_SYMBOL_SCORE';
  if ((summary.zeroButMaterializedCount ?? 0) > 0) return 'OBSERVE_ZERO_NEUTRAL_SUPPLY';
  if ((summary.watchlistScoreImportedCount ?? 0) === 0) return 'WIRE_WATCHLIST_UPSTREAM_SCORE';
  if ((summary.traceWithQuoteCount ?? summary.candidateTraceHasQuote ?? 0) === 0) return 'WIRE_QUOTE_FEATURES_TO_FORENSIC_TRACE';
  if ((summary.traceWithConditionResultsCount ?? summary.candidateTraceHasConditionResults ?? 0) === 0) return 'WIRE_CONDITION_RESULTS_TO_FORENSIC_TRACE';
  if ((summary.rsTraceAvailableCount ?? summary.rsHydrationAvailableCount ?? 0) === 0) return 'WIRE_RS_RETURN_FEATURES';
  if ((summary.breakoutTraceAvailableCount ?? summary.breakoutHydrationAvailableCount ?? 0) === 0) return 'WIRE_BREAKOUT_CONDITION_RESULTS';
  if ((summary.symbolMatchedCount ?? summary.supplySymbolMatchedCount ?? 0) === 0 && total > 0) return 'WIRE_SYMBOL_LEVEL_SUPPLY';
  return 'OBSERVE_3D_THEN_REVIEW';
}


function resolveSupplySemanticUnwrapNextAction(summary: Gate1MinimumSignalForensicSummaryAdr0505): string {
  const breakPoint = pickTopDistributionKey(summary.semanticRowBreakPointDistribution ?? {});
  if (breakPoint === 'NUMERIC_FIELDS_FOUND_BUT_NOT_RECOGNIZED' || breakPoint === 'NESTED_ROW_UNWRAPPED_BUT_ALIAS_NOT_MAPPED') return 'ADD_ALIAS_FOR_ACTUAL_NUMERIC_KEYS';
  if (breakPoint === 'ROW_ARRAY_FOUND_BUT_INVESTOR_TYPE_NOT_MAPPED') return 'MAP_INVESTOR_TYPE_ROWS';
  if (breakPoint === 'ONLY_WRAPPER_METADATA' || breakPoint === 'NO_ROW_FOUND') return 'WIRE_UNWRAPPED_ROW_TO_SEMANTIC_MAPPER';
  if ((summary.zeroButMaterializedCount ?? 0) > 0) return 'OBSERVE_ZERO_NEUTRAL_SUPPLY';
  return 'OBSERVE_ZERO_NEUTRAL_SUPPLY';
}

function pickTopDistributionKey(distribution: Record<string, number>): string | null {
  const top = Object.entries(distribution).filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1])[0];
  return top?.[0] ?? null;
}

function formatDistribution(distribution: Record<string, number>): string {
  return Object.entries(distribution)
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([key, value]) => `${key}=${value}`)
    .join(', ') || 'none';
}

function pickTopDominant(distribution: Record<DominantFailureReason, number>): DominantFailureReason | null {
  let top: DominantFailureReason | null = null;
  let topCount = 0;
  for (const [k, v] of Object.entries(distribution)) {
    if (v > topCount) {
      topCount = v;
      top = k as DominantFailureReason;
    }
  }
  return top;
}

function round1(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10) / 10;
}
