## ADR-0189 — preMarketGapProbe KRX 거래일 달력 적용

**상태**: Accepted
**작성일**: 2026-05-05
**관련 PR**: PR-PreMarketGap-KrxCalendar
**작성자**: orchestrator

### 1. 결함

`server/trading/preMarketGapProbe.ts` 의 `businessDaysBetween()` 가 KRX 휴장일을 모름 — 주석에 *"한국 공휴일은 별도 달력 없이 주말만 반영"* 명시. `MAX_STALENESS_BUSINESS_DAYS = 2` 임계와 결합해 연휴 직후 정상 전일종가가 *잘못* SKIP_STALE 로 분류되어 장전 매수 진입이 차단되는 경로 확정.

**시나리오 A (5/4 월 장전)** — KIS prev.tradingDate = 4/30 목 (5/1 근로자의 날 휴장 + 5/2~5/3 주말). 실제 영업일 격차 = 1. `businessDaysBetween('2026-04-30', NOW=5/4)` = 5/1 (금 weekday +1) + 5/2 (토 0) + 5/3 (일 0) + 5/4 (월 +1) = **2** → 잘못된 SKIP_STALE.

**시나리오 B (5/6 수 장전)** — prev.tradingDate = 5/4 월 (5/5 어린이날 휴장). 실제 영업일 격차 = 1. `businessDaysBetween('2026-05-04', NOW=5/6)` = 5/5 (화 +1) + 5/6 (수 +1) = **2** → 잘못된 SKIP_STALE.

두 시나리오 모두 `MAX_STALENESS_BUSINESS_DAYS = 2` 에 정확히 도달해 정상 종목의 장전 매수가 차단됨. KRX 휴장일이 끼는 모든 주의 월·수·목 장전에 동일 결함 반복.

### 2. 결정

`server/calendar/krxTradingCalendar.ts` 의 `isAcceptableKrxDailyBase(asOf, now?)` SSOT (2026 KRX 휴장일 14건 영속, `previousKrxTradingDay()` + 1 거래일 grace) 를 `probePreMarketGap()` 의 stale 분기에 교체.

**동작 매트릭스**:

| ENV | stale 판정 | 운영 |
|-----|-----------|------|
| `PRE_MARKET_GAP_KRX_CALENDAR_DISABLED=true` | `businessDaysBetween() >= 2` (legacy) | 즉시 롤백 |
| 미설정 (default OFF, 정책 적용) | `!isAcceptableKrxDailyBase()` | KRX 휴장일 자동 반영 |

`MAX_STALENESS_BUSINESS_DAYS` 상수 + `businessDaysBetween()` 함수 *그대로 유지* — ENV 롤백 + 진단 메시지 영업일 격차 표기 호환. 본 PR 의 의도된 동작 변경: KRX 휴장일이 끼는 시점에 정상 전일종가 PROCEED. 연휴 직후 매수 진입 회복.

### 3. 안전 invariant 5종 (절대 규칙)

1. **LIVE 매매 본체 의도된 변경** — `probePreMarketGap()` stale 분기 1곳만, 의사결정/주문/회로차단/블랙리스트 호출 무관.
2. **KIS/KRX 자동매매 quota 0 침범** — KRX calendar 는 read-only static SSOT (외부 API 0 호출).
3. **ENV 정확 비교 의무** — `isPreMarketGapKrxCalendarDisabled()` SSOT, `=== 'true'` 만. ADR-0157 정합.
4. **legacy 분기 보존** — ENV ON 시 ADR-0189 이전 동작 byte-equivalent.
5. **`businessDaysBetween` 함수 export 보존** — 외부 호출자 없으나 회귀 테스트 + 진단 로그 보존.

### 4. 잘못된 해결 방법 영구 차단

| 방법 | 사유 |
|------|------|
| `businessDaysBetween()` 본체에 KRX 휴장일 hardcoded | KRX_HOLIDAYS SSOT (`krxTradingCalendar.ts`) 와 drift 위험 |
| `MAX_STALENESS_BUSINESS_DAYS` 임계 상향 (2 → 5) | 진짜 stale 종목 필터링 약화, 연휴 길이별 임계 조정 부담 |
| `safePctChange` 를 PriceBase + DAILY mode 로 전환 | scope 큼 (호출자 측 변경), `safePctChangeCalendarPatch` production entry 의존 — 후속 별도 PR |
| ENV default ON | KRX 휴장일 정합은 default 정책 (legacy 동작은 회귀 위험 격리용 escape hatch) |
| 호출자 측 inline ENV 검사 | SSOT drift 위험 — 본 ADR 은 SSOT 위임 패턴 정합 |

### 5. 회귀 테스트 의무

- 시나리오 A: NOW=5/4 + tradingDate=4/30 → PROCEED
- 시나리오 B: NOW=5/6 + tradingDate=5/4 → PROCEED
- 진짜 stale: NOW=5/4 + tradingDate=4/24 (1주 전) → SKIP_STALE 유지
- ENV 우회: `PRE_MARKET_GAP_KRX_CALENDAR_DISABLED=true` 활성 시 legacy `businessDaysBetween` 동작
- 기존 5 decision 분기 무회귀 (PROCEED / WARN / SKIP_DATA_ERROR / SKIP_STALE / SKIP_NO_DATA)
- ENV 정확 비교 (`'true'` 만, `'1'`/`'TRUE'`/`'yes'` 거부)

### 6. 운영자 활성화

본 ADR 정책 *default ON* — 머지 직후 즉시 효과. 회귀 발견 시:

```
PRE_MARKET_GAP_KRX_CALENDAR_DISABLED=true
```

ENV 1줄 즉시 롤백 → ADR-0189 이전 동작 (legacy `businessDaysBetween`) 복원.

### 7. 거버넌스 정합

- ADR-0146 PR 자가 review 5 카테고리 모두 PASS (LIVE 안전성 / wiring vs 인프라 / ADR 발급 무결성 / 회귀 테스트 / 정책 위반)
- ADR-0148 4 정적 검증 baseline 무회귀
- ADR-0157 `now` injection 패턴 차용 (회귀 테스트 시간 격리)
- ADR-0185/0186/0187 패턴 차용 (ENV 헬퍼 SSOT 위임)
- PENDING_WIRING.md 등재 *불필요* — 즉시 종결 결함 (호출자 0건 dead code 아님)
