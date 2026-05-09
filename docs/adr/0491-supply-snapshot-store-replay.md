# ADR-0491 — Supply Snapshot Store & Replay

Date: 2026-05-09
Status: Accepted
Domain: diagnostics

## Context

ADR-0487 through ADR-0490 expose supply, SectorEnergy, investor-flow, and ProgramTrading diagnostics. Operators need a bounded sanitized snapshot store and replay tool for evidence comparison, while preserving engine liveness, Shadow Learning, and all live execution behavior.

## Decision

Add a diagnostic-only ADR-0491 Supply Snapshot Store & Replay layer.

The implementation provides:

- sanitized snapshot builder
- bounded JSON store
- replay modes: `LATEST`, `PREVIOUS_TRADING_DAY`, `BY_SCAN_ID`, `BY_DATE`, `WINDOW`
- comparison helper
- corrupt JSON recovery
- compact and detail formatters
- Runtime Pipeline Audit evidence
- ADR-0476 observation row wiring
- ADR-0480 operator-action evidence mapping
- `/scan_blockers` compact snapshot line

## Guardrails

ADR-0491 is diagnostic-only:

- `executionImpact='NONE'`
- `liveExecutionAllowed=false`
- `policyPromotionMode='OBSERVE'` or `SHADOW_ONLY`
- `operatorApprovalRequired=true`
- raw provider payloads are not persisted
- replayed snapshots are not used in live Gate decisions
- KIS order APIs, order dispatch paths, Gate thresholds, Gate weights, Kelly sizing, live buy policy, and `requiredScore=70` are unchanged
- Supply snapshots are not promoted to ADVISORY, WEIGHTED, GATED, or CORE
- UNKNOWN is not converted bullish
- provider issues are not converted bearish
- STRONG_BUY is not auto-unblocked

## Runtime evidence

`/scan_blockers` may include:

```text
🗄 ADR-0491 SupplySnapshot: RECORDED | retained=<n> | domains=SUPPLY/SECTOR/PROGRAM | impact=NONE
```

or, before enough snapshots exist:

```text
🗄 ADR-0491 SupplySnapshot: EMPTY | replay=unavailable | impact=NONE
   action: collect sanitized snapshots for 3 scans
```

Runtime Pipeline Audit exposes `supplySnapshotStore` status, retention, replay availability, diagnostic-only mode, and execution impact.
