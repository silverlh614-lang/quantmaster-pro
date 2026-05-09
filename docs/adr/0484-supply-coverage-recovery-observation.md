# ADR-0484 — Supply Coverage Recovery Observation

Date: 2026-05-09
Status: Accepted — SHADOW_ONLY diagnostic observation

## Context

ADR-0481 wired the NAVER investor trend collector as SHADOW_ONLY, ADR-0482 introduced the semantic net-buy normalizer as SSOT, and ADR-0483 split cache freshness from source-data freshness. Before this recovery chain, recurring symptoms included `selectedProvider=NONE`, `InvestorFlow DATA_UNAVAILABLE`, `signal=UNKNOWN`, `coverage=0/5`, `NAVER_INVESTOR_TREND NOT_WIRED`, missing semantic net-buy samples, `CACHE_EMPTY`, `KIS_PROVIDER_MISMATCH`, stale FSS/short/credit sources, and open ADR-0480 P1/P2 operator actions.

## Decision

Add `server/trading/signalScanner/supplyCoverageRecoveryObservationAdr0484.ts` as the SSOT SHADOW_ONLY observation layer that measures whether ADR-0481/0482/0483 improved supply/investor-flow health across current and prior scans.

ADR-0484 tracks:

- Coverage ratio and coverage deltas.
- `NAVER NOT_WIRED` deltas.
- `DATA_UNAVAILABLE` deltas.
- `selectedProvider=NONE` deltas.
- Semantic net-buy sample availability deltas.
- Stale source and oldest source age deltas.
- ADR-0480 P1/P2 operator action deltas.
- Gate1 near-miss and observation-ledger deltas.

## Guardrails

ADR-0484 does not promote supply data to live execution. It does not promote SHADOW_ONLY data to ADVISORY or CORE. It does not change Gate thresholds, Gate weights, Kelly sizing, `requiredScore`, live buy policy, or KIS order behavior. It does not convert `UNKNOWN` to bullish, does not convert provider issues to bearish, does not auto-unblock `STRONG_BUY`, and does not persist raw provider payloads.

All outputs keep:

- `executionImpact = 'NONE'`
- `liveExecutionAllowed = false`
- `policyPromotionMode = 'SHADOW_ONLY'`
- `operatorApprovalRequired = true`

## Integration

ADR-0484 feeds diagnostic-only evidence into:

- ADR-0476 Gate1 dry-run observation ledger with sanitized recovery rows.
- ADR-0480 Operator Action Queue so related actions may move to `OBSERVING` when status is `IMPROVING` and evidence supports it; actions are not resolved on the first improving scan.
- ADR-0478 compact `/scan_blockers` output with a supply recovery line.
- ADR-0479 detail registry through `/adr_trace 0484`, `/supply_health_detail`, and `/operator_actions` context.

Runtime Pipeline Audit may count ADR-0484 as diagnostic observation evidence only. It must not mark rollout installed or alter rollout status based solely on ADR-0484.

## Recovery criteria

`IMPROVING` is deterministic: at least two positive signals such as coverage ratio up, NAVER NOT_WIRED down, DATA_UNAVAILABLE down, semantic sample availability up, stale source count down, or P1 actions down.

`DEGRADED` is deterministic: at least two negative signals such as coverage ratio down, DATA_UNAVAILABLE up, `selectedProvider=NONE` up, stale source count up, or P1 actions up.

Otherwise status is `STABLE`, `OBSERVING`, or `INSUFFICIENT_DATA` depending on baseline availability and early scan count.

## Consequences

Before ADR-0484, the system knew the NAVER collector, semantic normalizer, and freshness dual clock existed, but did not know whether they improved supply coverage over multiple scans.

After ADR-0484, `/scan_blockers` compact output shows recovery status, detail output shows before/after deltas, ADR-0476 records sanitized recovery observations, and ADR-0480 can move supported actions from `OPEN` to `OBSERVING` without resolving them prematurely.

Promotion beyond SHADOW_ONLY requires a future ADR and explicit operator approval.
