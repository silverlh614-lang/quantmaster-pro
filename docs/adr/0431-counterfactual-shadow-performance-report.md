# ADR-0431 — Counterfactual Shadow Learning Performance Report

- **Status**: Accepted
- **Date**: 2026-05-07
- **Series**: Counterfactual / Provisional Shadow Lane (ADR-0425 → 0426 → 0427 → 0428 → 0429 → 0430 → **0431**)
- **Stack on**: ADR-0430 counterfactual ledger SSOT, ADR-0429 cache-first read-only price provider
- **Direct user wording**:
  - *"Counterfactual shadow performance reporting evaluates learning-only samples created under SELL_ONLY / HARD_BLOCK by ADR-0430."*
  - *"This report must never open execution lanes, promote candidates, mutate virtual accounts, lower gate thresholds, or treat PENDING/DATA_UNAVAILABLE as losses."*
  - *"It only answers: what happened after we correctly blocked execution but kept learning alive?"*

## 1. Problem

ADR-0430 records counterfactual learning entries when execution is blocked
(SELL_ONLY, HARD_BLOCK, R6_DEFENSE, VIX/FOMC, liquidity/RRR/sizing, router
HARD_BLOCK). The ledger captures *what we would have bought*, but there was no
way to ask the equally important question *"and what happened next?"*. Without
that read-only feedback we cannot tell whether SELL_ONLY days correctly avoided
losses, blocked rebounds, or showed over-defense — which is exactly the
information needed to validate (later, in a separate ADR) any future promotion
rule.

## 2. Decision

Add a **read-only** report that mirrors ADR-0428 for the counterfactual ledger:

1. New SSOT module `server/learning/counterfactualShadowLearningPerformanceReport.ts`:
   - 6-value `CounterfactualShadowHorizon` (`T_PLUS_30M`, `T_PLUS_1H`,
     `SAME_DAY_CLOSE`, `NEXT_OPEN`, `T_PLUS_1D_CLOSE`, `T_PLUS_3D_CLOSE`).
   - 6-value `CounterfactualShadowPointStatus` (`PENDING`, `OBSERVED`,
     `DATA_UNAVAILABLE`, `MARKET_CLOSED`, `INSUFFICIENT_DATA`, `ERROR`).
   - 7-value `CounterfactualShadowPointSource`
     (`ENTRY_SNAPSHOT`/`SCAN_SNAPSHOT`/`INTRADAY_CANDLE_CACHE`/`DAILY_CANDLE_CACHE`/
     `MARKET_DATA_CACHE`/`READ_ONLY_QUOTE`/`NONE`).
   - `CounterfactualShadowPerformanceRecord` schema with literal markers
     (`source: 'ADR-0430'`, `learningOnly: true`, `executionShadow: false`,
     `virtualAccountImpact: 'NONE'`).
   - `buildCounterfactualShadowPerformanceReport(input)` async (read-time) +
     `formatCounterfactualShadowPerformanceMessage(summary)` +
     `formatCounterfactualShadowSummaryLine(summary)` (one-liner for `/scan_blockers`).
   - `Object.freeze`d `COUNTERFACTUAL_HORIZON_OFFSET_MS` SSOT.
   - `isValidCounterfactualEntry` triple check (`eventType` +
     `source: 'ADR-0430'` + `learningOnly: true`) — counterfactual ledger is
     **never** mixed with provisional or normal shadow.
   - `resolveCounterfactualEntryPrice` fallback chain (sole SSOT, frozen order):
     `entryPrice` → `entryPriceHint` → `metadata.entryPriceHint` →
     `conditionSnapshot.price` → `conditionSnapshot.lastPrice` →
     `metadata.quoteSnapshot.lastPrice` → `undefined` (caller emits
     `INSUFFICIENT_DATA`, never `ERROR`, never a loss).

2. Thin adapter `server/learning/counterfactualShadowPriceProviderAdapter.ts`
   (`wrapProvisionalProviderForCounterfactual`) so the report can reuse
   ADR-0429's cache-first read-only `ProvisionalShadowPriceProvider` without
   coupling counterfactual ledger entries to the provisional ledger. The user
   explicitly chose the adapter over a generic refactor — the adapter is the
   only counterfactual-side dependency on ADR-0429.

3. New telegram command `/shadow_counterfactual`
   (aliases `/counterfactual_shadow`, `/shadow_learning`, `/learning_shadow`) —
   read-only, ADMIN, `riskLevel=0`, 5-min rate-limit, exact ADR-0428 cmd shape.

4. `/scan_blockers` now appends a single counterfactual one-liner
   (`formatCounterfactualShadowSummaryLine`) when the ledger is non-empty.
   Non-blocking: `try/catch` isolates ledger I/O failures from the base
   scan-blockers message.

## 3. Invariants (absolute, must not change)

1. **No live execution.** No KIS order function imports
   (`placeKisMarketOrder`/`placeKisSellOrder`/`cancelKisOrder`/
   `placeKisStopLossOrder`/`placeKisTakeProfitOrder`). Static grep guards
   enforce this.
2. **No autoTradeEngine / orderExecutor / trancheExecutor / shadowTradeRepo
   imports** — counterfactual report touches only the counterfactual ledger.
3. **No ledger crossover.** `eventType !== 'COUNTERFACTUAL_SHADOW_LEARNING_ENTRY'`
   or `source !== 'ADR-0430'` or `learningOnly !== true` → entry is filtered
   out before any price lookup. provisional + normal shadow ledger are not
   mutated and not read by this module (the cmd loads the counterfactual ledger
   only).
4. **No promotion.** `promoteToPaper` / `promoteToLive` / `autoPromote` are
   absent in the source, validated by static grep guards.
5. **No gate threshold change.** No `setGateThreshold`, `MIN_GATE_OVERRIDE`,
   `GATE_RELAX`, `STRONG_BUY_OVERRIDE`.
6. **PENDING / DATA_UNAVAILABLE / INSUFFICIENT_DATA are not losses.**
   `winRateByHorizon` and `avgReturnByHorizon` count *only* `OBSERVED` points
   with finite `returnPct`. `ERROR` is also separated out.
7. **No external API burst.** `priceProvider` is dependency-injected; the cmd
   wires ADR-0429's cache-first provider whose default `maxExternalLookups` is
   `0`. Without the cmd injecting a provider, all horizons stay `PENDING`.
8. **No virtual-account writes.** Static guard for
   `setVirtualAccountHoldings`/`updateVirtualAccountCash`/`mutateHoldings`/
   `setEquity`.
9. **ADR-0157 ENV exact comparison.**
   `COUNTERFACTUAL_SHADOW_PERF_REPORT_DISABLED === 'true'` only —
   `'1'`/`'TRUE'`/`'yes'` are rejected.
10. **No promotion rule, no policy change.** Promotion (paper, live), reduced
    sizing, or auto-relaxation are explicitly out of scope for ADR-0431 and
    deferred to ADR-0432.

## 4. Out of scope (deferred)

- ADR-0432 — promotion rules for provisional / counterfactual learning samples
  (only after sufficient sample accumulation; manual approval gate).
- ADR-0433 — universe-level SELL_ONLY preflight learning wiring.
- INTRADAY_CANDLE_CACHE / DAILY_CANDLE_CACHE / MARKET_DATA_CACHE wiring (ADR-0429
  follow-up). Until those land, all counterfactual horizons remain `PENDING`
  unless an external priceProvider is plugged in by an operator at runtime.

## 5. Wrong solutions explicitly rejected

1. *Treat `PENDING` / `DATA_UNAVAILABLE` as losses* — would invert the SELL_ONLY
   defense signal and mislead future calibration.
2. *Mix counterfactual and provisional ledgers in one report* — would dilute the
   "execution blocked but learning kept" semantics and make ADR-0432 promotion
   logic ambiguous.
3. *Add KIS order or paper-trade hooks* — counterfactual is read-only by
   contract.
4. *Auto-promote winners to live or paper* — explicitly forbidden by user
   wording. Promotion is ADR-0432's responsibility, not this PR's.
5. *Loosen gate thresholds based on counterfactual win rate* — gates are owned
   by ADR-0420/0422/0425 and unchanged here.
6. *Generic priceProvider refactor* — explicitly rejected by user in favor of
   the thin adapter.

## 6. Validation

- New tests: `counterfactualShadowLearningPerformanceReportAdr0431.test.ts`
  (36 cases) + `counterfactualShadowPriceProviderAdapterAdr0431.test.ts`
  (4 cases) + `shadowCounterfactual.test.ts` (9 cases) = **49 cases**
  (target ≥ 16 met by 3×).
- Adjacent counterfactual + provisional regression: 107/107 pass
  (`server/learning/counterfactualShadow` + `provisionalShadow` 5 files).
- Live trading body unchanged. KIS/KRX outbound quota unchanged. Virtual-account
  writes unchanged.

## 7. Comment block to attach near the report function

```
/**
 * ADR-0431:
 * Counterfactual shadow performance reporting evaluates learning-only samples
 * created under SELL_ONLY / HARD_BLOCK by ADR-0430.
 * This report must never open execution lanes, promote candidates, mutate
 * virtual accounts, lower gate thresholds, or treat PENDING/DATA_UNAVAILABLE
 * as losses. It only answers: "what happened after we correctly blocked
 * execution but kept learning alive?"
 */
```

This block is present at the top of `counterfactualShadowLearningPerformanceReport.ts`
and is verified by static grep guard.
