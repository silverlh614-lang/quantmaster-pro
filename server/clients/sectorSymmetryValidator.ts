// @responsibility ADR-0462 Sector symmetry validation — pure runtime-free validation

import type { SectorIndexMasterItem } from './sectorIndexMaster.js';
import { getSectorIndexMasterItems, isScoringSourceTier } from './sectorIndexMaster.js';
import { createSectorAliasResolver } from './sectorAliasResolver.js';
import { deriveSectorCoverageReport } from './sectorCoverage.js';

export interface SectorSymmetryValidationResult {
  ok: boolean;
  failedReasons: string[];
  duplicateAliases: string[];
  unresolvedAliases: string[];
  missingIndexCodes: string[];
  reverseLookupFailures: string[];
  aggregateIgnored: number;
}

export function validateSectorSymmetry(
  master: ReadonlyArray<SectorIndexMasterItem> = getSectorIndexMasterItems(),
): SectorSymmetryValidationResult {
  const resolver = createSectorAliasResolver(master);
  const failedReasons: string[] = [];
  const unresolvedAliases: string[] = [];
  const missingIndexCodes: string[] = [];
  const reverseLookupFailures: string[] = [];
  let aggregateIgnored = 0;

  for (const item of master) {
    if (item.aggregateGroup) aggregateIgnored += 1;
    if (item.isTradableSector && !item.krxIndexCode && !item.yahooSymbol && (!item.etfSymbols || item.etfSymbols.length === 0)) {
      missingIndexCodes.push(item.canonicalSectorId);
    }
    for (const alias of item.aliases) {
      const resolved = resolver.resolveAlias(alias);
      if (resolved !== item.canonicalSectorId) unresolvedAliases.push(alias);
    }
    if (item.krxIndexCode && resolver.resolveIndexCode(item.krxIndexCode) !== item.canonicalSectorId) {
      reverseLookupFailures.push(item.krxIndexCode);
    }
    if (item.sourceTier === 'STOCK_DAILY_FALLBACK' && isScoringSourceTier(item.sourceTier)) {
      failedReasons.push('STOCK_DAILY_FALLBACK_SCORING_ENABLED');
    }
  }

  const coverage = deriveSectorCoverageReport({
    validCanonicalSectorIds: master.filter((item) => item.isTradableSector).map((item) => item.canonicalSectorId),
    validIndexCodes: master.flatMap((item) => item.krxIndexCode ? [item.krxIndexCode] : []),
    validAliases: master.flatMap((item) => item.aliases),
    providerHealthyCanonicalSectorIds: master.filter((item) => item.isTradableSector).map((item) => item.canonicalSectorId),
  }, master);
  if (coverage.sectorCoverage.total !== master.filter((item) => item.isTradableSector).length) failedReasons.push('DENOMINATOR_MISMATCH');
  if (resolver.duplicateAliases.length > 0) failedReasons.push('DUPLICATE_ALIAS');
  if (unresolvedAliases.length > 0) failedReasons.push('ALIAS_MISSING');
  if (missingIndexCodes.length > 0) failedReasons.push('MISSING_INDEX_CODE_OR_PROXY');
  if (reverseLookupFailures.length > 0) failedReasons.push('REVERSE_LOOKUP_FAILED');

  return {
    ok: failedReasons.length === 0,
    failedReasons: Array.from(new Set(failedReasons)),
    duplicateAliases: resolver.duplicateAliases,
    unresolvedAliases,
    missingIndexCodes,
    reverseLookupFailures,
    aggregateIgnored,
  };
}
