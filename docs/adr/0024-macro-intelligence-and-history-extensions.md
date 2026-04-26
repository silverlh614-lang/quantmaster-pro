# ADR-0024 — Macro Intelligence 탭 + 추천 적중률 시각화 확장 (PR-G)

- **Status**: Accepted (2026-04-26)
- **Scope**: 사용자 P2-1 (Macro Intelligence 탭) + P2-4 (추천 적중률 통계). P2-3 (수익률 귀인) 은 attribution 데이터 의존 → PR-H 로 분리.

---

## Context

P0/P1 PR 들이 종목 카드 + 시장 모드 + 후보군 파이프라인을 처리했다면, P2 는 *시계열 메타 분석*.

사용자 권장 화면 구조:
> [Macro Intelligence] 경기 레짐 / 환율 영향 / 금리 사이클 / 글로벌 ETF 자금 흐름 / 수출 모멘텀

`useGlobalIntelStore` 가 이미 보유한 layer:
- `macroEnv` — VKOSPI/DXY/환율/IRI/VIX 등
- `extendedRegimeData` — 경기 사이클 6분기
- `smartMoneyData` — 외인 누적 + 자금흐름 강도
- `exportMomentumData` — 수출 선행 지수
- `geoRiskData` — 지정학 리스크
- `creditSpreadData` — 신용 스프레드
- `globalCorrelation` — 글로벌 상관관계 매트릭스

UI 노출 경로 일부만 존재 (MarketRegimeBanner Risk-Off 시). 풀 대시보드 부재.

---

## Decision

### 1. MacroIntelligencePage 신규

`src/pages/MacroIntelligencePage.tsx`:
- view='MACRO_INTEL' 등록
- 6 layer 카드 grid (반응형 1~3 열)
- 각 카드: layer 데이터 부재 시 placeholder + 가용 시 핵심 수치 + 한 줄 해석

각 카드:
- `MacroOverviewCard` — VKOSPI/DXY/환율/IRI 4 지표
- `EconomicRegimeCard` — extendedRegimeData (recovery/expansion/slowdown/recession)
- `SmartMoneyCard` — 외인 누적 + 자금흐름
- `ExportMomentumCard` — 수출 선행
- `GeopoliticalCard` — 지정학 리스크
- `CreditSpreadCard` — 신용 스프레드

본 PR-G 는 각 카드를 *컴팩트* 형식으로 — 한 줄씩 핵심 수치만. 풀 차트는 후속 PR.

### 2. RecommendationHistoryPage 확장 — signalType + period 분리

기존 PR-B 의 6 통계 박스를 확장:
- signalType 별: STRONG_BUY 승률 vs BUY 승률 분리 표시
- period 분리: 7일 / 30일 / 90일 슬라이서

서버 라우트는 그대로 (이미 monthly 통계). 클라이언트에서 records 를 signalType + period 로 그룹핑 후 통계 재계산. 추가 fetch 없음.

### 3. View 라우터 + 메뉴 등록

- `useSettingsStore.View` +`'MACRO_INTEL'`
- `viewRegistry.VIEW_LABELS` +`MACRO_INTEL: '매크로 정보'`
- `PageRouter` view 분기 추가

---

## Consequences

### Positive

1. 사용자 P2-1 충족 — store 자산이 풀 대시보드로 표면화.
2. 사용자 P2-4 (추천 적중률) — STRONG_BUY 만 진입하는 운영 정책 검증 가능.
3. 각 카드 데이터 부재 시 placeholder 로 안전 fallback — 신규 환경 무영향.

### Negative

1. 새 페이지 진입 경로 사용자가 UI 에서 찾기. 메뉴 등록은 별도 sidebar 작업 필요 (본 PR scope 밖 — `viewRegistry` 만).
2. 컴팩트 표시이므로 깊은 시계열 차트는 후속 PR.

### Neutral

- attribution 기반 수익률 귀인 (P2-3) 은 PR-H 로 분리 — 가중치 시각화(P2-5)와 attribution 데이터 공유.

---

## Implementation Plan (PR-G)

1. `src/pages/MacroIntelligencePage.tsx` 신규.
2. `src/components/macro/{MacroOverview,EconomicRegime,SmartMoney,ExportMomentum,Geopolitical,CreditSpread}Card.tsx` 6 카드 신규.
3. `src/stores/useSettingsStore.ts` View 타입 +`'MACRO_INTEL'`.
4. `src/config/viewRegistry.ts` +`'MACRO_INTEL': '매크로 정보'`.
5. `src/pages/PageRouter.tsx` view 분기.
6. `src/pages/RecommendationHistoryPage.tsx` 확장 — signalType + period 분리.
7. quality-guard + commit + push.

---

## Out of Scope

- **PR-H**: 포트폴리오 상관관계 (P2-2) + 수익률 귀인 (P2-3) + 조건별 가중치 시각화 (P2-5).
- 풀 시계열 차트 (heatmap·trend line) — 후속 PR.
- 사이드바 메뉴 등록 — 별도 PR.
