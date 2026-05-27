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

- 2026-05-27 · Patch-LEARNING-PULSE-V5-GATE3-EVIDENCE-SNAPSHOT-FALLBACK-NORMALIZATION-001 · learning-pulse, gate3-display-only(Gate-threshold/scoring/completionScore-계산식/entry/exit/RRR/Counterfactual/ExecutionPolicy-무변경), normalizeGate3LearningDisplay(current-vs-lastValid-분리), Gate3EvidenceCurrentStatus(OK/SOURCE_EMPTY/SOURCE_STALE/SOURCE_MISSING/QUERY_FAILED/UNKNOWN), Gate3DisplayStatus(COMPLETE/COMPLETE_LAST_VALID/INCOMPLETE/...), lastValidGate3Snapshot-persist(gate3FinalizationState, isValidCompleteGate3Snapshot-만 승격·empty/stale-덮어쓰기-금지), COHORT_BACKFILL_SNAPSHOT_STALE→SOURCE_STALE+COMPLETE_LAST_VALID(INFO), repo-missing→WARN+CHECK_GATE3_EVIDENCE_SOURCE, true-INCOMPLETE는 lastValid-없음+current-empty에서만, 5.Gate-Learning-summary+Gate3-Evidence-Fallback-detail-line, formatGate3LearningFinalizationSection-raw-current-유지, executionImpact-NONE
- 2026-05-27 · Patch-LEARNING-PULSE-V5-REGIME-PROMOTION-SPLIT-BLOCKER-NORMALIZATION-001 · learning-pulse, display-only(매매로직/Gate/RRR/Shadow/Counterfactual-lifecycle/maturity-policy/R6-100-threshold-무변경), Regime-Promotion-Split-detail-corePromotionBlocker(raw NO_FRESH_SAMPLE→NO_LABELED_COUNTERFACTUAL)-via-normalizeRegimePromotionSplit, priority(NO_LABELED_COUNTERFACTUAL>ZERO_DURING_MARKET(WARN)>LOW_SAMPLE_SIZE), secondary=WAITING_COUNTERFACTUAL_MATURITY(NO_FRESH_SAMPLE-제거), displayOnly=MARKET_CLOSED_WAITING_NEXT_SHADOW_SCAN+R6_LOW_SAMPLE(pending-counterfactual), advisoryOnly=LOW_CONFIDENCE_REGIME_BACKFILL/LOW_RESOLVED_REGIME_SAMPLE, raw-NO_FRESH_SAMPLE→rawDiagnosticBlockers(보존), corePromotionBlockerReason/Severity+freshShadowDisplayStatus/Severity-fields-added, regimeLearningBank-raw-fields-untouched, executionImpact-NONE
- 2026-05-27 · Patch-LEARNING-PULSE-V5-LEGACY-TOPLINE-NORMALIZATION-001 · learning-pulse, display-only(매매로직/Gate/Shadow/Counterfactual-lifecycle-무변경), legacy-top-line-Fresh-Shadow(status/reason/severity/operatorAction+conditional-blocker)-via-deriveFreshShadowDisplay, deriveFreshShadowDisplay-blocker-field-added, normalizePromotionBlocker(NO_LABELED_COUNTERFACTUAL>maturity>fresh-status-priority), Promotion-top-line-blockers→blocker/reason/severity, 장마감-WAITING_NEXT_OPEN-not-NO_FRESH_SAMPLE, raw-diagnostic-preserved(Fresh-Shadow-Raw-Diagnostic-line), execution-policy-byte-equivalent, executionImpact-NONE
- 2026-05-27 · Patch-SCHEDULER-TIME-OF-DAY-SELL_ONLY-REMOVAL-001 · adaptiveScanScheduler.base, decideScan, time-of-day-SELL_ONLY-plumbing-removed(forceSellOnly+REMOVED_POLICY/ROLLBACK_DISABLED-block), phase-labels-renamed(점심 저빈도 관찰/마감 관찰/시초가 변동성 회피), baseInterval-scan-frequency-only(no-block), safety-SELL_ONLY(VKOSPI/R6/emergency/manual)-untouched, isBuyableKstWindow-unchanged, 2-stale-source-guard-tests-rewritten(read .base.ts)-fixes-16-baseline-failures, executionImpact-NONE
- 2026-05-27 · Patch-VOLUME-CLOCK-ALWAYS-ON-SCORING-ONLY-001 · volume-clock, checkVolumeClockWindow, always-on(장중 전 시간 매수 허용), scoring-only(-3..+2 가/감점), no-entry-block-except-closing-auction(15:21~15:30 단일가 하드 유지), 09:00-09:29(-3)/12:00-12:59(-2)-penalty-not-block, VOLUME_CLOCK_LEGACY_HARD_BLOCK-rollback, time-of-day-SELL_ONLY-functionally-neutralized(forceSellOnly→false baseline), safety-SELL_ONLY(R6/emergency/manual/VKOSPI)-preserved, executionImpact-NONE
- 2026-05-26 · Patch-SECTOR-ENERGY-POSTPASS-CLEANUP-DIAGNOSTIC-HYGIENE-ADR0534-001 · sector-energy, display-only(판단로직 무변경), canonical-first-render, verifiedOfficialSectorMappings(real selectedIndexCode/Name/currentIndex, no N/A-canonical-state), stripStaleSectorEnergyBlockers+STALE_SECTOR_ENERGY_BLOCKERS, sectorEnergyRenderedStatus, officialIndexView-VERIFIED-when-PASS, Page4-SectorEnergy-Summary-VERIFIED(legacy basket→diagnosticLegacyReason), gate2-stale-blocker-strip(OFFICIAL_INDEX_UNAVAILABLE/COVERAGE_BELOW_THRESHOLD), runtimeAudit-SECTOR_ENERGY_DEGRADED-gated-on-canonical-PASS, duplicateAlias-arrow-format, Invariants1-6/9, executionImpact-NONE
- 2026-05-26 · Patch-SECTOR-ENERGY-OFFICIAL-BASE-VERIFY-11-ADR0534-001 · sector-energy, collectOfficialSectorIndexTargets, OFFICIAL_SECTOR_ENERGY_BASE_VERIFY_TARGETS, always-verify-11-official(candidate-pool-independent), KIS-idxcode.mst-업종코드(기계장비 0012/음식료 0005/방송통신 4010), root-cause-of-residual-8/11(verify-universe-built-from-candidates-only), normalized-name+code-dedup, SECTOR_ENERGY_OFFICIAL_BASE_VERIFY_ENABLED-rollback, observe-mode-quote-only, complements-resolver-fixes-1262~1265, executionImpact-NONE
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
- 2026-05-26 · Patch-SECTOR-ENERGY-MISSING-OFFICIAL-3KEY-MAPPING-REPAIR · sector-energy, OFFICIAL_SECTOR_ALIAS_MAP-add(MACHINERY_EQUIPMENT-aliases+4014, SERVICE_TELECOM-SERVICE/TELECOM), official-verify-loop-fixed-to-OFFICIAL_SECTOR_ENERGY_11, invariant-add(MACHINERY_EQUIPMENT-0012/4014), canonical-output-add(verifiedMapping+missingOfficialSectorReasons-for-3keys), tests-add(0012/4014/0005/4010/4063-regression), executionImpact-NONE
- 2026-05-26 · Patch-SectorEnergy-Official11-VerifyLoop-HardFix · sector-energy, resolveOfficialSectorEnergyCoverage-loop-source-locked(OFFICIAL_SECTOR_ENERGY_11), invariants-add(machinery/food/service-missing-key-errors), canonical-output-add(officialVerifyLoopSource/keyCount/requestedKeys), duplicateAliasRowsIgnored-fixed(AUTOMOTIVE/SEMICONDUCTOR/CONSUMER_RETAIL), tests-update(official-loop-metadata+dedup), executionImpact-NONE
- 2026-05-27 · Patch-SectorEnergy-Residual-Diagnostic-Cleanup-Only · sector-energy-canonical-pass-guard, adr0474/0487/0488-legacy-collapse, runtime-pipeline-blocker-filter, top-operator-sector-repair-demotion, executionImpact-NONE
- 2026-05-27 · Patch-Regime-Display-SSOT-Diagnostic-Unification · scan-blockers, entry-filter-regime-context-canonical(raw/effective/display/riskOverride/engineMode/policyView/liveEntryAllowed/shadowAllowed/counterfactualAllowed), normal-supply-preview-previewBasis-vs-actualEngineMode-separation, regimeSource-RegimeResolver.canonicalOutput-note, executionImpact-NONE
- 2026-05-27 · Patch-Regime-Display-SSOT-Diagnostic-Unification-Refix · scan-blockers, buildDiagnosticRegimeContext-single-source-wiring(page2-canonical), entryFilter-regime-context-sourceSnapshotId+policyView-canonical, normalSupplyPreview-actual*-fields-canonicalSource-lock, previewBasis-actualEngineMode-decoupled, regime-context-type-guard(engineMode-regime-token-rejection), executionImpact-NONE
- 2026-05-27 · Patch-ADR0518-EngineMode-Priority-and-ConditionTrace-Container-Coverage · scan-blockers-normalSupplyPreview-actualEngineMode-priority(scanSummary→scanEvaluationState→executionPermission→canonicalPermission→page2-macroGate), gate1-forensic-conditionResults-container-invariant(validCandidates=traceContainer=48/48), conditionResultsBreakPoint-add(SKELETON_ONLY), computedTechnicalTraceCount-separation, unavailableReason-skeleton-support(QUOTE_RETURN_FIELD_MISSING/TECHNICAL_FIELD_NOT_COMPUTED), executionImpact-NONE
- 2026-05-27 · ADR-0535 · regime-authority-hierarchy, SourceSnapshotDecisionContext-read-model(marketRegime/executionPolicy/scoringPolicy), 5-tier-authority(ExecutionPolicy>displayRegime>effectiveRegime>rawRegime>legacy-diagnostic-only), 4-value-display-label-mapping(LIVE_ALLOWED/SHADOW_AND_DIAGNOSTIC_ONLY/SELL_ONLY/OBSERVE_ONLY)-resolver-2value-untouched, macro-card+scan_blockers-shared-authorityBlock(🧭Raw/🎚Effective/🛡Display-Policy/🚦Execution/Live-Buy/Shadow-Learning), legacyEffectiveRegime-deprecated=true-usedForDecision=false, DIFFERENT_SNAPSHOT-marker, assertDecisionContextInvariants(INV-2/3/4/7), read-model-only-byte-equivalent, follow-up(normalSupplyPreview/entryFilter/gate-diag/telegram-summary), executionImpact-NONE
- 2026-05-27 · Patch-GATE1-THRESHOLD-EVIDENCE-EMIT-RECONCILE · scan_blockers-full, 3-way-collision-reconcile(#1275/#1276-incumbent-data-wiring + revert-redundant-#1277-skeleton), formatGate1ThresholdEvidenceSection(gate1DryRunObservationLedgerAdr0476)-spec-exact(window:D1/D3/D5, scoreBandTable 70+/65~70/60~65/55~60/below55, RegimeSplit, DataQualitySplit), always-renders(undefined→INSUFFICIENT_SAMPLE/OBSERVE_MORE-N/A), repositioned-directly-below-FinalGate1Calibration-above-Gate1ScoringAlignment, removed-misplaced-🧪-block(after-ScoringAlignment), fix-buildGate1ThresholdEvidenceSummary-MFE/MAE-field(maxFavorableExcursion5D/maxAdverseExcursion5D)-tsc-2errors→0, requiredScore=70-untouched/thresholdAutoChanged=false/liveExecutionAllowed=false, executionImpact-NONE
- 2026-05-27 · Patch-GATE1-THRESHOLD-EVIDENCE-LEDGER-SOURCE-WIRE · scan_blockers-full, buildGate1ThresholdEvidenceSummary-reads-ADR0476-ledger(summarizeGate1DryRunObservationRows→totalSamples=rowsCreated/pendingSamples=pending, no-longer-D5-matured-only), scoreBand-buckets-ALL-rows-by-dryRunScore(unscored→below55, countSum==totalSamples), confidence/recommendedAction-gated-on-matured-sample(pending-only→INSUFFICIENT_SAMPLE/OBSERVE_MORE-unchanged), add-pendingSamples+countSum-output, return-stats-still-matured-scoped(N/A-when-pending), Page13↔Page17-reconciled(rowsCreated=13→totalSamples=13), requiredScore=70-untouched/liveExecutionAllowed=false, executionImpact-NONE
- 2026-05-27 · Patch-GATE1-EVIDENCE-INTEGRITY-P1P2P4 · scan_blockers-full, P1-source-breakdown-integrity(summarizeGate1DryRunObservationRows+sourceBreakdownCountSum/unclassifiedSourceRows/sourceBreakdownInvariant, formatter-renders-ALL-non-zero-sources-no-hidden-COUNTERFACTUAL_UNIVERSE/ADR0486-7-8, CLASSIFY_GATE1_EVIDENCE_SOURCE-nextAction-when-unclassified>0), P2-evidence↔ledger-invariant(ledgerRowsCreated/scoreBandCountSum/evidenceLedgerMatch/scoreBandLedgerMatch+mismatchReason/missingRows/extraRows/RECONCILE-nextAction), P4-maturity-scheduler-derived(buildGate1EvidenceMaturityStatus-from-rows+addBusinessDays, schedulerHealthy/status NOT_YET_DUE-DUE_PENDING_RUN-UP_TO_DATE/pendingD1-D3-D5/dueNow/stalePending/nextMaturityRunAt, lastMaturityRunAt=N/A-not-tracked-at-this-layer), diagnostic-display-only, requiredScore=70-untouched/liveExecutionAllowed=false/thresholdAutoChanged=false, executionImpact-NONE
- 2026-05-27 · Patch-CONDITIONRESULTS-SKELETON-REASON-P3 · scan_blockers-full, gate1MinimumSignalForensic-formatter, resolveSkeletonOnlyReasonBreakdown(skeletonOnlyTrace partition: quote→technical→fallback TRACE_CONTAINER_CREATED_BUT_FULL_TECHNICAL_TRACE_NOT_COMPUTED, capped-no-overflow), skeletonReasonCountSum+skeletonReasonInvariant(==skeletonOnlyTrace always), no-more-0/0-unattributed-skeleton, display-only, Gate-threshold-untouched, executionImpact-NONE
- 2026-05-27 · Patch-GATE1-THRESHOLD-EVIDENCE-CMD-P5 · telegram, /gate1_threshold_evidence(+alias /gate1_evidence), system-category-HIDDEN-riskLevel0-read-only, reads-ADR0476-ledger(listGate1DryRunObservationRows→buildGate1ThresholdEvidenceSummary→formatGate1ThresholdEvidenceSection), empty-ledger→skeleton(INSUFFICIENT_SAMPLE/OBSERVE_MORE), commandRegistry.register+system/index-barrel, no-threshold/approval/live-mutation, executionImpact-NONE
- 2026-05-27 · Patch-NOW-VERDICT-TEST-STALE-FIX · telegram, metaCommands.test composeNowVerdict 3-tests-realigned-to-ADR0535-authority-hierarchy(raw-R6→display/riskOverride SHADOW_ONLY+Live-Buy-BLOCKED+Shadow-ON, effective never R6 via sanitizeEffectiveRegime), test-only(engine-untouched, no-resolver/threshold change), executionImpact-NONE
- 2026-05-27 · Patch-Regime-Constitution-SSOT-Lock · scan_blockers-full, SourceSnapshotDecisionContext-add(regimeConstitution+freshnessPolicy+brokerLive/Exit), scanSummaryDecisionContext-adapter(Page2/EntryFilter/RegimeRisk/NormalSupply), child-context-invariants(regimeContextMatch/LEGACY_EFFECTIVE_REGIME_LEAK), legacyEffectiveRegime-diagnostic-only, executionImpact-NONE
- 2026-05-27 · Patch-MiddayRescan-Telegram-Dedup-Final-Summary · telegram, middayRescanCycleId(midday_YYYYMMDD_1300), final-summary-only, persistent-dedup-key(tradeDate+MIDDAY_RESCAN_WATCHLIST_ADDED+section+cycleId), symbolSetHash-day-suppression, same-day-symbol-notified-ledger, section-cooldown-30m, batch-log-telegramSent=false, tradingLogicChanged=false/gateLogicChanged=false/orderLogicChanged=false, executionImpact-NONE
- 2026-05-27 · Patch-Watchlist-Soft-Cap-Noise-Auto-Management · telegram, watchlist-cap-policy(OBSERVE/SOFT_CAP/HARD_CAP), soft-cap-simple-reach-log-only(WATCHLIST_SOFT_CAP_OBSERVED), action-required-only-telegram(hard-cap/remaining<=3), dedup-key(tradeDate+WATCHLIST_SOFT_CAP+section+capStatus+countBucket), cooldown(soft60m/hard15m), auto-cleanup-summary-log+message, tradingLogicChanged=false/gateLogicChanged=false/orderLogicChanged=false, executionImpact-NONE
- 2026-05-27 · Patch-Threshold-Search-Loop-Notification-Dedup · telegram, threshold-loop-policy(no-entry-dominant-reason+OBSERVE-default), gate-pass/rrr/prebreakout-suppresses-threshold-lowering-push, approval-required-only-proposal, dedup-key(tradeDate+THRESHOLD_SEARCH_LOOP+regime+gateThreshold+streakBucket+dominantReason), cooldown60m/session-max1/day-max2, thresholdAutoChanged=false/actualThresholdChanged=false, tradingLogicChanged=false/gateLogicChanged=false/orderLogicChanged=false, executionImpact-NONE
- 2026-05-27 · Patch-Telegram-Notification-Severity-Taxonomy · telegram, push-severity-taxonomy(CRITICAL/ACTION_REQUIRED/TRADE_EVENT/SUMMARY/DIAGNOSTIC/DEBUG_LOG_ONLY), sendTelegramAlert-final-policy-router, executionImpact-NONE+diagnosticOnly push suppression, tradeEvent eventId idempotency, watchlist-hard-cap-action-required-preserved, /noise_summary+/notification_log aliases, tradingLogicChanged=false/gateLogicChanged=false/orderLogicChanged=false, executionImpact-NONE
- 2026-05-27 · Patch-NoEntry-Streak-Diagnostic-Message-Split · telegram, no-entry-streak-diagnostic-policy(OK_OR_WAITING-vs-ACTION_REQUIRED), normal-3x-zero-entry-push-suppressed(condition-waiting wording), actual-pipeline-failure-only-action-required, dedup-key(tradeDate+NO_ENTRY_STREAK+dominantReason+streakBucket+regime+session), scan_summary-fields(pipelineHealthStatus/dominantNoEntryReason/actionRequired/forceScanBlocked/thresholdChanged), shadowLearningBlocked=false/counterfactualBlocked=false/tradingLogicChanged=false/gateLogicChanged=false/orderLogicChanged=false, executionImpact-NONE
- 2026-05-27 · Patch-ScanSummary-Zero-Provider-Failure-Copy-Fix · telegram, scan-summary-display-reason-mapping, Yahoo-failure-count0→data-failure-none(no-causal-arrow), providerFailureCausedEntryHold-separated, causal-arrow-only(count>0+providerExecutionImpact!=NONE+actionRequired), logs(SCAN_SUMMARY_REASON_MAPPED/ZERO_REASON_SUPPRESSED/CAUSAL_ARROW_ALLOWED), providerSelectionChanged=false/tradingLogicChanged=false/gateLogicChanged=false/orderLogicChanged=false, executionImpact-NONE
- 2026-05-27 · Patch-Telegram-Diagnostic-Wording-Tone-Cleanup · telegram, message-wording-tone-policy(CRITICAL/ACTION/TRADE/CAUTION/OBSERVE/DIAGNOSTIC/DEBUG), no-entry-normal-copy(진입조건미충족-대기), threshold-copy(Threshold진단/Gate기준유지/관망), watchlist-copy(확인필요-vs-자동관리대상), scan_blockers-label-softening(스캔진단요약/필터상태), logs(MESSAGE_WORDING_MAPPED/DIAGNOSTIC_WORDING_DOWNGRADED/USER_ACTION_LABEL_RESOLVED/CAUSAL_REASON_SUPPRESSED), displayOnly=true/tradingLogicChanged=false/gateLogicChanged=false/orderLogicChanged=false/providerSelectionChanged=false/watchlistSelectionChanged=false, executionImpact-NONE
- 2026-05-27 · Patch-DISCOVER-Banner-Tab-Visibility · dashboard, RecommendationWarningsBanner+OffHoursBanner relocated WatchlistHeader(overview-only)→DiscoverWatchlistPage top-level(view==='DISCOVER' tab-independent, both overview+search tabs), banners props-less(store/hook internal), search-tab visibility gap closed(UI_WIRING_MATRIX §6 P1/§7 후보2), WATCHLIST-view-unchanged, no-prop/logic/type change, byte-equivalent-presentational, sourceSnapshot/gate/provider/telegram/shadow-impact-NONE, executionImpact-NONE
- 2026-05-27 · Patch-EnvExample-VITE-Gemini-Key-Doc · docs/config, .env.example [3] Gemini 섹션에 VITE_GEMINI_API_KEY 추가(브라우저 getAI() env 폴백은 VITE_ 접두사만 읽음·GEMINI_API_KEY 접두사없음은 client-bundle 미노출), DISCOVER Start-leader-scan/시장검색 client Gemini 키 운영 갭 문서화(UI_WIRING_MATRIX §6 P0), SettingsModal localStorage 대안+우선순위 명시, 코드 0줄 변경, sourceSnapshot/gate/provider/telegram/shadow-impact-NONE, executionImpact-NONE
- 2026-05-27 · Patch-Telegram-Manual-Diagnostic-Command-Restore · telegram, bot-query-response-target(/scan_blockers-full,/learning_pulse,/pos,/pnl/manual-diagnostics), diagnosticOnly-suppression-limited-to-push-not-command-replies, webhook-reply-options(notificationTarget=BOT_QUERY_RESPONSE), notification-policy-manual-bypass, unifiedBriefing/noise/routing-guard-bypass-for-query-response, tradingLogicChanged=false/gateLogicChanged=false/orderLogicChanged=false/providerSelectionChanged=false/watchlistSelectionChanged=false, executionImpact-NONE
- 2026-05-27 · Patch-CandidatePipelinePanel-DataSource-Label · dashboard, CandidatePipelinePanel 헤더에 데이터 원천 라벨 추가("서버 자동매매 스크리너 집계 · 아래 후보 판정 카드와 별개 경로"), 서버 /api/screener/pipeline-summary funnel vs 클라이언트 getStockRecommendations 카드 원천 혼동 방지(UI_WIRING_MATRIX §6 P1·불변식#3), 표시 전용 caption-only, 데이터/쿼리/로직 무변경, uiLanguage 695파일 0위반, sourceSnapshot/gate/provider/telegram/shadow-impact-NONE, executionImpact-NONE
- 2026-05-27 · Patch-Card-EPS-Format-And-DataSource-Honesty · dashboard+discovery, WatchlistCard.tsx:828 EPS 원시 float→.toFixed(1)(표시 포맷), momentumRecommendations.ts:471 prompt dataSource 지시 "KIS 랭킹+Gemini"→"Yahoo/Naver 사전수집+Gemini 선정"(호출않는 KIS 출처 거짓표기 제거, ADR-0011 정합), UI_WIRING_MATRIX §9.1(a)+§9.2(b), 표시/프롬프트 문구 only-매매로직/dataSourceType/providerIssue/Gate 무변경, 배지 "KIS실시간"(§9.2a dataSourceType→providerIssue 영향)은 별도 PR 분리, momentum.wiring+enrichment 41 tests pass, uiLanguage 695파일 0위반, executionImpact-NONE
