# ADR-0470: Gate1 Risk Double-Count Dry-run

Status: Accepted / Dry-run only

## Context

Gate1 diagnostics showed that `REGIME_RISK` and `MACRO_RISK` may be reflected twice:

- once in the Gate1 `SIGNAL_SCORE`
- once again in `KELLY_SIZING`

This can suppress candidates even when the risk condition is better expressed as position size rather than signal quality.

## Decision

ADR-0470 adds a dry-run audit for risk placement. The audit separates signal eligibility from position sizing and reports whether the same risk root cause is applied to both paths.

Current code state:

- `gate1RiskDoubleCount.ts` is a dry-run audit
- Live scoring changes: none
- `executionImpact=NONE`

## Policy Principles

- Signal Score represents stock entry quality.
- Kelly/Sizing represents position size under market conditions.
- `SELL_ONLY` is execution eligibility, not a signal score penalty.
- `REGIME_RISK` is primarily a sizing concern; signal impact should be advisory or capped soft penalty only.

## Shadow-Only Promotion Conditions

Promotion beyond dry-run is allowed only as a `SHADOW_ONLY` policy candidate after:

- risk double-count repeats for at least 3 trading days
- risk split scenarios do not exceed the target survivor range
- explicit operator approval

## Guardrails

- Do not remove live risk policy directly.
- Do not relax Kelly multipliers directly.
- Do not route dry-run survivors to live orders.
