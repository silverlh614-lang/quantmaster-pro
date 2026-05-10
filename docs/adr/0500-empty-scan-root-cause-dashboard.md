# ADR-0500 Empty Scan Root Cause Dashboard

Date: 2026-05-10
Status: Accepted

## Context

ADR-0464 through ADR-0476 introduced entry filter decomposition, Gate1 dry-run, near-miss buckets, observation ledgers, and diagnostic ledgers for explaining where candidates disappear before executable entry.

ADR-0487 through ADR-0496 introduced Fresh Data, SectorEnergy, Supply Snapshot, Promotion Audit, and Investor Flow diagnostics so provider/data readiness can be observed without promoting unverified data into live eligibility.

ADR-0497 standardized the diagnostic taxonomy and `GateFailureCause`, including provider health, data confidence, market signal separation, null/zero/missing semantics, and diagnostic-only policy.

ADR-0498 normalized Fresh Data status output across operator-facing surfaces.

ADR-0499 prevented provider/data-health issues from becoming bearish market signals.

Operators still need a compact dashboard showing why a scan produced no executable buy candidates. An empty scan caused by `SELL_ONLY` is not a strategy failure. Provider-empty output is not bearish supply. Stale data is not market weakness. A strict threshold differs from missing data, and insufficient positive score differs from provider failure.

## Decision

Add a diagnostic-only Empty Scan Root Cause Dashboard.

The dashboard aggregates scan blockers and diagnostic evidence into standardized root cause buckets using ADR-0497 `GateFailureCause` wherever possible.

Surface a compact summary in `/scan_blockers` and Runtime Pipeline Audit. Detail output can be exposed through existing detail trace infrastructure if low risk, but the initial implementation is allowed to remain compact-first.

Preserve all live behavior. ADR-0500 is observability only.

## Target root cause categories

The dashboard aligns with ADR-0497 `GateFailureCause`:

- `DATA_MISSING`
- `DATA_STALE`
- `PROVIDER_ERROR`
- `PROVIDER_EMPTY`
- `MARKET_SESSION_BLOCK`
- `SELL_ONLY_BLOCK`
- `MACRO_RISK_OFF`
- `SECTOR_ENERGY_UNOBSERVABLE`
- `SUPPLY_CONFLUENCE_UNAVAILABLE`
- `THRESHOLD_TOO_STRICT`
- `SIGNAL_CONFLICT`
- `INSUFFICIENT_POSITIVE_SCORE`
- `RISK_PENALTY_DOMINANT`
- `SIZING_BLOCK`
- `UNKNOWN`

## Guardrails

- `executionImpact` remains `NONE`.
- `liveExecutionAllowed` remains `false`.
- No KIS order path import or invocation.
- No Gate threshold, condition weight, Kelly sizing, `requiredScore`, `STRONG_BUY`, `sectorBoost`, `supplyBoost`, or order path change.
- No automatic data-line stage mutation.
- No raw provider payload persistence.
- Provider issue is not market signal.
- `UNKNOWN` remains `UNKNOWN`.
- `null` is never converted to zero.
- Dashboard failure must be try/catch isolated and must not stop scans, Telegram commands, Runtime Pipeline Audit, Shadow Learning, scheduler diagnostics, or snapshot recording.

## Consequences

Empty scans become explainable by counts and top root causes.

Operators can distinguish data-provider problems, session/order blocks, strict thresholds, insufficient positive signal, and true risk-off conditions.

ADR-0501 can use this standardized dashboard for Weekend Replay validation.
