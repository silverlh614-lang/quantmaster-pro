# ADR-0474: SectorEnergy IndexCode Coverage Recovery

Status: Accepted / Dry-run only

## Context

Recent SectorEnergy diagnostics repeatedly show source-quality damage:

- `indexCodeCoverage` around 27.5%.
- `missingIndexCodeCount` around 66 of 91 rows.
- `aliasMissing` around 44.
- `aggregateIgnored` around 88.
- `fallbackUsed=STOCK_DAILY`.
- `leadershipConfidence=BLOCKED`.
- `sectorBoost=0`.
- `STRONG_BUY` remains blocked.
- SectorEnergy does not create an execution hard block.

ADR-0473 separated supply-provider issues from market signals. ADR-0474 performs the same kind of diagnostic separation for SectorEnergy index-code recovery candidates.

## Decision

ADR-0474 adds a dry-run recovery layer that:

- builds an index-code missing inventory
- separates `NAME_LOOKUP`, alias candidates, aggregate rows, and unresolved rows
- estimates coverage before lookup, after existing name lookup, and after safe alias candidates
- classifies alias suggestions as safe or unsafe
- keeps all alias suggestions `applyAutomatically=false`
- reconfirms the `STOCK_DAILY` fallback contamination guard

Alias suggestions are advisory only. Ambiguous aliases are unsafe. Aggregate rows are unsafe. Operator approval is required before any SectorIndexMaster repair.

## Policy

- live execution is unchanged
- `executionImpact=NONE`
- `liveExecutionAllowed=false`
- SectorEnergy `DEGRADED`, `STALE`, or `BLOCKED` is not promoted to OK
- `STOCK_DAILY` fallback remains diagnostic only
- `STOCK_DAILY` does not contribute trusted leadership score
- `sectorBoostAllowed=false` under fallback contamination
- `strongBuyAllowed=false` under fallback contamination
- `executionHardBlock=false`
- raw payloads are not persisted by this layer

## Alias Safety

- `SAFE_EXACT`: exact unique displayName or alias match
- `SAFE_NORMALIZED`: normalized unique alias match
- `UNSAFE_AMBIGUOUS`: multiple candidates
- `UNSAFE_AGGREGATE`: ETF, theme, market-wide, aggregate, or non-sector row
- `NO_MATCH`: no candidate

All cases retain `applyAutomatically=false`.

## Guardrails

- no fuzzy automatic application
- no automatic ambiguous candidate selection
- no fallback trusted promotion
- no KIS order function imports
- no new external API calls
- no Gate threshold changes
- no condition weight changes
- no `STRONG_BUY` relaxation
