# ADR-0632 — Counterfactual 데이터 위생: ADR-0430 ledger row 에 sourceSnapshot/candidateSet/entryPriceHint 캡처 (forward)

@responsibility ADR-0430 counterfactual ledger row 에 sourceSnapshotId/candidateSetId/entryPriceHint 를 flag-gated forward 캡처해 outcome board 3-관문 INCLUDED 전환·shadow→live 승격용 mature 표본을 가속한다. 라이브 byte-identical.

- **Status:** Proposed (Phase 0 — architect 경계·필드 캡처 지점·flag/SSOT·노출 검증 pin. 구현 engine-dev 완료·검증 통과 working tree.)
- **Date:** 2026-06-18
- **Type:** ADR (신규 데이터-위생 캡처 정책 + flag 경계 — forward-only)
- **Supersedes / extends:** ADR-0430(counterfactual shadow learning candidate/lane) · ADR-0433(counterfactual outcome attribution) · ADR-0476(forward-outcome ledger) · ADR-0528(reference-price wiring) · ADR-0555(forensic id canonicalization) · ADR-0561(KIS-primary absolute) · ADR-0631(shadow→live 승격 준비도 진단) 위에 **forward 캡처 위생**을 얹는다. 새 board/판정 엔진이 아니다.
- **executionImpact:** NONE (flag OFF byte-identical·신규 fetch 0·라이브 본체 0줄)

---

## 1. Context

ADR-0631 의 `/promotion_readiness` 진단이 두 레버 모두 `INSUFFICIENT` 으로 막힌다. 직접
원인은 counterfactual outcome board 의 **mature 표본 부족(`matureD5 = 95 / 1036`)** 이다.
board 가 row 를 mature 표본으로 포함(INCLUDED)하기 전에 통과시키는 제외 관문은 순차적이고
**3 필드를 동시에 충족**해야 한다(`counterfactualOutcomeBoard.ts`):

1. `:985` `sourceSnapshotId` (non-empty) — 미충족 시 `MISSING_SOURCE_SNAPSHOT_ID`
2. `:986` `candidateSetId` (non-empty) — 미충족 시 `MISSING_CANDIDATE_SET_ID`
3. `:988` `referencePrice` (finite positive) — 미충족 시 `MISSING_REFERENCE_PRICE`

현 제외 분포:

| 제외 사유 | 건수 | 성격 |
|-----------|------|------|
| `MISSING_SOURCE_SNAPSHOT_ID` | **2763** | **forward 갭** — ADR-0430 후보 타입 `CounterfactualShadowLearningCandidate` 에 `sourceSnapshotId`/`candidateSetId` 필드 자체가 부재 → 신규 row 가 100% 이 관문에서 제외, 자기치유 불가 |
| `DIAGNOSTIC_REPLAY_ARTIFACT` | 2624 | **정당 제외** — `ADR_*` 진단/replay artifact. 손대지 않음 |
| `MISSING_REFERENCE_PRICE` | 100 | 부분 (candidateSetId 경로 set 시 함께 해소) |

**핵심 진단:** 최대 제외(`MISSING_SOURCE_SNAPSHOT_ID = 2763`)는 데이터 품질 문제가 아니라
**필드 미캡처(forward 갭)** 다. `deriveCounterfactualShadowLearningCandidate` 가 row 를 만들
때 `sourceSnapshotId`/`candidateSetId` 를 stamp 하지 않으므로, 앞으로 만들어질 모든 row 도
같은 운명이다. board 는 정상이고 — **입력 row 가 위생적이지 않다.** ADR-0631 진단이
데이터를 기다려도, 그 데이터는 영원히 INCLUDED 로 전환되지 않는다.

`DIAGNOSTIC_REPLAY_ARTIFACT = 2624` 는 의도된 정당 제외(`ADR_*` 진단·replay)이며 본 ADR 의
대상이 아니다 — 손대지 않는다. `MISSING_REFERENCE_PRICE = 100` 은 `candidateSetId` 가
set 되는 동일 경로에서 referencePrice 도 함께 채워지므로 부분적으로 같이 해소된다.

---

## 2. Decision

**forward-only 캡처를 flag 뒤에서 추가**한다. board/repo/Gate 채점/SourceSnapshot 생성기는
무수정. 캡처는 candidate 파생 시점에만 일어난다.

### 2.1 flag (default OFF)

- **flag:** `COUNTERFACTUAL_SNAPSHOT_CAPTURE_ENABLED` — default **OFF** (`=== 'true'`, ADR-0157 패턴).
- **SSOT 함수:** `isCounterfactualSnapshotCaptureEnabled()`.
- OFF → 3 필드 캡처 분기는 spread `{}` 로 무력화 → candidate 키 집합 byte-identical.

### 2.2 캡처 로직 (ON 시)

`deriveCounterfactualShadowLearningCandidate` 가 flag ON 일 때 3 필드를 **flag-gated
conditional stamp** 한다. 각 필드는 가드 통과분만 stamp:

- `sourceSnapshotId` — non-empty string 가드 통과분만.
- `candidateSetId` — non-empty string 가드 통과분만.
- `entryPriceHint` — finite-positive number 가드 통과분만.

가드 미통과분은 stamp 0(spread `{}`) → board 가 기존대로 해당 row 를 제외한다(거짓 양성 0).

### 2.3 `candidateSetId` canonical 포맷

`index.ts` 의 `selectCandidates` 직후, `ctx.candidateSetId` 를 canonical 포맷으로 set 한다:

```
candidateSet:${sourceSnapshotId}:${count}
```

(`buildCanonicalForensicIds`, ADR-0555 와 동형.) 이 set 은 **log/carry-only** 다 — 신규
fetch·신규 SourceSnapshot 생성 0. carry 된 `ctx.candidateSetId` 를 candidate 파생이 stamp
한다.

### 2.4 무수정 경계 (명시)

다음은 **0 줄 변경**: `counterfactualOutcomeBoard.ts`(board 본체)·counterfactual repo·
`kisClient`·`autoTradeEngine`·Gate 채점(`requiredScore=70`)·SourceSnapshot 생성기.

### 2.5 안전 속성

- **flag OFF byte-identical** — 3 개 spread `{}` → candidate 키 불변 → 기존 row·board 출력 byte-identical.
- **backfill 불가** — forward-only. legacy 2763 row 는 FIFO 로 자연 소멸(소급 write 0).
- **rollback** — ENV 1 줄(`COUNTERFACTUAL_SNAPSHOT_CAPTURE_ENABLED=false`).

---

## 3. 불변식 준수 (9대 + 단일 통로)

- **#2 Shadow Learning 무중단:** 표본을 **확대**하는 방향. shadow 루프 정지 0.
- **#3 / #9 SourceSnapshot 단일 통로:** `candidateSetId` 는 **carry only** — 신규 SourceSnapshot fetch 0, Gate 내부 provider 직접 조회 0.
- **#7 AI_ESTIMATED(L4) live 금지:** `entryPriceHint` 는 **L1 KIS BUY_EVAL `getPrice` 재사용** — L4 추정값이 아니다. 측정 기준가일 뿐 직접 매매 결정에 쓰지 않는다.
- **#8 shadow 차단 ≠ live 차단:** lane literal `liveAllowed:false`·`paperAllowed:false`·`executionShadowAllowed:false`·`virtualAccountImpact:NONE` 무수정 → 라이브 byte-identical.
- **executionImpact:** NONE (라이브 본체 0 줄).

---

## 4. Patch Scope Guard (ADR-530)

- **targetDomain:** Shadow/Learning + SourceSnapshot-carry (2 도메인).
- **allowedFiles:**
  - `counterfactualShadowLearningLane.ts` (3 필드 flag-gated stamp)
  - `index.ts` (`candidateSetId` set — selectCandidates 직후)
  - `perSymbol/steps/counterfactualShadowLane.ts`
  - `buyListLoop.ts:487`
  - `.env.example` (flag)
  - 신규/확장 테스트
- **forbiddenFiles:** `counterfactualOutcomeBoard.ts`(board 본체)·counterfactual repo·`autoTradeEngine`·`kisClient`·Gate 채점·`requiredScore=70` SSOT.
- **expectedBehaviorChange:** flag ON 시 신규 ADR-0430 row 가 3 필드 stamp 를 가져 board 3-관문 INCLUDED 전환. flag OFF byte-identical.
- **sourceSnapshotImpact:** NONE (carry only·생성기 미접촉 — 불변식 #3/#9).
- **executionImpact:** NONE.
- **shadowLearningImpact:** 표본 확대(정지 0 — 불변식 #2).
- **telegramImpact:** NONE (board 출력 포맷 무변경).
- **providerImpact:** NONE (신규 fetch 0·`entryPriceHint` 는 기존 KIS `getPrice` 재사용).
- **testsRequired:** flag ON 3 필드 stamp·각 필드 가드(non-empty/finite-positive) 미통과분 stamp 0·flag OFF candidate 키 byte-identical·canonical `candidateSetId` 포맷·E2E board INCLUDED/EXCLUDED 전환.
- **rollbackPlan:** ENV 1 줄(`COUNTERFACTUAL_SNAPSHOT_CAPTURE_ENABLED=false`) → byte-identical.

---

## 5. 검증 (engine-dev 완료)

- **정적:** `lint` PASS · `validate:all` 27 검사 EXIT 0 · `precommit` PASS.
- **단위:** 신규 6 + ADR-0430 lane 35/35 + board 10 + perSymbol 130 green.
- **E2E §0632-3:** flag ON → board `includedRows=1`·`excludedRows=0` (3 관문 통과 INCLUDED 전환), flag OFF → `MISSING_SOURCE_SNAPSHOT_ID`.
- **complexity:** lane 633 · board 1398 (< 1500).
- **WARN baseline:** 무증가.

---

## 6. Consequences

- 미래 ADR-0430 row 가 INCLUDED 로 전환된다 → D5 성숙(수일~수주) 후 `matureD5` 가 증가한다 → ADR-0631 `/promotion_readiness` 판정에 필요한 데이터가 가속된다.
- `candidateSetId` 가 이 경로에서 set 되므로 `referencePrice` 포함 **3 관문이 즉시 해소**된다(개별 row 가 3 필드 모두 갖춤).
- legacy 2763 row 는 backfill 하지 않으므로 즉시 변화 0 — FIFO 자연 소멸을 기다린다(데이터 위생의 정도).

---

## 7. Alternatives Considered

1. **`sourceSnapshotId` 만 채움** — `candidateSetId` 관문(`:986`)에서 여전히 제외 → no-op. **기각.**
2. **board 제외 관문 완화** — 3 필드 충족 요구를 낮춤. 데이터 위생을 우회해 board 진실성 훼손. 정도는 입력 위생. **기각.**
3. **default ON** — opt-in 원칙 위반(ADR-0157). **기각** — default OFF.
4. **`DIAGNOSTIC_REPLAY_ARTIFACT` 도 캡처 대상 포함** — 진단/replay artifact 의 정당 제외를 깨뜨림. **기각** — 손대지 않음.

---

## 8. References

- ADR-0430 — counterfactual shadow learning candidate / lane (본 캡처 대상 row 의 출처)
- ADR-0433 — counterfactual outcome attribution
- ADR-0476 — Gate1 dry-run observation ledger (forward-outcome SSOT)
- ADR-0528 — reference-price wiring
- ADR-0555 — forensic id canonicalization (`buildCanonicalForensicIds`)
- ADR-0561 — KIS-primary absolute (`entryPriceHint` = L1 KIS `getPrice`)
- ADR-0631 — shadow→live 승격 준비도 진단 (본 ADR 이 가속하는 데이터의 소비자)
- CLAUDE.md §2.1 불변식 #2·#3·#7·#8·#9 · §2.2 requiredScore=70 절대불변
