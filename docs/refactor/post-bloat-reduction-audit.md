# Post Bloat Reduction Audit

Date: 2026-05-16

## Purpose

This is a post-application verification report for the code bloat reduction pass. It is not a feature implementation plan. The audit focuses on regression risk, residual bloat, and the next safe reduction targets.

## Commands

```bash
python - <<'PY'
from pathlib import Path
root=Path('server/trading/signalScanner')
for p in sorted(root.rglob('*.ts')):
    loc=sum(1 for _ in p.open(errors='ignore'))
    if loc>1000:
        print(loc,p)
PY

find server/trading/signalScanner -type f -name '*Adr*.ts' -o -name '*Patch*.ts'

rg -n "from ['\"].*<stem>(\.js)?['\"]|import\([^)]*<stem>" . --glob '!node_modules'
```

## Verification 7 — signalScanner residual bloat

## 1,000 LOC 초과 파일 목록

| LOC | File | Import refs | 삭제 가능 여부 | 통합 가능 여부 | Runtime 위험도 | 다음 축소 방향 |
|---:|---|---:|---|---|---|---|
| 2492 | `server/trading/signalScanner/entryFilterDecomposition.ts` | 15 | No | Yes: extract policy/formatter/summary | High | Move duplicated diagnostics into summary/formatter/policy modules; keep runtime contracts stable. |
| 1156 | `server/trading/signalScanner/freshDataSupplyLayerAdr0487.ts` | 12 | No | Yes: split ADR audit/test-only fixtures | Medium | Move duplicated diagnostics into summary/formatter/policy modules; keep runtime contracts stable. |
| 1412 | `server/trading/signalScanner/gate1MinimumSignalForensicAdr0505.test.ts` | 0 | Maybe after coverage review | Yes: split ADR audit/test-only fixtures | Medium | Move duplicated diagnostics into summary/formatter/policy modules; keep runtime contracts stable. |
| 2601 | `server/trading/signalScanner/gate1MinimumSignalForensicAuditAdr0505.ts` | 12 | No | Yes: split ADR audit/test-only fixtures | Medium | Move duplicated diagnostics into summary/formatter/policy modules; keep runtime contracts stable. |
| 1210 | `server/trading/signalScanner/gate1PositiveScoreStarvation.ts` | 16 | No | Yes: split ADR audit/test-only fixtures | Medium | Move duplicated diagnostics into summary/formatter/policy modules; keep runtime contracts stable. |
| 1453 | `server/trading/signalScanner/investorFlowProviderRouterAdr0477.test.ts` | 0 | Maybe after coverage review | Yes: extract policy/formatter/summary | High | Move duplicated diagnostics into summary/formatter/policy modules; keep runtime contracts stable. |
| 2418 | `server/trading/signalScanner/investorFlowProviderRouterAdr0477.ts` | 13 | No | Yes: extract policy/formatter/summary | High | Move duplicated diagnostics into summary/formatter/policy modules; keep runtime contracts stable. |
| 1519 | `server/trading/signalScanner/minimumSignalScoreTrace.ts` | 10 | No | Yes: extract policy/formatter/summary | High | Move duplicated diagnostics into summary/formatter/policy modules; keep runtime contracts stable. |
| 3202 | `server/trading/signalScanner/normalSupplyPreview.ts` | 5 | No | Yes: split ADR audit/test-only fixtures | Medium | Move duplicated diagnostics into summary/formatter/policy modules; keep runtime contracts stable. |
| 2824 | `server/trading/signalScanner/perSymbol/buyListLoop.ts` | 5 | No | Yes: extract policy/formatter/summary | High | Move duplicated diagnostics into summary/formatter/policy modules; keep runtime contracts stable. |
| 4151 | `server/trading/signalScanner/scanDiagnostics.ts` | 66 | No | Yes: extract policy/formatter/summary | High | Move duplicated diagnostics into summary/formatter/policy modules; keep runtime contracts stable. |

## Adr/Patch 이름이 남은 운영 파일 목록

| LOC | File | Import refs | 삭제 가능 여부 | 통합 가능 여부 | Runtime 위험도 | 다음 축소 방향 |
|---:|---|---:|---|---|---|---|
| 353 | `server/trading/signalScanner/freshDataPromotionAuditWiringAdr0494.ts` | 5 | No | Yes | High | Rename/integrate under domain name; keep ADR in docs/tests only. |
| 414 | `server/trading/signalScanner/freshDataSchedulerAdr0492.ts` | 3 | No | Yes | Medium | Rename/integrate under domain name; keep ADR in docs/tests only. |
| 1156 | `server/trading/signalScanner/freshDataSupplyLayerAdr0487.ts` | 12 | No | Yes | High | Rename/integrate under domain name; keep ADR in docs/tests only. |
| 685 | `server/trading/signalScanner/gate1DryRunObservationLedgerAdr0476.ts` | 12 | No | Yes | Medium | Rename/integrate under domain name; keep ADR in docs/tests only. |
| 495 | `server/trading/signalScanner/gate1ForensicInputsCollectorAdr0507.ts` | 5 | No | Yes | Medium | Rename/integrate under domain name; keep ADR in docs/tests only. |
| 2601 | `server/trading/signalScanner/gate1MinimumSignalForensicAuditAdr0505.ts` | 12 | No | Yes | High | Rename/integrate under domain name; keep ADR in docs/tests only. |
| 906 | `server/trading/signalScanner/gate1PositiveSourceWiringAdr0475.ts` | 7 | No | Yes | Medium | Rename/integrate under domain name; keep ADR in docs/tests only. |
| 515 | `server/trading/signalScanner/gate1ScoringAlignmentAdr0472.ts` | 3 | No | Yes | Medium | Rename/integrate under domain name; keep ADR in docs/tests only. |
| 2418 | `server/trading/signalScanner/investorFlowProviderRouterAdr0477.ts` | 13 | No | Yes | High | Rename/integrate under domain name; keep ADR in docs/tests only. |
| 229 | `server/trading/signalScanner/investorFlowSampleAcquisitionAdr0489.ts` | 8 | No | Yes | Medium | Rename/integrate under domain name; keep ADR in docs/tests only. |
| 380 | `server/trading/signalScanner/investorFlowSemanticNetBuyAdr0496.ts` | 5 | No | Yes | Medium | Rename/integrate under domain name; keep ADR in docs/tests only. |
| 100 | `server/trading/signalScanner/investorFlowSnapshotKeyNormalizerAdr0491.ts` | 4 | No | Yes | Medium | Rename/integrate under domain name; keep ADR in docs/tests only. |
| 252 | `server/trading/signalScanner/investorSampleMaterializationAdr0502.ts` | 4 | No | Yes | Medium | Rename/integrate under domain name; keep ADR in docs/tests only. |
| 531 | `server/trading/signalScanner/naverInvestorTrendCollectorAdr0481.ts` | 9 | No | Yes | Medium | Rename/integrate under domain name; keep ADR in docs/tests only. |
| 839 | `server/trading/signalScanner/operatorActionRouterAdr0480.ts` | 20 | No | Yes | High | Rename/integrate under domain name; keep ADR in docs/tests only. |
| 91 | `server/trading/signalScanner/programTradingDataLineAdr0490.ts` | 6 | No | Yes | Medium | Rename/integrate under domain name; keep ADR in docs/tests only. |
| 941 | `server/trading/signalScanner/sectorEnergyMasterSupplyUnknownPolicyAdr0488.ts` | 12 | No | Yes | Medium | Rename/integrate under domain name; keep ADR in docs/tests only. |
| 252 | `server/trading/signalScanner/sectorIndexMasterSeedAdr0495.ts` | 2 | No | Yes | Medium | Rename/integrate under domain name; keep ADR in docs/tests only. |
| 514 | `server/trading/signalScanner/semanticNetBuyNormalizerAdr0482.ts` | 10 | No | Yes | Medium | Rename/integrate under domain name; keep ADR in docs/tests only. |
| 411 | `server/trading/signalScanner/supplyAdvisoryReadinessAdr0485.ts` | 4 | No | Yes | Medium | Rename/integrate under domain name; keep ADR in docs/tests only. |
| 400 | `server/trading/signalScanner/supplyCoverageRecoveryObservationAdr0484.ts` | 5 | No | Yes | Medium | Rename/integrate under domain name; keep ADR in docs/tests only. |
| 643 | `server/trading/signalScanner/supplyRecoveryRuntimeMountAdr0486.ts` | 6 | No | Yes | High | Rename/integrate under domain name; keep ADR in docs/tests only. |
| 723 | `server/trading/signalScanner/supplySnapshotStoreReplayAdr0491.ts` | 13 | No | Yes | Medium | Rename/integrate under domain name; keep ADR in docs/tests only. |
| 231 | `server/trading/signalScanner/supplySourceFreshnessAdr0483.ts` | 4 | No | Yes | Medium | Rename/integrate under domain name; keep ADR in docs/tests only. |
| 742 | `server/trading/signalScanner/unifiedGateScoreKernelAdr0509.ts` | 2 | No | Yes | High | Rename/integrate under domain name; keep ADR in docs/tests only. |

## Import-reference notes for primary next targets

| Target | LOC | Import refs | Deletion assessment | Consolidation assessment | Runtime risk |
|---|---:|---:|---|---|---|
| `server/trading/signalScanner/scanDiagnostics.ts` | 4151 | 66 | Not deletable; central summary/counter contract | Highest-value consolidation target: split counters, summaries, formatters, diagnostic policy | High |
| `server/trading/signalScanner/normalSupplyPreview.ts` | 3202 | 5 | Not deletable; Telegram and runner consume it | Extract display formatters and supply-readiness policy; preserve preview output contract | Medium |
| `server/trading/signalScanner/perSymbol/buyListLoop.ts` | 2824 | 5 | Not deletable; buy-list evaluation entry point | Move repeated trace assembly into summary builders; do not split by tiny mechanical fragments | High |
| `server/trading/signalScanner/entryFilterDecomposition.ts` | 2492 | 15 | Not deletable; many trace types and decompositions imported | Extract supply-provider trace types, confluence formatting, and decomposition policy | High |
| `server/trading/signalScanner/minimumSignalScoreTrace.ts` | 1519 | 10 | Not deletable; used by entry filter, diagnostics, forensic audit, Telegram tests | Extract scoring component taxonomy and formatter while preserving trace shape | High |

## 다음 코드 축소 후보 Top 10

1. `server/trading/signalScanner/scanDiagnostics.ts` — centralize duplicated diagnostic strings/counters into summary + formatter + policy modules.
2. `server/trading/signalScanner/normalSupplyPreview.ts` — move Telegram/display formatting and supply preview policies out of the runtime collector.
3. `server/trading/signalScanner/perSymbol/buyListLoop.ts` — absorb repeated per-symbol diagnostic assembly into shared summary builders.
4. `server/trading/signalScanner/entryFilterDecomposition.ts` — split type contracts, summary construction, and rendering helpers without changing gate semantics.
5. `server/trading/signalScanner/gate1MinimumSignalForensicAuditAdr0505.ts` — rename/integrate ADR implementation into domain module and keep ADR in docs/tests only.
6. `server/trading/signalScanner/investorFlowProviderRouterAdr0477.ts` — extract status normalization and provider-attempt summary; remove ADR name from operational module.
7. `server/trading/signalScanner/minimumSignalScoreTrace.ts` — extract score component taxonomy and trace formatters.
8. `server/trading/signalScanner/gate1PositiveScoreStarvation.ts` — consolidate starvation explanations with minimum-signal score trace summaries.
9. `server/trading/signalScanner/freshDataSupplyLayerAdr0487.ts` — merge promotion/readiness semantics into stable supply-layer names.
10. `server/trading/signalScanner/operatorActionRouterAdr0480.ts` — move ADR-named operational routing to domain naming and separate command formatting from action policy.

## Failures / follow-up findings

- Runtime type SSOT passed.
- Shadow/runtime safety checks passed.
- DataConfidence/DataPromotion separation passed.
- Gate/FinalDecision resolver checks passed.
- Telegram/Alerts strict boundary scan found residual violations, especially alert-side gate recomputation and Telegram/provider direct calls. See `docs/refactor/runtime-safety-verification.md` for file-level findings and fix plan.
- Diagnostic isolation policy passed for P3/P4 non-blocking behavior, but repeated Telegram propagation suppression could not be fully proven from static scan alone.

## Reduction strategy

The next phase should avoid merely splitting large files into more tiny files. The safe reduction pattern is:

1. Extract summary data contracts first.
2. Extract pure formatters second.
3. Extract policy constants/normalizers third.
4. Keep existing runtime entry points stable until tests cover the new seams.
5. Rename ADR/Patch operational modules only after import barrels and tests are in place.

## Test / validation execution results

| Command | Result | Failure file / cause | Core engine impact | Immediate fix plan |
|---|---|---|---|---|
| `npm run lint` | Pass | N/A | None | None |
| `npm run validate:all` | Fail | `server/learning/geminiUtilizationScheduler.test.ts:10` matched `gemini-scheduler-` as an unapproved AI model string in SDS; SDS also reported pre-existing swallowed-catch warnings including `server/trading/signalScanner/scanDiagnostics.ts:3222` | Low direct engine impact from the test temp-prefix false positive; swallowed catches are observability debt | Rename the temp directory prefix or add an SDS-safe marker if supported; separately review swallowed catches and add logging or explicit ignore comments where intentional |
| `npm run build` | Pass with warnings | Vite CSS optimizer warning for `.bg-white/[0.03]`, dynamic/static import chunk warnings, and large chunk warning | No runtime-engine policy impact | Track frontend build/chunk cleanup separately |
| `npm test` | Fail | `package.json` has no `test` script | No engine-code regression signal available from this command | Add/standardize a test script, likely `vitest run`, or update runbook to use the repo's intended test command |

## Failed-test fix plan

1. Fix SDS false positive in `server/learning/geminiUtilizationScheduler.test.ts` by changing the temp directory prefix so it cannot be mistaken for an AI model identifier, or extend the SDS scanner to distinguish temporary file prefixes from model constants.
2. Triage SDS swallowed-catch warnings separately; do not relax the sentinel. Add logging/return/throw or an explicit intentional-ignore marker where the local sentinel policy allows it.
3. Add a repository-level `test` script or document the intended test command so `npm test` becomes meaningful in future verification prompts.
4. Re-run `npm run validate:all` and `npm test` after those changes before starting the large-file diet phase.
