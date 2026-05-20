/**
 * @responsibility ADR-0505 supply scope audit builder.
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
  SellOnlyCarryBreakPointAdr0507,
  SupplyScopeAudit,
  SupplyScopeWarning,
} from './types.js';

export function buildSupplyScopeAudit(input: {
  trace: MinimumSignalScoreTrace;
  candidate?: CandidateEntryTrace;
  conditionResultsTrace?: GateConditionResultTrace[];
  conditionResults?: Record<string, unknown>;
  conditionKeys?: string[];
  supplyProviderHealth?: Partial<SupplyProviderHealthTrace>;
  kisFlow?: BuildGate1MinimumSignalForensicInput['kisFlow'];
  actualInvestorFlowRows?: BuildGate1MinimumSignalForensicInput['actualInvestorFlowRows'];
  actualInvestorFlowRowCount?: BuildGate1MinimumSignalForensicInput['actualInvestorFlowRowCount'];
  actualInvestorFlowRowSourcePath?: BuildGate1MinimumSignalForensicInput['actualInvestorFlowRowSourcePath'];
  actualInvestorFlowFieldKeys?: BuildGate1MinimumSignalForensicInput['actualInvestorFlowFieldKeys'];
  actualInvestorFlowNumericKeys?: BuildGate1MinimumSignalForensicInput['actualInvestorFlowNumericKeys'];
  actualInvestorFlowNumericStringKeys?: BuildGate1MinimumSignalForensicInput['actualInvestorFlowNumericStringKeys'];
  actualInvestorFlowCarried?: BuildGate1MinimumSignalForensicInput['actualInvestorFlowCarried'];
  actualInvestorRow?: BuildGate1MinimumSignalForensicInput['actualInvestorRow'];
  diagnosticActualInvestorRow?: BuildGate1MinimumSignalForensicInput['diagnosticActualInvestorRow'];
  normalizedInvestorRow?: BuildGate1MinimumSignalForensicInput['normalizedInvestorRow'];
  semanticInvestorRow?: BuildGate1MinimumSignalForensicInput['semanticInvestorRow'];
  supplySemanticRow?: BuildGate1MinimumSignalForensicInput['supplySemanticRow'];
  selectedCandidate?: BuildGate1MinimumSignalForensicInput['selectedCandidate'];
  sellOnlyBySymbolPayloadAvailable?: BuildGate1MinimumSignalForensicInput['sellOnlyBySymbolPayloadAvailable'];
  sellOnlyBySymbolPayloadMerged?: BuildGate1MinimumSignalForensicInput['sellOnlyBySymbolPayloadMerged'];
  sellOnlyCarryBreakPoint?: BuildGate1MinimumSignalForensicInput['sellOnlyCarryBreakPoint'];
  supplySemanticSkipReason?: BuildGate1MinimumSignalForensicInput['supplySemanticSkipReason'];
  quoteSymbol?: string | null;
}): SupplyScopeAudit {
  const { trace, candidate, kisFlow, quoteSymbol, supplyProviderHealth } = input;
  const pseudoSymbolSkipped = input.supplySemanticSkipReason === 'DIAGNOSTIC_SKIPPED_PSEUDO_SYMBOL'
    || (input.sellOnlyCarryBreakPoint === 'PSEUDO_SYMBOL_NOT_RESOLVED' && /^WATCHLIST_\d+$/i.test(trace.symbol));

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

  const semanticRowCandidate = (input.semanticInvestorRow ?? input.supplySemanticRow ?? input.selectedCandidate?.semanticInvestorRow ?? input.selectedCandidate?.supplySemanticRow ?? kisFlow?.semanticInvestorRow ?? kisFlow?.supplySemanticRow ?? kisFlow?.semanticRow ?? kisFlow?.investorFlowSemanticRow) as SanitizedInvestorFlowSemanticRow | Record<string, unknown> | null | undefined;
  const sanitizedSemanticRow = semanticRowCandidate && typeof semanticRowCandidate === 'object' && 'sourceFields' in semanticRowCandidate && 'rawFieldKeys' in semanticRowCandidate
    ? semanticRowCandidate as SanitizedInvestorFlowSemanticRow
    : null;
  const forensicInputActualRows = Array.isArray(input.actualInvestorFlowRows) ? input.actualInvestorFlowRows : (input.actualInvestorRow ? [input.actualInvestorRow] : []);
  const selectedCandidateActualRows = Array.isArray(input.selectedCandidate?.actualInvestorFlowRows) ? input.selectedCandidate.actualInvestorFlowRows : (input.selectedCandidate?.actualInvestorRow ? [input.selectedCandidate.actualInvestorRow] : []);
  const kisFlowActualRows = Array.isArray(kisFlow?.actualInvestorFlowRows) ? kisFlow.actualInvestorFlowRows : (kisFlow?.actualInvestorRow ? [kisFlow.actualInvestorRow] : []);
  const kisFlowSanitizedRows = Array.isArray(kisFlow?.sanitizedInvestorFlowRows) ? kisFlow.sanitizedInvestorFlowRows : [];
  const actualInvestorRows = forensicInputActualRows.length > 0
    ? forensicInputActualRows
    : selectedCandidateActualRows.length > 0
      ? selectedCandidateActualRows
      : kisFlowActualRows.length > 0
        ? kisFlowActualRows
        : kisFlowSanitizedRows;
  const primarySemanticFlow = semanticRowCandidate
    ?? input.normalizedInvestorRow
    ?? input.actualInvestorRow
    ?? input.selectedCandidate?.normalizedInvestorRow
    ?? input.selectedCandidate?.actualInvestorRow
    ?? kisFlow?.normalizedInvestorRow
    ?? kisFlow?.actualInvestorRow
    ?? sanitizedSemanticRow
    ?? null;
  // INVESTOR-FLOW-ACTUAL-ROW-CARRY-WIRING-001 — diagnostic actual row 를 router payload 에서
  // 수신. SELL_ONLY lane 은 kisFlow 본체가 비어 bySymbol payload 에만 carry 가 들어올 수 있어
  // bySymbol[code] payload 도 merge 한다. selectedProvider 무관 — DIAGNOSTIC_ONLY scope.
  const routeBySymbolKey = (kisSymbol ?? candidateSymbol ?? qSymbol ?? traceSymbol ?? '').replace(/[^0-9A-Za-z]/g, '');
  const sellOnlyBySymbolPayload = (kisFlow?.bySymbol && routeBySymbolKey && typeof kisFlow.bySymbol === 'object')
    ? (kisFlow.bySymbol[routeBySymbolKey] as Record<string, unknown> | undefined)
    : undefined;
  const normalizedRowForPromotion =
    (input.normalizedInvestorRow as Record<string, unknown> | null | undefined)
    ?? (input.selectedCandidate?.normalizedInvestorRow as Record<string, unknown> | null | undefined)
    ?? (kisFlow?.normalizedInvestorRow as Record<string, unknown> | null | undefined)
    ?? (sellOnlyBySymbolPayload?.normalizedInvestorRow as Record<string, unknown> | null | undefined)
    ?? null;
  const diagnosticActualInvestorRow =
    (input.diagnosticActualInvestorRow as Record<string, unknown> | null | undefined)
    ?? (input.actualInvestorRow as Record<string, unknown> | null | undefined)
    ?? (input.selectedCandidate?.diagnosticActualInvestorRow as Record<string, unknown> | null | undefined)
    ?? (kisFlow?.diagnosticActualInvestorRow as Record<string, unknown> | null | undefined)
    ?? (sellOnlyBySymbolPayload?.diagnosticActualInvestorRow as Record<string, unknown> | null | undefined)
    ?? (actualInvestorRows.length > 0 ? (actualInvestorRows[0] as Record<string, unknown>) : null)
    ?? normalizedRowForPromotion
    ?? null;
  const selectedProviderActualInvestorRow =
    (kisFlow?.selectedProviderActualInvestorRow as Record<string, unknown> | null | undefined)
    ?? (sellOnlyBySymbolPayload?.selectedProviderActualInvestorRow as Record<string, unknown> | null | undefined)
    ?? null;
  const actualInvestorRowProvider =
    (kisFlow?.actualInvestorRowProvider as 'KIS_API' | 'NAVER_INVESTOR_TREND' | 'UNKNOWN' | null | undefined)
    ?? (sellOnlyBySymbolPayload?.actualInvestorRowProvider as 'KIS_API' | 'NAVER_INVESTOR_TREND' | 'UNKNOWN' | null | undefined)
    ?? null;
  const actualInvestorRowUseScope =
    (kisFlow?.actualInvestorRowUseScope as 'SELECTED_PROVIDER' | 'DIAGNOSTIC_ONLY' | 'SHADOW_SCORE' | undefined)
    ?? (sellOnlyBySymbolPayload?.actualInvestorRowUseScope as 'SELECTED_PROVIDER' | 'DIAGNOSTIC_ONLY' | 'SHADOW_SCORE' | undefined)
    ?? 'DIAGNOSTIC_ONLY';
  const diagnosticActualInvestorRowCarried = hasActualInvestorNumericRow(diagnosticActualInvestorRow) || hasActualInvestorNumericRow(normalizedRowForPromotion);

  // INVESTOR-FLOW-ACTUAL-ROW-CARRY-WIRING-001 — semantic mapper 입력 우선순위:
  // selectedProvider actual row > diagnostic actual row > legacy primarySemanticFlow > wrapper.
  // primarySemanticFlow 가 숫자 필드를 가진 실데이터면 그대로 사용, 아니면 (metadata-only/
  // wrapper) selectedProvider/diagnostic numeric row 를 우선 — 실데이터 carry 유지.
  const candidateFlowForSemantic = (hasActualInvestorNumericRow(primarySemanticFlow) ? primarySemanticFlow : null)
    ?? (hasActualInvestorNumericRow(selectedProviderActualInvestorRow) ? selectedProviderActualInvestorRow : null)
    ?? (diagnosticActualInvestorRowCarried ? diagnosticActualInvestorRow : null)
    ?? primarySemanticFlow
    ?? (actualInvestorRows.length > 0 ? actualInvestorRows : kisFlow ?? null);
  const flatRowForGate = extractFlatInvestorFlowRow(
    kisFlow?.gateSemanticFlatRow
    ?? sellOnlyBySymbolPayload?.gateSemanticFlatRow
    ?? candidateFlowForSemantic,
  );
  const flowForSemantic = flatRowForGate ?? candidateFlowForSemantic;

  // INVESTOR-FLOW-ACTUAL-ROW-CARRY-WIRING-001 — `rawInvestorRowAvailable` 강화. 기존
  // `flowForSemantic != null && typeof === 'object'` fallback 은 dummy/wrapper/metadata-only
  // 객체도 true 로 판정해 실데이터 부재를 가렸음. hasActualInvestorNumericRow 로 *숫자 필드가
  // 하나라도 있는 실데이터 row* 만 인정 — diagnostic actual row 또는 flowForSemantic 의 numeric
  // 필드 검증. CORE 무영향 / diagnostic only.
  const rawInvestorRowAvailable = kisFlow?.kisRawRowAvailableAtAdapter
    ?? (flatRowForGate != null || diagnosticActualInvestorRowCarried || hasActualInvestorNumericRow(flowForSemantic));
  const selectedCandidateCarriesSemanticRow = kisFlow?.kisSelectedCandidateCarriesSemanticRow ?? Boolean(input.selectedCandidate?.semanticInvestorRow ?? input.selectedCandidate?.supplySemanticRow ?? kisFlow?.semanticInvestorRow ?? kisFlow?.supplySemanticRow ?? kisFlow?.semanticRow ?? kisFlow?.investorFlowSemanticRow);
  const forensicInputCarriesSemanticRow = kisFlow?.forensicInputCarriesSemanticRow ?? Boolean(semanticRowCandidate);
  const forensicInputCarriesActualInvestorRows = kisFlow?.forensicInputCarriesActualInvestorRows ?? (actualInvestorRows.length > 0 || diagnosticActualInvestorRowCarried);
  // Patch-009 P1 — 프로덕션 진단 로그 게이트. SUPPLY_SEMANTIC_WIRE_DIAGNOSTIC 은
  // 평가용 진단(executionImpact=NONE)일 뿐이라 default LOG_LEVEL=info 에서는 종목별
  // 60s dedup 이 있어도 종목 수 × 2 stage 로 누적된다. 중앙 logger 의 noise 게이트로
  // 프로덕션에서 억제하고 LOG_SUPPRESS_SUPPLY_SEMANTIC_WIRE_DIAGNOSTIC=false 또는
  // LOG_LEVEL=debug 시에만 노출. 억제 시 NoiseSummary 카운터에 집계.
  const wireDiagSuppressed = shouldSuppressNoise('SUPPLY_SEMANTIC_WIRE_DIAGNOSTIC');
  if (wireDiagSuppressed && !pseudoSymbolSkipped) recordNoiseSuppressed('SUPPLY_SEMANTIC_WIRE_DIAGNOSTIC');
  const wireDiag = pseudoSymbolSkipped || wireDiagSuppressed
    ? { emit: false, suppressedSinceLast: 0 }
    : shouldEmitSupplySemanticWireDiagLog(trace.symbol);
  if (wireDiag.emit) {
    console.info(
      `[SUPPLY_SEMANTIC_WIRE_DIAGNOSTIC] symbol=${trace.symbol} stage=BEFORE_SEMANTIC_EVAL`
      + ` inputShape=${pseudoSymbolSkipped ? 'SKIPPED_PSEUDO_SYMBOL' : flatRowForGate != null ? 'FLAT_ROW' : 'WRAPPER'}`
      + ` foreignNetBuy=${flatRowForGate?.foreignNetBuy ?? 'null'}`
      + ` institutionNetBuy=${flatRowForGate?.institutionNetBuy ?? 'null'}`
      + ` programNetBuy=${flatRowForGate?.programNetBuy ?? 'null'}`
      + ' providerIssue=false'
      + (flatRowForGate == null && input.sellOnlyCarryBreakPoint ? ` sellOnlyCarryBreakPoint=${input.sellOnlyCarryBreakPoint}` : ''),
    );
  }
  const semantic: InvestorFlowSemanticAvailabilityResult = pseudoSymbolSkipped
    ? {
        available: false,
        diagnosticAvailable: true,
        reason: 'DIAGNOSTIC_SKIPPED_PSEUDO_SYMBOL' as const,
        providerIssue: false,
        marketSignal: false as const,
        scoreUsage: 'DIAGNOSTIC_ONLY' as const,
        executionImpact: 'NONE' as const,
        foreignNetBuy: null,
        institutionalNetBuy: null,
        programNetBuy: null,
        individualNetBuy: null,
        sourceFields: {},
        materializedCount: 0,
        normalizedCount: 0,
      }
    : evaluateInvestorFlowSemanticAvailabilityV2({
    flow: flowForSemantic,
    symbolMatched,
    inferredSymbolMatched,
    providerScope,
    stale: kisFlow?.stale === true,
    providerIssue: false,
    rawInvestorRowAvailable,
    semanticRowExpected: selectedCandidateCarriesSemanticRow,
    semanticRowDropped: kisFlow?.semanticRowBreakPoint === 'ROUTER_DROPPED_RAW_ROW' || kisFlow?.semanticRowBreakPoint === 'ROUTER_DROPPED_SEMANTIC_ROW' || kisFlow?.semanticRowBreakPoint === 'ROUTER_SELECTED_CANDIDATE_DROPPED_ACTUAL_ROW',
    forensicInputDroppedSemanticRow: kisFlow?.semanticRowBreakPoint === 'FORENSIC_INPUT_DROPPED_SEMANTIC_ROW' || kisFlow?.semanticRowBreakPoint === 'FORENSIC_COLLECTOR_DROPPED_ACTUAL_ROW',
    // INVESTOR-FLOW-ACTUAL-ROW-CARRY-WIRING-001 — diagnostic actual numeric row 가 carry 됐으면
    // selectedProvider 무관 true. 그 외엔 기존 KIS-only 판정 유지.
    actualInvestorRowCarried: flatRowForGate != null || diagnosticActualInvestorRowCarried
      ? true
      : (selectedProvider === 'KIS_API' || selectedProvider === 'KIS') && (Object.prototype.hasOwnProperty.call(kisFlow ?? {}, 'actualInvestorFlowRows') || Object.prototype.hasOwnProperty.call(kisFlow ?? {}, 'actualInvestorRow') || Object.prototype.hasOwnProperty.call(kisFlow ?? {}, 'sanitizedInvestorFlowRows')) ? forensicInputCarriesActualInvestorRows : undefined,
  });
  if (wireDiag.emit) {
    console.info(
      `[SUPPLY_SEMANTIC_WIRE_DIAGNOSTIC] symbol=${trace.symbol} stage=AFTER_SEMANTIC_EVAL`
      + ` available=${semantic.available}`
      + ` reason=${semantic.reason}`
      + ` providerIssue=${semantic.providerIssue}`
      + ' executionImpact=NONE'
      + (wireDiag.suppressedSinceLast > 0 ? ` suppressedCount=${wireDiag.suppressedSinceLast}` : ''),
    );
  }
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
    // ADR-0477 supply actual row carry diagnostic — adapter (KIS) row 보유 + selectedProvider !=
    // 'KIS_API' + router 가 carry 한 경우. 사용자 명시 #6 단절 진단 — 사용자 보고 47/47 vs 0/47
    // 케이스에서 KIS adapter 가 firstSymbol 만 있고 selectedProvider 가 다른 경우 routerCarriesActualRow
    // = true 로 격상. CORE 결정 (selectedProvider) 무영향 — diagnostic / SHADOW_SCORE 전용.
    adapterRowsForwardedAcrossProviders: Boolean(kisFlow?.adapterRowsForwardedAcrossProviders),
    // INVESTOR-FLOW-ACTUAL-ROW-CARRY-WIRING-001 — diagnostic actual row 가 forensic 단계까지
    // carry + 숫자 필드 보유 검증 통과 여부 (selectedProvider 무관). SELL_ONLY lane 의 bySymbol
    // payload merge 도 반영. DIAGNOSTIC_ONLY scope — executionImpact='NONE'.
    diagnosticActualInvestorRowCarried,
    actualInvestorRowProvider,
    actualInvestorRowUseScope,
    investorRowMaterializationClass: (kisFlow?.investorRowMaterializationClass as InvestorRowMaterializationClass | undefined)
      ?? (sellOnlyBySymbolPayload?.investorRowMaterializationClass as InvestorRowMaterializationClass | undefined),
    diagnosticActualInvestorRowFromNormalized: Boolean(kisFlow?.diagnosticActualInvestorRowFromNormalized ?? sellOnlyBySymbolPayload?.diagnosticActualInvestorRowFromNormalized),
    selectedCandidateCarriesSemanticRow,
    forensicInputCarriesSemanticRow,
    forensicInputCarriesActualInvestorRows,
    sellOnlyBySymbolPayloadAvailable: input.sellOnlyBySymbolPayloadAvailable ?? Boolean(sellOnlyBySymbolPayload),
    sellOnlyBySymbolPayloadMerged: input.sellOnlyBySymbolPayloadMerged ?? Boolean(sellOnlyBySymbolPayload && diagnosticActualInvestorRowCarried),
    sellOnlyCarryBreakPoint: input.sellOnlyCarryBreakPoint === 'CARRIED_TO_FORENSIC' && !forensicInputCarriesActualInvestorRows
      ? 'BYSYMBOL_PAYLOAD_MERGED_BUT_FORENSIC_DROPPED'
      : input.sellOnlyCarryBreakPoint,
    selectedActualRowPath: input.actualInvestorFlowRowSourcePath ?? input.selectedCandidate?.actualInvestorFlowRowSourcePath ?? kisFlow?.selectedActualRowPath ?? kisFlow?.actualInvestorFlowRowSourcePath ?? semantic.fieldKeyDiagnostics?.selectedPath ?? null,
    selectedActualRowFieldKeys: input.actualInvestorFlowFieldKeys ?? input.selectedCandidate?.actualInvestorFlowFieldKeys ?? kisFlow?.selectedActualRowFieldKeys ?? kisFlow?.actualInvestorFlowFieldKeys ?? semantic.fieldKeyDiagnostics?.actualRawFieldKeysTop ?? [],
    selectedActualNumericFieldKeys: input.actualInvestorFlowNumericKeys ?? input.selectedCandidate?.actualInvestorFlowNumericKeys ?? kisFlow?.selectedActualNumericFieldKeys ?? semantic.fieldKeyDiagnostics?.actualNumberFieldKeysTop ?? [],
    selectedActualNumericStringFieldKeys: input.actualInvestorFlowNumericStringKeys ?? input.selectedCandidate?.actualInvestorFlowNumericStringKeys ?? kisFlow?.selectedActualNumericStringFieldKeys ?? semantic.fieldKeyDiagnostics?.actualNumericStringFieldKeysTop ?? [],
    selectedActualPlaceholderFieldKeys: kisFlow?.selectedActualPlaceholderFieldKeys ?? semantic.fieldKeyDiagnostics?.actualPlaceholderFieldKeysTop ?? [],
    semanticRowBreakPoint: kisFlow?.semanticRowBreakPoint ?? (forensicInputCarriesActualInvestorRows && !semanticAvailable ? 'ACTUAL_ROW_CARRIED_ALIAS_NOT_MAPPED' : semantic.semanticRowBreakPoint) ?? (semantic.reason === 'SEMANTIC_ROW_METADATA_ONLY' ? 'ONLY_WRAPPER_METADATA' : semantic.reason === 'FIELD_ALIAS_NOT_MAPPED' ? 'NESTED_ROW_UNWRAPPED_BUT_ALIAS_NOT_MAPPED' : 'UNKNOWN'),
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
          unwrapRows: actualInvestorRows.length,
          selectedPath: input.actualInvestorFlowRowSourcePath ?? input.selectedCandidate?.actualInvestorFlowRowSourcePath ?? kisFlow?.selectedActualRowPath ?? semantic.fieldKeyDiagnostics?.selectedPath,
          unwrapReason: semantic.fieldKeyDiagnostics?.unwrapReason,
          actualRawFieldKeysTop: input.actualInvestorFlowFieldKeys ?? input.selectedCandidate?.actualInvestorFlowFieldKeys ?? kisFlow?.selectedActualRowFieldKeys ?? sanitizedSemanticRow.rawFieldKeys,
          actualNumericStringFieldKeysTop: input.actualInvestorFlowNumericStringKeys ?? input.selectedCandidate?.actualInvestorFlowNumericStringKeys ?? kisFlow?.selectedActualNumericStringFieldKeys ?? semantic.fieldKeyDiagnostics?.actualNumericStringFieldKeysTop ?? [],
          actualNumberFieldKeysTop: input.actualInvestorFlowNumericKeys ?? input.selectedCandidate?.actualInvestorFlowNumericKeys ?? kisFlow?.selectedActualNumericFieldKeys ?? semantic.fieldKeyDiagnostics?.actualNumberFieldKeysTop ?? [],
          actualPlaceholderFieldKeysTop: kisFlow?.selectedActualPlaceholderFieldKeys ?? semantic.fieldKeyDiagnostics?.actualPlaceholderFieldKeysTop ?? [],
          selectedActualRawFieldKeysTop: input.actualInvestorFlowFieldKeys ?? input.selectedCandidate?.actualInvestorFlowFieldKeys ?? kisFlow?.selectedActualRowFieldKeys ?? sanitizedSemanticRow.rawFieldKeys,
          selectedNumericStringFieldKeysTop: input.actualInvestorFlowNumericStringKeys ?? input.selectedCandidate?.actualInvestorFlowNumericStringKeys ?? kisFlow?.selectedActualNumericStringFieldKeys ?? semantic.fieldKeyDiagnostics?.selectedNumericStringFieldKeysTop ?? [],
          wrapperOnlyCount: semantic.fieldKeyDiagnostics?.wrapperOnlyCount,
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

export function resolveSupplyUnknownRootCause(audit: SupplyScopeAudit): string {
  if (!audit.kisFlowSymbol && !audit.providerSymbol && !audit.normalizedSymbol && audit.inferredSymbolMatched !== true) return 'SUPPLY_SYMBOL_MISSING';
  if (audit.symbolMatched === false && audit.inferredSymbolMatched !== true) return 'SUPPLY_SYMBOL_MISMATCH';
  if (audit.semanticReason === 'ONLY_MARKET_LEVEL_FLOW' || audit.semanticReason === 'ONLY_SECTOR_LEVEL_FLOW' || audit.semanticReason === 'PROVIDER_SCOPE_NOT_SYMBOL_LEVEL') return 'SUPPLY_PROVIDER_SCOPE_NOT_SYMBOL';
  if (audit.semanticReason === 'SEMANTIC_ROW_METADATA_ONLY') return 'SUPPLY_SEMANTIC_ROW_METADATA_ONLY';
  if (audit.semanticReason === 'RAW_INVESTOR_ROW_MISSING') return 'SUPPLY_RAW_INVESTOR_ROW_MISSING';
  if (audit.semanticReason === 'ROUTER_DROPPED_SEMANTIC_ROW') return 'SUPPLY_ROUTER_DROPPED_SEMANTIC_ROW';
  if (audit.semanticReason === 'FORENSIC_INPUT_DROPPED_SEMANTIC_ROW') return 'SUPPLY_FORENSIC_INPUT_DROPPED_SEMANTIC_ROW';
  if (audit.semanticReason === 'DIAGNOSTIC_SKIPPED_PSEUDO_SYMBOL') return 'SUPPLY_DIAGNOSTIC_SKIPPED_PSEUDO_SYMBOL';
  if (audit.semanticReason === 'ACTUAL_INVESTOR_ROW_NOT_CARRIED') return 'SUPPLY_ACTUAL_INVESTOR_ROW_NOT_CARRIED';
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
