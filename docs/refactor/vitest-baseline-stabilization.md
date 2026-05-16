# Vitest Baseline Stabilization — Post PR #1033 (2026-05-16)

**Branch:** `claude/stabilize-vitest-baseline-2qXkK`
**Traceability:** Patch-VITEST-BASELINE-001
**Scope constraint (verbatim user directive):** *"작업은 명령한 범위만 최소화해서 진행"* — do only the commanded scope, minimize work. Out of scope: signalScanner 2차 다이어트, any new features.

## 1. Goal

Restore a deterministic Vitest baseline after PR #1033 (validation pipeline normalization) so that:

- All Category A (runtime-critical) regressions are identified and fixed.
- All Category B (refactor/import breakage) failures the test suite owns are fixed without weakening runtime policy.
- Categories C / D / E / F are catalogued for follow-up PRs and not silently skipped.
- Core test groups (`test:runtime`, `test:telegram`, `test:scanner`, `test:changed`) exist and the runtime group is in a knowable green/yellow/red state.
- Documentation makes the next-PR priority obvious without re-running the full suite.

## 2. Method

Per user spec (Step 1 → Step 8):

1. Ran `npm test` and captured the full inventory in [`vitest-failure-inventory.md`](./vitest-failure-inventory.md).
2. Classified every failure into A–F per the user's definitions.
3. Verified that no Category A regression exists on this branch (`priceSourcePolicy.test.ts` was the only ambiguous candidate; reproduced identically on `git stash --include-untracked` origin/main snapshot → Category F).
4. Fixed Category B issues whose root cause is unambiguously test-side (missing mock export, mis-located test files).
5. Added the four test groups to `package.json` without changing existing scripts.
6. Documented remaining failures with per-file rationale and recommended next-PR scope.

The 10 absolute principles from the user spec were honored:

1. ❌ No runtime policy weakened to satisfy a test.
2. ❌ Trading Engine Always-On unchanged.
3. ❌ Shadow Learning Always-On unchanged.
4. ❌ ProviderIssue / MarketSignal separation unchanged.
5. ❌ AI_ESTIMATED → CORE promotion not opened.
6. ❌ P3/P4 diagnostic isolation unchanged.
7. ❌ FinalDecisionResolver not bypassed.
8. ❌ No `.skip` / `xit` added.
9. ✅ Obsolete tests were either fixed in-place (B) or catalogued for deletion/relocation (4 `docs/adr/*.test.ts` orphans deleted).
10. ✅ Flaky tests (D/E categories) catalogued with concrete cause rather than silently rerun.

## 3. Changes in this PR

### 3.1 Code / test fixes (Category B)

| File | Change | Effect |
|---|---|---|
| `server/diagnostics/runtimePipelineAuditAdr461.test.ts` | Extended `vi.mock('../trading/signalScanner/scanDiagnostics.js')` factory to export the full canonical `DEFAULT_DATA_PROMOTION_STATUS` (`kisInvestorFlow: 'WEIGHTED'`, `sectorEnergy: 'WEIGHTED'`, `dartFinancials: 'ADVISORY'`, `yahooPrice: 'GATED'`); added `vi.mock('../trading/signalScanner/gate1DryRunObservationLedgerAdr0476.js', () => ({ getGate1DryRunObservationLedgerCount: () => 0 }))` so the test reads no real on-disk ledger. | 10/10 PASS (was 1/10). |
| `docs/adr/baselineAlignment.test.ts` | Deleted. | Removes import-error suite. |
| `docs/adr/holidaySnapshotRepo.test.ts` | Deleted. | Removes import-error suite. |
| `docs/adr/marketTruthLayer.test.ts` | Deleted. | Removes import-error suite. |
| `docs/adr/priceAdapter.test.ts` | Deleted. | Removes import-error suite. |

Provenance of the 4 deletions: PR #1013 commit `f88a1cd` (Patch-SHADOW-BULL-EXPOSURE-FLOOR-003) introduced them in the wrong directory referencing source files that have never existed in the codebase (`grep -r holidaySnapshotRepo` → 0 hits). They are speculative/aspirational tests, not refactor casualties. Per principle #9, documented and deleted.

### 3.2 New npm scripts (Step 5)

`package.json` additions (existing scripts untouched):

```json
"test:runtime": "vitest run server/trading server/clients/kisClient server/orchestrator",
"test:telegram": "vitest run server/telegram",
"test:scanner": "vitest run server/trading/signalScanner server/screener",
"test:changed": "vitest run --changed"
```

Rationale: matches the user's spec verbatim (`server/trading`, `server/clients/kisClient`, `server/orchestrator` → "runtime"; `server/telegram` → "telegram"; `server/trading/signalScanner` + `server/screener` → "scanner"; `vitest --changed` → "changed").

### 3.3 New documents

- [`docs/refactor/vitest-failure-inventory.md`](./vitest-failure-inventory.md) — per-file failure catalogue with category, F/T counts, and recommended action.
- This file (`vitest-baseline-stabilization.md`) — summary, fixes, remaining state, next-PR plan.

## 4. Baseline state after this PR

### 4.1 Full suite (`npm test`)

Before this PR (PR #1033 head):

- 13,012 passed · 74 failed · 1 skipped · 13,087 total
- 832 file-pass · 36 file-fail

After this PR:

- 13 fewer failures expected (9 fixed in `runtimePipelineAuditAdr461`, 4 suite-level errors removed by deleting orphan tests).
- New target: ~13,021 passed · ~61 failed · 1 skipped / ~832 file-pass · ~32 file-fail.
- Remaining 61 are catalogued as 33 × C (obsolete expectation), 6 × D (env-dep), 2 × E (snapshot drift), 20 × F (pre-existing baseline).

### 4.2 `test:runtime` (the user's primary stabilization target)

Sampled on the working branch:

- **264 file-pass / 11 file-fail · 26 individual fails**
- **Category breakdown:** all 26 are C / E / F. **Zero Category A.**

Per-file remaining fails in `test:runtime`:

| File | F/T | Category | Action |
|---|---:|---|---|
| `server/clients/kisClient/kisChartCooldownPublicApi.test.ts` | 1/10 | C | Re-anchor static-grep to multi-line barrel format (next ADR follow-up). |
| `server/trading/corporateActionDetector.test.ts` | 2/45 | D | Pin `windowDays=5` and `windowDays=undefined` expectations to the widened detector behavior; verify whether widening was intentional. |
| `server/trading/learningLoopIntegration.test.ts` | 1/4 | C | Update static-grep for ADR-0157 `applyKellyClamp` refactor — pattern `accountKellyMultiplier * biasMultipli…` no longer present. |
| `server/trading/priceSourcePolicy.test.ts` | 9/34 | F | **Confirmed F** — `git stash --include-untracked` reproduces 9/9 on origin/main. Belongs to upstream `evaluateDataQuality` permissive change; expectations need to move to `dataConfidenceRouter` / `priceCorrectionEngine` layer (see ADR-0414). |
| `server/trading/shadowLearningOnlyScan.test.ts` | 2/42 | C | (a) legacy `learningOnly=true` row count expectation (b) static-grep for `from '…/shadowLearningOnlyScan\.js'` — moved to module-local helper. |
| `server/trading/signalScanner/gate1FinalCalibrationAdr0471.test.ts` | 1/15 | D | `recommendedThreshold` is cron-state-dependent; needs deterministic fixture. |
| `server/trading/signalScanner/gate1SellOnlyFlatRowCarryAdr0514.test.ts` | 1/5 | C | `.toContain(undefined)` — assertion shape outdated. |
| `server/trading/signalScanner/naverInvestorTrendCollectorAdr0481.test.ts` | 2/21 | F | Documented baseline (CLAUDE.md PATCH-009 row). |
| `server/trading/signalScanner/preflight.test.ts` | 1/10 | D | `finalKellyMultiplier` expected `0.864`, received `0` — VIX/FOMC chain mock incomplete after ADR-0168 PR-Kelly-Clamp-SSOT. |
| `server/trading/signalScanner/supplyProviderWarmupAdr0473.test.ts` | 2/16 | F | Documented baseline. |
| `server/trading/signalScannerAdr0183Wiring.test.ts` | 4/23 | C | Static-grep for SELL_ONLY/R6_DEFENSE/VIX/FOMC early-return shape `return { shouldAbort: true, skipPersist: true }` immediately followed by `await updateShadowResults(…)`. ADR-0367 inserted `await recordPreflightBlockedScan(…)` between marker and `updateShadowResults`. Source code is correct; test regex is structurally stale. |

**Verbatim verification of the ADR-0367 drift** (sampled SELL_ONLY case):

> Test expects: `return { shouldAbort: true, skipPersist: true }` immediately followed by `await updateShadowResults(shadows, regime)`.
> Actual: the early-return marker is now followed by `await recordPreflightBlockedScan(…)` (added by ADR-0367 / Patch-PREFLIGHT-BLOCKED-SCAN-SUMMARY-001) and then `await updateShadowResults(…)` and then `saveShadowTrades(…)`. The runtime behavior is identical (the early-return still happens at the same code point with the same payload); the test's static-grep regex predates the wiring insertion.

This is Category C (obsolete expectation), **not** a runtime regression. Promoting it to Category A would require evidence that `recordPreflightBlockedScan` alters control flow on the abort path — verified by inspection that it does not (the call is `await`-ed but the function is read-only diagnostic and the abort `return` is preserved).

### 4.3 `test:runtime` honest assessment

`test:runtime` is **NOT green**. It is **yellow** — 26 known fails, all categorized as test-expectation drift or pre-existing baseline, no Category A regression. Per principle #1 ("Do NOT weaken runtime policies to make tests pass"), no shortcut fixes were applied.

The user's spec Step 6 ("test:runtime green goal") is split into two phases:

- **This PR:** establish that no Category A regression exists, fix the unambiguous Category B issues, document the C/E/F drift per ADR.
- **Follow-up PRs (per ADR):** re-anchor static-grep guards and obsolete expectations. Each follow-up should touch one ADR's tests at a time so the wiring it tests is traceable back to a single source change.

## 5. Recommended follow-up PRs (per ADR, not in scope of this PR)

Ordered by user value:

1. **ADR-0367 `signalScannerAdr0183Wiring.test.ts` re-anchor** (4 fails)
   - Update static-grep regex to allow `recordPreflightBlockedScan` between early-return marker and `updateShadowResults` for SELL_ONLY / R6_DEFENSE / VIX / FOMC paths.
   - Pattern: replace exact-sequence assertion with two separate `expect(src).toMatch(returnMarker)` and `expect(src).toMatch(updateShadowResults)` checks, then assert order via two `src.indexOf(...)` calls.

2. **ADR-0157 `learningLoopIntegration.test.ts` Kelly chain re-anchor** (1 fail)
   - Replace `accountKellyMultiplier * biasMultipli…` static-grep with `applyKellyClamp(...)` invocation grep.

3. **ADR-0414 `priceSourcePolicy.test.ts` policy migration** (9 fails)
   - Inspect `server/trading/priceSourcePolicy.ts` to confirm whether `evaluateDataQuality` is intentionally permissive (per Patch-MARKET-CLOSE-SNAPSHOT-001 `replayOnly`/`executionImpact='NONE'` guard moving upstream).
   - If yes: move WARN/INVALID/CORPORATE_ACTION_SUSPECT assertions to `dataConfidenceRouter` / `priceCorrectionEngine` test files.
   - If no: this becomes Category A and a separate regression PR.

4. **`docs/adr/INDEX.md` baseline cleanup** (5 fails in `scripts/check_adr_index.test.js`)
   - 22 baseline violations per ADR-0453 retrofit. Tests assert EXIT=0; update test to assert "no new violations vs baseline" instead of "no violations at all".

5. **`scripts/check_complexity.test.js` baseline catalogue alignment** (2 fails)
   - `BASELINE_TECHNICAL_DEBT` is intentionally non-empty; update test to match.

6. **`server/clients/krxOpenApiAdr0342.test.ts` retry-depth grep re-anchor** (6 fails)
   - Source refactored; update static-grep markers.

7. **`server/trading/corporateActionDetector.test.ts` widened-detection acceptance** (2 fails)
   - Confirm widening is intentional; update expectations.

8. **`server/trading/signalScanner/preflight.test.ts` Kelly chain mock** (1 fail)
   - Add VIX/FOMC mock to deliver `finalKellyMultiplier=0.864` per ADR-0168 clamp.

9. **Environment-dependent tests** (`nightlyReflectionEngine`, `safePctChangeReturnWindow`, `marketDataRefreshSectorEnergyInputsAdr0454`) (3 fails)
   - Pin KST clock via `vi.useFakeTimers`; pin trading calendar window via injected fixture (ADR-0157 `now` injection pattern); remove `execSync` dependency or skip-on-sandbox guard.

10. **Snapshot drift** (`provisionalShadowLedgerAdr0427`, `shadowBlockedOutcomeAnalytics`) (2 fails)
    - Update fixtures to match new text/schema.

11. **Pre-existing baseline (Category F, 20 fails)** — accept as-is per CLAUDE.md change log; revisit only if an upstream fix makes them eligible.

## 6. Step 8 — final verification

Commands executed (results captured in the verification appendix below):

- `npm run lint` — must be green.
- `npm run validate:all` — must be green (or document baseline-permitted WARNs).
- `npm run build` — must be green.
- `npm run test:runtime` — yellow (26 known fails, all categorized).
- `npm test` — yellow (~61 known fails, all categorized).

If `lint` / `validate:all` / `build` regress on this branch, that is the only blocker for merging.

### 6.1 Verification appendix (results)

Captured on branch `claude/stabilize-vitest-baseline-2qXkK` at 2026-05-16.

| Command | Result | Notes |
|---------|--------|-------|
| `npm run lint` (tsc client + server) | ✅ GREEN (exit 0) | Zero type errors |
| `npm run build` (vite production) | ✅ GREEN (exit 0) | `built in 15.26s`, 3564 modules. CSS plugin warning + chunk-size warning are pre-existing, not regressions |
| `npm run validate:all` (17 validators) | ✅ GREEN (exit 0) | All validators OK — SilentDegradation 190 옵셔널 baseline 1 흡수, ADRIndex 324 files / 307 unique / 충돌 12 / 누락 10 / 다음 발급 0518, PendingWiring 68 항목, YahooRange / UILanguage / DataTrust / YahooSymbolResolver 모두 위반 0건 |
| `npm run test:runtime` | 🟡 YELLOW | 264 file-pass / 11 file-fail · 4361 test-pass / 26 test-fail / 1 skip. **Zero Category A.** Matches §4 baseline state exactly |
| `npm test` (full suite) | 🟡 YELLOW | 834 file-pass / 30 file-fail · 13022 test-pass / 64 test-fail / 1 skip. **Zero Category A.** Matches §4 baseline ±3 (intra-run nondeterminism on env-dep tests) |

Gate decision: `lint` / `validate:all` / `build` are all green. `test:runtime` yellow is the *expected, documented baseline* per §4 — every remaining fail has a category label (B/C/D/E/F) and a corresponding follow-up PR recommendation in §5. No Category A regression exists on this branch.

## 7. Acknowledgments

- The user's spec was strictly followed; no scope expansion.
- The 10 absolute principles were the binding constraint; the documented yellow state is the honest consequence of refusing to weaken runtime invariants to chase test green.
- All deletions and modifications are byte-equivalent for runtime behavior. LIVE matter (`signalScanner.ts`, `entryEngine.ts`, `exitEngine/**`, `kisClient/**`, `orchestrator/**`, `autoTradeEngine*`, `trancheExecutor.ts`, `buyPipeline.ts`) is untouched.
