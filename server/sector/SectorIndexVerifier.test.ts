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
    expect(result.verifyApiPath).toBe('/uapi/domestic-stock/v1/quotations/inquire-index-price');
    expect(result.verifyTrId).toBe('FHPUP02100000');
    expect(result.reasonCodes).toContain('OFFICIAL_INDEX_API_VERIFY_FAILED');
    expect(result.marketSignal).toBe(false);
    expect(result.executionImpact).toBe('NONE');
  });
});
