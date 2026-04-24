# PR-2 dashboard-dev 산출물 요약

## 신규 파일
- `server/persistence/userWatchlistRepo.ts` — 경량 관심종목 store (load/save/toggle/remove, 500건 트림)
- `server/persistence/userWatchlistRepo.test.ts` — 8 케이스 (load/save/toggle/remove/invalid/trim)
- `server/routes/userWatchlistRouter.ts` — GET/PUT/POST toggle/DELETE REST 엔드포인트
- `src/hooks/useWatchlistSync.ts` — Zustand ↔ 서버 양방향 sync (500ms debounce PUT + 초기 server-wins prime)

## 수정 파일
- `server/persistence/paths.ts` — `USER_WATCHLIST_FILE` 상수 추가
- `server/index.ts` — `userWatchlistRouter` 마운트 (다른 라우터들과 분리, prefix 없음 — 라우터가 `/api/user-watchlist` 전체 경로 가짐)
- `src/api/autoTradeClient.ts` — `userWatchlistApi` (getAll/replaceAll/toggle/remove) + `UserWatchlistItem` 타입
- `src/App.tsx` — `useWatchlistSync()` 마운트 훅 호출
- `src/components/common/QueryProvider.tsx` — 기본 `retry: 2` (4xx 는 즉시 포기) + exponential `retryDelay` + `QueryCache`/`MutationCache` 전역 onError toast
- `src/pages/ScreenerPage.tsx` — `/api/health/pipeline` silent-fail fetch 를 `useQuery` 로 전환 (retry/staleTime/refetchInterval 적용)

## 검증
- `npm run lint` 클라 + 서버 모두 통과 (tsc --noEmit clean)
- `npm run validate:all` 전부 OK (WARN 카운트 비증가: responsibility 624→623, SDS 4 baseline 유지)
- PR-2 테스트:
  - `server/persistence/userWatchlistRepo.test.ts` — 8/8 pass
- 회귀 테스트:
  - PR-1 테스트 4개 파일(shadow/gap/orchestrator/preOrderGuard) — 27/27 pass

## 경계·규칙 준수
- 자동매매 워치리스트(`watchlistRepo.ts`)와 사용자 북마크(`userWatchlistRepo.ts`) 완전 분리 — preMarketOrderPrep 는 사용자 관심종목을 주문 대상으로 삼지 않는다.
- KIS·Gemini 호출 없음 (UI 저장소 전용).
- `stockService` 단일 통로·`kisClient` 단일 통로·`autoTradeEngine` 단일 통로 변화 없음.
- 서버 보안: `PUT /api/user-watchlist` 는 items 배열 타입 검증 후 저장. 500건 트림.
- 프론트 SSOT: Zustand 는 로컬 캐시, 서버가 SSOT. prime 이후 debounce PUT 으로 서버 상태 단일화.

## 회귀 리스크 / 남은 TODO
- 멀티 탭 열린 상태에서 한 탭이 PUT 치환하면 다른 탭은 다음 `staleTime` 이후 동기화 — 즉시성은 낮다. 필요 시 SSE/WebSocket 으로 upgrade (향후 PR).
- `useWatchlistSync` 는 App.tsx 에서 1회 마운트되므로 StrictMode 이중 마운트에서 2회 prime 가능 — 멱등이라 안전하지만 debounce 초기값이 같이 움직일 여지 있음(현재는 primedRef 로 방어).
- ScreenerPage 외 다른 페이지의 silent-fail 은 다음 PR 에서 점진 전환.

## quality-guard 체크포인트
1. `npm run lint` — 완료 ✅
2. `npm run validate:all` — 완료 (증가 없음) ✅
3. 신규 테스트 8건 pass ✅
4. 경계: `watchlistRepo` ↔ `userWatchlistRepo` 완전 분리 (서버 import 체인 확인) ✅
5. `npm run precommit` — 배포 창 차단 중 (16:30 이후 재실행 필요) ⏳
