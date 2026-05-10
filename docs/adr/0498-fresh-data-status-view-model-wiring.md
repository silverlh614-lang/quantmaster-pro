# ADR-0498 FreshDataStatusViewModel Wiring

## Status

Accepted — 2026-05-10

## Context

ADR-0497 introduced the shared diagnostic taxonomy and `FreshDataStatusViewModel` SSOT for Fresh Data status labels, provider health, data confidence, market-signal separation, promotion readiness, and diagnostic-only execution policy.

ADR-0487~0496 created multiple diagnostic output surfaces: `/scan_blockers`, `/fresh_data_status`, Runtime Pipeline Audit, promotion audit, and operator actions. These surfaces can drift if each independently formats Fresh Data provider status, coverage status, promotion status, or UNKNOWN/null/zero semantics.

ADR-0498 wires the shared view model into these surfaces while preserving diagnostic-only behavior. It is a display/view-model wiring ADR only.

## Decision

Introduce an ADR-0498 adapter layer that converts existing Fresh Data diagnostic reports into ADR-0497 `FreshDataStatusViewModel` instances. The adapter uses ADR-0497 defaults and provider/market-signal separation, then exposes compact ADR-0498 wrappers for consistent operator labels.

All outputs remain read-only and diagnostic-only. The adapter and its wiring do not mutate source data-line stage, promotion state, Gate state, scheduler state, snapshot persistence, or live execution eligibility.

## Target surfaces

- `/fresh_data_status`
- `/scan_blockers` compact section
- Runtime Pipeline Audit compact/detail evidence
- Promotion Audit summary where Fresh Data line status is shown
- Operator Action summary when Fresh Data root causes are displayed

## Guardrails

- `executionImpact` remains `NONE`.
- `liveExecutionAllowed` remains `false`.
- No KIS order path import or invocation.
- No Gate threshold, condition weight, Kelly, `requiredScore`, `STRONG_BUY`, `sectorBoost`, `supplyBoost`, or order path change.
- No automatic data-line stage mutation.
- No raw provider payload persistence.
- Provider issue is not market signal.
- `UNKNOWN` remains `UNKNOWN`.
- `null` is never converted to zero.
- Display failure must be try/catch isolated and must not stop scans, Telegram commands, Runtime Pipeline Audit, Shadow Learning, or scheduler diagnostics.

## Consequences

Fresh Data status labels become consistent across operator outputs. Future ADRs should use `FreshDataStatusViewModel` rather than local formatting labels. ADR-0499 can migrate provider-health vs market-signal logic into the shared classifier.
