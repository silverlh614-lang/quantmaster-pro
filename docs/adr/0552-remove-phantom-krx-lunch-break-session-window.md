# ADR-0552: remove phantom KRX lunch break session window

@responsibility trading — remove phantom KRX lunch break session window

## Status

Accepted

## Context

장중(12:18 KST) 스캔이 `marketSessionState=CLOSED` / `canonicalSession=CLOSED` /
`displaySession=CLOSED_SHADOW_OBSERVE` 로 표시됐다. 10:14·11:33 스캔은 BUY_ALLOWED 였고
12:18 만 CLOSED — 정확히 12:00 경계에서 뒤집혔다. 원인은 **점심 휴장(12:00~13:00) 잔재**다.

한국거래소는 **2000-05-22 점심 동시호가를 폐지**해 점심 휴장이 없는 연속장(09:00~15:20 +
마감 단일가 15:20~15:30)인데, 코드가 12:00~13:00 을 점심 비-정규 구간으로 분류하는 SELL_ONLY/
LUNCH 시대 잔재를 보유하고 있었다. ADR-0192 가 점심 매수창을 11:30→12:00 으로 30분 단축했으나
점심 자체는 남겨두었다.

확인된 잔재 (모두 시간 기반 12:00~13:00 비-정규 분류):
- `isBuyableKstWindow` (adaptiveScanScheduler) — `(t>=930 && t<1200) || (t>=1300 && t<1530)`
  로 점심 12:00~13:00 을 진단/경보 윈도에서 제외. (진단·경보용; 실주문 게이트 아님.)
- `deriveMarketSessionFromKstMinutes` — 12:00~13:00 → `LUNCH_BREAK`(EmptyScanMarketSession).
- `sellOnlyWindowForMinutes` (gate1MarketSession) — `LUNCH_1200_1259` sellOnly window(진단).

## Decision

KRX 연속장 현실에 맞춰 점심(12:00~13:00) 비-정규/휴장 분류를 제거한다.

- `isBuyableKstWindow` (default 정책) → `t >= 930 && t < 1530` 연속 (시초가 09:00~09:30 회피·
  마감 15:30 만 제외). `TRADE_WINDOW_LEGACY_HOURS=true` legacy 분기는 보존(opt-in 구 동작).
- `deriveMarketSessionFromKstMinutes` (비-legacy) → 09:30~15:00 단일 `REGULAR`(LUNCH_BREAK 제거).
  legacy 분기는 보존.
- `sellOnlyWindowForMinutes` → `LUNCH_1200_1259` 산출 제거(OPENING·CLOSING window 만 유지).

**보존(불변):** 안전 SELL_ONLY(R6/VKOSPI/emergency/manual), volumeClock 12:00~12:59 -2 점수
페널티(의도적 midday 보수), decideScan 의 점심 저빈도 관찰(scan cadence), `krxClient/timeWindow`
의 KRX 일중통계 fetch-skip(데이터 가용성 — 별개), legacy ENV 분기.

## Consequences

- 12:00~13:00 이 정규장으로 표시·취급된다 — scan/세션 CLOSED 오표시 제거. **LIVE 매수 시간대
  변경**(점심 매수 차단 해제)으로 byte-equivalent 아님(의도된 정정). 현재 SHADOW_ONLY 정책
  하에서는 즉시 실주문 변화 없음(정책 분리). 안전 SELL_ONLY/장외 차단은 그대로다.
- ADR-0192 의 점심 매수창 정책을 부분 supersede(점심 제외 → 연속)한다. ADR-0122 legacy 윈도는
  ENV opt-in 으로 보존.
- 진단 라벨(LUNCH_BREAK/LUNCH_1200_1259)이 시간 기반으로는 더 이상 산출되지 않는다. 외부 입력
  파싱(normalizeSellOnlyWindow 등)의 LUNCH 값 인식은 후방호환 위해 유지.
- 사전존재(baseline) r3NoiseGovernor(ADR-0448) LUNCH_BREAK cause 테스트 4건은 본 패치와 무관
  (stash 대조 확인) — 별도 드리프트로 추적.

## Guardrails

- No live trading path change unless explicitly stated.
- No KIS/order import or invocation unless explicitly stated.
- No Gate/Kelly/STRONG_BUY behavior change unless explicitly stated.
- No Shadow policy change unless explicitly stated.
- No provider fetch behavior change unless explicitly stated.
- No data promotion behavior change unless explicitly stated.
