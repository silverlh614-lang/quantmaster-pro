# Vitest Remaining Errors Fix — Pre-Patch Baseline (2026-05-16)

## Step 1 — Baseline Verification

User directive (verbatim):
> "맞다. 남은 에러도 먼저 해결하고 넘어가는 게 정석이다. 현재 문서 기준으로 남은 실패는 Category A, 즉 runtime-critical regression은 0개지만, 전체 npm test는 아직 yellow 상태다..."

### 1.1 Command Results

| Command | Result | Notes |
|---|---|---|
| `npm run lint` | **EXIT=0** ✅ | tsc client + server both clean |
| `ALLOW_DEPLOY_WINDOW=1 npm run validate:all` | **ALL GREEN** ✅ | 14 validation passes; ACMA WARN-only (288 GodFunctionGuard baseline) |
| `npm run build` | **EXIT=0** ✅ | Built in 14.25s; 2 dynamic-import warnings (pre-existing) |
| `npm run test:runtime` | **YELLOW** ⚠️ | 11 failed files / 26 failed tests / 264 passed files / 4361 passed tests / 1 skipped |
| `npm test` (full) | **YELLOW** ⚠️ | **30 failed files / 64 failed tests / 834 passed files / 13022 passed tests / 1 skipped (864 / 13087)** |

### 1.2 Runtime-critical (Category A): **0 fails confirmed** ✅

Per inventory doc, no runtime-critical regression. `priceSourcePolicy.test.ts` (9 fails) is flagged for source-level verification — must inspect `server/trading/priceSourcePolicy.ts` to determine if guard layer moved to `dataConfidenceRouter` / `priceCorrectionEngine` (Category F) or if true runtime regression (escalate to A).

### 1.3 Category Breakdown (from inventory)

| Category | Fails | Files | Status |
|---|---:|---:|---|
| **A — Runtime-critical** | 0 | 0 | ✅ Zero confirmed |
| **B — Refactor import/path breakage** | 13 | 5 | Already partially fixed in PR #1034 |
| **C — Obsolete expectation (static-grep)** | 33 | 14 | **THIS PATCH TARGETS** |
| **D — Environment-dependent** | 6 | 4 | **THIS PATCH TARGETS** (subset) |
| **E — Snapshot/output drift** | 2 | 2 | **THIS PATCH TARGETS** |
| **F — Pre-existing baseline** | 20 | 11 | Verify only; defer if confirmed |
| **Total** | **74** | **36** | Inventory baseline (test:runtime is subset 26/11) |

Note: full-suite count (64 fails / 30 files) is lower than inventory's 74/36 because some Category F files were since auto-cleared or test:runtime scope is narrower than full test.

### 1.4 Targets in This Patch (User Priority C → D → E → F)

**Step 2 — Category C (highest priority, 9 files):**
1. `server/trading/signalScannerAdr0183Wiring.test.ts` (4 fails, lines 152/158/165/172) — re-anchor static-grep guards using `indexOf` ordering instead of contiguous regex
2. `server/trading/learningLoopIntegration.test.ts` (1 fail, line 68) — match new `applyKellyClamp` SSOT (ADR-0157)
3. `server/trading/signalScanner/gate1SellOnlyFlatRowCarryAdr0514.test.ts` (1 fail, line 164) — fix `.toContain` undefined arg
4. `server/trading/shadowLearningOnlyScan.test.ts` (2 fails, lines 482/577) — round-trip + helper grep
5. `server/telegram/commands/system/supplyHealth.cmd.test.ts` (1 fail) — `await diagnoseInvestorFlow` signature change
6. `server/telegram/commands/system/__tests__/supplyHealth.cmd.test.ts` (1 fail) — Patch-006 routedStatus label
7. `server/telegram/commands/control/r3Status.test.ts` (1 fail) — regex 누적 format change
8. `src/__tests__/uiLanguagePhaseA-DoD.test.ts` (1 fail) — accept 8 categories (ADR-0398 sectorEnergy)
9. `server/telegram/commands/trade/forceWatchScan.test.ts` (2 fails) — split light/full mocks
10. `server/clients/kisClient/kisChartCooldownPublicApi.test.ts` (1 fail, line 61) — multi-line barrel
11. `server/screener/stockScreenerKisChartCooldownWiring.test.ts` (1 fail) — grouped import

**Step 3 — Script baseline tests (2 files, 7 fails):**
12. `scripts/check_adr_index.test.js` (5/59) — assert "no NEW violations vs baseline" instead of "no violations"
13. `scripts/check_complexity.test.js` (2/13) — accept `BASELINE_TECHNICAL_DEBT` catalogue (ADR-0133)

**Step 4 — KRX/KIS:**
14. `server/clients/krxOpenApiAdr0342.test.ts` (6/15) — re-anchor 6 static-grep markers

**Step 5 — Category D (subset, deterministic):**
15. `server/trading/corporateActionDetector.test.ts` (2 fails, lines 233/238) — Stale expectations vs widened detector
16. `server/trading/signalScanner/preflight.test.ts` (1 fail, line 314) — kellyMultiplier mock fixture incomplete

**Step 6 — Category E (snapshot drift):**
17. `server/persistence/provisionalShadowLedgerAdr0427.test.ts` (1 fail) — Telegram formatter text update
18. `server/learning/shadowBlockedOutcomeAnalytics.test.ts` (1 fail) — summary 4→11 keys

**Step 7 — Category F verification:**
19. `server/trading/priceSourcePolicy.test.ts` (9 fails) — **Source inspection required.** If guard moved to `dataConfidenceRouter` / `priceCorrectionEngine`, migrate test expectations. If true regression, escalate to A and block patch.

**Deferred (still confirmed baseline after this PR):**
- All other Category F files (≥13 fails) — `git stash` reproduces on origin/main, defer per user's instruction not to expand scope.

### 1.5 Estimated Reduction

If all steps 2-7 succeed:
- `npm test` (full): 64 → ≤30 fails ✅ (user target)
- `npm run test:runtime`: 26 → ≤10 fails ✅ (user target)

### 1.6 Absolute Invariants (Verbatim, MUST PRESERVE)

1. Trading Engine Always-On 정책을 변경하지 마라.
2. Shadow Learning Always-On 정책을 변경하지 마라.
3. ProviderIssue / MarketSignal 분리를 변경하지 마라.
4. AI_ESTIMATED를 CORE로 승격하지 마라.
5. P3/P4 diagnostic isolation을 약화하지 마라.
6. FinalDecisionResolver를 우회하지 마라.
7. 테스트를 통과시키기 위해 runtime 정책을 완화하지 마라.
8. 실패 테스트를 무작정 skip하지 마라.
9. obsolete test라면 최신 구조에 맞게 expectation을 갱신하라.
10. pre-existing baseline이라도 실제 runtime 정책 이동 여부는 확인하라.

LIVE matter files (NOT modifiable): `signalScanner.ts`, `entryEngine.ts`, `exitEngine/**`, `kisClient/**`, `orchestrator/**`, `autoTradeEngine*`, `trancheExecutor.ts`, `buyPipeline.ts`.

KIS/KRX/Yahoo/Naver outbound: **0 net new calls**. No `.skip` / `xit`. ENV `=== 'true'` 정확 비교. SSOT 위임 의무 (호출자 측 inline ENV 검사 금지).

### 1.7 Process Plan

For each Cat C/D/E target:
1. Read the test file's failing assertion(s).
2. Read the corresponding source file's current behavior.
3. Verify runtime policy invariants preserved (no weakening).
4. Update test expectation to match current runtime (obsolete-test path) OR identify runtime regression (escalate to A).
5. Re-run targeted vitest.

For Cat F priceSourcePolicy:
1. Read `server/trading/priceSourcePolicy.ts` to confirm `evaluateDataQuality` semantics.
2. Cross-check `dataConfidenceRouter` and `priceCorrectionEngine` for guard ownership.
3. Decide: F (test stale) vs A (regression).

Output document: `docs/refactor/vitest-remaining-errors-resolution.md` with before/after metrics, per-file resolutions, priceSourcePolicy verdict, and remaining-baseline list.
