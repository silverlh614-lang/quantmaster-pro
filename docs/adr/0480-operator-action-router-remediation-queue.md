# ADR-0480 — Operator Action Router & Remediation Queue

## Status

Accepted — diagnostic-only implementation.

## Context

QuantMaster Pro has accumulated visibility ADRs for Gate1 decomposition, provider freshness,
penalty deduplication, dry-run observation, compact scan-blocker output, and detail traces. The
system can explain why scans are blocked, but operators still have to manually connect repeated
signals such as `selectedProvider=NONE`, `NAVER_INVESTOR_TREND=NOT_WIRED`, `CACHE_EMPTY`,
SectorEnergy fallback, stale FSS sources, positive-source gaps, and Gate1 near-miss observation
rows.

## Decision

ADR-0480 adds an Operator Action Router that converts existing diagnostics into a deduplicated,
priority-ranked remediation queue. It groups multiple ADR evidence sources into one root-cause
operator action, estimates expected diagnostic impact, and exposes compact top actions plus a
detail trace.

## Scope

ADR-0480 is not an auto-fix system. It only converts diagnostics into operator-facing action
guidance.

It does not:

- change live execution;
- change Gate thresholds, Gate weights, Kelly sizing, `requiredScore`, or buy policy;
- auto-promote providers;
- convert `UNKNOWN` to bullish;
- convert provider issues to bearish;
- force SectorEnergy OK promotion;
- auto-resolve Gate blockers.

All ADR-0480 outputs keep:

- `executionImpact = 'NONE'`;
- `liveExecutionAllowed = false`;
- `policyPromotionMode = 'SHADOW_ONLY'`;
- `operatorApprovalRequired = true`.

## Implementation

The SSOT is `server/trading/signalScanner/operatorActionRouterAdr0480.ts`.

It defines:

- `OperatorActionPriority` (`P0`..`P3`);
- `OperatorActionStatus`;
- `OperatorActionCategory`;
- `OperatorActionRootCause`;
- `OperatorActionSource`;
- `OperatorActionItem`;
- `OperatorActionQueueReport`.

The pure builder `buildOperatorActionQueueAdr0480(input)` accepts diagnostic sources and returns a
report containing top actions, all actions, deduped root causes, suppressed duplicate count, compact
summary lines, and guardrail literals.

## Root-cause grouping

Repeated diagnostics are grouped into single root causes, including:

- `INVESTOR_FLOW_PROVIDER_UNWIRED`;
- `SEMANTIC_NETBUY_MISSING`;
- `SUPPLY_CACHE_EMPTY`;
- `KIS_PROVIDER_MISMATCH`;
- `FSS_SOURCE_STALE`;
- `SECTOR_ENERGY_FALLBACK_ONLY`;
- `SUPPLY_UNKNOWN_DUPLICATE_PENALTY`;
- `POSITIVE_SOURCE_MISSING`;
- `GATE1_NEAR_MISS_DATA_BLOCKED`;
- `SCAN_BLOCKERS_TOO_VERBOSE`;
- `DETAIL_TRACE_MISSING`.

If multiple ADRs point to one root cause, the router emits one action item and increments
`suppressedDuplicates`.

## Priority model

- `P0`: only for command failure, engine liveness, Shadow Learning stoppage, or accidental live
  execution impact.
- `P1`: blocks major diagnostic recovery or keeps key data unavailable, such as investor-flow
  provider unwired or semantic net-buy missing.
- `P2`: important but secondary remediation, such as stale FSS source refresh, cache fallback, or
  SectorEnergy fallback-only diagnostics.
- `P3`: cleanup, documentation, and noise reduction, such as KIS provider-role documentation.

## Output integration

ADR-0480 integrates with ADR-0478 compact output by appending a top-3 `Top Operator Actions`
section to `/scan_blockers` through try/catch-isolated formatting.

ADR-0480 integrates with ADR-0479-style detail access through a detail registry entry and the
read-only `/operator_actions` command. Detail output includes all open actions, suppressed
duplicates, related ADRs, evidence sources, recommended actions, status, confidence, and expected
impact.

## Runtime Pipeline Audit

Runtime Pipeline Audit records ADR-0480 action queue evidence as diagnostic evidence only. It does
not alter rollout status and must not mark ADR-0460 or any rollout as installed based on ADR-0480.

## Liveness and learning guarantees

Formatting/action-router failure is isolated and must not stop scans, Shadow Learning, Runtime
Pipeline Audit, or Telegram commands. Existing raw diagnostics remain available through detail/raw
paths. Engine liveness and Shadow Learning visibility are preserved.

## Merge-conflict resolution check

ADR-0480 touched shared diagnostic surfaces such as `docs/adr/INDEX.md`, `/scan_blockers`, and
Runtime Pipeline Audit. The implementation includes a regression guard that scans these touched
files for unresolved merge conflict markers so future branch merges do not silently ship conflict
fragments in operator diagnostics.

## Consequences

Operators receive a prioritized remediation queue instead of manually interpreting repeated raw
sections. Diagnostics become actionable without becoming automatic execution.
