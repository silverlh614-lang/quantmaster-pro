# ADR-0591: market truth layer trading date ssot

@responsibility trading — market truth layer trading date ssot

## Status

Accepted

## Context

`BUG-2026-05-07-001` (P0, OPEN) — "휴장일 기준일 혼합". 각 모듈이 자체 `new Date()`/`Date.now()` 로
기준일을 계산하면 휴장일·장중·장마감 경계에서 모듈별 기준일이 어긋나 가짜 Confluence·가짜 STRONG_BUY·
학습 데이터 오염 위험이 있다. Market Truth Layer 가 문서/ADR 수준을 넘어 런타임 단일 의존성으로
격상되지 않았던 것이 근본 원인. 프로덕션에 직접 날짜 호출이 ~1,600곳 산재(전면 마이그레이션은 별도
다단계 작업) — 본 ADR 은 **SSOT 기반 구축 + 신호생성 경로 우선 주입 + 신규 위반 차단**으로 점진 착수한다.

## Decision

1. **날짜 SSOT 신규** — `server/calendar/tradingContext.ts` `resolveTradingContext(now)` 가 KRX 거래일 달력
   (krxTradingCalendar SSOT) 위에서 단일 기준일 컨텍스트(`effectiveTradingDate`/`previousTradingDate`/
   `nextTradingDate`/`calendarDate`/`isTradingDay`/`dateMode`)를 제공. **날짜만 소유** — 실행 권한
   (allowSignalGeneration 등)은 기존 ExecutionPermission/SourceSnapshot SSOT 소관(경쟁 SSOT 금지).
2. **신호생성 경로 우선 주입** — shadow 학습 lane 3건(counterfactualShadowLane ×2, provisionalShadowLane ×1)의
   scanId 가 쓰던 `new Date().toISOString().slice(0,10)`(=UTC 캘린더 날짜)을 `effectiveTradingDate`(KST 거래일)로
   교체. 장전(08:40 KST=전날 23:40 UTC) 스캔에서 scanId 에 전날 날짜가 박히던 결함 + 동일 스캔 내 두 scanId
   불일치(UTC midnight cross)를 동시 해소. **SHADOW 학습 한정 — executionImpact=NONE**(불변식 #8 실거래 차단과
   Shadow 차단 분리).
3. **정적 가드 신규** — `scripts/check_trading_date_ssot.js` 가 `server/trading/signalScanner/**` 의 ad-hoc 기준일
   추출(`new Date().toISOString().slice(0,10)`)을 baseline 0 으로 강제(신규 위반 차단). validate:all·precommit 통합.

## Consequences

- 신호생성 경로의 기준일 혼합 위반 0건 + 신규 차단(enforcement). `resolveTradingContext` 단위 테스트 6종
  (effectiveTradingDate 거래일 불변식·주말 WEEKEND·결정성 등). shadow lane 회귀 80/80 무회귀, lint EXIT=0.
- `BUG-2026-05-07-001` 은 OPEN 유지 — 본 ADR 은 기반+신호경로 착수분만 닫는다. 잔여(~1,600곳 직접 날짜 호출의
  기술지표/수급/섹터에너지/SourceSnapshot 전면 주입)는 후속 ADR 시리즈로 점진 마이그레이션(가드 scope 확장 동반).
- executionImpact=NONE. 9대 불변식 무영향(#3 단일 SourceSnapshot 정신에 정합 — 향후 SourceSnapshot 가 본 SSOT 의
  effectiveTradingDate 를 carry 하도록 확장 예정).

## Guardrails

- No live trading path change unless explicitly stated.
- No KIS/order import or invocation unless explicitly stated.
- No Gate/Kelly/STRONG_BUY behavior change unless explicitly stated.
- No Shadow policy change unless explicitly stated.
- No provider fetch behavior change unless explicitly stated.
- No data promotion behavior change unless explicitly stated.
