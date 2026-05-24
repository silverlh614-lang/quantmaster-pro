// @responsibility Official sector index code API verification and coverage aggregation.

import type {
  OfficialSectorIndexCodeMapResult,
  OfficialSectorIndexCodeMappingRow,
  OfficialSectorIndexMappingAttempt,
  OfficialSectorIndexTarget,
  OfficialSectorIndexAliasDictionaryStatus,
  OfficialSectorIndexUnresolvedSectorReason,
} from './SectorIndexCodeMap.js';
import {
  canonicalizeOfficialIndexName,
  getOfficialSectorIndexAliasDictionaryStatus,
  mapSectorNamesToOfficialIndexCodes,
  type OfficialSectorIndexMasterRow,
} from './SectorIndexCodeMap.js';
import type { SectorIndexMasterProviderResult } from './SectorIndexMasterProvider.js';
import type {
  KisIndexQuoteClientStatus,
  KisSectorIndexVerifyTransportStage,
  KisSectorIndexVerifyVariantPolicy,
} from '../clients/kisClient/types.js';

export const KIS_SECTOR_INDEX_VERIFY_API_PATH =
  '/uapi/domestic-stock/v1/quotations/inquire-index-price';
export const KIS_SECTOR_INDEX_VERIFY_TR_ID = 'FHPUP02100000';

export interface OfficialSectorIndexVerifyResult {
  officialIndexCode: string;
  sectorName: string;
  rawIdxName?: string | null;
  idxDiv?: string | null;
  idxCode?: string | null;
  canonicalOfficialName?: string | null;
  fidCondMrktDivCode?: string;
  fidInputIscd?: string;
  verifiedInputIscd?: string | null;
  verifyInputCandidates?: string[];
  triedCandidates?: string[];
  verified: boolean;
  providerIssue: boolean;
  marketSignal: false;
  executionImpact: 'NONE';
  reasonCode: string;
  selectedFailureReason?: string;
  clientStatus?: KisIndexQuoteClientStatus;
  verifyVariantPolicy?: KisSectorIndexVerifyVariantPolicy;
  httpStatus?: number | null;
  rtCd?: string | null;
  msgCd?: string | null;
  msg1?: string | null;
  method?: 'GET';
  baseUrlKind?: 'REAL' | 'VIRTUAL' | 'UNKNOWN';
  requestBuilt?: boolean;
  requestSent?: boolean;
  outputShape?: string | null;
  indexValueFieldName?: string | null;
  currentIndex?: number | null;
  exceptionClass?: string | null;
  exceptionMessageSanitized?: string | null;
  timeoutMs?: number | null;
  retryCount?: number;
  transportStage?: KisSectorIndexVerifyTransportStage;
  outputPresent?: boolean;
  indexValueFieldPresent?: boolean;
  rawTopLevelKeys?: string[];
  outputKeys?: string[];
  attempts?: OfficialSectorIndexVerifyAttempt[];
  fetchedAt?: string;
}

export interface OfficialSectorIndexVerifyAttempt {
  sectorName: string;
  rawIdxName?: string | null;
  idxDiv?: string | null;
  idxCode?: string | null;
  canonicalOfficialName?: string | null;
  fidCondMrktDivCode: string;
  fidInputIscd: string;
  apiPath: typeof KIS_SECTOR_INDEX_VERIFY_API_PATH;
  method?: 'GET';
  trId: typeof KIS_SECTOR_INDEX_VERIFY_TR_ID;
  baseUrlKind?: 'REAL' | 'VIRTUAL' | 'UNKNOWN';
  requestBuilt?: boolean;
  requestSent?: boolean;
  httpStatus?: number | null;
  rtCd?: string | null;
  msgCd?: string | null;
  msg1?: string | null;
  outputShape?: string | null;
  indexValueFieldName?: string | null;
  currentIndex?: number | null;
  exceptionClass?: string | null;
  exceptionMessageSanitized?: string | null;
  timeoutMs?: number | null;
  retryCount?: number;
  transportStage?: KisSectorIndexVerifyTransportStage;
  outputPresent: boolean;
  indexValueFieldPresent: boolean;
  rawTopLevelKeys: string[];
  outputKeys: string[];
  verified: boolean;
  reasonCode: string;
}

export interface SectorIndexCoverageDenominator {
  internalGroupedSectorCount?: number;
  officialTargetSectorCount: number;
  safePromotionEligibleSectorCount: number;
  unsafeAliasSectorCount: number;
  unresolvedSectorCount: number;
  verifiedSuccessCount: number;
}

export interface SectorIndexCoverageMetrics {
  officialIndexCoverageByOfficialTarget: number;
  verifiedCoverageByOfficialTarget: number;
  verifiedCoverageByInternalGrouped?: number;
  verifiedCoverageExcludingUnsafeAlias: number;
  promotionVerifiedCoverage: number;
}

export interface SectorIndexUnsafeAliasPolicy {
  includeInPromotionDenominator: true;
  includeInPromotionNumerator: false;
  useForShadowEvidence: true;
  reason: 'THEME_TO_OFFICIAL_SECTOR_AMBIGUOUS';
}

export interface SectorIndexPromotionCoveragePolicy {
  selectedMetric: 'officialTargetVerifiedCoverage';
  numerator: number;
  denominator: number;
  requiredVerifiedCoverage: 80;
  selectedCoverageValue: number;
  promotionAllowed: boolean;
  reason: 'VERIFIED_INDEX_CODE_COVERAGE_LOW' | 'VERIFIED_INDEX_CODE_COVERAGE_READY';
  alternativeInternalGroupedCoverage?: number;
  executionImpact: 'NONE';
}

export interface SectorIndexValueQuality {
  apiVerifiedCount: number;
  zeroCurrentIndexCount: number;
  nonZeroCurrentIndexCount: number;
  qualityUsableCount: number;
  qualityUsableCoverageByOfficialTarget: number;
  qualityUsableCoverageExcludingUnsafeAlias: number;
  zeroCurrentIndexSymbols: string[];
  zeroCurrentIndexPolicy: 'OBSERVE_ONLY';
  qualityImpact: 'BLOCK_LIVE_PROMOTION_ONLY' | 'NONE';
  executionImpact: 'NONE';
}

export interface SectorIndexQualityResult {
  sectorName: string;
  rawIdxName?: string | null;
  idxDiv?: string | null;
  idxCode?: string | null;
  verified: boolean;
  currentIndex: number | null;
  qualityUsable: boolean;
  qualityReason: 'OK' | 'CURRENT_INDEX_ZERO' | 'VALUE_PARSE_FAILED' | 'STALE';
  useForShadowLeadership: true;
  useForLivePromotion: boolean;
  executionImpact: 'NONE';
}

export interface SectorIndexPromotionReadiness {
  officialTargetSectorCount: number;
  safePromotionEligibleSectorCount: number;
  unsafeAliasSectorCount: number;
  unresolvedSectorCount: number;
  verifiedSuccessCount: number;
  qualityUsableCount: number;
  verifiedCoverageByOfficialTarget: number;
  verifiedCoverageExcludingUnsafeAlias: number;
  qualityUsableCoverageByOfficialTarget: number;
  qualityUsableCoverageExcludingUnsafeAlias: number;
  selectedPromotionMetric: 'officialTargetVerifiedCoverage';
  selectedPromotionCoverage: number;
  requiredPromotionCoverage: 80;
  qualityGatePassed: boolean;
  promotionAllowed: boolean;
  reason: 'VERIFIED_INDEX_CODE_COVERAGE_LOW' | 'INDEX_VALUE_QUALITY_LOW' | 'READY_FOR_PROMOTION';
  safeOnlyMetricWouldPass: boolean;
  useAlternativeForLivePromotion: false;
  alternativePolicyReason: 'OFFICIAL_TARGET_POLICY_SELECTED_FOR_SAFETY';
  executionImpact: 'NONE';
}

export interface VerifyOfficialSectorIndexCodesInput {
  mappingRows: readonly OfficialSectorIndexCodeMappingRow[];
  verifyIndexCode?: (row: OfficialSectorIndexCodeMappingRow) => Promise<OfficialSectorIndexVerifyResult>;
}

export interface OfficialSectorIndexMasterCoverageResult {
  masterSource: 'OFFICIAL_KIS_IDXCODE_MST' | 'OFFICIAL_KRX_INDEX_MASTER' | 'OFFICIAL_KRX_SECTOR_INDEX_MASTER' | 'CACHE' | 'NONE';
  masterLoaded: boolean;
  masterRowCount: number;
  idxcodeMstDownloaded: boolean;
  cacheFallbackUsed: boolean;
  parseStatus: string;
  rows?: readonly OfficialSectorIndexMasterRow[];
  rawSampleRows?: Array<{
    idxDiv?: string;
    idxCode: string;
    idxName: string;
    rawIdxName?: string;
    normalizedIdxName: string;
    canonicalOfficialName?: string;
    codePrefixRemoved?: boolean;
    verifyInputCandidates?: string[];
  }>;
  idxNameSampleTop?: string[];
  aliasDictionaryStatus?: OfficialSectorIndexAliasDictionaryStatus;
  officialIndexCoverage: number;
  verifiedIndexCodeCoverage: number;
  mappedSectorCount: number;
  verifiedIndexCodeCount: number;
  targetSectorCount: number;
  coverageDenominator?: SectorIndexCoverageDenominator;
  coverageMetrics?: SectorIndexCoverageMetrics;
  unsafeAliasPolicy?: SectorIndexUnsafeAliasPolicy;
  promotionCoveragePolicy?: SectorIndexPromotionCoveragePolicy;
  indexValueQuality?: SectorIndexValueQuality;
  sectorIndexQuality?: SectorIndexQualityResult[];
  promotionReadiness?: SectorIndexPromotionReadiness;
  officialIndexCoverageByOfficialTarget?: number;
  verifiedCoverageByOfficialTarget?: number;
  verifiedCoverageByInternalGrouped?: number;
  verifiedCoverageExcludingUnsafeAlias?: number;
  promotionVerifiedCoverage?: number;
  safeAliasCoverage?: number;
  exactMatchCount?: number;
  safeAliasMatchCount?: number;
  safeSynonymMatchCount?: number;
  safeAliasCount: number;
  unsafeAliasCount: number;
  unsafeAliasSectorNames?: string[];
  mappedSectorPairs?: string[];
  unresolvedCount?: number;
  sourceTier?: 'OFFICIAL_KRX_SECTOR_INDEX' | 'OFFICIAL_KIS_SECTOR_INDEX' | 'CACHE' | 'NONE';
  aliasResolvedCount: number;
  unresolvedSectorNames: string[];
  unresolvedSectorDetails?: OfficialSectorIndexUnresolvedSectorReason[];
  topMissingSectorNames: string[];
  internalSectorNames?: string[];
  normalizedInternalSectorNames?: string[];
  mappingAttempts?: OfficialSectorIndexMappingAttempt[];
  verifyApiPath: typeof KIS_SECTOR_INDEX_VERIFY_API_PATH;
  verifyTrId: typeof KIS_SECTOR_INDEX_VERIFY_TR_ID;
  verifyAttemptCount?: number;
  verifySuccessCount: number;
  verifyFailCount: number;
  verifyApiSuccessSamples?: OfficialSectorIndexVerifyResult[];
  verifyApiFailureSamples?: OfficialSectorIndexVerifyResult[];
  verifyAttemptDetails?: OfficialSectorIndexVerifyAttempt[];
  verifyVariantAttemptCount?: number;
  verifyVariantTried?: boolean;
  verifyVariantPolicy?: KisSectorIndexVerifyVariantPolicy;
  kisIndexQuoteClientStatus?: KisIndexQuoteClientStatus;
  providerIssue: boolean;
  marketSignal: false;
  executionImpact: 'NONE';
  reasonCodes: string[];
  mappingRows: OfficialSectorIndexCodeMappingRow[];
  verificationResults: OfficialSectorIndexVerifyResult[];
}

function pct(count: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((count / total) * 1000) / 10;
}

function uniqueVerifyResultKey(result: OfficialSectorIndexVerifyResult): string {
  return [
    result.sectorName,
    result.idxDiv ?? '',
    result.idxCode ?? result.officialIndexCode,
  ].join('|');
}

function representativeCurrentIndex(result: OfficialSectorIndexVerifyResult): number | null {
  if (typeof result.currentIndex === 'number' && Number.isFinite(result.currentIndex)) {
    return result.currentIndex;
  }
  const verifiedAttempt = result.attempts?.find((attempt) =>
    attempt.verified && typeof attempt.currentIndex === 'number' && Number.isFinite(attempt.currentIndex),
  );
  if (verifiedAttempt && typeof verifiedAttempt.currentIndex === 'number') return verifiedAttempt.currentIndex;
  const schemaAttempt = result.attempts?.find((attempt) =>
    attempt.indexValueFieldPresent && typeof attempt.currentIndex === 'number' && Number.isFinite(attempt.currentIndex),
  );
  return typeof schemaAttempt?.currentIndex === 'number' ? schemaAttempt.currentIndex : null;
}

function buildSectorIndexQuality(results: readonly OfficialSectorIndexVerifyResult[]): SectorIndexQualityResult[] {
  const seen = new Set<string>();
  const qualityRows: SectorIndexQualityResult[] = [];
  for (const result of results) {
    const currentIndex = representativeCurrentIndex(result);
    const key = uniqueVerifyResultKey(result);
    if (seen.has(key)) continue;
    seen.add(key);
    const qualityReason: SectorIndexQualityResult['qualityReason'] =
      !result.verified ? 'VALUE_PARSE_FAILED'
        : currentIndex === null ? 'VALUE_PARSE_FAILED'
          : currentIndex === 0 ? 'CURRENT_INDEX_ZERO'
            : 'OK';
    const qualityUsable = qualityReason === 'OK';
    qualityRows.push({
      sectorName: result.sectorName,
      rawIdxName: result.rawIdxName,
      idxDiv: result.idxDiv,
      idxCode: result.idxCode,
      verified: result.verified,
      currentIndex,
      qualityUsable,
      qualityReason,
      useForShadowLeadership: true,
      useForLivePromotion: qualityUsable,
      executionImpact: 'NONE',
    });
  }
  return qualityRows;
}

function buildIndexValueQuality(input: {
  qualityRows: readonly SectorIndexQualityResult[];
  officialTargetSectorCount: number;
  safePromotionEligibleSectorCount: number;
}): SectorIndexValueQuality {
  const verifiedRows = input.qualityRows.filter((row) => row.verified);
  const zeroCurrentIndexSymbols = verifiedRows
    .filter((row) => row.qualityReason === 'CURRENT_INDEX_ZERO')
    .map((row) => row.sectorName);
  const qualityUsableCount = verifiedRows.filter((row) => row.qualityUsable).length;
  return {
    apiVerifiedCount: verifiedRows.length,
    zeroCurrentIndexCount: zeroCurrentIndexSymbols.length,
    nonZeroCurrentIndexCount: verifiedRows.filter((row) =>
      typeof row.currentIndex === 'number' && row.currentIndex > 0,
    ).length,
    qualityUsableCount,
    qualityUsableCoverageByOfficialTarget: pct(qualityUsableCount, input.officialTargetSectorCount),
    qualityUsableCoverageExcludingUnsafeAlias: pct(qualityUsableCount, input.safePromotionEligibleSectorCount),
    zeroCurrentIndexSymbols,
    zeroCurrentIndexPolicy: 'OBSERVE_ONLY',
    qualityImpact: zeroCurrentIndexSymbols.length > 0 ? 'BLOCK_LIVE_PROMOTION_ONLY' : 'NONE',
    executionImpact: 'NONE',
  };
}

function mappingVerifyKey(input: {
  sectorName?: string | null;
  idxDiv?: string | null;
  officialIndexCode?: string | null;
  idxCode?: string | null;
}): string {
  return [
    input.sectorName ?? '',
    input.idxDiv ?? '',
    input.officialIndexCode ?? input.idxCode ?? '',
  ].join('|');
}

async function defaultVerifyIndexCode(
  row: OfficialSectorIndexCodeMappingRow,
): Promise<OfficialSectorIndexVerifyResult> {
  return {
    officialIndexCode: row.officialIndexCode ?? '',
    sectorName: row.sectorName,
    rawIdxName: row.rawIdxName,
    idxDiv: row.idxDiv,
    idxCode: row.idxCode,
    canonicalOfficialName: row.canonicalOfficialName,
    fidCondMrktDivCode: 'U',
    fidInputIscd: row.verifyInputCandidates[0] ?? row.officialIndexCode ?? '',
    verifiedInputIscd: null,
    verifyInputCandidates: row.verifyInputCandidates,
    triedCandidates: [],
    verified: false,
    providerIssue: false,
    marketSignal: false,
    executionImpact: 'NONE',
    reasonCode: 'OFFICIAL_INDEX_VERIFY_NOT_CONFIGURED',
  };
}

export async function verifyOfficialSectorIndexCodes(
  input: VerifyOfficialSectorIndexCodesInput,
): Promise<OfficialSectorIndexVerifyResult[]> {
  const verifyIndexCode = input.verifyIndexCode ?? defaultVerifyIndexCode;
  const eligibleRows = input.mappingRows.filter((row) =>
    row.officialCoverageEligible && Boolean(row.officialIndexCode),
  );
  const results: OfficialSectorIndexVerifyResult[] = [];
  for (const row of eligibleRows) {
    try {
      results.push(await verifyIndexCode(row));
    } catch {
      results.push({
        officialIndexCode: row.officialIndexCode ?? '',
        sectorName: row.sectorName,
        rawIdxName: row.rawIdxName,
        idxDiv: row.idxDiv,
        idxCode: row.idxCode,
        canonicalOfficialName: row.canonicalOfficialName,
        fidCondMrktDivCode: 'U',
        fidInputIscd: row.verifyInputCandidates[0] ?? row.officialIndexCode ?? '',
        verifiedInputIscd: null,
        verifyInputCandidates: row.verifyInputCandidates,
        triedCandidates: row.verifyInputCandidates,
        verified: false,
        providerIssue: true,
        marketSignal: false,
        executionImpact: 'NONE',
        reasonCode: 'OFFICIAL_INDEX_API_VERIFY_FAILED',
        selectedFailureReason: 'KIS_INDEX_API_HTTP_ERROR',
      });
    }
  }
  return results;
}

export async function buildOfficialSectorIndexMasterCoverage(input: {
  provider: SectorIndexMasterProviderResult | null;
  targets: readonly OfficialSectorIndexTarget[];
  masterRows?: readonly OfficialSectorIndexMasterRow[];
  verifyIndexCode?: (row: OfficialSectorIndexCodeMappingRow) => Promise<OfficialSectorIndexVerifyResult>;
}): Promise<OfficialSectorIndexMasterCoverageResult> {
  const provider = input.provider;
  const masterRows = input.masterRows ?? provider?.rows ?? [];
  const mapping: OfficialSectorIndexCodeMapResult = mapSectorNamesToOfficialIndexCodes({
    targets: input.targets,
    masterRows,
  });
  const aliasDictionaryStatus = getOfficialSectorIndexAliasDictionaryStatus();
  const verificationResults = await verifyOfficialSectorIndexCodes({
    mappingRows: mapping.rows,
    verifyIndexCode: input.verifyIndexCode,
  });
  const verificationByCode = new Map(verificationResults.map((result) => [mappingVerifyKey(result), result]));
  const verificationByLooseCode = new Map(verificationResults.map((result) => [
    `${result.sectorName}|${result.officialIndexCode}`,
    result,
  ]));
  const verifySuccessCount = verificationResults.filter((result) => result.verified).length;
  const verifyFailCount = verificationResults.length - verifySuccessCount;
  const verifyAttemptDetails = verificationResults.flatMap((result) => result.attempts ?? []);
  const verifyVariantAttemptCount = verifyAttemptDetails.length || verificationResults.length;
  const verifyVariantPolicy = verificationResults.find((result) => result.verifyVariantPolicy)?.verifyVariantPolicy;
  const kisIndexQuoteClientStatus = verificationResults.find((result) => result.clientStatus)?.clientStatus;
  const verifiedIndexCodeCoverage = pct(verifySuccessCount, mapping.targetSectorCount);
  const safePromotionEligibleSectorCount = mapping.rows.filter((row) =>
    row.officialCoverageEligible && !row.unsafeAlias && Boolean(row.officialIndexCode),
  ).length;
  const verifiedCoverageExcludingUnsafeAlias = pct(verifySuccessCount, safePromotionEligibleSectorCount);
  const coverageDenominator: SectorIndexCoverageDenominator = {
    officialTargetSectorCount: mapping.targetSectorCount,
    safePromotionEligibleSectorCount,
    unsafeAliasSectorCount: mapping.unsafeAliasCount,
    unresolvedSectorCount: mapping.unresolvedSectorNames.length,
    verifiedSuccessCount: verifySuccessCount,
  };
  const coverageMetrics: SectorIndexCoverageMetrics = {
    officialIndexCoverageByOfficialTarget: mapping.officialIndexCoverage,
    verifiedCoverageByOfficialTarget: verifiedIndexCodeCoverage,
    verifiedCoverageExcludingUnsafeAlias,
    promotionVerifiedCoverage: verifiedIndexCodeCoverage,
  };
  const unsafeAliasPolicy: SectorIndexUnsafeAliasPolicy = {
    includeInPromotionDenominator: true,
    includeInPromotionNumerator: false,
    useForShadowEvidence: true,
    reason: 'THEME_TO_OFFICIAL_SECTOR_AMBIGUOUS',
  };
  const promotionCoveragePolicy: SectorIndexPromotionCoveragePolicy = {
    selectedMetric: 'officialTargetVerifiedCoverage',
    numerator: verifySuccessCount,
    denominator: mapping.targetSectorCount,
    requiredVerifiedCoverage: 80,
    selectedCoverageValue: verifiedIndexCodeCoverage,
    promotionAllowed: verifiedIndexCodeCoverage >= 80,
    reason: verifiedIndexCodeCoverage >= 80
      ? 'VERIFIED_INDEX_CODE_COVERAGE_READY'
      : 'VERIFIED_INDEX_CODE_COVERAGE_LOW',
    executionImpact: 'NONE',
  };
  const sectorIndexQuality = buildSectorIndexQuality(verificationResults);
  const indexValueQuality = buildIndexValueQuality({
    qualityRows: sectorIndexQuality,
    officialTargetSectorCount: mapping.targetSectorCount,
    safePromotionEligibleSectorCount,
  });
  const qualityGatePassed = indexValueQuality.qualityUsableCoverageByOfficialTarget >= 80;
  const promotionReadiness: SectorIndexPromotionReadiness = {
    officialTargetSectorCount: mapping.targetSectorCount,
    safePromotionEligibleSectorCount,
    unsafeAliasSectorCount: mapping.unsafeAliasCount,
    unresolvedSectorCount: mapping.unresolvedSectorNames.length,
    verifiedSuccessCount: verifySuccessCount,
    qualityUsableCount: indexValueQuality.qualityUsableCount,
    verifiedCoverageByOfficialTarget: verifiedIndexCodeCoverage,
    verifiedCoverageExcludingUnsafeAlias,
    qualityUsableCoverageByOfficialTarget: indexValueQuality.qualityUsableCoverageByOfficialTarget,
    qualityUsableCoverageExcludingUnsafeAlias: indexValueQuality.qualityUsableCoverageExcludingUnsafeAlias,
    selectedPromotionMetric: 'officialTargetVerifiedCoverage',
    selectedPromotionCoverage: verifiedIndexCodeCoverage,
    requiredPromotionCoverage: 80,
    qualityGatePassed,
    promotionAllowed: verifiedIndexCodeCoverage >= 80 && qualityGatePassed,
    reason: verifiedIndexCodeCoverage < 80
      ? 'VERIFIED_INDEX_CODE_COVERAGE_LOW'
      : qualityGatePassed
        ? 'READY_FOR_PROMOTION'
        : 'INDEX_VALUE_QUALITY_LOW',
    safeOnlyMetricWouldPass: verifiedCoverageExcludingUnsafeAlias >= 80,
    useAlternativeForLivePromotion: false,
    alternativePolicyReason: 'OFFICIAL_TARGET_POLICY_SELECTED_FOR_SAFETY',
    executionImpact: 'NONE',
  };
  const masterSource = provider?.cacheFallbackUsed
    ? 'CACHE'
    : provider?.masterSource ?? 'NONE';
  const reasonCodes = new Set<string>([
    ...mapping.reasonCodes,
    ...(provider?.reasonCodes ?? []),
  ]);
  if (verificationResults.length > 0) reasonCodes.add('OFFICIAL_INDEX_API_VERIFY_ATTEMPTED');
  if (verifySuccessCount > 0) reasonCodes.add('OFFICIAL_INDEX_API_VERIFY_SUCCEEDED');
  if (verifyFailCount > 0) reasonCodes.add('OFFICIAL_INDEX_API_VERIFY_FAILED');
  for (const result of verificationResults) {
    reasonCodes.add(result.reasonCode);
    if (result.selectedFailureReason) reasonCodes.add(result.selectedFailureReason);
    for (const attempt of result.attempts ?? []) reasonCodes.add(attempt.reasonCode);
  }
  if (!(provider?.masterLoaded ?? masterRows.length > 0)) reasonCodes.add('MASTER_NOT_LOADED');
  if (masterRows.length === 0) reasonCodes.add('MASTER_ROWS_EMPTY');
  if (mapping.officialIndexCoverage > 0 && verifiedIndexCodeCoverage < 80) {
    reasonCodes.add('PROMOTION_DISABLED_COVERAGE_BELOW_80');
    reasonCodes.add('VERIFIED_INDEX_CODE_COVERAGE_LOW');
  }
  if (indexValueQuality.zeroCurrentIndexCount > 0) reasonCodes.add('OFFICIAL_INDEX_ZERO_CURRENT_INDEX_OBSERVE_ONLY');
  if (verifySuccessCount > 0 && !qualityGatePassed) reasonCodes.add('INDEX_VALUE_QUALITY_LOW');
  reasonCodes.add('EXECUTION_IMPACT_NONE_CONFIRMED');

  return {
    masterSource,
    masterLoaded: provider?.masterLoaded ?? masterRows.length > 0,
    masterRowCount: provider?.masterRowCount ?? masterRows.length,
    idxcodeMstDownloaded: provider?.idxcodeMstDownloaded ?? false,
    cacheFallbackUsed: provider?.cacheFallbackUsed ?? false,
    parseStatus: provider?.parseStatus ?? (masterRows.length > 0 ? 'OK' : 'FAILED'),
    rows: provider?.rows ?? masterRows,
    rawSampleRows: provider?.rawSampleRows ?? masterRows.slice(0, 8).map((row) => ({
      ...(row.idxDiv ? { idxDiv: row.idxDiv } : {}),
      idxCode: row.officialIndexCode,
      idxName: row.officialIndexName,
      rawIdxName: row.rawSectorName,
      normalizedIdxName: row.normalizedSectorName,
      canonicalOfficialName: row.canonicalOfficialName ?? canonicalizeOfficialIndexName(row.officialIndexName).canonicalName,
      codePrefixRemoved: row.codePrefixRemoved ?? canonicalizeOfficialIndexName(row.officialIndexName).codePrefixRemoved,
      verifyInputCandidates: row.verifyInputCandidates,
    })),
    idxNameSampleTop: (provider?.rawSampleRows?.map((row) => row.idxName) ?? masterRows.map((row) => row.officialIndexName))
      .slice(0, 12),
    aliasDictionaryStatus,
    officialIndexCoverage: mapping.officialIndexCoverage,
    verifiedIndexCodeCoverage,
    mappedSectorCount: mapping.mappedSectorCount,
    verifiedIndexCodeCount: verifySuccessCount,
    targetSectorCount: mapping.targetSectorCount,
    coverageDenominator,
    coverageMetrics,
    unsafeAliasPolicy,
    promotionCoveragePolicy,
    indexValueQuality,
    sectorIndexQuality,
    promotionReadiness,
    officialIndexCoverageByOfficialTarget: coverageMetrics.officialIndexCoverageByOfficialTarget,
    verifiedCoverageByOfficialTarget: coverageMetrics.verifiedCoverageByOfficialTarget,
    verifiedCoverageExcludingUnsafeAlias,
    promotionVerifiedCoverage: coverageMetrics.promotionVerifiedCoverage,
    safeAliasCoverage: pct(mapping.safeAliasCount, mapping.targetSectorCount),
    exactMatchCount: mapping.exactMatchCount,
    safeAliasMatchCount: mapping.safeAliasMatchCount,
    safeSynonymMatchCount: mapping.safeSynonymMatchCount,
    safeAliasCount: mapping.safeAliasCount,
    unsafeAliasCount: mapping.unsafeAliasCount,
    unsafeAliasSectorNames: mapping.unsafeAliasSectorNames,
    mappedSectorPairs: mapping.mappedSectorPairs,
    unresolvedCount: mapping.unresolvedSectorNames.length,
    sourceTier: masterSource === 'CACHE'
      ? 'CACHE'
      : provider?.masterSource === 'OFFICIAL_KIS_IDXCODE_MST'
        ? 'OFFICIAL_KIS_SECTOR_INDEX'
        : masterRows.some((row) => row.sourceTier === 'OFFICIAL_KRX_SECTOR_INDEX')
          ? 'OFFICIAL_KRX_SECTOR_INDEX'
          : 'NONE',
    aliasResolvedCount: mapping.aliasResolvedCount,
    unresolvedSectorNames: mapping.unresolvedSectorNames,
    unresolvedSectorDetails: mapping.unresolvedSectorDetails,
    topMissingSectorNames: mapping.topMissingSectorNames,
    internalSectorNames: mapping.internalSectorNames,
    normalizedInternalSectorNames: mapping.normalizedInternalSectorNames,
    mappingAttempts: mapping.mappingAttempts.map((attempt) => {
      const verification = attempt.selectedOfficialIndexCode
        ? verificationByCode.get(mappingVerifyKey({
          sectorName: attempt.internalSectorName,
          idxDiv: attempt.idxDiv,
          officialIndexCode: attempt.selectedOfficialIndexCode,
        })) ?? verificationByLooseCode.get(`${attempt.internalSectorName}|${attempt.selectedOfficialIndexCode}`)
        : undefined;
      return {
        ...attempt,
        verifyAttempted: attempt.includedInOfficialCoverage && Boolean(attempt.selectedOfficialIndexCode),
        verified: verification?.verified ?? false,
      };
    }),
    verifyApiPath: KIS_SECTOR_INDEX_VERIFY_API_PATH,
    verifyTrId: KIS_SECTOR_INDEX_VERIFY_TR_ID,
    verifyAttemptCount: verificationResults.length,
    verifyVariantAttemptCount,
    verifyVariantTried: verificationResults.some((result) => (result.triedCandidates?.length ?? 0) > 1),
    ...(verifyVariantPolicy ? { verifyVariantPolicy } : {}),
    verifySuccessCount,
    verifyFailCount,
    verifyApiSuccessSamples: verificationResults.filter((result) => result.verified).slice(0, 3),
    verifyApiFailureSamples: verificationResults.filter((result) => !result.verified).slice(0, 3),
    verifyAttemptDetails,
    ...(kisIndexQuoteClientStatus ? { kisIndexQuoteClientStatus } : {}),
    providerIssue: Boolean(provider?.providerIssue) || verificationResults.some((result) => result.providerIssue),
    marketSignal: false,
    executionImpact: 'NONE',
    reasonCodes: Array.from(reasonCodes),
    mappingRows: mapping.rows,
    verificationResults,
  };
}
