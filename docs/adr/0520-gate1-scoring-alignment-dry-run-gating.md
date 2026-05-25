# ADR-0520 Gate1 Scoring Alignment DRY_RUN Gating

Status: Accepted / Shadow-only observation

## Context

Live Gate1 scans report `avgScore 42.6 < requiredScore 70`, so every candidate
survives only as shadow and live entries are 0. The system is correctly waiting in
`SHADOW_ONLY` (`executionImpact=NONE`).

ADR-0471 `freezeRule` freezes the live Gate1 scoring calibration: any change to the
live curve requires 3 business days of observation plus operator approval. ADR-0472
(`gate1ScoringAlignmentAdr0472.ts`) already computes the relaxed-curve scenario
`ALIGN_PLUS_DEDUP_PLUS_RISK_SPLIT` (recognize already-computed `BREAKOUT_STRUCTURE`
and `PRICE_MOMENTUM` positive components + ADR-0469 penalty dedup + ADR-0470
risk-at-sizing-only) and reports a hypothetical survivor *count*, but it exposes only
synthetic placeholder symbols (`ADR0472-01` ...). It never identifies the *real*
candidate symbols, and ADR-0476's observation ledger had no `ADR_0472_SCORING_ALIGNMENT`
source. So there was no real-symbol evidence to track forward returns against.

The operator approved a DRY_RUN gating approach: observe only, never touch the live
score or promotion.

## Decision

Add `gate1ScoringAlignmentDryRunGateAdr0520.ts`. It reads the per-candidate frozen
`Gate1ScoreStarvationTrace.actualScore` (live, immutable reference) for the real 43
candidates and copies the ADR-0472 relaxed-curve delta on top:

```
dryRunScore = actualScore + alignmentDelta   // alignmentDelta = relaxed.netScoreAvg - CURRENT.netScoreAvg
```

A REAL symbol is a relaxed-curve survivor when it FAILS the live curve
(`actualScore < requiredScore`) but PASSES the relaxed curve
(`dryRunScore >= requiredScore`). Those survivors are written to the ADR-0476 ledger
under the new source `ADR_0472_SCORING_ALIGNMENT` (with `dryRunScenario` =
`ALIGN_PLUS_DEDUP_PLUS_RISK_SPLIT`) so their 1D/3D/5D forward returns are tracked.

## Policy

- ENV flag `GATE1_SCORING_ALIGNMENT_DRYRUN_ENABLED` (default `false`). When off, the
  gate returns disabled with zero survivors and emits zero ledger rows — behaviour is
  100% identical to before. Operator must explicitly set it to `true`.
- `policyPromotionMode=SHADOW_ONLY`, `executionImpact=NONE`, `liveExecutionAllowed=false`.
- `requiredScore=70` and the live Gate threshold are unchanged.
- Live Gate1 scoring (actualScore / component weightedScore / survivor judgment /
  promotion gate) is never read for mutation or recomputed — only copied.

## Guardrails

- The live Gate1 minimum-signal scoring formula is FROZEN (ADR-0471). This module
  recomputes nothing in the live path; it only adds a diagnostic dry-run delta.
- DRY_RUN survivor rows must never route to live order execution.
- KIS order functions must not be imported; no provider fetch in this module.
- UNKNOWN supply must not be converted to bullish; provider issue is not market bearish.
- Observation write failures must not block scan or engine liveness.

## Outcome Tracking

Survivor rows inherit the ADR-0476 forward-return schema (`forwardReturn1D`,
`forwardReturn3D`, `forwardReturn5D`, MFE/MAE, stop/target touch). After 3 business
days of observation, the operator reviews the relaxed-curve survivors' 3D forward
return before any decision to lift the ADR-0471 freeze. Promotion remains a separate,
explicitly-approved step.
