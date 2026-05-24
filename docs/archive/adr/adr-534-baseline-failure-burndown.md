# ADR-534 — Baseline Failure Burn-down Plan

**Read this file only when working on:**
- baseline 실패(310)를 도메인/위험도별로 어떤 순서로 제거할지 계획
- 후속 burn-down ADR(535+)의 범위·금지 규칙 확인
- 특정 실패가 어느 taxonomy/도메인에 속하는지 분류

**Do not read this file for:**
- 일반 코딩 (burn-down 계획 전용 reference) → 평소 로드 금지
- baseline 수치/No-Regression 정책 → `docs/archive/adr/adr-533-typecheck-baseline-no-regression.md`
- 검증 명령·도메인별 필수 검증 → `docs/ai/08-testing-checklist.md`

> **Status:** ADR-534 = 분류·계획 (코드 0줄, runtime byte-equivalent).
> **이번 단계는 수리 작업이 아니라 분류 작업.** 310건을 한 번에 고치지 않는다 — 도메인/위험도/원인으로
> 나누고 LOW 부터 소규모 후속 ADR 로 태운다.

---

## Current Validation Snapshot (ADR-533 인용)

| Command | Result | Failures | 분류 |
|---------|:------:|---------:|------|
| `npm run typecheck` (=lint) | PASS | 0 | — |
| `npm run test` | FAIL | 310 / 13,826 (99 files / 1086) | BASELINE_EXISTING_FAILURE |
| `npm run build` | not-run | — | (typecheck=0 → 타입 안전 확보) |

**검증:** precommit 의 `check_adr_index_baseline` 가 ADR-527~533 전 커밋에서 PASS →
문서 재구성(ADR-527~533)은 신규 regression 0건. 실패 310 은 전부 사전 baseline.

---

## 핵심 발견 (분류의 출발점)

- **typecheck 0 errors + import 에러 0** → **TYPE_MISMATCH / MISSING_EXPORT / DEAD_REFERENCE /
  TEST_FIXTURE_DRIFT(type-shape) 계열은 사실상 비어 있다.** (mock 필드 누락이면 tsc 가 잡았을 것.)
- 실패의 본질 = **런타임 AssertionError 215건** (expected≠actual). 즉 *값/동작 assertion* 불일치.
- 가설(미정 — 후속 ADR 에서 정밀 귀속): 시간/날짜 의존(today=2026-05-24, FOMC/거래창/KRX 달력) ·
  env 의존(로컬 KIS/네트워크/secret 부재) · 일부 진짜 동작 drift 의 혼합.

---

## 실패 Taxonomy (적용 여부)

| 분류 | 본 baseline 적용 |
|------|------------------|
| TYPE_MISMATCH | ❌ 비어있음 (typecheck=0) |
| MISSING_EXPORT | ❌ 비어있음 (import 에러 0) |
| DEAD_REFERENCE | ▵ 소수 (TypeError 4 / ReferenceError 1) |
| TEST_FIXTURE_DRIFT (type-shape) | ❌ 비어있음 (typecheck=0) → **ADR-535 코드 타겟 거의 없음** |
| CONFIG_SCRIPT_ISSUE | ✅ scripts/*.test.js 7 (self-test fixture 기대값) |
| ASYNC_CONTRACT_DRIFT | ▵ 가능 (Hook/Test timed out 소수) |
| ASSERTION_VALUE_DRIFT (신규) | ✅ **지배적** — 런타임 expected≠actual |
| ENVIRONMENT_BLOCKED | ✅ 추정 다수 (시간/네트워크 의존) — 정밀 귀속 후속 |
| DOMAIN_SEMANTIC_RISK | ⚠ 일부 — 수정이 매매 의미 변경 위험 (HIGH) |

> **중요:** ADR-535(Test Fixture Schema Alignment)의 전제(타입-shape fixture drift)는 **본 baseline 에 거의
> 부재**하다. 따라서 ADR-535 는 fixture 대량 재작성이 아니라 **canonical test-factory 규율 확립(문서) +
> drift 부재 검증**으로 수행한다 (정직한 재범위 설정). 진짜 burn-down 타겟은 런타임 assertion 실패다.

---

## 도메인별 분류 (실측 — 99 failed files)

| 도메인 | 실패 파일 | riskLevel | 권장 처리 |
|--------|----------:|-----------|-----------|
| `server/trading` (exitEngine rules·entry·invariants) | 52 | **HIGH** | 매매 의미 인접 — 별도 ADR + rollback plan. 시간/env 의존 먼저 분리 |
| `server/clients` (KIS query/program/supply) | 8 | **HIGH** | provider schema/응답 — providerIssue↛marketSignal 보존하며 분석 |
| `server/telegram` (commands) | 7 | MEDIUM | ADR-531/532 severity route 정합 — command behavior 무변경 |
| `server/learning` (counterfactual·reflection·ledger) | 7 | **HIGH** | shadow/learning 의미 — shadowAllowed 보존 필수 |
| `scripts` (self-tests) | 7 | **LOW** | CONFIG_SCRIPT_ISSUE — self-test 기대값, runtime 무관 |
| `server/orchestrator` | 3 | HIGH | 실행 경로 인접 |
| `server/screener` | 2 | MEDIUM | |
| 기타 (ai/utils/health/supply/scheduler/persistence/quant/alerts/components) | ~10 | MEDIUM | 개별 분석 |

---

## 위험도 정의 & 처리 순서

- **LOW** — docs/test-fixture/config 중심, runtime 영향 없음 → **먼저 처리** (scripts self-test 등).
- **MEDIUM** — 타입/표시 정합, runtime 동작 유지 가능.
- **HIGH** — SourceSnapshot/Gate/Provider/Shadow/Execution 의미 영향 가능 → 별도 ADR + rollback 없이 금지.
- **CRITICAL** — order path/ledger/live execution/position lifecycle 직접 영향 → 최고 주의.

원칙: **LOW → MEDIUM → HIGH/CRITICAL.** HIGH/CRITICAL 은 도메인 전문 분석 + rollback plan 필수.

---

## Proposed Follow-up ADRs (후속 burn-down)

> 사용자 로드맵(535~539) 유지하되, baseline 실측(typecheck=0)에 맞춰 범위 재조정.

### ADR-535 — Test Fixture Schema Alignment & Factory Discipline (재범위)
- Scope: test fixtures/factories (docs + 검증). Risk: **LOW**.
- 실측: type-shape fixture drift **부재**(typecheck=0). → canonical test-factory 규율 확립(문서) +
  drift 부재 검증 + 진짜 isolated shape 이슈만(있으면) 수정. **fixture 대량 재작성 금지.**
- Forbidden: runtime code · 동작 변경.

### ADR-536 — Scripts Self-Test Fixture Refresh (LOW) — ⚠ 정정: ADR-541 참조
- Scope: `scripts/*.test.js` self-test 기대값(7 파일). Risk: LOW. CONFIG_SCRIPT_ISSUE.
- Goal: validation script 단위 테스트 fixture 를 현재 repo 상태와 정렬. runtime 무관.
- **정정(ADR-541 조사):** 실측 결과 5건은 **ENVIRONMENT_BLOCKED**(node --check PASS·스크립트 standalone EXIT=0·
  CI-통과 커밋 — vitest/env 아티팩트), check_complexity 는 **병렬 작업 오염**. → 로컬 안전 타겟 아님,
  clean-CI + 병렬 랜딩 후 재측정 전까지 **보류**. 추측 편집 금지. 상세 → `adr-541-scripts-selftest-failure-classification.md`.

### ADR-537 — Time/Env-Dependent Test Isolation (MEDIUM)
- Scope: 시간/날짜/네트워크 의존 테스트의 deterministic mock 화 (assertion drift 의 큰 축).
- Goal: ENVIRONMENT_BLOCKED ↔ 진짜 실패 분리. Forbidden: 매매 semantics 변경.

### ADR-538 — Telegram Formatter/Route Type Alignment (MEDIUM)
- Scope: telegram command/formatter 테스트(7). ADR-531/532 severity route 정합. Forbidden: command behavior 변경.

### ADR-539 — Provider/Shadow/Trading Assertion Review (HIGH, 분할)
- Scope: clients(8)·learning(7)·trading(52) 런타임 assertion — 도메인별로 **다시 분할**.
- Forbidden: providerIssue→marketSignal · shadowAllowed 차단 · order path · Gate 산식 · SourceSnapshot 의미.

---

## Burn-down Rules

1. 같은 ADR 에서 무관한 실패를 고치지 않는다.
2. `any` 로 type error 억제 금지 (명시 정당화 없으면).
3. 통과시키려 테스트를 약화하지 않는다.
4. tsconfig exclude 확장으로 에러 은폐 금지.
5. type error 수정 중 매매 semantics 변경 금지.
6. LOW/MEDIUM cleanup ADR 에서 live order path 수정 금지.
7. 타입 만족을 위해 SourceSnapshot 우회 금지.
8. providerIssue 를 marketSignal 로 변환 금지.
9. 테스트 통과를 위해 Shadow Learning 중단 금지.
10. 한 수정이 3개 도메인 초과 시 분리한다.

검증 명령·도메인별 기준 → `docs/ai/08-testing-checklist.md` · No-Regression baseline → `adr-533`.
