# 09 · Refactor Rules (복잡도 한계·분해 워크플로·baseline 카탈로그)

**Read this file only when working on:**
- **Patch Scope Guard · Patch Plan/Report** (코드 수정 전 범위·영향도 선언)
- 1,500줄 한계에 근접/초과한 파일 분해 · 대형 서버 파일(1,000줄+) 모듈 분리
- SRP 준수 · no broad rewrite · patch scope 제한 · warning cleanup
- BASELINE_TECHNICAL_DEBT 카탈로그 · 복잡도 위반 우선순위
- ADR INDEX `다음 발급` SSOT · pending wiring SLA 갱신

**Do not read this file for:**
- 검증 파이프라인·precommit·PR 자가 review → `08-testing-checklist.md`
- 현재 복잡도 위반 파일 목록(요약)·모듈 경계 → `01-architecture-map.md`
- PR 범위·diff 출력·ADR vs patch type → `CLAUDE.md` §5

---

## Patch Scope Guard (ADR-530)

**모든 패치는 코드 수정 전 Patch Plan 으로 시작한다.** 템플릿 →
`docs/ai/templates/patch-plan-template.md` · 완료 후 `docs/ai/templates/patch-report-template.md`.

필수 선언 필드: `ADR` · `targetDomain` · `intent` · `allowedFiles` · `forbiddenFiles` ·
`expectedBehaviorChange` · `sourceSnapshotImpact` · `executionImpact` · `shadowLearningImpact` ·
`telegramImpact` · `providerImpact` · `learningImpact` · `riskLevel` · `testsRequired` · `rollbackPlan`.

### 규칙

1. 무관한 도메인을 수정하지 않는다 — `allowedFiles` 밖은 건드리지 않는다.
2. 영향 도메인이 **3개를 초과하면 ADR 을 분리**한다.
3. **문서 전용 패치**는 `src/` · `server/` · `scripts/` 코드(서비스/엔진/provider/telegram/gate)를 수정하지 않는다.
4. **warning cleanup** 은 명시되지 않는 한 매매 의미(trading semantics)를 바꾸지 않는다 — behavior change 와 섞지 않는다.
5. **refactor** 패치는 외부 동작(byte-equivalent)을 보존한다.
6. 테스트나 호환 계층 없이 broad rewrite 금지.
7. resolver · router · scheduler · lifecycle engine 을 **중복 생성하지 않는다** (기존 SSOT 위임).
8. SourceSnapshot 을 우회하지 않는다 (불변식 #3·#9).
9. providerIssue 를 marketSignal 로 변환하지 않는다 (불변식 #6).
10. taxonomy 분류 없이 에러를 silent 처리하지 않는다 (`/* SDS-ignore: <사유> */`).

> 사고 방지 대상: "Gate 수정인 줄 알았는데 Provider 를 건드림 / Telegram 표시 수정인 줄 알았는데
> Engine policy 를 바꿈 / warning 제거인 줄 알았는데 runtime semantics 를 바꿈 / 문서 정리인 줄
> 알았는데 src 코드까지 수정함." → Patch Plan 의 `allowedFiles`/`forbiddenFiles` 로 차단.

패치 유형별 최소 검증 기준 → `docs/ai/08-testing-checklist.md`.

---

## 복잡도 한계 (절대 규칙 #6)

- **파일당 1,500줄** (`scripts/check_complexity.js` 강제). 초과 시 즉시 분할 — **ADR 선행**.
- 분해는 단일 책임(Single Responsibility) 기준 — `ARCHITECTURE.md` 모듈 경계 재확인 후.
- 분해 전 해당 모듈의 책임을 ADR 에 명시 → 추출 대상 함수/타입 경계 확정 → 추출 → 회귀 테스트.

---

## 분해 워크플로 (ADR-first)

1. **ADR 발급** — 분해 대상·새 경계·추출 모듈 책임 명시 (`docs/adr/INDEX.md` `다음 발급` SSOT + 갱신).
2. **architect 위임** — `src/types/` 확정 + ADR 작성 (`validate:responsibility` 통과).
3. **추출** — `server-refactor-orchestrator` 스킬로 1,000줄+ 서버 파일 분해 (engine-dev).
4. **회귀** — 추출 전후 동작 byte-equivalent 검증 + 해당 `*.test.ts` 통과.
5. **변경 이력** — `docs/ai/10-patch-history-index.md` 한 줄.

전용 스킬: `server-refactor-orchestrator` (1,000줄+ 서버 파일 분해).

---

## 현재 복잡도 위반 (분해 우선순위)

| 파일 | 줄수 | 우선순위 |
|------|------|----------|
| `signalScanner.ts` | ~1,820 | **P0** |
| `entryFilterDecomposition.ts` | ~1,720 | P1 |
| `investorFlowProviderRouterAdr0477.ts` | ~1,540 | P1 |
| `minimumSignalScoreTrace.ts` | ~1,520 | P2 |

> 줄수는 변동한다 — 분해 작업 전 `validate:complexity` 로 실측 재확인.

### 완료된 분해 (참조 패턴)

- `perSymbolEvaluation` (ADR-0134) · `webhookHandler` (ADR-0017) · `exitEngine` (ADR-0028) ·
  `stockScreener` (ADR-0029) · `krxClient` (ADR-0502c).

---

## BASELINE_TECHNICAL_DEBT 카탈로그 (ADR-0133)

- **baseline 카탈로그** — 알려진 기술 부채를 명시 등록. 신규 위반과 기존 baseline 을 구분.
- **무회귀 원칙** — PR 은 baseline 위반 수를 **늘리지 않는다** (ADR-0146 카테고리 5).
  baseline 항목 해소는 가산점, 신규 위반 추가는 차단.
- 1,500줄 초과 파일은 baseline 등록 + 분해 ADR 예약 — 방치 금지 (절대 규칙 #6).

---

## ADR INDEX / pending wiring SLA

- **ADR INDEX SSOT** (ADR-0148) — `docs/adr/INDEX.md` `다음 발급` 번호 단조 증가. 중복/건너뜀 차단.
- **pending wiring SLA** (ADR-0158/0159) — 인프라만 추가하고 호출 연결을 미룬 항목은 SLA 추적.
  dead wiring(코드 있으나 호출 없음) 장기 방치 차단 (`validate:pendingWiring`).
- **ADR type vs patch type** (→ `CLAUDE.md` §5) — 신규 경계/정책만 ADR 발급. hotfix/정합 정정/
  진단 가시화는 patch type (ADR 0건, INDEX 갱신 0건).

복잡도 현황 상세 → `docs/ai/01-architecture-map.md` · 검증 파이프라인 → `docs/ai/08-testing-checklist.md`
PR 범위·ADR 규칙 → `CLAUDE.md` §5 · 과거 변경 이력 → `docs/ai/10-patch-history-index.md`
