// @responsibility ADR-0462 SectorAliasResolver — alias/canonical/indexCode/aggregate lookup audit

import type { SectorIndexMasterItem } from './sectorIndexMaster.js';
import { getSectorIndexMasterItems } from './sectorIndexMaster.js';

export interface SectorAliasResolutionAudit {
  aliasMissing: string[];
  aggregateIgnored: string[];
  recoveredAliases: string[];
  duplicateAliases: string[];
}

export interface SectorAliasResolver {
  resolveAlias(alias: string | null | undefined): string | null;
  getByCanonicalSectorId(canonicalSectorId: string | null | undefined): SectorIndexMasterItem | null;
  resolveIndexCode(indexCode: string | null | undefined): string | null;
  getAggregateGroup(canonicalSectorId: string | null | undefined): string | null;
  auditAliases(aliases: ReadonlyArray<string>): SectorAliasResolutionAudit;
  duplicateAliases: string[];
}

function normalize(value: string | null | undefined): string | null {
  if (!value || typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized ? normalized : null;
}

export function createSectorAliasResolver(
  master: ReadonlyArray<SectorIndexMasterItem> = getSectorIndexMasterItems(),
): SectorAliasResolver {
  const byCanonical = new Map<string, SectorIndexMasterItem>();
  const byIndexCode = new Map<string, string>();
  const aliasTargets = new Map<string, Set<string>>();

  for (const item of master) {
    byCanonical.set(item.canonicalSectorId, item);
    if (item.krxIndexCode) byIndexCode.set(item.krxIndexCode.trim(), item.canonicalSectorId);
    for (const alias of item.aliases) {
      const key = normalize(alias);
      if (!key) continue;
      const targets = aliasTargets.get(key) ?? new Set<string>();
      targets.add(item.canonicalSectorId);
      aliasTargets.set(key, targets);
    }
  }

  const duplicateAliases = Array.from(aliasTargets.entries())
    .filter(([, targets]) => targets.size > 1)
    .map(([alias]) => alias);

  return {
    duplicateAliases,
    resolveAlias(alias) {
      const key = normalize(alias);
      if (!key) return null;
      const targets = aliasTargets.get(key);
      if (!targets || targets.size !== 1) return null;
      return Array.from(targets)[0] ?? null;
    },
    getByCanonicalSectorId(canonicalSectorId) {
      if (!canonicalSectorId) return null;
      return byCanonical.get(canonicalSectorId) ?? null;
    },
    resolveIndexCode(indexCode) {
      if (!indexCode || typeof indexCode !== 'string') return null;
      return byIndexCode.get(indexCode.trim()) ?? null;
    },
    getAggregateGroup(canonicalSectorId) {
      const item = canonicalSectorId ? byCanonical.get(canonicalSectorId) : null;
      return item?.aggregateGroup ?? null;
    },
    auditAliases(aliases) {
      const audit: SectorAliasResolutionAudit = {
        aliasMissing: [],
        aggregateIgnored: [],
        recoveredAliases: [],
        duplicateAliases,
      };
      for (const alias of aliases) {
        const resolved = this.resolveAlias(alias);
        if (!resolved) {
          audit.aliasMissing.push(alias);
          continue;
        }
        const item = byCanonical.get(resolved);
        if (item?.aggregateGroup) {
          audit.aggregateIgnored.push(alias);
          continue;
        }
        if (normalize(alias) !== normalize(item?.displayNameKo)) audit.recoveredAliases.push(alias);
      }
      return audit;
    },
  };
}
