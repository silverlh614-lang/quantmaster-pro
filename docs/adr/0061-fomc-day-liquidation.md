# ADR-0061: FOMC DAY 보유 포지션 강제 전량 청산 정책

## 상태
Accepted (2026-04-27)

## 관련 ADR
- [ADR-0014 KIS Retry Safety Policy](./0014-kis-retry-safety-policy.md) — kisPost idempotency 'unsafe' + 5xx 재시도 차단으로 청산 주문 중복 발사 방지
- [ADR-0028 exitEngine Decomposition](./0028-exitEngine-decomposition.md) — `reserveSell` SSOT + r6EmergencyExit 패턴 (placeKisSellOrder → reserveSell → addSellOrder LIVE 한정) 차용
- [ADR-0044 Private vs Channel Separation](./0038-private-vs-channel-separation.md) — 잔고/실주문 정보는 CH1 EXECUTION 채널 부적합, `sendPrivateAlert` 단일 경유
- [ADR-0057 FOMC Policy v4](./0057-fomc-policy-v4.md) — DAY 신규 진입 차단의 보유 포지션 갭 후속

## 배경

FOMC 정책 v3.1/v4 (2026-04-26) 가 DAY phase 의 *신규 진입 Kelly 0.0* 을 정착시켰지만, **보유 포지션 강제 청산은 부재**였다. 사용자 운영 보고:

- v3.1/v4 가 D-3~D-1 보수적 진입(Kelly ×0.75) + DAY 신규 진입 차단을 보장.
- 그러나 D-1 까지 누적된 *기존 보유 포지션* 은 그대로 발표 변동성에 노출 → 익일 09:00 시초가 점프(평균 ±2~5%) 의 수동 대응 부담.
- FOMC 4/29 임박 — 자동 청산 정책 없으면 수동 청산 누락 위험.

기존 exitEngine 의 `r6EmergencyExit` 가 R6_DEFENSE 레짐 진입 시 30% 청산 정책을 보유하지만, FOMC DAY 는 *시장 레짐 분류* 와 무관한 *캘린더 이벤트* 라 독립 SSOT 필요.

## 결정

### 1. FOMC DAY 평일 14:30 KST 자동 전량 청산
- 활성 LIVE/SHADOW 포지션 (`status === 'ACTIVE' \|\| 'PARTIALLY_FILLED'`) 을 시장가 전량 청산.
- 시각 boundary: `liquidationStartKstTime=14:30` (장마감 60분 전) ~ `liquidationCompleteKstTime=15:20` (장마감 10분 전 목표).
- 사전 경보 3회: 09:00 (당일 안내) / 14:00 (30분 전) / 14:30 (결과 보고).

### 2. 5중 안전 가드 SSOT (`shouldExecuteLiquidationAt`)
모두 통과해야 청산 실행:
1. `getFomcProximity().phase === 'DAY'` (FOMC 캘린더 게이트, 비-DAY 일은 silent return)
2. `config.enabled === true` (env `FOMC_DAY_LIQUIDATION_ENABLED='false'` 회로)
3. `process.env.AUTO_TRADE_ENABLED === 'true'` (전역 매매 활성)
4. `getEmergencyStop() === false` (운영자 직접 처리 중일 가능성)
5. KST 시각이 `[start, complete)` 범위 (cron 일찍/늦게 발동된 race 안전)

### 3. reserveSell SSOT 단일 경유 (절대 규칙 #2/#4)
`fomcDayLiquidation.liquidateAllForFomc()` 는 종목별로:
1. `placeKisSellOrder(stockCode, name, qty, 'STOP_LOSS')` — kisClient 단일 통로 준수
2. `reserveSell(trade, orderRes, sellEvent, 'FOMC_DAY_LIQ')` — fill 회계 (PROVISIONAL/CONFIRMED/FAILED) 위임
3. LIVE PENDING 시 `addSellOrder(...)` — fillMonitor 폴링 등록
4. `buildExitAttribution('FOMC_DAY_LIQUIDATION', ['fomc_day_force_close'], regime)` — 학습 입력 attribution 부착

종목별 try/catch 로 부분 실패 흡수 — 한 종목 throw 가 다른 종목 청산 차단 안 함.

### 4. 텔레그램 sendPrivateAlert 단일 채널 (ADR-0044)
잔고/실주문 정보 노출이라 CH1 EXECUTION 부적합. 모든 메시지(09:00 사전 / 14:00 30분 전 / 14:30 결과) 는 운영자 DM:
- `priority='HIGH'` (사전 경보) / `'CRITICAL'` (실패 시) / `'NORMAL'` (활성 0건)
- `dedupeKey='fomc_day_{morning,pre_liq,liq_result}:{KST 일자}'` + 20h cooldown — 재시작 시 이중 발송 차단

### 5. dryRun 모드
env `FOMC_DAY_LIQUIDATION_DRY_RUN='true'` 시 `placeKisSellOrder` + `reserveSell` 미호출, 대상만 집계 + 텔레그램 메시지에 `🟢 dryRun` 뱃지. 첫 운영 적용 시 사용자가 안전 검증 가능.

### 6. ExitRuleTag union 확장
`ServerShadowTrade.exitRuleTag` union 에 `'FOMC_DAY_LIQUIDATION'` (priority 50) 추가. `TradeEvent.subType` 에 `'FOMC_DAY_LIQ'` 추가. **클라이언트 동기 사본 불필요** — `src/api/autoTradeClient.ts` 의 `exitRuleTag?: string` / `subType?: string` 이 free-form string 이라 자동 호환.

## 결과

### Boundary Rules 추가 (ARCHITECTURE.md 명문화)
1. **FOMC DAY 청산 단일 진입점**: `fomcDayLiquidation.liquidateAllForFomc()` 외 경로 청산 금지. 다른 모듈은 import 만 가능 — direct fork 차단.
2. **reserveSell SSOT 의무**: `liquidateAllForFomc` 는 `placeKisSellOrder` + `reserveSell` 만 사용 (절대 규칙 #2 kisClient 단일 통로 / #4 autoTradeEngine 외 LIVE 실주문 금지). `kisGet`/`kisPost` 직접 호출 금지.
3. **DAY phase 가드 자동 silent**: 청산 cron 3건 (09:00 / 14:00 / 14:30) 은 매일 평일 등록되지만 진입부 `getFomcProximity().phase === 'DAY'` 체크로 비-DAY 일 자동 silent return — FOMC 캘린더 단일 SSOT.

### 회귀 영향
- LIVE 매매 본체 0줄 변경 — `reserveSell` SSOT 재사용 (exitEngine.r6EmergencyExit 와 byte-equivalent 패턴).
- 4/29 (FOMC 4월) 부터 의도된 KIS 호출 발생 — 다른 일자는 silent return 으로 호출 0.
- 회귀 테스트 +24 (fomcCalendar.test.ts +9 / fomcDayLiquidation.test.ts 신규 +15).
- vi.mock 으로 `reserveSell` + `placeKisSellOrder` + `sendPrivateAlert` + `getFomcProximity` 격리 — 테스트 KIS 호출 0건.

### 마이그레이션 정책
- 본 PR 머지 직후 평일 09:00/14:00/14:30 KST cron 자동 발동 시작 — 비-DAY 일은 silent.
- 4/28 KST 09:00 첫 사전 경보 발송 예정 (FOMC 4/29 = DAY).
- 첫 실 운영 (4/29) 전에 `FOMC_DAY_LIQUIDATION_DRY_RUN='true'` 로 텔레그램 메시지 + 가드 통과 검증 권장.
- env 회로: `FOMC_DAY_LIQUIDATION_ENABLED='false'` 시 사전 경보만 발송, 청산 미실행.
