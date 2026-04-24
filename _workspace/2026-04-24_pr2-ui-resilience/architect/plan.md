# PR-2 Implementation Plan

**Scope:** #1 Watchlist UI↔server sync · #2 UI API resilience
**Branch:** `claude/sync-watchlist-api-CnA89` (PR-1 변경 위에 이어 작업)

---

## 현황 확인

- `QueryClientProvider` 이미 `src/components/common/QueryProvider.tsx` 설정됨 (staleTime=60s, persist 적용).
- 최상위 `ErrorBoundary` + `SectionErrorBoundary` 이미 존재.
- `src/api/client.ts` `apiFetch` (throw) / `apiFetchSafe` (fallback) 제공.
- 서버에 `/api/auto-trade/watchlist` CRUD 있음 — 하지만 그쪽은 auto-trade 용(entryPrice/stopLoss/targetPrice 필수) 이므로 UI "관심종목"과 분리 필요.

---

## 태스크 #1 — Watchlist UI↔Server sync

### 서버
- `server/persistence/paths.ts` — `USER_WATCHLIST_FILE` 추가.
- `server/persistence/userWatchlistRepo.ts` (신규) — UI "관심종목" 전용 경량 store.
  ```ts
  interface UserWatchlistItem {
    code: string;
    name: string;
    watchedAt: string;
    watchedPrice?: number;
    currentPrice?: number;
    signalType?: string;
    sector?: string;
    gateScore?: number;
  }
  loadUserWatchlist(): UserWatchlistItem[]
  saveUserWatchlist(list: UserWatchlistItem[]): void
  ```
- `server/routes/userWatchlistRouter.ts` (신규)
  - `GET  /api/user-watchlist` → 전체 조회
  - `PUT  /api/user-watchlist` → 배열 전체 치환 (UI는 debounce로 batch sync)
  - `POST /api/user-watchlist/toggle` → 단일 toggle (낙관적 업데이트 파트너)
  - `DELETE /api/user-watchlist/:code` → 단건 제거
- `server/index.ts` 에 router mount.

### 클라이언트
- `src/api/autoTradeClient.ts` 에 `userWatchlistApi` 추가 — `getAll`, `replaceAll`, `toggle`, `remove`.
- `src/hooks/useWatchlistSync.ts` (신규)
  - `useQuery(['user-watchlist'])` 로 서버 조회
  - 초기 마운트 시 서버 리스트로 Zustand store 의 watchlist 덮어쓰기 (server wins)
  - mutation: toggle · remove, 낙관적 업데이트 + 실패 시 rollback
  - 500ms debounce 로 `replaceAll` 을 폴백 sync (이벤트 누수 방지)
- `src/App.tsx` 에서 `useWatchlistSync()` 마운트.
- `src/stores/useRecommendationStore.ts` — `toggleWatchlist` 는 그대로 (로컬 즉시 반영), 서버 동기화는 hook 에서 관찰자로 수행.
- `persist` `partialize` 는 watchlist 를 localStorage 에 유지 (오프라인 fallback).

---

## 태스크 #2 — API 호출 실패 시 UI 안전

### TanStack Query 기본값 강화
- `QueryProvider.tsx` 에 `retry: 2`, `retryDelay: attempt => Math.min(1000 * 2 ** attempt, 8000)`, `onError` 기본 훅 추가.
- `MutationCache` 에 `onError` toast 연결.

### 개별 페이지
- `ScreenerPage.tsx` (L56-69): `fetch('/api/health/pipeline')` 폴링을 `useQuery({ queryKey: ['pipeline-health'], refetchInterval: 30_000, retry: 1, staleTime: 15_000 })` 로 치환. 에러 시 기존 silent pass 유지(상단 카드 숨김으로 처리, 전체 페이지는 안 깨짐).
- Watchlist 위젯·SectorEtf 카드 등 실패해도 나머지 렌더링은 유지되어야 하므로 `<SectionErrorBoundary>` 로 래핑.
- MarketPage 의 자동 fetch 는 retry 내장된 useMarketData 에 의존 — 최소 침습 변경.

### 새 공통 hook
- `src/hooks/useSafeQuery.ts` (신규, 선택적)
  - useQuery wrapper — retry + toast + fallback 데이터 명시.
  - 마이그레이션 대상 페이지부터 단계적 적용.

---

## 파일 변경 리스트 (예상)

### 서버 (신규 4개, 수정 2개)
- `server/persistence/userWatchlistRepo.ts` 신규
- `server/persistence/paths.ts` 수정
- `server/routes/userWatchlistRouter.ts` 신규
- `server/index.ts` 수정 (router mount)
- `server/persistence/userWatchlistRepo.test.ts` 신규
- `server/routes/userWatchlistRouter.test.ts` 신규 (선택)

### 클라이언트 (신규 2~3개, 수정 4~5개)
- `src/api/autoTradeClient.ts` 수정 (userWatchlistApi 추가)
- `src/hooks/useWatchlistSync.ts` 신규
- `src/hooks/useSafeQuery.ts` 신규 (선택)
- `src/App.tsx` 수정 (useWatchlistSync 마운트)
- `src/components/common/QueryProvider.tsx` 수정 (retry + onError)
- `src/pages/ScreenerPage.tsx` 수정 (useQuery 전환)
- `src/stores/useRecommendationStore.ts` 주석 정리 (SSOT 표기)

### 테스트
- `server/persistence/userWatchlistRepo.test.ts` — load/save round-trip
- (선택) UI hook 테스트는 vitest + jsdom 필요 — 복잡하므로 이번 PR 에선 생략 가능

---

## DoD

- `npm run lint` 통과 (클라 + 서버).
- `npm run validate:all` 통과, WARN 카운트 증가 없음.
- 신규 `userWatchlistRepo.test.ts` 통과.
- 기존 회귀 테스트 통과.
- 서버 기동(`npm run dev:server`) 후 `curl /api/user-watchlist` 정상 응답.
- 브라우저에서 워치리스트 추가 → 새로고침 시 유지 확인.
