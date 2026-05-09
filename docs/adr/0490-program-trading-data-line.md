# ADR-0490 — ProgramTrading Data Line

Date: 2026-05-09
Status: Accepted
Domain: diagnostics

## Context

ADR-0487/0488 keep fresh data and Supply UNKNOWN policy diagnostic-only. Program trading evidence needs a named data line so operators can inspect program net-buy availability without changing Gate, Kelly, requiredScore, or live execution policy.

## Decision

Introduce ADR-0490 ProgramTrading data line as an OBSERVE diagnostic layer only.

- `executionImpact='NONE'`
- `liveExecutionAllowed=false`
- `policyPromotionMode='OBSERVE'`
- `operatorApprovalRequired=true`
- raw provider payload persistence is forbidden
- KIS order APIs and live order paths are not imported or called

## Consequences

Program trading samples may be normalized into sanitized rows for diagnostics and snapshot storage. UNKNOWN/provider-empty samples remain UNKNOWN; they are not converted bullish, bearish, GATED, WEIGHTED, ADVISORY, CORE, or live-buy inputs.
