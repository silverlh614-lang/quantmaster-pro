# Swallowed Catch Triage — validation pipeline normalization

Date: 2026-05-16

## Scope

This triage covers the 18 swallowed-catch warnings reported by `npm run validate:all` through `validate:sds` before the normalization patch.

Principles applied:

- Production catch blocks must not remain silently empty.
- No catch was covered with an eslint disable.
- Provider errors remain provider diagnostics; they were not converted into market signals.
- Diagnostic-only paths keep `executionImpact=NONE` where applicable.
- Trading Engine runtime, Shadow Learning routing, DataConfidenceRouter, and FinalDecisionResolver policies were not changed.

## Classification key

- **A. Log/telemetry required** — add an explicit log/debug signal.
- **B. Intentional ignore with reason** — explicitly document best-effort behavior or expected test capture.
- **C. Fallback/diagnostic counter** — error is converted into a returned/persisted diagnostic, counter, sample, or provider health record.
- **D. Test helper harmless** — test intentionally catches an expected exception for assertions.

## Findings and disposition

| File | Original line | Class | Resolution |
| --- | ---: | --- | --- |
| `server/clients/kisWebSocketSubscriptionManager.ts` | 531 | B | Added explicit SDS reason: non-core subscribe failures roll back the local subscription entry; core watchlist failures are already logged. |
| `server/clients/kisWebSocketSubscriptionManager.ts` | 580 | A | Added `console.debug` for best-effort unsubscribe failure during slot eviction with `executionImpact=NONE`; buy flow remains unblocked. |
| `server/clients/sectorEnergyFallbackProvider.ts` | 115 | C | Added explicit SDS reason: per-sector ETF fallback errors are returned through `skippedReasons`. |
| `server/dataQuality/productionMasterGuard.test.ts` | 76 | D | Added explicit SDS reason: test captures expected fatal guard error to assert operator formatting. |
| `server/learning/counterfactualShadowLearningPerformanceReport.ts` | 450 | C | Added explicit SDS reason: price-provider errors become read-only point diagnostics with `executionImpact=NONE`. |
| `server/learning/missedLearningQueue.ts` | 239 | C | Added explicit SDS reason: replay failures are persisted on the queue job `failureReason`. |
| `server/learning/provisionalShadowPerformanceReport.ts` | 290 | C | Added explicit SDS reason: price-provider errors become read-only point diagnostics with `executionImpact=NONE`. |
| `server/learning/shadowFutureReturnWarmupPlanner.ts` | 157 | C | Added explicit SDS reason: warmup fetch failures increment `stats.failed` and sample failures. |
| `server/persistence/positionTruth.ts` | 137 | C | Added explicit SDS reason: aggregate-position failures become `detectError` diagnostics and do not alter runtime policy. |
| `server/scheduler/investorFlowWarmupJob.ts` | 112 | C | Added explicit SDS reason: warmup item failures increment `summary.failed` and sample diagnostics. |
| `server/supply/investorFlowRouter.ts` | 576 | C | Added explicit SDS reason: KIS provider errors become `ProviderHealth UNKNOWN_ERROR` diagnostics, not market signals. |
| `server/supply/investorFlowRouter.ts` | 643 | C | Added explicit SDS reason: KRX provider errors become provider health status/reason and attempt diagnostics. |
| `server/supply/investorFlowRouter.ts` | 699 | C | Added explicit SDS reason: NAVER provider errors become `ProviderHealth UNKNOWN_ERROR` diagnostics, not market signals. |
| `server/supply/investorFlowRouter.ts` | 754 | C | Added explicit SDS reason: cache fallback errors become `ProviderHealth UNKNOWN_ERROR` diagnostics. |
| `server/telegram/commands/system/healthFull.cmd.ts` | 62 | C | Added explicit SDS reason: command section failure is surfaced inline in the operator health report. |
| `server/trading/preOrderGuard.test.ts` | 239 | D | Added explicit SDS reason: test captures expected `PreOrderGuardError` for reason assertion. |
| `server/trading/preOrderGuard.test.ts` | 269 | D | Added explicit SDS reason: test captures expected `PreOrderGuardError` for reason assertion. |
| `server/trading/signalScanner/scanDiagnostics.ts` | 3222 | C | Added explicit SDS reason: KRX parser probe errors become diagnostic-only metadata with `executionImpact=NONE`. |

## Result

`node scripts/silent_degradation_sentinel.js` now reports `SDS OK` with no unapproved model-string failure and no swallowed-catch warning.
