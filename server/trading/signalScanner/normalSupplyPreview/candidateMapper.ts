// @responsibility Normal supply preview candidate mapper.

import type {
  CandidateWithSupplyContext,
  PerSymbolSupplyContext,
  SupplyProviderHealth,
  SupplySignal,
} from '../injectPerSymbolSupplyContext.js';
import {
  loadLatestIntradayProgramFlowSnapshot,
  type IntradayProgramFlowSnapshot,
} from '../../../replay/intradayProgramFlowSnapshotRepo.js';
import { createTraceId, logVisibilityEvent } from '../../../utils/logger.js';
import {
  classifyProgramFlowSession,
  type ProgramFlowForensicNextAction,
  type ProgramFlowSessionGuard,
} from '../programFlowSessionGuard.js';
import {
  classifyActivePassiveConfluence,
  describeActiveFlow,
  describeProgramSignal,
  formatList,
  formatReasonDistribution,
  formatStockProgramFieldKeysTop,
} from './formatters.js';
import { buildNormalSupplyFieldAvailability } from './fieldAvailabilityBuilder.js';
import { resolveProgramFlowAfterMarketDisplay } from './programFlowAfterMarketDisplay.js';
import { assembleNormalSupplyPreview } from './previewAssembler.js';
import { setLatestNormalSupplyPreview } from './previewStore.js';
import {
  NORMAL_SUPPLY_DIAGNOSTIC_FULL_PREVIEW_MODE,
  NORMAL_SUPPLY_SCORE_THRESHOLDS,
} from './constants.js';
import {
  MARKET_PROGRAM_NUMERIC_KEYS,
  STOCK_PROGRAM_BUY_KEYS,
  STOCK_PROGRAM_NET_AMOUNT_KEYS,
  STOCK_PROGRAM_NET_BUY_KEYS,
  STOCK_PROGRAM_SCAN_KEYS,
  STOCK_PROGRAM_SELL_KEYS,
  asRecord,
  buildProgramFlowEvidenceTrace,
  candidatePreviewSymbol,
  candidateProgramRecords,
  collectProgramRecords,
  collectProgramRecordsFromItems,
  collectUpstreamProgramRecords,
  countRowsWithAnyProgramKey,
  countRowsWithParsableProgramValue,
  directRecordsFromItems,
  firstNormalizedProgramValue,
  firstOkProgramValueFromRecords,
  firstProgramValueNormalization,
  firstValueFromRecords,
  hasAnyProgramReasons,
  hasOnlyProgramReasons,
  hasProgramField,
  isStockProgramScanKey,
  marketCacheItems,
  marketLevelProgramRecords,
  marketProgramNetBuyFieldState,
  marketSnapshotItems,
  programNetBuyAmountFieldState,
  stockUpstreamSourceRecords,
  stringValue,
} from './programFlowEvidenceCollector.js';
import { normalizeProgramFlowValue } from './programFlowValueNormalizer.js';
import type {
  MarketProgramCarryForensicTrace,
  PerStockProgramCarryForensicTrace,
  ProgramFlowCarryValue,
  ProgramFlowDiagnostic,
  ProgramFlowDiagnosticsSummary,
  ProgramFlowEvidenceTrace,
  ProgramFlowMarketCarrySource,
  ProgramFlowMarketEvidenceBreakPoint,
  ProgramFlowNullRootCause,
  ProgramFlowSignal,
  ProgramFlowSourceProvider,
  ProgramFlowStockCarrySource,
  ProgramFlowStockEvidenceBreakPoint,
  ProgramFlowUpstreamPopulationResult,
  ProgramFlowUpstreamPopulationTrace,
  ProgramFlowValueNormalizationResult,
  ProgramFlowValueReason,
  ProgramMarketCarryValue,
} from './programFlowTypes.js';
import type {
  NormalSupplyPreview,
  NormalSupplyPreviewCandidate,
  NormalSupplyPreviewEngineMode,
  PersistNormalSupplyPreviewInput,
} from './types.js';
import {
  PROGRAM_FLOW_NOT_AVAILABLE_MARKET,
  PROGRAM_FLOW_NOT_AVAILABLE_STOCK,
} from './programFlowCarry.js';

export function toPreviewCandidate(
  candidate: CandidateWithSupplyContext,
  marketProgramFlow: ProgramFlowDiagnostic['marketLevel'],
  stockCarry?: ProgramFlowCarryValue,
): NormalSupplyPreviewCandidate | null {
  const symbol = candidatePreviewSymbol(candidate);
  if (!symbol) return null;
  const ctx = candidate.preflight?.supplyContext ?? candidate.supplyContext;
  const supplyContext = ctx ?? buildMissingContext(symbol);
  const trace = candidate.supplyProviderHealth ?? {};
  const health = normalizeHealth(supplyContext.supplyProviderHealth);
  const providerIssue = supplyContext.providerIssue === true;
  const marketSignal = supplyContext.marketSignal === true;
  const supplyScore = deriveSupplyScore(supplyContext);
  const signal = classifySupplySignal({
    supplyScore,
    dataStatus: health,
    providerIssue,
    marketSignal,
    foreignNetBuy: supplyContext.foreignNetBuyAmount,
    institutionNetBuy: supplyContext.institutionNetBuyAmount,
  });
  const stockProgramFlow = extractStockProgramFlow(candidate, supplyContext, stockCarry);
  const programFlow: ProgramFlowDiagnostic = { stockLevel: stockProgramFlow, marketLevel: marketProgramFlow };
  const passiveProxySignal = selectPassiveProxySignal(stockProgramFlow, marketProgramFlow);
  const activePassiveConfluence = classifyActivePassiveConfluence({
    foreignNetBuy: supplyContext.foreignNetBuyAmount,
    institutionNetBuy: supplyContext.institutionNetBuyAmount,
    passiveProxySignal,
  });
  const reason = describeSupplyReason(supplyContext, signal, supplyScore);
  return {
    symbol,
    name: typeof (candidate as { name?: unknown }).name === 'string' ? (candidate as { name: string }).name : undefined,
    sourceProvider: supplyContext.provider,
    dataStatus: health,
    confidence: deriveConfidence(supplyContext),
    supplyProviderHealth: health,
    supplySignal: signal,
    providerIssue,
    marketSignal,
    executionImpact: supplyContext.executionImpact,
    supplyScore,
    summary: summarizeSupplyContext(supplyContext),
    reason,
    ...(signal === 'BEARISH' && providerIssue
      ? { invalidBearishReason: 'PROVIDER_ISSUE_SHOULD_NOT_BE_BEARISH' as const }
      : {}),
    ...(signal === 'BULLISH' && providerIssue
      ? { invalidBullishReason: 'PROVIDER_ISSUE_SHOULD_NOT_BE_BULLISH' as const }
      : {}),
    foreignNetBuyAmount: supplyContext.foreignNetBuyAmount,
    institutionNetBuyAmount: supplyContext.institutionNetBuyAmount,
    stockProgramNetBuyAmount: stockProgramFlow.netBuy,
    stockProgramNetBuy: stockProgramFlow.netBuy,
    programNetBuy: stockProgramFlow.netBuy,
    programNetBuyAmount: stockProgramFlow.netBuy ?? supplyContext.programNetBuyAmount,
    nonProgramNetBuyAmount: supplyContext.nonProgramNetBuyAmount,
    programFlow,
    programFlowDryRun: {
      currentSupplyScore: supplyScore,
      reason: stockProgramFlow.available ? 'PROGRAM_FLOW_DIAGNOSTIC_ONLY' : 'PROGRAM_FLOW_UNAVAILABLE',
      appliedToLiveScore: false,
      diagnosticOnly: true,
      executionImpact: 'NONE',
    },
    activeFlow: describeActiveFlow(supplyContext.foreignNetBuyAmount, supplyContext.institutionNetBuyAmount),
    passiveFlow: describeProgramSignal(passiveProxySignal),
    activePassiveConfluence,
    programMissingAsBearish: false,
    programValueReason: stockProgramFlow.valueReason,
    fetchedAt: supplyContext.fetchedAt,
    rawStatus: supplyContext.rawStatus,
    semanticRowAvailable: hasSemanticRow(trace, health),
    rawInvestorRowAvailable: hasRawInvestorRow(trace, health),
    selectedCandidateCarriesSemanticRow: selectedCarriesSemanticRow(trace, health),
    selectedCandidateCarriesActualRow: selectedCarriesActualRow(trace, health),
    usedForLiveDecision: false,
    strongBuyAllowed: false,
    watchlistPriorityBoost: signal === 'ACCUMULATING' ? 1 : 0,
    shadowTracking: signal === 'ACCUMULATING',
  };
}

export function buildMissingContext(symbol: string): PerSymbolSupplyContext {
  return {
    symbol,
    provider: 'NONE',
    supplyProviderHealth: 'MISSING',
    supplySignal: 'UNUSABLE',
    providerIssue: true,
    marketSignal: false,
    executionImpact: 'NONE',
    rawStatus: 'SUPPLY_CONTEXT_NOT_INJECTED',
  };
}

export function normalizeHealth(value: unknown): SupplyProviderHealth {
  if (value === 'VERIFIED' || value === 'DEGRADED' || value === 'STALE' || value === 'MISSING') return value;
  return 'UNKNOWN';
}

export function normalizeSignal(value: unknown): SupplySignal {
  if (
    value === 'BULLISH' ||
    value === 'ACCUMULATING' ||
    value === 'NEUTRAL' ||
    value === 'BEARISH' ||
    value === 'UNUSABLE'
  ) {
    return value;
  }
  return 'UNUSABLE';
}

export function classifySupplySignal(input: {
  supplyScore: number;
  dataStatus: SupplyProviderHealth;
  providerIssue: boolean;
  marketSignal: boolean;
  foreignNetBuy?: number | null;
  institutionNetBuy?: number | null;
}): SupplySignal {
  const {
    supplyScore,
    dataStatus,
    providerIssue,
    marketSignal,
    foreignNetBuy,
    institutionNetBuy,
  } = input;

  if (dataStatus !== 'VERIFIED') return 'UNUSABLE';
  if (providerIssue) return 'UNUSABLE';
  if (!marketSignal) return 'NEUTRAL';
  if (foreignNetBuy == null || institutionNetBuy == null) return 'UNUSABLE';
  if (supplyScore >= NORMAL_SUPPLY_SCORE_THRESHOLDS.bullishThreshold) return 'BULLISH';
  if (supplyScore >= NORMAL_SUPPLY_SCORE_THRESHOLDS.accumulatingThreshold) return 'ACCUMULATING';
  if (supplyScore < NORMAL_SUPPLY_SCORE_THRESHOLDS.bearishThreshold) return 'BEARISH';
  return 'NEUTRAL';
}

export function normalizeMarketProgramFlow(
  value: unknown,
  sessionGuard?: ProgramFlowSessionGuard,
): ProgramFlowDiagnostic['marketLevel'] {
  const root = asRecord(value);
  if (!root) return { ...PROGRAM_FLOW_NOT_AVAILABLE_MARKET, reason: 'PROGRAM_FLOW_CONTEXT_NOT_FOUND' };
  const records = collectProgramRecords(root);
  const hasAnyProgramField = records.some(hasProgramField);
  const kospiResult = firstProgramValueNormalization(records, ['kospiNetBuy', 'kospiProgramNetBuy', 'kospiProgramNetBuyAmount']);
  const kosdaqResult = firstProgramValueNormalization(records, ['kosdaqNetBuy', 'kosdaqProgramNetBuy', 'kosdaqProgramNetBuyAmount']);
  const combinedResult = firstProgramValueNormalization(records, [
    'combinedNetBuy',
    'combinedProgramNetBuy',
    'marketProgramNetBuy',
    'programNetValue',
    'totalProgramNetBuy',
    'totalProgramNetBuyAmount',
    'kospiProgramNetBuy',
    'kosdaqProgramNetBuy',
    'netBuyAmount',
    'prgmNetBuy',
    'prgmNetBuyAmount',
    'marketProgramNetAmount',
    'programMarketNetBuy',
    'programNetBuy',
    'programNetBuyAmount',
    'programNetAmount',
    'program_net_buy',
    'program_net_amount',
  ]);
  const buyAmountResult = firstProgramValueNormalization(records, ['programBuyAmount', 'marketProgramBuyAmount', 'buyAmount', 'programBuy']);
  const sellAmountResult = firstProgramValueNormalization(records, ['programSellAmount', 'marketProgramSellAmount', 'sellAmount', 'programSell']);
  const firstValueFailure = [kospiResult, kosdaqResult, combinedResult, buyAmountResult, sellAmountResult].find((item) => item && !item.ok);
  const kospiNetBuy = kospiResult?.value;
  const kosdaqNetBuy = kosdaqResult?.value;
  const combined = combinedResult?.value;
  const buyAmount = buyAmountResult?.value;
  const sellAmount = sellAmountResult?.value;
  const providerIssue = records.some((record) => record.providerIssue === true);
  const sourceProvider = normalizeProgramSource(firstValueFromRecords(records, ['sourceProvider', 'provider', 'programSource', 'source']));
  const explicitSignal = normalizeProgramFlowSignal(firstValueFromRecords(records, ['programMarketSignal', 'marketProgramSignal', 'signal']));
  const status = stringValue(firstValueFromRecords(records, ['stockProgramStatus', 'marketProgramStatus', 'status']));
  const diagnosticCarry = pickMarketProgramProviderDiagnostics(root);
  const derivedCombined = combined
    ?? (kospiNetBuy !== undefined || kosdaqNetBuy !== undefined ? (kospiNetBuy ?? 0) + (kosdaqNetBuy ?? 0) : undefined)
    ?? (buyAmount !== undefined && sellAmount !== undefined ? buyAmount - sellAmount : undefined);
  if (sourceProvider === 'CACHE_STALE') {
    return {
      ...PROGRAM_FLOW_NOT_AVAILABLE_MARKET,
      sourceProvider,
      providerIssue,
      marketSignal: false,
      signal: 'UNKNOWN',
      reason: 'MARKET_PROGRAM_CACHE_STALE_DIAGNOSTIC_ONLY',
      valueIssue: false,
      ...diagnosticCarry,
    };
  }
  if (derivedCombined === undefined) {
    const unavailableByStatus = status ? /UNAVAILABLE|MISSING|UNSUPPORTED|EMPTY|NONE/i.test(status) : false;
    return {
      ...PROGRAM_FLOW_NOT_AVAILABLE_MARKET,
      sourceProvider,
      providerIssue,
      marketSignal: false,
      signal: providerIssue ? 'UNKNOWN' : explicitSignal ?? (unavailableByStatus ? 'UNAVAILABLE' : 'UNAVAILABLE'),
      reason: stringValue(firstValueFromRecords(records, ['reason'])) ?? firstValueFailure?.reason ?? (hasAnyProgramField ? 'PROGRAM_FLOW_WIRED_BUT_ALL_NA' : 'PROGRAM_FLOW_WIRED_BUT_NO_FIELDS'),
      valueIssue: Boolean(firstValueFailure),
      valueReason: firstValueFailure?.reason,
      sanitizedSample: firstValueFailure?.sanitizedSample,
      ...diagnosticCarry,
    };
  }
  const selectedValue = combinedResult ?? kospiResult ?? kosdaqResult ?? buyAmountResult ?? sellAmountResult;
  const signal = providerIssue ? 'UNKNOWN' : explicitSignal ?? marketSignalFromNetBuy(derivedCombined);
  if (isAfterMarketZeroPlaceholderProgramFlow({ sessionGuard, records, sourceProvider, derivedCombined })) {
    const placeholderDiagnostics: Record<string, unknown> = {
      marketProgramDataStatus: 'AFTER_MARKET_ZERO_PLACEHOLDER',
    };
    return {
      ...PROGRAM_FLOW_NOT_AVAILABLE_MARKET,
      sourceProvider,
      providerIssue: false,
      marketSignal: false,
      signal: 'UNAVAILABLE',
      reason: 'AFTER_MARKET_ZERO_PLACEHOLDER',
      valueIssue: false,
      valueReason: selectedValue?.reason,
      sanitizedSample: selectedValue?.sanitizedSample,
      ...diagnosticCarry,
      ...placeholderDiagnostics,
    };
  }
  return {
    available: true,
    ...(kospiNetBuy !== undefined ? { kospiNetBuy } : {}),
    ...(kosdaqNetBuy !== undefined ? { kosdaqNetBuy } : {}),
    combinedNetBuy: derivedCombined,
    signal,
    sourceProvider,
    providerIssue,
    marketSignal: !providerIssue && signal !== 'UNKNOWN' && signal !== 'UNAVAILABLE',
    reason: 'MARKET_PROGRAM_FLOW_AVAILABLE_DIAGNOSTIC_ONLY',
    valueIssue: false,
    valueReason: selectedValue?.reason,
    sanitizedSample: selectedValue?.sanitizedSample,
    ...diagnosticCarry,
    diagnosticOnly: true,
    executionImpact: 'NONE',
  };
}

export function isAfterMarketZeroPlaceholderProgramFlow(input: {
  sessionGuard?: ProgramFlowSessionGuard;
  records: Record<string, unknown>[];
  sourceProvider: ProgramFlowSourceProvider;
  derivedCombined: number;
}): boolean {
  const { sessionGuard, records, sourceProvider, derivedCombined } = input;
  if (!sessionGuard || sessionGuard.programFlowExpected) return false;
  if (sessionGuard.marketSession !== 'AFTER_MARKET' && sessionGuard.marketSession !== 'POST_CLOSE' && sessionGuard.marketSession !== 'MARKET_CLOSED') {
    return false;
  }
  if (sourceProvider !== 'KIS_API') return false;
  if (derivedCombined !== 0) return false;
  if (hasExplicitEodMarketProgramSnapshot(records) && hasRegularOrPostCloseFetchedAt(records)) return false;
  const numericValues = collectMarketProgramNumericValues(records);
  return numericValues.length > 0 && numericValues.every((value) => value === 0);
}

export function collectMarketProgramNumericValues(records: Record<string, unknown>[]): number[] {
  const values: number[] = [];
  for (const record of records) {
    for (const key of MARKET_PROGRAM_NUMERIC_KEYS) {
      const normalized = firstNormalizedProgramValue(record, [key]);
      if (normalized?.ok && normalized.value !== undefined) values.push(normalized.value);
    }
  }
  return values;
}

export function hasExplicitEodMarketProgramSnapshot(records: Record<string, unknown>[]): boolean {
  for (const record of records) {
    const tokens = [
      record.snapshotKind,
      record.snapshotType,
      record.marketProgramDataStatus,
      record.dataStatus,
      record.sourceFreshness,
      asRecord(record.aggregateDiagnostic)?.snapshotKind,
      asRecord(record.aggregateDiagnostic)?.snapshotType,
      asRecord(record.aggregateDiagnostic)?.marketProgramDataStatus,
      asRecord(record.aggregateDiagnostic)?.dataStatus,
      asRecord(record.aggregateDiagnostic)?.sourceFreshness,
    ].map((value) => String(value ?? '').toUpperCase());
    if (record.eodSnapshot === true || record.isEodSnapshot === true) return true;
    if (asRecord(record.aggregateDiagnostic)?.eodSnapshot === true || asRecord(record.aggregateDiagnostic)?.isEodSnapshot === true) return true;
    if (tokens.some((token) => token.includes('EOD_MARKET_PROGRAM_VALID') || token.includes('EOD_SNAPSHOT'))) return true;
  }
  return false;
}

export function hasRegularOrPostCloseFetchedAt(records: Record<string, unknown>[]): boolean {
  for (const record of records) {
    const fetchedAt = stringValue(firstValueFromRecords([record], ['fetchedAt', 'programFetchedAt', 'capturedAt', 'updatedAt', 'latest']));
    if (!fetchedAt) continue;
    const date = new Date(fetchedAt);
    if (!Number.isFinite(date.getTime())) continue;
    const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
    const minutes = kst.getUTCHours() * 60 + kst.getUTCMinutes();
    if (minutes >= 9 * 60 + 10 && minutes <= 15 * 60 + 40) return true;
  }
  return false;
}

export function pickMarketProgramProviderDiagnostics(root: Record<string, unknown>): Record<string, unknown> {
  const keys = [
    'marketProgramDataStatus', 'kisAttempted', 'kisStatus', 'krxFallbackAttempted', 'krxFallbackStatus',
    'cacheFallbackAttempted', 'cacheStatus', 'fetchedAt', 'parsedFieldName', 'rawFieldKeys',
    'programFlowUsedForLiveDecision', 'passiveProxyUsedForLiveDecision', 'programPenaltyApplied',
  ];
  const carried: Record<string, unknown> = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(root, key)) carried[key] = root[key];
  }
  return carried;
}

export function extractStockProgramFlow(
  candidate: CandidateWithSupplyContext,
  supplyContext: PerSymbolSupplyContext,
  carry?: ProgramFlowCarryValue,
): ProgramFlowDiagnostic['stockLevel'] {
  if (carry) {
    return {
      available: true,
      netBuy: carry.value,
      signal: signalFromNetBuy(carry.value),
      sourceProvider: carry.sourceProvider,
      providerIssue: false,
      marketSignal: true,
      reason: `STOCK_PROGRAM_FLOW_CARRIED_FROM_${carry.source}`,
      valueIssue: false,
      valueReason: carry.normalized.reason,
      sanitizedSample: carry.normalized.sanitizedSample,
      diagnosticOnly: true,
      executionImpact: 'NONE',
    };
  }
  const records = candidateProgramRecords(candidate, supplyContext);
  let providerIssue = false;
  let sourceProvider: ProgramFlowSourceProvider = 'NONE';
  let firstValueFailure: (ProgramFlowValueNormalizationResult & { key: string }) | undefined;
  for (const record of records) {
    providerIssue = providerIssue || record.providerIssue === true;
    const normalizedSource = normalizeProgramSource(record.sourceProvider ?? record.provider ?? record.programSource ?? record.source);
    if (normalizedSource !== 'NONE') sourceProvider = normalizedSource;
    const buyAmountResult = firstNormalizedProgramValue(record, STOCK_PROGRAM_BUY_KEYS);
    const sellAmountResult = firstNormalizedProgramValue(record, STOCK_PROGRAM_SELL_KEYS);
    const netAmountResult = firstNormalizedProgramValue(record, STOCK_PROGRAM_NET_AMOUNT_KEYS);
    const directNetBuyResult = firstNormalizedProgramValue(record, STOCK_PROGRAM_NET_BUY_KEYS);
    firstValueFailure ??= [buyAmountResult, sellAmountResult, netAmountResult, directNetBuyResult].find((item) => item && !item.ok);
    const buyAmount = buyAmountResult?.value;
    const sellAmount = sellAmountResult?.value;
    const netAmount = netAmountResult?.value;
    const directNetBuy = directNetBuyResult?.value;
    const selectedValue = buyAmount !== undefined && sellAmount !== undefined
      ? buyAmountResult ?? sellAmountResult
      : netAmountResult ?? directNetBuyResult;
    const netBuy = buyAmount !== undefined && sellAmount !== undefined
      ? buyAmount - sellAmount
      : netAmount ?? directNetBuy;
    if (netBuy === undefined) continue;
    return {
      available: true,
      netBuy,
      ...(buyAmount !== undefined ? { buyAmount } : {}),
      ...(sellAmount !== undefined ? { sellAmount } : {}),
      ...(netAmount !== undefined ? { netAmount } : {}),
      signal: record.providerIssue === true ? 'UNKNOWN' : signalFromNetBuy(netBuy),
      sourceProvider: normalizeProgramSource(record.sourceProvider ?? record.provider ?? supplyContext.provider),
      providerIssue: Boolean(record.providerIssue),
      marketSignal: record.providerIssue !== true,
      reason: 'STOCK_PROGRAM_FLOW_AVAILABLE_DIAGNOSTIC_ONLY',
      valueIssue: false,
      valueReason: selectedValue?.reason,
      sanitizedSample: selectedValue?.sanitizedSample,
      diagnosticOnly: true,
      executionImpact: 'NONE',
    };
  }
  const hasContext = records.length > 0;
  const hasAnyProgramField = records.some(hasProgramField);
  return {
    ...PROGRAM_FLOW_NOT_AVAILABLE_STOCK,
    sourceProvider: sourceProvider !== 'NONE' ? sourceProvider : normalizeProgramSource(supplyContext.provider),
    providerIssue,
    signal: providerIssue ? 'UNKNOWN' : 'UNAVAILABLE',
    reason: providerIssue
      ? 'PROGRAM_PROVIDER_ISSUE_DIAGNOSTIC_ONLY'
      : firstValueFailure
        ? firstValueFailure.reason
        : !hasContext
          ? 'PROGRAM_FLOW_CONTEXT_NOT_FOUND'
          : hasAnyProgramField ? 'PROGRAM_FLOW_WIRED_BUT_ALL_NA' : 'PROGRAM_FLOW_WIRED_BUT_NO_FIELDS',
    valueIssue: Boolean(firstValueFailure),
    valueReason: firstValueFailure?.reason,
    sanitizedSample: firstValueFailure?.sanitizedSample,
  };
}


export function extractMarketProgramFlowFromCandidates<T extends CandidateWithSupplyContext>(candidates: T[]): unknown {
  for (const candidate of candidates) {
    const evidence = findMarketProgramEvidence(candidate, 0, new Set<unknown>());
    if (evidence) return evidence;
  }
  return undefined;
}

export function findMarketProgramEvidence(value: unknown, depth: number, seen: Set<unknown>): Record<string, unknown> | undefined {
  if (depth > 5 || value === null || typeof value !== 'object' || seen.has(value)) return undefined;
  seen.add(value);
  const record = value as Record<string, unknown>;
  if (hasAnyKey(record, [
    'kospiProgramNetBuy', 'kosdaqProgramNetBuy', 'marketProgramNetBuy', 'combinedProgramNetBuy',
    'marketProgramNetAmount', 'programMarketNetBuy', 'programMarketSignal', 'marketProgramStatus',
    'combinedNetBuy', 'kospiNetBuy', 'kosdaqNetBuy',
  ])) {
    return record;
  }
  for (const nested of Object.values(record)) {
    if (Array.isArray(nested)) continue;
    const evidence = findMarketProgramEvidence(nested, depth + 1, seen);
    if (evidence) return evidence;
  }
  return undefined;
}

export function selectPassiveProxySignal(
  stockLevel: ProgramFlowDiagnostic['stockLevel'],
  marketLevel: ProgramFlowDiagnostic['marketLevel'],
): ProgramFlowSignal {
  if (stockLevel.available && stockLevel.marketSignal) return stockLevel.signal;
  if (marketLevel.available && marketLevel.marketSignal) return marketLevel.signal;
  if (stockLevel.providerIssue || marketLevel.providerIssue) return 'UNKNOWN';
  return 'UNAVAILABLE';
}


export function marketSignalFromNetBuy(value: number): ProgramFlowSignal {
  if (value >= 1000) return 'BULLISH';
  if (value <= -1000) return 'BEARISH';
  return 'NEUTRAL';
}

export function signalFromNetBuy(value: number): ProgramFlowSignal {
  if (value > 0) return 'BULLISH';
  if (value < 0) return 'BEARISH';
  return 'NEUTRAL';
}

export function hasAnyKey(record: Record<string, unknown>, keys: string[]): boolean {
  return keys.some((key) => record[key] !== undefined && record[key] !== null);
}

export function normalizeProgramFlowSignal(value: unknown): ProgramFlowSignal | undefined {
  if (value === 'BULLISH' || value === 'NEUTRAL' || value === 'BEARISH' || value === 'UNKNOWN' || value === 'UNAVAILABLE') {
    return value;
  }
  return undefined;
}

export function normalizeProgramSource(value: unknown): ProgramFlowSourceProvider {
  if (value === 'KIS_API') return 'KIS_API';
  if (value === 'KRX_FALLBACK') return 'KRX_FALLBACK';
  if (value === 'KRX_API' || value === 'KRX' || value === 'KRX_INVESTOR_FLOW') return 'KRX_API';
  if (value === 'CACHE_STALE') return 'CACHE_STALE';
  if (value === 'CACHE') return 'CACHE';
  if (value === 'SNAPSHOT') return 'SNAPSHOT';
  return 'NONE';
}


export function deriveSupplyScore(ctx: PerSymbolSupplyContext): number {
  let score = 50;
  const health = normalizeHealth(ctx.supplyProviderHealth);
  const signal = normalizeSignal(ctx.supplySignal);
  if (health === 'VERIFIED') score += 10;
  if (health === 'DEGRADED') score -= 5;
  if (health === 'STALE') score -= 10;
  if (health === 'MISSING') score -= 15;
  if (health === 'UNKNOWN') score -= 20;
  if (signal === 'BULLISH') score += 20;
  if (signal === 'NEUTRAL') score += 5;
  if (signal === 'BEARISH') score -= 20;
  if (signal === 'UNUSABLE') score -= 15;
  score += signedAmountScore(ctx.foreignNetBuyAmount, 6);
  score += signedAmountScore(ctx.institutionNetBuyAmount, 6);
  score += signedAmountScore(ctx.programNetBuyAmount, 4);
  score += signedAmountScore(ctx.nonProgramNetBuyAmount, 3);
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function deriveConfidence(ctx: PerSymbolSupplyContext): NormalSupplyPreviewCandidate['confidence'] {
  const health = normalizeHealth(ctx.supplyProviderHealth);
  if (health === 'VERIFIED' && ctx.providerIssue !== true) return 'HIGH';
  if (health === 'DEGRADED' || health === 'STALE') return 'MEDIUM';
  if (health === 'MISSING') return 'LOW';
  return 'UNKNOWN';
}

export function hasSemanticRow(
  trace: CandidateWithSupplyContext['supplyProviderHealth'],
  health: SupplyProviderHealth,
): boolean {
  if (!trace) return health === 'VERIFIED';
  return Boolean(
    trace.semanticRow ||
      trace.semanticInvestorRow ||
      trace.supplySemanticRow ||
      trace.materialized === true ||
      health === 'VERIFIED',
  );
}

export function hasRawInvestorRow(
  trace: CandidateWithSupplyContext['supplyProviderHealth'],
  health: SupplyProviderHealth,
): boolean {
  if (!trace) return health === 'VERIFIED';
  return Boolean(
    trace.actualInvestorRow ||
      trace.diagnosticActualInvestorRow ||
      trace.normalizedInvestorRow ||
      (trace.actualInvestorFlowRows?.length ?? 0) > 0 ||
      trace.actualInvestorFlowCarried === true ||
      trace.materialized === true ||
      health === 'VERIFIED',
  );
}

export function selectedCarriesSemanticRow(
  trace: CandidateWithSupplyContext['supplyProviderHealth'],
  health: SupplyProviderHealth,
): boolean {
  if (!trace) return health === 'VERIFIED';
  return Boolean(trace.semanticRow || trace.semanticInvestorRow || trace.supplySemanticRow || trace.materialized === true || health === 'VERIFIED');
}

export function selectedCarriesActualRow(
  trace: CandidateWithSupplyContext['supplyProviderHealth'],
  health: SupplyProviderHealth,
): boolean {
  if (!trace) return health === 'VERIFIED';
  return Boolean(
    trace.actualInvestorFlowCarried === true ||
      trace.actualInvestorRow ||
      (trace.actualInvestorFlowRows?.length ?? 0) > 0 ||
      trace.materialized === true ||
      health === 'VERIFIED',
  );
}

export function signedAmountScore(value: number | undefined, weight: number): number {
  if (value === undefined || value === 0) return 0;
  return value > 0 ? weight : -weight;
}

export function describeSupplyReason(ctx: PerSymbolSupplyContext, classifiedSignal?: SupplySignal, supplyScore?: number): string {
  const health = normalizeHealth(ctx.supplyProviderHealth);
  const signal = classifiedSignal ?? normalizeSignal(ctx.supplySignal);
  if (ctx.providerIssue === true || health !== 'VERIFIED') {
    return `${health} provider gap (${ctx.rawStatus ?? 'n/a'})`;
  }
  const foreign = ctx.foreignNetBuyAmount ?? 0;
  const institution = ctx.institutionNetBuyAmount ?? 0;
  const program = ctx.programNetBuyAmount ?? 0;
  if (signal === 'ACCUMULATING' && foreign > 0 && institution > 0) {
    return `foreign+institution net buy but below bullish threshold (${supplyScore ?? 'n/a'}/${NORMAL_SUPPLY_SCORE_THRESHOLDS.bullishThreshold}) - ACCUMULATING quiet observation candidate`;
  }
  if (signal === 'ACCUMULATING') {
    return `VERIFIED supply data shows accumulation (${supplyScore ?? 'n/a'}) - diagnostic/shadow only, not used for live decision`;
  }
  if (signal === 'BEARISH' && foreign < 0 && institution < 0) return '외국인+기관 동반 순매도';
  if (signal === 'BULLISH' && foreign > 0 && institution > 0 && program > 0) return '외국인+기관+프로그램 동반 순매수';
  if (signal === 'NEUTRAL' && foreign > 0 && institution > 0) return '외인+기관 동반 순매수이나 bullish threshold 미달';
  if (foreign > 0 && institution > 0) return '외인+기관 동반 순매수';
  if (foreign < 0 && institution < 0) return '외국인+기관 동반 순매도';
  if (foreign > 0) return '외국인 순매수 우위';
  if (institution > 0) return '기관 순매수 우위';
  if (program > 0) return '프로그램 순매수 우위';
  return `${signal} supply`;
}

export function summarizeSupplyContext(ctx: PerSymbolSupplyContext): string {
  const health = normalizeHealth(ctx.supplyProviderHealth);
  const signal = normalizeSignal(ctx.supplySignal);
  if (health !== 'VERIFIED') return `${health} provider gap (${ctx.rawStatus ?? 'n/a'})`;
  const foreign = ctx.foreignNetBuyAmount ?? 0;
  const institution = ctx.institutionNetBuyAmount ?? 0;
  const program = ctx.programNetBuyAmount ?? 0;
  if (foreign > 0 && institution > 0) return '외인+기관 동반 순매수';
  if (institution > 0 && program > 0) return '기관+프로그램 순매수';
  if (foreign > 0) return '외인 순매수 우위';
  if (institution > 0) return '기관 순매수 우위';
  if (signal === 'BEARISH') return '외인/기관 수급 약세';
  return `${signal} supply`;
}
