import { normalizeSectorName, resolveSectorAlias, type SectorIndexMasterRow } from './SectorIndexCodeMap';

export const KIS_OFFICIAL_SECTOR_INDEX_MASTER_URL =
  'https://new.real.download.dws.co.kr/common/master/idxcode.mst.zip';

export const KIS_SECTOR_INDEX_APIS = Object.freeze({
  currentPrice: {
    path: '/uapi/domestic-stock/v1/quotations/inquire-index-price',
    trId: 'FHPUP02100000',
  },
  dailyPrice: {
    path: '/uapi/domestic-stock/v1/quotations/inquire-index-daily-price',
    trId: 'FHPUP02120000',
  },
  chartPrice: {
    path: '/uapi/domestic-stock/v1/quotations/inquire-daily-indexchartprice',
    trId: 'FHKUP03500100',
  },
  categoryPrice: {
    path: '/uapi/domestic-stock/v1/quotations/inquire-index-category-price',
    trId: 'FHPUP02140000',
  },
} as const);

export const SECTOR_ENERGY_SOURCE_PRIORITY = [
  'OFFICIAL_KRX_SECTOR_INDEX',
  'OFFICIAL_KIS_SECTOR_INDEX',
  'INTERNAL_GROUPED_SNAPSHOT',
  'KIS_STOCK_BASKET_DERIVED',
  'NONE',
] as const;

export interface SectorIndexMasterProviderResult {
  rows: SectorIndexMasterRow[];
  providerIssue: boolean;
  reasonCodes: string[];
}

export interface RawKisSectorIndexMasterRow {
  idxDiv?: string;
  idxCode: string;
  idxName: string;
  market?: 'KOSPI' | 'KOSDAQ' | 'KOSPI200' | 'UNKNOWN';
}

export function parseIdxCodeMasterText(text: string): RawKisSectorIndexMasterRow[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const csvParts = line.split(/[,\t|]+/).map((part) => part.trim()).filter(Boolean);
      if (csvParts.length >= 3) {
        return { idxDiv: csvParts[0], idxCode: csvParts[1], idxName: csvParts.slice(2).join(' ') };
      }

      const fixed = line.match(/^(.{1,2})\s*(\d{4})\s+(.+)$/);
      if (fixed) {
        return { idxDiv: fixed[1].trim(), idxCode: fixed[2], idxName: fixed[3].trim() };
      }

      return null;
    })
    .filter((row): row is RawKisSectorIndexMasterRow => Boolean(row?.idxCode && row.idxName));
}

/**
 * Official idxcode.mst loader entrypoint.
 * Network or parser failures are isolated as providerIssue only.
 */
export async function buildSectorIndexMaster(rows: RawKisSectorIndexMasterRow[]): Promise<SectorIndexMasterProviderResult> {
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
