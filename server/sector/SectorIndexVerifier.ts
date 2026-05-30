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
  KisSectorIndexValueQualityStatus,
  KisSectorIndexVerifyTransportStage,
  KisSectorIndexVerifyVariantPolicy,
} from '../clients/kisClient/types.js';

export const KIS_SECTOR_INDEX_VERIFY_API_PATH =
  '/uapi/domestic-stock/v1/quotations/inquire-index-price';
export const KIS_SECTOR_INDEX_VERIFY_TR_ID = 'FHPUP02100000';

// ─── D1 (observe-only): verify 실패 타입 분리 → providerIssue/dataQuality 표시 매핑 ─────────
// ★ 게이팅 무관, executionImpact=NONE, marketSignal=false. 불변식 #6 보존:
//   휴장/세션닫힘은 providerIssue=false (bearish 승격 금지). OPEN 중 transport/parse 실패만 providerIssue=true.
//   index value 0 은 dataQuality=LOW (providerIssue=false). promotion 게이팅은 절대 바꾸지 않는다.

/** verify 실패/품질을 표시상 분류한 라벨 (게이팅 무관, 표시 전용). */
export type OfficialSectorIndexVerifyDisplayClass =
  | 'VERIFIED'
  | 'SESSION_NOT_VERIFIABLE'
  | 'OFFICIAL_INDEX_VERIFY_FAILED'
  | 'OFFICIAL_INDEX_VALUE_PARSE_FAILED'
  | 'VALUE_QUALITY_LOW';

export interface OfficialSectorIndexVerifyDisplayClassification {
  displayClass: OfficialSectorIndexVerifyDisplayClass;
  providerIssue: boolean;
  dataQuality: 'VERIFIED' | 'LOW' | 'SESSION_NOT_VERIFIABLE' | 'MISSING';
  executionImpact: 'NONE';
  marketSignal: false;
}

const SESSION_CLOSED_REASONS: ReadonlySet<string> = new Set([
  'SECTOR_INDEX_MARKET_CLOSED',
  'HOLIDAY_NO_SESSION_OBSERVE_ONLY',
]);
const TRANSPORT_FAILURE_REASONS: ReadonlySet<string> = new Set([
  'KIS_INDEX_API_HTTP_ERROR',
  'KIS_INDEX_API_AUTH_ERROR',
  'KIS_INDEX_API_RATE_LIMIT',
  'KIS_INDEX_API_CLIENT_DISABLED',
  'OFFICIAL_INDEX_API_VERIFY_FAILED',
  'OFFICIAL_INDEX_CODE_INVALID',
  'VERIFY_VARIANTS_EXHAUSTED',
]);
const PARSE_FAILURE_REASONS: ReadonlySet<string> = new Set([
  'VALUE_PARSE_FAILED',
  'OUTPUT_SHAPE_UNRECOGNIZED',
  'INDEX_VALUE_FIELD_MISSING',
]);
const VALUE_QUALITY_LOW_REASONS: ReadonlySet<string> = new Set([
  'VALUE_QUALITY_ZERO',
  'VALUE_QUALITY_LOW',
]);

/**
 * verify 결과(또는 verifyApiFailureSamples 의 selectedFailureReason)를 표시 분류한다.
 *  - session closed/holiday → SESSION_NOT_VERIFIABLE, providerIssue=false (불변식 #6)
 *  - OPEN 중 transport 실패 → OFFICIAL_INDEX_VERIFY_FAILED, providerIssue=true, executionImpact=NONE
 *  - parse 실패 → OFFICIAL_INDEX_VALUE_PARSE_FAILED, providerIssue=true, executionImpact=NONE
 *  - index value 0/품질 저하 → VALUE_QUALITY_LOW(dataQuality=LOW), providerIssue=false
 * ★ promotion 게이팅·marketSignal 무변경. 휴장→providerIssue 승격 금지.
 */
export function classifyOfficialSectorIndexVerifyDisplay(input: {
  verified?: boolean;
  selectedFailureReason?: string;
  reasonCode?: string;
  sessionClosed?: boolean;
}): OfficialSectorIndexVerifyDisplayClassification {
  if (input.verified === true) {
    return { displayClass: 'VERIFIED', providerIssue: false, dataQuality: 'VERIFIED', executionImpact: 'NONE', marketSignal: false };
  }
  const reason = input.selectedFailureReason ?? input.reasonCode ?? '';
  if (input.sessionClosed === true || SESSION_CLOSED_REASONS.has(reason)) {
    return { displayClass: 'SESSION_NOT_VERIFIABLE', providerIssue: false, dataQuality: 'SESSION_NOT_VERIFIABLE', executionImpact: 'NONE', marketSignal: false };
  }
  if (VALUE_QUALITY_LOW_REASONS.has(reason)) {
    return { displayClass: 'VALUE_QUALITY_LOW', providerIssue: false, dataQuality: 'LOW', executionImpact: 'NONE', marketSignal: false };
  }
  if (PARSE_FAILURE_REASONS.has(reason)) {
    return { displayClass: 'OFFICIAL_INDEX_VALUE_PARSE_FAILED', providerIssue: true, dataQuality: 'MISSING', executionImpact: 'NONE', marketSignal: false };
  }
  if (TRANSPORT_FAILURE_REASONS.has(reason)) {
    return { displayClass: 'OFFICIAL_INDEX_VERIFY_FAILED', providerIssue: true, dataQuality: 'MISSING', executionImpact: 'NONE', marketSignal: false };
  }
  // 미분류 OPEN 실패는 보수적으로 transport 실패로 표시 (providerIssue=true) — 게이팅 무관.
  return { displayClass: 'OFFICIAL_INDEX_VERIFY_FAILED', providerIssue: true, dataQuality: 'MISSING', executionImpact: 'NONE', marketSignal: false };
}

/** master loaded 인데 OPEN 중 verify 0건이면 표시 status (게이팅 무관). */
export const OFFICIAL_INDEX_MASTER_LOADED_BUT_UNVERIFIED = 'OFFICIAL_INDEX_MASTER_LOADED_BUT_UNVERIFIED' as const;

/**
 * master loaded && OPEN(세션 열림) && verifySuccessCount=0 인 표시 status 를 산출한다.
 * 그 외(휴장/verified>0/master 미로드)는 undefined — 기존 표시 그대로 (byte-equivalent).
 * ★ 표시 전용, promotion 게이팅·coverage 산식 무관.
 */
export function resolveMasterLoadedButUnverifiedStatus(input: {
  masterLoaded?: boolean;
  marketClosed?: boolean;
  verifySuccessCount?: number;
}): typeof OFFICIAL_INDEX_MASTER_LOADED_BUT_UNVERIFIED | undefined {
  if (input.masterLoaded === true && input.marketClosed !== true && (input.verifySuccessCount ?? 0) === 0) {
    return OFFICIAL_INDEX_MASTER_LOADED_BUT_UNVERIFIED;
  }
  return undefined;
}

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
  apiTransportSuccess?: boolean;
  indexValueUsable?: boolean;
  valueQualityStatus?: KisSectorIndexValueQualityStatus;
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
  apiTransportSuccess?: boolean;
  indexValueUsable?: boolean;
  valueQualityStatus?: KisSectorIndexValueQualityStatus;
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
  // ADR-0488: 조선/방산/원자력/이차전지 등은 공식 단일 섹터가 없어 promotion numerator·denominator 모두에서 제외한다.
  includeInPromotionDenominator: false;
  includeInPromotionNumerator: false;
  useForShadowEvidence: true;
  useForLivePromotion: false;
  useForSectorBoost: false;
  useForStrongBuy: false;
  status: 'EXCLUDED_FROM_OFFICIAL_SECTOR_PROMOTION';
  reason: 'NO_OFFICIAL_SINGLE_SECTOR_INDEX_OR_THEME_TO_OFFICIAL_SECTOR_AMBIGUOUS' | 'THEME_TO_OFFICIAL_SECTOR_AMBIGUOUS';
  executionImpact: 'NONE';
}

export interface SectorIndexPromotionCoveragePolicy {
  // ADR-0488: promotion decision은 공식·안전 섹터(unsafe alias 제외) 기준 coverage만 사용한다.
  selectedMetric: 'SAFE_OFFICIAL_VERIFIED_COVERAGE' | 'officialTargetVerifiedCoverage';
  numerator: number;
  denominator: number;
  requiredVerifiedCoverage: 80;
  selectedCoverageValue: number;
  promotionAllowed: boolean;
  reason: 'VERIFIED_INDEX_CODE_COVERAGE_LOW' | 'VERIFIED_INDEX_CODE_COVERAGE_READY' | 'SECTOR_INDEX_MARKET_CLOSED';
  alternativeInternalGroupedCoverage?: number;
  officialTargetVerifiedCoverageDiagnostic?: number;
  decisionUsesSafeOfficialOnly: true;
  executionImpact: 'NONE';
}

export interface SectorIndexValueQuality {
  apiVerifiedCount: number;
  apiTransportSuccessCount: number;
  indexValueUsableCount: number;
  zeroCurrentIndexCount: number;
  nonZeroCurrentIndexCount: number;
  qualityUsableCount: number;
  qualityUsableCoverageByOfficialTarget: number;
  qualityUsableCoverageExcludingUnsafeAlias: number;
  zeroCurrentIndexSymbols: string[];
  zeroCurrentIndexPolicy: 'OBSERVE_ONLY';
  valueQualityStatus: 'OK' | 'VALUE_QUALITY_ZERO' | 'VALUE_QUALITY_LOW';
  qualityImpact: 'BLOCK_LIVE_PROMOTION_ONLY' | 'NONE';
  executionImpact: 'NONE';
}

export interface SectorIndexQualityResult {
  sectorName: string;
  rawIdxName?: string | null;
  idxDiv?: string | null;
  idxCode?: string | null;
  verified: boolean;
  apiTransportSuccess: boolean;
  indexValueUsable: boolean;
  valueQualityStatus: KisSectorIndexValueQualityStatus;
  currentIndex: number | null;
  qualityUsable: boolean;
  qualityReason: 'OK' | 'CURRENT_INDEX_ZERO' | 'VALUE_PARSE_FAILED' | 'STALE' | 'SESSION_CLOSED';
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
  selectedPromotionMetric: 'SAFE_OFFICIAL_VERIFIED_COVERAGE' | 'officialTargetVerifiedCoverage';
  selectedPromotionCoverage: number;
  requiredPromotionCoverage: 80;
  qualityGatePassed: boolean;
  promotionAllowed: boolean;
  reason: 'VERIFIED_INDEX_CODE_COVERAGE_LOW' | 'INDEX_VALUE_QUALITY_LOW' | 'READY_FOR_PROMOTION' | 'SECTOR_INDEX_MARKET_CLOSED_OBSERVE_ONLY';
  safeOnlyMetricWouldPass: boolean;
  // ADR-0488: 공식·안전 섹터(조선/방산/원자력/이차전지 등 unsafe alias 제외) 기준 promotion SSOT.
  safeOfficialTargetCount: number;
  safeOfficialVerifiedCount: number;
  safeOfficialVerifiedCoverage: number;
  unsafeExcludedCount: number;
  unsafeExcludedNames: string[];
  officialTargetVerifiedCoverageDiagnostic: number;
  promotionCoveragePass: boolean;
  promotionAllowedByCoverage: boolean;
  decisionUsesSafeOfficialOnly: true;
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
  // 미매핑 테마(조선/방산/원자력/이차전지)용 — 마스터 485행 중 KRX/테마 키워드 매칭 후보를 노출한다.
  // 거래일 스캔에서 해당 공식지수 존재 여부를 확정하기 위한 진단 (executionImpact=NONE).
  themeIndexCandidates?: string[];
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

function representativeAttempt(result: OfficialSectorIndexVerifyResult): OfficialSectorIndexVerifyAttempt | undefined {
  return result.attempts?.find((attempt) => attempt.verified)
    ?? result.attempts?.find((attempt) => attempt.valueQualityStatus === 'VALUE_QUALITY_ZERO')
    ?? result.attempts?.find((attempt) => attempt.apiTransportSuccess === true)
    ?? result.attempts?.at(-1);
}

function resolveApiTransportSuccess(
  result: OfficialSectorIndexVerifyResult,
  attempt: OfficialSectorIndexVerifyAttempt | undefined,
): boolean {
  if (typeof result.apiTransportSuccess === 'boolean') return result.apiTransportSuccess;
  if (typeof attempt?.apiTransportSuccess === 'boolean') return attempt.apiTransportSuccess;
  const httpOk = result.httpStatus == null || (result.httpStatus >= 200 && result.httpStatus < 300);
  const rtOk = result.rtCd == null || result.rtCd === '0';
  return result.verified === true
    || result.reasonCode === 'VALUE_QUALITY_ZERO'
    || Boolean(httpOk && rtOk && result.outputPresent === true);
}

function resolveIndexValueUsable(
  result: OfficialSectorIndexVerifyResult,
  attempt: OfficialSectorIndexVerifyAttempt | undefined,
  currentIndex: number | null,
): boolean {
  if (typeof result.indexValueUsable === 'boolean') return result.indexValueUsable;
  if (typeof attempt?.indexValueUsable === 'boolean') return attempt.indexValueUsable;
  return result.verified === true
    && typeof currentIndex === 'number'
    && Number.isFinite(currentIndex)
    && currentIndex > 0;
}

function resolveValueQualityStatus(input: {
  result: OfficialSectorIndexVerifyResult;
  attempt?: OfficialSectorIndexVerifyAttempt;
  currentIndex: number | null;
  apiTransportSuccess: boolean;
  indexValueUsable: boolean;
}): KisSectorIndexValueQualityStatus {
  // 휴장/세션닫힘은 verify 를 건너뛴 상태 — transport/parse 실패가 아니라 NOT_ATTEMPTED 다 (ADR-0544 후속).
  if (input.result.reasonCode === 'SECTOR_INDEX_MARKET_CLOSED') return 'NOT_ATTEMPTED';
  if (input.result.valueQualityStatus) return input.result.valueQualityStatus;
  if (input.attempt?.valueQualityStatus) return input.attempt.valueQualityStatus;
  if (input.indexValueUsable) return 'USABLE';
  if (input.currentIndex === 0 || input.result.reasonCode === 'VALUE_QUALITY_ZERO') return 'VALUE_QUALITY_ZERO';
  return input.apiTransportSuccess ? 'VALUE_PARSE_FAILED' : 'API_TRANSPORT_FAILED';
}

function buildSectorIndexQuality(results: readonly OfficialSectorIndexVerifyResult[]): SectorIndexQualityResult[] {
  const seen = new Set<string>();
  const qualityRows: SectorIndexQualityResult[] = [];
  for (const result of results) {
    const currentIndex = representativeCurrentIndex(result);
    const attempt = representativeAttempt(result);
    const apiTransportSuccess = resolveApiTransportSuccess(result, attempt);
    const indexValueUsable = resolveIndexValueUsable(result, attempt, currentIndex);
    const valueQualityStatus = resolveValueQualityStatus({
      result,
      attempt,
      currentIndex,
      apiTransportSuccess,
      indexValueUsable,
    });
    const key = uniqueVerifyResultKey(result);
    if (seen.has(key)) continue;
    seen.add(key);
    const qualityReason: SectorIndexQualityResult['qualityReason'] =
      valueQualityStatus === 'USABLE' ? 'OK'
        : valueQualityStatus === 'NOT_ATTEMPTED' || result.reasonCode === 'SECTOR_INDEX_MARKET_CLOSED' ? 'SESSION_CLOSED'
          : valueQualityStatus === 'VALUE_QUALITY_ZERO' || currentIndex === 0 ? 'CURRENT_INDEX_ZERO'
            : 'VALUE_PARSE_FAILED';
    const qualityUsable = indexValueUsable;
    qualityRows.push({
      sectorName: result.sectorName,
      rawIdxName: result.rawIdxName,
      idxDiv: result.idxDiv,
      idxCode: result.idxCode,
      verified: result.verified,
      apiTransportSuccess,
      indexValueUsable,
      valueQualityStatus,
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
  const apiTransportRows = input.qualityRows.filter((row) => row.apiTransportSuccess);
  const zeroCurrentIndexSymbols = apiTransportRows
    .filter((row) => row.qualityReason === 'CURRENT_INDEX_ZERO')
    .map((row) => row.sectorName);
  const qualityUsableCount = input.qualityRows.filter((row) => row.indexValueUsable).length;
  const valueQualityStatus: SectorIndexValueQuality['valueQualityStatus'] = zeroCurrentIndexSymbols.length > 0
    ? 'VALUE_QUALITY_ZERO'
    : qualityUsableCount >= input.officialTargetSectorCount
      ? 'OK'
      : 'VALUE_QUALITY_LOW';
  return {
    apiVerifiedCount: apiTransportRows.length,
    apiTransportSuccessCount: apiTransportRows.length,
    indexValueUsableCount: qualityUsableCount,
    zeroCurrentIndexCount: zeroCurrentIndexSymbols.length,
    nonZeroCurrentIndexCount: input.qualityRows.filter((row) =>
      typeof row.currentIndex === 'number' && row.currentIndex > 0,
    ).length,
    qualityUsableCount,
    qualityUsableCoverageByOfficialTarget: pct(qualityUsableCount, input.officialTargetSectorCount),
    qualityUsableCoverageExcludingUnsafeAlias: pct(qualityUsableCount, input.safePromotionEligibleSectorCount),
    zeroCurrentIndexSymbols,
    zeroCurrentIndexPolicy: 'OBSERVE_ONLY',
    valueQualityStatus,
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

// 미매핑 테마(조선/방산/원자력/이차전지)가 official 지수로 매핑 가능한지 확정하기 위한 진단 키워드.
// KRX 시리즈/테마 지수명을 마스터에서 직접 노출해 거래일에 매핑 가능 여부를 판정한다.
const THEME_INDEX_NAME_KEYWORDS = [
  'KRX', '2차전지', '이차전지', '배터리', '방산', '조선', '원자력', '신재생', '에너지', 'K-뉴딜', 'K뉴딜', 'BBIG',
];

function collectThemeIndexCandidates(
  rows: readonly OfficialSectorIndexMasterRow[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    const name = row.officialIndexName ?? '';
    if (!THEME_INDEX_NAME_KEYWORDS.some((kw) => name.includes(kw))) continue;
    const entry = `${row.idxDiv ?? '-'}:${row.officialIndexCode}:${name}`;
    if (seen.has(entry)) continue;
    seen.add(entry);
    out.push(entry);
    if (out.length >= 40) break;
  }
  return out;
}

// 휴장/주말엔 KIS 업종지수 현재가가 세션 부재로 0/실패다 — providerIssue 가 아니라 예상된 상태다.
// 라이브 verify 를 건너뛰고(쿼터 절약) 시장 폐장 분류만 남긴다.
function buildMarketClosedVerifyResult(
  row: OfficialSectorIndexCodeMappingRow,
): OfficialSectorIndexVerifyResult {
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
    reasonCode: 'SECTOR_INDEX_MARKET_CLOSED',
  };
}

export async function buildOfficialSectorIndexMasterCoverage(input: {
  provider: SectorIndexMasterProviderResult | null;
  targets: readonly OfficialSectorIndexTarget[];
  masterRows?: readonly OfficialSectorIndexMasterRow[];
  verifyIndexCode?: (row: OfficialSectorIndexCodeMappingRow) => Promise<OfficialSectorIndexVerifyResult>;
  marketClosed?: boolean;
}): Promise<OfficialSectorIndexMasterCoverageResult> {
  const provider = input.provider;
  const masterRows = input.masterRows ?? provider?.rows ?? [];
  const mapping: OfficialSectorIndexCodeMapResult = mapSectorNamesToOfficialIndexCodes({
    targets: input.targets,
    masterRows,
  });
  const aliasDictionaryStatus = getOfficialSectorIndexAliasDictionaryStatus();
  const marketClosed = input.marketClosed === true;
  const verificationResults = marketClosed
    ? mapping.rows
        .filter((row) => row.officialCoverageEligible && Boolean(row.officialIndexCode))
        .map((row) => buildMarketClosedVerifyResult(row))
    : await verifyOfficialSectorIndexCodes({
        mappingRows: mapping.rows,
        verifyIndexCode: input.verifyIndexCode,
      });
  const verificationByCode = new Map(verificationResults.map((result) => [mappingVerifyKey(result), result]));
  const verificationByLooseCode = new Map(verificationResults.map((result) => [
    `${result.sectorName}|${result.officialIndexCode}`,
    result,
  ]));
  const verifySuccessCount = verificationResults.filter((result) => result.verified).length;
  // 휴장/세션닫힘은 verify 를 호출하지 않은 SKIPPED 상태 — fail 로 집계하지 않는다 (ADR-0544 후속, display 정합).
  const verifyFailCount = marketClosed ? 0 : verificationResults.length - verifySuccessCount;
  const verifyAttemptDetails = verificationResults.flatMap((result) => result.attempts ?? []);
  const verifyVariantAttemptCount = verifyAttemptDetails.length || verificationResults.length;
  const verifyVariantPolicy = verificationResults.find((result) => result.verifyVariantPolicy)?.verifyVariantPolicy;
  const kisIndexQuoteClientStatus = verificationResults.find((result) => result.clientStatus)?.clientStatus;
  const verifiedIndexCodeCoverage = pct(verifySuccessCount, mapping.targetSectorCount);
  const safePromotionEligibleSectorCount = mapping.rows.filter((row) =>
    row.officialCoverageEligible && !row.unsafeAlias && Boolean(row.officialIndexCode),
  ).length;
  const verifiedCoverageExcludingUnsafeAlias = pct(verifySuccessCount, safePromotionEligibleSectorCount);
  // ADR-0488: 조선/방산/원자력/이차전지 등 unsafe alias(공식 단일 섹터 부재)는 promotion numerator·denominator 모두에서 제외한다.
  const unsafeSectorNameSet = new Set(
    mapping.rows.filter((row) => row.unsafeAlias).map((row) => row.sectorName),
  );
  const unsafeExcludedNames = mapping.unsafeAliasSectorNames ?? Array.from(unsafeSectorNameSet);
  const unsafeExcludedCount = unsafeExcludedNames.length;
  const safeOfficialTargetCount = safePromotionEligibleSectorCount;
  const safeOfficialVerifiedCount = verificationResults.filter(
    (result) => result.verified && !unsafeSectorNameSet.has(result.sectorName),
  ).length;
  const safeOfficialVerifiedCoverage = pct(safeOfficialVerifiedCount, safeOfficialTargetCount);
  const officialTargetVerifiedCoverageDiagnostic = verifiedIndexCodeCoverage;
  const safeCoveragePromotionAllowed = !marketClosed && safeOfficialVerifiedCoverage >= 80;
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
    includeInPromotionDenominator: false,
    includeInPromotionNumerator: false,
    useForShadowEvidence: true,
    useForLivePromotion: false,
    useForSectorBoost: false,
    useForStrongBuy: false,
    status: 'EXCLUDED_FROM_OFFICIAL_SECTOR_PROMOTION',
    reason: 'NO_OFFICIAL_SINGLE_SECTOR_INDEX_OR_THEME_TO_OFFICIAL_SECTOR_AMBIGUOUS',
    executionImpact: 'NONE',
  };
  const promotionCoveragePolicy: SectorIndexPromotionCoveragePolicy = {
    selectedMetric: 'SAFE_OFFICIAL_VERIFIED_COVERAGE',
    numerator: safeOfficialVerifiedCount,
    denominator: safeOfficialTargetCount,
    requiredVerifiedCoverage: 80,
    selectedCoverageValue: safeOfficialVerifiedCoverage,
    promotionAllowed: safeCoveragePromotionAllowed,
    reason: marketClosed
      ? 'SECTOR_INDEX_MARKET_CLOSED'
      : safeOfficialVerifiedCoverage >= 80
        ? 'VERIFIED_INDEX_CODE_COVERAGE_READY'
        : 'VERIFIED_INDEX_CODE_COVERAGE_LOW',
    officialTargetVerifiedCoverageDiagnostic,
    decisionUsesSafeOfficialOnly: true,
    executionImpact: 'NONE',
  };
  const sectorIndexQuality = buildSectorIndexQuality(verificationResults);
  const indexValueQuality = buildIndexValueQuality({
    qualityRows: sectorIndexQuality,
    officialTargetSectorCount: mapping.targetSectorCount,
    safePromotionEligibleSectorCount,
  });
  // 품질 게이트도 공식·안전 섹터 기준(unsafe alias 제외)으로 평가한다 (decisionUsesSafeOfficialOnly).
  const qualityGatePassed = indexValueQuality.qualityUsableCoverageExcludingUnsafeAlias >= 80;
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
    selectedPromotionMetric: 'SAFE_OFFICIAL_VERIFIED_COVERAGE',
    selectedPromotionCoverage: safeOfficialVerifiedCoverage,
    requiredPromotionCoverage: 80,
    qualityGatePassed,
    promotionAllowed: safeCoveragePromotionAllowed && qualityGatePassed,
    reason: marketClosed
      ? 'SECTOR_INDEX_MARKET_CLOSED_OBSERVE_ONLY'
      : safeOfficialVerifiedCoverage < 80
        ? 'VERIFIED_INDEX_CODE_COVERAGE_LOW'
        : qualityGatePassed
          ? 'READY_FOR_PROMOTION'
          : 'INDEX_VALUE_QUALITY_LOW',
    safeOnlyMetricWouldPass: safeOfficialVerifiedCoverage >= 80,
    safeOfficialTargetCount,
    safeOfficialVerifiedCount,
    safeOfficialVerifiedCoverage,
    unsafeExcludedCount,
    unsafeExcludedNames,
    officialTargetVerifiedCoverageDiagnostic,
    promotionCoveragePass: safeCoveragePromotionAllowed,
    promotionAllowedByCoverage: safeCoveragePromotionAllowed,
    decisionUsesSafeOfficialOnly: true,
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
  if (!marketClosed && verificationResults.length > 0) reasonCodes.add('OFFICIAL_INDEX_API_VERIFY_ATTEMPTED');
  if (!marketClosed && verifySuccessCount > 0) reasonCodes.add('OFFICIAL_INDEX_API_VERIFY_SUCCEEDED');
  if (!marketClosed && verifyFailCount > 0) reasonCodes.add('OFFICIAL_INDEX_API_VERIFY_FAILED');
  for (const result of verificationResults) {
    reasonCodes.add(result.reasonCode);
    if (result.selectedFailureReason) reasonCodes.add(result.selectedFailureReason);
    for (const attempt of result.attempts ?? []) reasonCodes.add(attempt.reasonCode);
  }
  if (!(provider?.masterLoaded ?? masterRows.length > 0)) reasonCodes.add('MASTER_NOT_LOADED');
  if (masterRows.length === 0) reasonCodes.add('MASTER_ROWS_EMPTY');
  if (!marketClosed && mapping.officialIndexCoverage > 0 && safeOfficialVerifiedCoverage < 80) {
    reasonCodes.add('PROMOTION_DISABLED_COVERAGE_BELOW_80');
    reasonCodes.add('VERIFIED_INDEX_CODE_COVERAGE_LOW');
  }
  if (!marketClosed && indexValueQuality.zeroCurrentIndexCount > 0) {
    reasonCodes.add('VALUE_QUALITY_ZERO');
    reasonCodes.add('OFFICIAL_INDEX_ZERO_CURRENT_INDEX_OBSERVE_ONLY');
  }
  if (!marketClosed && verifySuccessCount > 0 && !qualityGatePassed) reasonCodes.add('INDEX_VALUE_QUALITY_LOW');
  if (marketClosed) {
    reasonCodes.add('SECTOR_INDEX_MARKET_CLOSED');
    reasonCodes.add('HOLIDAY_NO_SESSION_OBSERVE_ONLY');
  }
  // D1 (observe-only): master loaded && OPEN && verify 0건 → 표시 status (게이팅 무관).
  const masterLoadedButUnverified = resolveMasterLoadedButUnverifiedStatus({
    masterLoaded: provider?.masterLoaded ?? masterRows.length > 0,
    marketClosed,
    verifySuccessCount,
  });
  if (masterLoadedButUnverified) reasonCodes.add(masterLoadedButUnverified);
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
    themeIndexCandidates: collectThemeIndexCandidates(provider?.rows ?? masterRows),
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
