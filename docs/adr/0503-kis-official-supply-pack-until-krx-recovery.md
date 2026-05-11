# ADR-0503: KIS Official Supply Pack Until KRX Recovery

Date: 2026-05-11

## Context

KRX official sources remain under repair for several supply lanes. Until those
lanes return verified rows, QuantMaster Pro uses the Korea Investment & Securities
official Open API as the primary read-only supply source where available.

## Decision

- KIS official API is an official source, not an inferred or scraped source.
- Price, chart, investor flow, stock program, market program, market supply,
  short sale, loan transaction, and credit balance are grouped into
  `KisOfficialSupplyPack`.
- KIS current price and verified daily investor-flow fields may be `WEIGHTED`.
- KIS intraday estimates remain `ADVISORY` or `SHADOW_ONLY`.
- Short sale, loan, and credit data feed the EnemyChecklist first, especially
  StrongBuy blocking diagnostics.
- Provider issue and market signal remain separate.
- KIS errors, accepted-empty responses, and missing fields do not stop the
  trading engine and are not bearish market signals.
- Raw payloads, tokens, app keys, secrets, cookies, and private headers are not
  persisted.
- KRX repair paths remain active in parallel.

## Promotion

KIS daily confirmed data may be considered for `WEIGHTED` or `GATED_CANDIDATE`
use. `CORE` promotion requires a separate approval after 20 to 30 trading days
of comparison against KRX, cache, and realized outcomes.

## Guardrails

- `executionImpact=NONE` by default.
- `liveExecutionAllowed=false` for the supply pack.
- Missing KIS fields are never filled with zero.
- Accepted-empty KIS responses are excluded from scoring.
- Yahoo stale data cannot invalidate fresh KIS price.
- Shadow Learning, Watchlist, and Counterfactual recording stay alive.
