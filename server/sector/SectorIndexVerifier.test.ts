import { describe, expect, it } from 'vitest';
import {
  mapSectorNamesToOfficialIndexCodes,
  normalizeOfficialSectorName,
  type OfficialSectorIndexMasterRow,
} from './SectorIndexCodeMap.js';
import { buildOfficialSectorIndexMasterCoverage } from './SectorIndexVerifier.js';

function officialRow(code: string, name: string): OfficialSectorIndexMasterRow {
  return {
    market: 'KOSPI',
    idxDiv: '1',
    officialIndexCode: code,
    officialIndexName: name,
    normalizedSectorName: normalizeOfficialSectorName(name),
    rawSectorName: name,
    sourceTier: 'OFFICIAL_KIS_SECTOR_INDEX',
    aliasResolved: false,
    unsafeAlias: false,
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
      reasonCode: 'UNSAFE_ALIAS_SHADOW_ONLY',
    });
  });

  it('maps English internal sector names to Korean official idx_name safe aliases', () => {
    const result = mapSectorNamesToOfficialIndexCodes({
      masterRows: koreanMasterRows,
      targets: [
        { sectorName: 'AUTOMOTIVE' },
        { sectorName: 'SEMICONDUCTOR' },
        { sectorName: 'STEEL' },
        { sectorName: 'INTERNET' },
      ],
    });

    expect(result.targetSectorCount).toBe(4);
    expect(result.mappedSectorCount).toBe(4);
    expect(result.officialIndexCoverage).toBe(100);
    expect(result.safeAliasMatchCount).toBe(4);
    expect(result.mappedSectorPairs.join('|')).toContain('AUTOMOTIVE ->');
    expect(result.rows.find((row) => row.sectorName === 'AUTOMOTIVE')).toMatchObject({
      officialIndexCode: '0012',
      officialCoverageEligible: true,
      includedInOfficialCoverage: true,
      safeAlias: true,
      safeAliasMatch: '\uC6B4\uC218\uC7A5\uBE44',
    });
    expect(result.rows.find((row) => row.sectorName === 'SEMICONDUCTOR')).toMatchObject({
      officialIndexCode: '0005',
      safeAliasMatch: '\uC804\uAE30\uC804\uC790',
    });
    expect(result.rows.find((row) => row.sectorName === 'STEEL')).toMatchObject({
      officialIndexCode: '0011',
      safeAliasMatch: '\uCCA0\uAC15\uAE08\uC18D',
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
    expect(result.reasonCodes).toContain('UNSAFE_ALIAS_EXCLUDED_FROM_PROMOTION');
  });

  it('reports EN_TO_KR_ALIAS_MISSING when loaded master cannot resolve English internal sectors', () => {
    const result = mapSectorNamesToOfficialIndexCodes({
      masterRows: [officialRow('0099', '\uC885\uD569')],
      targets: [{ sectorName: 'AUTOMOTIVE' }],
    });

    expect(result.officialIndexCoverage).toBe(0);
    expect(result.unresolvedSectorNames).toEqual(['AUTOMOTIVE']);
    expect(result.reasonCodes).toContain('EN_TO_KR_ALIAS_MISSING');
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
});
