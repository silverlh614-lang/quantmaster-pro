import { describe, expect, it } from 'vitest';
import {
  canonicalizeOfficialIndexName,
  mapSectorNamesToOfficialIndexCodes,
  normalizeOfficialSectorName,
  type OfficialSectorIndexMasterRow,
} from './SectorIndexCodeMap.js';
import {
  buildOfficialSectorIndexMasterCoverage,
  classifyOfficialSectorIndexVerifyDisplay,
  resolveMasterLoadedButUnverifiedStatus,
  OFFICIAL_INDEX_MASTER_LOADED_BUT_UNVERIFIED,
} from './SectorIndexVerifier.js';

describe('D1 (observe-only): verify 실패 타입 분리 → providerIssue/dataQuality', () => {
  it('session closed/holiday → SESSION_NOT_VERIFIABLE, providerIssue=false (불변식 #6)', () => {
    expect(classifyOfficialSectorIndexVerifyDisplay({ sessionClosed: true, reasonCode: 'SECTOR_INDEX_MARKET_CLOSED' }))
      .toMatchObject({ displayClass: 'SESSION_NOT_VERIFIABLE', providerIssue: false, executionImpact: 'NONE', marketSignal: false });
    expect(classifyOfficialSectorIndexVerifyDisplay({ selectedFailureReason: 'HOLIDAY_NO_SESSION_OBSERVE_ONLY' }))
      .toMatchObject({ displayClass: 'SESSION_NOT_VERIFIABLE', providerIssue: false });
  });

  it('OPEN transport 실패 → OFFICIAL_INDEX_VERIFY_FAILED, providerIssue=true, executionImpact=NONE', () => {
    expect(classifyOfficialSectorIndexVerifyDisplay({ selectedFailureReason: 'KIS_INDEX_API_HTTP_ERROR' }))
      .toMatchObject({ displayClass: 'OFFICIAL_INDEX_VERIFY_FAILED', providerIssue: true, executionImpact: 'NONE', marketSignal: false });
  });

  it('parse 실패 → OFFICIAL_INDEX_VALUE_PARSE_FAILED, providerIssue=true, executionImpact=NONE', () => {
    expect(classifyOfficialSectorIndexVerifyDisplay({ selectedFailureReason: 'VALUE_PARSE_FAILED' }))
      .toMatchObject({ displayClass: 'OFFICIAL_INDEX_VALUE_PARSE_FAILED', providerIssue: true, executionImpact: 'NONE' });
  });

  it('index value 0 → VALUE_QUALITY_LOW (dataQuality=LOW), providerIssue=false', () => {
    expect(classifyOfficialSectorIndexVerifyDisplay({ selectedFailureReason: 'VALUE_QUALITY_ZERO' }))
      .toMatchObject({ displayClass: 'VALUE_QUALITY_LOW', dataQuality: 'LOW', providerIssue: false, executionImpact: 'NONE' });
  });

  it('verified → VERIFIED, providerIssue=false', () => {
    expect(classifyOfficialSectorIndexVerifyDisplay({ verified: true }))
      .toMatchObject({ displayClass: 'VERIFIED', providerIssue: false });
  });

  it('master loaded + OPEN + verify 0건 → OFFICIAL_INDEX_MASTER_LOADED_BUT_UNVERIFIED', () => {
    expect(resolveMasterLoadedButUnverifiedStatus({ masterLoaded: true, marketClosed: false, verifySuccessCount: 0 }))
      .toBe(OFFICIAL_INDEX_MASTER_LOADED_BUT_UNVERIFIED);
    // 휴장이면 status 없음 (세션닫힘이 우선, providerIssue 승격 금지).
    expect(resolveMasterLoadedButUnverifiedStatus({ masterLoaded: true, marketClosed: true, verifySuccessCount: 0 }))
      .toBeUndefined();
    // verify>0 또는 master 미로드면 없음.
    expect(resolveMasterLoadedButUnverifiedStatus({ masterLoaded: true, marketClosed: false, verifySuccessCount: 3 }))
      .toBeUndefined();
    expect(resolveMasterLoadedButUnverifiedStatus({ masterLoaded: false, marketClosed: false, verifySuccessCount: 0 }))
      .toBeUndefined();
  });
});

function officialRow(code: string, name: string): OfficialSectorIndexMasterRow {
  const canonical = canonicalizeOfficialIndexName(name);
  const idxDiv = canonical.codePrefix ?? '1';
  return {
    market: 'KOSPI',
    idxDiv,
    idxCode: code,
    officialIndexCode: code,
    officialIndexName: name,
    normalizedSectorName: normalizeOfficialSectorName(name),
    canonicalOfficialName: canonical.canonicalName,
    codePrefixRemoved: canonical.codePrefixRemoved,
    rawIdxName: name,
    normalizedIdxName: normalizeOfficialSectorName(name),
    rawSectorName: name,
    sourceTier: 'OFFICIAL_KIS_SECTOR_INDEX',
    aliasResolved: false,
    unsafeAlias: false,
    verifyInputCandidates: [
      code,
      `${idxDiv}${code}`,
      `${idxDiv}:${code}`,
      `${idxDiv}-${code}`,
    ],
  };
}

const masterRows: OfficialSectorIndexMasterRow[] = [
  officialRow('0021', 'finance'),
  officialRow('0006', 'chemical'),
];

const koreanMasterRows: OfficialSectorIndexMasterRow[] = [
  officialRow('0018', '\uAE08\uC735\uC5C5'),
  officialRow('0006', '\uD654\uD559'),
  officialRow('0012', '\uC6B4\uC218\uC7A5\uBE44'),
  officialRow('0005', '\uC804\uAE30\uC804\uC790'),
  officialRow('0011', '\uCCA0\uAC15\uAE08\uC18D'),
  officialRow('0026', '\uC11C\uBE44\uC2A4\uC5C5'),
  officialRow('0007', '\uAE30\uACC4'),
  officialRow('0016', '\uC6B4\uC218\uCC3D\uACE0'),
  officialRow('0015', '\uC720\uD1B5\uC5C5'),
];

describe('SectorIndexCodeMap', () => {
  it('maps exact and safe aliases into official coverage while keeping unsafe themes shadow-only', () => {
    const result = mapSectorNamesToOfficialIndexCodes({
      masterRows,
      targets: [
        { sectorName: 'finance' },
        { sectorName: 'chemicals' },
        { sectorName: 'defense', sectorKey: 'DEFENSE', candidateIndexCode: '0006' },
        { sectorName: 'unresolved' },
      ],
    });

    expect(result.targetSectorCount).toBe(4);
    expect(result.mappedSectorCount).toBe(2);
    expect(result.officialIndexCoverage).toBe(50);
    expect(result.exactMatchCount).toBe(1);
    expect(result.safeAliasCount).toBe(1);
    expect(result.unsafeAliasCount).toBe(1);
    expect(result.unresolvedSectorNames).toEqual(['unresolved']);
    expect(result.reasonCodes).toContain('INTERNAL_SECTOR_ALIAS_MISSING');
    expect(result.rows.find((row) => row.sectorName === 'defense')).toMatchObject({
      unsafeAlias: true,
      officialCoverageEligible: false,
      includedInOfficialCoverage: false,
      shadowEvidenceOnly: true,
      reasonCode: 'UNSAFE_ALIAS_EXCLUDED_FROM_PROMOTION',
    });
  });

  it('maps English internal sector names to Korean official idx_name safe aliases', () => {
    const result = mapSectorNamesToOfficialIndexCodes({
      masterRows: koreanMasterRows,
      targets: [
        { sectorName: 'AUTOMOTIVE' },
        { sectorName: 'CAR' },
        { sectorName: 'SEMICONDUCTOR' },
        { sectorName: 'CHIP' },
        { sectorName: 'STEEL' },
        { sectorName: 'CHEMISTRY' },
        { sectorName: 'MACHINE' },
        { sectorName: 'LOGISTICS' },
        { sectorName: 'DISTRIBUTION' },
        { sectorName: 'SERVICE' },
        { sectorName: 'INTERNET' },
      ],
    });

    expect(result.targetSectorCount).toBe(11);
    expect(result.mappedSectorCount).toBe(11);
    expect(result.officialIndexCoverage).toBe(100);
    expect(result.safeAliasMatchCount).toBe(11);
    expect(result.mappedSectorPairs.join('|')).toContain('AUTOMOTIVE ->');
    expect(result.rows.find((row) => row.sectorName === 'AUTOMOTIVE')).toMatchObject({
      officialIndexCode: '0012',
      officialCoverageEligible: true,
      includedInOfficialCoverage: true,
      safeAlias: true,
      safeAliasMatch: '\uC6B4\uC218\uC7A5\uBE44',
      safeAliasTarget: '\uC6B4\uC218\uC7A5\uBE44',
      aliasLookupKey: 'automotive',
      reasonCode: 'SAFE_ALIAS_MATCHED',
    });
    expect(result.rows.find((row) => row.sectorName === 'SEMICONDUCTOR')).toMatchObject({
      officialIndexCode: '0005',
      safeAliasMatch: '\uC804\uAE30\uC804\uC790',
    });
    expect(result.rows.find((row) => row.sectorName === 'CHIP')).toMatchObject({
      officialIndexCode: '0005',
      safeAliasMatch: '\uC804\uAE30\uC804\uC790',
    });
    expect(result.rows.find((row) => row.sectorName === 'STEEL')).toMatchObject({
      officialIndexCode: '0011',
      safeAliasMatch: '\uCCA0\uAC15\uAE08\uC18D',
    });
    expect(result.rows.find((row) => row.sectorName === 'SERVICE')).toMatchObject({
      officialIndexCode: '0026',
      safeAliasMatch: '\uC11C\uBE44\uC2A4\uC5C5',
    });
    expect(result.reasonCodes).toContain('SAFE_ALIAS_MATCHED');
  });

  it('matches Korean official names despite punctuation or whitespace variants', () => {
    const variantMasterRows: OfficialSectorIndexMasterRow[] = [
      officialRow('0005', '\uC804\uAE30 \uC804\uC790'),
      officialRow('0011', '\uCCA0\uAC15 \uAE08\uC18D'),
    ];
    const result = mapSectorNamesToOfficialIndexCodes({
      masterRows: variantMasterRows,
      targets: [
        { sectorName: 'SEMICONDUCTOR' },
        { sectorName: 'STEEL' },
      ],
    });

    expect(result.officialIndexCoverage).toBe(100);
    expect(result.rows.find((row) => row.sectorName === 'SEMICONDUCTOR')).toMatchObject({
      officialIndexCode: '0005',
      includedInOfficialCoverage: true,
    });
    expect(result.rows.find((row) => row.sectorName === 'STEEL')).toMatchObject({
      officialIndexCode: '0011',
      includedInOfficialCoverage: true,
    });
  });

  it('matches KIS official idx_name after removing numeric code prefixes', () => {
    expect(canonicalizeOfficialIndexName('8\uD654\uD559')).toEqual({
      canonicalName: '\uD654\uD559',
      codePrefixRemoved: true,
      codePrefix: '8',
    });
    expect(canonicalizeOfficialIndexName('5\uC74C\uC2DD\uB8CC\u00B7\uB2F4\uBC30')).toEqual({
      canonicalName: '\uC74C\uC2DD\uB8CC \uB2F4\uBC30',
      codePrefixRemoved: true,
      codePrefix: '5',
    });

    const prefixedMasterRows: OfficialSectorIndexMasterRow[] = [
      officialRow('0006', '8\uD654\uD559'),
      officialRow('0011', '11\uCCA0\uAC15 \uAE08\uC18D'),
      officialRow('0019', '19\uAC74\uC124'),
    ];
    const result = mapSectorNamesToOfficialIndexCodes({
      masterRows: prefixedMasterRows,
      targets: [
        { sectorName: '\uD654\uD559' },
        { sectorName: 'STEEL' },
        { sectorName: 'CONSTRUCTION' },
      ],
    });

    expect(result.officialIndexCoverage).toBe(100);
    expect(result.exactMatchCount).toBe(1);
    expect(result.safeAliasMatchCount).toBe(2);
    expect(result.safeSynonymMatchCount).toBe(1);
    expect(result.reasonCodes).toContain('SAFE_SYNONYM_MATCHED_CANONICAL');
    expect(result.mappedSectorPairs).toEqual(expect.arrayContaining([
      '\uD654\uD559 -> 8\uD654\uD559(code=0006)',
      'STEEL -> 11\uCCA0\uAC15 \uAE08\uC18D(code=0011)',
      'CONSTRUCTION -> 19\uAC74\uC124(code=0019)',
    ]));
    expect(result.mappingAttempts.find((row) => row.internalSectorName === '\uD654\uD559')).toMatchObject({
      selectedOfficialRawName: '8\uD654\uD559',
      selectedOfficialCanonicalName: '\uD654\uD559',
      canonicalOfficialCandidates: ['\uD654\uD559'],
      codePrefixRemoved: true,
      includedInOfficialCoverage: true,
      reasonCode: 'EXACT_MATCHED',
    });
    expect(result.mappingAttempts.find((row) => row.internalSectorName === 'STEEL')).toMatchObject({
      selectedOfficialRawName: '11\uCCA0\uAC15 \uAE08\uC18D',
      selectedOfficialCanonicalName: '\uCCA0\uAC15 \uAE08\uC18D',
      canonicalOfficialCandidates: ['\uCCA0\uAC15 \uAE08\uC18D'],
      codePrefixRemoved: true,
      includedInOfficialCoverage: true,
      reasonCode: 'SAFE_ALIAS_MATCHED',
    });
    expect(result.mappingAttempts.find((row) => row.internalSectorName === 'CONSTRUCTION')).toMatchObject({
      selectedOfficialRawName: '19\uAC74\uC124',
      selectedOfficialCanonicalName: '\uAC74\uC124',
      codePrefixRemoved: true,
      includedInOfficialCoverage: true,
      reasonCode: 'SAFE_ALIAS_MATCHED',
    });
  });

  it('excludes unsafe aliases from official coverage while preserving shadow evidence', () => {
    const result = mapSectorNamesToOfficialIndexCodes({
      masterRows: koreanMasterRows,
      targets: [
        { sectorName: 'DEFENSE' },
        { sectorName: 'SHIPBUILDING' },
        { sectorName: 'SECONDARY_BATTERY' },
        { sectorName: '\uBC18\uB3C4\uCCB4' },
      ],
    });

    expect(result.targetSectorCount).toBe(4);
    expect(result.mappedSectorCount).toBe(0);
    expect(result.officialIndexCoverage).toBe(0);
    expect(result.unsafeAliasCount).toBe(4);
    expect(result.unsafeAliasSectorNames).toEqual(['DEFENSE', 'SHIPBUILDING', 'SECONDARY_BATTERY', '\uBC18\uB3C4\uCCB4']);
    expect(result.rows.every((row) => row.shadowEvidenceOnly)).toBe(true);
    expect(result.rows.every((row) => !row.includedInOfficialCoverage)).toBe(true);
    expect(result.rows.find((row) => row.sectorName === 'DEFENSE')).toMatchObject({
      aliasLookupKey: 'defense',
      unsafeAliasTargets: expect.arrayContaining(['\uAE30\uACC4', '\uC6B4\uC218\uC7A5\uBE44', '\uC804\uAE30\uC804\uC790']),
      reasonCode: 'UNSAFE_ALIAS_EXCLUDED_FROM_PROMOTION',
    });
    expect(result.reasonCodes).toContain('UNSAFE_ALIAS_EXCLUDED_FROM_PROMOTION');
  });

  it('allows theme-like sectors when the official master has an exact canonical index', () => {
    const result = mapSectorNamesToOfficialIndexCodes({
      masterRows: [
        officialRow('4400', '3KRX \uBC18\uB3C4\uCCB4'),
        officialRow('4401', '2KRX \uC790\uB3D9\uCC28'),
        officialRow('4402', '8KRX \uCCA0\uAC15'),
        officialRow('4403', '5\uC720\uD1B5'),
      ],
      targets: [
        { sectorName: '\uBC18\uB3C4\uCCB4' },
        { sectorName: '\uC790\uB3D9\uCC28' },
        { sectorName: 'STEEL' },
        { sectorName: '\uC720\uD1B5/\uC18C\uBE44\uC7AC' },
      ],
    });

    expect(result.officialIndexCoverage).toBe(100);
    expect(result.rows.find((row) => row.sectorName === '\uBC18\uB3C4\uCCB4')).toMatchObject({
      officialIndexCode: '4400',
      exactMatch: true,
      unsafeAlias: false,
      includedInOfficialCoverage: true,
      reasonCode: 'EXACT_MATCHED',
    });
    expect(result.rows.find((row) => row.sectorName === '\uC790\uB3D9\uCC28')).toMatchObject({
      officialIndexCode: '4401',
      exactMatch: true,
      unsafeAlias: false,
      includedInOfficialCoverage: true,
      reasonCode: 'EXACT_MATCHED',
    });
    expect(result.rows.find((row) => row.sectorName === 'STEEL')).toMatchObject({
      officialIndexCode: '4402',
      safeAlias: true,
      includedInOfficialCoverage: true,
      reasonCode: 'SAFE_ALIAS_MATCHED',
    });
    expect(result.rows.find((row) => row.sectorName === '\uC720\uD1B5/\uC18C\uBE44\uC7AC')).toMatchObject({
      officialIndexCode: '4403',
      safeAlias: true,
      includedInOfficialCoverage: true,
      reasonCode: 'SAFE_ALIAS_MATCHED',
    });
  });

  it('reports EN_TO_KR_ALIAS_MISSING when loaded master cannot resolve English internal sectors', () => {
    const result = mapSectorNamesToOfficialIndexCodes({
      masterRows: [officialRow('0099', '\uC885\uD569')],
      targets: [{ sectorName: 'AUTOMOTIVE' }],
    });

    expect(result.officialIndexCoverage).toBe(0);
    expect(result.unresolvedSectorNames).toEqual(['AUTOMOTIVE']);
    expect(result.reasonCodes).toContain('EN_TO_KR_ALIAS_MISSING');
    expect(result.unresolvedSectorDetails).toEqual([expect.objectContaining({
      sector: 'AUTOMOTIVE',
      reason: 'ALIAS_TARGET_NOT_IN_MASTER',
      aliasTarget: '\uC6B4\uC218\uC7A5\uBE44',
    })]);
  });

  it('does not count internal grouped snapshot rows as official coverage', () => {
    const result = mapSectorNamesToOfficialIndexCodes({
      masterRows: [{
        market: 'UNKNOWN',
        officialIndexCode: 'INTERNAL_PROXY:\uAE08\uC735\uC5C5',
        officialIndexName: '\uAE08\uC735\uC5C5',
        normalizedSectorName: normalizeOfficialSectorName('\uAE08\uC735\uC5C5'),
        rawSectorName: '\uAE08\uC735\uC5C5',
        sourceTier: 'INTERNAL_GROUPED_SNAPSHOT',
        aliasResolved: false,
        unsafeAlias: false,
      }],
      targets: [{ sectorName: '\uAE08\uC735\uC5C5' }],
    });

    expect(result.mappedSectorCount).toBe(0);
    expect(result.officialIndexCoverage).toBe(0);
    expect(result.rows[0]).toMatchObject({
      sourceTier: 'INTERNAL_GROUPED_SNAPSHOT',
      officialCoverageEligible: false,
      shadowEvidenceOnly: true,
      reasonCode: 'NON_OFFICIAL_SOURCE_SHADOW_ONLY',
    });
  });

  it('expands verifyInputCandidates across the safe-alias family with KOSPI codes before KRX-series', () => {
    // STEEL alias-family: KOSPI 철강금속(0011) and KRX-series KRX 철강(4402).
    // Lever 1: probe candidates must include BOTH official codes so a nonzero KOSPI value can be
    // discovered even when the KRX-series code returns currentIndex=0, but coverage must not change.
    const result = mapSectorNamesToOfficialIndexCodes({
      masterRows: [
        officialRow('4402', 'KRX 철강'),
        officialRow('0011', '철강금속'),
      ],
      targets: [{ sectorName: 'STEEL' }],
    });

    // Selected (matched) row + coverage judgement is unchanged: KOSPI sector code wins, single mapped sector.
    expect(result.mappedSectorCount).toBe(1);
    expect(result.officialIndexCoverage).toBe(100);
    const steel = result.rows.find((row) => row.sectorName === 'STEEL');
    expect(steel?.officialIndexCode).toBe('0011');
    expect(steel?.includedInOfficialCoverage).toBe(true);

    const candidates = steel?.verifyInputCandidates ?? [];
    // Both the KOSPI (0xxx) and KRX-series (4xxx) bare codes are present (deduped, master-sourced only).
    expect(candidates).toContain('0011');
    expect(candidates).toContain('4402');
    // KOSPI 업종 code (0xxx) is ordered ahead of the KRX-series code (4xxx) so the probe tries it first.
    const firstKospi = candidates.findIndex((c) => /^[01]\d{3}$/.test(c.match(/(\d{4})$/)?.[1] ?? c));
    const firstKrx = candidates.findIndex((c) => /^[45]\d{3}$/.test(c.match(/(\d{4})$/)?.[1] ?? c));
    expect(firstKospi).toBeGreaterThanOrEqual(0);
    expect(firstKrx).toBeGreaterThan(firstKospi);
    expect(candidates.indexOf('0011')).toBeLessThan(candidates.indexOf('4402'));
    // No fabricated codes: every candidate resolves back to a master idxCode (0011 or 4402).
    expect(candidates.every((c) => /(?:0011|4402)$/.test(c))).toBe(true);
  });
});

describe('SectorIndexVerifier', () => {
  it('separates official mapped coverage from API verified coverage', async () => {
    const result = await buildOfficialSectorIndexMasterCoverage({
      provider: {
        masterSource: 'OFFICIAL_KIS_IDXCODE_MST',
        masterLoaded: true,
        masterRowCount: masterRows.length,
        idxcodeMstDownloaded: true,
        cacheFallbackUsed: false,
        parseStatus: 'OK',
        rows: masterRows,
        rawSampleRows: [{ idxDiv: '1', idxCode: '0021', idxName: 'finance', normalizedIdxName: 'finance' }],
        providerIssue: false,
        marketSignal: false,
        executionImpact: 'NONE',
        reasonCodes: ['OFFICIAL_INDEX_MASTER_LOADED'],
        cacheFile: 'memory',
        fetchedAt: '2026-05-23T00:00:00.000Z',
      },
      targets: [
        { sectorName: 'finance' },
        { sectorName: 'chemical' },
        { sectorName: 'unresolved' },
      ],
      verifyIndexCode: async (row) => ({
        officialIndexCode: row.officialIndexCode ?? '',
        sectorName: row.sectorName,
        verified: row.officialIndexCode === '0021',
        providerIssue: false,
        marketSignal: false,
        executionImpact: 'NONE',
        reasonCode: row.officialIndexCode === '0021' ? 'OK' : 'OFFICIAL_INDEX_API_VERIFY_FAILED',
      }),
    });

    expect(result.officialIndexCoverage).toBe(66.7);
    expect(result.verifiedIndexCodeCoverage).toBe(33.3);
    expect(result.mappedSectorCount).toBe(2);
    expect(result.verifiedIndexCodeCount).toBe(1);
    expect(result.exactMatchCount).toBe(2);
    expect(result.safeAliasCoverage).toBe(0);
    expect(result.unresolvedCount).toBe(1);
    expect(result.internalSectorNames).toEqual(['finance', 'chemical', 'unresolved']);
    expect(result.rawSampleRows?.[0]).toMatchObject({ idxCode: '0021', idxName: 'finance' });
    expect(result.aliasDictionaryStatus).toMatchObject({
      loaded: true,
    });
    expect(result.aliasDictionaryStatus?.sampleAliases.join('|')).toContain('AUTOMOTIVE ->');
    expect(result.verifyAttemptCount).toBe(2);
    expect(result.verifyApiSuccessSamples).toHaveLength(1);
    expect(result.verifyApiFailureSamples).toHaveLength(1);
    expect(result.mappingAttempts?.find((row) => row.internalSectorName === 'finance')).toMatchObject({
      verifyAttempted: true,
      verified: true,
    });
    expect(result.verifyApiPath).toBe('/uapi/domestic-stock/v1/quotations/inquire-index-price');
    expect(result.verifyTrId).toBe('FHPUP02100000');
    expect(result.reasonCodes).toContain('OFFICIAL_INDEX_API_VERIFY_FAILED');
    expect(result.reasonCodes).toContain('VERIFIED_INDEX_CODE_COVERAGE_LOW');
    expect(result.marketSignal).toBe(false);
    expect(result.executionImpact).toBe('NONE');
  });

  it('exposes denominator, unsafe alias, promotion policy, and index value quality separately', async () => {
    const result = await buildOfficialSectorIndexMasterCoverage({
      provider: {
        masterSource: 'OFFICIAL_KIS_IDXCODE_MST',
        masterLoaded: true,
        masterRowCount: masterRows.length,
        idxcodeMstDownloaded: true,
        cacheFallbackUsed: false,
        parseStatus: 'OK',
        rows: masterRows,
        providerIssue: false,
        marketSignal: false,
        executionImpact: 'NONE',
        reasonCodes: ['OFFICIAL_INDEX_MASTER_LOADED'],
        cacheFile: 'memory',
        fetchedAt: '2026-05-23T00:00:00.000Z',
      },
      targets: [
        { sectorName: 'finance' },
        { sectorName: 'chemical' },
        { sectorName: 'defense', sectorKey: 'DEFENSE', candidateIndexCode: '0006' },
        { sectorName: 'unresolved' },
      ],
      verifyIndexCode: async (row) => ({
        officialIndexCode: row.officialIndexCode ?? '',
        sectorName: row.sectorName,
        idxDiv: row.idxDiv,
        idxCode: row.idxCode,
        verified: row.sectorName !== 'finance',
        apiTransportSuccess: true,
        indexValueUsable: row.sectorName !== 'finance',
        valueQualityStatus: row.sectorName === 'finance' ? 'VALUE_QUALITY_ZERO' : 'USABLE',
        outputPresent: true,
        indexValueFieldPresent: true,
        currentIndex: row.sectorName === 'finance' ? 0 : 123.4,
        providerIssue: false,
        marketSignal: false,
        executionImpact: 'NONE',
        reasonCode: row.sectorName === 'finance' ? 'VALUE_QUALITY_ZERO' : 'VERIFY_SUCCESS',
      }),
    });

    expect(result.coverageDenominator).toMatchObject({
      officialTargetSectorCount: 4,
      safePromotionEligibleSectorCount: 2,
      unsafeAliasSectorCount: 1,
      unresolvedSectorCount: 1,
      verifiedSuccessCount: 1,
    });
    expect(result.coverageMetrics).toMatchObject({
      officialIndexCoverageByOfficialTarget: 50,
      verifiedCoverageByOfficialTarget: 25,
      verifiedCoverageExcludingUnsafeAlias: 50,
      promotionVerifiedCoverage: 25,
    });
    expect(result.promotionCoveragePolicy).toMatchObject({
      selectedMetric: 'SAFE_OFFICIAL_VERIFIED_COVERAGE',
      numerator: 1,
      denominator: 2,
      selectedCoverageValue: 50,
      promotionAllowed: false,
      reason: 'VERIFIED_INDEX_CODE_COVERAGE_LOW',
      officialTargetVerifiedCoverageDiagnostic: 25,
      decisionUsesSafeOfficialOnly: true,
      executionImpact: 'NONE',
    });
    expect(result.unsafeAliasPolicy).toMatchObject({
      includeInPromotionDenominator: false,
      includeInPromotionNumerator: false,
      useForShadowEvidence: true,
      useForLivePromotion: false,
      useForSectorBoost: false,
      useForStrongBuy: false,
      status: 'EXCLUDED_FROM_OFFICIAL_SECTOR_PROMOTION',
    });
    expect(result.indexValueQuality).toMatchObject({
      apiVerifiedCount: 2,
      apiTransportSuccessCount: 2,
      indexValueUsableCount: 1,
      zeroCurrentIndexCount: 1,
      nonZeroCurrentIndexCount: 1,
      qualityUsableCount: 1,
      qualityUsableCoverageByOfficialTarget: 25,
      qualityUsableCoverageExcludingUnsafeAlias: 50,
      zeroCurrentIndexSymbols: ['finance'],
      zeroCurrentIndexPolicy: 'OBSERVE_ONLY',
      valueQualityStatus: 'VALUE_QUALITY_ZERO',
      qualityImpact: 'BLOCK_LIVE_PROMOTION_ONLY',
      executionImpact: 'NONE',
    });
    expect(result.sectorIndexQuality?.find((row) => row.sectorName === 'finance')).toMatchObject({
      verified: false,
      apiTransportSuccess: true,
      indexValueUsable: false,
      valueQualityStatus: 'VALUE_QUALITY_ZERO',
      currentIndex: 0,
      qualityUsable: false,
      qualityReason: 'CURRENT_INDEX_ZERO',
      useForShadowLeadership: true,
      useForLivePromotion: false,
    });
    expect(result.promotionReadiness).toMatchObject({
      selectedPromotionMetric: 'SAFE_OFFICIAL_VERIFIED_COVERAGE',
      selectedPromotionCoverage: 50,
      requiredPromotionCoverage: 80,
      qualityUsableCoverageByOfficialTarget: 25,
      promotionAllowed: false,
      reason: 'VERIFIED_INDEX_CODE_COVERAGE_LOW',
      safeOnlyMetricWouldPass: false,
      safeOfficialTargetCount: 2,
      safeOfficialVerifiedCount: 1,
      safeOfficialVerifiedCoverage: 50,
      unsafeExcludedCount: 1,
      officialTargetVerifiedCoverageDiagnostic: 25,
      promotionCoveragePass: false,
      promotionAllowedByCoverage: false,
      decisionUsesSafeOfficialOnly: true,
      useAlternativeForLivePromotion: false,
    });
    expect(result.verifySuccessCount).toBe(1);
    expect(result.verifyFailCount).toBe(1);
    expect(result.reasonCodes).toContain('VALUE_QUALITY_ZERO');
    expect(result.reasonCodes).toContain('OFFICIAL_INDEX_ZERO_CURRENT_INDEX_OBSERVE_ONLY');
    expect(result.reasonCodes).toContain('INDEX_VALUE_QUALITY_LOW');
  });

  it('raises verified coverage only when an idxDiv+idxCode verify variant succeeds', async () => {
    const result = await buildOfficialSectorIndexMasterCoverage({
      provider: {
        masterSource: 'OFFICIAL_KIS_IDXCODE_MST',
        masterLoaded: true,
        masterRowCount: 1,
        idxcodeMstDownloaded: true,
        cacheFallbackUsed: false,
        parseStatus: 'OK',
        rows: [officialRow('0000', '8\uD654\uD559')],
        providerIssue: false,
        marketSignal: false,
        executionImpact: 'NONE',
        reasonCodes: ['OFFICIAL_INDEX_MASTER_LOADED'],
        cacheFile: 'memory',
        fetchedAt: '2026-05-23T00:00:00.000Z',
      },
      targets: [{ sectorName: '\uD654\uD559' }],
      verifyIndexCode: async (row) => ({
        officialIndexCode: row.officialIndexCode ?? '',
        sectorName: row.sectorName,
        rawIdxName: row.rawIdxName,
        idxDiv: row.idxDiv,
        idxCode: row.idxCode,
        canonicalOfficialName: row.canonicalOfficialName,
        fidCondMrktDivCode: 'U',
        fidInputIscd: '80000',
        verifiedInputIscd: '80000',
        verifyInputCandidates: row.verifyInputCandidates,
        triedCandidates: ['0000', '80000'],
        verified: true,
        apiTransportSuccess: true,
        indexValueUsable: true,
        valueQualityStatus: 'USABLE',
        currentIndex: 123.4,
        providerIssue: false,
        marketSignal: false,
        executionImpact: 'NONE',
        reasonCode: 'VERIFY_SUCCESS',
        attempts: [
          {
            sectorName: row.sectorName,
            rawIdxName: row.rawIdxName,
            idxDiv: row.idxDiv,
            idxCode: row.idxCode,
            canonicalOfficialName: row.canonicalOfficialName,
            fidCondMrktDivCode: 'U',
            fidInputIscd: '0000',
            apiPath: '/uapi/domestic-stock/v1/quotations/inquire-index-price',
            trId: 'FHPUP02100000',
            httpStatus: 200,
            rtCd: '1',
            msgCd: 'INVALID',
            msg1: 'bad code',
            outputPresent: false,
            indexValueFieldPresent: false,
            apiTransportSuccess: false,
            indexValueUsable: false,
            valueQualityStatus: 'API_TRANSPORT_FAILED',
            rawTopLevelKeys: ['rt_cd', 'msg_cd', 'msg1'],
            outputKeys: [],
            verified: false,
            reasonCode: 'KIS_INDEX_API_REJECTED_CODE',
          },
          {
            sectorName: row.sectorName,
            rawIdxName: row.rawIdxName,
            idxDiv: row.idxDiv,
            idxCode: row.idxCode,
            canonicalOfficialName: row.canonicalOfficialName,
            fidCondMrktDivCode: 'U',
            fidInputIscd: '80000',
            apiPath: '/uapi/domestic-stock/v1/quotations/inquire-index-price',
            trId: 'FHPUP02100000',
            httpStatus: 200,
            rtCd: '0',
            msgCd: 'MCA00000',
            msg1: 'OK',
            outputPresent: true,
            indexValueFieldPresent: true,
            apiTransportSuccess: true,
            indexValueUsable: true,
            valueQualityStatus: 'USABLE',
            currentIndex: 123.4,
            rawTopLevelKeys: ['rt_cd', 'msg_cd', 'msg1', 'output'],
            outputKeys: ['bstp_nmix_prpr'],
            verified: true,
            reasonCode: 'VERIFY_SUCCESS',
          },
        ],
      }),
    });

    expect(result.officialIndexCoverage).toBe(100);
    expect(result.verifiedIndexCodeCoverage).toBe(100);
    expect(result.verifySuccessCount).toBe(1);
    expect(result.verifyVariantAttemptCount).toBe(2);
    expect(result.verifyVariantTried).toBe(true);
    expect(result.verifyAttemptDetails?.map((attempt) => attempt.fidInputIscd)).toEqual(['0000', '80000']);
    expect(result.mappingAttempts?.[0]).toMatchObject({
      idxDiv: '8',
      idxCode: '0000',
      rawIdxName: '8\uD654\uD559',
      verifyInputCandidates: ['0000', '80000', '8:0000', '8-0000'],
      verifyAttempted: true,
      verified: true,
    });
    expect(result.reasonCodes).toContain('VERIFY_SUCCESS');
  });

  it('keeps official mapped coverage when all verify variants are exhausted', async () => {
    const result = await buildOfficialSectorIndexMasterCoverage({
      provider: {
        masterSource: 'OFFICIAL_KIS_IDXCODE_MST',
        masterLoaded: true,
        masterRowCount: 1,
        idxcodeMstDownloaded: true,
        cacheFallbackUsed: false,
        parseStatus: 'OK',
        rows: [officialRow('0000', '8\uD654\uD559')],
        providerIssue: false,
        marketSignal: false,
        executionImpact: 'NONE',
        reasonCodes: ['OFFICIAL_INDEX_MASTER_LOADED'],
        cacheFile: 'memory',
        fetchedAt: '2026-05-23T00:00:00.000Z',
      },
      targets: [{ sectorName: '\uD654\uD559' }],
      verifyIndexCode: async (row) => ({
        officialIndexCode: row.officialIndexCode ?? '',
        sectorName: row.sectorName,
        rawIdxName: row.rawIdxName,
        idxDiv: row.idxDiv,
        idxCode: row.idxCode,
        canonicalOfficialName: row.canonicalOfficialName,
        fidCondMrktDivCode: 'U',
        fidInputIscd: '8-0000',
        verifiedInputIscd: null,
        verifyInputCandidates: row.verifyInputCandidates,
        triedCandidates: row.verifyInputCandidates,
        verified: false,
        providerIssue: false,
        marketSignal: false,
        executionImpact: 'NONE',
        reasonCode: 'VERIFY_VARIANTS_EXHAUSTED',
        selectedFailureReason: 'KIS_INDEX_API_SCHEMA_MISMATCH',
        rtCd: '0',
        msgCd: 'MCA00000',
        msg1: 'OK',
        outputPresent: true,
        indexValueFieldPresent: false,
        outputKeys: ['unknown_field'],
        attempts: row.verifyInputCandidates.map((candidate) => ({
          sectorName: row.sectorName,
          rawIdxName: row.rawIdxName,
          idxDiv: row.idxDiv,
          idxCode: row.idxCode,
          canonicalOfficialName: row.canonicalOfficialName,
          fidCondMrktDivCode: 'U',
          fidInputIscd: candidate,
          apiPath: '/uapi/domestic-stock/v1/quotations/inquire-index-price',
          trId: 'FHPUP02100000',
          httpStatus: 200,
          rtCd: '0',
          msgCd: 'MCA00000',
          msg1: 'OK',
          outputPresent: true,
          indexValueFieldPresent: false,
          rawTopLevelKeys: ['rt_cd', 'msg_cd', 'msg1', 'output'],
          outputKeys: ['unknown_field'],
          verified: false,
          reasonCode: 'KIS_INDEX_API_SCHEMA_MISMATCH',
        })),
      }),
    });

    expect(result.officialIndexCoverage).toBe(100);
    expect(result.verifiedIndexCodeCoverage).toBe(0);
    expect(result.verifyFailCount).toBe(1);
    expect(result.verifyVariantAttemptCount).toBe(4);
    expect(result.reasonCodes).toEqual(expect.arrayContaining([
      'VERIFY_VARIANTS_EXHAUSTED',
      'KIS_INDEX_API_SCHEMA_MISMATCH',
      'PROMOTION_DISABLED_COVERAGE_BELOW_80',
    ]));
    expect(result.marketSignal).toBe(false);
    expect(result.executionImpact).toBe('NONE');
  });

  it('skips live verify on a closed market and classifies as SECTOR_INDEX_MARKET_CLOSED', async () => {
    let verifyCalls = 0;
    const result = await buildOfficialSectorIndexMasterCoverage({
      provider: {
        masterSource: 'OFFICIAL_KIS_IDXCODE_MST',
        masterLoaded: true,
        masterRowCount: masterRows.length,
        idxcodeMstDownloaded: true,
        cacheFallbackUsed: false,
        parseStatus: 'OK',
        rows: masterRows,
        providerIssue: false,
        marketSignal: false,
        executionImpact: 'NONE',
        reasonCodes: ['OFFICIAL_INDEX_MASTER_LOADED'],
        cacheFile: 'memory',
        fetchedAt: '2026-05-23T00:00:00.000Z',
      },
      targets: [{ sectorName: 'finance' }, { sectorName: 'chemical' }],
      marketClosed: true,
      verifyIndexCode: async (row) => {
        verifyCalls += 1;
        return {
          officialIndexCode: row.officialIndexCode ?? '',
          sectorName: row.sectorName,
          verified: true,
          providerIssue: false,
          marketSignal: false,
          executionImpact: 'NONE',
          reasonCode: 'OK',
        };
      },
    });

    // 휴장일엔 라이브 KIS verify 를 호출하지 않는다 (쿼터 절약 + 0/실패 false-alarm 제거).
    expect(verifyCalls).toBe(0);
    expect(result.verifiedIndexCodeCoverage).toBe(0);
    expect(result.promotionReadiness?.promotionAllowed).toBe(false);
    expect(result.promotionReadiness?.reason).toBe('SECTOR_INDEX_MARKET_CLOSED_OBSERVE_ONLY');
    expect(result.promotionCoveragePolicy?.reason).toBe('SECTOR_INDEX_MARKET_CLOSED');
    expect(result.reasonCodes).toEqual(expect.arrayContaining([
      'SECTOR_INDEX_MARKET_CLOSED',
      'HOLIDAY_NO_SESSION_OBSERVE_ONLY',
    ]));
    // provider 장애·verify 실패 코드를 휴장 false-alarm 으로 남기지 않는다 (불변식 #6).
    expect(result.reasonCodes).not.toContain('OFFICIAL_INDEX_API_VERIFY_FAILED');
    expect(result.reasonCodes).not.toContain('OFFICIAL_INDEX_API_VERIFY_ATTEMPTED');
    expect(result.reasonCodes).not.toContain('PROMOTION_DISABLED_COVERAGE_BELOW_80');
    expect(result.marketSignal).toBe(false);
    expect(result.executionImpact).toBe('NONE');
    // ADR-0544 T7 precondition: 휴장 스킵 시 clientStatus 가 없으므로 render 가
    // 인증장애처럼 보이던 근본원인. providerIssue=false 가 보존되어야 한다 (불변식 #6).
    expect(result.kisIndexQuoteClientStatus).toBeUndefined();
    expect(result.providerIssue).toBe(false);
  });

  it('surfaces KRX/theme index names as themeIndexCandidates for unmapped-sector mapping diagnosis', async () => {
    const themedRows: OfficialSectorIndexMasterRow[] = [
      officialRow('4400', 'KRX 2차전지'),
      officialRow('4400', 'KRX 방산'),
      officialRow('0000', '8화학'),
      officialRow('0002', '1금융'),
    ];
    const result = await buildOfficialSectorIndexMasterCoverage({
      provider: {
        masterSource: 'OFFICIAL_KIS_IDXCODE_MST',
        masterLoaded: true,
        masterRowCount: themedRows.length,
        idxcodeMstDownloaded: true,
        cacheFallbackUsed: false,
        parseStatus: 'OK',
        rows: themedRows,
        providerIssue: false,
        marketSignal: false,
        executionImpact: 'NONE',
        reasonCodes: ['OFFICIAL_INDEX_MASTER_LOADED'],
        cacheFile: 'memory',
        fetchedAt: '2026-05-23T00:00:00.000Z',
      },
      targets: [{ sectorName: 'finance' }],
      marketClosed: true,
    });

    // KRX/테마 키워드 매칭 행만 노출하고, 일반 업종(화학/금융)은 제외한다.
    expect(result.themeIndexCandidates).toEqual(expect.arrayContaining([
      expect.stringContaining('KRX 2차전지'),
      expect.stringContaining('KRX 방산'),
    ]));
    expect(result.themeIndexCandidates?.some((entry) => entry.includes('금융'))).toBe(false);
  });
});
