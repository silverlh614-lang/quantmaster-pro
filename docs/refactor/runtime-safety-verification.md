# Runtime Safety Verification — Post Bloat Reduction

Date: 2026-05-16

## Scope

This report verifies runtime safety invariants after the code bloat reduction pass. It intentionally does not add new features or relax engine policy.

## Commands

```bash
rg -n "SHADOW_ONLY|SELL_ONLY|executionImpact|shadowAllowed|learningAllowed" server src --glob '!node_modules'
rg -n "DataConfidenceRouter|AI_ESTIMATED|AI_ESTIMATE|ACCEPTED_EMPTY|EMPTY_VALID|NO_OUTPUT|ProviderIssue|MarketSignal|marketSignal" server src --glob '!node_modules'
rg -n "FinalDecisionResolver|GateResult|gateName|EnemyChecklist|STRONG_BUY" server src --glob '!node_modules'
rg -n "FinalDecisionResolver|resolveFinalDecision|evaluateServerGate|evaluate.*Gate|provider|fetch|engineMode|marketSignal" server/telegram server/alerts --glob '*.ts'
rg -n "diagnosticSuppressed|P3_SCAN_DIAGNOSTIC|P4_TELEMETRY_VERBOSE|DIAGNOSTIC_BUDGET_EXCEEDED|executionImpact=NONE" server/diagnostics server/telegram server/alerts server/runtime --glob '*.ts'
```

## Verification 2 — Shadow path preservation

| Check | Evidence | Status |
|---|---|---|
| `server/shadow/shadowTypes.ts` is a re-export file | It contains only backward-compatible type exports from `./types/index.js` | Pass |
| `server/shadow/types/index.ts` exports required Shadow types | It exports runtime `EngineMode`/`ExecutionImpact`, lifecycle, data health, provider health, `ShadowCase`, outcome, integrity, return-flow, and promotion types | Pass |
| `ShadowCase` uses runtime mode/impact types | `server/shadow/types/shadowCase.ts` imports both from `../../runtime/engineRuntimePolicy.js` | Pass |
| `SHADOW_ONLY` execution impact | `resolveEngineRuntimePolicy` returns `executionImpact: 'NONE'` for `SHADOW_ONLY` | Pass |
| `SELL_ONLY` shadow learning | `resolveEngineRuntimePolicy` returns `shadowAllowed: true` and `learningAllowed: true` through `LearningPolicy.resolve()` | Pass |
| Regression coverage | `server/runtime/engineBoundaryRefactor.test.ts` asserts SELL_ONLY learning availability and SHADOW_ONLY `executionImpact='NONE'` | Pass |

Risk classification: no Shadow Learning interruption found.

## Verification 3 — DataConfidence / DataPromotion separation

| Check | Evidence | Status |
|---|---|---|
| `AI_ESTIMATED` is not promoted to CORE | `normalizeDataSignal` caps `AI_ESTIMATED` promotion stage to `ADVISORY` and `canUseDataSignalInCore` only accepts `VERIFIED` + `CORE` | Pass |
| DataPromotion impact name collision | `src/types/dataPromotion.types.ts` defines `DataPromotionExecutionImpact`, avoiding runtime `ExecutionImpact` shadowing | Pass |
| Empty statuses not bearish | `ACCEPTED_EMPTY`, `EMPTY_VALID`, and `NO_OUTPUT` are normalized as `providerIssue=false`, `marketSignal=false`, reason `EMPTY_VALID_NOT_BEARISH` | Pass |
| ProviderIssue / MarketSignal separation | Provider error statuses return `providerIssue=true`, `marketSignal=false`, `executionImpact='NONE'`; market signal remains a separate field | Pass |
| Regression coverage | `server/runtime/engineBoundaryRefactor.test.ts` covers provider 500 separation and accepted-empty non-bearish behavior | Pass |

## Verification 4 — Gate / FinalDecision path

| Check | Evidence | Status |
|---|---|---|
| Single final-decision entry point | `server/trading/gates/finalDecisionResolver.ts` owns `FinalDecisionResolver.resolve` and `resolveFinalDecision` wrapper | Pass |
| Gate0~Gate3 structure | `GateResult` includes `gateName`, `passed`, score, confidence, blockers, warnings, and evidence | Pass |
| Gate wrapper gateName preservation | `asGateResult(gateName, result)` returns `{ ...result, gateName }` | Pass |
| EnemyChecklist downgrade | `FinalDecisionResolver.resolve` downgrades `STRONG_BUY` to `BUY` when `enemyWarningCount >= 2` and appends `ENEMY_CHECKLIST_STRONG_BUY_DOWNGRADE` | Pass |
| Regression coverage | `server/runtime/engineBoundaryRefactor.test.ts` asserts Gate1 HOLD and EnemyChecklist STRONG_BUY downgrade | Pass |

## Verification 5 — Telegram / Alerts boundary

### Strict forbidden-pattern findings

The strict scan found existing command/report paths that still violate the requested boundary. These are not new features from this verification pass; they are residual bloat/boundary debt that should be removed or converted to snapshot/summary reads.

| Pattern | File / lines from scan | Runtime risk | Fix direction |
|---|---|---:|---|
| Alert report calls gate evaluator | `server/alerts/reportGenerator.ts:31`, `server/alerts/reportGenerator.ts:556` imports/calls `evaluateServerGate` | High | Replace alert-side gate evaluation with precomputed `DecisionSnapshot` or gate summary projection |
| Telegram diagnostic command calls gate evaluator | `server/telegram/commands/system/sectorEnergyDiag.cmd.ts:17`, `server/telegram/commands/system/sectorEnergyDiag.cmd.ts:347` imports/calls `evaluateSectorEnergyStrongBuyGate` | Medium | Move evaluator execution to runtime diagnostic snapshot generation; Telegram command should display the stored summary only |
| Telegram watchlist command calls KIS provider | `server/telegram/commands/watchlist/add.cmd.ts:4`, `:29`, `:37` imports/calls `fetchCurrentPrice` and `fetchStockName` | Medium | Use cached symbol master / provider-health summary; avoid live provider calls from command handlers |
| Telegram program-market command calls KIS/KRX provider/router | `server/telegram/commands/system/programMarket.cmd.ts:7-10`, `:53` | High | Replace with latest supply snapshot / provider-health summary; keep live probing in scheduler/diagnostic layer |
| Telegram learning circuit commands touch provider clients | `server/telegram/commands/learning/circuits.cmd.ts:3-4`, `server/telegram/commands/learning/resetCircuits.cmd.ts:3-4` | Medium | Convert to provider health status/reset service with explicit operator-action boundary, or remove from Telegram command layer |
| Alert generators fetch providers directly | `server/alerts/reportGenerator.ts`, `server/alerts/preMarketSignal.ts`, `server/alerts/weeklyDeepAnalysis.ts`, `server/alerts/stockPickReporter.ts`, `server/alerts/positionMorningCard.ts` | Medium/High | Prefer DecisionSnapshot, ProviderHealthSummary, and stored quote snapshots; alert formatters should not own provider acquisition |
| Alert report recomputes derived market/gate content | `server/alerts/reportGenerator.ts` calls Yahoo/KIS/fetchCloses and evaluates gates | High | Split acquisition/evaluation from formatting; report should render already-computed summaries |
| Telegram command sets `marketSignal` from live program amount | `server/telegram/commands/system/programMarket.cmd.ts:174` | Medium | Use router-normalized snapshot field; command should not decide market signal |
| Telegram program-today command derives `marketSignal` from displayed data | `server/telegram/commands/system/programToday.cmd.ts:120` | Low/Medium | Use normalized summary field from supply policy/router |

### Allowed-pattern findings

Snapshot/status commands already show the intended pattern in several places: `snapshotLatest`, `snapshotStatus`, `scanBlockers`, `supplyHealth`, and `normalSupplyPreview` mostly render existing summaries and expose `executionImpact=NONE`/`providerCalls=0` markers. These should be the consolidation targets for command formatter reuse.

## Verification 6 — Diagnostic isolation

| Check | Evidence | Status |
|---|---|---|
| `P3_SCAN_DIAGNOSTIC` budget exceeded is non-blocking | `classifyDiagnosticIsolation` returns `blocking=false`, `dataVacuum=false`, `executionImpact='NONE'` for P3/P4 phases | Pass |
| `P4_TELEMETRY_VERBOSE` failure is not data vacuum | P4 is in `NON_BLOCKING_DIAGNOSTIC_PHASES`; all non-blocking diagnostic phases return `dataVacuum=false` | Pass |
| `diagnosticSuppressed=true` summary folding | Policy exposes `diagnosticSuppressed`, and runtime regression covers P3 budget overflow; no centralized Telegram propagation limiter was found in this pass | Partial / follow-up |
| `executionImpact=NONE` diagnostic repeated to Telegram | Many Telegram/alert lines intentionally display `executionImpact=NONE`; no repeated diagnostic suppression policy could be proven from static scan alone | Partial / follow-up |

## Fix plan for safety findings

1. Convert `server/alerts/reportGenerator.ts` from provider/gate recomputation to rendering precomputed `DecisionSnapshot` and gate-summary objects.
2. Convert `server/telegram/commands/system/programMarket.cmd.ts` to a read-only view of the latest supply/provider-health snapshot.
3. Convert `server/telegram/commands/system/sectorEnergyDiag.cmd.ts` to display the stored sector-energy diagnostic summary instead of calling the strong-buy gate evaluator.
4. Move provider calls from Telegram watchlist/learning commands behind non-Telegram services with explicit operator-action policies, or replace them with cached summaries.
5. Add a small static boundary guard that fails on `evaluate*Gate`, `resolveFinalDecision`, and provider-client imports under `server/telegram/**/*.ts` and formatter-only alert modules after the cleanup lands.
