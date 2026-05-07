# ADR-0433 — Counterfactual Universe Learning Preflight Wiring

- **Status**: Accepted
- **Date**: 2026-05-07
- **Series**: Counterfactual / Provisional Shadow Lane
  (ADR-0425 → 0426 → 0427 → 0428 → 0429 → 0430 → 0431 → 0432 → **0433**)
- **Stack on**: ADR-0430 candidate-level counterfactual ledger + ADR-0432 promotion
  recommendation. Closes the gap where preflight abort happens *before* candidates
  reach buyListLoop.
- **User wording (kept verbatim in code + ADR)**:
  > *"SELL_ONLY 는 실매수 차단이지 학습 차단이 아니다. preflight abort 여도
  >  learning-only snapshot 은 가능해야 한다. universe-level learning snapshot 은
  >  일반 shadow trade, provisional shadow, counterfactual candidate entry 와
  >  분리한다. 후보별 symbol 정보가 없으면 억지로 fake symbol record 를 만들지
  >  않는다. 후보별 정보가 있으면 lightweight candidate summary 만 남긴다."*

## 1. Problem

ADR-0430 keeps candidate-level counterfactual learning alive under SELL_ONLY /
HARD_BLOCK, but only after candidates reach `buyListLoop`. Some preflight aborts
fire *before* per-candidate evaluation:

- SELL_ONLY (preflight L221)
- R6_DEFENSE (preflight L237)
- VIX_BLOCK (preflight L257)
- FOMC_BLOCK (preflight L278)
- R3 sanity HARD_BLOCK latch (preflight L201)
- R3 SHADOW_ONLY ephemeral pre-scan abort (preflight L513)
- data-starved scan (preflight L295)

In every one of those branches the scan returns `{ shouldAbort: true,
skipPersist: true }` *without* ADR-0430 ever firing — `data/counterfactual-shadow-learning-ledger.json`
stays empty, and `/shadow_counterfactual` and `/shadow_promotion` see no samples.

This violates the user's guiding principle: *"Shadow learning must run 365
days, regardless of SELL_ONLY."*

## 2. Decision

Add a new universe-level learning lane orthogonal to ADR-0430:

- New SSOT module `server/persistence/counterfactualUniverseLearningRepo.ts`.
- New wiring helper `server/trading/signalScanner/counterfactualUniverseLearningWiring.ts`.
- New telegram command `/shadow_universe` (+aliases
  `/counterfactual_universe`, `/universe_learning`).
- New `/scan_blockers` summary section.
- Separate persistence file `data/counterfactual-universe-learning-ledger.json`
  — physically separated from `shadow-trades.json`,
  `provisional-shadow-ledger.json`, and `counterfactual-shadow-learning-ledger.json`.

### 2.1 Sole event type

```ts
type CounterfactualUniverseLearningSnapshot = {
  id: string;
  eventType: 'COUNTERFACTUAL_UNIVERSE_LEARNING_SNAPSHOT';
  source: 'ADR-0433';
  learningOnly: true;
  executionShadow: false;
  virtualAccountImpact: 'NONE';
  liveAllowed: false;
  paperAllowed: false;
  executionShadowAllowed: false;
  // ...
};
```

All marker fields are TypeScript literal types — caller-side mutation of any
of `liveAllowed`, `paperAllowed`, `executionShadowAllowed`, `learningOnly`,
`executionShadow`, `virtualAccountImpact` produces a compile error.

### 2.2 Reason union (sole 11 values)

```ts
type CounterfactualUniverseLearningReason =
  | 'SELL_ONLY_PREFLIGHT'
  | 'HARD_BLOCK_PREFLIGHT'
  | 'R6_DEFENSE_PREFLIGHT'
  | 'EMERGENCY_STOP_PREFLIGHT'
  | 'VIX_BLOCK_PREFLIGHT'
  | 'FOMC_BLOCK_PREFLIGHT'
  | 'MANUAL_BUY_BLOCK_PREFLIGHT'
  | 'SCAN_ABORTED_BEFORE_GATE'
  | 'CANDIDATE_EVALUATION_SKIPPED'
  | 'LEARNING_ONLY'
  | 'UNKNOWN';
```

`PROMOTE_TO_LIVE`, `EXECUTE`, or any execution-implying member is **forbidden**
by the union and verified by static grep guard.

### 2.3 Preflight stage union (sole 5 values)

```ts
type CounterfactualUniversePreflightStage =
  | 'BEFORE_UNIVERSE_BUILD'
  | 'AFTER_UNIVERSE_BUILD'
  | 'AFTER_CANDIDATE_SCAN'
  | 'BEFORE_BUYLIST_LOOP'
  | 'UNKNOWN';
```

The stage controls candidate-summary richness. `BEFORE_UNIVERSE_BUILD` always
records `candidateSummaryCount=0`; later stages may include up to 50 lightweight
summaries.

### 2.4 Candidate summary policy (sole subset, ≤ 50)

```ts
type CounterfactualUniverseCandidateSummary = {
  symbol: string;
  name?: string;
  lastPrice?: number;
  changePct?: number;
  volume?: number;
  turnover?: number;
  sector?: string;
  source?: string;
  rank?: number;
};
```

The recorder takes raw candidate objects from the caller (no extra fetch) and
extracts only that subset. Anything else (api raw bodies, secrets, large
arrays) is dropped. `UNIVERSE_LEARNING_MAX_CANDIDATE_SUMMARIES = 50`.

### 2.5 Ledger separation (absolute)

| File | Used by | Allowed mutations from this PR |
|------|---------|--------------------------------|
| `shadow-trades.json` | normal shadow buy (`shadowTradeRepo`) | **none** |
| `provisional-shadow-ledger.json` | ADR-0427 provisional candidate ledger | **none** |
| `counterfactual-shadow-learning-ledger.json` | ADR-0430 candidate-level entries | **none** |
| `counterfactual-universe-learning-ledger.json` | **this PR** universe snapshots | **append only** |

`PROVISIONAL_SHADOW_LEDGER_FILE` and `COUNTERFACTUAL_SHADOW_LEARNING_LEDGER_FILE`
are imported nowhere in this module (static grep guard).

### 2.6 dedup key

```
${scanId}:ADR-0433:${preflightStage}
```

If `scanId` is missing, fall back to `YYYYMMDDHHmm`. The recorder already calls
`hasExistingUniverseSnapshot(scanId, stage)` to short-circuit before append.

### 2.7 ENV — exact comparison (ADR-0157)

`COUNTERFACTUAL_UNIVERSE_LEARNING_DISABLED === 'true'` only. `'1'`, `'TRUE'`,
`'yes'` are rejected. Default OFF.

### 2.8 Telegram + `/scan_blockers`

- New command `/shadow_universe` (aliases `/counterfactual_universe`,
  `/universe_learning`). SYS, ADMIN, `riskLevel=0`. Read-only — no rate-limit
  needed because the source ledger is local fs and the message is a single
  summary frame.
- `/scan_blockers` appends a one-section summary via
  `formatCounterfactualUniverseLearningSummarySection` after the existing
  ADR-0432 promotion line (try/catch isolated).

## 3. Invariants (absolute)

1. **No live execution.** No KIS order import (`placeKisMarketOrder`,
   `placeKisSellOrder`, `cancelKisOrder`, `placeKisStopLossOrder`,
   `placeKisTakeProfitOrder`). Static grep guards enforce this.
2. **No autoTradeEngine / orderExecutor / trancheExecutor / shadowTradeRepo
   imports.** Verified by static grep.
3. **No promotion or execution-implying types.** No `promoteToLive`,
   `promoteToPaper`, `autoPromote`, `executeOrder` anywhere in the module.
4. **No gate threshold change.** No `setGateThreshold`, `MIN_GATE_OVERRIDE`,
   `GATE_RELAX`, `STRONG_BUY_OVERRIDE`.
5. **No virtual-account writes.** No `setVirtualAccountHoldings`,
   `updateVirtualAccountCash`, `mutateHoldings`, `setEquity`.
6. **No external API call.** The recorder only reads in-memory caller data
   (watchlist + macroState). The repo only does fs writes.
7. **No raw payload persistence.** Caller passes raw candidates; recorder
   reduces them to the lightweight subset above.
8. **No fake symbol creation.** When `candidates` is empty or undefined,
   `candidateSummaryCount = 0` and `candidates` is left undefined — no synthetic
   row is invented (user §"핵심 불변식" #6 정합).
9. **Ledger physical separation enforced.** The repo does not import or call
   `provisionalShadowLedger`, `counterfactualShadowLearningRepo`, or
   `shadowTradeRepo` — verified by static grep.
10. **Record failure is isolated.** `appendCounterfactualUniverseLearningSnapshot`
    catches its own write errors and returns `{ recorded: false, reason:
    'write-failed' }`. The wiring helper additionally try/catches around the
    recorder so a fs failure cannot break the preflight abort flow.
11. **literal type markers** (`liveAllowed: false`, `paperAllowed: false`,
    `executionShadowAllowed: false`, `learningOnly: true`, `executionShadow:
    false`, `virtualAccountImpact: 'NONE'`) on every emitted snapshot.

## 4. Out of scope (deferred)

- ADR-0434 — actual candle / cache lookup wiring for ADR-0429
  `priceProvider`. Universe snapshots intentionally do **not** carry per-horizon
  return points; promotion / performance reports remain in ADR-0431 / 0432
  candidate-level lanes.
- Auto-edit of watchlist (e.g., automatic `enhanced` flag on `WatchlistEntry`)
  is intentionally not implemented in this PR.
- Reduced paper / live promotion remains forbidden until a separate ADR
  explicitly allows it after sample accumulation and operator review.

## 5. Wrong solutions explicitly rejected

1. *Reuse `counterfactual-shadow-learning-ledger.json` for universe snapshots*
   — would lose ADR-0430's careful per-candidate physical separation and break
   ADR-0432's `source` field.
2. *Synthesise fake `symbol` rows when candidates are empty* — violates user
   §"핵심 불변식" #6.
3. *Persist whole raw candidate objects (api responses, secrets)* — violates
   §E lightweight summary policy and risks token leak.
4. *Auto-execute or auto-watchlist-flag on snapshot creation* — explicitly
   forbidden; this is a learning lane only.
5. *Lower SELL_ONLY / R6_DEFENSE thresholds because more snapshots accumulate*
   — gates are owned by ADR-0420 / 0422 / 0425.
6. *Add a `PROMOTE_TO_PAPER` or `PROMOTE_TO_LIVE` action value* — there is no
   action value at all; this PR records snapshots, not recommendations.
7. *Persist a recommendation snapshot file in this PR* — out of scope; ADR-0432
   already owns recommendations.

## 6. Validation

- New tests:
  - `counterfactualUniverseLearningRepoAdr0433.test.ts` — 33 cases (16 user
    §J cases + decision tree + reason mapping + dedup key + corruption
    fallback + 11 static grep guards).
  - `shadowUniverse.test.ts` — 8 cases (metadata, execute empty, execute
    populated, formatter empty, throw graceful, 4 static grep guards).
- Adjacent counterfactual + provisional regression: untouched, still green
  (only `signalScannerAdr0183Wiring.test.ts` slice window expanded from 200 →
  800 chars — intended interface stability check).
- LIVE trading body unchanged. KIS / KRX / Yahoo / Naver outbound unchanged.
  Virtual-account writes unchanged.

## 7. ADR comment block (attached in source)

```ts
/**
 * ADR-0433:
 * SELL_ONLY / HARD_BLOCK may stop execution before candidate-level learning
 * lanes are reached. Universe-level counterfactual learning preserves the
 * scan context at preflight abort time without opening execution, paper,
 * normal shadow, provisional shadow, or virtual-account paths.
 *
 * This module records learning-only snapshots only. It must never bypass
 * SELL_ONLY for execution or mutate trading state.
 */
```

The block is present at the top of `counterfactualUniverseLearningWiring.ts`
and on the `recordCounterfactualUniverseLearningSnapshot` function. Verified by
a dedicated static grep guard.
