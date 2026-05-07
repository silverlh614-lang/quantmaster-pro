# ADR-0423 — SectorEnergy indexCode Coverage and Symmetry Validation Repair

**Status:** Adopted (2026-05-07)
**Context:** PR-Sector-Energy-Data-Truth-Repair
**Related ADRs:** ADR-0125 / ADR-0127 / ADR-0370 (sectorEnergy single-label / fallback / sanity bound), ADR-0396 (4-axis sourceTier/freshness/coverage/confidence SSOT), ADR-0397 (Yahoo ETF L4 wiring), ADR-0398 (STRONG_BUY confidence gate), ADR-0399 (KRX source restoration diagnostics meta), ADR-0415 (PARTIAL_VOLUME), ADR-0416~0418 (DATA_UNAVAILABLE semantics + postmortem taxonomy + registry metadata), ADR-0420 (Gate1 fresh attribution), ADR-0422 (Gate2 / NO_LEADERSHIP attribution).
**Boundary:** `server/clients/sectorEnergyQualityDiagnostic.ts` (new SSOT), `server/clients/sectorEnergyProvider.ts` (synthesis wiring), `server/persistence/macroStateRepo.ts` (optional persistence field), `server/trading/marketDataRefresh.ts` (persistence wiring), `server/trading/signalScanner/index.ts` (carry-over), `server/trading/signalScanner/scanDiagnostics.ts` (display), `server/telegram/commands/system/sectorEnergyDiag.cmd.ts` (display).

## Context

ADR-0422 (PR #681) decomposed Gate2 / NO_LEADERSHIP into 9 diagnoses, including `SECTOR_DATA_STALE_DOMINANT` when sector data is the dominant blocker. Operator output looks like:

```
candidates=50, gate1Pass=9, gate2Pass=0
SectorEnergy:
  dataQuality: STALE
  validSectorCount: 11/12
  reason: symmetry validation failed — indexCode missing,
          stock-daily fallback preferred / today indexCode 충실도 0.0%
diagnosis: SECTOR_DATA_STALE_DOMINANT
```

**The single STALE label and free-text `reasons` array do not let an operator decompose the failure**:

- Why is indexCode coverage zero?
- Did symmetry validation actually fail, or did fallback simply trigger?
- Is the running data still trustworthy enough for any leadership signal at all?
- Is the appropriate operator action *Gate2 threshold review* or *sector-data-source repair*?

ADR-0422's `SectorEnergyDiagnostic` exposes only `dataQuality / validSectorCount / expectedSectorCount / reason / indexCodeCoverage / isStale` — the `reason` field is a single string and `indexCodeCoverage` is optional. The provider exposes `SymmetryValidationResult` with `todayCodeFillRatio`, but absolute counts (`todayRowsTotal`, `todayRowsWithIndexCode`) and structured reason categories were not propagated to telegram diagnostics.

Per user-stated invariants: SectorEnergy STALE is **not** true no-leadership. `indexCodeCoverage=0.0%`, symmetry failure, and stock-daily fallback must lower leadership confidence. Gate2 thresholds and scoring policy must not change.

## Decision

Add a SectorEnergy data-truth diagnostic SSOT that classifies *why* the sector data is bad, with an explicit `shouldBlockLeadershipConfidence` boolean. Persist it in macroState. Display it from `/sector_energy_diag` and `/scan_blockers`. **Diagnosis only — no gate threshold, weight, or trading-policy changes.**

### 1. New SSOT module

`server/clients/sectorEnergyQualityDiagnostic.ts`:

- `SectorEnergyQualityReason` 12-value union (OK / INDEX_CODE_MISSING / INDEX_CODE_COVERAGE_ZERO / INDEX_CODE_COVERAGE_LOW / SYMMETRY_VALIDATION_FAILED / VALID_SECTOR_COUNT_LOW / STOCK_DAILY_FALLBACK_USED / ETF_FALLBACK_USED / CACHE_STALE / SOURCE_EMPTY / SCHEMA_MISMATCH / UNKNOWN).
- `SectorEnergyFallbackUsed` 4-value union (NONE / STOCK_DAILY / ETF / CACHE).
- `SectorEnergyQualityDiagnostic` schema (12 fields per spec §B).
- `SECTOR_ENERGY_QUALITY_THRESHOLDS` constants SSOT (do not change): `INDEX_CODE_COVERAGE_LOW_THRESHOLD=0.8`, `VALID_SECTOR_COUNT_LOW_THRESHOLD=9` (ADR-0396 PARTIAL_MIN aligned), `CACHE_STALE_THRESHOLD_MS=4h` (ADR-0396 EXPIRED aligned).
- Helpers: `computeIndexCodeCoverage`, `computeMissingIndexCodeCount`, `shouldBlockLeadershipConfidence`, `buildOperatorMessage`, `evaluateSectorEnergyQualityDiagnostic`, `formatSectorEnergyQualityDiagnosticSection`, `isSectorEnergyQualityDiagnosticDisabled`.

### 2. Decision tree (do not change)

`evaluateSectorEnergyQualityDiagnostic` priority:

1. `totalSectorRows === 0` → `FAILED + SOURCE_EMPTY` (DATA_UNAVAILABLE semantic).
2. `indexCodeCoverage === 0` → `STALE + INDEX_CODE_COVERAGE_ZERO + INDEX_CODE_MISSING` (also attaches symmetry/fallback reasons if present).
3. `indexCodeCoverage < 0.8` → `DEGRADED + INDEX_CODE_COVERAGE_LOW`.
4. `!symmetryValidationPassed` → `STALE + SYMMETRY_VALIDATION_FAILED`.
5. `fallbackUsed !== 'NONE'` → `PARTIAL + STOCK_DAILY/ETF_FALLBACK_USED` or `CACHE_STALE`.
6. `validSectorCount < 9` → `STALE + VALID_SECTOR_COUNT_LOW`.
7. Otherwise → `OK`.
8. `cacheAgeMs > 4h` always attaches `CACHE_STALE` and degrades OK to PARTIAL.

### 3. SymmetryValidationResult extension

`SymmetryValidationResult` gains optional `todayRowsTotal?` + `todayRowsWithIndexCode?` (absolute counts). `validateIndexResponseSymmetry` populates them. Existing callers unchanged (optional fields).

### 4. Provider wiring

`SectorEnergyBuildResult` gains optional `qualityDiagnostic?: SectorEnergyQualityDiagnostic`. `buildSectorEnergyInputsWithMeta` wraps the result with `withQualityDiagnostic()` SSOT — single synthesis entry point so all sourceTier paths produce the same diagnostic schema.

### 5. macroState persistence

`MacroState.sectorEnergyQualityDiagnostic?` optional field added (backwards-compatible). Existing `sectorEnergyDataQuality / sectorEnergyValidSectorCount / sectorEnergyReasons / sectorEnergySourceTier / ...` fields unchanged.

`marketDataRefresh.ts` saves the new field when `meta.qualityDiagnostic` is present.

### 6. Display

- `/sector_energy_diag` → `formatSectorEnergyQualityDiagnosticSection(macro.sectorEnergyQualityDiagnostic)` appended after ADR-0399 source tier attempts.
- `/scan_blockers` → `formatSectorEnergyQualityDiagnosticSection(summary.sectorEnergyQualityDiagnostic)` appended after the ADR-0422 Gate2 section.

Output template (text shortened for telegram):

```
🌐 SectorEnergy 진단 (ADR-0423):
  • dataQuality: STALE
  • validSectorCount: 11/12
  • indexCodeCoverage: 0.0%
  • missingIndexCodeCount: 12/12
  • symmetryValidation: FAILED
  • fallbackUsed: STOCK_DAILY
  • reasons:
    1. INDEX_CODE_COVERAGE_ZERO
    2. INDEX_CODE_MISSING
    3. STOCK_DAILY_FALLBACK_USED
  • leadershipConfidence: BLOCKED
  • operatorAction: sector indexCode mapping/provider cache 점검 우선

  sector indexCode coverage is 0.0%; stock-daily fallback used only for degraded diagnostics.
```

### 7. Gate2 / NO_LEADERSHIP linkage (preserved)

ADR-0422 `buildSectorEnergyDiagnostic` already marks `isStale = true` when `dataQuality ∈ {STALE, DEGRADED, FAILED}`. The new SSOT continues to emit those exact dataQuality values, so the Gate2 diagnosis remains `SECTOR_DATA_STALE_DOMINANT` whenever indexCode coverage / symmetry / valid-sector-count problems are dominant. **No Gate2 threshold or scoring change.**

Operator flow:

```
indexCodeCoverage=0.0% → ADR-0423 dataQuality=STALE
                       → leadershipConfidence=BLOCKED
                       → /scan_blockers diagnosis=SECTOR_DATA_STALE_DOMINANT (ADR-0422)
                       → operatorAction: sector data repair first
                       → Gate2 threshold change: ❌ blocked
```

### 8. ENV rollback

`SECTOR_ENERGY_QUALITY_DIAGNOSTIC_DISABLED=true` (default OFF, exact comparison per ADR-0157) — the provider's `withQualityDiagnostic` returns the input result unchanged, restoring ADR-0125 / ADR-0396 behavior 1:1.

## Key invariants (user-stated)

1. SectorEnergy STALE is not normal data.
2. Hiding indexCode-missing and treating leadership as OK is forbidden.
3. stock-daily fallback is not equivalent to sector-index-based leadership.
4. symmetry validation failure is not a warning — it is a dataQuality reducer.
5. SectorEnergy data-truth repair takes priority over Gate2 threshold relaxation.
6. This PR repairs SectorEnergy data-quality diagnostics and classification only — gate thresholds, weights, scoring formulas, and trading policy are unchanged.

## Out of scope

- No Gate threshold changes.
- No Gate2 criteria relaxation.
- No sectorEnergy scoring formula changes.
- No STRONG_BUY / supply_confluence weight changes.
- No SELL_ONLY / SHADOW_ONLY / autoTradeEngine / order policy changes.
- No KIS / KRX / NAVER / CACHE supply fetcher redesign.
- No investor-flow semantic availability changes.
- No live trading body changes.
- ADR-0419 / ADR-0420 / ADR-0421 / ADR-0422 logic preserved.
- Last-7-days `/gate_audit` counters not reset.
- **Actual sector-index provider/cache repair is a follow-up PR** (TODO §"잔여 후속 PR"). This PR makes the diagnostic correct so the right repair can be planned.

## 잘못된 해결 방법 영구 차단

1. Gate2 threshold relaxation — diagnosis only.
2. STRONG_BUY / supply_confluence weight modifications.
3. Force-promoting stock-daily fallback to OK.
4. Hiding indexCode-missing as a warning.
5. Treating SectorEnergy STALE as true no-leadership (ADR-0422 SECTOR_DATA_STALE_DOMINANT preserved).
6. Mutating the existing `SectorEnergyDataQuality5` union or 4-axis SSOT (ADR-0396).
7. Redefining `SymmetryValidationResult` semantics (only adds optional absolute-count fields).
8. Persisting `qualityDiagnostic` to a new top-level repo (macroState extension is sufficient).

## Verification

- 30 new regression cases in `server/clients/sectorEnergyQualityDiagnosticAdr0423.test.ts`:
  - User §J 9 scenarios (indexCodeCoverage=0 → STALE / symmetry → !OK / fallback → !OK / coverage<0.8 → DEGRADED / clean → OK / totalSectorRows=0 → FAILED / formatter shows ADR-0423 details / SECTOR_DATA_STALE_DOMINANT preserved / STALE not failed).
  - Decision tree branch coverage (CACHE_STALE attach / VALID_SECTOR_COUNT_LOW / YAHOO_ETF / CACHE).
  - Helper SSOT (computeIndexCodeCoverage / computeMissingIndexCodeCount / shouldBlockLeadershipConfidence / buildOperatorMessage / threshold constants / ENV exact comparison).
  - Safety invariants (no placeKisOrder / setGateThreshold / "Gate threshold 완화" / "매수 차단" / weight changes — static grep guards).
  - Wiring static guards (provider withQualityDiagnostic / SymmetryValidationResult new fields / marketDataRefresh persists / signalScanner carries / scanDiagnostics formats / sectorEnergyDiag.cmd shows).
  - fallbackUsed matrix (NONE/STOCK_DAILY/ETF/CACHE).
- Adjacent suites pass with the same 16 pre-existing baseline failures (sectorEnergyProvider time-dependent / krxClient marketClock / krxOpenApi / kisClient queryMarketProgramTrade) — unrelated to this PR (verified via `git stash`).
- tsc client + server: 0 errors on changed files.
- LIVE matching path / KIS quota: unchanged. No call into `kisClient` / `orchestrator` / `autoTradeEngine` bodies.

## Operator effect (post-deploy)

When `/scan_blockers` reports `SECTOR_DATA_STALE_DOMINANT` after this PR, the operator sees a structured ADR-0423 section showing exactly which dimension is broken (`indexCodeCoverage=0.0% + symmetryValidation=FAILED + fallbackUsed=STOCK_DAILY` reasons enumerated). The operator action label is `sector indexCode mapping/provider cache 점검 우선` instead of an ambiguous free-text reason — directing repair effort to data-source provenance rather than Gate2 threshold review.

## Remaining TODO (separate follow-up PRs)

- Repair the actual sector indexCode provider / cache so coverage is no longer zero (KRX index daily endpoint or sectorEnergyMaster mapping).
- KRX sector-index mapping source repair.
- Yahoo ETF fallback wiring re-review (ADR-0397 currently dead code).
- sectorEnergy sourceTier-specific confidence calibration.
