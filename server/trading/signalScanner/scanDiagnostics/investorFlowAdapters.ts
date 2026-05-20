/**
 * @responsibility Investor flow adapter conversion helpers for scan diagnostics.
 * ADR-0001 scan diagnostics core split.
 */

import { type CandidateSnapshot } from '../entryFilterDecomposition.js';
import { type InvestorFlowProviderRouterInput } from '../investorFlowProviderRouterAdr0477.js';
import { type NaverInvestorTrendCollectorResult } from '../naverInvestorTrendCollectorAdr0481.js';
import { type SemanticNetBuyInputPoint } from '../semanticNetBuyNormalizerAdr0482.js';
import { type SupplySnapshotCacheLookupAdr0491 } from '../supplySnapshotStoreReplayAdr0491.js';
import { fetchKisInvestorFlowEvidence } from '../../../supply/kisInvestorFlowEvidence.js';
import { fetchInvestorFlowWithPolicy } from '../../../supply/investorFlowRouter.js';
import { type KrxInvestorRow, type KrxInvestorTradingDiagnostic } from '../../../clients/krxClient.js';
import { scanDiagnosticNumber, scanDiagnosticString } from './macroScanDiagnostics.js';

export function compactTradingDateAdr0505(date: string): string {
  return date.replace(/[^0-9]/g, '');
}

export function normalizeSymbolCodeAdr0505(symbol: string | null | undefined): string {
  const digits = String(symbol ?? '').replace(/[^0-9]/g, '');
  if (digits.length >= 6) return digits.slice(-6);
  return digits.padStart(6, '0');
}

export function isPseudoWatchlistSymbolAdr0520(value: unknown): boolean {
  return typeof value === 'string' && /^WATCHLIST_\d+$/i.test(value);
}

export function normalizeActualSymbolForAdr0477(value: unknown): string | null {
  if (isPseudoWatchlistSymbolAdr0520(value)) return null;
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const withoutPrefix = raw.replace(/^[A-Z]/, '');
  const digits = withoutPrefix.replace(/[^0-9]/g, '');
  return digits.length === 6 ? digits : null;
}

export function objectFieldAdr0477(input: unknown, key: string): Record<string, unknown> | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const value = (input as Record<string, unknown>)[key];
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function resolveActualSymbolForAdr0477(snapshot: CandidateSnapshot | undefined): string | null {
  const record = snapshot as unknown as Record<string, unknown> | undefined;
  const quote = objectFieldAdr0477(record, 'quote');
  const selectedCandidate = objectFieldAdr0477(record, 'selectedCandidate');
  const candidates = [
    record?.actualSymbol,
    record?.stockCode,
    record?.code,
    record?.iscd,
    record?.symbolCode,
    quote?.symbol,
    quote?.code,
    quote?.stockCode,
    selectedCandidate?.symbol,
    selectedCandidate?.code,
    selectedCandidate?.stockCode,
    snapshot?.symbol,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeActualSymbolForAdr0477(candidate);
    if (normalized) return normalized;
  }
  return null;
}

export function krxInvestorRowToRouterRawAdr0505(input: {
  row: KrxInvestorRow;
  sourceDate: string;
  status: 'VERIFIED' | 'STALE';
}): Record<string, unknown> {
  return {
    code: normalizeSymbolCodeAdr0505(input.row.code),
    sourceDate: input.sourceDate,
    foreignNetBuy: input.row.foreignNetBuy,
    institutionNetBuy: input.row.institutionNetBuy,
    individualNetBuy: input.row.individualNetBuy,
    status: input.status,
  };
}

export function krxInvestorRowToSemanticInputAdr0482(input: {
  row: KrxInvestorRow;
  sourceDate: string;
  status: 'VERIFIED' | 'STALE';
}): SemanticNetBuyInputPoint {
  return {
    code: normalizeSymbolCodeAdr0505(input.row.code),
    provider: 'KRX',
    sourceDate: input.sourceDate,
    rawForeignNetBuy: input.row.foreignNetBuy,
    rawInstitutionNetBuy: input.row.institutionNetBuy,
    rawIndividualNetBuy: input.row.individualNetBuy,
    unit: 'SHARES',
    status: input.status,
    sourceAgeTradingDays: input.status === 'STALE' ? 1 : 0,
    diagnostics: ['KRX_INVESTOR_FLOW previousTradingDate sample consumed by ADR-0482 as SHADOW_ONLY input.'],
  };
}


export function kisEvidenceToSemanticInputAdr0482(input: {
  code: string;
  evidence: Awaited<ReturnType<typeof fetchKisInvestorFlowEvidence>> | null;
}): SemanticNetBuyInputPoint | null {
  const data = input.evidence?.data;
  const sample = input.evidence?.sample;
  if (!data || sample?.sourceKind !== 'INVESTOR_TRADE_BY_STOCK_DAILY') return null;
  return {
    code: input.code,
    provider: 'KIS',
    sourceDate: data.tradingDate ?? sample.sourceDate ?? null,
    rawForeignNetBuy: data.foreignNetBuy,
    rawInstitutionNetBuy: data.institutionalNetBuy,
    rawIndividualNetBuy: data.individualNetBuy,
    unit: 'SHARES',
    status: sample.confidence === 'VERIFIED' ? 'VERIFIED' : 'PARTIAL',
    sourceAgeTradingDays: 0,
    providerSemanticCapable: true,
    diagnostics: [
      'inputSource=KIS_INVESTOR_TRADE_BY_STOCK_DAILY',
      'sourceKind=INVESTOR_TRADE_BY_STOCK_DAILY',
      'confidence=VERIFIED',
      'usableForSignal=true',
      'usableForExecution=false',
      'executionImpact=NONE',
    ],
  };
}

export function routedKisFlowToSemanticInputAdr0482(input: {
  code: string;
  routeResult: Awaited<ReturnType<typeof fetchInvestorFlowWithPolicy>> | null;
}): SemanticNetBuyInputPoint | null {
  const data = input.routeResult?.source === 'KIS_API' && input.routeResult.status === 'OK'
    ? input.routeResult.data
    : null;
  if (!data) return null;
  return {
    code: input.code,
    provider: 'KIS',
    sourceDate: data.tradingDate ?? null,
    rawForeignNetBuy: data.foreignNetBuy,
    rawInstitutionNetBuy: data.institutionalNetBuy,
    rawIndividualNetBuy: data.individualNetBuy,
    unit: 'SHARES',
    status: 'VERIFIED',
    sourceAgeTradingDays: 0,
    providerSemanticCapable: true,
    diagnostics: [
      'inputSource=KIS_INVESTOR_TRADE_BY_STOCK_DAILY',
      'sourceKind=INVESTOR_TRADE_BY_STOCK_DAILY',
      'confidence=VERIFIED',
      'usableForSignal=true',
      'usableForExecution=false',
      'executionImpact=NONE',
      'selectedBy=INVESTOR_FLOW_POLICY_ROUTER',
    ],
  };
}

export function routedKisFlowToAdr0477Raw(input: {
  code: string;
  routeResult: Awaited<ReturnType<typeof fetchInvestorFlowWithPolicy>> | null;
}): Record<string, unknown> | null {
  const data = input.routeResult?.source === 'KIS_API' && input.routeResult.status === 'OK'
    ? input.routeResult.data
    : null;
  if (!data) return null;
  return {
    code: input.code,
    sourceDate: data.tradingDate ?? null,
    foreignNetBuy: data.foreignNetBuy,
    institutionNetBuy: data.institutionalNetBuy,
    individualNetBuy: data.individualNetBuy,
    status: 'VERIFIED',
    provider: 'KIS_API',
    actualInvestorRow: data.actualInvestorRow ?? null,
    normalizedInvestorRow: data.normalizedInvestorRow ?? null,
    semanticInvestorRow: data.semanticInvestorRow ?? null,
    supplySemanticRow: data.supplySemanticRow ?? null,
    actualInvestorFlowRows: data.actualInvestorFlowRows ?? [],
    actualInvestorFlowRowCount: data.actualInvestorFlowRowCount ?? data.actualInvestorFlowRows?.length ?? 0,
    actualInvestorFlowRowSourcePath: data.actualInvestorFlowRowSourcePath ?? null,
    actualInvestorFlowFieldKeys: data.actualInvestorFlowFieldKeys ?? [],
    actualInvestorFlowNumericKeys: data.actualInvestorFlowNumericKeys ?? [],
    actualInvestorFlowNumericStringKeys: data.actualInvestorFlowNumericStringKeys ?? [],
    actualInvestorFlowCarried: data.actualInvestorFlowCarried ?? false,
  };
}

export function cacheLookupToSemanticInputAdr0482(input: {
  code: string;
  lookup: SupplySnapshotCacheLookupAdr0491 | null | undefined;
}): SemanticNetBuyInputPoint | null {
  const lookup = input.lookup;
  if (!lookup || (lookup.status !== 'CACHE_HIT' && lookup.status !== 'CACHE_STALE_HIT' && lookup.status !== 'STALE_HIT')) return null;
  const latest = lookup.snapshot?.latestInvestorFlowSample;
  const cacheRaw = lookup.cacheRaw ?? (latest ? {
    sourceDate: latest.dataDate,
    foreignNetBuy: latest.foreignNetBuy,
    institutionNetBuy: latest.institutionNetBuy,
    retailNetBuy: latest.retailNetBuy,
    status: lookup.status === 'CACHE_STALE_HIT' || lookup.status === 'STALE_HIT' ? 'STALE' : latest.status,
  } : null);
  const sourceDate = scanDiagnosticString(cacheRaw?.sourceDate);
  if (!sourceDate) return null;
  return {
    code: input.code,
    provider: 'CACHE',
    sourceDate,
    rawForeignNetBuy: scanDiagnosticNumber(cacheRaw?.foreignNetBuy),
    rawInstitutionNetBuy: scanDiagnosticNumber(cacheRaw?.institutionNetBuy),
    rawProgramNetBuy: scanDiagnosticNumber(cacheRaw?.programNetBuy),
    rawIndividualNetBuy: scanDiagnosticNumber(cacheRaw?.retailNetBuy),
    unit: 'KRW',
    status: lookup.stale || lookup.status === 'CACHE_STALE_HIT' || lookup.status === 'STALE_HIT' ? 'STALE' : 'VERIFIED',
    sourceAgeTradingDays: lookup.stale || lookup.status === 'CACHE_STALE_HIT' || lookup.status === 'STALE_HIT' ? 4 : 0,
    diagnostics: [`ADR-0491 ${lookup.status} sanitized CACHE fallback consumed by ADR-0482 as SHADOW_ONLY input; raw payload not persisted.`],
  };
}

export function krxDiagnosticToRouterInputAdr0505(
  diagnostic: KrxInvestorTradingDiagnostic | null,
  previousTradingDateCandidate: string,
): NonNullable<InvestorFlowProviderRouterInput['krxInvestorDiagnosticAdr0505']> | null {
  if (!diagnostic) return null;
  return {
    parserStatus: diagnostic.parserStatus,
    endpointIssueHint: diagnostic.endpointIssueHint,
    endpoint: diagnostic.endpoint,
    bld: diagnostic.bld,
    tradeDate: diagnostic.tradeDate,
    previousTradingDateCandidate,
    selectedKrxFlowMode: diagnostic.selectedKrxFlowMode,
    payloadMode: diagnostic.payloadMode,
    routePurpose: diagnostic.routePurpose,
    selectedBld: diagnostic.selectedBld,
    requiredParamMissing: diagnostic.requiredParamMissing,
    shortCodeToIsuCdResolved: diagnostic.shortCodeToIsuCdResolved,
    isuCd: diagnostic.isuCd,
    inqTpCd: diagnostic.inqTpCd,
    inqVal: diagnostic.inqVal,
    detailView: diagnostic.detailView,
    endpointVariant: diagnostic.endpointVariant,
    dateParam: diagnostic.dateParam,
    marketCode: diagnostic.marketCode,
    symbolCode: diagnostic.symbolCode,
    parameterKeys: diagnostic.parameterKeys,
    attemptedVariants: diagnostic.attemptedVariants,
    selectedVariant: diagnostic.selectedVariant,
    otpGenerated: diagnostic.otpGenerated,
    otpLength: diagnostic.otpLength,
    csvDownloaded: diagnostic.csvDownloaded,
    csvRowCount: diagnostic.csvRowCount,
    csvColumnKeys: diagnostic.csvColumnKeys,
    csvFailureReason: diagnostic.csvFailureReason,
    csvHeaderDetected: diagnostic.csvHeaderDetected,
    csvNoDataReason: diagnostic.csvNoDataReason,
    omittedKeys: diagnostic.omittedKeys,
    forbiddenKeysPresent: diagnostic.forbiddenKeysPresent,
    requiredKeysPresent: diagnostic.requiredKeysPresent,
    requiredKeysMissing: diagnostic.requiredKeysMissing,
    sentPayloadKeys: diagnostic.sentPayloadKeys,
    contentType: diagnostic.contentType,
    httpStatus: diagnostic.httpStatus,
    responseKind: diagnostic.responseKind,
    consecutiveFailures: diagnostic.consecutiveFailures,
    cooldownActive: diagnostic.cooldownActive,
    cooldownRemainingMs: diagnostic.cooldownRemainingMs,
    offHoursSuppressed: diagnostic.offHoursSuppressed,
    diagnosticOnly: diagnostic.diagnosticOnly,
    useForRouter: diagnostic.useForRouter,
    useForGate: diagnostic.useForGate,
    useForLive: diagnostic.useForLive,
    useForShadow: diagnostic.useForShadow,
    rawTopLevelKeys: diagnostic.rawTopLevelKeys,
    detectedCandidatePaths: diagnostic.detectedCandidatePaths,
    selectedRowPath: diagnostic.selectedRowPath,
    selectedRowCount: diagnostic.selectedRowCount,
    firstRowKeys: diagnostic.firstRowKeys,
    normalizedRows: diagnostic.normalizedRows,
    fieldMappings: diagnostic.fieldMappings,
    summary: diagnostic.summary,
  };
}

export function naverCollectorToSemanticInputAdr0482(result: NaverInvestorTrendCollectorResult): SemanticNetBuyInputPoint | null {
  const candidate = result.semanticNetBuyCandidate;
  if (!candidate) return null;
  return {
    code: result.code,
    provider: 'NAVER',
    sourceDate: candidate.sourceDate,
    rawForeignNetBuy: candidate.foreignNetBuy,
    rawInstitutionNetBuy: candidate.institutionNetBuy,
    rawProgramNetBuy: candidate.programNetBuy,
    unit: 'KRW',
    status: candidate.status,
    sourceAgeTradingDays: result.freshness.sourceAgeTradingDays,
    diagnostics: ['ADR-0481 NAVER collector candidate consumed by ADR-0482.'],
  };
}
