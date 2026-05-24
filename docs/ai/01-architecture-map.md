# 01 · Architecture Map (디렉토리·모듈 경계·에이전트·복잡도 현황)

> **Read this file only when working on:** 새 모듈을 추가하거나 기존 모듈 경계를 수정할 때,
> 어느 에이전트가 어느 영역을 담당하는지 확인할 때, 하네스 워크플로를 시작할 때,
> 또는 복잡도 위반 파일의 분해 우선순위를 정할 때.

---

## 디렉토리 구조

- `src/` — 프론트엔드 + 공유 타입·서비스 (Vite + React 19 + Zustand + TanStack Query)
  - `src/pages/`, `src/components/`, `src/hooks/`, `src/stores/`, `src/services/`, `src/api/`, `src/types/`, `src/config/`, `src/utils/`
- `server/` — Express 백엔드
  - `server/trading/` (signalScanner, entryEngine, exitEngine, autoTradeEngine, buyPipeline, trancheExecutor)
  - `server/clients/` (kisClient, krxClient, kisStreamClient, geminiClient, naverFinanceClient)
  - `server/screener/`, `server/quant/`, `server/supply/`, `server/learning/`, `server/orchestrator/`, `server/scheduler/`, `server/alerts/`, `server/telegram/`, `server/persistence/`, `server/routes/`, `server/health/`, `server/diagnostics/`
- `scripts/` — 검증 파이프라인 (`check_complexity.js`, `check_responsibility.js`, `scan_exposure.js`, `silent_degradation_sentinel.js`, `validate:gemini`)
- `docs/` — 인시던트 플레이북, ADR (`docs/adr/`), 체크리스트

**모듈 경계 단일 책임 SSOT 는 `ARCHITECTURE.md`.** 수정 전 해당 모듈의 Single Responsibility 재확인 의무 (절대 규칙 #5).

---

## 에이전트 팀 (4인)

| 역할 | 담당 영역 | DoD |
|------|-----------|------|
| `architect` | `ARCHITECTURE.md` 경계 설계, `src/types/`, ADR 작성 | `npm run validate:responsibility` 통과 |
| `engine-dev` | `server/trading/*`, `server/clients/kisClient.ts`, `server/quant*`, `src/services/quant*` | `npm run lint` + 해당 `*.test.ts` 통과 |
| `dashboard-dev` | `src/pages/*`, `src/components/*`, `src/hooks/*`, Zustand 스토어 | `npm run validate:complexity` 통과 |
| `quality-guard` | QA + 보안 + 경계면 교차 비교 | `npm run validate:all` 전체 통과 |

보안/이상감지는 `scripts/scan_exposure.js`, `scripts/silent_degradation_sentinel.js` 가 이미
기계 에이전트로 동작 중 — AI 에이전트는 조율·해석·수정 위임에 집중.

---

## 하네스 워크플로

**트리거:** 매매 엔진 / 퀀트 필터(Gate 0~3) / 대시보드 / 변곡점 모듈(THS/VDA/FSS/IPS) /
서버 리팩토링 작업 요청 시 `.claude/skills/quantmaster-orchestrator` 스킬 사용.

전용 스킬:
- `.claude/skills/server-refactor-orchestrator` — 1,000줄+ 서버 파일 분해 전용
- `.claude/skills/incident-responder` — Telegram/로그 인시던트 진단 전용

**단순 질문은 직접 응답** ("이 함수가 뭐야?", "타입 오류 한 줄 수정").
**복잡 작업은 하네스 필수** ("새 Gate 조건 추가", "signalScanner 분해").

**5단계:** (1) 요청 → 트리거 판정 → (2) 스킬 호출 → `_workspace/{YYYY-MM-DD}_{task}/` 생성 →
(3) `architect` → (`engine-dev` ∥ `dashboard-dev`) → `quality-guard` 순서 위임 →
(4) `lint` → `validate:all` → 해당 테스트 → 교차 비교 → `precommit` →
(5) `docs/ai/10-patch-history-index.md` 변경 이력 한 줄 + 의미 있는 커밋.

상세 → `.claude/skills/quantmaster-orchestrator/SKILL.md`

---

## 복잡도 위반 현황 (리팩토링 우선순위)

파일당 1,500줄 한계 (`scripts/check_complexity.js`). 초과 시 ADR 선행 후 분해.

### 잔존 위반 (P0~P2)

| 파일 | 줄 수 | 우선순위 |
|------|------:|----------|
| `server/trading/signalScanner.ts` | 1,820 | P0 — 변동성 최대 (분해 진행 중) |
| `server/quant/conditions/entryFilterDecomposition.ts` | 1,720 | P1 — ACMA baseline 등재 (분해 ADR 대기) |
| `server/supply/investorFlowProviderRouterAdr0477.ts` | 1,540 | P1 — ACMA baseline 등재 |
| `server/trading/signalScanner/minimumSignalScoreTrace.ts` | 1,520 | P2 — ACMA baseline 등재 |

### 완료 (분해 사례 — 후속 분해의 참조 패턴)

- `perSymbolEvaluation.ts` 1,617 → 30줄 barrel (ADR-0134, `signalScanner/perSymbol/{index,types,helpers,buyListLoop,intradayLoop}`)
- `webhookHandler.ts` 1,858 → 155줄 (ADR-0017, `commands/*` 51 cmd 8 디렉토리)
- `exitEngine.ts` 1,358 → 18줄 barrel (ADR-0028, `exitEngine/{index,types,helpers/×6,rules/×16}`)
- `stockScreener.ts` 1,573 → 542줄 (ADR-0029, `screener/{stockUniverse,rejectionLog,adapters/×4}`)
- `krxClient.ts` 2,105 → 1,073줄 (ADR-0502c, 9 모듈 점진 분해)

분해 워크플로 + ACMA baseline 카탈로그 상세 → `docs/ai/09-refactor-rules.md`
