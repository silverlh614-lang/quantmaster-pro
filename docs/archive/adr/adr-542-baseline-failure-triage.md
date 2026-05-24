# ADR-542 — Baseline Failure Triage (Deterministic vs Environment) & Clean-Tree Gate

**Read this file only when working on:**
- 310 baseline 실패를 실제로 burn-down 하기 전 — 어떤 게 진짜 실패인지 판정
- ENVIRONMENT_BLOCKED vs DETERMINISTIC 분류 근거 확인

**Do not read this file for:**
- 일반 코딩 → 평소 로드 금지
- baseline 수치/No-Regression → `adr-533` · burn-down 도메인 분류 → `adr-534`
- scripts self-test env 분류 → `adr-541`

> **Status:** ADR-542 = triage 분석 (read-only test 로그 분석, 코드 0줄).
> **번호:** 선행 대기 작업이 536~540 점유 → 541 다음 542.
> **핵심 발견: 310 실패는 env-noise 가 아니라 대부분 *결정적 assertion*. 그러나 트리가 미커밋 병렬
> 작업으로 오염돼 있어, 신뢰할 수 있는 baseline 귀속·안전한 burn-down 은 *clean tree* 가 전제다.**

---

## Triage 결과 (기존 full `vitest run` 로그 분석, @bd574995)

| 신호 | 건수 | 해석 |
|------|-----:|------|
| 네트워크 차단 (ECONNREFUSED/ETIMEDOUT/fetch failed/ENOTFOUND) | **0** | 테스트가 network 를 잘 mock → **network env-block 아님** |
| `SyntaxError: Invalid or unexpected` (vitest-env load) | 5 | scripts self-test — ENVIRONMENT_BLOCKED (→ `adr-541`) |
| ENOENT (temp fixture) | 6 | test-isolation/temp fixture |
| test/hook timed out | 2 | 소수 timing |
| 날짜/시간 의존 assertion (2026/FOMC/tradeDate/KST/holiday) | ~10 | 일부 시간 의존 |
| **AssertionError (총)** | **215** | **지배적 — 결정적 expected≠actual** |

→ 종전 가설("대부분 env-blocked")은 **부분적으로만 옳음**(scripts 5건만). 실제로는 **결정적 assertion 이 지배적**.
network 차단 0 = 로컬에서도 재현되는 *진짜* 실패가 다수.

---

## 그러나 — Clean-Tree Gate (burn-down 전제)

측정 시 작업 트리에 **미커밋 병렬 작업**이 존재 (strategy-versioning 13+ 파일 신규 + `server/learning/outcomeClosure.ts`
· `server/telegram/metaCommands.ts` · `server/telegram/commands/learning/index.ts` 수정).

**실패 집중 도메인 = 병렬 작업 도메인이 겹친다:**
- 실패: `server/trading` 52 · `server/learning` 7 · `server/telegram` 7 (→ `adr-534`)
- 병렬 작업: learning(outcomeClosure·strategy*) · telegram(metaCommands·learning/index)
- 확증: `server/telegram/metaCommands.test.ts` 가 실패 목록에 있음 (병렬이 `metaCommands.ts` 수정).

→ **귀속 불가:** 이 트리에서 "baseline 실패"와 "병렬 작업이 유발한 실패"를 신뢰성 있게 구분할 수 없다.
오염된 트리에서 burn-down 수정을 하면 (a) 병렬 작업과 충돌 (b) 곧 바뀔 동작을 잘못 고침 (c) regression 위험.

---

## 권고 (gate 충족 순서)

1. **병렬 작업을 main 에 랜딩하거나 stash** → **clean tree** 확보 (병렬 작업은 내 소관 아님 — 사용자/해당 작업자 처리).
2. clean tree + clean-CI 에서 `npm run test` **재측정** → 진짜 baseline 실패 수 확정.
3. 그 후에야 도메인별 burn-down (ADR-534 의 537~539) 을 **Patch Plan 선행**으로 안전 진행.
4. **시간 의존(~10)** 은 deterministic mock(고정 clock)으로 우선 처리 가능 — 단 clean tree 후.

**현 시점 안전 결론:** 추가 코드 burn-down 은 **clean tree 전까지 보류.** 이 ADR 은 그 gate 를 명시해
오염된 트리에서의 무리한 수정을 차단한다.

baseline → `adr-533` · 도메인 분류 → `adr-534` · scripts env 분류 → `adr-541`.
