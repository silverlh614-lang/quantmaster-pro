import { describe, expect, it } from 'vitest';
import { mapSectorNamesToOfficialIndexCodes, type OfficialSectorIndexMasterRow } from './SectorIndexCodeMap.js';
import { buildOfficialSectorIndexMasterCoverage } from './SectorIndexVerifier.js';

const masterRows: OfficialSectorIndexMasterRow[] = [
  {
    market: 'KOSPI',
    idxDiv: '1',
    officialIndexCode: '0021',
    officialIndexName: 'finance',
    normalizedSectorName: 'finance',
    rawSectorName: 'finance',
    sourceTier: 'OFFICIAL_KIS_SECTOR_INDEX',
    aliasResolved: false,
    unsafeAlias: false,
  },
  {
    market: 'KOSPI',
    idxDiv: '1',
    officialIndexCode: '0006',
    officialIndexName: 'chemical',
    normalizedSectorName: 'chemical',
    rawSectorName: 'chemical',
    sourceTier: 'OFFICIAL_KIS_SECTOR_INDEX',
    aliasResolved: false,
    unsafeAlias: false,
  },
];

const koreanMasterRows: OfficialSectorIndexMasterRow[] = [
  {
    market: 'KOSPI',
    idxDiv: '1',
    officialIndexCode: '0018',
    officialIndexName: '금융업',
    normalizedSectorName: '금융업',
    rawSectorName: '금융업',
    sourceTier: 'OFFICIAL_KIS_SECTOR_INDEX',
    aliasResolved: false,
    unsafeAlias: false,
  },
  {
    market: 'KOSPI',
    idxDiv: '1',
    officialIndexCode: '0006',
    officialIndexName: '화학',
    normalizedSectorName: '화학',
    rawSectorName: '화학',
    sourceTier: 'OFFICIAL_KIS_SECTOR_INDEX',
    aliasResolved: false,
    unsafeAlias: false,
  },
  {
    market: 'KOSPI',
    idxDiv: '1',
    officialIndexCode: '0012',
    officialIndexName: '운수장비',
    normalizedSectorName: '운수장비',
    rawSectorName: '운수장비',
    sourceTier: 'OFFICIAL_KIS_SECTOR_INDEX',
    aliasResolved: false,
    unsafeAlias: false,
  },
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
    expect(result.safeAliasCount).toBe(1);
    expect(result.unsafeAliasCount).toBe(1);
    expect(result.unresolvedSectorNames).toEqual(['unresolved']);
    expect(result.rows.find((row) => row.sectorName === 'defense')).toMatchObject({
      unsafeAlias: true,
      officialCoverageEligible: false,
      shadowEvidenceOnly: true,
      reasonCode: 'UNSAFE_ALIAS_SHADOW_ONLY',
    });
  });

  it('maps Korean safe aliases and excludes Korean theme aliases from official coverage', () => {
    const result = mapSectorNamesToOfficialIndexCodes({
      masterRows: koreanMasterRows,
      targets: [
        { sectorName: '금융' },
        { sectorName: '화학' },
        { sectorName: '방산', sectorKey: 'DEFENSE', candidateIndexCode: '0012' },
        { sectorName: '반도체', candidateIndexCode: '0006' },
      ],
    });

    expect(result.targetSectorCount).toBe(4);
    expect(result.mappedSectorCount).toBe(2);
    expect(result.officialIndexCoverage).toBe(50);
    expect(result.safeAliasCount).toBe(1);
    expect(result.unsafeAliasCount).toBe(2);
    expect(result.rows.find((row) => row.sectorName === '금융')).toMatchObject({
      officialIndexCode: '0018',
      safeAlias: true,
      officialCoverageEligible: true,
    });
    expect(result.rows.find((row) => row.sectorName === '방산')).toMatchObject({
      unsafeAlias: true,
      officialCoverageEligible: false,
      shadowEvidenceOnly: true,
    });
    expect(result.rows.find((row) => row.sectorName === '반도체')).toMatchObject({
      unsafeAlias: true,
      officialCoverageEligible: false,
      shadowEvidenceOnly: true,
    });
  });

  it('does not count internal grouped snapshot rows as official coverage', () => {
    const result = mapSectorNamesToOfficialIndexCodes({
      masterRows: [{
        market: 'UNKNOWN',
        officialIndexCode: 'INTERNAL_PROXY:금융업',
        officialIndexName: '금융업',
        normalizedSectorName: '금융업',
        rawSectorName: '금융업',
        sourceTier: 'INTERNAL_GROUPED_SNAPSHOT',
        aliasResolved: false,
        unsafeAlias: false,
      }],
      targets: [{ sectorName: '금융업' }],
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
    expect(result.safeAliasCoverage).toBe(0);
    expect(result.unresolvedCount).toBe(1);
    expect(result.verifyApiSuccessSamples).toHaveLength(1);
    expect(result.verifyApiFailureSamples).toHaveLength(1);
    expect(result.verifyApiPath).toBe('/uapi/domestic-stock/v1/quotations/inquire-index-price');
    expect(result.verifyTrId).toBe('FHPUP02100000');
    expect(result.reasonCodes).toContain('OFFICIAL_INDEX_API_VERIFY_FAILED');
    expect(result.marketSignal).toBe(false);
    expect(result.executionImpact).toBe('NONE');
  });
});
