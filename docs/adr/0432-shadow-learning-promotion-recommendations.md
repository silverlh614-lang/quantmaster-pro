# ADR-0432 — Shadow Learning Promotion Recommendations

- **Status**: Accepted
- **Date**: 2026-05-07
- **Series**: Counterfactual / Provisional Shadow Lane
  (ADR-0425 → 0426 → 0427 → 0428 → 0429 → 0430 → 0431 → **0432**)
- **Stack on**: ADR-0428 / 0429 provisional report + ADR-0430 / 0431
  counterfactual ledger and report
- **User wording (kept verbatim in code + ADR)**:
  > *"Shadow learning promotion is recommendation-only. It evaluates
  >  provisional/counterfactual learning samples and suggests enhanced watch
  >  or normal shadow watch candidates without opening live, paper, execution
  >  shadow, virtual-account, or order paths."*

## 1. Problem

ADR-0427 / 0430 created provisional and counterfactual shadow learning
samples, and ADR-0428 / 0429 / 0431 reported their performance. But there was
no way to ask the next, more useful question: *which of those samples deserve
more attention in future scans, and which ones validate that the original
SELL_ONLY / HARD_BLOCK was correct?*

We need a recommendation layer that:

- Reads the existing read-only performance reports
- Decides whether a sample should be **promoted to a richer Shadow watch
  state** (enhanced watch / normal shadow watch) — but **never** to live,
  paper, or normal-shadow execution
- Decides whether a sample should be rejected as a learning hypothesis
- Or kept under learning-only observation

## 2. Decision

Add a recommendation-only module
`server/learning/shadowLearningPromotionRecommendation.ts` whose **only output
is a label, a score, a confidence, and a recommendation action**. No mutation
of any trading state, ledger write, virtual-account write, or order-path call
is permitted.

### 2.1 Action union (sole 6 values)

```ts
type ShadowLearningPromotionAction =
  | 'PROMOTE_TO_NORMAL_SHADOW_WATCH'
  | 'PROMOTE_TO_ENHANCED_WATCH'
  | 'KEEP_LEARNING_ONLY'
  | 'REJECT_LEARNING_HYPOTHESIS'
  | 'INSUFFICIENT_DATA'
  | 'PENDING';
```

`PROMOTE_TO_LIVE`, `PROMOTE_TO_PAPER`, `EXECUTE`, or any execution-implying
member is **forbidden** by the union and verified by static grep guard.

### 2.2 Decision tree (do not change)

1. `observed === 0`
   1. all points `PENDING` → `PENDING` (+ `PENDING_HORIZONS`)
   2. otherwise → `INSUFFICIENT_DATA` (+ `INSUFFICIENT_OBSERVED_POINTS` and,
      if any point is `DATA_UNAVAILABLE` / `INSUFFICIENT_DATA` /
      `MARKET_CLOSED`, also `DATA_UNAVAILABLE`)
2. `PROMOTE_TO_NORMAL_SHADOW_WATCH` (highest priority)
   - `observed ≥ NORMAL_WATCH_MIN_OBSERVED` (3)
   - `avgObservedReturnPct ≥ NORMAL_WATCH_MIN_AVG_RETURN_PCT` (0.5)
   - `winRateObserved ≥ NORMAL_WATCH_MIN_WIN_RATE` (0.6)
   - `latestReturnPct ≥ NORMAL_WATCH_MIN_LATEST_RETURN_PCT` (0)
   - `worstReturnPct > NORMAL_WATCH_MIN_WORST_RETURN_PCT` (-2.0)
3. `PROMOTE_TO_ENHANCED_WATCH`
   - `observed ≥ ENHANCED_WATCH_MIN_OBSERVED` (2)
   - `avgObservedReturnPct > ENHANCED_WATCH_MIN_AVG_RETURN_PCT` (0)
   - `bestReturnPct ≥ ENHANCED_WATCH_MIN_BEST_RETURN_PCT` (1.0)
   - `winRateObserved ≥ ENHANCED_WATCH_MIN_WIN_RATE` (0.5)
   - `worstReturnPct > ENHANCED_WATCH_MIN_WORST_RETURN_PCT` (-1.5)
4. `REJECT_LEARNING_HYPOTHESIS`
   - `observed ≥ REJECT_MIN_OBSERVED` (2)
   - `avgObservedReturnPct < REJECT_MAX_AVG_RETURN_PCT` (-1.0)
   - `winRateObserved ≤ REJECT_MAX_WIN_RATE` (0.33)
   - `worstReturnPct ≤ REJECT_MAX_WORST_RETURN_PCT` (-2.5)
5. otherwise → `KEEP_LEARNING_ONLY`

> **NOT TRADING THRESHOLDS.** These constants are explicitly *not* trading
> entry thresholds. They are only used to decide which learning samples
> deserve more attention in further observation. The constants live in
> `SHADOW_PROMOTION_THRESHOLDS` (Object.freeze, comment-marked).

### 2.3 Confidence

- `observed ≥ 4` → `HIGH`
- `observed ≥ 2` → `MEDIUM`
- otherwise → `LOW`

### 2.4 Score (0~100, sort-only)

- `NORMAL` → 75 + `5*avg + 15*winRate` (clamped)
- `ENHANCED` → 50 + same boost
- `KEEP` → 40 + `5*avg`
- `REJECT` → 30 + `5*avg` (lower = worse, sorts to bottom of REJECT group)
- `INSUFFICIENT_DATA` / `PENDING` → 0

The score is purely cosmetic for sort/display. It is **not** an entry
allocation, not a Kelly fraction, not a confidence percentage.

### 2.5 Inputs

- `provisionalRecords?: ProvisionalShadowPerformanceRecord[]`
  (from `buildProvisionalShadowPerformanceReport`)
- `counterfactualRecords?: CounterfactualShadowPerformanceRecord[]`
  (from `buildCounterfactualShadowPerformanceReport`)

The two arrays are **never combined into one ledger**. The module evaluates
them in a single recommendation pass but each candidate keeps its
`source: 'PROVISIONAL_SHADOW' | 'COUNTERFACTUAL_SHADOW'` literal.

### 2.6 Persistence — none

Per user §E we adopt selection 1: **read-time recommendation, no snapshot
file**. A future ADR may persist if needed, but not in this PR.

### 2.7 Telegram and `/scan_blockers`

- New command `/shadow_promotion` (aliases `/shadow_learning_promotion`,
  `/learning_promotion`, `/shadow_promote_candidates`). SYS, ADMIN,
  `riskLevel=0`, 5-minute rate-limit.
- `/scan_blockers` appends a one-liner via
  `formatShadowLearningPromotionSummaryLine` after the existing
  ADR-0431 counterfactual line (try/catch isolated).

## 3. Invariants (absolute)

1. **No live execution.** No KIS order import (`placeKisMarketOrder`,
   `placeKisSellOrder`, `cancelKisOrder`, `placeKisStopLossOrder`,
   `placeKisTakeProfitOrder`). Static grep guards enforce this.
2. **No autoTradeEngine / orderExecutor / trancheExecutor / shadowTradeRepo
   imports.** Verified by static grep.
3. **No promotion functions.** `promoteToLive` / `promoteToPaper` /
   `autoPromote` / `executeOrder` are absent in the module and barrel.
4. **No gate threshold change.** No `setGateThreshold`, `MIN_GATE_OVERRIDE`,
   `GATE_RELAX`, `STRONG_BUY_OVERRIDE`.
5. **No virtual-account writes.** No `setVirtualAccountHoldings`,
   `updateVirtualAccountCash`, `mutateHoldings`, `setEquity`.
6. **No external API burst.** The `/shadow_promotion` cmd uses ADR-0429's
   cache-first read-only `priceProvider` (default `maxExternalLookups=0`).
   The recommendation builder itself has zero external dependencies.
7. **PENDING / DATA_UNAVAILABLE / INSUFFICIENT_DATA / ERROR are never losses.**
   Both `avgObservedReturnPct` and `winRateObserved` are computed from
   `OBSERVED` points only.
8. **Ledger separation enforced.** The module reads from neither
   `shadow-trades.json` nor a merged super-ledger. It accepts only the two
   PerformanceRecord arrays and emits source-tagged candidates.
9. **`recommendationOnly: true`** is a literal type on every emitted
   candidate. Same for `liveAllowed: false`, `paperAllowed: false`,
   `executionShadowAllowed: false`.
10. **ENV exact comparison (ADR-0157).**
    `SHADOW_LEARNING_PROMOTION_DISABLED === 'true'` only — `'1'`, `'TRUE'`,
    `'yes'` are rejected.
11. **No SectorEnergy STALE/DEGRADED → OK upgrade.** The recommender does
    not touch sector energy state.
12. **No SELL_ONLY / R6_DEFENSE / emergencyStop bypass.** It does not even
    read those flags — it reads only the precomputed PerformanceRecord.

## 4. Out of scope (deferred)

- ADR-0433 — universe-level SELL_ONLY preflight learning wiring.
- ADR-0434 — actual candle/cache lookup wiring (intraday / daily / market /
  read-only quote) replacing the current `priceProvider` cache-only stub.
- Reduced paper / live promotion remains forbidden until a separate ADR
  explicitly allows it after sample accumulation and operator review.
- Auto-edit of watchlist (e.g., automatic `enhanced` flag on `WatchlistEntry`)
  is intentionally not implemented in this PR — only the recommendation is
  surfaced.

## 5. Wrong solutions explicitly rejected

1. *Treat `PENDING` / `DATA_UNAVAILABLE` as losses* — would invert the very
   meaning of the SELL_ONLY counterfactual signal and pollute promotion.
2. *Mix the two ledgers into one* — would lose ADR-0427 / 0430's careful
   physical separation and break ADR-0432's `source` field.
3. *Auto-execute or auto-watchlist-flag winners* — explicitly forbidden.
   Promotion here is a label, not an instruction.
4. *Lower gate thresholds because counterfactuals look strong* — gates are
   owned by ADR-0420 / 0422 / 0425.
5. *Add a `PROMOTE_TO_PAPER` or `PROMOTE_TO_LIVE` action value* — caught by
   the static grep guard on the action union.
6. *Persist a recommendation snapshot file in this PR* — out of scope; the
   read-time builder is enough for now.

## 6. Validation

- New tests:
  - `shadowLearningPromotionRecommendationAdr0432.test.ts` — 37 cases
    (decision tree, confidence, score, sort order, source separation,
    fallback chain, ENV exact comparison, formatter output, summary
    line, 11 static grep guards).
  - `shadowPromotion.test.ts` — 9 cases (metadata, execute, rate-limit,
    reset, throw graceful, static grep guards including `PROMOTE_TO_LIVE`
    absence on aliases and source).
- Adjacent counterfactual + provisional regression: untouched, still
  green.
- LIVE trading body unchanged. KIS / KRX / Yahoo / Naver outbound
  unchanged. Virtual-account writes unchanged.

## 7. ADR comment block (attached in source)

```ts
/**
 * ADR-0432:
 * Shadow learning promotion is recommendation-only.
 * It evaluates provisional/counterfactual learning samples and suggests
 * enhanced watch or normal shadow watch candidates without opening live,
 * paper, execution shadow, virtual-account, or order paths.
 *
 * This module must never mutate trading state, lower thresholds, or auto-promote
 * candidates. It only ranks learning samples for further observation.
 */
```

The block is present at the top of `shadowLearningPromotionRecommendation.ts`
and again above `buildShadowLearningPromotionRecommendations`. Verified by a
dedicated static grep guard.
