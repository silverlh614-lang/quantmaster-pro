# ADR-0494 — Fresh Data Promotion Audit Wiring

## Status
Accepted — diagnostic/runtime/operator wiring only.

## Context
ADR-0493 introduced the pure Data Promotion Readiness Audit evaluator. ADR-0488 through ADR-0492 produce Fresh Data Supply Layer diagnostics, but their outputs were not yet normalized into `DataPromotionAuditInput` for operator-facing promotion readiness review.

## Decision
Wire Fresh Data diagnostic reports into ADR-0493 without adding collection, scheduling, live order, live gate, or automatic stage-change behavior.

The wiring covers:
- ADR-0488 Sector Energy / Supply UNKNOWN policy diagnostics.
- ADR-0489 Investor Flow sample acquisition diagnostics.
- ADR-0490 Program Trading data-line diagnostics.
- ADR-0491 Supply Snapshot Store / Replay diagnostics.
- ADR-0492 Fresh Data Scheduler result diagnostics.

ADR-0494 exposes compact and detailed promotion audit formatters plus runtime/operator summaries:
- `promotionAuditSummary`
- `promotionAuditBlockers`
- `promotionAuditReadyLines`
- `promotionAuditBlockedLines`

## Invariants
- `executionImpact=NONE` for all ADR-0494 outputs.
- `canPromote=true` never mutates the source data-line stage.
- CORE promotion remains blocked by ADR-0493 rules.
- Provider errors are not converted into bearish market signals.
- Null, missing, and stale values are audit evidence only and are not converted into zero or bearish signals.
- No live order path, hard block path, or live gate state mutation is introduced.

## Consequences
Operators can inspect Fresh Data promotion readiness from runtime audit and `/fresh_data_status`, while actual promotion remains manual or reserved for a future ADR.
