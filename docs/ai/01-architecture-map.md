# 01 · Architecture Map (디렉토리·모듈 경계·에이전트·복잡도 현황)

**Read this file only when working on:**
- 새 모듈 추가 · 기존 모듈 경계 수정 · 디렉토리 구조 파악
- 어느 에이전트가 어느 영역을 담당하는지 (4-에이전트 매핑)
- 하네스 워크플로 시작 (트리거 판정 · 5단계)
- 복잡도 위반 파일의 분해 우선순위 한눈 확인

**Do not read this file for:**
- 모듈 경계 단일 책임 정식 정의 → `ARCHITECTURE.md` (본 문서는 요약)
- 분해 워크플로 · baseline 카탈로그 상세 → `09-refactor-rules.md`
- 검증 파이프라인 · precommit → `08-testing-checklist.md`

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

### 잔존 위반 (1,500줄 초과 = BASELINE 카탈로그)

> **SSOT = `scripts/check_complexity.js` 의 `BASELINE_TECHNICAL_DEBT` 배열 + `npm run validate:complexity`.**
> 아래는 **2026-06-06 실측 스냅샷** — 수정 전 항상 `validate:complexity` 로 재확인 (줄수는 변동).

| 파일 | 줄 수 | 상태 |
|------|------:|------|
| `server/trading/signalScanner/scanDiagnostics/persistScanResults.ts` | 1,990 | baseline — god 함수 1,623줄, 진단블록 분해 보류 |
| `server/clients/kisSectorEnergyProvider.ts` | 1,521 | baseline — ADR-0574 정규화로 초과, 분해 ADR 미발급 |

### ⚠️ 한계 근접 (watch — 여유 ≤30줄, 2026-06-07 실측)

| 파일 | 줄 수 | 여유 |
|------|------:|------|
| `server/trading/signalScanner/minimumSignalScoreTrace.ts` | 1,490 | 10 (ADR-0524 후 재증가) |
| `server/learning/counterfactualOutcomeBoard.ts` | 1,481 | 19 |
| `server/trading/signalScanner/sectorEnergyMasterSupplyUnknownPolicyAdr0488.ts` | 1,479 | 21 |
| `server/clients/krxClient.ts` | 1,475 | 25 |

> 직전 "정확히 1,500/1줄 차" 임박 3건은 ADR-0579/0580 으로 해결(아래 완료) — 현재 차단 임박(≤1줄) 0건.

### 완료 (분해 사례 — 후속 분해의 참조 패턴)

- `marketDataRefresh.ts` 1,497 → 342줄 오케스트레이터 (ADR-0595, 섹션 5모듈 분해: refreshObservability/indexMacroSections/supplyCreditSections/programMarketSection/sectorEnergySection, **executionImpact=NONE** · 외부 importer 14파일 무수정)
- `marketDataRefresh.ts` 1,499 → 1,327줄 (ADR-0580, types.ts+helpers.ts, **executionImpact=NONE** · refreshMarketRegimeVars 무접촉)
- `gate1DryRunObservationLedgerAdr0476.ts` 1,500 → 1,242줄 · `sectorEnergyProvider.ts` 1,499 → 1,343줄 (ADR-0579, types.ts 추출)
- `signalScanner.ts` 1,820 → 35줄 barrel (ADR-0001/0147b, `signalScanner/` 229 모듈)
- `entryFilterDecomposition.ts` 2,277 → 14줄 barrel (ADR-0464, 10 모듈) · `investorFlowProviderRouterAdr0477.ts` 1,694 → 9줄 (ADR-0477, 7 모듈)
- `minimumSignalScoreTrace.ts` 1,736 → 1,490줄 (ADR-0524, types/scoring 추출 — 위 watch 참조)
- 2026-05 시리즈: `sectorEnergyMasterSupplyUnknownPolicy`(ADR-0521) · `regimeLearningBank`(ADR-0522) · `gate2ExternalDataProvider`(ADR-0523) · `kisClient/query`(ADR-0537) · `scanBlockers`(ADR-0538) · `regimeLearningBackfill`(types/formatters)
- 초기: `perSymbolEvaluation.ts`(ADR-0134) · `webhookHandler.ts`(ADR-0017) · `exitEngine.ts`(ADR-0028) · `stockScreener.ts`(ADR-0029) · `krxClient.ts` 2,105→1,073줄(ADR-0502c)

분해 워크플로 + ACMA baseline 카탈로그 상세 → `docs/ai/09-refactor-rules.md`
