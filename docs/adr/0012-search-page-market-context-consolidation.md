# ADR-0012 — 검색 페이지 시장 분석 카드 제거 + 시장 대시보드 단일화

- Status: Accepted (2026-04-25)
- Owners: architect, dashboard-dev
- Related: ADR-0009 (외부 호출 예산), ADR-0011 (AI 추천 KIS/KRX 분리)
- Trigger: 사용자 요청 — "검색 페이지의 실시간 시장 분석 / AI 시장 분석 버튼은
  시장 대시보드와 중복이므로 제거하고 시장 대시보드 단일 표현만 유지하라."

## Context

`src/components/watchlist/WatchlistHeader.tsx` (813 LoC) 는 DISCOVER 탭의
검색 페이지 헤더로, 다음 두 시장 분석 카드를 포함하고 있다:

1. **Market Sentiment 사이드 카드 (라인 205-385)** — Fear & Greed / 삼성 IRI /
   VKOSPI / 환율 / 국채 10년물 / 미 국채 / 달러 인덱스 / SYSTEM:BULL 배지 /
   "AI 시장분석" 주황 버튼.
2. **실시간 시장 분석(Market Context) 풀폭 섹션 (라인 489-770)** —
   KOSPI/KOSDAQ analysis / Sector Rotation Top 3 / Euphoria Detector /
   Regime Shift / Global ETF Monitoring / Global Indices NASDAQ/S&P/DOW/SOX /
   Critical Event D-5 알림 / "AI 동적 가중치 전략" 박스.

같은 데이터(`MarketContext` SSOT)는 시장 대시보드 (`MarketPage` →
`MarketDashboard`) 의 다음 9개 섹션에 이미 동등 또는 우수하게 표현되고 있다:
`AiMarketSummarySection`, `TriageSummarySection`, `DynamicWeightsSection`
(검색 페이지의 단일 문자열 vs 27조건 가중치 그리드 — 압도적 상세),
`MarketPhaseSection` (Phase + Euphoria + Regime Shift 3-그리드),
`SectorRotationSection`, `IndicesSection` (KOSPI/KOSDAQ/NASDAQ/S&P/DOW/SOX 등
평탄 배열 + sparkline), `GlobalEtfSection`, `SectorHeatmap`,
`SentimentMacroSection` (lazy load).

architect 가 분해 분석한 결과 사실상 두 카드의 모든 섹션이 시장 대시보드와
중복이며, 차별 요소는 다음 정도뿐이다:

- KOSPI/KOSDAQ analysis 한 문장 코멘트 (시장 대시보드 IndicesSection 부재)
- 삼성 IRI / VKOSPI 단독 카드 디자인 (SentimentMacroSection 에 단독 카드는 없음)
- D-day≤5 HIGH impact 강조 카드 (EventCalendar 가 동일 SSOT 표시)
- "AI 시장분석" 버튼 → reportSummary 마크다운 (AiMarketSummarySection 동일 역할)

이로 인한 부작용:
- 검색 페이지 초기 렌더에 시장 분석 9+ 섹션 분 추가 DOM/스타일 비용
- `marketContext.globalIndices.{...}.index` 빈 응답 시 0 fallback 이 그대로 노출
  (사용자 스크린샷: KOSPI/KOSDAQ 0 / NASDAQ/S&P/DOW/SOX 0)
- 동일 표현이 두 곳에서 갱신 시점이 달라 사용자 혼란 유발
- `WatchlistHeader.tsx` 813 LoC 가 향후 1500 LoC 임계 부담

## Decision

검색 페이지 (`view === 'DISCOVER' && discoverTab === 'overview'`) 에서 두
카드를 **모두 제거**하고, 시장 분석 표시는 시장 대시보드 탭
(`view === 'MARKET'`) 으로 단일화한다.

차별 요소 처리:

| 차별 요소 | 결정 |
|----------|------|
| KOSPI/KOSDAQ analysis 한문장 | IndicesSection MarketCard 에 optional `analysis?: string` prop 추가 — **본 PR scope 밖, Tier B 후속 PR 권장** |
| 삼성 IRI / VKOSPI 단독 카드 | SentimentMacroSection 확장 검토 — **본 PR scope 밖, engine-dev 후속 영역** |
| D-day≤5 HIGH 강조 카드 | EventCalendar 가 충분 표시 — **흡수 불필요** |
| reportSummary 마크다운 | AiMarketSummarySection 동일 역할 — **흡수 불필요, 단순 제거** |

본 PR 에서는 "단순 제거 + 시장 대시보드 단일화" 만 수행한다.
흡수 대상 0건이라는 결론을 명시적으로 받아들인다.

## Consequences

### Positive

1. **사용자 일관성**: 시장 분석은 시장 대시보드 탭, 종목 검색은 검색 페이지
   라는 명확한 IA 분리. 동일 정보 두 곳 갱신 시점 차이로 인한 혼란 제거.
2. **로딩 속도**: 검색 페이지 초기 DOM 9+ 섹션 감소. 추천 트리거(주도주 분석
   시작) 까지의 first paint 지연 단축.
3. **0 표기 사용자 체감 해소**: 검색 페이지에서 사용자가 KOSPI/KOSDAQ/NASDAQ/
   S&P/DOW/SOX 0 표기를 더 이상 보지 않음 (시장 대시보드의 동일 0 표기는
   별개 후속 과제로 분리).
4. **코드 복잡도**: `WatchlistHeader.tsx` 813 → 약 380 LoC (53% 감축).
   `npm run validate:complexity` 임계 여유 확보.
5. **유지보수 단일화**: 시장 분석 UI 변경 시 MarketDashboard 한 곳만 수정.

### Negative

1. **사용자 학습 비용**: 기존 검색 페이지에서 시장 컨텍스트를 함께 보던 사용자는
   시장 대시보드 탭으로 이동해야 함. DISCOVER 탭에서 SYSTEM:BULL 배지가
   사라지므로 추천 결과 해석 시 시장 페이즈 컨텍스트 인지가 한 번의 탭
   전환을 요구함.
2. **차별 요소 일시 손실**: KOSPI/KOSDAQ analysis 한 문장이 즉시 사라짐.
   시장 대시보드 IndicesSection 흡수 (Tier B PR) 까지 잠시 비표시. 사용자가
   요청 시 즉시 후속 PR 진행 가능.
3. **마크다운 reportSummary 사라짐**: 검색 페이지에서 AI 시장분석 버튼 →
   리포트 인라인 표시 흐름이 사라짐. 시장 대시보드 AiMarketSummarySection 가
   동일 정보를 자동 표시하므로 정보 손실은 없으나, "버튼 클릭 → 리포트
   생성" UX 가 시장 대시보드의 자동 표시 패턴으로 바뀜.

### Neutral

1. `useStockSearch.fetchStocks` → `aiUniverseClient.discoverAiUniverse` →
   `useRecommendationStore` 추천 트리거 흐름 무변경. ADR-0011 무영향.
2. `MarketContext` 타입 자체는 유지 (Hero Last Updated dataSource 표시용
   `marketContext.dataSource` 잔존). 후속 PR 에서 사용처 재검토 후 슬림화 가능.
3. `OffHoursBanner` + `RecommendationWarningsBanner` 무변경.
4. "오늘의 Top 3 주도주" Section + GatePyramidVisualization + WatchlistCard
   그리드 무변경.

## Implementation Notes

### 변경 범위 (dashboard-spec 산출물 참조)

- `src/components/watchlist/WatchlistHeader.tsx`:
  - 카드 A 사이드 (라인 205-385) 삭제
  - 카드 B 풀폭 (라인 488-770) 삭제
  - AI Report Summary Section (라인 772-810) 삭제
  - Hero Section (라인 62-203) 의 grid `lg:col-span-2` → `lg:col-span-3` 변경
  - props 시그니처에서 `searchResults, isSummarizing, onGenerateSummary,
    reportSummary, setReportSummary, setView` 제거
  - import 에서 `ReactMarkdown, getMarketPhaseInfo, View` 등 제거
  - 추정 LoC: 813 → 약 380
- `src/pages/DiscoverWatchlistPage.tsx`:
  - WatchlistHeader 호출 시 제거된 props 6종 전달 중단 (라인 320-338)
  - `useWatchlistData()` destructure 에서 미사용 항목 정리 (라인 168-180)

### 흡수 대상 — 본 PR 에서는 0건

차별 요소 흡수는 본 PR scope 밖. Tier B 항목 (IndicesSection
analysis prop 확장) 은 사용자 요청 시 별도 PR 로 진행한다.

### 데이터 소스 SSOT

- `MarketContext` (`useWatchlistData` → `useMarketStore`/`useRecommendationStore`)
  은 검색 페이지에서 Hero Last Updated dataSource 표시 용도로만 잔존.
- `MarketOverview` (시장 대시보드 SSOT) 는 무변경. `MarketDashboard` 9개 섹션이
  단일 시장 분석 표현 책임.
- 두 타입을 통합하거나 한쪽을 폐지하는 작업은 본 PR 범위 밖.

### 보존 영역 (변경 금지)

1. `useStockSearch` / `useRecommendationStore` 추천 트리거 흐름
2. WatchlistHeader Hero Section (Title/Checklist/Mode 필터/주도주 분석 시작/Last Updated)
3. "오늘의 Top 3 주도주" Section (라인 388-486)
4. `WatchlistCard` 그리드 + `GatePyramidVisualization` + Stats Section
5. `OffHoursBanner` + `RecommendationWarningsBanner`
6. `MarketPage` / `MarketDashboard` / 9개 `MarketDashboard/*Section.tsx` 무변경

## Alternatives Considered

### 대안 1 — 카드 A/B 의 차별 요소를 모두 시장 대시보드로 흡수 후 제거

**기각 사유**: IRI/VKOSPI 는 SentimentMacroSection 책임 영역으로 engine-dev 가
SSOT 매핑을 먼저 정리해야 함. 본 PR scope 비대화 회피.

### 대안 2 — 검색 페이지에 시장 대시보드 핵심 섹션을 임베드 (compact 버전)

**기각 사유**: 사용자 요청이 명시적으로 "중복 제거". 임베드 안은 다시 두
표현을 유지하는 것이라 일관성 문제 재발.

### 대안 3 — DISCOVER 탭에서 "시장 대시보드 보기" 링크 카드만 남기기

**기각 사유**: 이미 PageRouter 의 탭 구조 자체가 사용자에게 "시장 대시보드는
별도 탭" 임을 시각적으로 안내. 별도 CTA 카드는 redundant.

## References

- `src/components/watchlist/WatchlistHeader.tsx` (현재 813 LoC)
- `src/pages/DiscoverWatchlistPage.tsx`
- `src/components/market/MarketDashboard.tsx` + 9개 Section 컴포넌트
- `src/services/stock/types.ts` 라인 352-434 (MarketOverview vs MarketContext)
- ADR-0009: 외부 호출 예산
- ADR-0011: AI 추천 경로 KIS/KRX 분리
- 사용자 첨부 스크린샷: KOSPI/KOSDAQ/NASDAQ/S&P/DOW/SOX 0 표기 (engine-dev
  후속 분리 진단 대상)
