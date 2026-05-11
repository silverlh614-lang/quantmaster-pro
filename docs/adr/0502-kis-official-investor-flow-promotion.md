# ADR-0502: KIS Official Investor-Flow Promotion

Date: 2026-05-11

## Status

Accepted for shadow/advisory rollout.

## Context

The KIS `open-trading-api-main` reference is an official Korea Investment &
Securities standard API source. For investor-flow data it is materially safer
than unofficial scraping or inferred semantic sources, but Rule-001 still
applies:

- Provider failure is not a market signal.
- Missing investor fields must not be zero-filled.
- Trading Engine continuity and Shadow Learning must be preserved.
- New or repaired providers promote through OBSERVE, SHADOW_SCORE, ADVISORY,
  WEIGHTED, GATED, then CORE.
- The default execution impact remains `NONE`, and live execution remains
  disabled.

## Decision

KIS official investor-flow evidence is wired into the investor-flow router as a
real read-only evidence source. During the 2026-05-11 KRX row recovery incident,
its emergency default promotion stage is `WEIGHTED` so strict real investor
fields can keep the router alive before cache fallback.

KIS can become the selected router source only when
`KIS_INVESTOR_FLOW_PROMOTION_STAGE` is `WEIGHTED`, `GATED`, or `CORE`. Operators
can still force `OBSERVE`, `SHADOW_SCORE`, or `ADVISORY`; at those stages,
successful KIS evidence is recorded in provider health and attempts but is not
selected as the router source. Even when selected, this patch does not enable
live execution.

## CORE Promotion Criteria

KIS investor-flow evidence must satisfy all of the following before CORE can be
approved:

1. At least 20 to 30 trading days of comparison against KRX, cache fallback, and
   realized outcomes.
2. Zero missing-field zero-fallback incidents.
3. Zero cases where provider errors were interpreted as market signals.
4. Stable shadow counterfactual outcomes.
5. Separate human approval for any live-trading usage.

## Guardrails

- `executionImpact=NONE`
- `liveExecutionAllowed=false`
- No raw payload, app key, token, cookie, or private header persistence
- No direct Gate/Kelly/order/StrongBuy/SectorEnergy boost change
- KIS errors and empty responses remain provider issues, not bearish supply
  signals

## Follow-Up

A later PR may aggregate KIS quotation, previous close, stock name, stock
program trade, market program trade, market supply, and investor-flow evidence
into a `KisOfficialEvidencePack`. That is intentionally out of scope here.
