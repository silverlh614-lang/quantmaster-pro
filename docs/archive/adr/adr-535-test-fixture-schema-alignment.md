# ADR-535 — Test Fixture Schema Alignment & Factory Discipline

**Read this file only when working on:**
- 테스트 mock/fixture 를 작성·정렬할 때의 canonical 기본 shape
- SourceSnapshot/Gate/Provider/Telegram/Shadow mock 의 불변식 보존 default
- TEST_FIXTURE_DRIFT 실패를 다룰 때 (현재 baseline 에는 부재)

**Do not read this file for:**
- 일반 코딩 (test-fixture 규율 전용 reference) → 평소 로드 금지
- 런타임 assertion 실패 burn-down → `docs/archive/adr/adr-534-baseline-failure-burndown.md`
- baseline 수치 → `docs/archive/adr/adr-533-typecheck-baseline-no-regression.md`

> **Status:** ADR-535 = **재범위된 문서 SSOT** (코드 0줄, runtime byte-equivalent).
> **핵심 발견(ADR-533/534):** typecheck **0 errors** + import 에러 **0** + ADR-527~534 의 `.ts` 변경 **0줄**
> → **type-shape fixture/mock drift 는 부재**한다 (필드 누락이면 `tsc` 가 잡음). 따라서 fixture **대량
> 재작성은 타겟이 없고 정당화되지 않는다.** 본 ADR 은 (1) drift 부재를 검증·기록하고 (2) 향후 테스트
> 작성을 위한 **canonical test-factory 규율을 forward guideline 로 확립**한다. 동작하는 테스트를 건드리지 않는다.

---

## 1. 검증 결과 (drift 부재)

| 항목 | 결과 |
|------|------|
| `npm run typecheck` (=lint) | PASS, 0 errors → mock shape 가 타입과 일치 (type-shape drift 없음) |
| import/module 에러 | 0 (`Cannot find module` 0) → obsolete import/export drift 없음 |
| 기존 test-factory 인프라 | 없음 — 테스트가 inline mock 생성. `__fixtures__`/`test-utils`/`factories` 디렉토리 부재 |
| 310 test 실패의 본질 | 런타임 AssertionError (값/동작) — **fixture schema 문제 아님** (→ ADR-536~539) |

**결론:** TEST_FIXTURE_DRIFT(type-shape) = 0건. FIXED_BASELINE_FAILURE = 0 (fixture 정렬로 해소할 실패 없음).
무리하게 동작하는 테스트를 재작성하면 NEW_REGRESSION 위험 → **금지.**

---

## 2. Canonical Test-Factory 규율 (forward guideline)

향후 테스트/ADR-536~539 가 mock 을 작성·수정할 때 따른다. **테스트 전용**, production runtime import 금지.
누락 필드 추가 시점에 inline 중복 대신 아래 factory 패턴 채택 권장.

```ts
// 테스트 전용. production 에서 import 금지.
export function createMockSourceSnapshot(overrides: Partial<SourceSnapshot> = {}): SourceSnapshot {
  return {
    snapshotId: 'test-snapshot',
    asOf: '2026-01-01T00:00:00.000Z',
    marketSession: 'REGULAR',
    providerIssue: false,   // marketSignal 과 분리 (불변식 #6)
    marketSignal: false,
    confidence: 'VERIFIED',
    executionImpact: 'NONE', // 기본 NONE
    ...overrides,
  };
}
```

**불변식-보존 default 원칙:**
- `providerIssue` 와 `marketSignal` 분리 — providerIssue=true 가 marketSignal=true 를 의미하지 않게.
- `executionImpact` 기본 `'NONE'`.
- R6/SELL_ONLY/HOLIDAY fixture 는 SourceSnapshot 을 바꾸지 않고 Policy/Confidence/ExecutionPermission/
  LearningLabel 차이로 표현 (불변식 #4·#5).
- Shadow fixture 는 SELL_ONLY/R6/providerIssue 하에서도 `shadowAllowed=true` (불변식 #2·#8),
  `liveExecutionAllowed=false` 와 동시 표현 가능.

---

## 3. 도메인별 필수 fixture 케이스 (normative spec — 향후 채택용)

- **SourceSnapshot:** ① normal verified ② providerIssue isolated(executionImpact=NONE) ③ SELL_ONLY policy
  ④ R6_DEFENSE policy ⑤ HOLIDAY observe ⑥ SHADOW_ONLY ⑦ stale-but-safe-degraded.
- **Gate:** ① Gate1 pass ② Gate1 threshold not met ③ policy-skipped but diagnostic preserved
  ④ Gate3 RRR missing diagnostic-only ⑤ candidateSnapshot with sourceSnapshotId. (blockerReason ≠ executionImpact)
- **Provider:** ① KIS verified ② KIS accepted-empty(executionImpact=NONE) ③ KRX fallback all-failed non-blocking
  ④ stale/confidence-downgraded ⑤ P3 budget exceeded(dataVacuum=false). (provider health ≠ market signal)
- **Telegram:** ① signal→CH2 ② position→CH2 ③ provider diagnostic→CH3/Admin ④ suppressed→aggregate-only
  ⑤ user-requested /scan_blockers→Bot ⑥ DEBUG not user-facing ⑦ /pos shadow ⑧ /pnl virtual.
  (DIAGNOSTIC/DEBUG/SUPPRESSED ↛ CH2; → `adr-531`/`adr-532`)
- **Shadow:** ① BUY approved ② order created ③ paper filled ④ position opened ⑤ liquidation executed
  ⑥ duplicate suppressed ⑦ TP1_THEN_BREAKEVEN / WIN_BREAKEVEN outcome ⑧ counterfactual while live blocked.

---

## 4. 금지 (ADR-535 범위)

test skip/only 추가 · assertion 약화 · `any`/`@ts-ignore`/`@ts-expect-error` 남발 · tsconfig exclude 확장 ·
production 타입을 fixture 에 맞춰 후퇴 · runtime 로직 변경 · SourceSnapshot/Gate/Provider/Shadow 의미 변경 ·
**동작하는 테스트 재작성**(drift 부재이므로 불필요).

---

## Patch Report — ADR-535

- **Changed Files:** `docs/archive/adr/adr-535-*.md`(신규) · `docs/ai/08-testing-checklist.md` · `docs/ai/10-patch-history-index.md`. **코드 0줄.**
- **Domains Touched:** documentation only.
- **Behavior Changed?** NO.
- **Fixture Groups Updated:** 0 (drift 부재 — 재작성 불필요). canonical factory 규율을 forward guideline 로 문서화.
- **Tests Run:** typecheck PASS(0). test 미재실행 (코드 무변경 → baseline 310 불변, ADR-533 인용).
- **Fixed Baseline Failures:** 0.
- **Remaining Baseline Failures:** 310 (런타임 assertion — ADR-536~539 소관).
- **New Regressions:** 0.
- **Follow-up:** ADR-536(scripts self-test) · 537(time/env isolation) · 538(telegram type) · 539(provider/shadow/trading assertion, 분할).
- **Rollback:** git revert 1 커밋 (문서).
