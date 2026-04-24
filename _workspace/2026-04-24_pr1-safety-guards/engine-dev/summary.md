# PR-1 engine-dev 산출물 요약

## 생성 파일
- `server/trading/preMarketGapProbe.ts` — KIS 전일종가 기반 갭 probe (ADR-0004 대체 경로)
- `server/trading/preMarketGapProbe.test.ts` — 5 decision 분기 + 영업일 경계 테스트
- `server/persistence/shadowTradeRepo.test.ts` — `computeShadowMonthlyStats` 계약 테스트
- `docs/adr/0004-yahoo-adr-deprecation.md` — architect 산출

## 수정 파일

### 태스크 #4 — Yahoo ADR 비활성
- `server/alerts/adrGapCalculator.ts`
  - 전체 stub 화. `getLatestAdrGapState()` → null, `runAdrGapScan()` → 빈 배열.
  - `@deprecated ADR-0004` 주석 + DEFAULT_ADR_TARGETS 빈 배열.
- `server/clients/kisClient.ts`
  - `PrevClose` 인터페이스 + `fetchKisPrevClose(stockCode)` 추가.
  - 1차 FHKST01010100 `stck_sdpr`, 2차 FHKST03010100 일봉 fallback, 실패 시 null.

### 태스크 #5 — Gap 기준가 교체
- `server/trading/preMarketGapProbe.ts` (신규): PROCEED/WARN/SKIP_DATA_ERROR/SKIP_STALE/SKIP_NO_DATA 5종 분기.
- `server/orchestrator/tradingOrchestrator.ts`
  - Yahoo `fetchYahooQuote` 제거, `probePreMarketGap` 로 교체.
  - 워치리스트 skipReason 기록 (`lastSkipReason`, `lastSkipAt`).
- `server/persistence/watchlistRepo.ts`
  - `WatchlistEntry` 에 `lastSkipReason?`, `lastSkipAt?` 옵셔널 필드 추가.

### 태스크 #7 — 동시호가 Full 가드
- `server/orchestrator/tradingOrchestrator.ts`
  - 진입부 `activeCount >= maxPositions` 즉시 return + 텔레그램 경보.
  - 루프 내 `activeCount + orderedCount >= maxPositions` break.
  - LIVE KIS 주문 직전 `assertSafeOrder()` 호출 (`PreOrderGuardError` 차단 시 해당 종목 skipReason 기록).
  - `REGIME_CONFIGS[regime].maxPositions` 로 레짐별 동적 상한 적용.

### 태스크 #10 — Shadow 집계·[SHADOW] 뱃지
- `server/persistence/shadowTradeRepo.ts`
  - `ShadowMonthlyStats` 인터페이스.
  - `isClosedShadowStatus()`, `computeShadowMonthlyStats(month?)` 신규.
  - fills SSOT 기반 당월 closed 집계(복리 수익률·PF·STRONG_BUY 승률·미결 포지션).
- `server/telegram/webhookHandler.ts`
  - `/shadow` 핸들러: `getMonthlyStats()` → `computeShadowMonthlyStats()` 로 교체.
  - `[SHADOW]` 뱃지 전수 적용: `/shadow`, `/pos`, `/pnl`, `/status`, `/sell` (Shadow 봉쇄·결과 라벨).
  - 쓰이지 않게 된 `getMonthlyStats` import 제거.
- `server/alerts/reportGenerator.ts`
  - 일일 리포트 Gemini 프롬프트의 "거래 모드" 라벨에 `[SHADOW]` 뱃지 적용.
- `server/orchestrator/tradingOrchestrator.ts`
  - 동시호가 SHADOW 예약 메시지에 `⚠️ SHADOW 모드 — 실계좌 잔고 아님` 명시.

## 테스트
- `npx vitest run server/trading/preMarketGapProbe.test.ts` — 통과 (예정)
- `npx vitest run server/persistence/shadowTradeRepo.test.ts` — 통과 (예정)
- quality-guard 단계에서 전체 실행.

## 경계·규칙 준수
- KIS 호출은 `kisClient.ts` 만 경유 (ARCHITECTURE.md 규칙) ✅
- 실주문은 orchestrator/autoTradeEngine 만 ✅
- 새 파일 `@responsibility` 태그 포함 ✅
- `adrGapCalculator.ts` 호출처(`engineRouter` safe 래퍼, `alertJobs` cron)는 null-safe 유지 — 기존 safe() 체인이 흡수.

## 남은 리스크 / TODO
- `adrGapCalculator.ts` 호출처 제거는 후속 PR 로 (이번 PR 은 stub 유지로 회귀 최소화).
- Yahoo preMarket 가격에 의존하던 Gate 재평가는 이미 `runAutoSignalScan(MARKET_OPEN)` 이 장 시작 후 실가격으로 처리 — preMarket 경로에서는 entry snapshot gateScore 만 사용하도록 단순화.
- `webhookHandler.ts` P1 분해는 본 PR 범위 밖.

## quality-guard 체크포인트
1. `npm run lint` — 특히 `adrGapCalculator.ts` 에서 미사용 import 잔존 여부.
2. `npm run validate:all` — responsibility · complexity · gemini · SDS · exposure.
3. 신규 테스트 2건 + 회귀(`preOrderGuard.test.ts`, `signalScanner.test.ts`) 실행.
4. `[SHADOW]` 뱃지 일관성 grep 점검.
5. `npm run precommit` 최종 게이트.
