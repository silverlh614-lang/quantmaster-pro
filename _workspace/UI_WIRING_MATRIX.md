# UI Wiring Matrix

> @responsibility DISCOVER / 종목 탐색 흐름 단일 배선 지도 — 코드 수정 없이 UI↔store↔hook↔service↔표시 연결 상태만 조사.
> 작성 기준일: 2026-05-27 · 브랜치: `claude/clever-goodall-sO5Fz` · 단계: 1차 배선 지도 (코드 무수정)

## 0. Scope

이번 문서는 전체 UI가 아니라 `DISCOVER / 종목 탐색` 흐름만 다룬다.
이번 단계에서는 **코드 수정 없이** 연결 상태만 조사한다. UI 리디자인·자동매매 로직·신규 기능은 손대지 않는다.
불확실한 런타임 의존(외부 API 키, 서버 엔드포인트 응답)은 정적 추적만 가능하므로 `UNKNOWN`으로 표기한다.

상태 표기 규약:

- **OK** — UI → 호출 → store → 표시까지 정적으로 끊김 없이 연결됨.
- **PARTIAL** — 연결은 되어 있으나 일부 탭/조건에서 누락되거나 일부 경로만 wired.
- **BROKEN** — 연결이 끊겨 동작 불가 (정적으로 확인됨).
- **UNKNOWN** — 코드상 연결은 있으나 런타임 동작이 외부 의존(API 키·서버 응답)에 좌우되어 정적 확인 불가.
- **DECORATIVE** — 표시만 하고 데이터 흐름과 무관(장식).

---

## 1. DISCOVER / 종목 탐색 개요

- **진입 View ID**: `DISCOVER` (앱 기본 view — `src/stores/useSettingsStore.ts:126` `view: 'DISCOVER'`)
- **라우팅 컴포넌트**: `src/pages/PageRouter.tsx` (default 분기 `:148` → `DiscoverWatchlistPage`)
- **실제 페이지 컴포넌트**: `src/pages/DiscoverWatchlistPage.tsx`
- **내부 탭 구조**: `discoverTab` 로컬 state — `'overview'`(후보 판정 대시보드) / `'search'`(종목 검색) (`DiscoverWatchlistPage.tsx:208`)
- **주요 하위 컴포넌트**:
  - `src/components/watchlist/WatchlistHeader.tsx` — Hero + 모드 선택 + **"Start leader scan"** 버튼 + Top 3 (overview 탭 전용)
  - `src/components/watchlist/WatchlistFilterPanel.tsx` — 검색 입력 + **"시장 검색"** 버튼 + 새로고침 + 필터 (search 탭/WATCHLIST 전용)
  - `src/components/screener/CandidatePipelinePanel.tsx` — 후보군 파이프라인 funnel (별도 서버 데이터원)
  - `src/components/watchlist/WatchlistCard.tsx` — 결과 카드
  - `src/components/analysis/GatePyramidVisualization.tsx` — Gate 피라미드 (overview 전용)
- **관련 hook**:
  - `src/hooks/useStockSearch.ts` — `fetchStocks` / `handleMarketSearch` / `handleScreener` / `handleFetchNewsScores` (액션 소유, PageRouter에서 단일 인스턴스)
  - `src/hooks/useQuantRecommendations.ts` — `displayList` / `filteredRecommendations` 계산 (PageRouter에서 호출 후 props로 전달)
  - `src/hooks/useWatchlistData.ts` — 페이지가 store 상태(`recommendations`/`loading`/`error`/…)를 읽는 통로
  - `src/hooks/useWatchlistFilters.ts` — 필터/검색어 state + `handleResetScreen`
- **관련 store**: `src/stores/useRecommendationStore.ts` (recommendations/searchResults/loading/error/warnings/sourceStatus/lastUpdated …), `useSettingsStore`(view), `useMarketStore`(marketContext)
- **관련 service/API**:
  - `src/services/stock/recommendations.ts` → `getStockRecommendations` (mode 라우터)
  - `src/services/stock/momentumRecommendations.ts` → `getMomentumRecommendations`
  - `src/services/stock/stockSearch.ts` → `searchStock`
  - `src/services/stock/aiClient.ts` → `getAI()` (클라이언트 Gemini 직접 호출)
  - `src/api/aiUniverseClient.ts` → `discoverAiUniverse` (`GET /api/ai-universe/discover`)
  - `src/api/screenerPipelineClient.ts` → `fetchPipelineSummary` (`GET /api/screener/pipeline-summary`)
- **결과 표시 컴포넌트**: `WatchlistCard` (그리드, `DiscoverWatchlistPage.tsx:646`), 빈 상태 블록(`:674`), 결과 카운트 배너(`:613`)

> **데이터 원천 주의 (QuantMaster 불변식 #3):** DISCOVER 화면에는 **두 개의 독립 데이터원**이 공존한다 —
> ① 사용자가 버튼으로 발동하는 클라이언트 추천 경로(`getStockRecommendations`/`searchStock` → store.recommendations/searchResults → 카드),
> ② `CandidatePipelinePanel`이 자동 조회하는 서버 스크리너 경로(`/api/screener/pipeline-summary`).
> 두 원천은 서로 다른 파이프라인이며 동기화되지 않는다. 같은 화면에서 "후보군 파이프라인" 숫자와 카드 개수가 불일치할 수 있다(§6 P1 참고).

---

## 2. 사용자 흐름 A: 시장 후보 탐색 (Start leader scan)

진입 → overview 탭 → 모드 선택 → "Start leader scan" → 로딩 → universe 발굴 + AI 선정 → enrichment → store → 카드.

| 단계 | 위치/파일 | UI 요소 | 호출 함수 | 다음 연결 | 상태 | 비고 |
|---|---|---|---|---|---|---|
| A0 | `src/layout/Sidebar.tsx:49,84` · `BottomNav.tsx:36` | "Candidate Discovery" / "Candidates" nav | `setView('DISCOVER')` + `setSearchQuery('')` | `useSettingsStore.view='DISCOVER'` | OK | 기본 view 도 DISCOVER (`useSettingsStore.ts:126`) |
| A1 | `PageRouter.tsx:148` | (라우팅) | default 분기 | `<DiscoverWatchlistPage onFetchStocks={fetchStocks} …/>` | OK | `fetchStocks`는 `useStockSearch` 단일 인스턴스에서 주입 |
| A2 | `DiscoverWatchlistPage.tsx:293` | "후보 판정 대시보드" 탭 버튼 | `switchDiscoverTab('overview')` | `discoverTab='overview'` → `showOverview` | OK | |
| A3 | `WatchlistHeader.tsx:233` `FilterModeGrid` | Momentum / Early / Quant 모드 카드 | `setFilters(prev=>{...mode})` | `useRecommendationStore.filters.mode` | OK | |
| A4 | `WatchlistHeader.tsx:144` `AnalysisStartButton` | **"Start leader scan"** 버튼 | `onFetchStocks` → `useStockSearch.fetchStocks` | service 호출 | OK | `loading` 시 disabled + "Analysis running…" |
| A5 | `useStockSearch.ts:28-34` | — | `fetchStocks` → `getStockRecommendations(filters)` | `recommendations.ts:16` mode 라우팅 | OK | `setLoading(true)`·기존 결과/warnings 초기화 선행 |
| A6 | `recommendations.ts:16-28` | — | `getMomentumRecommendations` (mode≠QUANT/BEAR) | `momentumRecommendations.ts:226` | OK | QUANT_SCREEN/BEAR_SCREEN 은 별도 서브모듈(스코프 밖) |
| A7 | `momentumRecommendations.ts:235` | — | `discoverAiUniverse(mode,…)` | `GET /api/ai-universe/discover` | UNKNOWN | 서버 엔드포인트 응답 의존. null 반환 시 candidates=0 → 빈 추천 + warning(`:296`) |
| A8 | `momentumRecommendations.ts:605` | — | `getAI().models.generateContent(prompt)` | 클라이언트 Gemini API | UNKNOWN | **API 키 없으면 `getAI()` throw**(`aiClient.ts:29`) → A12 error 경로 |
| A9 | `momentumRecommendations.ts:633` | — | `enrichStockWithRealData(stock)` (순차) | Yahoo/DART/KIS enrichment | UNKNOWN | 개별 실패는 catch 후 원본 push (부분 성공 허용) |
| A10 | `useStockSearch.ts:49-51` | — | `setRecommendations(diversified)` + `setMarketContext` + `setLastUpdated` | `useRecommendationStore` | OK | 섹터 다변화 후 적재 |
| A11 | `useQuantRecommendations.ts:120` | — | `displayList` 계산 (recommendations+searchResults 필터/정렬) | PageRouter → `DiscoverWatchlistPage` props | OK | `view==='DISCOVER'` → `filteredRecommendations` |
| A12 | `DiscoverWatchlistPage.tsx:646` | 결과 카드 그리드 | `displayList.map(<WatchlistCard/>)` | 화면 표시 | OK | `:613` 결과 카운트 배너 + lastUsedMode 라벨 |
| A13(실패) | `useStockSearch.ts:75-79` | — | `catch` → `setError(message)` | `DiscoverWatchlistPage.tsx:262` error 배너 | OK | 429 분기 별도 메시지. "API Key is missing" 도 여기로 노출 |
| A14(경고) | `useStockSearch.ts:59-68` | — | `setRecommendationWarnings` + `setRecommendationSourceStatus` | `RecommendationWarningsBanner` | PARTIAL | 배너가 `WatchlistHeader` 내부 → **overview 탭에서만** 표시(§4) |
| A15(빈결과) | `DiscoverWatchlistPage.tsx:674-709` | 빈 상태 블록 | `displayList.length===0` | 화면 표시 | PARTIAL | "검색된 종목 없음" 텍스트만, searchQuery 없으면 후속 액션 버튼 없음 |

**흐름 A 정적 결론:** UI→store→표시 배선은 **끊김 없음(OK)**. 단, A7(서버 universe)·A8(클라이언트 Gemini 키)·A9(enrichment) 3개 외부 의존이 모두 `UNKNOWN`이며, 이 중 하나라도 미설정/미가동이면 "버튼은 동작하나 결과 0건"이 된다. 실패는 error 배너 또는 warnings로 노출되지만, **warnings 노출은 overview 탭에 한정**(§6 P1)된다.

---

## 3. 사용자 흐름 B: 직접 종목 검색 (시장 검색)

진입 → search 탭 → 검색어 입력 → "시장 검색"/Enter → 로딩 → `searchStock`(클라이언트 Gemini) → searchResults → displayList → 카드.

| 단계 | 위치/파일 | UI 요소 | 호출 함수 | 다음 연결 | 상태 | 비고 |
|---|---|---|---|---|---|---|
| B0 | `DiscoverWatchlistPage.tsx:307` | "종목 검색" 탭 버튼 | `switchDiscoverTab('search')` | `discoverTab='search'` → `showSearch` | OK | |
| B1 | `DiscoverWatchlistPage.tsx:364` | (조건부 렌더) | `showSearch \|\| view==='WATCHLIST'` | `<WatchlistFilterPanel/>` | OK | **검색 패널은 overview 탭엔 없음** — search 탭에서만 노출 |
| B2 | `WatchlistFilterPanel.tsx:236-245` | 검색 입력창 | `onChange→setSearchQuery` / `onKeyDown Enter→onMarketSearch` | `useRecommendationStore.searchQuery` | OK | `setSearchQuery`는 `useWatchlistFilters`→동일 store |
| B3 | `WatchlistFilterPanel.tsx:247` | **"시장 검색"** 버튼 | `onMarketSearch` → `useStockSearch.handleMarketSearch` | service 호출 | OK | `searchingSpecific` 시 disabled + "검색 중…" |
| B4 | `useStockSearch.ts:83-87` | — | `clearSearchCache()` + `searchStock(searchQuery, {…filters})` | `stockSearch.ts:15` | OK | selectedType/pattern/sentiment/checklist/min·maxPrice 전달 |
| B5 | `stockSearch.ts:152-168` | — | `getAI().models.generateContent(prompt)` (googleSearch grounding) | 클라이언트 Gemini API | UNKNOWN | **API 키 없으면 throw** → B9 error 경로 |
| B6 | `stockSearch.ts:174-183` | — | `enrichStockWithRealData` 순차 | Yahoo/DART/KIS enrichment | UNKNOWN | 5분 메모리 캐시(`searchCache`) |
| B7 | `useStockSearch.ts:88-95` | — | `setSearchResults(prev=>[…])` (중복 code 제거 병합) | `useRecommendationStore.searchResults` | OK | 빈칸 검색은 상위 10개 slice |
| B8 | `useQuantRecommendations.ts:99-116` | — | `filteredRecommendations` = recommendations+searchResults 병합 후 필터 | `displayList` → 카드 | OK | `searchResultCodes`가 searchMatch 우회 보장(`:112`) |
| B9(실패) | `useStockSearch.ts:97-101` | — | `catch` → `setError` + `toast.error` | error 배너 | OK | 429 별도 분기 |
| B10(0건) | `useStockSearch.ts:96` | — | `toast.error('종목을 찾을 수 없습니다')` | toast | PARTIAL | 0건 사유는 toast(8s)만, 영구 배너 없음 |
| B11(빈상태) | `DiscoverWatchlistPage.tsx:694` | "전체 시장에서 검색" 버튼 | `onMarketSearch` (searchQuery 있을 때) | `handleMarketSearch` | OK | 필터된 리스트 0건 시 전체검색 유도 |

**흐름 B 정적 결론:** 배선 **OK**. 단 B5(Gemini 키)·B6(enrichment) `UNKNOWN`. 흐름 A와 달리 `handleMarketSearch`는 **warnings/sourceStatus/lastUpdated를 설정하지 않음** → 상태 가시성은 toast에만 의존(B10).

---

## 4. 상태 표시 점검

| 항목 | 연결 위치 (write) | 표시 위치 (read) | 상태 | 비고 |
|---|---|---|---|---|
| loading | `useStockSearch.fetchStocks` `setLoading` | `WatchlistHeader` 버튼(`:147`) · 카드 영역 Skeleton(`DiscoverWatchlistPage.tsx:599`) · 필터패널 새로고침 스피너(`WatchlistFilterPanel.tsx:117`) | OK | Skeleton·error는 두 탭 공통(`view==='DISCOVER'`) |
| searchingSpecific | `handleMarketSearch` `setSearchingSpecific` | "시장 검색" 버튼(`:249`) · 빈상태 버튼(`:699`) | OK | 흐름 B 전용 로딩 |
| error | `fetchStocks`/`handleMarketSearch` `setError` | `DiscoverWatchlistPage.tsx:262` error 배너 | OK | **두 탭 모두 노출**(탭 비종속) |
| empty result reason | `setRecommendationWarnings`(A) / toast(B) | `RecommendationWarningsBanner`(overview) · toast · 빈상태 텍스트(`:686`) | PARTIAL | 사유 영구 표시가 overview 탭에 한정. search 탭은 toast(8s)뿐 |
| sourceStatus | `fetchStocks` `setRecommendationSourceStatus` | `RecommendationWarningsBanner` 톤 분기(`:80`) | PARTIAL | overview 탭에서만 렌더 + 흐름 B는 미설정 |
| warnings | `fetchStocks` `setRecommendationWarnings` | `RecommendationWarningsBanner`(`:78`) | PARTIAL | **`WatchlistHeader` 내부에만 마운트 → overview 탭 전용** |
| lastUpdated | `fetchStocks` `setLastUpdated` | `WatchlistHeader` `LastUpdatedInfo`(`:164`) | PARTIAL | overview 탭에서만 표시. 30분 경과 stale 경고 포함 |
| result count | (파생) `displayList.length` | 결과 배너(`:631`) · WATCHLIST 헤더(`:421`) | OK | |
| marketContext.dataSource | `fetchStocks` `setMarketContext` | `LastUpdatedInfo`(`:178`) | PARTIAL | overview 탭에서만 표시 |
| OffHoursBanner | (자체 데이터원) | `WatchlistHeader.tsx:419` | PARTIAL | overview 탭 전용 — 장전/장후 안내가 search 탭엔 없음 |

---

## 5. Store / State Mapping

`useRecommendationStore` (`src/stores/useRecommendationStore.ts`) 기준.

| 상태명 | 정의 위치 | 쓰는 곳 (write) | 읽는 곳 (read) | DISCOVER 표시 | 상태 |
|---|---|---|---|---|---|
| recommendations | `:79` | `useStockSearch.fetchStocks:49` | `useQuantRecommendations`·`useWatchlistData`·`WatchlistHeader`(Top3)·`GatePyramid` | 카드 + Top3 + 피라미드 | OK |
| searchResults | `:109` | `handleMarketSearch:88` / `fetchStocks`가 `[]` 초기화 | `useQuantRecommendations:99`(병합) | 카드(병합 displayList) | OK |
| loading | `:144` | `fetchStocks`/`handleScreener` | 다수(§4) | 버튼·Skeleton | OK |
| error | `:148` | `fetchStocks`/`handleMarketSearch`/`handleScreener` | `DiscoverWatchlistPage:263` | error 배너 | OK |
| searchingSpecific | `:150` | `handleMarketSearch` | 시장검색 버튼 | 버튼 상태 | OK |
| recommendationWarnings | `:153` | `fetchStocks:65`(흐름 A만) | `RecommendationWarningsBanner:78` | overview 탭만 | PARTIAL |
| recommendationSourceStatus | `:155` | `fetchStocks:68`(흐름 A만) | `RecommendationWarningsBanner:80` | overview 탭만 | PARTIAL |
| lastUpdated | `:146` | `fetchStocks:51`(흐름 A만) | `WatchlistHeader LastUpdatedInfo` | overview 탭만 | PARTIAL |
| lastUsedMode | `:133` | `fetchStocks:48` | 결과 배너(`:620`) | "지금 살/미리 볼 종목" 라벨 | OK |
| searchQuery | `:125` | `useWatchlistFilters.setSearchQuery` = `useStockSearch`가 읽는 값과 **동일 store** | `useStockSearch`·`useQuantRecommendations`·입력창 | 입력창 + 필터 | OK |
| recommendationHistory | `:137` | `fetchStocks:38` + `localStorage` | `DiscoverWatchlistPage:573`(히스토리 카드) | overview 탭만 | OK |
| screenerRecommendations | `:111` | `handleScreener:109` | (DISCOVER 미사용 — Screener 페이지 전용) | 미표시 | DECORATIVE(이 흐름 기준) |

> **확인된 정합 포인트:** `searchQuery`는 `useWatchlistFilters`와 `useStockSearch` 모두 **동일한 `useRecommendationStore`**에서 읽는다 → 입력값과 검색 실행값이 일치(끊김 없음). 이전에 우려했던 "입력은 되는데 검색에 안 실리는" split-source 문제는 **없음**.

---

## 6. 끊긴 연결 후보

| 우선순위 | 문제 | 위치 | 영향 | 수정 방향 |
|---|---|---|---|---|
| **P0** | 종목 탐색의 핵심 데이터원 3종이 모두 외부 의존이며 정적 확인 불가 — ① 클라이언트 Gemini 키(`getAI()`), ② `GET /api/ai-universe/discover`, ③ `GET /api/screener/pipeline-summary` | `aiClient.ts:29` · `aiUniverseClient.ts:158` · `screenerPipelineClient` | 키 미설정 또는 서버 미가동 시 "버튼은 눌리는데 결과 0건"/"통계 데이터 없음" → 사용자 체감 "거의 동작 안 함"의 1순위 원인 후보 | **수정 아님 — 먼저 진단.** 런타임에서 키·엔드포인트 응답을 확인(아래 §7-1) |
| **P1** | warnings/sourceStatus/lastUpdated/OffHoursBanner가 `WatchlistHeader` 내부에만 마운트되어 **overview 탭에서만** 표시. search 탭에서 새로고침/검색 시 사유가 안 보임 | `WatchlistHeader.tsx:419-420` · `DiscoverWatchlistPage.tsx:325` | "버튼만 누르고 결과 없음" 인지 — 문서화된 안티패턴(store 주석 `useStockSearch.ts:62`)과 정확히 일치 | 배너들을 `DiscoverWatchlistPage` 상단(탭 비종속 위치)으로 끌어올려 두 탭 공통 렌더 |
| **P1** | 흐름 B(`handleMarketSearch`)는 warnings/sourceStatus/lastUpdated를 설정하지 않음 — 0건 사유가 toast(8s)에만 노출 | `useStockSearch.ts:83-103` | 직접 검색 0건 시 영구 안내 부재 | 흐름 B에도 사유를 store 경유 배너로 노출(흐름 A와 정합) |
| **P1** | `CandidatePipelinePanel`(서버 스크리너 데이터원)과 사용자 버튼 추천(클라이언트 데이터원)이 **다른 파이프라인** — 같은 화면에서 숫자 불일치 가능 | `DiscoverWatchlistPage.tsx:357` | 데이터 원천 혼동(불변식 #3 위반 위험) | 패널에 데이터 원천·기준시각 라벨 명시(혼동 방지). 통합은 별도 과제 |
| **P2** | overview 탭 빈 상태에 후속 액션 버튼 없음(searchQuery 있을 때만 "전체 시장에서 검색" 노출) | `DiscoverWatchlistPage.tsx:686-708` | 0건 후 다음 행동 유도 약함 | 빈 상태에 "다시 스캔"/탭 전환 유도 추가(polish) |

---

## 7. 첫 번째 코드 수정 후보 (이번 단계에서는 수정하지 않음 — 다음 단계 제안만)

### 후보 1 (선행: 진단) — 데이터원 3종 런타임 확인

1. **수정 후보**: (코드 수정 아님) Gemini 키 + `/api/ai-universe/discover` + `/api/screener/pipeline-summary` 응답을 실행 환경에서 확인.
2. **이유**: 흐름 A/B의 UI 배선은 정적으로 OK이므로, "거의 동작 안 함"의 실제 원인은 외부 의존(§6 P0)일 가능성이 가장 높다. 배선 수정 전에 근본 원인을 분리해야 헛수정 방지.
3. **관련 파일**: `src/services/stock/aiClient.ts` · `src/api/aiUniverseClient.ts` · `src/api/screenerPipelineClient.ts` · `.env.example`(`VITE_GEMINI_API_KEY`)
4. **기대 효과**: "키 문제"인지 "배선 문제"인지 즉시 판별.
5. **리스크**: 없음(읽기 진단). 키 값은 로그/커밋에 노출 금지.
6. **수정 전 확인**: 브라우저 콘솔의 `getAI()` throw 여부, Network 탭의 두 엔드포인트 상태코드, 서버 가동 여부.

### 후보 2 (실제 첫 코드 수정 권장) — 상태 배너 탭 승격

1. **수정 후보**: `RecommendationWarningsBanner` / `OffHoursBanner` / lastUpdated 표시를 `WatchlistHeader`에서 분리해 `DiscoverWatchlistPage` 상단(탭 비종속)으로 이동.
2. **이유**: §6 P1 — search 탭에서 사유가 안 보이는 "버튼만 누르고 결과 없음" 인지 직접 해소. store 배선은 이미 완비되어 표시 위치만 바꾸면 됨(저위험·고효용).
3. **관련 파일**: `src/pages/DiscoverWatchlistPage.tsx`(렌더 위치) · `src/components/watchlist/WatchlistHeader.tsx`(배너 제거).
4. **기대 효과**: 두 탭 모두에서 데이터 추정 안내·장전/장후·최종 업데이트 시각이 항상 보임.
5. **리스크**: 배너 중복 렌더(WatchlistHeader에서 제거 누락 시) — 이동(이전)으로 처리해 중복 회피.
6. **수정 전 확인**: WatchlistHeader 외 다른 페이지에서 두 배너를 재사용하는지(현재 grep 결과 `WatchlistHeader`가 유일 사용처 — 안전).

---

## 8. 결론

현재 DISCOVER / 종목 탐색 흐름의 전체 상태는 **`PARTIAL`**이다.
UI→hook→store→service→표시의 정적 배선은 두 흐름 모두 **끊김 없이 OK**이나, ① 핵심 동작이 외부 의존 3종(Gemini 키·universe 엔드포인트·pipeline 엔드포인트)에 좌우되고(`UNKNOWN`), ② 상태 사유 배너가 overview 탭에만 표시되어 가시성이 절름발이다.

가장 먼저 수정해야 할 **P0** 항목은 **`데이터원 3종 런타임 확인`**(특히 클라이언트 Gemini API 키 `getAI()` 설정 여부)이다 — 배선이 아닌 의존 미충족이 "거의 동작 안 함"의 1순위 후보이기 때문이다.
다음 단계에서는 먼저 **`src/services/stock/aiClient.ts:getAI()` + `/api/ai-universe/discover` 응답을 실행 환경에서 진단**하고, 그 후 첫 코드 수정으로 **`src/pages/DiscoverWatchlistPage.tsx`에서 `RecommendationWarningsBanner`/`OffHoursBanner`를 탭 비종속 위치로 승격**하는 것이 적절하다.

---

## 검증 명령 (package.json 확인 결과 — 이번 단계 실행은 선택)

| 명령 | 존재 | 비고 |
|---|---|---|
| `npm run typecheck` | ✅ (`tsc --noEmit` ×2) | |
| `npm test` | ✅ (`vitest run`) | `test:client`(`vitest run src`)로 UI 한정 가능 |
| `npm run validate:pendingWiring` | ✅ (`scripts/check_pending_wiring.js`) | wiring 백로그 SLA 검사 |
| `npm run validate:uiLanguage` | ✅ (`scripts/check_ui_language.js`) | UI 문구 정책 검사 |

> 이번 문서는 코드 무수정 배선 지도다. 위 명령 실행은 다음 수정 단계에서 회귀 검증용으로 사용한다.
