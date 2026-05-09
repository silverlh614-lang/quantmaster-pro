# ADR-0469: Gate1 Penalty Deduplication Dry-run

Status: Accepted / Dry-run only

## Context

Gate1 diagnostics showed that the same supply provider outage can be charged through multiple penalty lanes:

- `SUPPLY_CONFLUENCE`
- `INVESTOR_FLOW`
- `SOFT_FAIL_PENALTY`

When the shared root cause is `SUPPLY_PROVIDER_UNKNOWN`, with `providerIssue=true` and `marketSignal=false`, those lanes must be audited as one unknown-provider condition rather than independent market weakness.

## Decision

ADR-0469 adds a root-cause deduplication audit for supply unknown penalties. It keeps the live score unchanged and reports counterfactual impact only.

Current code state:

- `ADR_0469_PENALTY_DEDUP_DRY_RUN=true`
- `ADR_0469_PENALTY_DEDUP_ENABLED=false`
- Live scoring changes: none
- `executionImpact=NONE`

## Shadow-Only Promotion Conditions

Promotion beyond dry-run is allowed only as a `SHADOW_ONLY` policy candidate after:

- 3 trading days of observation
- target survivor range remains 3 to 7
- provider-verified state automatically disables unknown-provider relaxation
- explicit operator approval

## Guardrails

- Do not convert `UNKNOWN` to bullish.
- Do not treat provider issues as bearish market signals.
- Do not create survivors by lowering the Gate1 threshold.
- Do not connect dry-run survivors to live execution.
