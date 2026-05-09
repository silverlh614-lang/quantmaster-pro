# ADR-0472: Gate1 Scoring Alignment and Dry-run Policy Promotion

Status: Accepted

## Context

Recent Gate1 diagnostics showed that the score engine can structurally starve candidates before any live execution decision is made:

- starvation and score ceiling repair audits expect `WATCHLIST_UPSTREAM_SCORE` and `BREAKOUT_STRUCTURE`
- `minimumSignalScoreTrace.ts` does not include those two component codes
- `WATCHLIST_PRIORITY` exists, but it is not the same concept as `WATCHLIST_UPSTREAM_SCORE`
- `OTHER_POSITIVE` can dominate the positive score audit
- positive score ranges can remain compressed
- configured positive max score can remain below `requiredScore=70`
- ADR-0469 and ADR-0470 are dry-run audits, not live policy

## Decision

ADR-0472 adds a Gate1 scoring alignment dry-run layer. The layer compares the minimum signal score component set with the positive audit component set and emits policy-promotion candidates without mutating live scoring.

The new component candidates are:

- `WATCHLIST_UPSTREAM_SCORE`
- `BREAKOUT_STRUCTURE`

`WATCHLIST_PRIORITY` remains separate:

- `WATCHLIST_PRIORITY` means row priority or watchlist ordering.
- `WATCHLIST_UPSTREAM_SCORE` means stage2/watchlist score imported into Gate1.
- `BREAKOUT_STRUCTURE` means VCP, breakout, or pre-breakout structure score.
- `RELATIVE_STRENGTH` remains an independent positive component.

## Policy

- Live scoring is unchanged.
- `requiredScore=70` is unchanged.
- Dry-run results are `SHADOW_ONLY` policy candidates.
- `executionImpact=NONE`.
- `liveExecutionAllowed=false`.
- `operatorApprovalRequired=true`.
- observation period is 3 trading days.
- provider `VERIFIED` automatically disables unknown-provider relaxation.
- Live promotion requires a later ADR or explicit operator-approved enable work.

## Guardrails

- Do not import KIS order functions.
- Do not lower the Gate1 threshold directly.
- Do not promote SectorEnergy `DEGRADED` or `BLOCKED` to OK.
- Do not turn Supply `UNKNOWN` into bullish.
- Do not treat provider issues as market bearish signals.
- Keep `SELL_ONLY`, emergency stop, R6 defense, VIX, and FOMC hard risk blocks intact.
- Keep shadow and counterfactual learning paths intact.

## ADR-0471 Final Calibration Alignment

`gate1FinalCalibration.ts` remains the ADR-0471 final Gate1 calibration dry-run file. ADR-0472 also aligns with its policy direction and must verify:

- `UnknownPenaltyPolicyMode` definitions and call sites remain explicit.
- `UNKNOWN_DIAGNOSTIC_ONLY` scenario math moves supply unknown pressure out of point score only in dry-run.
- active-component based required score calculation remains diagnostic.
- threshold sweep output never mutates the live Gate threshold.
- `enableMode` degrades to `SHADOW_ONLY` when the calibration context is `SELL_ONLY`.
- `liveExecutionAllowed` remains `false`.
- provider `VERIFIED` automatically disables unknown-policy relaxation.
- `providerVerifiedOverrideWarning` exists when a verified provider still requests unknown relaxation.

Policy decisions:

- `UNKNOWN_DIAGNOSTIC_ONLY` survivors are not live candidates.
- `UNKNOWN_DIAGNOSTIC_ONLY` survivors are `SHADOW_ONLY` observation/counterfactual targets.
- live `requiredScore=70` is retained.
- threshold sweep is diagnostic-only and does not change the actual Gate threshold.
- unknown penalty relaxation is allowed only in `SHADOW_ONLY` dry-run when `providerIssue=true` and `marketSignal=false`.
- when provider health becomes `VERIFIED`, unknown relaxation is automatically disabled.
- live policy promotion is forbidden without 3 trading days of observation data and operator approval.
