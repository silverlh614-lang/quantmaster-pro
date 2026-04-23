---
name: quantmaster-orchestrator
description: "QuantMaster Pro 에이전트 팀(architect / engine-dev / dashboard-dev / quality-guard) 조율. 매매 엔진·퀀트 필터(Gate 0/1/2/3)·변곡점 모듈(THS/VDA/FSS/IPS)·대시보드·스크리너 구현/수정/리팩토링/버그 수정 요청이 들어오면 즉시 이 스킬을 호출하라."
---

# QuantMaster Orchestrator

QuantMaster Pro 4-에이전트 팀의 조율 규약. CLAUDE.md의 "하네스" 섹션이 가리키는
메인 엔트리.

## 언제 사용하는가

**사용 O**
- 새 Gate 조건 추가/수정 (Gate 0~3, bear engine)
- 매매 엔진(signalScanner, entryEngine, exitEngine, OCO 루프) 수정
- 스크리너(stockScreener, universeScanner, intradayScanner) 수정
- 대시보드 섹션 추가/재배치, 차트 교체
- 1,000줄+ 파일 분해 (→ `server-refactor-orchestrator` 로 에스컬레이션)
- 텔레그램 봇 명령 추가/수정

**사용 X**
- "이 함수가 뭐야?" 같은 단순 질문
- 오탈자, 주석 수정, 단일 라인 타입 에러 수정
- `README.md` 문구 교정

## Phase 0 — 컨텍스트 확인

1. `_workspace/` 디렉토리에 관련 작업물이 있는지 확인 (부분 재실행 판정)
2. `ARCHITECTURE.md`를 읽고 영향받는 모듈의 Boundary Rule 식별
3. `CLAUDE.md` "기존 복잡도 위반" 표에 해당 파일이 있는지 확인 — 있다면 **먼저
   `server-refactor-orchestrator` 로 분해 후 진행**

## Phase 1 — 준비

1. `_workspace/{YYYY-MM-DD}_{task-slug}/` 생성
2. 관련 문서 로드:
   - `CLAUDE.md` (절대 규칙)
   - `ARCHITECTURE.md` (경계 규칙)
   - `README.md` 관련 섹션 (도메인 정의)
   - `docs/incident-playbook.md` (해당 영역 장애 모드)
3. 변경 범위 요약을 사용자에게 1~3문장으로 공유 (암묵적 승인 or 명시 확인)

## Phase 2 — 팀 구성

항상 4인 고정. 작업에 따라 특정 에이전트가 no-op일 수 있음.

- `architect` — 경계·타입·ADR
- `engine-dev` — 서버 비즈니스 로직 + KIS/스크리너/퀀트
- `dashboard-dev` — 프론트엔드 + 상태
- `quality-guard` — QA/보안/교차 비교

## Phase 3 — 구현

의존 순서: **architect → (engine-dev ∥ dashboard-dev) → quality-guard**

1. **architect**: 필요한 타입·ADR·경계 확정. 분해 설계가 필요하면 이 단계에서.
2. **engine-dev ∥ dashboard-dev**: 독립적으로 병렬 실행. 양쪽 모두에 영향이 있으면
   타입 계약을 먼저 architect가 pin한 뒤 병렬.
3. **quality-guard**: 검사 위임은 Phase 4에서.

`_workspace/.../{agent}/` 아래에 각 에이전트 산출물 기록.

## Phase 4 — 통합 검증 ⭐ (핵심)

**필수 실행 순서** (quality-guard 담당):

```bash
# 1. 타입 체크
npm run lint

# 2. 커스텀 검증 5종
npm run validate:all

# 3. 변경 모듈 테스트
#    engine-dev: server/**/*.test.ts 중 해당 파일
#    dashboard-dev: src/**/*.test.{ts,tsx}
#    실행은 vitest 로 해당 파일 지정 실행을 권장

# 4. 경계면 교차 비교 (quality-guard 체크리스트)
#    - kisClient 외 raw KIS 호출 없음?
#    - stockService 외 외부 API 직접 호출 없음?
#    - 클라이언트 실주문 경로 없음?
#    - UI 가 서버 로직을 복제하지 않음?

# 5. 최종 게이트
npm run precommit
```

**실패 시**: 해당 에이전트에게 수정 위임 → 재검증 루프. `precommit` 훅 우회 금지.

## Phase 5 — 정리

1. **CLAUDE.md 변경 이력** 테이블에 한 줄 추가 (날짜 / 변경 내용 / 대상 / 사유).
2. **의미 있는 커밋 메시지** 작성. 템플릿:

   ```
   <type>(<scope>): <1줄 요약>

   - 변경 요지 불릿 2~5개
   - 영향 받는 경계/모듈 명시
   - 회귀 테스트/검증 스크립트 통과 여부

   Co-authored-by: QuantMaster Harness <harness@claude>
   ```

   `type` 예: `feat` `fix` `refactor` `chore` `docs`.
   `scope` 예: `signalScanner` `kisClient` `gate3` `dashboard` `webhook`.

3. **_workspace 보존**: 타임스탬프 디렉토리를 삭제하지 않음 (재호출 컨텍스트).

## 자동 스냅샷 커밋 정책

`npm run dev` 가 만들어내는 `snapshot: YYYY-MM-DD HH:MM` 커밋은 개발 중 로컬 안전망일 뿐,
의미 있는 변경에는 반드시 Phase 5의 명시적 커밋 메시지를 작성한다. 스냅샷 커밋을
리베이스/스쿼시로 정리할지는 사용자 승인 사안.

## 재호출 시나리오

사용자가 "Phase 4 재실행" 같이 특정 단계만 요청하면, `_workspace/`의 상태를 읽고
누락된 단계만 수행한다. 전체 리셋이 필요하면 사용자 명시 확인.
