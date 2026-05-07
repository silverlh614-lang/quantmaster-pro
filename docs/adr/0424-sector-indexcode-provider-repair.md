# ADR-0424 — SectorEnergy indexCode Provider/Cache Actual Repair

**Status:** Adopted (2026-05-07)
**Context:** PR-Sector-IndexCode-Provider-Repair
**Related ADRs:** ADR-0125 / ADR-0127 / ADR-0365 (sectorEnergy single-label / fallback / data-dbg base degradation), ADR-0370 (sanity bound + key composite), ADR-0396 (4-axis SSOT), ADR-0397 (Yahoo ETF L4), ADR-0398 (STRONG_BUY confidence gate), ADR-0399 (KRX source restoration meta), ADR-0420 (Gate1 fresh attribution), ADR-0422 (Gate2 / NO_LEADERSHIP attribution), ADR-0423 (SectorEnergy data-truth diagnostic).
**Boundary:** `server/clients/sectorEnergyMaster.ts` (+resolveIndexCodeBySectorName SSOT), `server/clients/sectorEnergyProvider.ts` (+backfillIndexCodes + wire), `server/clients/krxOpenApi.ts` (KrxIndexDailyRow.indexCodeSource? optional), `server/clients/sectorEnergyQualityDiagnostic.ts` (+repairStatus + indexCodeBackfilledCount), `server/persistence/macroStateRepo.ts` (optional fields).

## Context

ADR-0423 made the SectorEnergy failure mode explicit: `freshness=FRESH` + `coverage=91.7%` + `confidence=0.0%` because `sourceTier=STOCK_DAILY` and `indexCodeCoverage=0.0%`. The diagnostic correctly reports `STALE`, but the *actual data path repair* was still pending.

The trace (per the loss-path survey):

```
KRX OpenAPI → mapIndexDailyRow → row.indexCode = toStr(IDX_IND_CD)
                                                  ↓
                              if data-dbg base used → IDX_IND_CD missing
                                                  ↓
                                  row.indexCode = '' (empty string)
                                                  ↓
                  validateIndexResponseSymmetry → todayCodeFillRatio=0% → invalid
                                                  ↓
                              !symmetry.valid → buildStockDailyFallbackResult
                                                  ↓
                              sourceTier=STOCK_DAILY + inputs without indexCode
                                                  ↓
                                  indexCodeCoverage=0.0% (mathematically correct)
                                                  ↓
                                  ADR-0423: dataQuality=STALE + leadership BLOCKED
```

**The actual root cause**: KRX OpenAPI sometimes returns rows with `indexName` populated but `IDX_IND_CD` empty (per ADR-0365 — `data-dbg.krx.co.kr` fallback base). The pipeline then trips into `STOCK_DAILY` synthetic fallback, producing inputs that *cannot* have indexCode by structure, and the diagnostic correctly marks it STALE.

Per user-stated invariants (§"핵심 불변식"): SectorEnergy data path must be repaired, not the gate threshold. STOCK_DAILY fallback must not be promoted to a trusted leadership source. STATIC_MAP-based recovery must be source-tracked at LOW/MEDIUM confidence.

## Decision

Add a **SECTOR_INDEX_MASTER reverse lookup SSOT** and a **`backfillIndexCodes()` step** *before* `validateIndexResponseSymmetry`. When KRX returns `indexName` but no `indexCode`, restore `indexCode` via `sectorEnergyMaster.getSectorByAlias(indexName).krxIndexCode`. Track the recovery as `indexCodeSource='NAME_LOOKUP'` (HIGH confidence — KRX official 1:1 mapping). This *prevents* the STOCK_DAILY fallback from being triggered in the first place, restoring the natural KRX_CODE source tier.

**Diagnosis only — no gate threshold, weight, or trading-policy changes.**

### 1. New SSOT helper

`server/clients/sectorEnergyMaster.ts`:

- `IndexCodeSource` 3-value union: `'RAW' | 'NAME_LOOKUP' | 'STOCK_DAILY_DERIVED'`
- `resolveIndexCodeBySectorName(indexName)` — delegates to existing `getSectorByAlias()`, returns `krxIndexCode` or `null`. Pure function, no external calls.
- `isSectorIndexCodeBackfillDisabled()` — ENV gate `SECTOR_INDEX_CODE_BACKFILL_DISABLED=true` (default OFF, exact comparison per ADR-0157).

### 2. KrxIndexDailyRow schema extension (backwards-compatible)

`KrxIndexDailyRow.indexCodeSource?: 'RAW' | 'NAME_LOOKUP' | 'STOCK_DAILY_DERIVED'` optional field — caller-side default is `'RAW'`.

### 3. `backfillIndexCodes(rows)` SSOT

`server/clients/sectorEnergyProvider.ts`:

```typescript
export function backfillIndexCodes(
  rows: KrxIndexDailyRow[],
): { rows: KrxIndexDailyRow[]; backfilledCount: number };
```

Decision tree (do not change):

1. `isSectorIndexCodeBackfillDisabled()` → return input unchanged (1-line rollback).
2. For each row:
   - Has non-empty `indexCode` → keep (mark `indexCodeSource='RAW'` if absent).
   - Empty `indexCode` + `indexName` matches `SECTOR_INDEX_MASTER` alias → backfill `indexCode` (mark `indexCodeSource='NAME_LOOKUP'`), increment `backfilledCount`.
   - Empty `indexCode` + no alias match → keep empty, caller-side symmetry naturally fails.
3. If `backfilledCount > 0`: `console.warn` ADR-0424 marker (operator can detect KRX data degradation frequency).

### 4. Wiring (entry point)

`buildSectorEnergyInputsWithMetaWithFallback` (line ~682):

```typescript
const todayBackfill = backfillIndexCodes(todayIdx);
const pastBackfill = backfillIndexCodes(pastIdx);
const todayIdxBackfilled = todayBackfill.rows;
const pastIdxBackfilled = pastBackfill.rows;
const totalBackfilledCount = todayBackfill.backfilledCount + pastBackfill.backfilledCount;

const symmetryRaw = validateIndexResponseSymmetry(todayIdxBackfilled, pastIdxBackfilled);
const symmetry = totalBackfilledCount > 0
  ? { ...symmetryRaw, backfilledCount: totalBackfilledCount }
  : symmetryRaw;
```

Downstream `aggregateIndexDeltas(...)` calls also use the backfilled rows so KRX_CODE matching benefits.

### 5. SymmetryValidationResult extension (backwards-compatible)

`SymmetryValidationResult.backfilledCount?: number` optional field. Populated when `backfillIndexCodes` recovered 1+ rows.

### 6. SectorEnergyQualityDiagnostic extension

`SectorEnergyQualityDiagnostic` adds two optional fields (backwards-compatible):

- `indexCodeBackfilledCount?: number` — how many rows were name-lookup recovered.
- `repairStatus?: 'RECOVERED' | 'PARTIAL' | 'STILL_STALE' | 'NOT_NEEDED'`.

`classifyRepairStatus(dataQuality, indexCodeCoverage, symmetryValidationPassed, fallbackUsed, indexCodeBackfilledCount)` SSOT decision tree:

1. `fallback=NONE + dataQuality=OK + backfilled=0` → **NOT_NEEDED** (normal state).
2. `fallback=NONE + symmetry pass + coverage>=0.8 + backfilled>0` → **RECOVERED** (KRX path restored via backfill).
3. `coverage>0 + (fallback != NONE OR !symmetry)` → **PARTIAL**.
4. Otherwise → **STILL_STALE** (provider body repair still needed).

**Critical invariant** (user §H): `fallbackUsed != 'NONE'` → `repairStatus` cannot be `'RECOVERED'`. STATIC_MAP / NAME_LOOKUP backfill never promotes STOCK_DAILY/ETF/CACHE fallback to trusted leadership.

### 7. macroState persistence

`MacroState.sectorEnergyQualityDiagnostic` schema gains optional `indexCodeBackfilledCount?` and `repairStatus?` fields (backwards-compatible).

### 8. /scan_blockers + /sector_energy_diag display

`formatSectorEnergyQualityDiagnosticSection()` adds:

- `• indexCodeBackfilledCount: N (NAME_LOOKUP via SECTOR_INDEX_MASTER)` if > 0
- `• repairStatus: RECOVERED | PARTIAL | STILL_STALE | NOT_NEEDED`
- Operator action label adapted to repair status:
  - BLOCKED → "sector indexCode mapping/provider cache 점검 우선"
  - RECOVERED → "KRX 본체 정상 — backfill 로 복구 (ADR-0424). 데이터 결손 빈도 모니터링."
  - NOT_NEEDED → "none — sector-index leadership 정상."

### 9. Gate2 / NO_LEADERSHIP linkage (preserved)

ADR-0422 `buildSectorEnergyDiagnostic.isStale` continues to reflect `dataQuality ∈ {STALE, DEGRADED, FAILED}`. After successful backfill (`repairStatus='RECOVERED'`), `dataQuality='OK'`, `isStale=false` → `SECTOR_DATA_STALE_DOMINANT` no longer fires. Operator can then see the *actual* Gate2 bottleneck.

**Gate2 thresholds and scoring policy unchanged.** ADR-0419/0420/0421/0422 untouched.

### 10. ENV rollback

`SECTOR_INDEX_CODE_BACKFILL_DISABLED=true` (default OFF, exact comparison) — `backfillIndexCodes` returns the input unchanged, restoring ADR-0423 behavior 1:1.

## Key invariants (user-stated)

1. `indexCodeCoverage=0.0%` is never silently flipped to OK/PARTIAL.
2. STOCK_DAILY fallback is never promoted to a trusted sector-index leadership source (`repairStatus='RECOVERED'` requires `fallbackUsed='NONE'`).
3. SectorEnergy STALE is not true no-leadership.
4. Provider/cache/schema/mapping problems are separated from real sector leadership absence (`STILL_STALE` vs Gate2 TRUE_NO_LEADERSHIP).
5. Sector indexCode provider/cache repair takes priority over Gate2 threshold relaxation.
6. Gate threshold / weight / scoring formula / trading policy unchanged.

## Out of scope

- No Gate threshold / Gate2 criteria / sectorEnergy scoring formula / STRONG_BUY / supply_confluence weight changes.
- No SELL_ONLY / SHADOW_ONLY / autoTradeEngine / KIS order policy changes.
- No KIS / KRX / NAVER / CACHE supply fetcher redesign.
- No investor-flow semantic availability changes (ADR-0421 preserved).
- ADR-0419 / ADR-0420 / ADR-0421 / ADR-0422 / ADR-0423 logic preserved.
- Last-7-days `/gate_audit` counters not reset.
- **No new external API calls** — backfill uses pure SECTOR_INDEX_MASTER lookup; `aggregateIndexDeltas` continues to use the same KRX endpoint.
- **No cache schema bump or destructive cache clear** (per user §I "무조건 cache 삭제 금지"). The provider has no separate persisted indexCode cache — `aggregateIndexDeltas` rebuilds per call.
- Yahoo ETF L4 wiring re-review (ADR-0397 dead-code path) — separate follow-up.
- KRX official primary endpoint stabilization (data-dbg fallback root cause investigation) — separate follow-up.

## 잘못된 해결 방법 영구 차단

1. Gate2 threshold relaxation — diagnosis only.
2. Promoting STOCK_DAILY/ETF/CACHE to `repairStatus='RECOVERED'` (`classifyRepairStatus` SSOT enforces `fallbackUsed='NONE'` requirement).
3. Treating SectorEnergy STALE as true no-leadership.
4. Mutating `SectorEnergyDataQuality5` union or 4-axis SSOT (ADR-0396).
5. Hard-coding sector-name → indexCode tables outside `SECTOR_INDEX_MASTER` (single SSOT enforced).
6. Modifying `aggregateIndexDeltas` matching logic.
7. Destructive cache clear without operator confirmation (per user §I).
8. Increasing external API call rate for unbounded probe (per user "절대 하지 말 것" #13).

## Verification

- 37 new regression cases in `server/clients/sectorEnergyProviderAdr0424.test.ts`:
  - User §J 11 scenarios (provider row with indexCode → coverage > 0 / backfill preserves indexCode + NAME_LOOKUP source / STOCK_DAILY fallback never OK / validSectorCount=11 + coverage=0 → STALE / symmetry counts indexCode field correctly / coverage>=0.8 + symmetry pass + fallback NONE → OK / cache fresh + coverage=0 → not OK / sourceTier priority — backfill avoids STOCK_DAILY / formatter shows ADR-0424 block / repaired state reflected in /scan_blockers / regression safety).
  - SECTOR_INDEX_MASTER reverse lookup SSOT (alias matching / null-safe / ENV exact comparison).
  - `backfillIndexCodes` decision tree (empty input / all filled / partial backfill / ENV disabled / symmetry attaches backfilledCount).
  - `classifyRepairStatus` SSOT (NOT_NEEDED / RECOVERED / PARTIAL / STILL_STALE / fallback never RECOVERED).
  - Wiring static guards (provider entry-point order / aggregateIndexDeltas uses backfilled rows / SymmetryValidationResult.backfilledCount field / SectorEnergyQualityDiagnostic fields / macroState schema / formatter).
  - Safety invariant (STOCK_DAILY/ETF/CACHE never RECOVERED).
  - User operating scenario: Before (sourceTier=STOCK_DAILY + coverage=0 + STALE → STILL_STALE + BLOCKED) vs After (backfill → KRX_CODE + coverage=1 + symmetry pass → RECOVERED + leadership OK).
- Adjacent suites: 5 pre-existing baseline failures in `sectorEnergyProvider.test.ts` (자릿수 격차) verified via `git stash` to be unrelated to this PR.
- tsc client + server: 0 errors on changed files.
- LIVE matching path / KIS quota: unchanged. No call into `kisClient` / `orchestrator` / `autoTradeEngine` bodies. No new external API calls.

## Operator effect (post-deploy)

For each daily `marketDataRefresh` cycle:

1. KRX returns rows possibly with empty `IDX_IND_CD`.
2. `backfillIndexCodes` recovers them via `SECTOR_INDEX_MASTER.getSectorByAlias(indexName)`.
3. `validateIndexResponseSymmetry` now passes (rows have `indexCode`).
4. STOCK_DAILY fallback no longer triggers; `sourceTier='KRX_CODE'`.
5. `indexCodeCoverage` recovers from 0% to 100% (or close).
6. `dataQuality='OK'`, `confidence>0`, `repairStatus='RECOVERED'`.
7. `/scan_blockers` Gate2 diagnosis is no longer forced to `SECTOR_DATA_STALE_DOMINANT` — operator can see the actual bottleneck (`TRUE_NO_LEADERSHIP` / `MIXED` / etc.).

If `backfillIndexCodes` cannot match (`indexName` is not in any alias), the row stays empty and downstream falls into `STILL_STALE` — operator action label points to provider/cache repair (a deeper KRX issue) rather than gate threshold change.

## Remaining TODO (separate follow-up PRs)

- **Yahoo ETF fallback wiring precision** — `sectorEnergyFallbackProvider` (ADR-0397 Phase 1) is dead code; if KRX endpoint deteriorates further, ETF tier can be activated with explicit `indexCodeSource='STOCK_DAILY_DERIVED'` LOW confidence.
- **KRX sector-index provider stabilization** — primary base URL vs `data-dbg` fallback root-cause investigation (out of repository scope; KRX OpenAPI side).
- **Sector index mapping static cache management policy** — if the alias coverage in `SECTOR_INDEX_MASTER` becomes stale relative to KRX's actual sector universe, operator-driven update flow.
- **Gate Decision Router hard-block / soft-degrade separation ADR** — when `repairStatus='STILL_STALE'`, gate decisions should clearly distinguish hard block vs soft degrade.
