# QuantMaster Pro — AI 실행 규칙 (CLAUDE.md)

> **본 문서는 최상위 실행 규칙 SSOT 다.** 상세 내용은 `docs/ai/00`~`10` 으로 분리됐다 (ADR-527·528).
> **작업 전 §6 Reference Docs Router 에서 트리거 키워드에 해당하는 문서 1개만 골라 읽어라.** 각 문서
> 상단의 "Read this file only when working on:" / "Do not read this file for:" 안내가 SRP 경계다.
> CLAUDE.md 에는 **패치 노트를 누적하지 않는다.** 변경 이력은 `docs/ai/10-patch-history-index.md` 에 한 줄로 추가한다.

---

## 1. Project Identity

AI 기반 한국 주식 퀀트 트레이딩 시스템. 27개 조건 + 4단계 Gate(0/1/2/3) 필터를 통과한
종목에만 신호를 출력하며, KIS API로 실제 주문을 집행한다.

- 프론트엔드 + 공유 타입·서비스: `src/` (Vite + React 19 + Zustand + TanStack Query)
- 백엔드: `server/` (Express, KIS 클라이언트, 트레이딩 엔진, 스크리너, 텔레그램)
- 자체 검증 파이프라인: `scripts/` (complexity/responsibility/exposure/sds/gemini)
- 인시던트·ADR: `docs/`

핵심 참조 문서: `README.md` (요구사항·도메인), `ARCHITECTURE.md` (모듈 경계),
`docs/incident-playbook.md` (운영·인시던트), `.env.example` (환경/비밀 분리),
`CLAUDE_patch_section.md` (AI 협업 전체 지침).

상세 정체성·9대 불변식·데이터 신뢰 등급 → **`docs/ai/00-project-charter.md`**

---

## 2. Non-Negotiable Rules (절대 규칙)

### 2.1 9대 불변식 (VERBATIM — 절대 삭제·변경 금지)

1. Trading Engine은 항상 살아 있어야 한다.
2. Shadow Learning은 어떤 상황에서도 멈추면 안 된다.
3. 모든 판단은 단일 SourceSnapshot에서 출발한다.
4. R6, SELL_ONLY, HOLIDAY, 장전/장후, providerIssue는 SourceSnapshot을 바꾸지 않는다.
5. 위 상태들은 Policy, Confidence, ExecutionPermission, LearningLabel만 바꾼다.
6. Provider 장애는 market signal이 아니다.
7. AI_ESTIMATED 데이터는 live execution에 사용하면 안 된다.
8. 실거래 차단과 Shadow 판단 차단은 분리한다.
9. SourceSnapshot을 우회하여 Gate 내부에서 provider를 직접 조회하지 않는다.

### 2.2 7대 단일 통로 규칙

1. **@responsibility 태그 의무** — 모든 새 파일은 상단 20줄 내 25단어 이내 책임 명시
   (`scripts/check_responsibility.js` 강제).
2. **kisClient 단일 통로** — KIS API 호출은 `server/clients/kisClient.ts` 경유만. raw KIS REST 금지.
3. **stockService / aiUniverseService 단일 통로** — 자동매매·서버 스크리너 외부 데이터는
   `src/services/stockService.ts` 에서만. AI 추천(MOMENTUM/QUANT_SCREEN/BEAR_SCREEN/EARLY_DETECT)
   universe 발굴은 `server/services/aiUniverseService.ts` 단일 통로만 (KIS/KRX 직접 호출 금지, ADR-0011;
   자동매매 경로는 본 모듈 import 금지).
4. **autoTradeEngine 단일 통로** — `AUTO_TRADE_ENABLED=true` 상태에서 실주문은 서버 측
   `autoTradeEngine`만 집행. 클라이언트 실주문 금지.
5. **ARCHITECTURE.md 경계 준수** — 수정 전 해당 모듈의 Single Responsibility 재확인.
6. **복잡도 한계** — 파일당 1,500줄 (`scripts/check_complexity.js`). 초과 시 즉시 분할 (ADR 선행).
7. **커밋 전 precommit 필수** — 훅 우회(`--no-verify`) 금지.

### 2.3 데이터 신뢰 등급

L1 (KIS·KRX 공식 → 매수·매도) / L2 (FRED·ECOS·DART → Gate) / L3 (Yahoo·Naver → fallback) /
L4 (AI 추정 → 참조 전용, 직접 매매 결정 금지).

**절대불변식 (ADR-0561) — KIS Primary Absolute:** KIS(L1)가 공급 가능한 레이어에서는 Yahoo(L3)를
primary 로 쓸 수 없다. Yahoo 는 KIS 로 대체 불가능한 경우에만 최후 fallback 으로 차용한다.
quota 는 Yahoo-first 회피 사유가 아니다 — 캐시·배치·rate 관리(엔지니어링)로 해결한다.
(실행경로 Yahoo burn-down 완료 — Gate quote(C1)·LIVE 청산 종가 grandfather 0, ADR-0563. 잔존 13 hit/7파일은
전부 비실행(학습 귀인·텔레그램 표시·KRX-fallback)이라 `FROZEN_NON_EXECUTION_ADR0563` 동결. 신규 Yahoo-first 는 차단.)

상세 매매엔진 규칙 → `docs/ai/02-trading-engine-rules.md` ·
SourceSnapshot SSOT → `docs/ai/03-source-snapshot-ssot.md` ·
Provider 정책 → `docs/ai/05-provider-policy.md`

---

## 3. Agent Workflow

**하네스 트리거:** 매매 엔진 / 퀀트 필터(Gate 0~3) / 대시보드 / 변곡점 모듈(THS/VDA/FSS/IPS) /
서버 리팩토링 작업 요청 시 `.claude/skills/quantmaster-orchestrator` 스킬 사용.
전용 스킬: `server-refactor-orchestrator` (1,000줄+ 서버 파일 분해), `incident-responder` (Telegram/로그 진단).

**단순 질문은 직접 응답.** (예: "이 함수가 뭐야?", "타입 오류 한 줄 수정")
**복잡 작업은 하네스 필수.** (예: "새 Gate 조건 추가", "signalScanner 분해")

**에이전트 팀 (4인):**

| 역할 | 담당 영역 | DoD |
|------|-----------|------|
| `architect` | `ARCHITECTURE.md` 경계, `src/types/`, ADR 작성 | `validate:responsibility` 통과 |
| `engine-dev` | `server/trading/*`, `kisClient.ts`, `server/quant*`, `src/services/quant*` | `lint` + 해당 `*.test.ts` 통과 |
| `dashboard-dev` | `src/pages/*`, `src/components/*`, `src/hooks/*`, Zustand 스토어 | `validate:complexity` 통과 |
| `quality-guard` | QA + 보안 + 경계면 교차 비교 | `validate:all` 전체 통과 |

**워크플로 5단계:** (1) 요청 → 트리거 판정 → (2) 스킬 호출 → `_workspace/{날짜}_{task}/` 생성 →
(3) `architect` → (`engine-dev` ∥ `dashboard-dev`) → `quality-guard` 순서 위임 →
(4) `lint` → `validate:all` → 해당 테스트 → 교차 비교 → `precommit` →
(5) `docs/ai/10-patch-history-index.md` 변경 이력 한 줄 + 의미 있는 커밋.

상세 → `docs/ai/01-architecture-map.md`, `.claude/skills/quantmaster-orchestrator/SKILL.md`

---

## 4. Forbidden Behavior

- **9대 불변식 위반 금지** (§2.1). Trading Engine 정지 / Shadow Learning 정지 / SourceSnapshot 우회 절대 불가.
- **raw KIS REST 호출 금지** — `kisClient.ts` 외 직접 호출 차단.
- **클라이언트 실주문 금지** — 실주문은 서버 `autoTradeEngine` 단일 통로.
- **AI_ESTIMATED(L4) 데이터로 live 매매 결정 금지** — 참조 전용.
- **Provider 장애를 market signal(약세 신호)로 변환 금지** — providerIssue ≠ bearish.
- **Silent Catch 금지** — 사유 없는 swallow 금지. 의도적 무시는 `/* SDS-ignore: <사유> */` 명시.
- **훅 우회(`--no-verify`) 금지** · **복잡도 한계(1,500줄) 초과 방치 금지**.
- **CLAUDE.md 에 패치 노트 누적 금지** — `docs/ai/10-patch-history-index.md` 에만 기록.
- **장문 철학 설명을 CLAUDE.md 에 추가 금지** — 상세는 `docs/ai/` 로.

---

## 5. Patch Scope Rule

- **황금 규칙 — diff 출력:** 수정된 부분만 diff 형식. 변경 없는 코드는 출력하지 않는다 (토큰 70~90% 절약).
  신규 파일 생성 시에만 전체 출력 허용.
- **표준 PR 프롬프트:** 파일 / 작업(한 문장) / 범위(손대도 되는 곳·안 되는 곳) / ADR / 제약 5개 항목.
- **ADR type vs patch type:** 신규 경계·정책은 ADR 발급(`docs/adr/INDEX.md` `다음 발급` SSOT) + `INDEX.md` 갱신.
  hotfix·정합 정정·진단 가시화는 patch type (ADR 발급 0건, INDEX.md 갱신 0건).
- **변경 이력 한 줄 의무** — 모든 PR은 `docs/ai/10-patch-history-index.md` Patch Log 표에 한 줄 추가.
- **ADR-0146 PR 자가 review 5 카테고리** — (1) LIVE 매매 안전성 (KIS/KRX quota·ENV 롤백·회귀 테스트)
  (2) wiring 완료 vs 인프라만 (3) ADR 발급 무결성 (4) 회귀 테스트 적정성 (5) 정책 위반 baseline 무회귀.
- **byte-equivalent 원칙** — LIVE 매매 본체 0줄 변경 + ENV 1줄 즉시 롤백 + 회귀 테스트 + KIS/KRX quota 0 침범.

### 5.1 Patch Scope Guard (ADR-530)

코드 수정 전, 다음을 선언한다 (상세·템플릿은 아래 링크): `targetDomain` · `allowedFiles` ·
`forbiddenFiles` · `expectedBehaviorChange` · `sourceSnapshotImpact` · `executionImpact` ·
`shadowLearningImpact` · `telegramImpact` · `providerImpact` · `testsRequired` · `rollbackPlan`.

- 3개 도메인 초과 시 패치를 분리한다 (ADR 분리).
- 문서 전용 작업은 소스 코드를 수정하지 않는다.
- warning cleanup 은 명시 요구 없이는 runtime 동작을 바꾸지 않는다 (behavior change 와 분리).
- Trading Engine / SourceSnapshot / Gate / Provider / Telegram / Shadow 를 건드리면 해당 `docs/ai` 문서 먼저 읽는다.

상세 테스트 체크리스트 → `docs/ai/08-testing-checklist.md` · 리팩토링 규칙·Patch Scope Guard 상세 →
`docs/ai/09-refactor-rules.md` · 템플릿 → `docs/ai/templates/patch-plan-template.md` ·
`docs/ai/templates/patch-report-template.md`

---

## 6. Reference Docs Router

**작업 도메인 트리거 키워드 → 해당 문서 1개만 읽어라.** 경로는 모두 `docs/ai/` 하위.
각 문서 상단 "Read this file only when working on:" / "Do not read this file for:" 가 SRP 경계 SSOT.

| 트리거 키워드 | 참조 문서 |
|---------------|-----------|
| 프로젝트 정체성 · 9대 불변식 · 데이터 신뢰 L1~L4 철학 | `00-project-charter.md` |
| 디렉토리 · 모듈 경계 · 4-에이전트 · 복잡도 현황 · 하네스 워크플로 | `01-architecture-map.md` (+ `ARCHITECTURE.md`) |
| Trading Engine · engineMode · executionAllowed · shadowAllowed · SELL_ONLY · R6 · SHADOW_ONLY · FOMC · 사이징 | `02-trading-engine-rules.md` |
| SourceSnapshot · providerIssue · marketSignal · confidence · ExecutionPermission · carry wiring · 단일 통로 | `03-source-snapshot-ssot.md` |
| Gate0/1/2/3 · scan_blockers · blockerReason · candidateSnapshots · requiredScore · STRONG_BUY · RRR · VCP · LastTrigger | `04-gate-system.md` |
| KIS/KRX/DART/Yahoo · fallback · stale · empty · 회로차단기 · Last Good Value · provider health | `05-provider-policy.md` |
| Telegram Bot · 채널 라우팅(CH1~4) · dedup · 명령 레지스트리 · HTML 정제 · 진단 명령 출력 | `06-telegram-policy.md` |
| Shadow Learning · Counterfactual · Ghost Portfolio · LearningLabel · attribution · nightlyReflection · virtual fills | `07-learning-engine.md` |
| typecheck · test · validate:* · precommit · PR 자가 review · 정적 가드 | `08-testing-checklist.md` |
| 리팩토링 · 파일 분해 · SRP · 1,500줄 한계 · baseline 카탈로그 · ADR INDEX SLA · **Patch Scope Guard / Patch Plan·Report** | `09-refactor-rules.md` (+ `templates/patch-plan-template.md` · `templates/patch-report-template.md`) |
| 과거 ADR/패치 기록 인덱스 (상세 로그를 CLAUDE.md 로 되돌리지 말 것) | `10-patch-history-index.md` |

외부 SSOT (docs/ai 밖): 요구사항·도메인 `README.md` · 모듈 경계 단일 책임 `ARCHITECTURE.md` ·
운영·인시던트 `docs/incident-playbook.md` · AI 협업·토큰 절약 `CLAUDE_patch_section.md` ·
Gate 완료 체크리스트 `docs/gate1-completion-checklist-010.md` · `docs/gate3-completion-and-gate123-integration-checklist-010.md`

> **ONE-LINE PRINCIPLE:** 토큰은 비용이다 — diff만, 한 번에, 텔레그램 먼저.
