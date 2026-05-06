# ADR-0341: krxOpenApi.recentBusinessDaysKst 한국 공휴일 정합 wiring

**Status**: Accepted
**Date**: 2026-05-06

## 배경

`server/clients/krxOpenApi.ts:161` 의 `recentBusinessDaysKst` 가 weekday 검사 (`getUTCDay() !== 0/6`) 만 수행 → 한국 공휴일 (5/1 근로자의 날 / 5/5 어린이날 / 9/24~26 추석 / 12/25 등) 클러스터에서 KRX OpenAPI 빈 응답 반복.

`server/calendar/krxTradingCalendar.ts` 에 이미 `isKrxTradingDay(dateKey)` (weekday + KRX_HOLIDAYS_BY_YEAR 정합) SSOT 존재. **5분 작업 wiring** 으로 즉시 차단.

## 결정

### 적용

1. `recentBusinessDaysKst` 분기 — `useLegacy ? weekday-only : isKrxTradingDay(dateKey)` 분리
2. `dateKey` 형식 변환 — `YYYYMMDD` ↔ `YYYY-MM-DD` (krxTradingCalendar 입력 정합)
3. ENV `KRX_TRADING_CALENDAR_LEGACY=true` (default OFF) → weekday-only 복원
4. safety 가드 — 60회 무한 루프 차단 (긴 명절 + 누적 휴장도 회복 가능)

### ENV 우회

`KRX_TRADING_CALENDAR_LEGACY=true` 1줄 즉시 ADR-0341 이전 동작 복원.

## 안전 invariant

- LIVE 매매 본체 — 분기 1곳 정정 (`recentBusinessDaysKst` 함수 본체).
- KIS/KRX 자동매매 quota 0 침범 (절대 규칙 #2/#3/#4).
- 캐시 키 (`yyyymmdd`) 형식 무변경 → 기존 캐시 무효화 0건.
- 휴장일에서 KRX OpenAPI 호출 빈도 ↓ → 회로차단기 부담 ↓ (긍정 효과).
- isKrxTradingDay 는 `KRX_HOLIDAYS_BY_YEAR` 정적 데이터 read-only — 외부 호출 0.

## 잘못된 해결 방법 영구 차단

1. **휴장일 직접 hardcoded inline** — krxTradingCalendar SSOT 우회 (drift 위험).
2. **ENV default ON for legacy** — KRX 휴장일 정합은 default 정책.
3. **safety 가드 제거** — 무한 루프 위험.
4. **toKstDateKey 우회 inline 변환** — 형식 일관성 위반.
5. **isKrxTradingDay 본체 변경** — 다른 호출자 (krxClient / preMarketGapProbe / safePctChange) 영향.

## 회귀 테스트

`krxOpenApiAdr0341.test.ts` — ENV 정확 비교 3 + recentBusinessDaysKst 7 (어린이날 / 추석 / 주말+공휴일 동시 / legacy 모드 / count=1 / count=0 → 1 / count=10 / safety 가드).
