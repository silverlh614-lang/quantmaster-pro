# 10 · Patch History Index (Compact Router)

**Read this file only when working on:**
- finding the identifier/date for a past ADR or patch
- deciding which archive file to keyword-search next
- adding the single required patch-history row for the current PR

**Do not read this file for:**
- current execution rules → `CLAUDE.md` / `AGENTS.md`
- current domain policy → `docs/ai/00`~`09`
- verbose patch bodies → `docs/archive/adr/patch-history-full-log.md` or the archive buckets below

> This file is a router, not a changelog. Keep it small enough to load safely in agent context.

---

## Size Rule

Hard cap: keep this file below 20KB. If it approaches the cap, move older hot rows to an archive bucket and leave one bucket pointer here.

New row format:

`- YYYY-MM-DD · <ADR/Patch/PR id> · <3-6 search tags>`

Rules:
- One physical line per PR.
- No long parentheses, test logs, Telegram text, root-cause essays, or file lists here.
- Put details in PR text, ADR file, or `docs/archive/adr/patch-history-full-log.md`.
- If a day has many patches, keep only the latest/high-risk IDs in **Hot Index** and archive the rest by month.
- Search flow: this file → bucket/full-log with `rg "<id>|<keyword>"`.

---

## Core ADR Map

| ID | Domain | Current use | Detail |
|----|--------|-------------|--------|
| ADR-527 | AI context | CLAUDE slimming | `docs/archive/adr/patch-history-full-log.md` |
| ADR-528 | AI docs router | `docs/ai/00`~`10` boundaries | `docs/archive/adr/patch-history-full-log.md` |
| ADR-528-B | Multi-agent rules | `AGENTS.md` creation | `docs/archive/adr/patch-history-full-log.md` |
| ADR-529 | Patch history archive | split verbose history from router | `docs/archive/adr/patch-history-full-log.md` |
| ADR-530 | Patch Scope Guard | required patch plan fields | `docs/ai/09-refactor-rules.md` |
| ADR-531 | warning taxonomy | severity/display classification | `docs/archive/adr/adr-531-warning-error-taxonomy.md` |
| ADR-532 | Telegram noise | CH routing and user-facing filters | `docs/archive/adr/adr-532-telegram-noise-reduction.md` |
| ADR-533 | no-regression guard | typecheck/test baseline rules | `docs/archive/adr/adr-533-typecheck-baseline-no-regression.md` |
| ADR-534 | baseline burn-down | classify existing failures | `docs/archive/adr/adr-534-baseline-failure-burndown.md` |
| ADR-535 | test fixtures | canonical mock/schema alignment | `docs/archive/adr/adr-535-test-fixture-schema-alignment.md` |
| ADR-541 | docs/validation | archive lookup only | `docs/archive/adr/patch-history-full-log.md` |
| ADR-542 | docs/validation | archive lookup only | `docs/archive/adr/patch-history-full-log.md` |

---

## Hot Index

Append the current PR row here. When this list grows past roughly 60 rows, move older rows to an archive bucket.

- 2026-05-26 · Patch-SECTOR-ENERGY-CANONICAL-COUNT-SOURCE-PERKEY-ADR0534-001 · sector-energy, deriveSectorEnergyCanonicalState, per-sector-verificationResults→resolveOfficialSectorEnergyCoverage, alias-map-code+name-match, verifiedOfficialSectorKeys/missingOfficialSectorKeys-real(CONSUMER_RETAIL-no-longer-false-missing), count-follows-safe-official(11/11=100%)-not-officialTarget(73.3%→8), supersedes-RENDERER-OVERRIDE-count-source, alias-add(유통 소비재/KRX 방송통신/KRX 미디어&엔터테인먼트), assertSectorEnergyCoverageInvariants(CONSUMER_RETAIL/FOOD_BEVERAGE_TOBACCO/SERVICE_TELECOM), value-quality-diagnosticOnly-not-count-gate, promotionAllowed-byte-equivalent-to-master, executionImpact-NONE
- 2026-05-26 · Patch-SECTOR-ENERGY-RENDERER-OVERRIDE-LEGACY-KILL-ADR0534-001 · sector-energy, applySectorEnergyCanonicalOverride, canonical-derived-from-officialTarget-coverage(73.3%→8/11→FALSE)-not-safeOfficial-100%, master+recovery-override-at-hub, candidate-pool/Gate2/Telegram/ADR-0488-pass-through, legacy*DiagnosticOnly, safeOfficialPromotionAllowedDiagnosticOnly-relabel, leadershipConfidence-canonical-map, no-rendered-promotionAllowed-true-when-canonical-false, executionImpact-NONE
- 2026-05-26 · ADR-0534 · sector-energy, SectorEnergyCanonicalResolver, SectorEnergyCanonicalState, OFFICIAL_SECTOR_ENERGY_11, promotionCoverage=verified/11, requiredPromotionCoverage-0.8, OFFICIAL_KIS→KRX→NONE, theme-tag-only(조선/방산/원자력/이차전지), KIS-basket/grouped/old-12-15-coverage-diagnosticOnly, ADR-0488-carry, TopBlocks-single-source, enforceSectorEnergyTopBlockConsistency, executionImpact-NONE
- 2026-05-26 · Patch-GATE0-SNAPSHOT-USAGE-LIVE-PERMISSION-HARDENING-001 · gate0, EOD_SNAPSHOT_VALID-live-block, snapshot-usage-validity, SHADOW_ONLY_POLICY, VKOSPI-untrusted-diagnostic-only, executionImpact-NONE
- 2026-05-26 · Patch-GATE0-MACRO-PERMISSION-NORMALIZATION-001 · gate0, macroSignalValidity, stale-null-macroMarketSignal-false, SHADOW_ONLY_POLICY, providerIssue-isolated, scan_blockers_gate0
- 2026-05-26 · Patch-SECTOR-ENERGY-SAFE-OFFICIAL-PROMOTION-001 · sector-energy, ADR-0488, SAFE_OFFICIAL_VERIFIED_COVERAGE, unsafe-alias-excluded(조선/방산/원자력/이차전지), denominator 15→11, safeOfficialVerifiedCoverage=100%, officialTargetVerifiedCoverageDiagnostic=73.3%, leadershipBlockReason-UNSAFE_ALIAS_CANDIDATES-removed, freshDataStatus/scan_blockers/sector_energy-display, decisionUsesSafeOfficialOnly, liveExecutionAllowed-false, executionImpact-NONE
- 2026-05-26 · Patch-UNIFIED-FORWARD-COMMON-BUS-BRIDGE-001 · unified-forward-outcome-labeling, source-registry, common-forward-outcome-schema, gate3-threshold-evidence-bridge, sourceRowsByType, executablePnL-separated
- 2026-05-26 · Patch-UNIFIED-FORWARD-LABELER-ACTIVATION-001 · unified-forward-outcome-labeling, startup-run, ALWAYS_ON-scheduler, DATA_UNAVAILABLE-healthy, lastLabelingRunAt, executionImpact-NONE
- 2026-05-26 · ADR-0533 · unified-forward-outcome-labeling-bus, gate3-evidence, gate1-dry-run-forward-return, near-miss-horizon-counts, counterfactual-paper-observational, executionImpact-NONE
- 2026-05-26 · Patch-SECTOR-INDEX-VALUE-QUALITY-ZERO-001 · sector-index, idxcode-mst-fixedwidth, FID_INPUT_ISCD-4digit, VALUE_QUALITY_ZERO, apiTransportSuccessCount, executionImpact-NONE
- 2026-05-26 · Patch-GATE3-FORWARD-RETURN-CRON-WIRING-P1-001 · gate3-evidence, updatePendingGate3Outcomes-unwired, learningJobs-scheduledJob-gate3_forward_return_update, 16:35-KST-TRADING_DAY_ONLY, persistGate3OutcomeSeed, schedulerHealthy-recovery, krxHolidays-businessday-SSOT-dedup, GATE3_FORWARD_RETURN_CRON_ENABLED, executionImpact-NONE
- 2026-05-26 · Patch-SECTOR-INDEX-VERIFY-CANDIDATE-EXPANSION-LEVER1-001 · sector-energy, SectorIndexCodeMap, expandedVerifyInputCandidates, collectSafeAliasFamilyRows, KOSPI/KOSDAQ-0xxx-before-KRX-series-4xxx, verifyInputCandidates-only, coverage-unchanged, qualityUsable, executionImpact-NONE
- 2026-05-26 · Patch-CANONICAL-GATE-FORENSIC-VIEW-ADR0528-001 · gate_full, scan_blockers, canonicalForensicId, buildCanonicalForensicIds, QmpGateDetailHeaderView.canonical, executionImpact-lane-split, validateCanonicalViewConsistency, CANONICAL_VIEW_DIVERGENCE, display-only
- 2026-05-26 · Patch-KIS-FINANCE-CACHEHIT-FIX-ADR0532-001 · gate2, getGate2DartFinancialsForEvaluation, cache-hit-gap, flag-on-bypass-PER-less-legacy-DART-cache, KIS-primary-recompute-recache, self-correcting-migration, flag-off-byte-equivalent
- 2026-05-26 · Patch-KIS-FINANCE-READ-ADR0532-PHASE3-001 · gate2, getGate2DartFinancialsForEvaluation, KIS-primary-roe/opm/per, mergeKisPrimaryWithDartResidual, ICR/OCF-DART-residual, KIS_FINANCE_PRIMARY_ENABLED, dualization-resolved
- 2026-05-26 · Patch-KIS-FINANCE-CLIENT-ADR0532-PHASE1-001 · kisFinanceClient, KIS-L1-financials, financial-ratio-FHKST66430300, income-statement-FHKST66430200, ROE/OPM/debtRatio, QmpDartFinancials-mapper, no-corp_code, infra-not-wired
- 2026-05-26 · Patch-KIS-PER-RECOVERY-ADR0532-PHASE2-001 · gate2, PER-recovery, fetchGate2PerValuation, getGate2DartFinancialsForEvaluation, per-decoupled-from-DART, KIS_FINANCE_PRIMARY_ENABLED, inquire-price-FHKST01010100, flag-gated
- 2026-05-26 · ADR-0532 · gate2, kis-finance-fundamentals-migration, DART→KIS-L1, financial-ratio/income-statement/stability-ratio/inquire-price-PER, no-corp_code, ICR/OCF-DART-residual, KIS_FINANCE_PRIMARY_ENABLED, design-only
- 2026-05-26 · Patch-GATE1-SWEEP-SCALE-REVERT-001 · scan_blockers, gate1ThresholdSweep-removed, raw-vs-minSignal-scale-bug, redundant-with-ADR0471/0466, keep-executionGuardSource-tokens
- 2026-05-26 · Patch-R3-SANITY-REMOVE-ABORT-001 · preflight, R3_SANITY_BLOCK, ABORT_HARD_BLOCK-removed, unconditional-OBSERVE_ONLY, R3_SANITY_BLOCK_ENABLED-removed, buyListLoop-diagnostic-lane
- 2026-05-26 · Patch-R3-SANITY-OBSERVE-DISPLAY-001 · scan_blockers, gate1ThresholdSweep, survivors@70/65/60/adaptive, executionGuardSource, R3_SANITY_OBSERVE_ONLY_DIAGNOSTIC_CARRIED, gateScoreDiagnostics
- 2026-05-26 · Patch-R3-SANITY-OBSERVE-ONLY-DEMOTE-001 · preflight, R3_SANITY_GUARD, observe-only-execution-guard, diagnosticOnlyLiveBlock, buyListLoop-diagnostic-lane, gateScoreHealthSamples, ADR-0120/0401-demote
- 2026-05-26 · Patch-R3-SANITY-BLOCK-ENV-SEAL-001 · preflight, R3_SANITY_BLOCK_ENABLED, isR3SanityBlockEnabled, ADR-0120-latch-seal, gate-diagnostic-unblock, 1-line-rollback
- 2026-05-26 · ADR-0531-ROLLOUT-LEARNING · regime, gate0-ssot, learning-label-migration, resolveCanonicalRegimeLevel, shadowResolverJob, emptyScanPostmortem, conditionAuditor, adaptiveLearningClock, invariant-8
- 2026-05-26 · ADR-0531-ROLLOUT-DISPLAY · regime, gate0-ssot, display-consumer-migration, resolveCanonicalRegimeLevel, telegram-cmd, reportGenerator, survival, systemRouter
- 2026-05-26 · Patch-PREFLIGHT-GATE-HEADER-DIAGNOSTIC-SUMMARY-001 · gate_full, G1-header, hardSurvivors, minSignalPass, topGate1BlockReason, entryLane-counterfactual, gate2SoftLeadershipLane, gateLayerAudit
- 2026-05-26 · ADR-0531-ROLLOUT-DECISION · regime, gate0-ssot, canonicalRegimeAccess, resolveCanonicalRegimeLevel, isCanonicalR6Defense, decision-consumer-migration, GATE0_CANONICAL_REGIME_DISABLED-killswitch
- 2026-05-26 · Patch-PREFLIGHT-GATE1-FORENSIC-DETAIL-WIRING-001 · preflight, gate1-forensic, ADR-0505, SUMMARY_FIELD_MISSING, EMITTED, gate_full
- 2026-05-26 · ADR-0531 · regime, gate0-ssot, buildGate0RegimeView, getLiveRegime-deprecated, regime-cmd-canonical
- 2026-05-26 · ADR-0530 · regime, VKOSPI-sanity-guard, invariant-6, R6-recovery-vkospiOk-isolation, classifyVkospiSanity
- 2026-05-26 · Patch-GATE1-FORENSIC-PERSYMBOL-ROW-CARRY-RESTORE-001 · gate1ForensicInputsCollector, ADR-0514-restore, per-symbol-carry, semanticAvailable, sellOnly-fields, ENTRY_FILTER, ENV-rollback
- 2026-05-26 · Patch-PREFLIGHT-DIAGNOSTIC-SCANSUMMARY-PERSIST-001 · preflight, diagnostic-scansummary, SNAPSHOT_MISSING, NO_SCAN_SUMMARY, PERSIST_SKIPPED, gate_full, runtime-resolver-trace
- 2026-05-26 · Patch-SCANBLOCKERS-PREFLIGHT-CANONICAL-RECONCILIATION-001 · scan_blockers, gate_full, preflight, canonical-reconciliation, QMP_DIAGNOSTIC_CANONICAL_MISMATCH
- 2026-05-26 · Patch-GATE1-LIQUIDITY-OPENING-RAMP-001 · gate1LiquidityFloor, OPENING_RAMP, session-aware-softpass, canonical-asOf-attachment, coverage.asOf, priceMetadata.asOf, wiring-test, GATE1_LIQUIDITY_OPENING_RAMP_ENABLED
- 2026-05-26 · Patch-R3-GATE1-PASS-ZERO-HARDBLOCK-DEPRECATION-001 · ADR-0401-narrowing, GATE1_PASS_ZERO, SHADOW_ONLY-prescan, R3_GATE1_PASS_ZERO_HARDBLOCK_ENABLED
- 2026-05-25 · Patch-Shadow-Operating-Window-Gate · shadow-card, operating-window, buyPipeline
- 2026-05-25 · Patch-Gate-TrueWeakness-Shadow-Flag-Alignment · gateDecisionRouter, shadowAllowed, counterfactual
- 2026-05-25 · Patch-WATCHLIST-ADDED-ALERT-DEDUP-001 · watchlist, alert-dedup
- 2026-05-25 · Patch-CI-SRP-BASELINE-AND-GITLEAKS-FP-001 · CI, SRP, gitleaks
- 2026-05-25 · Patch-KELLY-REMOVAL-REGIME-BUYWEIGHT-001 · sizing, regime, Kelly-removal
- 2026-05-25 · Patch-WATCHLIST-SYNC-BASELINE-002 · watchlist, client-sync, churn
- 2026-05-25 · Patch-ADR-INDEX-TOKEN-COMPACT-001 · docs-adr-index, context-hygiene
- 2026-05-25 · Patch-REGIME-SWITCH-FASTER-UPGRADE-001 · regime, scheduler, TTL
- 2026-05-25 · Patch-SECTOR-ENERGY-WIRING-FIX-001 · sector-energy, entryRevalidationGate
- 2026-05-25 · Patch-GATE2-SUPPLY-SECTOR-RS-WIRING-001 · Gate2, supply, sector, RS
- 2026-05-25 · Patch-CANDIDATEPOOL-KIS-PRICE-INJECTION-001 · candidatePool, KIS-price, price-context
- 2026-05-25 · Patch-GATE1-SELLONLY-SESSION-WIRING-001 · Gate1, SELL_ONLY, session
- 2026-05-25 · Patch-MINSCORE-THRESHOLD-WIRING-001 · minScore, threshold, UI
- 2026-05-25 · Patch-NORMALIZED-GATE-SCORE-UNIFICATION-001 · gateScore, normalization
- 2026-05-25 · Patch-GATE-LAYER-SUMMARY-WIRING-001 · gateLayerSummary, shadowAudit
- 2026-05-25 · Patch-FOMC-DEAD-CODE-REMOVAL-001 · FOMC, dead-code
- 2026-05-25 · Patch-KIS-SECTOR-INDEX-PRODUCTION-WIRING-001 · KIS-sector-index, Gate2
- 2026-05-25 · ADR-0519 + Patch-UNIFIED-SOURCE-SNAPSHOT-001 · SourceSnapshot, symbolDataCollector
- 2026-05-25 · Patch-UNIFIED-SOURCE-SNAPSHOT-002 · SourceSnapshot, supply-price injection
- 2026-05-25 · Patch-UNIFIED-SOURCE-SNAPSHOT-003 · KRX-master, SourceSnapshot
- 2026-05-25 · Patch-UNIFIED-SOURCE-SNAPSHOT-004 · cross-sectional-RS, macro-context
- 2026-05-25 · Patch-SUPPLY-CONFLUENCE-UNKNOWN-NEUTRALIZE-001 · supply, providerIssue, Gate1
- 2026-05-25 · Patch-KIS-INVESTOR-FLOW-SOURCE-UNIFY-001 · KIS-investor-flow, single-channel
- 2026-05-25 · ADR-0520 · Gate1-scoring-alignment, dry-run, ADR-0476
- 2026-05-25 · Patch-REGIME-DISPLAY-CANONICAL-001 · debug-raw, effectiveRegime
- 2026-05-25 · Patch-SECTOR-INDEX-MARKET-CLOSED-AWARE-001 · sector-index, market-closed
- 2026-05-25 · Patch-GATEUX-REGIME-CANONICAL-002 · gateUx, debug_gate, effectiveRegime
- 2026-05-25 · Patch-SECTOR-THEME-INDEX-CANDIDATE-DIAG-001 · sector-theme, KRX-index-diag
- 2026-05-25 · Patch-LIVEREADINESS-R6-CANONICAL-003 · Gate3, liveReadiness, R6-canonical
- 2026-05-25 · Patch-PENDING-WIRING-ACTIVE-CLEANUP-001 · docs, pending-wiring
- 2026-05-25 · Patch-ACMA-BASELINE-STALE-CLEANUP-001 · complexity, baseline-cleanup
- 2026-05-25 · Patch-SECTOR-INDEX-MARKETCLOSED-TYPE-UNION-001 · typecheck, sector-index
- 2026-05-25 · Patch-KRX-MDCSTAT02401-SESSION-GUARD-001 · KRX, session-guard, providerIssue
- 2026-05-25 · ADR-0521 · refactor, sectorEnergyMasterSupplyUnknownPolicy
- 2026-05-25 · ADR-0522 · refactor, regimeLearningBank
- 2026-05-25 · ADR-0523 · refactor, gate2ExternalDataProvider
- 2026-05-25 · Patch-LEARNING-WEIGHTS-RESET-CMD-001 · Telegram, learning-weights-reset
- 2026-05-25 · Patch-TELEGRAM-AUTOCOMPLETE-REGISTRY-LOAD-001 · Telegram, setMyCommands
- 2026-05-25 · ADR-0524 · refactor, minimumSignalScoreTrace
- 2026-05-25 · ADR-0525 · gate-debug-raw, canonical-summary
- 2026-05-25 · ADR-0526 · CandidateGateEvaluationView, SSOT
- 2026-05-25 · ADR-0527 · ExecutionPermissionResolution, PositionPolicyDecision
- 2026-05-25 · ADR-0528 · railway-decision-log-correlation, sourceSnapshotId, 5-event-chain, decisionStage
- 2026-05-25 · Patch-SCAN-BLOCKERS-ENTRY-LANE-SPLIT-001 · scan_blockers, SHADOW_ONLY, entry-lanes
- 2026-05-25 · Patch-PATCH-HISTORY-INDEX-COMPACT-ROUTER-001 · docs-ai-10, archive-snapshot, context-hygiene
- 2026-05-26 · Patch-QMP-GATE-DETAIL-HEADER-CANONICAL-536A2 · gateUx, QMP-header, Permission/Gate3/EntryLane
- 2026-05-26 · Patch-QMP-GATE-HEADER-FIELD-SOURCE-536A3 · QMP-header, paperObservational, shadowLeadershipAllowed
- 2026-05-26 · Patch-ADR0528-A1A2-SOURCESNAPSHOT-CARRY-WIRING · position-policy-log, sourceSnapshotId, scanEvaluation.scanId, NA-fallback-fix
- 2026-05-26 · Patch-SUPPLY-HEALTH-CANONICAL-VIEW · supply_health, scan-used-supply, sourceSnapshotId, live-probe-vs-canonical
- 2026-05-26 · Patch-GATE2-PER-DEDUP · gate2-PER, FHKST01010100, snapshot-quote-reuse, byte-equivalent, kis-call-dedup
- 2026-05-26 · ADR-0529 · dart-financials-canonical, SourceSnapshot-slot, cached-reference, gate2-dart, byte-equivalent, quota-0
- 2026-05-26 · Patch-SHADOW-EXEC-SINGLE-PATH · shadow-buy, onApproved-noop-removal, single-execution-path, fill-once-guard, #8-test
- 2026-05-26 · Patch-TRACE-SOURCESNAPSHOTID-ALIGNMENT · runtime-resolver-trace, runtime-pipeline-audit, NO_SCAN_SUMMARY-fix, scanEvaluation.scanId, ADR-0528-carry
- 2026-05-26 · Patch-GATE1-RISK-SECTOR-VIEW-NORMALIZATION · Gate1-positive-wiring-display, RegimeRisk-confidence-sizing, SectorEnergy-view-split, R3-subReason
- 2026-05-27 · Patch-SectorEnergy-Legacy-Renderer-Kill · canonical-output-lock, diagnostic-only-grouped-kis, TopBlocks, Gate2, ADR0488, Telegram-sector

---

## Archive Buckets

| Range | What to search | File |
|-------|----------------|------|
| 2026-05-25 pre-slim verbose index | long recent rows before compact router split | `docs/archive/adr/patch-history-index-snapshot-2026-05-25.md` |
| 2026-04 to 2026-05 legacy full log | historical PR/ADR bodies and old detailed rows | `docs/archive/adr/patch-history-full-log.md` |
| ADR source of truth | issued ADR documents and next-number index | `docs/adr/INDEX.md`, `docs/adr/*.md` |

Recommended commands:

```powershell
rg "Patch-SCAN-BLOCKERS-ENTRY-LANE-SPLIT-001|entry-lanes" docs/archive/adr docs/adr
rg "ADR-0527|ExecutionPermissionResolution" docs/archive/adr docs/adr
```

---

## Maintenance

- Do not paste full PR reports into this file.
- Do not load archive buckets unless a specific identifier or keyword points there.
- If a row needs more than tags, create or update an ADR/archive note and link by identifier.
- During commit prep, report this file's byte size when it changes.
