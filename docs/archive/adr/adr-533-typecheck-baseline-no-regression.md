# ADR-533 — Typecheck Baseline & No-Regression Guard

**Read this file only when working on:**
- 현재 typecheck/test baseline 수치 확인 · No-Regression 판정 기준
- 패치가 baseline 실패 수를 늘렸는지(regression) 점검
- BASELINE_EXISTING_FAILURE vs NEW_REGRESSION 구분

**Do not read this file for:**
- 일반 코딩 (validation baseline 전용 reference) → 평소 로드 금지
- 검증 파이프라인 명령 목록·패치 유형별 검증 → `docs/ai/08-testing-checklist.md`
- 실패 도메인 분류·burn-down 계획 → `docs/archive/adr/adr-534-baseline-failure-burndown.md`

> **Status:** ADR-533 = baseline 기록 + No-Regression Guard 문서화 (코드 0줄, runtime byte-equivalent).
> **목적은 모든 실패를 고치는 게 아니라 기준선을 고정하는 것.** 현재 실패 = baseline,
> 이후 신규 실패 = regression 차단.

---

## Validation Baseline Snapshot

- **Date:** 2026-05-24
- **Branch:** main
- **Commit:** bd574995 (측정 시점)
- **Caveat:** 측정 시 작업 트리에 **미커밋 병렬 작업**(strategy-versioning 외) 존재 — 단, 실패 파일
  99개 중 strategy 관련 0개(`metaCommands.test.ts` 1건만), 병렬 작업의 실패 기여는 미미.

| Command | Exists | Result | Failures | Notes |
|---------|:------:|:------:|---------:|-------|
| `npm run typecheck` (=`lint`) | yes | **PASS** | 0 | `tsc --noEmit` ×2 (client + server) EXIT 0 |
| `npm run test` (vitest run) | yes | **FAIL** | 310 | Test Files 99 failed / 1086 · Tests 310 failed / 13,826 (97.8% pass) · 1 skipped · 462.87s |
| `npm run build` (vite build) | yes | not-run | — | 후속 측정 (typecheck=0 이므로 빌드 타입 안전성은 확보) |
| `npm run validate:all` | yes | not-run | — | 별도 측정 (precommit 체인에서 부분 검증됨) |

### 검증 명령 인벤토리
- typecheck/lint = `tsc --noEmit && tsc --noEmit -p tsconfig.server.json`
- test = `vitest run` (+ `test:server`/`test:client`/`test:telegram`/`test:runtime`/`test:scanner`/`test:changed`)
- build = `vite build` · precommit = 14-스텝 체인 + `lint` · validate:all = 18-스텝 체인

---

## 실패 특성 (baseline 분석)

- **유형:** AssertionError 215건 (`expected … ` 216) 가 압도적 — **런타임 assertion 실패** (expected≠actual).
  TypeError 4 · ReferenceError 1 · ENOENT 4. **import/module 에러 0건** (`Cannot find module` 0).
- **함의 (중요):** typecheck=0 + import 에러 0 → **type-level / fixture-schema drift 는 사실상 없음.**
  실패는 mock shape 불일치가 아니라 *런타임 값 assertion 불일치* (시간/날짜 의존·env 의존·동작 drift 가능성).
- **집중도:** `server/trading` 52 파일 (전체 99 중 과반). clients 8 · telegram 7 · learning 7 · scripts 7.

---

## 실패 분류 기준 (taxonomy)

| 분류 | 정의 |
|------|------|
| **BASELINE_EXISTING_FAILURE** | ADR-533 이전부터 존재 — 이번/이후 패치의 직접 변경 산물 아님 (현재 310건이 이에 해당) |
| **NEW_REGRESSION** | 패치 이후 새로 생긴 실패 — **반드시 수정 또는 rollback** |
| **SCRIPT_MISSING** | 검증 명령이 package.json 에 부재 |
| **ENVIRONMENT_BLOCKED** | 로컬 env/네트워크/secret/API key 부재로 실행 불가 (310 중 일부 추정 — 정밀 귀속은 ADR-534) |

---

## No-Regression Guard (정책)

**기준선:** typecheck 0 errors · test ≤ 310 failed (측정 시점). 이후 어떤 패치도:

1. **신규 type error 0** — `npm run lint` 는 항상 EXIT 0 유지 (typecheck 회귀 절대 금지).
2. **신규 test 실패 0** — 실패 수를 baseline(310) 이상으로 늘리지 않는다.
3. baseline failure 해소는 **별도 ADR**(burn-down, ADR-534+)로 분리 — 무관 실패를 같은 PR 에서 고치지 않는다.
4. 실패를 약화/은폐 금지 — test skip/only, `any`, `@ts-ignore`, tsconfig exclude 확장으로 통과시키지 않는다.
5. 검증 명령 부재 시 무시하지 말고 SCRIPT_MISSING 보고. env 불가 시 ENVIRONMENT_BLOCKED + 사유 보고.

---

## 후속 ADR
- **ADR-534** — Baseline Failure Burn-down Plan (310건 도메인/위험도 분류 + 후속 ADR 지도).
- ADR-535+ — 분류 결과에 따라 LOW 위험부터 소규모 ADR 로 burn-down.

검증 파이프라인·패치 유형별 기준 → `docs/ai/08-testing-checklist.md` · Patch Scope Guard → `docs/ai/09-refactor-rules.md`.
