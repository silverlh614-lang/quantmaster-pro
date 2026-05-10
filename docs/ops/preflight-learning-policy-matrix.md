# Preflight Learning Policy Matrix — PATCH-0183

@responsibility Preflight abort 상황별 Shadow Learning / Universe Snapshot / scan persist 정책 SSOT.

## Purpose

This note documents how `runPreflight()` should behave when live entry is blocked before the normal buy-list loop.

The goal is to make blocked scans explainable without changing live trading behavior.

Core principle:

```text
Real execution may be blocked.
Shadow Learning should continue.
Universe context should be preserved where candidate construction or buy-list entry is skipped.
executionImpact must remain NONE for learning-only records.
```

## Definitions

### ShadowLearningOnlySignal

Per-symbol hypothetical learning signal created by `recordBlockedDayShadowScan(...)` / `runShadowLearningOnlyScan(...)`.

It answers:

```text
If real entry had not been blocked, would this symbol have been considered?
```

Required invariants:

- `learningOnly=true`
- `executionImpact='NONE'`
- `allowRealOrder=false`
- no KIS/order path import or invocation

### CounterfactualUniverseLearningSnapshot

Universe-level learning snapshot created by `recordPreflightUniverseLearningSnapshot(...)`.

It answers:

```text
Why did the scan fail before or around universe/candidate/buy-list construction?
What candidate pool existed at the moment of block?
```

### scan persist / skipPersist

`skipPersist` controls normal scan result persistence only.

It must not be interpreted as disabling Shadow Learning or Universe Learning.

```text
skipPersist=true
  = normal scan summary/result persistence may be skipped.
  = ShadowLearningOnlySignal and CounterfactualUniverseLearningSnapshot may still be recorded.

skipPersist=false
  = an abort or partial diagnostic result may still be persisted for operator visibility.
```

## Current policy matrix

| Preflight block | ShadowLearningOnlySignal | Universe Snapshot | Current scan persist | Notes |
|---|---:|---:|---:|---|
| `KIS_CONFIG_MISSING` | YES | YES | `skipPersist=false` | Real order impossible; learning case retained. |
| `WATCHLIST_EMPTY` | YES | YES | `skipPersist=false` | Universe size is 0; still records empty-universe context. |
| `R3_SANITY_BLOCK` | YES | YES | `skipPersist=true` | HARD_BLOCK/latch semantics preserved; learning still records. |
| `SELL_ONLY` / `MANUAL_BLOCK` | YES | YES | `skipPersist=true` | Real entry blocked; existing positions still managed. |
| `RISK_OFF_REGIME` / `R6_DEFENSE` | YES | YES | `skipPersist=true` | Market risk block; not a provider/data issue. |
| `VIX_SPIKE` | YES | YES | `skipPersist=true` | Volatility entry block. |
| `FOMC_BLOCK` | YES | YES | `skipPersist=true` | Event-risk entry block. |
| `DATA_STARVED` | YES | YES | `skipPersist=true` | Data absence is not bearish market signal. |
| `POSITION_FULL` | YES | YES | `skipPersist=true`, `positionFull=true` | Candidate quality may be good, but capacity is full. |
| `VOLUME_CLOCK_BLOCK` | YES | PARTIAL / TODO | `skipPersist=false` with diagnosticData | Existing diagnosticData is preserved; universe snapshot should be considered in a follow-up patch. |

## Reserved / low-frequency reasons

These reasons are accepted by `ShadowLearningOnlyScanReason`, but are not all direct `preflight.ts` early-return sites yet:

- `LIQUIDITY_BLOCK`
- `KRX_HOLIDAY_REPLAY`
- `R1_DEFENSIVE`
- `R0_CRISIS`
- `SECTOR_ENERGY_STALE`
- `SUPPLY_DATA_UNSTABLE`

They must remain learning-only unless a separate patch defines a concrete production block site.

They must not be used to silently change live Gate, Kelly, order, `STRONG_BUY`, `sectorBoost`, or `supplyBoost` behavior.

## Guardrails

- Provider/data absence is not market weakness.
- `UNKNOWN` remains `UNKNOWN`.
- `null` is not converted to zero.
- `NET_SELL` diagnostics are not live sell signals.
- Shadow Learning failure must be try/catch isolated and must not change preflight decision flow.
- Universe snapshot failure must be try/catch isolated and must not change preflight decision flow.
- New data/reason wiring must follow data-promotion discipline and must not jump to CORE.

## Next safe follow-ups

1. Add Universe Snapshot for `VOLUME_CLOCK_BLOCK` if operator output needs full universe context.
2. Add `/scan_blockers` top-level Learning Status summary:

```text
Real execution: BLOCKED
Shadow learning: RECORDED
Universe snapshot: RECORDED/PARTIAL/NONE
executionImpact: NONE
topBlockedReason: <reason>
```

3. Build blocked-reason outcome reporting from `futureReturn1d/3d/5d/20d`.
