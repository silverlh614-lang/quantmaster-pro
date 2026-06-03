# ADR-0559: Calendar(휴장일) SSOT 통합 — krxHolidays 데이터 SSOT / krxTradingCalendar 위임 (구현 선행 계약)

@responsibility governance — KRX 휴장일 데이터 SSOT 를 krxHolidays 로 단일화하고 krxTradingCalendar 를 위임 헬퍼로 강등하는 경계·안전·인수인계 계약 확정 (문서/타입 핀 전용, 런타임 구현은 후속 engine-dev)

## Status

Accepted (문서/ARCHITECTURE.md/타입 핀 전용 — 위임 교체 런타임 `.ts` 본체 0줄. 구현은 후속 engine-dev 단계.)

## Context

QuantMaster Pro 에는 **휴장일을 판정하는 독립 원장이 2개** 존재하며, 서로 import 하지 않는다(상호 독립).
직전 커밋 `3643835` 의 golden master `server/calendar/calendarSsot.characterization.test.ts` 가
2024-01-01~2027-12-31 전수 비교로 **실효(effective) 거래일 불일치 9건**을 잠갔다.

| 원장 | 파일 | 공개 휴일 API | 데이터 커버리지 | 부가 자산 |
|---|---|---|---|---|
| **A (위임 헬퍼 후보)** | `server/calendar/krxTradingCalendar.ts` | `isKrxHoliday`(:42) + `isKrxTradingDay`(:47) | `KRX_HOLIDAYS_BY_YEAR` **2026 키만 하드코딩, 2027 키 0** | walk 헬퍼: `previousKrxTradingDay`/`isAcceptableKrxDailyBase`/`isAcceptableKrxBusinessDayBase`/`recommendedDailyStaleWindowDays`, `toKstDateKey` |
| **B (데이터 SSOT 후보)** | `server/trading/krxHolidays.ts` | `isKrxHoliday`(:90) + `isKrxBusinessDay`(:110) | `KRX_HOLIDAYS` set = `STATIC_HOLIDAYS`(**2026+2027**) ∪ patch | 대체공휴일 명시 로직 + `krxHolidayRepo` patch 영속 + **ADR-0548 KIS chk-holiday(CTCA0903R) opnd_yn L1 sync** (`syncKisHolidayCalendar`) |

### 결정적 위험: LIVE 게이트가 불완전 원장(A)에 의존

LIVE 진입 게이트의 휴장일 판정은 **A(krxTradingCalendar) 경유**다:
`signalScanner/preflight.ts:43,513` 가 `isKrxTradingDay(todayKstDate)` 를 호출 →
`r3StreakSkipPolicy.evaluateR3CountableScan` + `entryPolicySemantics.resolveMarketSessionState`
(`preflight.ts:514/529`) → marketSession 분류 → `liveOrderAllowed`/MARKET_SESSION_BLOCK.
같은 `isKrxTradingDay` 를 buyPipeline·fillMonitor·programFlowSessionGuard 등 18개 소스 소비처가 사용한다.

A 가 2026 키만 하드코딩하므로 **2027 평일 공휴일 8건이 모두 거래일(`isKrxTradingDay=true`)로 오판**되고,
거기에 **2026-12-31 연말 폐장의 반대 방향 비대칭** 1건을 더해 총 9건의 실효 불일치가 생긴다(golden master).
A 에 묶인 LIVE 게이트는 2027 진입 시 **실제 휴장일에 주문 창이 열리는 구멍**을 갖는다.
한편 B(krxHolidays) 는 2027 16키를 보유하나 LIVE 게이트에 미연결이다.

> 본 결함의 1차 정합(`Patch-KrxHolidays-2026MissingDays`, 2026-06-03)은 2026 누락 5건만 양 원장에 보강했고,
> "2027 전체 미수록 + 2026-12-31 비대칭"은 후속 정합으로 명시 이월됐다(10-patch-history Hot Index 메모).
> 본 ADR 이 그 구조적 통합이다.

## Decision

휴장일 데이터를 **단일 SSOT 로 통합**하고, 두 원장 사이의 divergence 를 **구조적으로 소멸**시킨다.
런타임 교체는 후속 engine-dev 가 수행하며, 본 ADR 은 그 계약(경계·안전·인수인계)만 확정한다.

### D1. 휴장일 데이터 SSOT = `krxHolidays.ts` (`KRX_HOLIDAYS` set)

근거 = (1) 2027 커버리지 (2) 대체공휴일 명시 로직 (3) ADR-0548 KIS chk-holiday L1 동기화 인프라
(4) `krxHolidayRepo` patch 영속. `krxTradingCalendar` 의 자체 하드코딩 휴일셋(`KRX_HOLIDAYS_BY_YEAR`)을
**버리고** krxHolidays 데이터에 위임한다.

### D2. 소비처 재배선 최소화 — `krxTradingCalendar` 공개 API 시그니처 보존

`krxTradingCalendar` 의 공개 API(`isKrxHoliday`/`isKrxTradingDay`/`previousKrxTradingDay`/
`isAcceptableKrxDailyBase`/`isAcceptableKrxBusinessDayBase`/`recommendedDailyStaleWindowDays`/
`toKstDateKey`)는 **시그니처 보존**하되, 내부 휴일 판정만 `krxHolidays` 위임으로 교체한다.
→ 18개 소스 소비처(preflight/buyPipeline/fillMonitor/programFlowSessionGuard/shadowResolverJob/
yahooQuoteAdapter/sectorEnergyProvider/krxOpenApi/safePctChange/provisionalShadowPriceProvider/
counterfactualShadowPriceProviderAdapter/regimeLearningBank/healthLoop/preMarketGapProbe/
learningSampleQuality/shadowFutureReturnCacheProvider/supplyHealth.cmd 등) **코드 무변경**.
두 `isKrxHoliday` 가 동일 데이터를 보게 되어 divergence 가 **구조적으로 소멸**한다.

소비처가 휴일 set 을 직접 import 하지 않음(전수 확인 — 모두 위 walk/판정 함수만 import)이 무변경 보장의 근거다.

### D3. 2026-12-31 + 연말 폐장 규칙

`krxHolidays.STATIC_HOLIDAYS` 에 `'2026-12-31'` 을 추가한다. 가능하면 KRX 연말 폐장 일반 규칙
(매년 12-31, 주말이면 직전 영업일)을 인코딩해 차년도 자동 충전. **단순 1줄(`'2026-12-31'`) 추가도 허용** —
과잉설계 금지(연말 폐장 일반 규칙 인코딩은 권장이지 의무 아님). 어느 쪽이든 통합 후 12/31 은
양 경로에서 휴장일로 일치해야 한다(golden master 기대값).

### D4. 유일하게 허용되는 행동 변경 = 안전 방향만

통합 후 LIVE 게이트(`krxTradingCalendar` 경유)가 **2027 평일 공휴일 8건 + 2026-12-31** 을 휴장일로
인식하게 된다 = **실제 휴장일에 주문 차단**(현재 구멍 폐쇄). 이는 더 보수적인(안전한) 방향이다.

- **거래일을 휴장일로 잘못 막는 변경은 0건이어야 한다.** golden master 가 이미 0건 확인:
  9건 모두 truth=HOLIDAY 이며, A 가 휴장일을 거래일로 오판(8건 UNSAFE→차단으로 정정) 또는
  A/B 비대칭(12/31)을 닫는 방향이다. truth=TRADING 인 날을 휴장일로 재분류하는 케이스는 없다.
- 그 외 모든 날짜는 **byte-equivalent** — golden master "C. AGREEMENT" 표본(평일 거래일·주말·
  2026 평일 휴장일)은 통합 후에도 출력 무변경.

### D5. walk 헬퍼 위임

`previousKrxTradingDay`/`isAcceptableKrxDailyBase`/`isAcceptableKrxBusinessDayBase`/
`recommendedDailyStaleWindowDays` 등 walk·staleness 헬퍼는 `krxHolidays.isKrxBusinessDay`
(또는 `isKrxHoliday`) 위에 재구성하되 **출력 동일성을 유지**한다(`toKstDateKey`·`addDays`·grace 로직
보존). 입력이 동일 휴일 데이터를 보게 되므로 2026 구간은 byte-equivalent, 2027 구간은 안전 방향 정정.

### D6. 책임 경계 명문화

- `server/trading/krxHolidays.ts` = **휴장일 데이터 SSOT** (`KRX_HOLIDAYS` set, STATIC ∪ patch,
  대체공휴일 로직, ADR-0548 KIS sync). 휴일 *데이터* 의 단일 출처.
- `server/calendar/krxTradingCalendar.ts` = **거래일 walk / staleness 헬퍼 레이어** — 휴일 데이터는
  krxHolidays 에 위임. 두 곳이 중복 export 하던 `isKrxHoliday` 는 — `krxTradingCalendar.isKrxHoliday`
  를 `krxHolidays.isKrxHoliday` 의 re-export/위임으로 만들어 단일 데이터 소스로 수렴.

## 안전성 표 — golden master 9 불일치의 통합 후 결과 (전부 안전 방향)

| # | date | truth | 통합 전 cal(LIVE 게이트) | 통합 전 hol | 통합 후 (양 경로) | LIVE 게이트 영향 | 방향 |
|---|------|-------|--------------------------|-------------|-------------------|------------------|------|
| 1 | 2026-12-31 | HOLIDAY | 휴장(이미 차단) | **거래일(UNSAFE)** | 휴장 | cal 무변경·hol 정정 | SAFE(구멍 폐쇄) |
| 2 | 2027-01-01 (신정) | HOLIDAY | **거래일(UNSAFE)** | 휴장 | 휴장 | **차단으로 정정** | SAFE |
| 3 | 2027-02-08 (설날 연휴) | HOLIDAY | **거래일(UNSAFE)** | 휴장 | 휴장 | **차단으로 정정** | SAFE |
| 4 | 2027-03-01 (삼일절) | HOLIDAY | **거래일(UNSAFE)** | 휴장 | 휴장 | **차단으로 정정** | SAFE |
| 5 | 2027-05-05 (어린이날) | HOLIDAY | **거래일(UNSAFE)** | 휴장 | 휴장 | **차단으로 정정** | SAFE |
| 6 | 2027-05-12 (부처님 오신 날) | HOLIDAY | **거래일(UNSAFE)** | 휴장 | 휴장 | **차단으로 정정** | SAFE |
| 7 | 2027-09-14 (추석 연휴) | HOLIDAY | **거래일(UNSAFE)** | 휴장 | 휴장 | **차단으로 정정** | SAFE |
| 8 | 2027-09-15 (추석) | HOLIDAY | **거래일(UNSAFE)** | 휴장 | 휴장 | **차단으로 정정** | SAFE |
| 9 | 2027-09-16 (추석 연휴) | HOLIDAY | **거래일(UNSAFE)** | 휴장 | 휴장 | **차단으로 정정** | SAFE |

- **truth=TRADING → 휴장일 오재분류 = 0건** (거래일을 잘못 막는 변경 없음, D4 충족).
- AGREEMENT 표본(평일 거래일·주말·2026 평일 휴장일) = **0 regression**.
- 9건 전부 "휴장일에 LIVE 주문이 열리던 구멍을 닫는" 안전 방향 — golden master 합격기준 2·5 충족.

## Consequences

- **LIVE 게이트 2027 휴장일 구멍 폐쇄** — preflight→isKrxTradingDay→marketSession→liveOrderAllowed
  경로가 2027 공휴일 8건 + 2026-12-31 을 휴장일로 인식 → 실제 휴장일 주문 차단.
- **소비처 무변경** — 18개 소스 소비처는 위임 walk/판정 함수만 import, 휴일 set 미직접 import →
  시그니처 보존으로 코드 0줄 변경.
- **divergence 구조적 소멸** — 두 `isKrxHoliday` 가 동일 데이터(krxHolidays SSOT)를 봄 → 향후 연도
  추가 시 한 곳(STATIC_HOLIDAYS / KIS sync)만 갱신해도 LIVE 게이트까지 자동 반영(현재의 "2 원장 동기화
  누락" 재발 불가).
- **byte-equivalent except 안전 방향** — 9 불일치 외 모든 날짜 출력 무변경. 9건은 더 보수적(주문 차단)
  방향으로만 변경.
- **ADR-0548 인프라 일관 적용** — KIS chk-holiday L1 sync 가 단일 SSOT 에만 흐르므로 LIVE 게이트가
  KIS 권위 휴장 데이터의 수혜를 받는다.
- **불변식 보존** — Trading Engine always-on(#1)·Shadow always-on(#2) 무영향(휴장일 판정 정정은
  엔진 정지 아님). HOLIDAY 는 SourceSnapshot 을 바꾸지 않고 ExecutionPermission 만 바꾼다(#4/#5).

## executionImpact

- **본 ADR(문서 단계): NONE** — 런타임 `.ts` 본체 0줄, 문서/ARCHITECTURE.md/타입 핀만.
- **후속 구현 단계: MEDIUM** — LIVE 게이트의 휴장일 인식이 2027 8건 + 2026-12-31 로 확대(주문 차단 확대).
  단 **안전 방향**이며, 9 불일치 외 **byte-equivalent except 휴장일 추가**다. 거래일을 막는 변경 0건
  (golden master 확인). 실제 돈 손실 방향 위험 = 0(차단은 보수적, 미체결은 손실 아님).

## Rollback

데이터 위임 1줄 복원 — `krxTradingCalendar` 내부 휴일 판정을 위임에서 자체 `KRX_HOLIDAYS_BY_YEAR`
참조로 되돌리면 통합 전 동작으로 즉시 복귀(시그니처 보존이므로 소비처 영향 0). golden master 가
복원 동작을 재캡처 가능.

## Alternatives Considered

- **A. krxTradingCalendar 를 데이터 SSOT 로 채택** — 기각. 2027 키 0, 대체공휴일 로직 부재,
  ADR-0548 KIS sync 미연동. 데이터 완전성·권위 출처가 krxHolidays 에 비해 열위.
- **B. 두 원장에 2027 데이터를 각각 중복 입력(동기 유지)** — 기각. 현행 "2 원장 동기화 누락" 결함의
  원인(분산 데이터)을 그대로 둠. divergence 재발 구조 잔존.
- **C. 소비처를 전부 krxHolidays 직접 호출로 재배선** — 기각. 18개 소스 소비처 + walk 헬퍼 의미
  변경, 회귀 표면 과대. 시그니처 보존(D2) 대비 byte-equivalent 보장 약화.

## References

- golden master: `server/calendar/calendarSsot.characterization.test.ts` (커밋 `3643835`, 9 실효 불일치 캡처)
- 데이터 SSOT: `server/trading/krxHolidays.ts` (`KRX_HOLIDAYS`:69, `isKrxHoliday`:90, `isKrxBusinessDay`:110, `syncKisHolidayCalendar`:148)
- 위임 헬퍼: `server/calendar/krxTradingCalendar.ts` (`isKrxHoliday`:42, `isKrxTradingDay`:47, walk 헬퍼:55~129)
- LIVE 게이트 진입: `server/trading/signalScanner/preflight.ts:43,513` → `entryPolicySemantics.resolveMarketSessionState`, `server/trading/signalScanner/r3StreakSkipPolicy.ts`, `server/runtime/executionPermissionResolver.ts`
- ADR-0045 (krx-holiday-annual-audit), ADR-0548 (KIS chk-holiday opnd_yn L1 authority)
- 직전 정합: `Patch-KrxHolidays-2026MissingDays` (2026-06-03, 2026 누락 5건; 2027+12/31 이월 메모)
