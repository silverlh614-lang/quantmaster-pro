# ADR-0492 — Fresh Data Scheduler / Non-Live Cron

Date: 2026-05-09
Status: Accepted
Domain: diagnostics

## Purpose

ADR-0492 adds a non-live scheduler layer that can orchestrate fresh-data diagnostic probes and write sanitized evidence into ADR-0491 Supply Snapshot Store & Replay. The scheduler exists to collect observation evidence safely; it is not a data-promotion ADR and does not enable live trading.

## Scope

The scheduler coordinates diagnostic-only jobs for:

- ADR-0488 SectorEnergy master/indexCode and Supply UNKNOWN evidence
- ADR-0489 InvestorFlow sample acquisition probe
- ADR-0490 ProgramTrading data line
- ADR-0484 Supply Coverage Recovery observation context
- ADR-0485 Supply Advisory Readiness context
- ADR-0487 Fresh Data Supply registry context
- ADR-0491 sanitized snapshot store write path

## Non-live scheduler design

ADR-0492 defines `DISABLED`, `OBSERVE_ONLY`, and `SHADOW_ONLY` modes. It is disabled by default through `FRESH_DATA_SCHEDULER_ENABLED=false`; `FRESH_DATA_SCHEDULER_MODE=OBSERVE_ONLY`; `FRESH_DATA_SCHEDULER_MIN_INTERVAL_MINUTES=30`; and `FRESH_DATA_SCHEDULER_AFTER_MARKET_ONLY=true`.

The scheduler report always includes `executionImpact='NONE'`, `liveExecutionAllowed=false`, `operatorApprovalRequired=true`, and `policyPromotionMode='OBSERVE'` or `SHADOW_ONLY`.

## Job isolation policy

Each job is isolated by `try/catch`. Provider failures become `FAILED_PROVIDER` or `DATA_UNAVAILABLE`. Internal failures become `FAILED_INTERNAL`. Failures are diagnostic evidence only and must not throw into the Trading Engine, scan loop, Shadow Learning, or counterfactual learning.

## Session and cadence policy

- `PRE_MARKET`: full diagnostic plan is allowed for previous-day checks.
- `REGULAR`: lightweight observation only, no order path.
- `LUNCH_BREAK`: lightweight observation only when explicitly enabled.
- `AFTER_MARKET`: preferred full diagnostic collection session.
- `NON_TRADING_DAY`: no provider pressure; replay/cache comparison only.
- `UNKNOWN`: skip provider calls and emit diagnostic evidence.

## Snapshot store integration

When the scheduler runs, it may write a sanitized ADR-0491 snapshot after jobs finish. Raw provider payloads are never persisted. Snapshot write failures become scheduler diagnostics and never affect live Gate decisions. Replayed snapshots remain diagnostic-only and cannot feed live Gate decisions.

## Guardrails

ADR-0492 does not:

- enable live trading
- import or call KIS order/live execution modules
- change Gate thresholds, Gate weights, Kelly sizing, live buy policy, or `requiredScore=70`
- unlock STRONG_BUY
- unlock SectorEnergy boost
- persist raw provider payloads
- convert UNKNOWN or DATA_UNAVAILABLE into bearish or bullish signals
- treat provider issues as market signals
- promote data to ADVISORY, WEIGHTED, GATED, CORE, SHADOW_SCORE, or any live input

## Operator actions

ADR-0492 may emit diagnostic operator actions:

- `ENABLE_FRESH_DATA_SCHEDULER_OBSERVE`
- `CHECK_FRESH_DATA_SCHEDULER_HEALTH`
- `COLLECT_AFTER_MARKET_FRESH_DATA_SAMPLES`
- `REPAIR_SNAPSHOT_STORE_WRITE`
- `PROVIDER_JOB_FAILED_OBSERVE_ONLY`
- `WAIT_FOR_NEXT_TRADING_SESSION`

## Validation plan

Validation covers disabled defaults, cadence, job isolation, snapshot writing, guardrails, diagnostics, non-trading day behavior, UNKNOWN handling, ADR-0476 observation rows, ADR-0480 operator actions, Runtime Pipeline Audit, `/fresh_data_status`, and `/scan_blockers`.

ADR-0493 will separately decide Data Promotion Readiness after enough scheduler/snapshot/replay evidence exists.
