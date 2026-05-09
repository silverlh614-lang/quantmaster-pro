# ADR-0485 — Semantic Net-Buy Normalizer Implementation

## Status
Accepted — SHADOW_ONLY diagnostic implementation.

## Context
ADR-0484 wired the NAVER investor trend collector as a SHADOW_ONLY provider candidate, reducing `NAVER_INVESTOR_TREND: NOT_WIRED` noise. Remaining duplication existed because provider-specific fields, units, freshness, and partial coverage were still normalized in local modules rather than through one semantic net-buy SSOT.

## Decision
ADR-0485 implements a provider-agnostic semantic net-buy normalizer at `server/trading/signalScanner/semanticNetBuyNormalizerAdr0485.ts`.

The normalizer maps NAVER, CACHE, MANUAL, KIS, KRX, FSS, and UNKNOWN provider inputs into one sanitized semantic sample contract:

- `foreignNetBuy`
- `institutionNetBuy`
- `programNetBuy`
- `individualNetBuy`
- `totalSmartMoneyNetBuy`
- `sourceDate`
- `provider`
- `unit`
- `freshness`
- `coverage`
- `confidence`
- `status`
- `signal`

It also builds a normalization report that ranks provider samples and selects the best usable semantic sample for diagnostics.

## Guardrails
ADR-0485 is diagnostic-only and keeps these invariants:

- `executionImpact = 'NONE'`
- `liveExecutionAllowed = false`
- `policyPromotionMode = 'SHADOW_ONLY'`
- `operatorApprovalRequired = true`

ADR-0485 does **not**:

- promote normalized data to live execution or CORE
- change Gate thresholds, Gate weights, Kelly sizing, requiredScore, or live buy policy
- change KIS order behavior or import KIS order modules
- auto-unblock `STRONG_BUY`
- persist raw provider payloads

Promotion beyond `SHADOW_ONLY` requires a future ADR and explicit operator approval.

## Signal Semantics
`UNKNOWN` remains `UNKNOWN` for empty, unavailable, provider mismatch, parse error, provider error, disabled, non-trading-day, and stale low-confidence data.

Missing, partial, and provider-issue states remain separated from bearish market signal. Missing or partial data must never become bearish.

`BULLISH` requires a verified or high-quality partial semantic sample with HIGH/MEDIUM confidence and positive smart-money net-buy evidence.

`BEARISH` requires a verified semantic sample with HIGH/MEDIUM confidence and negative total smart-money net-buy.

`NEUTRAL` is used for verified near-zero or mixed data.

## Unit Policy
- `KRW` remains KRW.
- `THOUSAND_KRW` is converted to KRW.
- `MILLION_KRW` is converted to KRW.
- `SHARES` remains SHARES and is not mixed with KRW samples.
- `UNKNOWN` keeps numeric values but marks unit normalization as false and lowers confidence.

## Routing Chain
ADR-0485 feeds:

1. ADR-0484 NAVER Investor Trend Collector
2. ADR-0477 InvestorFlow Provider Router
3. ADR-0475 Positive Source Wiring Dry Run
4. ADR-0476 Dry-run Observation Ledger
5. ADR-0480 Operator Action Queue
6. ADR-0478 Compact `/scan_blockers` output
7. ADR-0479 detail/ADR trace registry

Runtime Pipeline Audit may count ADR-0485 as diagnostic evidence only; it must not alter rollout status.

## Consequences
Semantic net-buy now has one provider-agnostic SSOT. NAVER, CACHE, and future provider samples can normalize into one contract, allowing ADR-0477 selection, ADR-0475 dry-run consumption, ADR-0476 sanitized observation, and ADR-0480 lower-priority data/parse/unit actions without creating false bullish or false bearish supply signals.
