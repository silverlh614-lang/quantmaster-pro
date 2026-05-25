# 10 · Patch History Index (요약 색인)

**Read this file only when working on:**
- 과거 패치/ADR 가 *언제·무엇* 이었는지 빠른 색인 조회
- 특정 도메인의 과거 변경을 찾아 archive 상세로 진입하는 입구

**Do not read this file for:**
- 현재 실행 규칙(헌법) → `CLAUDE.md` / `AGENTS.md`
- 도메인별 현행 정책 → `docs/ai/00`~`09`
- **과거 패치 상세 본문** → `docs/archive/adr/patch-history-full-log.md` (기본 로드 금지)

> **Archive Note.** 본 문서는 **요약 색인(목차)** 다 — 상세가 아니다. 과거 패치 상세 본문 전체
> (archival 시점 401 entries, ~1.8MB)는 `docs/archive/adr/patch-history-full-log.md` 로 격리됐다 (ADR-529).
> 일반 코딩 중에는 archive 를 로드하지 말 것. 현재 작업이 해당 도메인을 직접 건드릴 때만,
> 아래 색인에서 ADR/Patch 식별자·날짜를 찾아 archive 에서 키워드 검색하라.

---

## 문서 구조 (ADR-529)

| 파일 | 역할 | 로드 |
|------|------|------|
| `CLAUDE.md` / `AGENTS.md` | 짧은 실행 규칙 (헌법) | 항상 |
| `docs/ai/00`~`09` | 현재 작업용 도메인 문서 | 작업 도메인만 |
| `docs/ai/10-patch-history-index.md` (본 문서) | 과거 기록 검색용 **요약 색인** | 검색 시 |
| `docs/archive/adr/patch-history-full-log.md` | 과거 패치 **상세 본문** (격리) | **기본 금지** |

## 신규 패치 기록 규칙 (going-forward)

- 모든 PR 은 아래 **## 색인** 끝에 한 줄 추가: `- YYYY-MM-DD · <ADR/Patch 식별자>`.
- 구조/거버넌스 ADR 은 **## 핵심 ADR 요약** 에 7-필드 블록 추가.
- 상세 진단 로그·Telegram 원문·수십 줄 분석은 본 문서에 **누적 금지** — archive 또는 PR 설명으로.
- 과거 사건 ≠ 현재 실행 규칙. 현재 규칙은 항상 `docs/ai/00`~`09` 에만 둔다.

---

## 핵심 ADR 요약 (구조·거버넌스)

### ADR-527 — CLAUDE.md Slimming
- **Status:** Completed · **Domain:** AI Context / Documentation
- **Problem:** CLAUDE.md 가 ~1.8MB 로 비대화 → Claude Code 성능 저하 경고.
- **Decision:** CLAUDE.md 를 최상위 실행 규칙(≤40k)으로 축소하고 상세를 `docs/ai/00`~`10` 으로 분리.
- **Current Relevance:** AI 에이전트 지침/문서 구조를 수정할 때만 참조.
- **Detail:** `docs/archive/adr/patch-history-full-log.md` (검색어 `ADR-527`)

### ADR-528 — docs/ai Reference Router Hardening
- **Status:** Completed · **Domain:** AI Context / Documentation
- **Problem:** 문서를 나누기만 하면 에이전트가 여전히 전부 읽을 수 있음 (라우팅 미강제).
- **Decision:** CLAUDE.md §6 키워드 라우터 강화 + 각 문서 "Read/Do not read" 2-섹션 + SRP 중복 제거.
- **Current Relevance:** `docs/ai` 문서 경계/라우터를 수정할 때만 참조.
- **Detail:** `docs/archive/adr/patch-history-full-log.md` (검색어 `ADR-528`)

### ADR-528-B — AGENTS.md 생성
- **Status:** Completed · **Domain:** AI Context / Multi-Agent
- **Problem:** Codex/VS Code 등 범용 에이전트가 따를 실행 규칙 파일 부재.
- **Decision:** `AGENTS.md` 신설 (범용·영어, 9대 불변식 verbatim, `docs/ai` 라우팅). CLAUDE.md 복사 아님.
- **Current Relevance:** 다중 에이전트 지침을 수정할 때만 참조.
- **Detail:** `docs/archive/adr/patch-history-full-log.md` (검색어 `ADR-528-B`)

### ADR-529 — Patch History Archive & Legacy Context Cleanup
- **Status:** Completed · **Domain:** AI Context / Documentation
- **Problem:** `10-patch-history-index.md` 가 ~1.8MB / 401 entries 로 제2의 CLAUDE.md 화.
- **Decision:** 상세 본문을 `docs/archive/adr/patch-history-full-log.md` 로 무손실 격리하고 본 문서는 요약 색인만 유지.
- **Current Relevance:** 과거 패치 검색 시 본 색인 → archive 순으로 진입.
- **Detail:** 본 문서 + archive (검색어 `ADR-529`)

### ADR-530 — Patch Scope Guard & Refactor Safety Template
- **Status:** Completed · **Domain:** AI Context / Documentation
- **Problem:** 에이전트가 패치 범위를 과확장 (문서 수정인 줄 알았는데 src/engine/provider/gate 까지 건드림).
- **Decision:** CLAUDE.md/AGENTS.md 에 짧은 Patch Scope Guard + `09` 상세 규칙 10조 + `08` 패치 유형별 최소 검증 + `templates/patch-plan-template.md`·`patch-report-template.md` 신설.
- **Current Relevance:** 모든 패치 시작 전 Patch Plan 작성, allowedFiles 안에서만 수정.
- **Detail:** `docs/ai/09-refactor-rules.md` · `docs/ai/templates/` (검색어 `ADR-530`)

### ADR-531 — Warning/Error Taxonomy Cleanup & Diagnostic Severity Normalization
- **Status:** Completed (1차: 문서 SSOT 전용) · **Domain:** diagnostics / logging / severity taxonomy
- **Problem:** severity enum 4종 분산 + ad-hoc console.warn 산재 + 정책상태/providerIssue 가 장애처럼 표시될 여지.
- **Decision:** 분산된 기존 인프라(WarnPriority/ExecutionImpact/logger/alertRouter)를 6-레벨 taxonomy 로 **성문화**(코드 0줄). 경고는 삭제가 아니라 분류. enum 통합·emit 사이트 리팩토링·telegram 필터는 ADR-532+ 분리.
- **Current Relevance:** diagnostic/severity/logging/telegram-display 패치 시 taxonomy SSOT 준수.
- **Detail:** `docs/archive/adr/adr-531-warning-error-taxonomy.md` (검색어 `ADR-531`)

### ADR-532 — Telegram Noise Reduction & Channel Severity Filter
- **Status:** Completed (1차: 문서 SSOT 전용) · **Domain:** telegram / notification routing / severity filter
- **Problem:** executionImpact=NONE diagnostic/provider 가 사용자 SIGNAL 채널에 노이즈로 노출될 여지.
- **Decision:** ADR-531 taxonomy 의 Telegram 적용 규칙 성문화. **핵심 발견: 상당수 이미 구현됨** (provider→CH3, /pos·/pnl shadow-first, [DEBUG]→Railway-only, dedup 인프라). 기존 동작 SSOT 검증 + gap(userFacing 플래그·ADMIN 채널)은 후속 분리.
- **Current Relevance:** telegram severity 필터/표시 패치 시 본 규칙 준수.
- **Detail:** `docs/archive/adr/adr-532-telegram-noise-reduction.md` (검색어 `ADR-532`)

### ADR-533 — Typecheck Baseline & No-Regression Guard
- **Status:** Completed · **Domain:** testing / typecheck / no-regression baseline
- **Problem:** baseline 실패 기준선 부재 → 패치가 안정성을 깨도 감지 불가.
- **Decision:** baseline 기록(typecheck 0 errors · test 310 failed/13,826 @bd574995) + No-Regression Guard + 도메인별 필수 검증 문서화. 코드 0줄.
- **Current Relevance:** 패치가 type error 0·test 실패 ≤310 유지하는지 판정.
- **Detail:** `docs/archive/adr/adr-533-typecheck-baseline-no-regression.md` (검색어 `ADR-533`)

### ADR-534 — Baseline Failure Burn-down Plan
- **Status:** Completed · **Domain:** validation baseline / failure taxonomy / burn-down planning
- **Problem:** 310 baseline 실패를 한 번에 고치면 위험 — 분류·우선순위·소규모 분할 필요.
- **Decision:** 도메인(trading 52·clients 8·telegram 7·learning 7·scripts 7 등)/위험도 분류 + taxonomy + 후속 ADR(535~539) 지도. **핵심: typecheck=0 → type-shape fixture drift 부재, 실패는 런타임 assertion.** 코드 0줄.
- **Current Relevance:** burn-down 후속 ADR 범위/순서 결정 시 참조.
- **Detail:** `docs/archive/adr/adr-534-baseline-failure-burndown.md` (검색어 `ADR-534`)

### ADR-535 — Test Fixture Schema Alignment & Factory Discipline
- **Status:** Completed (재범위: 문서 SSOT) · **Domain:** test fixtures / mock factory discipline
- **Problem:** 가장 낮은 위험의 TEST_FIXTURE_DRIFT 부터 정리하려 했으나 — 실측상 type-shape drift 부재.
- **Decision:** typecheck=0/import에러 0 → fixture schema drift **부재** 검증·기록. 동작 테스트 재작성 금지. canonical test-factory 규율(불변식 보존 default) + 도메인별 필수 fixture 케이스를 forward guideline 로 확립. 코드 0줄.
- **Current Relevance:** 테스트 mock 작성/정렬 시 factory 규율 참조.
- **Detail:** `docs/archive/adr/adr-535-test-fixture-schema-alignment.md` (검색어 `ADR-535`)

### ADR-541 — scripts/*.test.js Self-Test Failure Classification (ENVIRONMENT_BLOCKED)
- **Status:** Completed (조사·분류, 코드 0줄) · **Domain:** validation scripts / test-env classification
- **Problem:** ADR-534 로드맵 다음 항목(scripts self-test, LOW) 진행 — 실측 결과 안전 수정 타겟 아님.
- **Decision:** 5× SyntaxError = ENVIRONMENT_BLOCKED(node --check PASS·standalone EXIT=0·CI-통과 커밋·vitest/env 아티팩트), check_complexity = 병렬작업 오염 → **편집 금지·보류**. clean-CI+병렬랜딩 후 재측정 권고. ADR-534 로드맵 정정.
- **Current Relevance:** scripts self-test 실패를 고치려 할 때 먼저 본 분류 확인 (추측 수정 방지).
- **Detail:** `docs/archive/adr/adr-541-scripts-selftest-failure-classification.md` (검색어 `ADR-541`)
- **번호 메모:** 536~540 = Codex UI 작업 점유 → 사용자 지시로 541.

### ADR-542 — Baseline Failure Triage (Deterministic vs Environment) & Clean-Tree Gate
- **Status:** Completed (triage 분석, 코드 0줄) · **Domain:** validation baseline / failure triage
- **Problem:** 310 실패를 burn-down 하기 전 — 진짜 실패 vs env 노이즈 판정 필요.
- **Decision:** 종전 가설 정정 — **network 차단 0, AssertionError 215 = 결정적 실패 지배적**(env-noise 아님). 단 트리가 Codex 미커밋 UI 병렬작업으로 오염(실패 도메인 trading/learning/telegram 과 겹침) → **clean tree 전까지 burn-down 보류** gate 명시.
- **Current Relevance:** burn-down 시작 전 clean-tree gate 충족 여부 확인.
- **Detail:** `docs/archive/adr/adr-542-baseline-failure-triage.md` (검색어 `ADR-542`)

---

## 색인 (chronological — archive 상세로 가는 입구)

> 각 줄은 archive 의 해당 행으로 가는 입구다. 상세 본문은 `patch-history-full-log.md` 에서
> 식별자(ADR-xxxx / Patch-xxx / PR-xxx)·날짜로 검색. **본 색인을 상세 로그로 키우지 말 것.**

- 2026-05-24 · PR-ADR-0518 (corporate-action-guard-dailybar-continuity · corporateActionDetector/entryPriceDrift/kisChartDataFetcher · magnitude-only false-positive 차단)
- 2026-05-20 · Patch-TSC-BASELINE-DIAGNOSTIC-FIX-001
- 2026-05-20 · 문서
- 2026-05-15 · PR-ADR-0517
- 2026-05-14 · PR-ADR-0516
- 2026-05-14 · PR-ADR-0515
- 2026-05-13 · PR-ADR-0506
- 2026-05-10 · PATCH-0491
- 2026-05-10 · PR-ADR-0501
- 2026-05-10 · PR-ADR-0500
- 2026-05-10 · PR-ADR-0499
- 2026-05-10 · PR-ADR-0498
- 2026-05-09 · PR-ADR-0497
- 2026-05-09 · PR-ADR-0492
- 2026-05-09 · PR-ADR-0496
- 2026-05-09 · PR-ADR-0491
- 2026-05-09 · PR-ADR-0491
- 2026-05-09 · PR-ADR-0490
- 2026-05-09 · PR-ADR-0489
- 2026-05-09 · PR-ADR-0495
- 2026-05-09 · PR-ADR-0488
- 2026-05-09 · PR-ADR-0487
- 2026-05-07 · PR-KIS-WS-Subscription-Priority-Queue
- 2026-05-07 · PR-Gate-Eligibility-Split
- 2026-05-07 · PR-Investor-Flow-Provider-Recovery
- 2026-05-07 · PR-Counterfactual-Price-Provider-Cache-Wiring
- 2026-04-26 · PR-Q
- 2026-04-23 · 하네스
- 2026-04-23 · ADR
- 2026-04-23 · learningJobs.ts
- 2026-04-24 · PR-1
- 2026-04-24 · PR-2
- 2026-04-24 · PR-3
- 2026-04-24 · PR-4
- 2026-04-24 · PR-5
- 2026-04-24 · PR-6
- 2026-04-24 · PR-7
- 2026-04-24 · PR-8
- 2026-04-24 · PR-9
- 2026-04-24 · PR-10
- 2026-04-24 · PR-11
- 2026-04-24 · PR-12
- 2026-04-24 · PR-13
- 2026-04-24 · PR-14
- 2026-04-24 · PR-15
- 2026-04-24 · PR-16
- 2026-04-24 · PR-17
- 2026-04-24 · PR-18
- 2026-04-24 · PR-19
- 2026-04-24 · PR-20
- 2026-04-24 · PR-21
- 2026-04-24 · PR-23
- 2026-04-24 · PR-22
- 2026-04-24 · PR-24
- 2026-04-24 · PR-25-A
- 2026-04-24 · PR-25-B
- 2026-04-24 · PR-25-C
- 2026-04-25 · PR-30
- 2026-04-25 · PR-29
- 2026-04-25 · PR-28
- 2026-04-24 · PR-27
- 2026-04-24 · PR-26
- 2026-04-25 · PR-31
- 2026-04-25 · AI
- 2026-04-25 · PR-32
- 2026-04-25 · PR-33
- 2026-04-25 · PR-35
- 2026-04-25 · PR-37
- 2026-04-25 · PR-36
- 2026-04-25 · PR-34
- 2026-04-25 · PR-40
- 2026-04-25 · PR-39
- 2026-04-25 · PR-41
- 2026-04-25 · PR-42
- 2026-04-25 · PR-48
- 2026-04-25 · PR-47
- 2026-04-25 · PR-46
- 2026-04-25 · PR-45
- 2026-04-25 · PR-44
- 2026-04-26 · PR-B-2
- 2026-04-26 · PR-D
- 2026-04-26 · PR-C
- 2026-04-26 · PR-B
- 2026-04-26 · PR-A
- 2026-04-26 · PR-T
- 2026-04-26 · PR-S
- 2026-04-26 · PR-R
- 2026-04-26 · PR-Q
- 2026-04-26 · PR-P
- 2026-04-26 · PR-O
- 2026-04-26 · PR-N
- 2026-04-26 · PR-M
- 2026-04-26 · PR-L
- 2026-04-26 · PR-K
- 2026-04-26 · PR-J
- 2026-04-26 · PR-I
- 2026-04-26 · PR-H
- 2026-04-26 · PR-G
- 2026-04-26 · PR-F
- 2026-04-26 · PR-E
- 2026-04-26 · PR-D
- 2026-04-26 · PR-C
- 2026-04-26 · PR-B
- 2026-04-26 · PR-A
- 2026-04-25 · PR-51
- 2026-04-25 · PR-50
- 2026-04-25 · PR-49
- 2026-04-26 · PR-P
- 2026-04-26 · PR-O
- 2026-04-26 · PR-N
- 2026-04-26 · PR-M
- 2026-04-26 · PR-L
- 2026-04-26 · PR-K
- 2026-04-26 · PR-J
- 2026-04-26 · PR-I
- 2026-04-26 · PR-H
- 2026-04-26 · PR-G
- 2026-04-26 · PR-F
- 2026-04-26 · PR-E
- 2026-04-26 · PR-D
- 2026-04-26 · PR-C
- 2026-04-26 · PR-B
- 2026-04-26 · PR-55
- 2026-04-26 · PR-54
- 2026-04-26 · PR-53
- 2026-04-26 · PR-52
- 2026-04-26 · PR-A
- 2026-04-25 · PR-43
- 2026-04-26 · PR-53
- 2026-04-26 · PR-54
- 2026-04-26 · PR-55
- 2026-04-26 · PR-56
- 2026-04-26 · PR-57
- 2026-04-26 · PR-58
- 2026-04-26 · PR-59
- 2026-04-26 · PR-60~65
- 2026-04-26 · PR-X1
- 2026-04-26 · PR-X2
- 2026-04-26 · PR-X3
- 2026-04-26 · PR-X4
- 2026-04-26 · PR-X5
- 2026-04-26 · PR-X6
- 2026-04-26 · PR-Y1
- 2026-04-26 · PR-Y2
- 2026-04-26 · PR-Y4
- 2026-04-27 · PR-Z1
- 2026-04-26 · PR-Z1
- 2026-04-26 · PR-Z2
- 2026-04-26 · PR-Z3
- 2026-04-26 · PR-Z4
- 2026-04-26 · PR-Z5
- 2026-04-26 · PR-Z6
- 2026-04-26 · PR-Z7
- 2026-04-26 · 긴급패치
- 2026-04-26 · fix(survival):
- 2026-04-26 · FOMC
- 2026-04-26 · FOMC
- 2026-04-26 · FOMC
- 2026-04-26 · Yahoo
- 2026-04-26 · PR-EG1+EG2+EG3
- 2026-04-26 · 공매도
- 2026-04-26 · /health
- 2026-04-26 · Yahoo
- 2026-04-26 · 스케줄러
- 2026-04-26 · 글로벌
- 2026-04-26 · 장외
- 2026-04-27 · `/refresh_sector_map`
- 2026-04-27 · PR-1
- 2026-04-27 · PR-2
- 2026-04-27 · PR-α
- 2026-04-27 · PR-γ
- 2026-04-28 · PR-R
- 2026-04-27 · PR-β
- 2026-04-27 · FOMC
- 2026-04-27 · PR-4
- 2026-04-27 · 4/27
- 2026-04-27 · 4/27
- 2026-04-27 · 다중
- 2026-04-27 · Gap
- 2026-04-28 · PR-Z7
- 2026-04-28 · PR-S1
- 2026-04-28 · BEP
- 2026-04-27 · Gap
- 2026-04-28 · PR-Z
- 2026-04-28 · PR-A
- 2026-04-28 · PR-B
- 2026-04-28 · PR-C
- 2026-04-28 · PR-D
- 2026-04-28 · PR-E
- 2026-04-28 · PR-F
- 2026-04-28 · PR-G
- 2026-04-28 · PR-F-2
- 2026-04-28 · PR-Z
- 2026-04-29 · PR-Z4
- 2026-04-29 · PR-Z5
- 2026-04-29 · PR-Z6
- 2026-04-29 · PR-Z7
- 2026-04-29 · PR-Z8
- 2026-04-29 · PR-Z9
- 2026-04-29 · PR-Z10
- 2026-04-29 · PR-Z11
- 2026-04-29 · PR-Z12
- 2026-04-29 · PR-Z13
- 2026-04-29 · PR-Z14
- 2026-04-29 · PR-Z15
- 2026-04-29 · PR-Z16
- 2026-04-29 · 게이팅
- 2026-04-29 · MHS
- 2026-04-29 · 운영자
- 2026-04-29 · PR-Z17
- 2026-04-29 · PR-Z18
- 2026-04-30 · Circuit
- 2026-04-30 · PR-α
- 2026-04-30 · PR-β
- 2026-04-30 · PR-γ
- 2026-04-30 · PR-ADR-0115
- 2026-04-30 · PR-ADR-0116
- 2026-04-30 · PR-ADR-0117
- 2026-04-30 · PR-ADR-0118
- 2026-04-30 · PR-ADR-0124
- 2026-04-30 · PR-ADR-0128
- 2026-04-30 · PR-ADR-0128
- 2026-04-30 · PR-ADR-0129
- 2026-04-30 · Attribution
- 2026-04-30 · PR-ADR-0130
- 2026-05-01 · PR-ADR-0132
- 2026-05-01 · PR-Refactor-1
- 2026-05-01 · PR-Refactor-2
- 2026-05-01 · PR-Refactor-3
- 2026-05-01 · PR-Diag-1
- 2026-05-01 · PR-Diag-2
- 2026-05-01 · PR-Diag-3
- 2026-05-01 · PR-Diag-4
- 2026-05-01 · PR-Diag-5
- 2026-05-01 · PR-B
- 2026-05-01 · PR-Diag-6
- 2026-05-01 · PR-B
- 2026-05-01 · PR-Governance-1:
- 2026-05-01 · PR-Governance-2:
- 2026-05-01 · PR-Governance-3:
- 2026-05-01 · KIS
- 2026-05-01 · PR-Governance-Followup:
- 2026-05-01 · PR-A3-Pre:
- 2026-05-01 · PR-A3-Audit:
- 2026-05-01 · PR-B1-1:
- 2026-05-01 · PR-Phase0-MappingFix:
- 2026-05-01 · PR-Phase1-DartFinalize:
- 2026-05-01 · PR-Phase2-KisSupplyAudit:
- 2026-05-01 · PR-Phase2-Real-Phase3:
- 2026-05-01 · PR-Phase4-Closeout:
- 2026-05-01 · PR-Phase5:
- 2026-05-01 · PR-Governance-Followup-2:
- 2026-05-02 · PR-Governance-3-SLA:
- 2026-05-02 · PR-Diaspora:
- 2026-05-02 · PR-Reflection-Routing-Retrofit:
- 2026-05-02 · PR-Sizing-Engine-Phase1:
- 2026-05-02 · PR-Sizing-Engine-Phase2D:
- 2026-05-02 · PR-Sizing-Engine-Phase2D-Extension:
- 2026-05-02 · PR-Sizing-Drawdown-Tracking:
- 2026-05-02 · PR-Sizing-Phase3-LiveActivation:
- 2026-05-02 · PR-Regime-Exposure-Budget:
- 2026-05-02 · PR-Audit-520:
- 2026-05-02 · PR-ExposureBudget-AccurateExposure:
- 2026-05-02 · PR-Kelly-Clamp-SSOT:
- 2026-05-02 · PR-ExposureBudget-AutoRegimeMapping:
- 2026-05-02 · PR-ExposureBudget-AddOnBuyDetection
- 2026-05-02 · PR-Audit-530:
- 2026-05-02 · PR-Sizing-ExposureBudget-VerboseLog:
- 2026-05-03 · PR-Shadow-Learning-Phase4b2a:
- 2026-05-03 · PR-Shadow-Learning-Phase4b1:
- 2026-05-03 · PR-Shadow-Learning-Phase4a:
- 2026-05-03 · PR-ScheduleCatalog-Drift-Fix:
- 2026-05-03 · PR-Shadow-Learning-Phase2b2:
- 2026-05-03 · PR-Shadow-Learning-Phase2b1:
- 2026-05-03 · PR-Shadow-Learning-Phase2a:
- 2026-05-03 · PR-Shadow-Learning-Persistence-Phase1:
- 2026-05-02 · PR-Sizing-Engine-Real-Data:
- 2026-05-03 · PR-Shadow-Learning-Phase4b2b1:
- 2026-05-03 · PR-Shadow-Learning-Phase4b2b2:
- 2026-05-03 · PR-Shadow-Learning-Phase4b2b3:
- 2026-05-03 · PR-Shadow-Learning-Phase3-StageA:
- 2026-05-05 · PR-A2-Wiring-1:
- 2026-05-05 · PR-B12-B:
- 2026-05-05 · PR-B12-A:
- 2026-05-05 · PR-Governance-Recovery-505:
- 2026-05-05 · PR-MacroState-DeadRead-Wiring:
- 2026-05-05 · PR-Lint-Baseline-Cleanup:
- 2026-05-05 · PR-Lint-Baseline-Cleanup-Followup:
- 2026-05-05 · PR-PreMarketGap-KrxCalendar:
- 2026-05-05 · PR-AuditFix-SignalScannerStaticGrep:
- 2026-05-05 · PR-Yahoo-Krx-Calendar-Wiring:
- 2026-05-06 · PR-Position-Truth-SSOT-And-Shadow-Mode-Header:
- 2026-05-06 · PR-Trade-Window-Policy-Update:
- 2026-05-06 · PR-Block-New-Buy-Symmetric-Coupling:
- 2026-05-06 · PR-Telegram-Block-Guard-Commands:
- 2026-05-06 · PR-R3-Sanity-Telegram-Unblock:
- 2026-05-06 · PR-P0-A-Mode-Observability:
- 2026-05-06 · PR-P0-B-Trading-Mode-SSOT:
- 2026-05-06 · PR-P1-Stage-A-Execution-Mode:
- 2026-05-06 · PR-P2-Persistent-Execution-Mode-Override:
- 2026-05-06 · PR-P1.5-Execution-Terminology-SSOT:
- 2026-05-06 · PR-A-Provider-Degraded-Visibility:
- 2026-05-06 · PR-P0-Activation:
- 2026-05-06 · PR-Sector-Energy-Hardening-Phase-1:
- 2026-05-06 · PR-Sector-Energy-DataQuality-Decomposition
- 2026-05-06 · PR-Sector-Energy-Yahoo-ETF-Fallback-Wiring
- 2026-05-06 · PR-Sector-Energy-STRONG_BUY-Confidence-Gate
- 2026-05-06 · PR-Sector-Energy-Source-Restoration
- 2026-05-06 · PR-Wire-SectorEnergy-StrongBuy-Gate
- 2026-05-06 · PR-Frozen-Quote-And-Holiday-R3-Streak-Guard
- 2026-05-06 · PR-R3-Sanity-State-Machine
- 2026-05-06 · PR-Stock-Master-Evening-Cron
- 2026-05-06 · PR-Price-Integrity-Correction-Overlay-Readonly
- 2026-05-06 · PR-Bug-Ledger-CRITICAL-Candidate-Detector:
- 2026-05-06 · PR-Bug-Ledger-Monthly-Auto-Summary:
- 2026-05-06 · PR-Bug-Ledger-Telegram-Bugs-Cmd:
- 2026-05-06 · PR-Bug-Ledger-CI-Action:
- 2026-05-06 · PR-Bug-Ledger-PR-Template-Fixes-Section:
- 2026-05-06 · PR-Bug-Ledger-Validation-Guard:
- 2026-05-06 · PR-Sector-Energy-Stale-Partial-Volume-Gate
- 2026-05-07 · PR-Evaluator-Status-Phase1-Supply-Earnings
- 2026-05-07 · PR-Postmortem-Action-Taxonomy-Phase2
- 2026-05-07 · PR-Evaluator-Data-Availability-Metadata-Automation-Phase3
- 2026-05-07 · PR-Baseline-Cleanup-After-Phase123
- 2026-05-07 · PR-R3-Sanity-Streak-Excludes-SellOnly-VolumeClock
- 2026-05-07 · PR-Fresh-Scan-Blocker-Attribution
- 2026-05-07 · PR-Investor-Flow-Semantic-Availability
- 2026-05-07 · PR-Gate2-Leadership-Attribution
- 2026-05-07 · PR-Sector-Energy-Data-Truth-Repair
- 2026-05-07 · PR-Sector-IndexCode-Provider-Repair
- 2026-05-07 · PR-Counterfactual-Universe-Learning-Preflight
- 2026-05-07 · PR-Shadow-Learning-Promotion-Recommendations
- 2026-05-07 · PR-Counterfactual-Shadow-Performance-Report
- 2026-05-07 · PR-Symbol-Resolver-Invalid-KRX-Code-Normalization
- 2026-05-07 · PR-Provisional-Shadow-Price-Provider-Cache-Lookup-Hardening
- 2026-05-07 · PR-Symbol-Normalizer-Direct-Import-Migration
- 2026-05-07 · PR-Kis-Stream-Bulk-Apply-Priority-Wiring
- 2026-05-07 · PR-Kis-Ws-Subscription-Diagnostics-Exposure
- 2026-05-07 · PR-Yahoo-Symbol-Resolver-SSOT-Migration
- 2026-05-08 · PR-Static-Grep-Guards-Hardening
- 2026-05-08 · PR-Krx-Investor-Flow-Parser-Empty-Rows-Hardening
- 2026-05-08 · PR-Sector-Energy-Recovery-Phase2-And-Sanity-Decomposition
- 2026-05-08 · PR-Sector-Energy-Alias-Registry-Expansion-And-Aggregate-Filtering
- 2026-05-08 · PR-ADR-0448
- 2026-05-08 · PR-ADR-0449
- 2026-05-08 · PR-ADR-0450
- 2026-05-08 · PR-ADR-0451
- 2026-05-08 · PR-ADR-0452
- 2026-05-08 · PR-ADR-0456
- 2026-05-08 · PR-ADR-0455
- 2026-05-08 · PR-ADR-0454
- 2026-05-08 · PR-ADR-0453
- 2026-05-09 · PR-ADR-0478+0479
- 2026-05-12 · PR-ADR-0504
- 2026-05-12 · PR-Logger-Noise-Routing-Followup
- 2026-05-12 · PR-ADR-0505
- 2026-05-13 · PR-ADR-0507
- 2026-05-13 · Patch-SHADOW-APPROVAL-DEDUP-001
- 2026-05-13 · PR-ADR-0508
- 2026-05-13 · Patch-SHADOW-POSITION-MANAGEMENT-AND-SELL-LIFECYCLE-002
- 2026-05-13 · PR-ADR-0509
- 2026-05-13 · Patch-SHADOW-LIFECYCLE-AND-EXECUTION-001
- 2026-05-13 · Patch-MARKET-PROGRAM-TRADING-FALLBACK-RECOVERY-006
- 2026-05-13 · Patch-PROGRAM-MARKET-EMPTY-OUTPUT-ROUTER-004
- 2026-05-13 · Patch-KIS500-PROVIDER-HEALTH-ISOLATION-003
- 2026-05-13 · Patch-KIS-REALDATA-500-NOISE-AND-RECOVERY-001
- 2026-05-14 · PR-ADR-0510
- 2026-05-14 · Patch-KIS-ROUTER-PARTIAL-ROLLBACK-TO-PR943-001
- 2026-05-14 · PR-KIS-CHART-COOLDOWN-FOLLOWUP
- 2026-05-14 · Patch-KIS-ROUTER-PARTIAL-ROLLBACK-TO-PR943-002
- 2026-05-14 · Patch-PREFLIGHT-BLOCKED-SCAN-SUMMARY-001
- 2026-05-14 · Patch-INVESTOR-FLOW-ACTUAL-ROW-CARRY-WIRING-001
- 2026-05-14 · Patch-WATCHLIST-SATURATION-COOLDOWN-001
- 2026-05-14 · Patch-TEST-BASELINE-FIX-001
- 2026-05-14 · Patch-WATCHLIST-DETACHMENT-SYNC-001
- 2026-05-14 · Patch-TELEGRAM-HTML-SANITIZER-001
- 2026-05-14 · Patch-ALERTS-BASELINE-FIX-001
- 2026-05-15 · Patch-PORTFOLIO-RISK-ENTRY-MARKET-SEGMENT-001
- 2026-05-15 · Patch-009-P1
- 2026-05-15 · Patch-009-P2
- 2026-05-15 · Patch-009-P4
- 2026-05-15 · Patch-009-Baseline-TSC-Fix
- 2026-05-15 · Patch-SHADOW-BULL-EXPOSURE-FLOOR-001
- 2026-05-15 · Patch-SUPPLY-DIAG-ACCURACY-001
- 2026-05-15 · Patch-SHADOW-BULL-EXPOSURE-FLOOR-002
- 2026-05-15 · Patch-SHADOW-BULL-EXPOSURE-FLOOR-003
- 2026-05-15 · Patch-SUPPLY-HEALTH-DEGENERATE-DISPLAY-001
- 2026-05-15 · Patch-KRX-INTRADAY-MARKET-PROGRAM-WIRING-001
- 2026-05-15 · Patch-SUPPLY-HEALTH-EMPTY-ROUTER-DISPATCH-FIX-001
- 2026-05-15 · Patch-MARKET-CLOSE-SNAPSHOT-001
- 2026-05-15 · Patch-AFTER-HOURS-RUNTIME-DEBUG-SNAPSHOT-001/002/003
- 2026-05-15 · Patch-SNAPSHOT-STATUS-CMD-001
- 2026-05-15 · Patch-SNAPSHOT-LATEST-CMD-001
- 2026-05-16 · Patch-SECTOR-CLASSIFICATION-CARRY-WIRING-001
- 2026-05-16 · Patch-PER-STOCK-PROGRAM-FLOW-CARRY-WIRING-001
- 2026-05-16 · Patch-MARKET-PROGRAM-CARRY-WIRING-001
- 2026-05-17 · PR-UI-Sidebar-Status-Badges:
- 2026-05-17 · PR-UI-Sidebar-Status-Badges:
- 2026-05-19 · Patch-ACMA-BASELINE-DIAGNOSTIC-MODULES-001
- 2026-05-24 · ADR-527
- 2026-05-24 · ADR-528
- 2026-05-24 · ADR-528-B
- 2026-05-24 · ADR-529
- 2026-05-24 · ADR-530
- 2026-05-24 · ADR-531
- 2026-05-24 · ADR-532
- 2026-05-24 · ADR-533
- 2026-05-24 · ADR-534
- 2026-05-24 · ADR-535
- 2026-05-24 · ADR-541
- 2026-05-24 · ADR-542
- 2026-05-24 · Patch-ACMA-UNBLOCK-4FILES
- 2026-05-24 · Patch-DECOMP-regimeLearningBackfill-001
- 2026-05-24 · Patch-UI-SECTION-NAV-VERIFY-AND-SPA-NOCACHE-001
- 2026-05-24 · Patch-CORP-ACTION-ORGANIC-DAILY-LIMIT-GUARD-001 (addedAt 윈도우 휴리스틱 — ADR-0518 일봉 검증으로 대체/제거됨)
- 2026-05-25 · Patch-WATCHLIST-ADDED-ALERT-DEDUP-001 (피엠티 churn 반복 편입 알림 → 종목코드+KST일자 dedup 1일 1회)
- 2026-05-25 · Patch-CI-SRP-BASELINE-AND-GITLEAKS-FP-001 (PR #1193 실패 진단: SRP 전체트리 접속사 위반 54건 → BASELINE 카탈로그 비차단·신규만 차단; gitleaks generic-api-key 오탐 `key: Gate3ThresholdKey` 타입명 → .gitleaks.toml allowlist)
- 2026-05-25 · Patch-KELLY-REMOVAL-REGIME-BUYWEIGHT-001 (Kelly Criterion 승수 체인 제거 → 레짐별 매수비중 직접 사용; R1=100%/R2=80%/R3=70%/R4=50%/R5=30%; IPS 감쇠·계좌보정·편향패널티·안전게이트 피드백 제거; kellyDampener stub; FOMC/VIX 게이팅 완전 제거)
- 2026-05-25 · Patch-WATCHLIST-SYNC-BASELINE-002 (클라이언트 마운트 시 워치리스트 전체 재미러링 차단 — churn 근원 제거, diffWatchlistSync baseline)
- 2026-05-25 · Patch-ADR-INDEX-TOKEN-COMPACT-001 (docs/adr/INDEX.md 316KB→28KB 압축 + 발급 룰 #6 토큰 효율 SSOT)
