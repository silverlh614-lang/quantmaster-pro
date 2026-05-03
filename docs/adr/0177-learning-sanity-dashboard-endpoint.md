# ADR-0177 — Learning Sanity Dashboard HTTP Endpoint (Phase 4-A)

**상태**: Accepted (Phase 4-A — read-only HTTP endpoint, UI 컴포넌트 후속)
**날짜**: 2026-05-03
**관련 PR**: PR-Shadow-Learning-Phase4a
**의존성**:
- ADR-0173 (Shadow Learning Persistence Phase 1) — `ShadowLearningOnlySignal` 영속 SSOT + `loadShadowLearningOnlySignals`
- ADR-0174 (Safety Gate Attribution + Shadow vs Live Delta Phase 2a) — 영속 분석 SSOT 2종
- ADR-0146 (PR-Pace Audit Rule) — Phase 분리 정합

## 1. 문제

ADR-0174 Phase 2a 의 영속 분석 SSOT (`computeSafetyGateAttribution` + `computeShadowVsLiveDelta`) 가 *호출자 0건 dead code* 상태. 운영자가 SHADOW 검증 시 분석 결과를 직접 확인할 경로 부재 — Phase 4 Dashboard UI 의존.

## 2. 결정

### 2.1 Phase 4 분할 정책 (4-A / 4-B)

| Phase | scope | 회귀 위험 |
|-------|-------|----------|
| **Phase 4-A (본 PR)** | HTTP endpoint 2종 (read-only) | 0 (신규 endpoint, 기존 라우터 무수정) |
| Phase 4-B (별도 PR) | UI 컴포넌트 11 지표 + 페이지 등록 | UI-only, LIVE 매매 무관 |

### 2.2 신규 endpoint 2종

**`GET /api/learning/safety-gate-attribution?days=90&horizon=5`**:
- `loadShadowLearningOnlySignals()` 영속 read
- `computeSafetyGateAttribution(signals, { lookbackDays, futureReturnHorizon })` 호출
- 응답: `GateAttributionResult[]` (7 GateName entry)
- 쿼리 파라미터:
  - `days` (1~365, default 90) — `SafetyGateAttributionOptions.lookbackDays`
  - `horizon` (1/3/5/20, default 5) — `SafetyGateAttributionOptions.futureReturnHorizon`
- ENV gate `SAFETY_GATE_ATTRIBUTION_ENABLED` 미통과 시 함수 내부에서 빈 배열 반환 (응답: `[]`)

**`GET /api/learning/shadow-vs-live-delta?days=90&horizon=5`**:
- `loadShadowLearningOnlySignals()` + `loadShadowTrades()` 영속 read
- `computeShadowVsLiveDelta({ shadowSignals, liveTrades, options })` 호출
- 응답: `DeltaCategoryResult[]` (5 DeltaCategory entry)
- 쿼리 파라미터 동일 (days / horizon)

### 2.3 기존 패턴 정합

`learningRouter.ts` 의 기존 8 endpoint (`/status` / `/history` / `/reflection-impact` / `/walk-forward` / `/condition-lifecycle` / `/rejection-shadow` / `/twin-portfolio` / `/condition-attribution-shadow` / `/shadow-walk-forward`) 와 동일 패턴:
- read-only GET
- query 파라미터 검증
- try/catch + 500 fallback
- Phase 2a SSOT 함수 직접 호출

## 3. 안전 invariant (Phase 4-A 절대 규칙)

| # | invariant | 검증 |
|---|-----------|------|
| 1 | LIVE 매매 본체 0줄 변경 | git diff `signalScanner.ts` + `signalScanner/**` + `entryEngine.ts` + `exitEngine/**` + `kisClient/**` + `orchestrator/**` + `autoTradeEngine*` = 0 줄 |
| 2 | KIS 주문 함수 import 0건 | learningRouter.ts 정적 grep 가드 |
| 3 | 기존 라우터 무수정 | 기존 8 endpoint 모두 `git diff` 무변경 |
| 4 | read-only | GET 메서드만, 영속 read 만 (write 0건) |
| 5 | ENV default OFF | Phase 2a SSOT 함수 내부 ENV gate 자동 적용 (응답: `[]`) |

## 4. 잘못된 해결 방법 영구 차단

1. ❌ **Phase 4-B UI 컴포넌트 본 PR 통합** — UI-only PR 분리 (회귀 위험 격리)
2. ❌ **POST/PUT/DELETE 메서드 추가** — read-only invariant 위반
3. ❌ **Phase 2a SSOT 함수 본체 변경** — read-only 호출만, 함수 시그니처 무수정
4. ❌ **신규 분석 SSOT 도입** — Phase 2a 함수 그대로 사용 (drift 차단)
5. ❌ **ENV gate 우회** — Phase 2a SSOT 내부 ENV 검증에 위임

## 5. Phase 4-B / 후속 PR

### Phase 4-B — UI 컴포넌트
- `src/pages/LearningSanityDashboard.tsx` 신규 (11 지표 UI)
- `src/api/learningDashboardClient.ts` 신규 (HTTP fetch SDK, 절대 규칙 #3 정합)
- `src/components/learning/SafetyGateAttributionCard.tsx` + `ShadowVsLiveDeltaCard.tsx`
- 데이터 0건 시 placeholder + 향후 ENV ON 활성화 시 자연 가시화

## 6. 운영 효과 (Phase 4-A 머지 후)

- ADR-0174 Phase 2a 분석 SSOT 가 처음으로 호출자 활성화 (Phase 1 dead code → HTTP read-only 1 호출자)
- 운영자가 `curl localhost:NNNN/api/learning/safety-gate-attribution` 등으로 SHADOW 데이터 직접 확인 가능
- Phase 4-B UI 컴포넌트의 데이터 입력 인프라 마련
- 회귀 위험 격리 — 신규 endpoint + 기존 라우터 무수정 + read-only
