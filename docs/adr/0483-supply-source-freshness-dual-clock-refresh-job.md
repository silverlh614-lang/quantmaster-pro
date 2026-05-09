# ADR-0483 — Supply Source Freshness Dual Clock & Refresh Job

## Status
Accepted — SHADOW_ONLY diagnostic/dry-run refresh evidence.

## Context
ADR-0481 and ADR-0482 made NAVER investor trend and provider-agnostic semantic net-buy data observable. Remaining supply diagnostics still conflated cache freshness with source data freshness. A cache entry can be fresh while the underlying FSS, short/credit, NAVER, KIS program, or semantic source date is several trading days old.

This is a data-health issue, not confirmed bearish supply.

## Decision
ADR-0483 adds `server/trading/signalScanner/supplySourceFreshnessAdr0483.ts` as the SSOT for supply freshness dual clocks. It separately reports:

- cache freshness
- source data freshness
- cache age minutes
- source age in trading days
- oldest source age
- affected stale/unavailable sources
- diagnostic refresh recommendation/status

Fresh cache can contain stale source data, and the UI must show those clocks independently.

## Refresh Job Policy
ADR-0483 refresh status is diagnostic/dry-run first. It can recommend refresh, mark dry-run refresh evidence, skip non-trading days, or report provider failure, but it does not call live execution paths and does not fetch inside `/scan_blockers` formatters.

Refresh failure is try/catch isolated and must not stop scan, Shadow Learning, Runtime Pipeline Audit, or Telegram commands.

## Guardrails
ADR-0483 keeps these invariants:

- `executionImpact = 'NONE'`
- `liveExecutionAllowed = false`
- `policyPromotionMode = 'SHADOW_ONLY'`
- `operatorApprovalRequired = true`

ADR-0483 does **not**:

- change live execution
- change Gate thresholds, Gate weights, Kelly sizing, requiredScore, or live buy policy
- change KIS order behavior or import KIS order modules
- promote stale data to VERIFIED
- convert stale data to bearish
- convert UNKNOWN to bullish
- auto-unblock STRONG_BUY
- persist raw provider payloads

Promotion beyond SHADOW_ONLY requires a future ADR and operator approval.

## Routing Chain
ADR-0483 feeds:

1. ADR-0473 Supply Provider Warmup
2. ADR-0477 InvestorFlow Provider Router
3. ADR-0482 Semantic Net-Buy Normalizer
4. ADR-0476 Observation Ledger
5. ADR-0480 Operator Action Queue
6. ADR-0478 compact `/scan_blockers`
7. ADR-0479 detail/ADR trace registry

Runtime Pipeline Audit may count ADR-0483 as diagnostic evidence only; it must not alter rollout status.

## Consequences
`/scan_blockers` can show `ADR-0483 SupplyFreshness: STALE | oldest=5d | affected=FSS/short/credit | impact=NONE`, while `/supply_health_detail` can show each cache clock and source clock separately. ADR-0477 and ADR-0482 may lower confidence when source data is stale, but stale/provider issues remain separated from bearish market signal.
