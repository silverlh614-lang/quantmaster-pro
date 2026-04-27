# ADR-0038: HolidayResumePolicy — 연휴 복귀 보수 매매 정책 SSOT (PR-C)

- **Status**: Accepted
- **Date**: 2026-04-26
- **Deciders**: architect (자본 보호 + 시간 정책 SSOT)
- **Related**: PR-A (자기반성 가드), PR-B (MarketDayClassifier SSOT, ADR-0037), PR-T (BudgetPolicy, ADR-0036)

## Context

PR-B 의 `MarketDayClassifier` 가 KRX 영업일을 7분기로 분류하는 SSOT 를 정착시켰다.
특히 `POST_HOLIDAY` (직전 영업일까지 ≥ 2일 비영업 간격) + `isLongHoliday` (≥ 3일
비영업 클러스터) 시그널은 **연휴 복귀 첫 영업일** 을 정확히 식별한다.

그러나 이 분류를 **매매 행동** 에 연결하는 정책 SSOT 가 부재하다:

1. **갭 리스크 미반영** — 3일 이상 연휴 후에는 시장이 갭업/갭다운으로 시작하는
   경우가 많다. 연휴 중 누적된 글로벌 뉴스(미 FOMC / 지정학적 이벤트 / 어닝 시즌
   등) 가 시초가에 일제히 반영되어 변동성이 평상시 대비 1.5~2배. 시스템은 이를
   인지하지 못하고 평상시와 동일한 사이징·Gate 기준으로 진입.
2. **시초가 30분 무관찰 진입** — 연휴 갭 안정화 30분 동안 시초 호가가 폭주해도
   시스템이 09:00 KST 부터 즉시 진입 시도. 사용자 페르소나 자료 "연휴 후 시초 30분
   관찰" 정책이 코드로 반영되지 않음.
3. **Gate 기준 평상시 유지** — Gate 5점 이상이면 진입하는 평상시 기준이 연휴 직후
   에도 동일 적용. 갭으로 인해 Gate 점수가 부풀려진 종목이 진입 후 즉시 손절될
   확률 증가.

## Decision

`server/trading/holidayResumePolicy.ts` 신설 — 연휴 복귀 보수 매매 정책 SSOT.
`MarketDayClassifier` 결과 위에 올라가는 **시간 + Gate + Kelly 캡슐 정책**.

### 1. 정책 인터페이스

```typescript
export interface HolidayResumePolicy {
  id: string;                  // 'long-holiday-resume-default'
  reason: string;              // '장기 연휴 복귀 첫 영업일'
  kellyMultiplier: number;     // 0.5 = BudgetPolicy 캡 위에 50% 추가 축소
  gateScoreBoost: number;      // +1 = ENTRY_MIN_GATE_SCORE 5 → 6 으로 임계 상향
  marketOpenDelayMin: number;  // 30 = 09:00~09:30 KST 신규 진입 차단
  expirationKstTime: string;   // '12:00' = 정오 이후 자동 해제, '' = 일중 유지
}
```

### 2. SSOT 함수

```typescript
// 활성 정책 결정 — POST_HOLIDAY + isLongHoliday + 만료 미도달 시 정책 반환, 외 null
export function resolveHolidayResumePolicyForContext(
  ctx: MarketDayContext,
  now?: Date,
): HolidayResumePolicy | null;

// 호출자가 명시적으로 적용하는 헬퍼 3종 (LIVE 매매 본체 0줄 변경 보장)
export function applyKellyMultiplierWithHolidayPolicy(
  baseKelly: number,
  policy: HolidayResumePolicy | null,
): number;

export function applyGateBoostWithHolidayPolicy(
  baseMinGate: number,
  policy: HolidayResumePolicy | null,
): number;

export function isWithinMarketOpenDelay(
  now: Date,
  policy: HolidayResumePolicy | null,
): boolean;
```

### 3. 알림 cron

`server/trading/holidayResumeAlert.ts` — 09:00 KST cron 에서 활성 정책 시 텔레그램
1회 발송. dedupeKey=`holiday-resume:{date}` + 24h cooldown 으로 중복 차단.

### 4. cron 등록

`server/scheduler/alertJobs.ts` 에 `0 0 * * 1-5` (UTC 평일 00:00 = KST 평일 09:00)
cron 추가. 평일 영업일에만 작동. KRX 공휴일은 함수 내부 ctx 가드로 자동 SKIP.

### 5. 활성 조건

| MarketDayType | isLongHoliday | 활성 여부 |
|---------------|---------------|-----------|
| TRADING_DAY | (무관) | ❌ |
| POST_HOLIDAY | false (단순 1일 휴장 직후 — 어린이날 다음날 등) | ❌ |
| POST_HOLIDAY | true (연휴 ≥ 3일 직후 — 추석/설날/근로자의 날+주말) | ✅ 활성 |
| WEEKEND / KRX_HOLIDAY / LONG_HOLIDAY_* | (무관) | ❌ (영업일 아님) |
| PRE_HOLIDAY | (무관) | ❌ (연휴 들어가기 직전 — 별개 정책) |

만료 시각(KST 12:00) 도달 후에는 정책 활성이어도 null 반환. 오후에는 시장 안정화.

## Consequences

### Positive
- **갭 안정화 30분 관찰 자동 적용** — `isWithinMarketOpenDelay()` 가 신호 진입
  직전에 호출되면 시초 30분 동안 신규 진입 차단.
- **연휴 후 변동성 보수 사이징** — Kelly 0.5x + Gate +1 로 진입 임계와 사이즈를
  동시에 보수화. 갭으로 점수가 부풀린 종목 자동 필터.
- **PR-B SSOT 즉시 활용** — `MarketDayClassifier.getMarketDayContext()` 결과 위에
  분기 1줄로 정책 활성 판정.
- **텔레그램 가시성** — 5/4 월요일·추석 다음 월요일 등에 09:00 자동 알림 발송.
- **백테스트 가능** — 정책 객체 swap 으로 "Kelly 0.3x vs 0.5x" 같은 비교 가능
  (PR-T BudgetPolicy 와 동일 사상).

### Negative
- **본 PR 매매 wiring 미포함** — entryEngine / signalScanner 가 `apply*` 헬퍼를
  호출하지 않으면 정책이 활성이어도 매매 무영향. 후속 PR-C-2 에서 wiring 진행.
- **expirationKstTime 시간 정책 단순화** — 정오 이후 무조건 해제. 시장 변동성이
  여전히 클 경우 사용자가 수동 연장 불가 (env 오버라이드는 가능).

### Neutral
- LIVE 매매 본체 0줄 변경 (kisClient/orchestrator/signalScanner/entryEngine/
  autoTradeEngine 무수정).
- BudgetPolicy (ADR-0036) 와 별개 운영. holidayResumePolicy 의 kellyMultiplier 는
  BudgetPolicy 의 fractionalKellyCap 위에 곱해지는 추가 축소 계수.

## Migration Path

- **본 PR (PR-C)**: 정책 SSOT + 알림 cron + 헬퍼 3종.
- **PR-C-2 (후속)**: entryEngine `evaluateEntryRevalidation` 가 `applyGateBoostWithHolidayPolicy()`
  로 임계 상향. signalScanner `evaluateBuyList` 사이징이 `applyKellyMultiplierWithHolidayPolicy()`
  로 추가 축소. signalScanner 의 진입 시점 가드에 `isWithinMarketOpenDelay()` 추가.
- **PR-D (후속)**: KRX 휴장일 자동 동기화 — 본 정책의 LONG_HOLIDAY 판정 정확도가
  자동 갱신되는 KRX_HOLIDAYS Set 위에서 자동 향상.

## Test Coverage

- `holidayResumePolicy.test.ts`:
  - resolveHolidayResumePolicyForContext: TRADING_DAY null / POST_HOLIDAY+isLongHoliday=true
    활성 / POST_HOLIDAY+isLongHoliday=false null / 12:00 만료 분기 / WEEKEND null
  - applyKellyMultiplierWithHolidayPolicy: null no-op / 0.5 효과 / 음수 안전
  - applyGateBoostWithHolidayPolicy: null no-op / +1 효과
  - isWithinMarketOpenDelay: null false / 09:00~09:30 true / 09:30+1 false / 09:00 직전 false / marketOpenDelayMin=0 false
- `holidayResumeAlert.test.ts`:
  - 활성 시 sendTelegramAlert 호출 + dedupeKey + cooldown
  - 비활성 시 호출 안 함
  - 만료 시각 후 호출 안 함
