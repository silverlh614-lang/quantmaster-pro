# ADR-0548 — KIS 국내휴장일조회(chk-holiday / CTCA0903R) opnd_yn 을 L1 권위 휴장 출처로 도입

- 상태: Draft (설계 단계 — 프로덕션 코드 0줄, INDEX.md 미갱신; 머지 시점 갱신)
- 날짜: 2026-05-31
- 도메인: provider(KIS) / calendar / market-clock (3도메인 한계 내)
- 선행: ADR-0547(기술지표 OHLCV KIS L1 승격 — 휴장 인지 TTL), ADR-0045(KRX 휴장일 연 1회 감사),
  ADR-0044(연휴 복귀 보수 모드), ADR-0043(영업일 7분기 분류기), ADR-0016(MarketDataMode SSOT)
- ENV: `KIS_HOLIDAY_CALENDAR_ENABLED` (default OFF)

---

## 1. Context

### 1.1 문제

휴장일 판정이 **하드코딩 테이블 2벌**에 의존하며, 둘이 서로 다르다(surface-map §1 표).

1. `server/trading/krxHolidays.ts:18-53` — `STATIC_HOLIDAYS`(2026·2027). ADR-0045 의 patch
   repo·감사 cron 을 갖춘 성숙한 SSOT. `krxHolidayRepo.ts:21` 에 `addedBy:'sync'`("외부 API
   자동, 향후") 슬롯이 **이미 본 ADR 을 위해 예약**됨.
2. `server/calendar/krxTradingCalendar.ts:10-23` — `KRX_HOLIDAYS_BY_YEAR`(2026만). @responsibility
   주석(`:5-7`)에 "replace with a KRX/public-data fetcher later" 명시. patch/감사 없음.

추가로 `marketClock.ts:72-76` `classifyMarketDataMode` 가 **평일 휴장을 `AFTER_MARKET` 로
오분류**한다(`:75`). `MarketDataMode` union 에는 `HOLIDAY_CACHE` 가 이미 존재(`aiUniverseTypes.ts:65-66`)
하나 반환되지 않는다.

### 1.2 권위 출처

KIS 공식 `chk-holiday`(TR `CTCA0903R`)의 `opnd_yn`(개장일여부)이 **L1 권위**다. 공식 docstring:
"주문을 넣을 수 있는지 확인하고자 하실 경우 개장일여부(opnd_yn)을 사용". 응답 output 배열의
날짜별 `bass_dt`/`bzdy_yn`/`tr_day_yn`/`opnd_yn`/`sttl_day_yn` 중 **opnd_yn=N 이 휴장 권위 판정**.

### 1.3 운영 제약 (★)

KIS docstring 명시: "당사 원장서비스와 연관 — 단시간 다수 호출 시 서비스 영향. **가급적 1일
1회 호출**." → 임의 동기 호출 금지. 반드시 **연 단위 + 디스크 영속 캐시**로 감싸 cron 1회로 제한.

### 1.4 불변식

- #4 휴장은 SourceSnapshot 불변 — Policy/Mode 만 변경.
- #6 provider 장애 ≠ market signal — KIS chk-holiday 실패를 약세 신호로 전환 금지, 하드코딩 fallback.
- 단일 통로 — `realDataKisGet`(`http.ts:524`) 경유, raw KIS REST 금지.

---

## 2. Decision

### 2.1 하이브리드 3층 fallback (완전 대체 ❌)

```
isKrxHoliday(dateYmd) 권위 순서:
  L1  KIS chk-holiday opnd_yn=N  →  krxHolidayRepo patch (addedBy:'sync')   [ENABLED 시]
  L3  STATIC_HOLIDAYS 하드코딩   →  krxHolidays.ts:18-53 (안전망, 항상 존재)
  최후 주말만 (dow 0/6)          →  KIS·하드코딩 둘 다 없을 때
```

- **KIS 는 patch 로 하드코딩 Set 에 병합**(대체 아님). `reloadKrxHolidaySet()`(`krxHolidays.ts:71-80`)
  가 `STATIC_HOLIDAYS ∪ patch` 를 활성 Set 으로 만든다 — KIS 가 죽어도 STATIC 안전망 유지(#6).
- KIS 권위 destination = `appendKrxHolidayPatch([{date, reason, addedBy:'sync', addedAt}])`
  (`krxHolidayRepo.ts:79-102`, idempotent·atomic). **신규 repo/캐시 파일 생성 0**.

### 2.2 동기 시그니처 보존 + 비동기 워밍업 분리

`krxHolidays.ts`·`krxTradingCalendar.ts` 의 **동기 순수 함수 시그니처를 절대 변경하지 않는다**
(`krxHolidays.ts` 8개 + `krxTradingCalendar.ts` 18개 호출자 보호). KIS fetch(비동기)는
**스케줄러 워밍업 잡**으로 분리해 patch 디스크에 채운 뒤, 동기 조회는 reload 된 메모리 Set 을 읽는다.

```
[부팅]   maintenanceJobs reloadKrxHolidaySet()  (patch hydrate, 기존)  krxHolidays.ts:71
[cron]   syncKisHolidayCalendar()  →  fetchKisHolidayCalendar(연도)  →  appendKrxHolidayPatch(addedBy:'sync')  →  reloadKrxHolidaySet()
[조회]   isKrxHoliday(ymd)  (동기, 메모리 Set — 무변경)
```

### 2.3 1일 1회 가드 = cron 1회 + idempotent + 이미-등록 skip

- KIS 호출은 **`maintenanceJobs.ts` cron** 에서만(임의 호출 경로 0).
- cron 주기: 연 1회(매년 1월 초, 당해+차년도 BASS_DT 일괄) + 월 1회 재확인(대체공휴일 갱신 대비).
- `syncKisHolidayCalendar()` 진입 시 "해당 연도 patch 이미 sync 됨 + 충분(≥8)" 이면 **KIS 호출
  전 early return**(`countHolidaysInYear` 류, `krxHolidayAudit.ts:46`). → 실호출은 연 1~2회 수준.
- 결과적으로 chk-holiday 호출 빈도 ≪ 1일 1회 (docstring 제약 강제).

### 2.4 marketClock HOLIDAY_CACHE 배선

`classifyMarketDataMode`(`marketClock.ts:72-76`)에 `LIVE_TRADING_DAY` 분기 직후 가드 1개:

```
if (isMarketOpen) return 'LIVE_TRADING_DAY';
if (isKstWeekend) return 'WEEKEND_CACHE';
if (평일 + isKrxHoliday(오늘 KST ymd)) return 'HOLIDAY_CACHE';   // ← 신규 1줄
return 'AFTER_MARKET';
```

- 휴장 판정은 `krxHolidays.isKrxHoliday`(동기, §2.2) 호출. **ENV 와 직교** — 하드코딩 Set 기반으로도
  동작하므로 `KIS_HOLIDAY_CALENDAR_ENABLED` OFF 라도 평일 휴장 인지가 정밀화됨(STATIC 기준).
- 상호참조: ADR-0547 `isMarketClosedNow()`(`technicalQuoteRouter.ts:51-59`)가 이미
  `classifyMarketDataMode() !== 'LIVE_TRADING_DAY'` 라 **무수정으로** 휴장일 일봉 TTL 연장이 정밀화.

### 2.5 ENV 스위치 (default OFF, byte-equivalent)

`KIS_HOLIDAY_CALENDAR_ENABLED=false`. 미설정/false 시 KIS sync 잡 no-op early return →
하드코딩(STATIC) 동작 byte-equivalent. `.env.example:349-356` 스탠자 포맷 복제.

> ★주의: §2.4 의 HOLIDAY_CACHE 배선은 ENV 와 직교(STATIC 기반 동작). 만약 quality-guard 가
> "ENV OFF 에서 marketClock 동작도 완전 byte-equivalent" 를 요구하면, HOLIDAY_CACHE 분기 자체를
> ENV gate 뒤로 넣는 옵션(2.4-b)을 둔다 — 이건 구현 phase 에서 engine-dev 와 확정.

### 2.6 krxTradingCalendar.ts 는 Phase 2

orphan 테이블 수렴(`krxTradingCalendar.ts` → `krxHolidays` SSOT 위임)은 18개 호출자 회귀
위험 + 4번째 변경면이라 **본 ADR 범위 제외**. Phase 2 별도 ADR.

---

## 3. Consequences

### 긍정
- 휴장 판정이 KIS L1 권위로 격상, 대체공휴일·임시공휴일 자동 반영(연 1회 cron).
- `marketClock` 평일 휴장 오분류 제거 → ADR-0547 일봉 TTL·다운스트림 분기 정밀화(무수정).
- 기존 patch repo·감사 cron·reload 재사용 → 신규 인프라 최소(repo 0, 타입 0).
- KIS 죽어도 STATIC fallback → 무중단(#6).

### 부정/리스크
- KIS sync 와 STATIC 불일치 시 patch 가 STATIC 을 **추가**만 함(제거 불가) — STATIC 의 오등록
  날짜는 patch 로 못 지움. (휴장은 보수적 과등록이 안전하므로 수용 — 휴장 오판 시 매매 미집행 ≪ 오집행.)
- chk-holiday 연속조회(tr_cont M/F) 페이지네이션 미처리 시 일부 연도 누락 — fetcher 가 재귀 처리 필수.
- ENV OFF 에서 §2.4 배선이 STATIC 기반으로 동작 변경(평일 휴장 → HOLIDAY_CACHE) → 엄밀히는
  byte-equivalent 아님(§2.5 주의). 회귀 테스트로 영향면(downstream HOLIDAY_CACHE 소비자) 확인 필수.

### 회귀 테스트
- `fetchKisHolidayCalendar` opnd_yn 파싱 + 빈 응답 + 페이지네이션 + KIS 미설정 null.
- `syncKisHolidayCalendar` ENV OFF no-op / ENV ON idempotent / 이미-등록 skip / KIS 실패 시 STATIC 유지.
- `classifyMarketDataMode` 평일 휴장 → HOLIDAY_CACHE / 주말 → WEEKEND_CACHE / 평일 영업 → LIVE.
- ADR-0547 `isMarketClosedNow` 평일 휴장 시 closed TTL 적용(상호참조 회귀).

---

## 4. Alternatives Considered

1. **krxTradingCalendar.ts 하드코딩 완전 대체(KIS only)** — 기각. KIS 실패 시 안전망 소멸(#6 위반),
   18개 동기 호출자 비동기화 강제.
2. **KIS only, STATIC fallback 없음** — 기각. 부팅 직후/네트워크 단절 시 휴장 인지 공백.
3. **신규 holidayCacheRepo + 연 단위 JSON 캐시 신설** — 기각. `krxHolidayRepo`(patch, sync 슬롯
   예약)가 이미 존재 — 중복 인프라. aiCacheRepo(4h TTL)는 영구 휴일 등록에 의미 부적합.
4. **동기 함수 내부에서 KIS 직접 fetch** — 기각. 1일 1회 제약 위반, 동기 시그니처 파괴, 단일 통로 우회.
5. **krxTradingCalendar 수렴까지 한 ADR 에 포함** — 기각. 4도메인·18 호출자 회귀 → Patch Scope Guard
   3도메인 한계 초과. Phase 2 분리.

---

## 5. References

- KIS 공식: `chk_holiday.py` (`/uapi/domestic-stock/v1/quotations/chk-holiday`, CTCA0903R, opnd_yn)
- `server/trading/krxHolidays.ts:18-80` (STATIC + reload SSOT)
- `server/persistence/krxHolidayRepo.ts:21,79-102` (sync 슬롯 + idempotent append)
- `server/scheduler/maintenanceJobs.ts:45-49,182-183` (부팅 reload + audit cron 카탈로그)
- `server/utils/marketClock.ts:66-76` (HOLIDAY_CACHE 미배선)
- `server/services/aiUniverseTypes.ts:58-68` (MarketDataMode 기존 union)
- `server/clients/kisClient/http.ts:524` · `query.ts:663-717` (realDataKisGet 단일 통로 패턴)
- `server/screener/adapters/technicalQuoteRouter.ts:51-63` (ADR-0547 상호참조)
- `server/calendar/krxTradingCalendar.ts:5-23` (orphan — Phase 2)
- `docs/adr/INDEX.md:17` (다음 발급 0548 확인)
