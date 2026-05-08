# ADR-0475: Gate1 Positive Source Wiring

Status: Accepted / Dry-run first

## Context

Gate1 diagnostics show score compression and positive-source starvation:

- candidates: 45
- requiredScoreAvg: 70.0
- actualScoreAvg: 21.4
- actualScoreRange: 4.0
- OTHER_POSITIVE share: 100.0%
- WATCHLIST_UPSTREAM_SCORE: zero 45 / 45
- RELATIVE_STRENGTH: zero 45 / 45
- BREAKOUT_STRUCTURE: zero 45 / 45
- componentSetAligned=false
- missingComponents: WATCHLIST_UPSTREAM_SCORE, BREAKOUT_STRUCTURE

ADR-0472 aligned the component vocabulary. ADR-0475 adds the dry-run source wiring needed to prove whether symbol-level positive sources can restore Gate1 differentiation without changing live execution.

## Decision

Add `gate1PositiveSourceWiringAdr0475.ts` as the SSOT for:

1. `WATCHLIST_UPSTREAM_SCORE` resolver from stage2/upstream score, watchlist score, rank, or reason proxy.
2. `RELATIVE_STRENGTH` resolver from price history, sector-relative return, or watchlist proxy.
3. `BREAKOUT_STRUCTURE` resolver from OHLCV, technical cache shape, or watchlist reason proxy.
4. `OTHER_POSITIVE` decomposition into price momentum, technical trend, volume/liquidity, watchlist priority, market regime support, and unresolved other.

The report is stored on `ScanSummary.gate1PositiveSourceWiring` and surfaced in `/scan_blockers`.

## Policy

- Live score calculation is unchanged.
- Required score 70 remains unchanged.
- Gate threshold and condition weights are unchanged.
- Dry-run survivors are never routed to live orders.
- `executionImpact=NONE`.
- `liveExecutionAllowed=false`.
- `policyPromotionMode=SHADOW_ONLY`.
- `operatorApprovalRequired=true`.
- `observationDays=3`.

## Guardrails

- No KIS order function imports.
- No external API calls.
- No raw payload persistence.
- No SectorEnergy DEGRADED/BLOCKED to OK promotion.
- No STOCK_DAILY trusted leadership promotion.
- No UNKNOWN supply bullish conversion.
- No STRONG_BUY relaxation.

## Expected Operator Output

```text
🧬 Gate1 Positive Source Wiring (ADR-0475)
  candidates: 45
  WATCHLIST_UPSTREAM_SCORE: zero 45 -> dryRunAvg +x.x
  RELATIVE_STRENGTH: zero 45 -> dryRunAvg +x.x
  BREAKOUT_STRUCTURE: zero 45 -> dryRunAvg +x.x
  OTHER_POSITIVE share: 100.0% -> afterDecomposition xx.x%
  scoreRange: 4.0 -> xx.x
  bestDryRun: WIRE_ALL_PLUS_DEDUP_PLUS_RISK_SPLIT
  survivors: N
  executionImpact: NONE
  liveExecutionAllowed: false
  nextAction: OBSERVE_3D_THEN_OPERATOR_APPROVAL
```

## Promotion

Promotion beyond SHADOW_ONLY requires at least three trading days of observation, target-survivor validation, provider-health review, and explicit operator approval.
