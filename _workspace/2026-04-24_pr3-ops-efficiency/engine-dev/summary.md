# PR-3 engine-dev 산출물 요약

## 신규 파일
- `server/persistence/watchlistRepo.test.ts` — 섹션 하드캡 강제 5 케이스
- `server/persistence/aiCacheRepo.test.ts` — canonical 캐시키 7 케이스

## 수정 파일

### #8 섹션별 하드캡 강제
- `server/persistence/watchlistRepo.ts`
  - `SECTION_HARD_MAX` (SWING=8, CATALYST=5, MOMENTUM=50) 상수 + `enforceSectionCaps()` 헬퍼.
  - `saveWatchlist()` 가 매 호출마다 gateScore 기준 트림 수행.
  - LeadershipBridge 표식은 동점일 때 먼저 드롭.
  - 트림 발생 시 15분 쿨다운 `watchlist-autotrim` 알림 추가. 기존 포화 경보는 30분 쿨다운 유지.

### #9 /reconcile push + 스케줄드 드라이런
- `server/scheduler/maintenanceJobs.ts`
  - 매일 KST 16:05 (UTC 07:05) 평일 `reconcileShadowQuantities({ dryRun: true })` 자동 실행.
  - drift 발견 시 `shadow-dryrun-broadcast` dedupeKey로 1시간 쿨다운 텔레그램 브로드캐스트.
- `server/telegram/webhookHandler.ts`
  - `/reconcile push` 서브커맨드 추가 — 서버 장부 기준 활성 포지션 전수를 [SHADOW]/[LIVE] 태깅하여 브로드캐스트.
  - `/help` 문구 갱신.

### #6 Gemini 재시도 상향
- `server/clients/geminiClient.ts`
  - `MAX_RETRIES` 2 → 3, `BACKOFF_BASE_MS` 800 → 1500.
  - 총 백오프 5.6s → 10.5s. nightly 배치 경로라 사용자 지연 영향 없음.
- `server/learning/nightlyReflectionEngine.ts:211` 은 이미 `geminiRuntime.reason` 을 메시지에 포함 — 추가 변경 불필요.

### #3 Canonical 캐시키
- `server/persistence/aiCacheRepo.ts`
  - `makeCanonicalCacheKey({ prompt, model?, params?, scope? })` export.
  - 규칙: 공백 normalize + JSON 키 정렬 + 모델명 lowercase + scope 분리 + SHA256 12자 해시 + `v1:` 버전 접두사.
  - 호출자 미변경 (opt-in). 향후 고빈도 Gemini 호출 경로가 이 helper 로 점진 이전.

## 검증
- `npm run lint` 클라 + 서버 모두 통과.
- `npm run validate:all` 전부 OK (WARN 카운트 유지: responsibility 624→623, SDS 4 baseline).
- PR-3 테스트:
  - `watchlistRepo.test.ts` — 5/5 pass
  - `aiCacheRepo.test.ts` — 7/7 pass
- PR-1·PR-2 회귀:
  - `shadowTradeRepo.test.ts` 5/5, `preMarketGapProbe.test.ts` 8/8
  - `preOrderGuard.test.ts` 11/11, `tradingOrchestrator.test.ts` 3/3
  - `userWatchlistRepo.test.ts` 8/8
  - **총 47/47 passing**

## 경계·규칙 준수
- KIS 호출 경유 변화 없음.
- `reconcileShadowQuantities` 는 이미 export 된 SSOT 함수 — 단순 import 추가.
- `watchlistRepo` 트림 로직은 순환 import 회피 위해 `watchlistManager.SECTION_MAX` 값을 복제 (주석으로 동기 필요성 명시).
- `[SHADOW]` 뱃지 정책 유지 — `/reconcile push` 출력도 동일 패턴.

## 회귀 리스크 / 남은 TODO
- `SECTION_HARD_MAX` 값이 `watchlistManager` 와 어긋나면 혼란 — 단일 출처로 통합하려면 watchlistManager → watchlistRepo 로 상수 이동 필요 (순환 import 해결 선결). 별도 소규모 PR.
- Gemini retry 10.5s 는 긴 경로에선 타임아웃 예산과 겹칠 수 있음 — nightly 배치는 여유, 실시간 UI 호출은 retry:1 로 override 필요 시점에 조정.
- `makeCanonicalCacheKey` 를 기존 68개 Gemini 호출 지점 중 고빈도(supplyChain · reportGenerator) 에만 우선 적용하는 후속 PR 가능.

## quality-guard 체크포인트 (PR-3 전용)
1. lint ✅
2. validate:all WARN 비증가 ✅
3. 신규 12 테스트 + 회귀 47 테스트 ✅
4. 경계: reconcileShadowQuantities 단일 export 경유 ✅
5. precommit — 배포 창 차단 중 (16:30 이후 실행)
