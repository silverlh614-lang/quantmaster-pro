/**
 * @responsibility ADR-0477 investor flow router schema surface.
 */

import type { NaverInvestorTrendCollectorResult } from '../naverInvestorTrendCollectorAdr0481.js';
import type { SemanticNetBuyNormalizationReportAdr0482, SemanticNetBuyProvider, SemanticNetBuySampleAdr0482, SemanticNetBuyStatus } from '../semanticNetBuyNormalizerAdr0482.js';
import type { FreshDataSupplyReportAdr0487, FreshDataSnapshotAdr0487 } from '../freshDataSupplyLayerAdr0487.js';
import type { SupplySnapshotCacheLookupAdr0491 } from '../supplySnapshotStoreReplayAdr0491.js';
import { normalizeInvestorFlowSnapshotKeyAdr0491, normalizeInvestorFlowSourceKeyAdr0491 as normalizeInvestorFlowSourceKeySharedAdr0491 } from '../investorFlowSnapshotKeyNormalizerAdr0491.js';
import {
  buildInvestorSampleDiagnosticsAdr0502,
  formatInvestorSampleDiagnosticsAdr0502,
  type InvestorSampleDiagnosticsAdr0502,
  type InvestorSampleProviderNameAdr0502,
} from '../investorSampleMaterializationAdr0502.js';
import { buildSanitizedInvestorFlowSemanticRow, hasActualInvestorNumericRow, normalizeNumberLikeInvestorFlowValue, unwrapInvestorFlowRows, type SanitizedInvestorFlowSemanticRow } from '../../../supply/investorFlowSemanticAvailability.js';

export type InvestorFlowProviderId =
  | 'KIS'
  | 'KIS_API'
  | 'KRX'
  | 'KRX_INVESTOR_FLOW'
  | 'KRX_SYMBOL_INVESTOR_FLOW'
  | 'KRX_MARKET_INVESTOR_FLOW'
  | 'NAVER'
  | 'NAVER_INVESTOR_TREND'
  | 'FSS'
  | 'FSS_PASSIVE_ACTIVE'
  | 'CACHE'
  | 'MANUAL'
  | 'SEMANTIC_NETBUY'
  | 'UNKNOWN'
  | 'NONE';

export type InvestorFlowProviderRoute =
  | 'investor_flow'
  | 'program_trading'
  | 'market_program'
  | 'foreign_trend'
  | 'short_balance'
  | 'credit_balance';

export type InvestorFlowProviderStatus =
  | 'VERIFIED'
  | 'READY_FOR_SHADOW'
  | 'OBSERVING'
  | 'DEGRADED'
  | 'PARTIAL'
  | 'STALE'
  | 'ACCEPTED_EMPTY'
  | 'CACHE_HIT'
  | 'CACHE_STALE_HIT'
  | 'CACHE_KEY_MISMATCH'
  | 'CACHE_EMPTY'
  | 'NOT_WIRED'
  | 'PROVIDER_MISMATCH'
  | 'DATA_UNAVAILABLE'
  | 'NON_TRADING_DAY'
  | 'ERROR'
  | 'EMPTY'
  | 'PARSE_ERROR'
  | 'PROVIDER_ERROR'
  | 'PROVIDER_EMPTY_RESPONSE'
  | 'QUARANTINED'
  | 'PARSER_KEY_MISMATCH'
  | 'PARSER_FIELD_MISMATCH'
  | 'MARKET_CLOSED_NO_PREVIOUS_SAMPLE'
  | 'DISABLED'
  | 'DISABLED_BY_KIS_FIRST_MODE'
  | 'DISABLED_BY_KIS_ONLY_MODE'
  | 'VERIFIED_ADAPTER_ONLY'
  | 'SEMANTIC_CARRY_FAILED'
  | 'REGISTRY_READY_NOT_MATERIALIZED'
  | 'NO_INPUT_SAMPLE'
  | 'MATERIALIZED_SAMPLE'
  | 'STALE_SAMPLE'
  | 'UNKNOWN';

export type SemanticSupplySignal =
  | 'BULLISH'
  | 'NEUTRAL'
  | 'BEARISH'
  | 'UNKNOWN';

export type InvestorFlowFlatRowForGateAdr0513 = {
  foreignNetBuy: number | null;
  institutionNetBuy: number | null;
  programNetBuy: number | null;
  _source: 'ROUTER_EXTRACTED';
};

export type InvestorRowMaterializationClass =
  | 'ACTUAL_NUMERIC_ROW'
  | 'NORMALIZED_NUMERIC_ROW'
  | 'NORMALIZED_METADATA_ONLY'
  | 'SEMANTIC_METADATA_ONLY'
  | 'WRAPPER_ONLY'
  | 'MISSING';

export interface SupplyProviderCapability {
  provider: InvestorFlowProviderId;
  supportsInvestorFlow: boolean;
  supportsProgramTrading: boolean;
  supportsMarketProgram: boolean;
  supportsForeignTrend: boolean;
  supportsShortBalance: boolean;
  supportsCreditBalance: boolean;
  isSemanticNetBuyProvider: boolean;
  notes: string[];
}

export interface SemanticNetBuySample {
  code: string;
  source: InvestorFlowProviderId;
  sourceDate: string | null;
  collectedAt: string;
  foreignNetBuy: number | null;
  institutionNetBuy: number | null;
  programNetBuy: number | null;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  status: InvestorFlowProviderStatus;
  signal: SemanticSupplySignal;
  diagnostics: string[];
}

export interface InvestorFlowProviderRouteResult {
  code: string;
  route: 'investor_flow';
  requestSymbol?: string | null;
  candidateSymbol?: string | null;
  quoteSymbol?: string | null;
  providerSymbol?: string | null;
  normalizedSymbol?: string | null;
  providerScope?: 'SYMBOL_LEVEL' | 'MARKET_LEVEL' | 'SECTOR_LEVEL' | 'UNKNOWN';
  routePurpose?: string;
  materialized?: boolean;
  usableForRouter?: boolean;
  usableForGate?: false;
  usableForLive?: false;
  usableForShadow?: true;
  scoreUsage?: 'SHADOW_ONLY';
  inferredSymbolMatched?: boolean;
  selectedProvider: InvestorFlowProviderId;
  providerTried: InvestorFlowProviderId[];
  providerReasons: Record<string, string>;
  providerStatuses: Record<string, InvestorFlowProviderStatus>;
  semanticNetBuy: SemanticNetBuySample | null;
  semanticRow?: SanitizedInvestorFlowSemanticRow | null;
  gateSemanticFlatRow?: InvestorFlowFlatRowForGateAdr0513 | null;
  actualInvestorRow?: Record<string, unknown> | null;
  normalizedInvestorRow?: Record<string, unknown> | null;
  semanticInvestorRow?: SanitizedInvestorFlowSemanticRow | Record<string, unknown> | null;
  supplySemanticRow?: SanitizedInvestorFlowSemanticRow | Record<string, unknown> | null;
  actualRowAvailable?: boolean;
  normalizedRowAvailable?: boolean;
  semanticRowAvailable?: boolean;
  rowCarryPath?: 'ADAPTER_TO_ROUTER' | 'NONE';
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
   * CORE 결정 (selectedProvider) 무영향 — diagnostic / SHADOW_SCORE 전용. executionImpact='NONE'.
   */
  adapterRowsForwardedAcrossProviders?: boolean;
  /**
   * INVESTOR-FLOW-ACTUAL-ROW-CARRY-WIRING-001 — adapter actual row 를
   * selectedProvider 와 무관하게 carry (selectedProvider==='NONE' 포함).
   * DIAGNOSTIC_ONLY scope — executionImpact='NONE', liveExecutionAllowed=false.
   */
  diagnosticActualInvestorRow?: Record<string, unknown> | null;
  /**
   * selectedProvider 가 actualRowProvider 와 일치할 때만 set.
   * NONE / 불일치 시 null — CORE 결정 입력 아님.
   */
  selectedProviderActualInvestorRow?: Record<string, unknown> | null;
  actualInvestorRowProvider?: 'KIS_API' | 'NAVER_INVESTOR_TREND' | 'UNKNOWN' | null;
  actualInvestorRowUseScope?: 'SELECTED_PROVIDER' | 'DIAGNOSTIC_ONLY' | 'SHADOW_SCORE' | 'GATE_SCORE_ELIGIBLE';
  investorRowMaterializationClass?: InvestorRowMaterializationClass;
  diagnosticActualInvestorRowFromNormalized?: boolean;
  selectedCandidate?: InvestorFlowMaterializedCandidateAdr0503 | null;
  bySymbol?: Record<string, InvestorFlowProviderRouteBySymbolPayloadAdr0477>;
  selectedActualRowPath?: string | null;
  selectedActualRowFieldKeys?: string[];
  selectedActualNumericFieldKeys?: string[];
  selectedActualNumericStringFieldKeys?: string[];
  selectedActualPlaceholderFieldKeys?: string[];
  kisRawRowAvailableAtAdapter?: boolean;
  kisNormalizedRowAvailableAtRouter?: boolean;
  kisSelectedCandidateCarriesSemanticRow?: boolean;
  semanticRowBreakPoint?: 'ADAPTER_DID_NOT_RETURN_RAW_ROW' | 'ROUTER_DROPPED_RAW_ROW' | 'SELECTED_CANDIDATE_METADATA_ONLY' | 'FORENSIC_INPUT_DROPPED_SEMANTIC_ROW' | 'FIELD_ALIAS_NOT_MAPPED' | 'ONLY_WRAPPER_METADATA' | 'NESTED_ROW_UNWRAPPED_BUT_ALIAS_NOT_MAPPED' | 'NUMERIC_FIELDS_FOUND_BUT_NOT_RECOGNIZED' | 'ROW_ARRAY_FOUND_BUT_INVESTOR_TYPE_NOT_MAPPED' | 'FIELD_ALIAS_MAPPED' | 'NO_ROW_FOUND' | 'ADAPTER_DID_NOT_ATTACH_ACTUAL_ROW' | 'ROUTER_SELECTED_CANDIDATE_DROPPED_ACTUAL_ROW' | 'FORENSIC_COLLECTOR_DROPPED_ACTUAL_ROW' | 'ACTUAL_ROW_CARRIED_BUT_EMPTY' | 'ACTUAL_ROW_CARRIED_WITH_FIELDS' | 'ACTUAL_ROW_CARRIED_ALIAS_NOT_MAPPED' | 'UNKNOWN';
  status: InvestorFlowProviderStatus;
  signal: SemanticSupplySignal;
  coverage: {
    available: number;
    total: number;
    missing: number;
    stale: number;
    acceptedEmpty: number;
    providerMismatch: number;
    notWired: number;
  };
  freshness: {
    cacheState: 'FRESH' | 'STALE' | 'EMPTY' | 'UNKNOWN';
    sourceState: 'FRESH' | 'STALE' | 'MISSING' | 'UNKNOWN';
    sourceAgeTradingDays: number | null;
    oldestSourceAgeTradingDays: number | null;
    lastSourceDate: string | null;
  };
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  policyPromotionMode: 'SHADOW_ONLY';
  operatorApprovalRequired: true;
  selectedReason: string | null;
  rawPayloadPersistenceAllowed: false;
  inputSources?: InvestorFlowProviderId[];
  cacheFallbackUsed?: boolean;
  semanticInputStatus?: InvestorFlowProviderStatus;
  naverSampleStatus?: InvestorFlowProviderStatus;
  naverReadinessKind?: string;
  semanticReadinessKind?: string;
  selectedFreshness?: 'FRESH' | 'STALE' | 'MISSING' | 'UNKNOWN';
  selectedConfidence?: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  routerUsableCoverage?: {
    available: number;
    total: number;
  };
  diagnosticUsableCoverage?: {
    available: number;
    total: number;
  };
  selectedDiagnosticProvider?: InvestorFlowProviderId | null;
  selectedDiagnosticReason?: string | null;
  selectedForLive?: false;
  selectedForShadow?: boolean;
  kisFirstMode?: boolean;
  dryRunLane?: 'LEGACY_DIAGNOSTIC';
  usedForCurrentGate?: false;
  usedForLiveDecision?: false;
  fallbackProvider?: InvestorFlowProviderId | null;
  fallbackStatus?: InvestorFlowProviderStatus | null;
  fallbackDiagnosticOnly?: boolean;
  legacyDryRunSummary?: string | null;
  krxSourceRepairDiagnostic?: {
    parserStatus?: string;
    endpointIssueHint?: string;
    selectedKrxFlowMode?: string;
    payloadMode?: string;
    routePurpose?: string;
    selectedBld?: string;
    requiredParamMissing?: string | null;
    shortCodeToIsuCdResolved?: boolean;
    isuCd?: string | null;
    inqTpCd?: string | null;
    inqVal?: string | null;
    detailView?: string | null;
    tradeDate?: string;
    previousTradingDateCandidate?: string;
    selectedVariant?: string | null;
    otpGenerated?: boolean;
    csvDownloaded?: boolean;
    csvRowCount?: number;
    csvHeaderDetected?: boolean;
    csvNoDataReason?: string | null;
    omittedKeys?: readonly string[];
    forbiddenKeysPresent?: readonly string[];
    requiredKeysPresent?: readonly string[];
    requiredKeysMissing?: readonly string[];
    sentPayloadKeys?: readonly string[];
    contentType?: string;
    responseKind?: string;
    consecutiveFailures?: number;
    cooldownActive?: boolean;
    cooldownRemainingMs?: number;
    offHoursSuppressed?: boolean;
    diagnosticOnly?: boolean;
    useForRouter?: boolean;
    useForGate?: boolean;
    useForLive?: boolean;
    useForShadow?: boolean;
    selectedRowCount?: number;
    normalizedRows?: number;
    summary?: string;
  } | null;
  materializationDiagnostics?: Partial<Record<InvestorSampleProviderNameAdr0502, InvestorSampleDiagnosticsAdr0502>>;
  rejectedProviders?: InvestorFlowProviderId[];
  rejectedReasonByProvider?: Record<string, string>;
  fallbackChain?: InvestorFlowProviderId[];
  cacheFallbackReason?: string | null;
  staleButSelectedReason?: string | null;
  coverageBefore?: number;
  coverageAfter?: number;
  diagnosticUsableCount?: number;
  noMaterializedCandidateReason?: string | null;
  diagnostics: string[];
}

export interface InvestorFlowProviderRouterInput {
  code: string;
  collectedAt?: string;
  naverCollectorWired?: boolean;
  naverRaw?: Record<string, unknown> | null;
  naverCollectorResultAdr0481?: NaverInvestorTrendCollectorResult | null;
  semanticNetBuyNormalizationAdr0482?: SemanticNetBuyNormalizationReportAdr0482 | null;
  cacheRaw?: Record<string, unknown> | null;
  previousTradingDayCacheRaw?: Record<string, unknown> | null;
  kisInvestorRaw?: Record<string, unknown> | null;
  krxInvestorRaw?: Record<string, unknown> | null;
  previousTradingDayKrxRaw?: Record<string, unknown> | null;
  krxInvestorDiagnosticAdr0505?: {
    status?: 'DISABLED_BY_KIS_FIRST_MODE';
    provider?: 'KRX';
    providerIssue?: boolean;
    marketSignal?: boolean;
    executionImpact?: 'NONE';
    parserStatus?: string;
    endpointIssueHint?: string;
    endpoint?: string;
    bld?: string;
    tradeDate?: string;
    previousTradingDateCandidate?: string;
    selectedKrxFlowMode?: string;
    payloadMode?: string;
    routePurpose?: string;
    selectedBld?: string;
    requiredParamMissing?: string | null;
    shortCodeToIsuCdResolved?: boolean;
    isuCd?: string | null;
    inqTpCd?: string | null;
    inqVal?: string | null;
    detailView?: string | null;
    endpointVariant?: string;
    dateParam?: string;
    marketCode?: string | null;
    symbolCode?: string | null;
    parameterKeys?: readonly string[];
    attemptedVariants?: readonly string[];
    selectedVariant?: string | null;
    otpGenerated?: boolean;
    otpLength?: number;
    csvDownloaded?: boolean;
    csvRowCount?: number;
    csvColumnKeys?: readonly string[];
    csvFailureReason?: string | null;
    csvHeaderDetected?: boolean;
    csvNoDataReason?: string | null;
    omittedKeys?: readonly string[];
    forbiddenKeysPresent?: readonly string[];
    requiredKeysPresent?: readonly string[];
    requiredKeysMissing?: readonly string[];
    sentPayloadKeys?: readonly string[];
    contentType?: string;
    httpStatus?: number | null;
    responseKind?: string;
    consecutiveFailures?: number;
    cooldownActive?: boolean;
    cooldownRemainingMs?: number;
    offHoursSuppressed?: boolean;
    diagnosticOnly?: boolean;
    useForRouter?: boolean;
    useForGate?: boolean;
    useForLive?: boolean;
    useForShadow?: boolean;
    rawTopLevelKeys?: readonly string[];
    detectedCandidatePaths?: readonly string[];
    selectedRowPath?: string | null;
    selectedRowCount?: number;
    firstRowKeys?: readonly string[];
    normalizedRows?: number;
    fieldMappings?: Record<string, string | null>;
    summary?: string;
  } | null;
  fssPassiveActiveRaw?: Record<string, unknown> | null;
  kisTriedForInvestorFlow?: boolean;
  nonTradingDay?: boolean;
  sourceAgeTradingDays?: number | null;
  cacheAgeTradingDays?: number | null;
  marketProgramStatus?: InvestorFlowProviderStatus;
  fssSourceAgeTradingDays?: number | null;
  freshDataSupplyAdr0487?: FreshDataSupplyReportAdr0487 | null;
  supplySnapshotCacheLookupAdr0491?: SupplySnapshotCacheLookupAdr0491 | null;
}

export type InvestorFlowMaterializedSourceKindAdr0503 =
  | 'KIS_SYMBOL_INVESTOR_FLOW'
  | 'KRX_SYMBOL_INVESTOR_FLOW'
  | 'KRX_MARKET_INVESTOR_FLOW'
  | 'KRX_PREVIOUS_TRADING_DATE'
  | 'NAVER_PREVIOUS_TRADING_DATE'
  | 'FSS_STALE_DIAGNOSTIC'
  | 'CACHE_SANITIZED_SNAPSHOT'
  | 'SEMANTIC_DERIVED';

export type InvestorFlowProviderRouteBySymbolPayloadAdr0477 = Pick<InvestorFlowProviderRouteResult,
  | 'code'
  | 'requestSymbol'
  | 'candidateSymbol'
  | 'quoteSymbol'
  | 'providerSymbol'
  | 'normalizedSymbol'
  | 'providerScope'
  | 'routePurpose'
  | 'materialized'
  | 'usableForRouter'
  | 'usableForGate'
  | 'usableForLive'
  | 'usableForShadow'
  | 'selectedProvider'
  | 'semanticRow'
  | 'gateSemanticFlatRow'
  | 'actualInvestorRow'
  | 'normalizedInvestorRow'
  | 'semanticInvestorRow'
  | 'supplySemanticRow'
  | 'actualRowAvailable'
  | 'normalizedRowAvailable'
  | 'semanticRowAvailable'
  | 'rowCarryPath'
  | 'sanitizedInvestorFlowRows'
  | 'actualInvestorFlowRows'
  | 'actualInvestorFlowRowCount'
  | 'actualInvestorFlowRowSourcePath'
  | 'actualInvestorFlowFieldKeys'
  | 'actualInvestorFlowNumericKeys'
  | 'actualInvestorFlowNumericStringKeys'
  | 'actualInvestorFlowCarried'
  | 'adapterRowsForwardedAcrossProviders'
  | 'diagnosticActualInvestorRow'
  | 'selectedProviderActualInvestorRow'
  | 'actualInvestorRowProvider'
  | 'actualInvestorRowUseScope'
  | 'investorRowMaterializationClass'
  | 'diagnosticActualInvestorRowFromNormalized'
  | 'selectedCandidate'
  | 'selectedActualRowPath'
  | 'selectedActualRowFieldKeys'
  | 'selectedActualNumericFieldKeys'
  | 'selectedActualNumericStringFieldKeys'
  | 'selectedActualPlaceholderFieldKeys'
  | 'kisRawRowAvailableAtAdapter'
  | 'kisNormalizedRowAvailableAtRouter'
  | 'kisSelectedCandidateCarriesSemanticRow'
  | 'semanticRowBreakPoint'
  | 'status'
  | 'signal'
  | 'executionImpact'
  | 'liveExecutionAllowed'
  | 'scoreUsage'
>;

export interface InvestorFlowMaterializedCandidateAdr0503 {
  provider: InvestorFlowProviderId;
  sourceKind: InvestorFlowMaterializedSourceKindAdr0503;
  sourceDate: string | null;
  rawCount: number;
  normalizedCount: number;
  materializedCount: number;
  sampleMaterialized: boolean;
  usableForRouter: boolean;
  usableForShadow: boolean;
  confidence: SemanticNetBuySample['confidence'];
  freshness: 'FRESH' | 'STALE' | 'MISSING' | 'UNKNOWN';
  blockedReason: InvestorSampleDiagnosticsAdr0502['blockedReason'];
  placeholderDetected: boolean;
  inputSourceKind: InvestorSampleDiagnosticsAdr0502['inputSourceKind'];
  selectedPriority: number;
  selectionReason: string;
  actualInvestorFlowRows?: Array<Record<string, unknown>>;
  actualInvestorFlowRowCount?: number;
  actualInvestorFlowRowSourcePath?: string | null;
  actualInvestorFlowFieldKeys?: string[];
  actualInvestorFlowNumericKeys?: string[];
  actualInvestorFlowNumericStringKeys?: string[];
  actualInvestorFlowCarried?: boolean;
  actualInvestorRow?: Record<string, unknown> | null;
  normalizedInvestorRow?: Record<string, unknown> | null;
  semanticInvestorRow?: SanitizedInvestorFlowSemanticRow | Record<string, unknown> | null;
  supplySemanticRow?: SanitizedInvestorFlowSemanticRow | Record<string, unknown> | null;
  actualRowAvailable?: boolean;
  normalizedRowAvailable?: boolean;
  semanticRowAvailable?: boolean;
  rowCarryPath?: 'ADAPTER_TO_ROUTER' | 'NONE';
  diagnosticActualInvestorRow?: Record<string, unknown> | null;
  selectedProviderActualInvestorRow?: Record<string, unknown> | null;
  actualInvestorRowProvider?: 'KIS_API' | 'NAVER_INVESTOR_TREND' | 'UNKNOWN' | null;
  actualInvestorRowUseScope?: 'SELECTED_PROVIDER' | 'DIAGNOSTIC_ONLY' | 'SHADOW_SCORE' | 'GATE_SCORE_ELIGIBLE';
  investorRowMaterializationClass?: InvestorRowMaterializationClass;
  diagnosticActualInvestorRowFromNormalized?: boolean;
  supplyProviderStatus?: InvestorFlowProviderStatus;
}

export type ActualInvestorFlowCarryAdr0477 = Pick<InvestorFlowMaterializedCandidateAdr0503,
  | 'actualInvestorFlowRows'
  | 'actualInvestorFlowRowCount'
  | 'actualInvestorFlowRowSourcePath'
  | 'actualInvestorFlowFieldKeys'
  | 'actualInvestorFlowNumericKeys'
  | 'actualInvestorFlowNumericStringKeys'
  | 'actualInvestorFlowCarried'
  | 'actualInvestorRow'
  | 'normalizedInvestorRow'
  | 'semanticInvestorRow'
  | 'supplySemanticRow'
  | 'actualRowAvailable'
  | 'normalizedRowAvailable'
  | 'semanticRowAvailable'
  | 'rowCarryPath'
  | 'diagnosticActualInvestorRow'
  | 'selectedProviderActualInvestorRow'
  | 'actualInvestorRowProvider'
  | 'actualInvestorRowUseScope'
  | 'investorRowMaterializationClass'
  | 'diagnosticActualInvestorRowFromNormalized'
>;

export type ActualInvestorFlowDropReasonAdr0477 =
  | 'ADAPTER_ROW_NOT_PRESENT'
  | 'NORMALIZER_DROPPED_ACTUAL_ROW'
  | 'MATERIALIZED_CANDIDATE_DROPPED_ACTUAL_ROW'
  | 'SELECTED_CANDIDATE_DROPPED_ACTUAL_ROW'
  | 'SELECTED_CANDIDATE_CARRIES_ACTUAL_ROW'
  | 'UNKNOWN';
