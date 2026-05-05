# ADR-0190 — safePctChange.isStaleBase 의 KRX 거래일 grace 분기 도입

## Status

Accepted (2026-05-05) — 사용자 보고 5/6 KST 08:35 Railway 로그 25+ 종목 STALE_BASE_AGE 폭주 직접 차단

## Context

### 사용자 보고 시나리오

5/6 KST 08:35 Railway 로그 — `[safePctChangeDetailed] STALE_BASE_AGE @yahooQuoteAdapter.changePercent:NNNNNN.KS` 에러가 25+ KR 종목에 동시 발생:

```
base.asOf=2026-04-30T00:00:00.000Z (age=6.0일)
source=YAHOO_HISTORICAL, mode=DAILY
"Yahoo 등락률 폐기 권고"
```

### 결함 위치

`server/utils/safePctChange.ts:isStaleBase` 가 calendar 일수 비교만 수행:

```typescript
const limitDays = base.staleAfterDays
  ?? (mode ? STALENESS_LIMITS_BY_MODE[mode] : STALENESS_LIMITS_BY_MODE.SANITY_ONLY);
const limitMs = limitDays * 24 * 60 * 60 * 1000;
return ageMs > limitMs;  // calendar 일수만 비교
```

`STALENESS_LIMITS_BY_MODE.DAILY=3` 이지만 `safePctChangeCalendarPatch.ts` 가 module-load 시점 `recommendedDailyStaleWindowDays(now)` 로 동적 박제 (3~8 일).

### KRX 휴장일 클러스터 시나리오

5/6 (수) 시점 4/30 (목) base 의 calendar/거래일 비교:

| 일자 | 요일 | 분류 |
|------|------|------|
| 4/30 | 목 | KRX 거래일 (base) |
| **5/1** | **금** | **근로자의 날 (휴장)** |
| 5/2 | 토 | 주말 |
| 5/3 | 일 | 주말 |
| 5/4 | 월 | 거래일 |
| **5/5** | **화** | **어린이날 (휴장)** |
| 5/6 | 수 | 거래일 (today) |

- Calendar 갭: 6일
- KRX 거래일 갭: 2일 (5/2, 5/4 사이)
- 4/30 = `previousKrxTradingDay(5/4)` (5/1 + 5/2 + 5/3 + 5/5 모두 비거래일)
- `STALENESS_LIMITS_BY_MODE.DAILY` (5/6 boot 시 = 4일) 초과 → STALE_BASE_AGE 차단

→ KRX 거래일 grace 정책으로는 정상 base 인데 calendar 일수 비교가 STALE 로 잘못 판정.

### ADR-0189 와 유사한 결함이 다른 경로에 잔존

PR #614 (ADR-0189) 가 `preMarketGapProbe.ts:businessDaysBetween()` 의 KRX 휴장일 미반영 결함을 차단했지만, **`yahooQuoteAdapter` → `safePctChangeDetailed` (DAILY mode) 경로는 미적용**.

호출 site:
- `yahooQuoteAdapter.changePercent` (라인 194~207) — `mode='DAILY'` + `source='YAHOO_HISTORICAL'`
- 25+ 종목에 동시 발생 (Railway 로그 증거)

### 기존 인프라

`server/calendar/krxTradingCalendar.ts` SSOT:
- `KRX_HOLIDAYS_BY_YEAR[2026]` 에 5/1 + 5/5 등재됨
- `previousKrxTradingDay(now)` — KRX 휴장일 skip lookback
- `isAcceptableKrxDailyBase(asOf, now)` — 1 거래일 grace policy

이미 ADR-0189 에서 검증된 SSOT 그대로 차용 가능.

## Decision

**`safePctChange.ts:isStaleBase` 에 KRX 거래일 분기 도입** — `mode='DAILY'` + KR 일봉 출처일 때 `isAcceptableKrxDailyBase(base.asOf, now)` 우선 사용.

### 우선순위 SSOT (4 단계)

1. **`base.staleAfterDays` 명시 override** — 호출자가 출처 특성 직접 지정 (calendar 일 비교)
2. **`mode='DAILY'` + `source ∈ KRX_DAILY_PRICE_SOURCES` + ENV 미우회** — KRX 거래일 grace 정책
3. **`mode` 기반 default** — `STALENESS_LIMITS_BY_MODE[mode]` calendar 일 비교
4. **모두 미명시** — `SANITY_ONLY` (7일)

### KRX_DAILY_PRICE_SOURCES (4 출처)

```typescript
const KRX_DAILY_PRICE_SOURCES: ReadonlySet<PriceSource> = new Set([
  'YAHOO_HISTORICAL',  // 사용자 보고 직접 영향
  'KIS_DAILY',         // KIS 일봉 fallback
  'KRX_OPENAPI',       // KRX 직접 호출
  'NAVER_FINANCE',     // Naver mobile API
]);
```

`YAHOO_INTRADAY` / `KIS_REALTIME` / `RECOMMENDATION_TIME` / `CACHE` / `UNKNOWN` 은 일봉 base 가 아니므로 미적용 (calendar 일 비교 그대로).

### ENV 우회

`SAFE_PCT_CHANGE_KRX_CALENDAR_DISABLED=true` (default OFF, ADR-0157 정확 비교 의무) — 회귀 발견 시 1줄 즉시 롤백 → ADR-0190 이전 동작 byte-equivalent.

`isSafePctChangeKrxCalendarDisabled()` SSOT 헬퍼로 호출자 측 inline ENV 검사 0건 (drift 차단).

## Consequences

### 즉시 효과

- 5/6 같은 KRX 휴장일 클러스터 시점에 4/30 base 가 STALE_BASE_AGE 로 잘못 차단되던 결함 영구 차단
- 25+ 종목의 changePercent 정상 산출 → universe 격리 / dataQuality marker 부여 위양성 차단
- 5/1·5/5 어린이날·근로자의 날 / 9/24~26 추석 / 12/25 크리스마스 등 모든 KRX 휴장일 클러스터 자동 처리

### 안전 invariant 6종

1. **LIVE 매매 본체 0줄 변경** — `signalScanner.ts` / `entryEngine.ts` / `exitEngine/**` / `kisClient/**` 무수정. `safePctChange.ts:isStaleBase` 1 함수만 수정.
2. **호출자 0건 변경** — `yahooQuoteAdapter` / `yahooStaleRecovery` / 51 기존 호출자 무수정 (signature 호환).
3. **ENV gate default OFF** — ENV `=true` 명시 시에만 비활성, ADR-0190 이전 동작 byte-equivalent 복원.
4. **KIS/KRX 자동매매 quota 0 침범** — KRX 호출 0건 (정적 KRX_HOLIDAYS_BY_YEAR + 순수 함수만).
5. **호출자 측 inline ENV 검사 0건** — SSOT 헬퍼 `isSafePctChangeKrxCalendarDisabled()` 단일 위임.
6. **출처별 분기 SSOT** — KRX_DAILY_PRICE_SOURCES Set 명시. drift 차단.

### 잘못된 해결 방법 영구 차단 5종

1. **`STALENESS_LIMITS_BY_MODE.DAILY` 임계 상향** — 정상 stale (1주+) 도 통과 위험 → 본질 결함 미해결
2. **`yahooQuoteAdapter` 측 staleAfterDays override 명시** — 호출자 측 KRX 정책 인라인, drift 위험 → SSOT 위배
3. **`businessDaysBetween()` 본체에 KRX 휴장일 hardcoded** — `krxTradingCalendar` SSOT 분리 의도 위배
4. **ENV default ON** — KRX 휴장일 정합은 정책 default
5. **`isStaleBase` 시그니처 변경** — 51 호출자 회귀 위험. 옵셔널 인자 / 내부 분기만 허용.

### 회귀 테스트

신규 `safePctChangeKrxCalendar.test.ts` 23 케이스:
- ENV gate 4 (default OFF / "true" / "1"·"TRUE"·"yes" 거부 / "false"·빈)
- 5/6 사용자 보고 시나리오 6 (4 출처 × 정상 통과 + 4/29 차단 + ENV 우회)
- 분기 우선순위 7 (staleAfterDays override / mode 미적용 / source 미적용 / mode 미명시 / 잘못된 ISO / 미래 시점)
- 다양한 휴장일 시나리오 6 (5/4 시점 4/30·4/29·4/28 / 1월 일반 주말 / 2주 stale)

기존 `safePctChange.test.ts` "DAILY 3일 boundary" 1 케이스 정합 정정 — `staleAfterDays: 3` override 명시로 calendar 일 비교 강제. 기존 `yahooQuoteAdapter.test.ts` "5일 전 STALE" 1 케이스 ENV `SAFE_PCT_CHANGE_KRX_CALENDAR_DISABLED=true` 우회로 boundary 의도 보존.

## Implementation

```typescript
// server/utils/safePctChange.ts
import { isAcceptableKrxDailyBase } from '../calendar/krxTradingCalendar.js';

export function isSafePctChangeKrxCalendarDisabled(): boolean {
  return process.env.SAFE_PCT_CHANGE_KRX_CALENDAR_DISABLED === 'true';
}

const KRX_DAILY_PRICE_SOURCES: ReadonlySet<PriceSource> = new Set<PriceSource>([
  'YAHOO_HISTORICAL', 'KIS_DAILY', 'KRX_OPENAPI', 'NAVER_FINANCE',
]);

export function isStaleBase(base: PriceBase, mode, now = new Date()): boolean {
  // ... ISO/미래 시점 가드 ...

  // 1. staleAfterDays override
  if (typeof base.staleAfterDays === 'number') {
    return ageMs > base.staleAfterDays * 24 * 60 * 60 * 1000;
  }

  // 2. ADR-0190: mode='DAILY' + KR 일봉 출처 → KRX 거래일 grace
  if (
    mode === 'DAILY'
    && KRX_DAILY_PRICE_SOURCES.has(base.source)
    && !isSafePctChangeKrxCalendarDisabled()
  ) {
    return !isAcceptableKrxDailyBase(base.asOf, now);
  }

  // 3. legacy calendar 일 비교
  const limitDays = mode ? STALENESS_LIMITS_BY_MODE[mode] : STALENESS_LIMITS_BY_MODE.SANITY_ONLY;
  return ageMs > limitDays * 24 * 60 * 60 * 1000;
}
```

## Related ADRs

- **ADR-0028 (PR-Z3)** — `safePctChange` SSOT 도입
- **ADR-0091 (PR-Z4)** — `safePctChangeDetailed` valid=false 패턴
- **ADR-0157** — ENV 정확 비교 (`=== 'true'`) 의무
- **ADR-0189 (PR #614)** — `preMarketGapProbe` KRX 휴장일 정합 (본 ADR 와 동일 패턴, 다른 경로)

## Future wiring (scope 외)

- `safePctChangeStrict` (ADR-0117) 의 sanity bound 검증에도 KRX 거래일 분기 적용 검토 (현재 stale 검증 자체 부재이라 불필요)
- DART corp action 발견 시 base 자동 정정 (ADR-0113 후속)
