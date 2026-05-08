# ADR-0473: Supply Provider Warmup and Semantic NetBuy Cache Policy

Status: Accepted / Dry-run only

## Context

Recent supply health logs repeatedly showed a provider-chain warmup problem rather than confirmed market weakness:

- KRX investor flow reports `OFF_HOURS`, `NON_TRADING_DAY`, or cache fallback.
- NAVER investor trend is `NOT_WIRED`.
- Semantic NetBuy is `NOT_WIRED`.
- CACHE is `CACHE_EMPTY`.
- KIS is a `PROVIDER_MISMATCH` for semantic investor-flow data.
- `supply_confluence` is `DATA_UNAVAILABLE`, not failed.
- `liveStrongBuyAllowed=false`.
- `shadowObservableAllowed=true`.

These states must not be collapsed into bearish supply signals. ADR-0473 separates provider warmup health from market signal semantics and makes weekend diagnostics visible without changing live execution.

## Decision

ADR-0473 extends the investor-flow provider health SSOT with a supply warmup interpretation layer:

- `NON_TRADING_DAY`, `CACHE_EMPTY`, `NOT_WIRED`, `PROVIDER_MISMATCH`, `DATA_UNAVAILABLE`, and `UNKNOWN` are provider issues, not bearish market signals.
- `SupplyMarketSignal='BEARISH'` requires verified semantic net-buy data.
- KIS is not promoted into a semantic investor-flow provider.
- Previous trading day cache fallback is diagnostic and shadow-observable only.
- Semantic NetBuy samples use a shared schema for KRX, NAVER, and CACHE.
- `/scan_blockers` appends an ADR-0473 compact warmup line.

## Policy

- live execution is unchanged.
- Gate thresholds are unchanged.
- Supply `UNKNOWN` is not converted to bullish.
- provider issues are not bearish market signals.
- `NON_TRADING_DAY` is not failed.
- `CACHE_EMPTY` is not bearish.
- `executionImpact=NONE`.
- `liveExecutionAllowed=false`.
- `shadowObservableAllowed=true`.
- provider health must be verified before `STRONG_BUY` can use supply data.
- raw provider payloads are not persisted by this policy layer.

## Semantic NetBuy Schema

The shared semantic schema is:

- `code`
- `source: KRX | NAVER | CACHE`
- `sourceDate`
- `investorForeignNetBuy`
- `investorInstitutionNetBuy`
- `netBuyScore`
- `confidence`
- `providerIssue`
- `marketSignal`

NAVER may remain `NOT_WIRED`; that is diagnostic, not failure.

## Previous Trading Day Cache Fallback

When KRX reports `NON_TRADING_DAY`, the warmup layer calculates:

- `requestedSourceDate`
- `previousTradingDateCandidate`
- `cacheKeyTried`
- `cacheHit`
- `cacheAgeBusinessDays`
- `usableForShadow=true`
- `usableForLiveStrongBuy=false`

This fallback does not feed live score or live order decisions.

## Guardrails

- Do not import KIS order functions.
- Do not lower Gate thresholds.
- Do not treat provider mismatch as market weakness.
- Do not use KIS API as a semantic investor-flow provider.
- Do not mark weekend/non-trading provider suppression as failed.
- Do not persist full raw payloads.
- Keep `executionImpact=NONE`.
- Keep `liveExecutionAllowed=false`.
- Keep `shadowObservableAllowed=true`.
