# ADR-0488: SectorEnergy Master Data Supply Line + Gate1 Supply UNKNOWN Policy Stabilization

Date: 2026-05-09

## Status

Accepted

## Context

ADR-0487 introduced the Fresh Data Supply Layer foundation. Runtime diagnostics can now explain missing/stale supply and sector data, but the next bottleneck is making the first repairable data lane observable while stabilizing duplicated provider-side `SUPPLY_UNKNOWN` penalties.

Recent scans show SectorEnergy degraded by low `indexCode` coverage, failed symmetry, and `STOCK_DAILY` fallback. Supply diagnostics also show `UNKNOWN` / `DATA_UNAVAILABLE` provider issues that can be duplicated across `SUPPLY_CONFLUENCE`, `INVESTOR_FLOW`, and `SOFT_FAIL_PENALTY`.

## Decision

ADR-0488 adds one SHADOW_ONLY diagnostic layer with two responsibilities:

1. SectorEnergy master/indexCode supply line observation and repair evidence.
2. Supply UNKNOWN provider-issue penalty stabilization as diagnostic/counterfactual only.

The implementation adds a SSOT module:

`server/trading/signalScanner/sectorEnergyMasterSupplyUnknownPolicyAdr0488.ts`

It produces:

- Sanitized SectorEnergy master records with safe metadata only.
- Sector name to indexCode mapping diagnostics.
- Aggregate-row exclusion for broad rows such as KOSPI/KOSDAQ/total/manufacturing aggregates.
- `STOCK_DAILY` fallback evidence without unlocking leadership confidence.
- A provider-side `SUPPLY_UNKNOWN` root-cause classifier.
- Dry-run policy variants including `UNKNOWN_DIAGNOSTIC_ONLY`, confidence downgrade, sizing-only, and bearish-only reference variants.
- Compact `/scan_blockers` output, `/fresh_data_status` detail output, ADR-0476 observation rows, ADR-0480 operator action evidence, and Runtime Pipeline Audit evidence.

## Guardrails

ADR-0488 does not change live execution.

It does not:

- Change the KIS order path.
- Change Gate thresholds, Gate weights, Kelly sizing, live buy policy, or `requiredScore=70`.
- Promote any data to ADVISORY, WEIGHTED, GATED, or CORE.
- Use fresh data in live Gate decisions.
- Unlock SectorEnergy boost or `STRONG_BUY`.
- Persist raw provider payloads.
- Convert `UNKNOWN` / `DATA_UNAVAILABLE` into a bearish signal.
- Treat provider issues as market signals.

All ADR-0488 outputs keep:

- `executionImpact='NONE'`
- `liveExecutionAllowed=false`
- `policyPromotionMode='SHADOW_ONLY'`
- `operatorApprovalRequired=true`

## Consequences

The system can now show actionable SectorEnergy master/indexCode gaps and supply UNKNOWN policy observations without making the system trade. Dry-run survivors, when present, are counterfactual SHADOW_ONLY rows for later 1D/3D/5D evaluation.

Promotion beyond OBSERVE/SHADOW_ONLY requires a future ADR and operator approval.
