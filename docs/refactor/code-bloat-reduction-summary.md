# Code Bloat Reduction Summary

## Scope

This pass focuses on low-risk post-refactor cleanup rather than feature work:

- Runtime type SSOT cleanup for `EngineMode` and `ExecutionImpact`.
- Shadow type responsibility split with a compatibility re-export.
- Data Promotion audit impact rename to avoid collision with runtime execution policy.
- Gate façade shrinkage in the final-decision contract module.
- signalScanner ADR/Patch inventory report before any risky delete/rename operation.

## Changes

### Runtime type SSOT

- `server/runtime/engineRuntimePolicy.ts` remains the only direct `EngineMode` and runtime `ExecutionImpact` definition.
- Shadow, learning, and per-symbol supply context types now consume runtime `ExecutionImpact` and/or `EngineMode` through imports/re-exports instead of declaring their own same-name types.
- Shadow-only legacy modes (`LIVE`, `PAPER`, `SHADOW`, `HARD_BLOCK`) were removed from shadow type definitions. Shadow runtime cases now use runtime modes such as `SHADOW_ONLY`, `SELL_ONLY`, and `OBSERVE_ONLY`.

### Shadow type split

`server/shadow/shadowTypes.ts` is now a compatibility barrel that re-exports narrower files under `server/shadow/types/`:

- `lifecycle.ts`
- `shadowCase.ts`
- `outcome.ts`
- `promotion.ts`
- `integrity.ts`
- `returnFlow.ts`
- `index.ts`

This keeps existing import paths stable while reducing the responsibility of the original monolithic type file.

### Data Promotion audit impact rename

- `src/types/dataPromotion.types.ts` now exposes `DataPromotionExecutionImpact` for audit-only promotion effects.
- `latestExecutionImpact` uses `DataPromotionExecutionImpact`.
- `DataPromotionAuditResult.executionImpact: 'NONE'` keeps its literal invariant with a comment clarifying that it is not runtime `ExecutionImpact`.

### Per-symbol supply impact alignment

- `server/trading/signalScanner/injectPerSymbolSupplyContext.ts` now imports runtime `ExecutionImpact`.
- Provider stale/degraded/missing cases remain non-executing and report `executionImpact: 'NONE'`, matching the diagnostic-only invariant that provider issues must not become bearish market signals or live execution blockers.

### Gate façade shrinkage

- Replaced the simple `Gate0MacroEvaluator`, `Gate1SurvivalEvaluator`, `Gate2GrowthEvaluator`, and `Gate3TimingEvaluator` wrapper objects with a single `GateName` type plus `asGateResult(gateName, result)` helper.
- `FinalDecisionResolver` behavior remains unchanged.

### signalScanner ADR/Patch report

- Created `docs/refactor/signal-scanner-bloat-report.md`.
- The report inventories signalScanner files matching `*Adr*.ts` and `*Patch*.ts`, including LOC, references/imports, exports, test existence, classification, recommended action, and risk.
- No signalScanner ADR/Patch runtime file was deleted or renamed in this pass.

## Boundary notes

- Trading runtime, DataConfidenceRouter, diagnostic isolation, and FinalDecisionResolver were not bypassed.
- Telegram/Alert boundary cleanup is documented as a follow-up area; this pass does not add provider calls or gate recalculation to Telegram commands.
- Provider adapter consolidation and signalScanner large-file deletion remain deferred until the ADR/Patch inventory is reviewed.

## Verification highlights

- TypeScript lint passed with both app and server tsconfig checks.
- Targeted regression tests for shadow lifecycle, per-symbol supply context, normal supply preview, and data promotion audit passed.
- Production build passed.
- `validate:all` still fails on an existing SDS baseline item (`server/learning/geminiUtilizationScheduler.test.ts` temporary directory prefix flagged as an unapproved AI model string) plus pre-existing swallowed-catch warnings; this pass did not introduce those paths.
