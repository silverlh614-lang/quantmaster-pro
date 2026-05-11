# ADR-0502: KIS Official Global Fallback Until KRX Recovery

Date: 2026-05-11

## Status

Accepted as an emergency read-only fallback policy.

## Context

KRX investor-flow recovery is still in progress. OTP CSV transport works, but
some investor-flow routes can return empty CSV rows while endpoint parameters
and BLD purpose are being repaired. Trading Engine, Scanner, Watchlist, Shadow
Learning, price freshness, and supply diagnostics must continue operating while
KRX is repaired.

The Korea Investment & Securities open trading API is an official standard API,
not an inferred or scraped source. It can be used more aggressively than
unofficial providers, while Rule-001 guardrails still apply.

## Decision

Until KRX official rows are stable, KIS official read-only evidence is treated
as the preferred fallback or primary source where strict real fields are
available:

- Price/current price: `KIS_PRICE` before Yahoo and cache.
- Previous close: `KIS_PREV_CLOSE` before Yahoo and cache.
- Daily and intraday quotation: KIS before Yahoo/cache where available.
- Stock name: KIS before cache.
- Stock and market program trading: KIS before cache, with accepted-empty
  responses excluded from scoring.
- Investor flow: `KIS_API` before `KRX_INVESTOR_FLOW`, then cache and NAVER.
- Short selling, lending, margin, and credit sources keep existing KRX/FIA/FSS
  priority; KIS can be diagnostic or cross-check only where available.

Investor-flow KIS evidence defaults to `WEIGHTED` during the KRX recovery
incident. `CORE` still requires separate approval.

## Guardrails

- Provider failure is not a market signal.
- Missing KIS fields must not be converted to zero.
- KIS errors must not stop the engine.
- Shadow Learning, Watch, and Counterfactual records continue.
- Raw payloads, tokens, app keys, secrets, cookies, and private headers are not
  persisted.
- `executionImpact=NONE` for the new evidence pack and investor-flow evidence.
- KIS success alone does not unlock StrongBuy, SectorEnergy boost, Kelly,
  threshold, or order-path changes.

## Promotion

KIS source types promote independently. Price and chart fields can become
primary faster because they are official quotation data. Investor-flow requires
strict real fields and remains `WEIGHTED` during recovery. `GATED` and `CORE`
require 20 to 30 trading days of comparison against KRX/cache/outcomes, zero
missing-field zero-fallback incidents, zero provider-error-as-signal incidents,
stable shadow counterfactuals, and explicit approval for live trading.

## Follow-Up

Continue KRX repair. Once KRX official source returns stable rows, KRX can resume
source-of-truth priority for routes where it is stronger, while KIS remains an
official fallback and cross-check source.
