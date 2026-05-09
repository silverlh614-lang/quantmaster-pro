# ADR-0477 Investor Flow Provider Router Wiring

Status: Accepted / Shadow-only dry-run

## Context

Supply Health still reports routing-level degradation: `NAVER_INVESTOR_TREND: NOT_WIRED`, semantic net-buy collector not implemented, `CACHE_EMPTY`, `KIS_API: PROVIDER_MISMATCH`, and stale FSS/short/credit diagnostics. This is not confirmed bearish supply. It is provider routing and coverage incompleteness.

## Decision

Add an ADR-0477 investor-flow provider router before the ADR-0473 Supply Provider Warmup diagnostic chain. The router normalizes semantic net-buy samples when a suitable provider exists and otherwise emits explicit provider/data status:

- `NAVER`: semantic investor trend provider only when the collector is wired.
- `CACHE`: fallback only, never primary truth.
- `KIS`: program/market-program diagnostic paths only by default; it is not forced into the semantic investor-flow route.
- `FSS`: passive/active, short, and credit freshness diagnostics only.
- `ACCEPTED_EMPTY`: excluded from scoring and not bearish.
- `NOT_WIRED`, `PROVIDER_MISMATCH`, `CACHE_EMPTY`, `STALE`, `NON_TRADING_DAY`, and `DATA_UNAVAILABLE`: provider/data unknown, not market bearish.

## Policy

ADR-0477 is not a live execution promotion. It does not change live Gate, required score, threshold, weights, Kelly sizing, or KIS order behavior.

All outputs remain:

- `executionImpact = NONE`
- `liveExecutionAllowed = false`
- `policyPromotionMode = SHADOW_ONLY`
- `operatorApprovalRequired = true`

Provider issue remains separated from market signal. UNKNOWN remains UNKNOWN. Supply UNKNOWN must not become bullish or bearish.

## Diagnostic Chain

ADR-0477 feeds the existing chain without replacing it:

`Investor Flow Provider Router ADR-0477 -> Supply Provider Warmup ADR-0473 -> Supply Provider Health Trace ADR-0465 -> Minimum Signal Score Decomposition ADR-0466 -> Penalty Dedup ADR-0469 -> Positive Source Wiring ADR-0475 -> Dry-run Observation Ledger ADR-0476`

## Promotion Guard

Promotion beyond `SHADOW_ONLY` requires a future ADR and operator approval after observation data exists. Router or collector failure must be try/catch isolated and must not stop scan, Gate evaluation, Shadow Learning, or Runtime Pipeline Audit.
