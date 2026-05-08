// @responsibility ADR-0462 Sector coverage denominator SSOT

import type { SectorIndexMasterItem, SectorSourceTier } from './sectorIndexMaster.js';
import { getSectorIndexMasterItems } from './sectorIndexMaster.js';

export interface CoverageMetric { valid: number; total: number; ratio: number }
export interface SectorCoverageReport {
  sectorCoverage: CoverageMetric;
  indexCodeCoverage: CoverageMetric;
  aliasCoverage: CoverageMetric;
  providerCoverage: CoverageMetric;
}

export interface SectorCoverageInput {
  validCanonicalSectorIds?: ReadonlyArray<string>;
  validIndexCodes?: ReadonlyArray<string>;
  validAliases?: ReadonlyArray<string>;
  providerHealthyCanonicalSectorIds?: ReadonlyArray<string>;
  providerHealthySourceTiers?: ReadonlyArray<SectorSourceTier>;
}

function metric(valid: number, total: number): CoverageMetric {
  const safeTotal = Math.max(0, total);
  const safeValid = Math.max(0, Math.min(valid, safeTotal));
  return { valid: safeValid, total: safeTotal, ratio: safeTotal === 0 ? 0 : safeValid / safeTotal };
}

export function deriveSectorCoverageReport(
  input: SectorCoverageInput = {},
  master: ReadonlyArray<SectorIndexMasterItem> = getSectorIndexMasterItems(),
): SectorCoverageReport {
  const tradable = master.filter((item) => item.isTradableSector);
  const indexCodeTotal = tradable.filter((item) => item.krxIndexCode).length;
  const aliasTotal = master.reduce((sum, item) => sum + item.aliases.length, 0);
  const validSectors = new Set(input.validCanonicalSectorIds ?? []);
  const validCodes = new Set(input.validIndexCodes ?? []);
  const validAliases = new Set((input.validAliases ?? []).map((alias) => alias.trim().toLowerCase()));
  const providerIds = new Set(input.providerHealthyCanonicalSectorIds ?? []);

  return {
    sectorCoverage: metric(tradable.filter((item) => validSectors.has(item.canonicalSectorId)).length, tradable.length),
    indexCodeCoverage: metric(tradable.filter((item) => item.krxIndexCode && validCodes.has(item.krxIndexCode)).length, indexCodeTotal),
    aliasCoverage: metric(
      master.reduce((sum, item) => sum + item.aliases.filter((alias) => validAliases.has(alias.trim().toLowerCase())).length, 0),
      aliasTotal,
    ),
    providerCoverage: metric(tradable.filter((item) => providerIds.has(item.canonicalSectorId)).length, tradable.length),
  };
}

export function formatCoverageMetric(metricValue: CoverageMetric): string {
  return `${metricValue.valid}/${metricValue.total} (${(metricValue.ratio * 100).toFixed(1)}%)`;
}
