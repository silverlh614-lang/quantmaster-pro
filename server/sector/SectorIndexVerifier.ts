// @responsibility Official sector index code API verification and coverage aggregation.

import type {
  OfficialSectorIndexCodeMapResult,
  OfficialSectorIndexCodeMappingRow,
  OfficialSectorIndexMappingAttempt,
  OfficialSectorIndexTarget,
} from './SectorIndexCodeMap.js';
import { mapSectorNamesToOfficialIndexCodes, type OfficialSectorIndexMasterRow } from './SectorIndexCodeMap.js';
import type { SectorIndexMasterProviderResult } from './SectorIndexMasterProvider.js';

export const KIS_SECTOR_INDEX_VERIFY_API_PATH =
  '/uapi/domestic-stock/v1/quotations/inquire-index-price';
export const KIS_SECTOR_INDEX_VERIFY_TR_ID = 'FHPUP02100000';

export interface OfficialSectorIndexVerifyResult {
  officialIndexCode: string;
  sectorName: string;
  verified: boolean;
  providerIssue: boolean;
  marketSignal: false;
  executionImpact: 'NONE';
  reasonCode: string;
  fetchedAt?: string;
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
  rawSampleRows?: Array<{ idxDiv?: string; idxCode: string; idxName: string; normalizedIdxName: string }>;
  officialIndexCoverage: number;
  verifiedIndexCodeCoverage: number;
  mappedSectorCount: number;
  verifiedIndexCodeCount: number;
  targetSectorCount: number;
  safeAliasCoverage?: number;
  exactMatchCount?: number;
  safeAliasMatchCount?: number;
  safeAliasCount: number;
  unsafeAliasCount: number;
  unsafeAliasSectorNames?: string[];
  mappedSectorPairs?: string[];
  unresolvedCount?: number;
  sourceTier?: 'OFFICIAL_KRX_SECTOR_INDEX' | 'OFFICIAL_KIS_SECTOR_INDEX' | 'CACHE' | 'NONE';
  aliasResolvedCount: number;
  unresolvedSectorNames: string[];
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

async function defaultVerifyIndexCode(
  row: OfficialSectorIndexCodeMappingRow,
): Promise<OfficialSectorIndexVerifyResult> {
  return {
    officialIndexCode: row.officialIndexCode ?? '',
    sectorName: row.sectorName,
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
        verified: false,
        providerIssue: true,
        marketSignal: false,
        executionImpact: 'NONE',
        reasonCode: 'OFFICIAL_INDEX_API_VERIFY_FAILED',
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
  const verificationResults = await verifyOfficialSectorIndexCodes({
    mappingRows: mapping.rows,
    verifyIndexCode: input.verifyIndexCode,
  });
  const verificationByCode = new Map(verificationResults.map((result) => [result.officialIndexCode, result]));
  const verifySuccessCount = verificationResults.filter((result) => result.verified).length;
  const verifyFailCount = verificationResults.length - verifySuccessCount;
  const verifiedIndexCodeCoverage = pct(verifySuccessCount, mapping.targetSectorCount);
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
  if (mapping.officialIndexCoverage > 0 && verifiedIndexCodeCoverage < 80) {
    reasonCodes.add('PROMOTION_DISABLED_COVERAGE_BELOW_80');
    reasonCodes.add('VERIFIED_INDEX_CODE_COVERAGE_LOW');
  }
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
      normalizedIdxName: row.normalizedSectorName,
    })),
    officialIndexCoverage: mapping.officialIndexCoverage,
    verifiedIndexCodeCoverage,
    mappedSectorCount: mapping.mappedSectorCount,
    verifiedIndexCodeCount: verifySuccessCount,
    targetSectorCount: mapping.targetSectorCount,
    safeAliasCoverage: pct(mapping.safeAliasCount, mapping.targetSectorCount),
    exactMatchCount: mapping.exactMatchCount,
    safeAliasMatchCount: mapping.safeAliasMatchCount,
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
    topMissingSectorNames: mapping.topMissingSectorNames,
    internalSectorNames: mapping.internalSectorNames,
    normalizedInternalSectorNames: mapping.normalizedInternalSectorNames,
    mappingAttempts: mapping.mappingAttempts.map((attempt) => {
      const verification = attempt.selectedOfficialIndexCode
        ? verificationByCode.get(attempt.selectedOfficialIndexCode)
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
    verifySuccessCount,
    verifyFailCount,
    verifyApiSuccessSamples: verificationResults.filter((result) => result.verified).slice(0, 3),
    verifyApiFailureSamples: verificationResults.filter((result) => !result.verified).slice(0, 3),
    providerIssue: Boolean(provider?.providerIssue) || verificationResults.some((result) => result.providerIssue),
    marketSignal: false,
    executionImpact: 'NONE',
    reasonCodes: Array.from(reasonCodes),
    mappingRows: mapping.rows,
    verificationResults,
  };
}
