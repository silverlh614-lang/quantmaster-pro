# 02 · Trading Engine Rules (liveness·실행 권한·상태 정책)

**Read this file only when working on:**
- signalScanner / entryEngine / exitEngine / autoTradeEngine / trancheExecutor / buyPipeline 수정
- engineMode · executionAllowed · shadowAllowed · SELL_ONLY · R6 · SHADOW_ONLY · FOMC · VIX 게이팅
- 매매 허용 시간(장전/장후/점심) · HOLIDAY 정책
- KIS 주문 경로 · idempotency · 포지션 사이징(Kelly)
- Trading Engine liveness(불변식 #1) · 실거래/Shadow 차단 분리(불변식 #8)

**Do not read this file for:**
- SourceSnapshot 을 어떻게 채우는가 → `03-source-snapshot-ssot.md`
- Gate 통과 판정 로직 · scan_blockers → `04-gate-system.md`
- provider 장애 처리 · 회로차단기 · fallback → `05-provider-policy.md`
- Shadow paper-fill lifecycle · 학습 라벨 → `07-learning-engine.md`

---

## Trading Engine Liveness (불변식 #1)

**Trading Engine 은 항상 살아 있어야 한다.** 보조 데이터 결손/오류가 매매 엔진을 멈추면 안 된다.

- **Auxiliary signal 단독 hard-block 금지** (ADR-0448) — 섹터에너지·수급·외인·기관·뉴스·공시·
  sanity diagnostic·macro confidence·alias·indexCode recovery 는 score 0 / STRONG_BUY 제한 /
  운영자 warning 까지만. 단독으로 매매 차단 불가.
- **Core Execution Signals** (가격·거래량·캔들·추세·손절·리스크·시장개장·SELL_ONLY·emergencyStop·
  회로차단기·R6_DEFENSE·VIX·FOMC) 만 hard-block 가능.
- **빈 스캔(empty scan) 은 SELL_ONLY 강제 금지** (ADR-0451) — 후보 0개는 scan interval 확대 /
  OBSERVE_ONLY / RETRY_LATER / Shadow learning 으로 처리. REGULAR session 에서 emptyScanStreak
  만으로 SELL_ONLY 전환 절대 금지.
- **Pre-Breakout WAIT 은 실패가 아니다** (ADR-0449) — 진입가 미도달은 7-state (RETRY_ELIGIBLE /
  PRICE_TOO_FAR / VOLUME_WEAK / GATE_RECHECK_FAILED / COOLDOWN / SHADOW_ONLY / REJECTED) 로 관리.
  `entryFailCount` 와 분리된 `waitCount` 카운터 사용 (ADR-0115 보호).

---

## 단일 통로 규칙 (절대)

- **kisClient 단일 통로** — KIS API 호출은 `server/clients/kisClient.ts` 경유만. raw KIS REST 금지.
  주문 함수 5종: `placeKisMarketOrder` / `placeKisSellOrder` / `placeKisStopLossOrder` /
  `placeKisTakeProfitOrder` / `cancelKisOrder`.
- **autoTradeEngine 단일 통로** — `AUTO_TRADE_ENABLED=true` 상태에서 실주문은 서버 측
  `autoTradeEngine` 만 집행. 클라이언트 실주문 금지. 모든 진입 경로(scan / preMarket / tranche /
  fillCancel)는 `if (enabled)` 가드 안에서만 실행 (PR-52 audit).
- **idempotency** — `kisPost` 기본 `unsafe` (주문 POST). 5xx 후 재시도가 중복 주문 만들 수 있어
  재시도 차단 + 긴급 경보 (ADR-0014). 401/429/네트워크 에러만 재시도 (매칭엔진 미진입 확정).

---

## 상태 ≠ 데이터 (불변식 #4·#5)

R6·SELL_ONLY·HOLIDAY·장전/장후·providerIssue 는 **SourceSnapshot(데이터)을 바꾸지 않고**
Policy·Confidence·ExecutionPermission·LearningLabel 만 바꾼다.

> **휴장일 SSOT (ADR-0559):** marketSession / liveOrderAllowed 의 휴장일 판정은 **krxHolidays.ts
> (`KRX_HOLIDAYS` set, +ADR-0548 KIS chk-holiday L1 sync) 데이터 SSOT 경유**가 단일 출처다.
> `krxTradingCalendar.ts`(preflight `isKrxTradingDay` 등 거래일 walk 헬퍼)는 자체 휴일셋을 갖지 않고
> krxHolidays 에 위임한다 — 두 원장 divergence 구조적 소멸, LIVE 게이트가 단일 데이터를 본다.

### 매매 허용 시간 (volumeClock ALWAYS-ON)

- volumeClock SSOT (`server/trading/volumeClock.ts`) 가 매수 허용 시간을 결정한다. 현행 기본은
  **ALWAYS-ON** — 09:00~15:20 전 시간대 `allowEntry=true`(시초가·점심 포함). 시간대는 **차단이 아니라
  점수 가/감점(scoreBonus)** 으로만 반영한다 (SELL_ONLY 전환 아님).
- 시간대별 가/감점 (KST): 09:00~09:29 −3 · 09:30~09:59 −2 · 10:00~10:59 +2 · 11:00~11:59 −1 ·
  12:00~12:59 −2(점심) · 13:00~13:14 −2 · 13:15~13:29 −1 · 13:30~14:29 0 · 14:30~15:20 −2.
- **유일한 하드 차단 = 15:21~15:30 마감 동시호가(단일가)** — 시장 메커니즘상 일반 발주 불가.
  그 외(09:00~15:20)는 시초가·점심 포함 차단 없음. 09:00 이전 / 15:30 이후는 연속매매 세션 부재(미개장).
- ENV `VOLUME_CLOCK_LEGACY_HARD_BLOCK=true` 1줄로 구(ADR-0192) 하드 차단(09:00~09:29 / 12:00~12:59 /
  15:21~15:30) legacy 동작 복원. 기본값은 always-on(감점 전용).

### R6_DEFENSE / FOMC / VIX 게이팅

- R6_DEFENSE: 신규 진입 차단 (allowedSignals=[]). Kelly ×0.00 표기 회피 — "신규 진입 차단" 명시.
- FOMC DAY (ADR-0061): 보유 포지션 14:30 KST 강제 전량 청산 + D-3~D-1 Kelly ×0.75 보수 + DAY 신규 진입 차단.
  POST_1 ×1.30 부스트. ENV `FOMC_DAY_LIQUIDATION_DRY_RUN=true` 검증 후 production.
- 게이팅 알림은 1일 최대 2회 (09:00 OPEN + 15:30 CLOSE 윈도우, ADR-0104) — 매분 도배 차단.
- FOMC vs Regime Kelly 결합 (ADR-0076): FOMC 활성 시 FOMC 우선 (곱셈 누적 차단), R6 시 0 강제.

---

## 실거래 차단 ≠ Shadow 차단 (불변식 #8)

- SELL_ONLY / R6 / 비상정지 / VIX / FOMC 가 실거래를 막아도 **Shadow Learning 표본 수집은 계속** (ADR-0173/0183).
- 차단된 날 Shadow learning 은 `runShadowLearningOnlyScan({ allowRealOrder: false })` 로 별도 lane.
  `allowRealOrder: false` literal type + runtime throw 2중 강제.
- Shadow 매수는 실제 주문 API 호출 0건 — paper fill 처리 (`shadowExecutionPipeline.ts`, Patch-001/002).
  Shadow lifecycle 6-state(SHADOW_PAPER_FILLED→…→POSITION_CLOSED) 상세는 학습 엔진 SSOT →
  `docs/ai/07-learning-engine.md`.

---

## 사이징 (Position Sizing)

- 6 티어 (MICRO/SMALL/GROWTH/BALANCED/DEFENSIVE/CAPITAL_PRESERVATION) × 7축 통합 결정 SSOT
  (`server/trading/sizing/positionSizingEngine.ts`, ADR-0161~0167).
- 레짐 노출 예산 (ADR-0166): R1~R6 별 총 계좌 노출 목표/상한. 종목 사이징은 총 예산 안에서만.
- Kelly clamp SSOT (`kellyClamp.ts`, ADR-0168): KELLY_FLOOR=0.15 / KELLY_CAP=1.5.
- 최종 매수금액 = 개별 사이징 ∩ 계좌 한도 ∩ 손절 한도 ∩ 총 노출 예산 4 교집합.
- ENV gate default OFF — 운영자 명시 활성화 + SHADOW 1주 검증 후 LIVE (`POSITION_SIZING_ENGINE_LIVE_ENABLED`).

SourceSnapshot SSOT → `docs/ai/03-source-snapshot-ssot.md` · Provider 정책 → `docs/ai/05-provider-policy.md`
