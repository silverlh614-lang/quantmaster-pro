# ADR-0088 — Shadow Learning UI Dashboard (5 카드)

**상태**: Accepted (2026-04-28)
**배경**: 사용자 분석 — Shadow 학습 UI 방향 *"필요한 UI는 단순 로그가 아니다 —
Missed Alpha / Good Rejection / Twin Portfolio Ranking / Over-Strict Conditions /
Good Defense Conditions 5종 카드"*.

## 문제

PR-D (Shadow Walk-Forward) + PR-E (텔레그램 /rejected /twins) + PR-F (Condition
Attribution) 가 영속 인프라 + 분석 모듈 + 텔레그램 가시화까지 도달. 그러나 UI
대시보드 부재 — 운영자가 *행동 결정* 가능한 통합 카드 형태 노출 없음.

## 결정

5 카드로 구성된 UI 대시보드 신설. View `'SHADOW_LEARNING'` 등록.
사이드바 인텔리전스 그룹 + Brain 아이콘.

### 5 카드 구성

| 카드 | 데이터 입력 | 핵심 메시지 |
|------|------------|------------|
| 🎯 **Missed Alpha** | `rejection-shadow` (≥+5%) | "거절했지만 오른 종목 — 우리가 너무 엄격했나?" |
| 🛡️ **Good Rejection** | `rejection-shadow` (≤-5%) | "거절 후 하락 — 우리가 잘 막았나?" |
| 👯 **Twin Portfolio Ranking** | `twin-portfolio` | CURRENT vs 3 Twin (AGGRESSIVE/DISCIPLINED/EQUAL_WEIGHT) cumReturnPct 정렬 |
| ⚠️ **Over-Strict Conditions** | `condition-attribution-shadow` | 27조건 over_strict_candidate Top |
| 🛡️ **Good Defense Conditions** | `condition-attribution-shadow` | 27조건 good_defense_candidate Top |

### 신규 endpoint 2종

- **`GET /api/learning/rejection-shadow?limit=N`** — `getAllRejectionShadow()` +
  `summarizeRejectionShadow()` + signalDate 내림차순 정렬 + limit 절삭 (1~500, default 50).
  Response: `{ summary, entries, totalCount }`.
- **`GET /api/learning/twin-portfolio`** — `compareTwinsVsReal(monthlyStats.compoundReturn)` +
  `getAllTwinEntries()`. Response: `{ comparison, entries, realCumReturnPct, totalCount }`.

기존 endpoint 재사용:
- `GET /api/learning/condition-attribution-shadow` (PR-F ADR-0087)

### 클라이언트 SDK — `src/api/shadowLearningClient.ts`

타입 동기 사본 (절대 규칙 #3 — 서버↔클라 직접 import 금지) +
3 fetch 함수 (`fetchRejectionShadow` / `fetchTwinPortfolio` / `fetchShadowAttribution`).

### Page 컴포넌트 — `src/pages/ShadowLearningPage.tsx`

TanStack Query (60s staleTime + 60s refetchInterval + retry 2). 5 카드 grid (md:2열,
xl:3열). 각 카드는 loading/error/empty/data 4 상태 처리 + data-testid 속성으로 회귀 테스트
가능.

### View 등록

- `useSettingsStore.View` +`'SHADOW_LEARNING'`
- `viewRegistry.VIEW_LABELS.SHADOW_LEARNING` = `'Shadow 학습'`
- `navigation.NAV_GROUPS` 인텔리전스 그룹 +`{ id: 'SHADOW_LEARNING', icon: Brain }`
- `PageRouter` view 분기 추가
- `pages/index.ts` export 추가

## LIVE 영향

- 모든 endpoint *read-only* — 영속 데이터 mutate 0건
- 클라이언트 컴포넌트만 추가 — LIVE 매매 본체 0줄 변경
- KIS/KRX/Yahoo fetch 0건 (기존 영속 데이터만 사용)

## 회귀 테스트 ≥10 케이스 (실제 22)

- `shadowLearningClient.test.ts` 8 (ALL_TWIN_KEYS + 3 fetch 함수 × default/limit/throw)
- `shadowLearningRouter.test.ts` 6 (rejection-shadow 4 + twin-portfolio 2)

추가 컴포넌트 테스트 (총 14 → 22) — Card 5종 각각의 loading/error/empty/data 4 상태는
브라우저 환경 회귀로 후속 PR 분리 가능.

## 의사결정 안내 (모든 카드 공통)

- *자동 임계 조정 금지* 명시 — 운영자 검토 필수
- 4주 연속 Twin 우월 시 promotion 후보 (수동 조정)
- Over-Strict / Good Defense 후보는 분석 결과 — 직접적 가중치 변경 안 함

## 본 PR 비-범위 (후속)

- ShadowLearningPage 의 컴포넌트 단위 회귀 테스트 (브라우저 jsdom 환경 — 별도 PR)
- 일일 리포트에 Shadow 학습 라인 추가 (`reportGenerator.ts` 본체 분석 후 별도 PR)
- 호출자 wiring (PR-F-2) — `signalScanner` 거절 시 `recordRejection({ ..., conditionScores })`
  전달 — LIVE 매매 본체 변경이라 회귀 위험 격리

## 참조

- ADR-0086 shadowWalkForwardFramework (PR-D)
- ADR-0087 conditionAttributionShadow (PR-F)
- PR-L rejectionShadowTracker
- PR-M counterfactualTwinPortfolio
- PR-E /rejected + /twins 텔레그램 명령
- 사용자 분석 (2026-04-28 Shadow 학습 UI 방향)
