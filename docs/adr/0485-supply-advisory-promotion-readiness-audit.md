# ADR-0485 — Supply Advisory Promotion Readiness Audit

Date: 2026-05-09
Status: Accepted — SHADOW_ONLY readiness audit only

## Context

QuantMaster Pro has completed the ADR-0481/0482/0483/0484 supply recovery stack:

- ADR-0481 wires the NAVER investor trend collector as a SHADOW_ONLY semantic supply candidate.
- ADR-0482 normalizes provider-specific investor-flow samples into semantic net-buy fields.
- ADR-0483 separates cache freshness from source-data freshness and treats stale source data as data-health degradation, not bearish supply.
- ADR-0484 observes whether coverage, selected-provider availability, semantic sample availability, source freshness, operator actions, and Gate1 near-miss evidence are improving.

All of those components remain SHADOW_ONLY. The system can observe recovery, but it needs a diagnostic audit that answers whether recovered supply data is stable enough to justify a future ADVISORY dry-run ADR.

## Decision

Add `server/trading/signalScanner/supplyAdvisoryReadinessAdr0485.ts` as the SSOT for a Supply Advisory Promotion Readiness Audit.

ADR-0485 evaluates whether supply evidence is ready for discussion as `ADVISORY_READY` in a separate future ADR. It does not activate ADVISORY mode and does not promote any supply data.

The audit evaluates:

1. Multi-scan supply coverage consistency.
2. Repeated `selectedProvider != NONE` evidence.
3. Reduced `DATA_UNAVAILABLE` evidence.
4. Repeated semantic net-buy sample availability.
5. Source freshness health.
6. ADR-0484 recovery status (`IMPROVING`, `STABLE`, or `OBSERVING`).
7. ADR-0480 P0/P1/P2 operator action state.
8. UNKNOWN safety: UNKNOWN remains UNKNOWN and is never converted to bullish.
9. Provider-issue safety: provider issues are never converted to bearish market signals.
10. ADR-0476 observation-row sufficiency.

## Guardrails

ADR-0485 is a readiness audit only.

It does not:

- Promote supply data to ADVISORY, WEIGHTED, GATED, CORE, or live execution.
- Change live execution, Gate scoring, Gate thresholds, Gate weights, Kelly sizing, `requiredScore`, STRONG_BUY policy, or KIS order behavior.
- Auto-unblock STRONG_BUY.
- Convert UNKNOWN to bullish.
- Convert provider issues to bearish.
- Treat stale or partial data as bearish.
- Persist raw provider payloads.
- Auto-resolve operator actions without observation criteria.

All outputs keep:

- `executionImpact = 'NONE'`
- `liveExecutionAllowed = false`
- `policyPromotionMode = 'SHADOW_ONLY'`
- `operatorApprovalRequired = true`

If the audit returns `READY`, `proposedPromotionMode = 'ADVISORY_READY'` is only a recommendation. Actual ADVISORY usage requires a separate future ADR and explicit operator approval.

## Criteria

Default readiness criteria:

- `minObservationRows = 3`
- `minCoverageRatio = 0.60`
- `maxSelectedProviderNoneRate = 0.30`
- `maxDataUnavailableRate = 0.40`
- `minSemanticSampleAvailabilityRate = 0.50`
- `maxStaleSourceRate = 0.30`
- `requireUnknownSafety = true`
- `requireNoP1OpenActions = true`
- `allowedRecoveryStatuses = ['IMPROVING', 'STABLE', 'OBSERVING']`

The readiness score is diagnostic-only and capped at 0–100:

- Coverage: 25 points.
- Semantic sample availability: 20 points.
- Source freshness: 15 points.
- Selected-provider stability: 15 points.
- UNKNOWN safety: 15 points.
- Operator action health: 10 points.

If UNKNOWN safety fails, score is capped at 50 and status cannot be READY.

## Integration

ADR-0485 feeds diagnostic-only evidence into:

- ADR-0480 Operator Action Queue: creates `P1 PREPARE_SUPPLY_ADVISORY_DRY_RUN_ADR` only when readiness is `READY`; NOT_READY/DEGRADED keep remediation actions open.
- ADR-0478 compact `/scan_blockers` output with the `ADR-0485 SupplyReadiness` line.
- ADR-0479 detail registry through `/adr_trace 0485`, `/supply_health_detail`, and `/operator_actions` context.
- ADR-0476 Gate1 dry-run observation ledger with sanitized readiness rows only.
- Runtime Pipeline Audit as diagnostic readiness evidence only.

Runtime Pipeline Audit must not mark supply advisory mode installed, alter rollout status, or treat ADR-0485 as a live rollout signal.

## Consequences

Before ADR-0485, the system could observe supply recovery but could not determine whether the supply stack was ready for ADVISORY discussion.

After ADR-0485:

- `/scan_blockers` compact output shows supply advisory readiness status.
- `/supply_health_detail` can show criteria, evidence, score, passed reasons, failed reasons, and guardrails.
- ADR-0480 can create a prepare-ADVISORY-dry-run ADR action only when readiness is `READY`.
- ADR-0476 can record sanitized readiness observation rows.
- Live behavior remains unchanged.

Final invariant: ADR-0485 only answers “Is supply data ready for a future ADVISORY dry-run ADR?” It must not perform the promotion itself.
