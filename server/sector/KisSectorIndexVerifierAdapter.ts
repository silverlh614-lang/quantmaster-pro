// @responsibility KIS official sector index current-price API adapter for SectorIndexVerifier.

import { fetchKisSectorIndexCurrentPriceProbe } from '../clients/kisClient/query.js';
import type { OfficialSectorIndexCodeMappingRow } from './SectorIndexCodeMap.js';
import type { OfficialSectorIndexVerifyResult } from './SectorIndexVerifier.js';

function providerIssueFromReason(reasonCode: string | undefined): boolean {
  return reasonCode === 'KIS_INDEX_API_HTTP_ERROR'
    || reasonCode === 'KIS_INDEX_API_AUTH_ERROR'
    || reasonCode === 'KIS_INDEX_API_RATE_LIMIT';
}

export async function verifySectorIndexCodeWithKisCurrentPrice(
  row: OfficialSectorIndexCodeMappingRow,
): Promise<OfficialSectorIndexVerifyResult> {
  const code = row.officialIndexCode ?? '';
  if (!/^\d{4}$/.test(code)) {
    return {
      officialIndexCode: code,
      sectorName: row.sectorName,
      rawIdxName: row.rawIdxName,
      idxDiv: row.idxDiv,
      idxCode: row.idxCode,
      canonicalOfficialName: row.canonicalOfficialName,
      fidCondMrktDivCode: 'U',
      fidInputIscd: row.verifyInputCandidates[0] ?? code,
      verifiedInputIscd: null,
      verifyInputCandidates: row.verifyInputCandidates,
      triedCandidates: [],
      verified: false,
      providerIssue: false,
      marketSignal: false,
      executionImpact: 'NONE',
      reasonCode: 'OFFICIAL_INDEX_CODE_INVALID',
    };
  }
  const candidates = row.verifyInputCandidates.length > 0 ? row.verifyInputCandidates : [code];
  const result = await fetchKisSectorIndexCurrentPriceProbe(candidates, 'LOW');
  const selectedAttempt = result?.attempts.find((attempt) => attempt.verified) ?? result?.attempts.at(-1);
  const verified = result?.verified === true;
  const reasonCode = verified ? 'VERIFY_SUCCESS' : 'VERIFY_VARIANTS_EXHAUSTED';
  const selectedFailureReason = verified ? undefined : result?.selectedFailureReason ?? selectedAttempt?.reasonCode;
  return {
    officialIndexCode: code,
    sectorName: row.sectorName,
    rawIdxName: row.rawIdxName,
    idxDiv: row.idxDiv,
    idxCode: row.idxCode,
    canonicalOfficialName: row.canonicalOfficialName,
    fidCondMrktDivCode: 'U',
    fidInputIscd: selectedAttempt?.fidInputIscd ?? candidates[0] ?? code,
    verifiedInputIscd: result?.selectedInputIscd ?? null,
    verifyInputCandidates: candidates,
    triedCandidates: result?.triedCandidates ?? [],
    verified,
    providerIssue: providerIssueFromReason(selectedFailureReason),
    marketSignal: false,
    executionImpact: 'NONE',
    reasonCode,
    ...(selectedFailureReason ? { selectedFailureReason } : {}),
    httpStatus: selectedAttempt?.httpStatus,
    rtCd: selectedAttempt?.rtCd,
    msgCd: selectedAttempt?.msgCd,
    msg1: selectedAttempt?.msg1,
    outputPresent: selectedAttempt?.outputPresent,
    indexValueFieldPresent: selectedAttempt?.indexValueFieldPresent,
    rawTopLevelKeys: selectedAttempt?.rawTopLevelKeys,
    outputKeys: selectedAttempt?.outputKeys,
    attempts: result?.attempts.map((attempt) => ({
      sectorName: row.sectorName,
      rawIdxName: row.rawIdxName,
      idxDiv: row.idxDiv,
      idxCode: row.idxCode,
      canonicalOfficialName: row.canonicalOfficialName,
      fidCondMrktDivCode: attempt.fidCondMrktDivCode,
      fidInputIscd: attempt.fidInputIscd,
      apiPath: attempt.apiPath as '/uapi/domestic-stock/v1/quotations/inquire-index-price',
      trId: attempt.trId as 'FHPUP02100000',
      httpStatus: attempt.httpStatus,
      rtCd: attempt.rtCd,
      msgCd: attempt.msgCd,
      msg1: attempt.msg1,
      outputPresent: attempt.outputPresent,
      indexValueFieldPresent: attempt.indexValueFieldPresent,
      rawTopLevelKeys: attempt.rawTopLevelKeys,
      outputKeys: attempt.outputKeys,
      verified: attempt.verified,
      reasonCode: attempt.reasonCode,
    })) ?? [],
    fetchedAt: result?.fetchedAt,
  };
}
