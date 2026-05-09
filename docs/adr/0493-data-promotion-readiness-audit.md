# ADR-0493 — Data Promotion Readiness Audit

## Status
Accepted — implemented as a pure diagnostic audit module.

## Context
Fresh Data Supply Layer data lines need an auditable readiness check before an operator can consider moving a line between stages. The readiness check must not collect data, schedule jobs, execute orders, mutate live gates, or change a data-line stage.

## Decision
ADR-0493 defines the shared `DataPromotionAuditInput` / `DataPromotionAuditResult` contract and `evaluatePromotionReadiness()` evaluator for adjacent stage promotion readiness. CORE promotion remains automatically denied unless a future ADR defines a separate manual process.

## Consequences
- `executionImpact` is always `NONE`.
- `canPromote=true` is only a recommendation and never mutates stage state.
- Provider failures, stale data, null data, and market signals remain separated.
- ADR-0494 may wire Fresh Data diagnostics into this evaluator, but may not change trading decisions.
