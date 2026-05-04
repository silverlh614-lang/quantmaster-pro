# ADR-0168: Emergency Data Quality Circuit Breaker

## Status
Accepted

## Context
Production screenshots showed a coupled `/kms` and `/yh` data-quality failure:

- KRX master universe collapsed to 395 symbols and exceeded 24h TTL.
- Static seed fallback was being treated as if it were a usable production universe.
- Watchlist contained invalid code-like values such as `0070X0`.
- Yahoo stale historical bases produced `changePercent` / `return20d` values that rendered as `+0.00%`.
- Quote sanity failed 8/8, yet scanner Stage1 continued and reported `LOW_VOLUME` / `HIGH_PER` instead of separating missing data from real rejects.

The core invariant is simple: **missing, stale, or failed market data is not zero**. Zero is a real signal and must never be used as a data-quality fallback.

## Decision
Add `server/dataQuality/emergencyDataQualityGuards.ts` as a small SRP module that centralizes emergency guards without expanding scanner or adapter god-functions.

The module provides:

1. `assertUsableKrxMaster`
   - blocks production use when `master.total < 2000`
   - blocks when `ageHours > 24`
   - blocks `STATIC_SEED` / `FALLBACK_SEED` for scan/recommend/autotrade paths

2. `normalizeKrxCode` / `assertValidKrxCode`
   - only six numeric KRX codes are valid
   - `.KS` / `.KQ` suffixes are stripped before KIS/Yahoo calls
   - invalid values are classified as `INVALID_KRX_CODE`, not `FETCH_FAIL`

3. `assertQuoteSanityHealth`
   - aborts scan when `checked >= 5` and `violations / checked >= 0.5`
   - reason code: `QUOTE_SANITY_DEGRADED`

4. `makeStaleQuoteResult`
   - stale quote fields return `null`, never `0`
   - `usableForSignal=false`

5. `classifyStage1RejectStrict`
   - separates `DATA_MISSING_VOLUME`, `DATA_MISSING_PER`, `DATA_MISSING_PRICE`, `DATA_MISSING_RETURN` from real `LOW_VOLUME`, `HIGH_PER`, `MIN_PRICE`

## Consequences
- Static seed remains usable for diagnostics but not production decisions.
- Scanner can fail loudly with `SCAN_ABORTED` instead of returning misleading empty recommendations.
- Telegram and operator-facing reports can render stale values as `N/A`.
- Future wiring should call these guards at `/kms`, `/yh` health, scanner start, watchlist sanity, and autotrade candidate generation boundaries.

## Rollback
The new module is additive. Existing call sites can roll back by not importing it. Once wired into production paths, rollback is one import-level revert per boundary.
