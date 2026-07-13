/**
 * @responsibility ADR-0477 fresh data adapter helpers.
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
import type { InvestorFlowProviderRouterInput, InvestorFlowProviderRouteResult, InvestorFlowProviderStatus, SemanticNetBuySample } from './types.js';
import type { InvestorFlowSource } from './semanticAdapters.js';
import { finiteNumber, normalizeSemanticNetBuySampleAdr0477 } from './primitives.js';
import { normalizeInvestorFlowSourceKey } from './semanticAdapters.js';

export function coverageFromStatuses(statuses: Record<string, InvestorFlowProviderStatus>): InvestorFlowProviderRouteResult['coverage'] {
  const values = Object.values(statuses);
  return {
    available: values.filter((status) => status === 'VERIFIED' || status === 'PARTIAL' || status === 'DEGRADED' || status === 'READY_FOR_SHADOW' || status === 'OBSERVING' || status === 'CACHE_HIT' || status === 'CACHE_STALE_HIT').length,
    total: values.length,
    missing: values.filter((status) => status === 'DATA_UNAVAILABLE' || status === 'NON_TRADING_DAY' || status === 'EMPTY' || status === 'PARSE_ERROR' || status === 'PROVIDER_ERROR' || status === 'PROVIDER_EMPTY_RESPONSE' || status === 'PARSER_KEY_MISMATCH' || status === 'PARSER_FIELD_MISMATCH' || status === 'MARKET_CLOSED_NO_PREVIOUS_SAMPLE' || status === 'DISABLED').length,
    stale: values.filter((status) => status === 'STALE' || status === 'DEGRADED').length,
    acceptedEmpty: values.filter((status) => status === 'ACCEPTED_EMPTY').length,
    providerMismatch: values.filter((status) => status === 'PROVIDER_MISMATCH').length,
    notWired: values.filter((status) => status === 'NOT_WIRED').length,
  };
}

export function cacheState(status: InvestorFlowProviderStatus | undefined): InvestorFlowProviderRouteResult['freshness']['cacheState'] {
  if (status === 'VERIFIED' || status === 'PARTIAL' || status === 'CACHE_HIT' || status === 'READY_FOR_SHADOW') return 'FRESH';
  if (status === 'STALE' || status === 'CACHE_STALE_HIT') return 'STALE';
  if (status === 'CACHE_EMPTY') return 'EMPTY';
  return 'UNKNOWN';
}

export function sourceState(age: number | null): InvestorFlowProviderRouteResult['freshness']['sourceState'] {
  if (age === null) return 'UNKNOWN';
  return age >= 4 ? 'STALE' : 'FRESH';
}


export function statusFromFreshDataSnapshot(snapshot: FreshDataSnapshotAdr0487): InvestorFlowProviderStatus {
  if (snapshot.status === 'READY_FOR_SHADOW') return 'READY_FOR_SHADOW';
  if (snapshot.status === 'NORMALIZED' || snapshot.status === 'FETCH_OK') return 'OBSERVING';
  if (snapshot.status === 'STALE' || snapshot.cacheState === 'STALE') return 'STALE';
  if (snapshot.status === 'CACHE_ONLY') return 'CACHE_STALE_HIT';
  if (snapshot.status === 'PROVIDER_ERROR') return 'PROVIDER_ERROR';
  if (snapshot.status === 'MISSING') return 'EMPTY';
  if (snapshot.status === 'DATA_UNAVAILABLE') return 'DATA_UNAVAILABLE';
  return 'UNKNOWN';
}

export function findFreshDataSnapshotAdr0477(
  report: FreshDataSupplyReportAdr0487 | null | undefined,
  sourceKey: InvestorFlowSource,
): FreshDataSnapshotAdr0487 | null {
  return report?.snapshots.find((row) => row.domain === 'SUPPLY' && normalizeInvestorFlowSourceKey(row.sourceId) === sourceKey) ?? null;
}

export function findFreshDataSnapshotBySourceIdAdr0477(
  report: FreshDataSupplyReportAdr0487 | null | undefined,
  sourceId: string,
): FreshDataSnapshotAdr0487 | null {
  return report?.snapshots.find((row) => row.domain === 'SUPPLY' && row.sourceId === sourceId) ?? null;
}

export function freshDataSnapshotMaterializedAdr0477(snapshot: FreshDataSnapshotAdr0487): boolean {
  if (typeof snapshot.sampleMaterialized === 'boolean') return snapshot.sampleMaterialized;
  return snapshot.normalized === true && snapshot.coverageRatio > 0 && snapshot.sourceDate !== null;
}

export function freshDataSnapshotUsableForRouterAdr0477(snapshot: FreshDataSnapshotAdr0487): boolean {
  if (typeof snapshot.usableForRouter === 'boolean') return snapshot.usableForRouter;
  return freshDataSnapshotMaterializedAdr0477(snapshot) && (snapshot.sourceState === 'FRESH' || snapshot.sourceState === 'STALE');
}

function freshDataSnapshotUsableForShadowAdr0477(snapshot: FreshDataSnapshotAdr0487): boolean {
  if (typeof snapshot.usableForShadow === 'boolean') return snapshot.usableForShadow;
  return freshDataSnapshotMaterializedAdr0477(snapshot);
}

export function freshDataSnapshotSampleAdr0477(
  report: FreshDataSupplyReportAdr0487 | null | undefined,
  sourceKey: InvestorFlowSource,
  code: string,
  collectedAt: string,
): SemanticNetBuySample | null {
  const snapshot = findFreshDataSnapshotAdr0477(report, sourceKey);
  if (!snapshot) return null;
  const status = statusFromFreshDataSnapshot(snapshot);
  const sampleMaterialized = freshDataSnapshotMaterializedAdr0477(snapshot);
  const usableForRouter = freshDataSnapshotUsableForRouterAdr0477(snapshot);
  const usableForShadow = freshDataSnapshotUsableForShadowAdr0477(snapshot);
  const selectableFresh = sampleMaterialized && usableForRouter && snapshot.normalized === true
    && (snapshot.stage === 'SHADOW_ONLY' || snapshot.stage === 'OBSERVE')
    && (status === 'READY_FOR_SHADOW' || status === 'OBSERVING' || status === 'VERIFIED');
  const selectableStale = sampleMaterialized && usableForShadow && snapshot.normalized === true
    && (snapshot.stage === 'SHADOW_ONLY' || snapshot.stage === 'OBSERVE')
    && (status === 'STALE' || status === 'CACHE_STALE_HIT');
  if (!selectableFresh && !selectableStale) return null;
  return {
    code,
    source: sourceKey,
    sourceDate: snapshot.sourceDate,
    collectedAt,
    foreignNetBuy: null,
    institutionNetBuy: null,
    programNetBuy: null,
    confidence: snapshot.confidence === 'NONE' ? 'LOW' : snapshot.confidence,
    status,
    signal: 'UNKNOWN',
    diagnostics: [
      'source=FRESH_DATA_REGISTRY',
      `sourceKeyNormalized=${sourceKey}`,
      `status=${status}`,
      `normalized=${String(snapshot.normalized)}`,
      `sampleMaterialized=${String(sampleMaterialized)}`,
      `usableForRouter=${String(usableForRouter)}`,
      `readinessKind=${snapshot.readinessKind ?? 'UNKNOWN'}`,
      `sourceOfTruth=${snapshot.sourceOfTruth ?? 'UNKNOWN'}`,
      'marketSignal=false because registry bridge carries sanitized readiness only',
    ],
  };
}


function compactRecordAdr0477(record: Record<string, unknown> | undefined): string {
  if (!record) return 'NONE';
  return Object.entries(record).map(([key, value]) => `${key}:${String(value)}`).join(',');
}

export function compactRetainedSummaryAdr0477(summary: NonNullable<SupplySnapshotCacheLookupAdr0491['debug']>['retainedSummary'] | undefined): string {
  if (!summary) return 'NONE';
  return `total=${summary.total};byDomain=${compactRecordAdr0477(summary.byDomain)};bySource=${compactRecordAdr0477(summary.bySource)};byProvider=${compactRecordAdr0477(summary.byProvider)};normalized=true:${summary.normalized.true},false:${summary.normalized.false},missing:${summary.normalized.missing};byTradingDate=${compactRecordAdr0477(summary.byTradingDate)};sampleKeys=${summary.sampleKeys.slice(0, 3).join(' || ')}`;
}

export function compactRouterLookupAdr0477(lookup: NonNullable<SupplySnapshotCacheLookupAdr0491['debug']>['routerLookup'] | undefined): string {
  if (!lookup) return 'NONE';
  return `requestedCode=${lookup.requestedCode};normalizedCode=${lookup.normalizedCode};route=${lookup.route};domainCandidates=${lookup.domainCandidates.join(',')};sourceCandidates=${lookup.sourceCandidates.join(',')};providerCandidates=${lookup.providerCandidates.join(',')};dateCandidates=${lookup.tradingDateCandidates.join(',')};requireNormalized=${String(lookup.requireNormalized)};allowStale=${String(lookup.allowStale)};rawPayloadPersistenceAllowed=false;liveExecutionAllowed=false`;
}

export function compactClosestMatchesAdr0477(matches: NonNullable<SupplySnapshotCacheLookupAdr0491['debug']>['closestMatches'] | undefined): string {
  if (!matches || matches.length === 0) return 'NONE';
  return matches.slice(0, 3).map((match, index) => `${index + 1}.code=${match.code} symbol=${match.symbol ?? 'NONE'} source=${match.source} provider=${match.provider} tradingDate=${match.tradingDate} sourceDate=${match.sourceDate ?? 'NONE'} normalized=${String(match.normalized)} reason=${match.reason}`).join(' || ');
}

export function cacheLookupStatusAdr0477(status: SupplySnapshotCacheLookupAdr0491['status']): InvestorFlowProviderStatus {
  if (status === 'CACHE_HIT') return 'CACHE_HIT';
  if (status === 'STALE_HIT' || status === 'CACHE_STALE_HIT') return 'CACHE_STALE_HIT';
  if (status === 'CACHE_KEY_MISMATCH') return 'CACHE_KEY_MISMATCH';
  if (status === 'CACHE_EMPTY') return 'CACHE_EMPTY';
  return 'ERROR';
}

export function krxDiagnosticStatusAdr0477(status: string | undefined): InvestorFlowProviderStatus {
  if (status === 'DISABLED_BY_KIS_FIRST_MODE') return 'DISABLED_BY_KIS_FIRST_MODE';
  if (status === 'OK') return 'VERIFIED';
  if (status === 'PROVIDER_EMPTY_RESPONSE') return 'PROVIDER_EMPTY_RESPONSE';
  if (status === 'PARSER_KEY_MISMATCH') return 'PARSER_KEY_MISMATCH';
  if (status === 'PARSER_FIELD_MISMATCH') return 'PARSER_FIELD_MISMATCH';
  if (status === 'MARKET_CLOSED_NO_PREVIOUS_SAMPLE') return 'MARKET_CLOSED_NO_PREVIOUS_SAMPLE';
  return 'DATA_UNAVAILABLE';
}

type KrxEmptyRecoveryKindAdr0477 =
  | 'NOT_EMPTY'
  | 'PARAMETER_MISMATCH'
  | 'ACCEPTED_EMPTY'
  | 'MARKET_CLOSED_NO_SAMPLE'
  | 'SCHEMA_OR_FIELD_MISMATCH'
  | 'PROVIDER_EMPTY';

interface KrxEmptyRecoveryDiagnosticAdr0477 {
  kind: KrxEmptyRecoveryKindAdr0477;
  providerIssue: boolean;
  marketSignal: false;
  executionImpact: 'NONE';
  diagnosticOnly: true;
  safeToFallback: boolean;
  recoveryAction: string;
}

function classifyKrxEmptyRecoveryAdr0477(
  input: NonNullable<InvestorFlowProviderRouterInput['krxInvestorDiagnosticAdr0505']>,
): KrxEmptyRecoveryDiagnosticAdr0477 {
  const status = input.parserStatus ?? input.status ?? 'DATA_UNAVAILABLE';
  if (status === 'OK') {
    return {
      kind: 'NOT_EMPTY',
      providerIssue: false,
      marketSignal: false,
      executionImpact: 'NONE',
      diagnosticOnly: true,
      safeToFallback: false,
      recoveryAction: 'KRX_SAMPLE_MATERIALIZED',
    };
  }
  if (String(status).startsWith('DISABLED_BY_')) {
    return {
      kind: 'NOT_EMPTY',
      providerIssue: false,
      marketSignal: false,
      executionImpact: 'NONE',
      diagnosticOnly: true,
      safeToFallback: false,
      recoveryAction: 'KRX_AUTO_FETCH_DISABLED_BY_POLICY',
    };
  }

  const csvReason = String(input.csvNoDataReason ?? input.csvFailureReason ?? '').toUpperCase();
  const endpointHint = String(input.endpointIssueHint ?? '').toUpperCase();
  const responseKind = String(input.responseKind ?? '').toUpperCase();
  const hasEmptyRowPath = (input.detectedCandidatePaths ?? []).some((path) => /:len=0\b/.test(path));
  const providerIssue = status !== 'MARKET_CLOSED_NO_PREVIOUS_SAMPLE';
  let kind: KrxEmptyRecoveryKindAdr0477 = 'PROVIDER_EMPTY';
  let recoveryAction = 'KEEP_KIS_OR_CACHE_CANONICAL_AND_OBSERVE_KRX';

  if (status === 'MARKET_CLOSED_NO_PREVIOUS_SAMPLE' || endpointHint.includes('MARKET_CLOSED')) {
    kind = 'MARKET_CLOSED_NO_SAMPLE';
    recoveryAction = 'WAIT_FOR_TRADING_SESSION_OR_PREVIOUS_SAMPLE';
  } else if (
    csvReason.includes('PARAMETER_MISMATCH') ||
    endpointHint.includes('ENDPOINT_PARAMETER_ERROR') ||
    input.httpStatus === 400
  ) {
    kind = 'PARAMETER_MISMATCH';
    recoveryAction = 'RETRY_KRX_PAYLOAD_VARIANTS_IN_OBSERVE_MODE';
  } else if (
    responseKind === 'EMPTY' ||
    input.httpStatus === 200 ||
    input.csvHeaderDetected === true ||
    hasEmptyRowPath
  ) {
    kind = 'ACCEPTED_EMPTY';
    recoveryAction = 'TREAT_AS_PROVIDER_EMPTY_NOT_MARKET_SIGNAL';
  } else if (status === 'PARSER_KEY_MISMATCH' || status === 'PARSER_FIELD_MISMATCH') {
    kind = 'SCHEMA_OR_FIELD_MISMATCH';
    recoveryAction = 'REPAIR_KRX_FIELD_MAPPING_IN_DIAGNOSTIC_MODE';
  }

  return {
    kind,
    providerIssue,
    marketSignal: false,
    executionImpact: 'NONE',
    diagnosticOnly: true,
    safeToFallback: true,
    recoveryAction,
  };
}

export function isKisFirstRebuildModeAdr0477(): boolean {
  return process.env.KIS_FIRST_REBUILD_MODE === 'true';
}

export function isKrxQuarantineDiagnosticAdr0477(input: NonNullable<InvestorFlowProviderRouterInput['krxInvestorDiagnosticAdr0505']>): boolean {
  return input.offHoursSuppressed === true
    && ((input.consecutiveFailures ?? 0) >= 2 || input.cooldownActive === true || input.useForRouter === false);
}

export function formatKrxRepairDiagnosticAdr0477(input: NonNullable<InvestorFlowProviderRouterInput['krxInvestorDiagnosticAdr0505']>): string {
  const fieldMappings = input.fieldMappings
    ? Object.entries(input.fieldMappings).map(([key, value]) => `${key}:${value ?? 'NONE'}`).join(',')
    : 'NONE';
  const emptyRecovery = classifyKrxEmptyRecoveryAdr0477(input);
  return [
    `KRX_INVESTOR_FLOW ${input.parserStatus ?? 'DATA_UNAVAILABLE'}`,
    `krxEmptyRecovery=${emptyRecovery.kind}`,
    `recoveryAction=${emptyRecovery.recoveryAction}`,
    `safeToFallback=${String(emptyRecovery.safeToFallback)}`,
    `endpoint=${input.endpoint ?? 'MDCSTAT02203'}`,
    `bld=${input.bld ?? 'UNKNOWN'}`,
    `tradeDate=${input.tradeDate ?? 'UNKNOWN'}`,
    `previousTradingDateCandidate=${input.previousTradingDateCandidate ?? 'UNKNOWN'}`,
    `selectedKrxFlowMode=${input.selectedKrxFlowMode ?? 'UNKNOWN'}`,
    `payloadMode=${input.payloadMode ?? 'UNKNOWN'}`,
    `routePurpose=${input.routePurpose ?? 'UNKNOWN'}`,
    `selectedBld=${input.selectedBld ?? input.bld ?? 'UNKNOWN'}`,
    `requiredParamMissing=${input.requiredParamMissing ?? 'NONE'}`,
    `shortCodeToIsuCdResolved=${String(input.shortCodeToIsuCdResolved ?? false)}`,
    `isuCd=${input.isuCd ?? 'NONE'}`,
    `inqTpCd=${input.inqTpCd ?? 'NONE'}`,
    `inqVal=${input.inqVal ?? 'NONE'}`,
    `detailView=${input.detailView ?? 'NONE'}`,
    `endpointVariant=${input.endpointVariant ?? 'UNKNOWN'}`,
    `dateParam=${input.dateParam ?? 'UNKNOWN'}`,
    `marketCode=${input.marketCode ?? 'UNKNOWN'}`,
    `symbolCode=${input.symbolCode ?? 'NONE'}`,
    'symbolCodeFormat=6_DIGIT',
    `parameterKeys=${input.parameterKeys?.join(',') || 'UNKNOWN'}`,
    `attemptedVariants=${input.attemptedVariants?.join('|') || 'UNKNOWN'}`,
    `selectedVariant=${input.selectedVariant ?? 'NONE'}`,
    `otpGenerated=${String(input.otpGenerated ?? false)}`,
    `otpLength=${input.otpLength ?? 0}`,
    `csvDownloaded=${String(input.csvDownloaded ?? false)}`,
    `csvRowCount=${input.csvRowCount ?? 0}`,
    `csvColumnKeys=${input.csvColumnKeys?.join(',') || 'NONE'}`,
    `csvFailureReason=${input.csvFailureReason ?? 'NONE'}`,
    `csvHeaderDetected=${String(input.csvHeaderDetected ?? false)}`,
    `csvNoDataReason=${input.csvNoDataReason ?? 'NONE'}`,
    `omittedKeys=${input.omittedKeys?.join(',') || 'NONE'}`,
    `forbiddenKeysPresent=${input.forbiddenKeysPresent?.join(',') || 'NONE'}`,
    `requiredKeysPresent=${input.requiredKeysPresent?.join(',') || 'NONE'}`,
    `requiredKeysMissing=${input.requiredKeysMissing?.join(',') || 'NONE'}`,
    `sentPayloadKeys=${input.sentPayloadKeys?.join(',') || 'NONE'}`,
    `contentType=${input.contentType ?? 'unknown'}`,
    `responseKind=${input.responseKind ?? 'UNKNOWN'}`,
    `httpStatus=${input.httpStatus ?? 'NONE'}`,
    `consecutiveFailures=${input.consecutiveFailures ?? 0}`,
    `cooldownActive=${String(input.cooldownActive ?? false)}`,
    `cooldownRemainingMs=${input.cooldownRemainingMs ?? 0}`,
    `offHoursSuppressed=${String(input.offHoursSuppressed ?? false)}`,
    `diagnosticOnly=${String(input.diagnosticOnly ?? false)}`,
    `useForRouter=${String(input.useForRouter ?? true)}`,
    `useForGate=${String(input.useForGate ?? true)}`,
    `useForLive=${String(input.useForLive ?? false)}`,
    `useForShadow=${String(input.useForShadow ?? true)}`,
    `endpointIssueHint=${input.endpointIssueHint ?? 'UNKNOWN'}`,
    `rawTopLevelKeys=${input.rawTopLevelKeys?.join(',') || 'NONE'}`,
    `responseKeySummary=${input.detectedCandidatePaths?.join(',') || 'NONE'}`,
    `selectedRowPath=${input.selectedRowPath ?? 'NONE'}`,
    `selectedRowCount=${input.selectedRowCount ?? 0}`,
    `normalizedRows=${input.normalizedRows ?? 0}`,
    `firstRowKeys=${input.firstRowKeys?.join(',') || 'NONE'}`,
    `fieldMappings=${fieldMappings}`,
    `providerIssue=${String(emptyRecovery.providerIssue)}`,
    `marketSignal=${String(emptyRecovery.marketSignal)}`,
    `diagnosticOnly=${String(emptyRecovery.diagnosticOnly)}`,
    `executionImpact=${emptyRecovery.executionImpact}`,
    '[PROVIDER_HEALTH_SEPARATED_FROM_MARKET_SIGNAL]',
  ].join('; ');
}

export function isOptionalKrxInvestorDetailUnavailableAdr0477(input: NonNullable<InvestorFlowProviderRouterInput['krxInvestorDiagnosticAdr0505']>): boolean {
  const endpoint = String(input.endpoint ?? input.selectedBld ?? input.bld ?? '');
  const optionalDetailEndpoint = endpoint.includes('MDCSTAT02201') || endpoint.includes('MDCSTAT02203');
  if (!optionalDetailEndpoint) return false;
  if (input.offHoursSuppressed === true) return false;
  const summary = String(input.summary ?? '');
  return input.httpStatus === 400 ||
    (input.responseKind === 'HTTP_ERROR' && input.endpointIssueHint === 'ENDPOINT_PARAMETER_ERROR') ||
    summary.includes('BAD_REQUEST_SESSION_OR_PARAM') ||
    summary.includes('ENDPOINT_PARAM_NOT_READY') ||
    summary.includes('OPTIONAL_KRX_DETAIL_UNAVAILABLE');
}

export function krxOptionalDetailExcludedReasonAdr0477(input: NonNullable<InvestorFlowProviderRouterInput['krxInvestorDiagnosticAdr0505']>): string {
  if (input.httpStatus === 400 || input.responseKind === 'HTTP_ERROR') return 'HTTP_400_OR_DISABLED';
  if (input.useForRouter === false || input.diagnosticOnly === true) return 'OPTIONAL_DIAGNOSTIC_ONLY';
  return 'OPTIONAL_KRX_DETAIL_UNAVAILABLE';
}

export function sampleFromCacheLookupAdr0491(
  lookup: SupplySnapshotCacheLookupAdr0491 | null | undefined,
  code: string,
  collectedAt: string,
): SemanticNetBuySample | null {
  const status = lookup ? cacheLookupStatusAdr0477(lookup.status) : 'CACHE_EMPTY';
  if (!lookup || (status !== 'CACHE_HIT' && status !== 'CACHE_STALE_HIT')) return null;
  const latest = lookup.snapshot?.latestInvestorFlowSample;
  const snapshotRaw = latest ? {
    code,
    sourceDate: latest.dataDate,
    foreignNetBuy: latest.foreignNetBuy,
    institutionNetBuy: latest.institutionNetBuy,
    individualNetBuy: latest.retailNetBuy,
    status: status === 'CACHE_STALE_HIT' ? 'STALE' : 'CACHE_HIT',
  } : null;
  const cacheRaw = lookup.cacheRaw ?? snapshotRaw;
  if (!cacheRaw) return null;
  const sample = normalizeSemanticNetBuySampleAdr0477(cacheRaw, 'CACHE', {
    code,
    collectedAt,
    fallbackStatus: status === 'CACHE_STALE_HIT' ? 'CACHE_STALE_HIT' : 'CACHE_HIT',
  });
  const hasRows = finiteNumber(sample.foreignNetBuy) || finiteNumber(sample.institutionNetBuy) || finiteNumber(sample.programNetBuy);
  return hasRows ? sample : null;
}

export function materializationFromSemanticSampleAdr0477(
  providerName: InvestorSampleProviderNameAdr0502,
  sample: SemanticNetBuySample | null,
  inputSourceKind: 'RAW_PROVIDER' | 'NORMALIZED_PROVIDER' | 'SEMANTIC_DERIVED' | 'CACHE_FALLBACK' | 'PLACEHOLDER' | 'NONE',
  blockedReason?: InvestorSampleDiagnosticsAdr0502['blockedReason'],
): InvestorSampleDiagnosticsAdr0502 {
  const materializedCount = sample && (finiteNumber(sample.foreignNetBuy) || finiteNumber(sample.institutionNetBuy) || finiteNumber(sample.programNetBuy)) ? 1 : 0;
  const fieldCount = sample ? [sample.foreignNetBuy, sample.institutionNetBuy, sample.programNetBuy].filter(finiteNumber).length : 0;
  return buildInvestorSampleDiagnosticsAdr0502({
    providerName,
    rawFetched: Boolean(sample),
    rawCount: sample ? 1 : 0,
    normalizedCount: sample ? 1 : 0,
    materializedCount,
    symbolCoverage: sample?.code ? 1 : 0,
    dateCoverage: sample?.sourceDate ?? null,
    fieldCoverage: fieldCount / 3,
    placeholderDetected: !sample || materializedCount === 0,
    inputSourceKind,
    inputSources: [providerName],
    confidenceLevel: sample?.confidence === 'HIGH' ? 'VERIFIED' : sample?.confidence === 'MEDIUM' ? 'PARTIAL' : sample?.confidence === 'LOW' ? 'LOW' : 'MISSING',
    staleReason: sample?.status === 'STALE' || sample?.status === 'CACHE_STALE_HIT' ? `status=${sample.status}` : null,
    blockedReason: materializedCount > 0 ? 'NONE' : blockedReason,
    safePreview: sample ? [{
      code: sample.code,
      sourceDate: sample.sourceDate,
      foreignNetBuy: sample.foreignNetBuy,
      institutionNetBuy: sample.institutionNetBuy,
      programNetBuy: sample.programNetBuy,
    }] : [],
  });
}
