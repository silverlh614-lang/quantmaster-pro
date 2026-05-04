# ADR-0168: Emergency Data Quality Circuit Breaker

## Status
Accepted

## Context
Production screenshots showed a coupled kms and yh data-quality failure. KRX master universe collapsed to 395 symbols, exceeded 24h TTL, and static seed fallback appeared in a production path. Watchlist contained invalid code-like values such as 0070X0. Yahoo stale historical bases rendered unavailable changePercent and return20d as positive zero. Quote sanity failed all sampled symbols, yet scanner Stage1 continued and reported LOW_VOLUME and HIGH_PER instead of separating missing data from real rejects.

Core invariant: missing, stale, or failed market data is not zero. Zero is a real signal and must never be used as a data-quality fallback.

## Decision
Add server/dataQuality/emergencyDataQualityGuards.ts as a small SRP module that centralizes emergency guards without expanding scanner or adapter god-functions.

The module provides master health guard, KRX code normalization, quote sanity circuit breaker, stale quote null result contract, and strict Stage1 reject classification.

## Consequences
Static seed remains usable for diagnostics but not production decisions. Scanner can fail loudly with SCAN_ABORTED instead of returning misleading empty recommendations. Telegram and operator-facing reports can render stale values as N/A. Future wiring should call these guards at kms, yh health, scanner start, watchlist sanity, and autotrade candidate generation boundaries.

## Rollback
The new module is additive. Existing call sites can roll back by not importing it. Once wired into production paths, rollback is one import-level revert per boundary.
