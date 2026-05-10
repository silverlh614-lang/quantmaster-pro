# ADR-0501 Weekend Replay using GateFailureCause

Date: 2026-05-10
Status: Accepted

## Context

ADR-0497 standardized `GateFailureCause` and the diagnostic taxonomy for provider/data issues, market/session blocks, scoring strictness, risk-off signals, and `UNKNOWN` handling.

ADR-0498 normalized Fresh Data status outputs so operator-facing surfaces can show provider and data readiness consistently.

ADR-0499 separated provider health from market signal, ensuring provider-empty, stale, missing, or errored data does not become bearish market evidence.

ADR-0500 aggregated empty scan root causes into a compact dashboard using ADR-0497 causes.

Operators still need a replay layer to validate whether recent blocked scans and blocked candidates were blocked for valid reasons. Weekends and non-trading days are ideal for this verification because live execution is not expected.

## Decision

Add a diagnostic-only Weekend Replay layer that consumes existing scan, snapshot, blocker, and runtime diagnostic evidence.

Replay normalizes evidence with ADR-0497 `GateFailureCause` and summarizes replay outcomes with the ADR-0500 Empty Scan Root Cause Dashboard.

Replay produces counterfactual-style statistics such as blocked due to provider issue, blocked due to `SELL_ONLY`, blocked due to threshold/scoring, blocked due to market risk, and unknown.

All replay output has `executionImpact=NONE` and `liveExecutionAllowed=false`.

ADR-0501 verifies past diagnostic decisions only. It does not create orders, mutate Gate state, apply threshold changes, promote data lines, or modify scheduler/live eligibility.

## Replay scope

Replay may consume existing sanitized evidence from:

- Recent scan summaries, if available.
- ADR-0491 Supply Snapshot Store / replay evidence, if available and read-only.
- ADR-0500 Empty Scan Root Cause Dashboard evidence, if available.
- `GateFailureAttributionEntry` evidence, if available.
- Free-form blocker strings as fallback.
- Runtime Pipeline Audit blocker evidence.

Replay must not perform provider fetches, scheduler job execution, live order path calls, raw provider payload persistence, snapshot retention changes, or live Gate feedback.

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
- Replay failure must be try/catch isolated and must not stop scans, Telegram commands, Runtime Pipeline Audit, Shadow Learning, scheduler diagnostics, or snapshot recording.
- Replay may read sanitized snapshots only; it must not persist raw provider payloads.

## Consequences

Weekend diagnostics can validate whether empty scans and Gate blocks were caused by data/provider issues, execution/session blocks, threshold/scoring strictness, supply/sector unobservability, or true market risk.

ADR-0501 closes the weekend diagnostic chain started at ADR-0497.

Future ADRs may use replay evidence to propose adjustments, but no adjustment is applied by ADR-0501.
