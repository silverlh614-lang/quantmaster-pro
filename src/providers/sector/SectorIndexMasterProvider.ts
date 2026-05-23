import { normalizeSectorName, resolveSectorAlias, type SectorIndexMasterRow } from './SectorIndexCodeMap';

export interface SectorIndexMasterProviderResult {
  rows: SectorIndexMasterRow[];
  providerIssue: boolean;
  reasonCodes: string[];
}

/**
 * Official idxcode.mst loader entrypoint.
 * Network or parser failures are isolated as providerIssue only.
 */
export async function buildSectorIndexMaster(rows: Array<{
  idxDiv?: string;
  idxCode: string;
  idxName: string;
  market?: 'KOSPI' | 'KOSDAQ' | 'KOSPI200' | 'UNKNOWN';
}>): Promise<SectorIndexMasterProviderResult> {
  try {
    const normalizedRows = rows.map((row): SectorIndexMasterRow => {
      const normalized = normalizeSectorName(row.idxName);
      const alias = resolveSectorAlias(normalized);
      return {
        market: row.market ?? 'UNKNOWN',
        idxDiv: row.idxDiv,
        officialIndexCode: row.idxCode,
        officialIndexName: row.idxName,
        normalizedSectorName: alias.resolved,
        rawSectorName: row.idxName,
        sourceTier: 'OFFICIAL_KIS_SECTOR_INDEX',
        aliasResolved: alias.aliasResolved,
        aliasSource: alias.aliasSource,
        unsafeAlias: alias.unsafeAlias,
      };
    });

    return {
      rows: normalizedRows,
      providerIssue: false,
      reasonCodes: ['OFFICIAL_INDEX_MASTER_LOADED'],
    };
  } catch {
    return {
      rows: [],
      providerIssue: true,
      reasonCodes: ['OFFICIAL_INDEX_MASTER_LOAD_FAILED', 'EXECUTION_IMPACT_NONE_CONFIRMED'],
    };
  }
}
