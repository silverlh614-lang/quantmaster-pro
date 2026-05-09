# ADR-0496: Investor Flow Sample Seed & Semantic Net-Buy Normalization

Date: 2026-05-09
Status: Accepted

## Context

ADR-0487 through ADR-0495 rebuilt the Fresh Data Supply diagnostic foundation without affecting live execution. The remaining supply bottleneck is investor-flow sample availability and semantic net-buy normalization:

- `COLLECT_NAVER_INVESTOR_SAMPLE`
- `BUILD_SEMANTIC_NETBUY_SAMPLE`
- `REFRESH_FSS_PASSIVE_ACTIVE`

Before this ADR, NAVER investor trend, semantic net-buy, and FSS passive/active lines could remain `DATA_UNAVAILABLE` with no safe normalized sample structure. Operators could not distinguish `null`, missing fields, stale samples, provider errors, and true numeric zero.

## Decision

Add a diagnostic-only ADR-0496 normalization layer that builds sanitized investor-flow samples, derives semantic net-buy directions, and reports supply coverage. The layer is explicitly not a live trading signal.

Implemented contracts:

1. `InvestorFlowSanitizedSampleAdr0496`
   - Keeps `null` as `null`.
   - Keeps `0` as a real zero.
   - Records absent amount fields in `missingFields`.
   - Marks provider failures as `isProviderIssue=true` and `isMarketSignal=false`.
   - Forbids raw payload persistence.

2. `SemanticNetBuyAdr0496`
   - Converts positive numbers to `NET_BUY`, negative numbers to `NET_SELL`, zero to `NEUTRAL`, and null/missing values to `UNKNOWN`.
   - Computes confluence such as `FOREIGN_INSTITUTION_BOTH_BUY`.
   - Remains diagnostic-only even for `NET_SELL`.

3. `SupplyCoverageReportAdr0496`
   - Reports before/after coverage, sample counts, normalized counts, semantic counts, null/zero/missing/stale/provider-error counts, provider issue count, and market signal count.
   - Allows `coverageAfter` and normalized sample counts to increase in Shadow diagnostics only.

## Integration

- ADR-0489 investor-flow sample acquisition now emits ADR-0496 sanitized samples, semantic net-buy samples, and a supply coverage report.
- ADR-0487 Fresh Data Supply snapshots can reflect ADR-0496 coverage evidence for `NAVER_INVESTOR_TREND`, `SEMANTIC_NETBUY`, and the FSS placeholder line while preserving `executionImpact=NONE`.
- ADR-0491 sanitized Supply Snapshot Store can persist only the ADR-0496 summary counters, never raw provider payloads.
- ADR-0494 promotion audit maps ADR-0496 evidence into audit input (`coverageAfter`, normalized sample count, null/zero separation, provider issue counts) but still requires history and keeps promotion recommendations diagnostic-only.
- `/fresh_data_status` prints the ADR-0496 supply coverage summary and guardrails.
- Runtime Pipeline Audit includes investor-flow promotion audit evidence when present.

## Guardrails

ADR-0496 preserves these invariants:

- `executionImpact='NONE'`.
- `liveExecutionAllowed=false`.
- `rawPayloadPersistenceAllowed=false` for sanitized samples.
- Provider issue is not a market signal.
- `UNKNOWN` remains `UNKNOWN` and is not bearish.
- `null` is never converted to `0`.
- `NET_SELL` is not a live sell signal.
- Semantic confluence is diagnostic-only.
- No Gate, Kelly, required score, `STRONG_BUY`, sector boost, supply boost, KIS order path, or automatic promotion changes.
- ADR-0493/0494 audit remains the only promotion-readiness display path and does not mutate stage automatically.

## Consequences

Expected diagnostic change:

- Before: supply lines can remain fully `DATA_UNAVAILABLE` with no normalized sample counters.
- After: sanitized/semantic samples can move supply diagnostics to `OBSERVING` or `PARTIAL`, and `coverageAfter` can become greater than zero when samples exist.

This ADR does not make investor flow eligible for live Gate/Kelly/order decisions. A follow-up ADR should stabilize program trading session probes or refresh FSS passive/active and short-credit freshness.
