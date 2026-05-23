// @responsibility KIS official sector index current-price API adapter for SectorIndexVerifier.

import { fetchKisSectorIndexCurrentPrice } from '../clients/kisClient/query.js';
import type { OfficialSectorIndexCodeMappingRow } from './SectorIndexCodeMap.js';
import type { OfficialSectorIndexVerifyResult } from './SectorIndexVerifier.js';

export async function verifySectorIndexCodeWithKisCurrentPrice(
  row: OfficialSectorIndexCodeMappingRow,
): Promise<OfficialSectorIndexVerifyResult> {
  const code = row.officialIndexCode ?? '';
  if (!/^\d{4}$/.test(code)) {
    return {
      officialIndexCode: code,
      sectorName: row.sectorName,
      verified: false,
      providerIssue: false,
      marketSignal: false,
      executionImpact: 'NONE',
      reasonCode: 'OFFICIAL_INDEX_CODE_INVALID',
    };
  }
  const result = await fetchKisSectorIndexCurrentPrice(code, 'LOW');
  const verified = Boolean(result && typeof result.currentIndex === 'number' && result.currentIndex > 0);
  return {
    officialIndexCode: code,
    sectorName: row.sectorName,
    verified,
    providerIssue: !verified,
    marketSignal: false,
    executionImpact: 'NONE',
    reasonCode: verified ? 'OFFICIAL_INDEX_API_VERIFY_OK' : 'OFFICIAL_INDEX_API_VERIFY_FAILED',
    fetchedAt: result?.fetchedAt,
  };
}
