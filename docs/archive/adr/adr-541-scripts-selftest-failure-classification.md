# ADR-541 — scripts/*.test.js Self-Test Failure Classification (ENVIRONMENT_BLOCKED)

**Read this file only when working on:**
- `scripts/*.test.js` (validation 스크립트 self-test) 실패를 다룰 때
- ADR-534 burn-down 로드맵의 "scripts self-test (LOW)" 항목을 진행하려 할 때

**Do not read this file for:**
- 일반 코딩 → 평소 로드 금지
- baseline 수치/No-Regression → `docs/archive/adr/adr-533-typecheck-baseline-no-regression.md`
- burn-down 도메인 분류 → `docs/archive/adr/adr-534-baseline-failure-burndown.md`

> **Status:** ADR-541 = 조사·분류 기록 (코드 0줄). **결론: 코드 수정하지 않음.**
> ADR-534 가 "scripts self-test = LOW, 쉬운 fixture 수정" 으로 가정했으나, 실측 조사 결과
> **ENVIRONMENT_BLOCKED + 병렬 작업 오염**으로 판명 → 로컬에서 안전하게 고칠 수 있는 타겟이 아님.
> 동작하는(CI-통과) 테스트를 추측으로 편집하면 CI regression 위험 (ADR-535 규율·No-Regression Guard 위반).

> **번호:** 선행 대기 작업이 536~540 을 점유하여 사용자 지시로 541 부여.

---

## 조사 결과 (증거)

`npx vitest run scripts/` → Test Files 8 failed / 11 · Tests 11 failed / 107. 두 갈래:

### (A) 5× `SyntaxError: Invalid or unexpected token` — **ENVIRONMENT_BLOCKED**
대상: `check_adr_index` · `check_bug_ledger` · `check_data_trust` · `check_pending_wiring` · `check_pr_pace_audit` `.test.js`

증거 (모두 "내용 결함 아님" 을 가리킴):
1. **`node --check` 5개 전부 PASS** → 테스트 파일은 **문법적으로 유효한 JS**. SyntaxError 는 파일 내용이 아님.
2. SyntaxError 에 **stack/line 없음** → vitest/esbuild transform 또는 worker 런타임 아티팩트 시그니처.
3. 해당 스크립트 **standalone 실행 정상** (`node scripts/check_adr_index.js` → EXIT=0,
   `[ADR Index] OK — 324 파일 / 다음 발급 0518`).
4. 파일은 **타인이 커밋(#1036, 9cf59a44)** 한 CI-통과 코드 — 내가 만들지 않음, 최근 변경 없음.

→ 결론: 전체 `vitest run`(1086 파일·고병렬) 하에서의 **로컬 환경(Windows/vitest pool/esbuild) 아티팩트**.
CI 에서는 통과할 가능성이 높음. **편집 금지** (CI 에서 통과하는 테스트를 로컬 env 추측으로 고치면 regression).

### (B) `check_complexity.test.js` — **PARALLEL-CONTAMINATED + 테스트 격리**
- "현재 baseline (fixture 없을 때) 통과 EXIT=0" → **expected 1 to be 0**: 실제 repo `check_complexity.js` 가
  EXIT=1 반환 = **1500+ 줄 파일이 BASELINE_TECHNICAL_DEBT 카탈로그에 없음**. 미커밋 **병렬 strategy-versioning
  작업**(또는 성장한 파일)이 원인일 가능성 높음 → 내 소관 아님.
- `ENOENT: src/__ui_lang_fixtures__/badPromise2.ts` · "expected … to contain 'srcGiant.ts'" (대신
  `server\trading\__yahoo_range_f…` 발견) → 임시 fixture 생성/정리 격리 이슈 (중단된 런 잔여 또는 병렬 fixture 충돌).

→ 결론: 병렬 미커밋 작업 상태에 의존 → **병렬 작업이 main 에 랜딩한 뒤 clean-env 에서 재측정**해야 정확.

---

## 분류 (ADR-533 taxonomy)

| 실패 | 분류 | 조치 |
|------|------|------|
| 5× SyntaxError (`.test.js` 로드) | **ENVIRONMENT_BLOCKED** | 편집 금지. CI/clean-env 에서 재측정 |
| check_complexity 카탈로그 EXIT=1 | **PARALLEL-CONTAMINATED** | 병렬 작업 랜딩 후 재측정 |
| check_complexity ENOENT/temp fixture | TEST_ISOLATION | 병렬 랜딩 후 재현 시에만 정밀 분석 |

**FIXED:** 0 · **NEW_REGRESSION:** 0 · **코드 변경:** 0줄.

---

## 권고 (다음 단계)

1. **scripts self-test 는 burn-down 우선순위에서 보류** — clean CI 환경 + 병렬 작업 랜딩 후 재측정해야
   ENVIRONMENT_BLOCKED ↔ 진짜 실패 구분 가능. 로컬 추측 수정 금지.
2. ADR-534 로드맵에서 "scripts self-test (LOW, 쉬운 수정)" 가정을 본 분류로 **정정** (LOW 이지만 *현재 안전
   타겟 아님*).
3. 다음 burn-down 후보로는 **결정적(deterministic)·env 비의존** 실패가 더 적합 — 예: ADR-534 의 telegram
   formatter type 정합(MEDIUM, ADR-531/532 severity route) 등, 단 Patch Plan 선행.

No-Regression baseline → `adr-533` · burn-down 지도 → `adr-534`.
