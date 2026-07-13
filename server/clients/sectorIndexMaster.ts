// @responsibility ADR-0462 SectorIndexMaster SSOT — canonical sector/index/alias/source-tier map

import { SECTOR_INDEX_MASTER as LEGACY_SECTOR_INDEX_MASTER } from './sectorEnergyMaster.js';

export type SectorSourceTier =
  | 'KIS_OFFICIAL_INDEX'
  | 'KIS_OFFICIAL_DAILY'
  | 'KIS_STOCK_BASKET_DERIVED'
  | 'KRX_INDEX'
  | 'KRX_ETF'
  | 'YAHOO_GLOBAL_PROXY'
  | 'YAHOO_PROXY'
  | 'STOCK_DAILY_FALLBACK'
  | 'INTERNAL_PROXY'
  | 'MISSING';

type SectorDataConfidence = 'VERIFIED' | 'PARTIAL' | 'DIAGNOSTIC' | 'DEGRADED' | 'STALE' | 'MISSING';

export interface SectorIndexMasterItem {
  canonicalSectorId: string;
  canonicalSectorName: string;
  displayNameKo: string;
  krxIndexCode?: string;
  krxIndexName?: string;
  yahooSymbol?: string;
  etfSymbols?: string[];
  aliases: string[];
  aggregateGroup?: string;
  isTradableSector: boolean;
  sourceTier: SectorSourceTier;
  confidence: SectorDataConfidence;
}

export const SECTOR_INDEX_MASTER_VERSION = 'ADR-0462.1';

function sourceTierForLegacyEntry(entry: (typeof LEGACY_SECTOR_INDEX_MASTER)[number]): SectorSourceTier {
  if (entry.krxIndexCode) return 'KRX_INDEX';
  if (entry.yahooProxySymbol) return 'YAHOO_PROXY';
  return 'STOCK_DAILY_FALLBACK';
}

const SECTOR_INDEX_MASTER_ADR0462: ReadonlyArray<SectorIndexMasterItem> = Object.freeze(
  LEGACY_SECTOR_INDEX_MASTER.map((entry) => {
    const sourceTier = sourceTierForLegacyEntry(entry);
    return Object.freeze({
      canonicalSectorId: entry.sectorKey,
      canonicalSectorName: entry.displayName,
      displayNameKo: entry.displayName,
      krxIndexCode: entry.krxIndexCode,
      krxIndexName: `${entry.market} ${entry.displayName}`,
      yahooSymbol: entry.yahooProxySymbol,
      etfSymbols: entry.yahooProxySymbol ? [entry.yahooProxySymbol] : [],
      aliases: Array.from(new Set([entry.displayName, ...entry.aliases])),
      aggregateGroup: entry.sectorKey === 'OTHER' ? 'AGGREGATE_OTHER' : undefined,
      isTradableSector: entry.sectorKey !== 'OTHER',
      sourceTier,
      confidence: sourceTier === 'STOCK_DAILY_FALLBACK' ? 'DEGRADED' : 'VERIFIED',
    } satisfies SectorIndexMasterItem);
  }),
);

export function getSectorIndexMasterItems(): ReadonlyArray<SectorIndexMasterItem> {
  return SECTOR_INDEX_MASTER_ADR0462;
}

export function isScoringSourceTier(sourceTier: SectorSourceTier): boolean {
  return (
    sourceTier === 'KIS_OFFICIAL_INDEX' ||
    sourceTier === 'KIS_OFFICIAL_DAILY' ||
    sourceTier === 'KIS_STOCK_BASKET_DERIVED' ||
    sourceTier === 'KRX_INDEX' ||
    sourceTier === 'KRX_ETF' ||
    sourceTier === 'YAHOO_PROXY'
  );
}
