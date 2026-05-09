# ADR-0476 Gate1 Near-Miss & Dry-run Observation Ledger

Status: Accepted / Shadow-only observation

## Context

ADR-0471 through ADR-0475 created useful Gate1 dry-run candidates and near-miss diagnostics, but Runtime Pipeline Audit still reports `NO_NEAR_MISS_SAMPLES`, `NO_DRY_RUN_RECORDS`, and `NO_ROLLOUT_ITEMS` when the buy list loop is not entered during SELL_ONLY or BEFORE_BUYLIST_LOOP scans.

The missing piece is an observation ledger that stores dry-run candidates for later 1D, 3D, and 5D forward-return review. Without that ledger, policy promotion decisions do not have outcome evidence.

## Decision

Add a Gate1 dry-run observation ledger for:

- ADR-0471 `UNKNOWN_DIAGNOSTIC_ONLY` survivors.
- ADR-0475 `WIRE_ALL_PLUS_DEDUP_PLUS_RISK_SPLIT` near-miss candidates.
- Actual Gate1 near-miss candidates with small score gaps.
- Counterfactual universe snapshots when the scan stops before buyListLoop.

The ledger stores compact, sanitized rows only. It does not persist raw payloads and does not create live orders.

## Policy

- `policyPromotionMode=SHADOW_ONLY`
- `executionImpact=NONE`
- `liveExecutionAllowed=false`
- `operatorApprovalRequired=true`
- Observe at least 3 business days before any promotion decision.
- Keep `requiredScore=70` and Gate threshold unchanged.

## Guardrails

- Dry-run survivor rows must never route to live order execution.
- KIS order functions must not be imported.
- UNKNOWN supply must not be converted to bullish.
- Provider issue must not be treated as market bearish.
- SectorEnergy DEGRADED/BLOCKED must not be promoted to OK.
- Observation write failures must not block scan or engine liveness.

## Outcome Tracking

Rows include placeholders for:

- `forwardReturn1D`
- `forwardReturn3D`
- `forwardReturn5D`
- `maxFavorableExcursion5D`
- `maxAdverseExcursion5D`
- `stopLossTouched`
- `targetTouched`

The outcome updater is intentionally placeholder-first. If price cache is missing or candidates are not matured, rows remain `PENDING`.

