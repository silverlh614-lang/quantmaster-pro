# ADR-0037: MarketDayClassifier SSOT + ScheduleGuard 인프라 (PR-B)

- **Status**: Accepted
- **Date**: 2026-04-26
- **Deciders**: architect (학습 데이터 무결성 + 스케줄러 SSOT)
- **Related**: PR-A (자기반성 주말·공휴일 가드 / 즉시 효과), ADR-0009 (외부 호출 예산 게이트)

## Context

PR-A 에서 `nightlyReflectionEngine.ts` 진입부에 `isKstWeekend(now) || isKrxHoliday(date)`
가드 + `learningJobs.ts` 의 2개 cron(NightlyReflection / F2W) 에 평일 가드를 직접 추가했다.
즉시 효과는 컸지만 다음 5개 구조적 결함이 노출됐다:

1. **분류 SSOT 부재** — 토/일/평일 KRX 공휴일/평일 영업일 4분기만 알 수 있고, 운영
   문맥에서 자주 쓰이는 7분기(`PRE_HOLIDAY` / `POST_HOLIDAY` / `LONG_HOLIDAY_START` /
   `LONG_HOLIDAY_END`) 는 알 수 없다. 연휴 복귀 첫날 사이징을 보수적으로 가져가는
   PR-C 가 본 SSOT 위에서 1줄 변경으로 끝나야 한다.
2. **다음/이전 영업일 계산 부재** — `nextTradingDay` / `prevTradingDay` 가 코드 곳곳에
   inline 으로 흩어져 있다. KRX 공휴일을 건너뛰는 영업일 산술이 SSOT 없이 분산.
3. **cron 가드 하드코딩** — PR-A 의 `1-5` / `0-4` 평일 가드는 cron 표현식 레벨에서
   모든 호출자가 직접 명시. 신규 cron 추가 시 가드 누락 위험. `learningJobs.ts` 만
   13개 cron 이 있고 다른 8개 스케줄러 파일까지 합치면 80+ cron 이 동일 패턴으로
   수동 가드 또는 무가드 상태로 분산되어 있다.
4. **학습 데이터 검증 게이트 부재** — `nightlyReflection` / `backtestEngine` /
   `failureToWeight` / `counterfactualShadow` / `recommendationTracker` 가 모두 trade
   레코드의 영업일 유효성을 별도로 가정한다. 비영업일 레코드가 학습 풀에 진입하지
   못하도록 차단하는 단일 헬퍼가 없다.
5. **JobMetrics 스킵 사유 부재** — `JobMetrics.skippedCount` 는 있지만 어떤 사유로
   스킵됐는지(NON_TRADING_DAY / WEEKEND / KRX_HOLIDAY) 추적할 수 없다. `/scheduler
   history` 에 "월요일 자기반성이 정상적으로 1회 실행됐는가" 같은 시계열 질문에
   답하려면 사유 카테고리화가 필요하다.

## Decision

본 PR-B 에서 SSOT 인프라 4종 + cron 자동 가드 래퍼를 도입한다. 실제 적용은
**learningJobs.ts 13개 cron 한정** (인프라 안전성 검증). 다른 스케줄러 파일
(orchestratorJobs / alertJobs / reportJobs / screenerJobs / tradeFlowJobs / kisStreamJobs /
shadowResolverJob / maintenanceJobs / healthCheckJob) 은 후속 PR-B-2 에서 점진 적용.

### 1. `server/utils/marketDayClassifier.ts` 신설

```typescript
export type MarketDayType =
  | 'TRADING_DAY'         // KRX 정규 영업일
  | 'WEEKEND'             // 토/일
  | 'KRX_HOLIDAY'         // 평일이지만 KRX 공휴일
  | 'PRE_HOLIDAY'         // 다음 영업일까지 ≥ 2 영업일 간격(연휴 시작 직전 영업일)
  | 'POST_HOLIDAY'        // 직전 영업일까지 ≥ 2 영업일 간격(연휴 종료 직후 영업일)
  | 'LONG_HOLIDAY_START'  // 비영업일 + 다음 영업일까지 ≥ 3일 간격(추석/설날 첫날)
  | 'LONG_HOLIDAY_END';   // 비영업일 + 직전 영업일까지 ≥ 3일 간격(추석/설날 마지막날)

export interface MarketDayContext {
  date: string;                    // YYYY-MM-DD KST
  type: MarketDayType;
  isTradingDay: boolean;
  nextTradingDay: string;          // 8일 lookahead
  prevTradingDay: string;          // 8일 lookback
  isLongHoliday: boolean;          // 비영업 간격 ≥ 3일 여부
}

export function getMarketDayContext(dateYmd?: string): MarketDayContext;
export function isTradingDay(dateYmd?: string): boolean;
export function nextTradingDay(dateYmd: string): string;
export function prevTradingDay(dateYmd: string): string;
```

PR-A 에서 추가한 `isKrxHoliday` 와 기존 `marketClock.isKstWeekend` 위에 올라가는
얇은 분류기. 8일 lookahead/lookback 으로 추석 7일 연휴까지 안전 커버.

### 2. `server/scheduler/scheduleGuard.ts` 신설

```typescript
export type ScheduleClass =
  | 'TRADING_DAY_ONLY'    // 영업일 전용 — 주말 + KRX 공휴일 차단
  | 'WEEKEND_MAINTENANCE' // 주말 전용 — 영업일에 실행되지 않음
  | 'MARKET_ADJACENT'     // 다음 영업일 준비 — 휴일 전날도 실행
  | 'ALWAYS_ON';          // 365일 24시간 — 가드 미적용

export function scheduledJob(
  cronExpr: string,
  scheduleClass: ScheduleClass,
  jobName: string,
  fn: () => Promise<void> | void,
  options?: { timezone?: string; force?: boolean }
): void;
```

`scheduledJob` 은 내부적으로 `node-cron` 의 `cron.schedule` 을 호출하면서, 콜백을
ScheduleClass 별 가드로 래핑한다. 주말 새벽 cron 자체 실행을 막기 위해 cron 표현식
레벨에서 1차 차단 + 콜백 진입부에서 KRX 공휴일/연휴 컨텍스트로 2차 차단. 스킵 시
`recordScheduleRun({ status: 'skipped', skipReason: 'NON_TRADING_DAY' | 'WEEKEND' | ... })`.

### 3. `server/learning/learningDataValidator.ts` 신설

```typescript
export interface TradingDayFilterResult<T> {
  validRecords: T[];
  rejectedCount: number;
  rejectedSamples: Array<{ recordId: string; date: string; reason: string }>; // 최대 5건
}

export function filterToTradingDayRecords<T>(
  records: T[],
  getDateKst: (rec: T) => string | undefined,
  getId: (rec: T) => string,
): TradingDayFilterResult<T>;

export function countTradingDays(periodStart: string, periodEnd: string): number;
```

`backtestEngine` / `failureToWeight` / `nightlyReflection` 등 학습 입력을 받는 곳에서
호출. 비영업일 레코드를 자동 필터링 + 거부 카운트 진단. **본 PR 에서는 헬퍼만 도입**
하고 실제 적용은 후속 PR (재호출자별 1건씩 안전 적용).

### 4. `JobMetrics` 확장 — `lastSkipReason` 1 필드 추가

```typescript
interface JobMetrics {
  // ... 기존 필드
  lastSkipReason?: string;  // 'NON_TRADING_DAY' / 'WEEKEND' / 'KRX_HOLIDAY' / ...
}
```

### 5. `learningJobs.ts` 13 cron → ScheduleClass 일괄 적용

| cron | jobName | ScheduleClass | 변경 사유 |
|------|---------|---------------|----------|
| `0 23 * * 5` | `weekly_backtest` | TRADING_DAY_ONLY (UTC 금요일 = KST 토요일 08:00 — 주말 작업이지만 토요일은 거래일이 아님이므로 영업일 가드 자체는 통과 — 분류상 WEEKEND_MAINTENANCE) | WEEKEND_MAINTENANCE |
| `0 22 * * 0` | `weekly_calib` | WEEKEND_MAINTENANCE | 일요일 UTC = 월요일 KST 07:00. 학습용 주간 작업 |
| `30 15 * * 0-4` | `daily_mini_backtest` | TRADING_DAY_ONLY | 평일 KST 00:30 |
| `30 7 * * 3` | `weekly_sharpe_alert` | TRADING_DAY_ONLY | 수요일 KST 16:30 |
| `10 18 * * 0-4` | `f2w_reverse_loop` | TRADING_DAY_ONLY | PR-A 가드 + KRX 공휴일 가드 |
| `0 10 * * 1-5` | `nightly_reflection` | TRADING_DAY_ONLY | PR-A 가드 + KRX 공휴일 가드 |
| `40 6 * * 1-5` | `ghost_portfolio` | TRADING_DAY_ONLY | 평일 KST 15:40 |
| `0 9 * * 0` | `silent_distillation` | WEEKEND_MAINTENANCE | 일요일 KST 18:00 |
| `0 22 1 * *` | `walk_forward_validation` | ALWAYS_ON | 매월 1일 (KRX 공휴일이어도 내부 데이터 검증) |
| `0 7 * * 1-5` | `counterfactual_resolve` | TRADING_DAY_ONLY | 평일 KST 16:00 |
| `15 7 * * 1-5` | `ledger_resolve` | TRADING_DAY_ONLY | 평일 KST 16:15 |

JSON cron 표현식은 보존 (1차 cron 가드). ScheduleGuard 가 KRX 공휴일을 2차 차단.

## Consequences

### Positive
- **PR-C 가벼움**: 연휴 복귀 보수 모드는 `getMarketDayContext().type === 'POST_HOLIDAY' && isLongHoliday` 1줄 분기로 끝.
- **PR-D 단일 SSOT 갱신**: KRX 휴장일 자동 동기화는 `KRX_HOLIDAYS` Set 갱신만 하면 본 모듈 자동 반영.
- **회귀 안전망**: 신규 cron 추가 시 ScheduleClass 미명시는 컴파일러 차단 (필수 인자).
- **운영 가시성**: `/scheduler history` 가 스킵 사유까지 표시.

### Negative
- **변경 표면 증가**: learningJobs.ts 13 cron 일괄 변경 — byte-equivalent 추출이지만 다중 파일 영향.
- **다른 스케줄러 미적용**: orchestratorJobs / alertJobs / reportJobs 등 80+ cron 은 후속 PR-B-2 까지 무가드 유지.

### Neutral
- LIVE 매매 본체 0줄 변경 (kisClient/orchestrator/signalScanner 무수정).
- `node-cron` 라이브러리 wrapper 만 추가 — 직접 import 도 호환 유지.

## Migration Path

- **본 PR (PR-B)**: 인프라 4종 + learningJobs.ts 13 cron 일괄.
- **PR-B-2 (후속)**: 다른 스케줄러 파일 80+ cron 점진 적용 — 도메인 단위 분리.
- **PR-C**: tradingOrchestrator 에 `getMarketDayContext()` 호출 + POST_HOLIDAY/LONG_HOLIDAY_END 분기로 Gate +1 / Kelly 50% / 시초 30분 진입 차단.
- **PR-D**: 매년 12/1 cron 으로 KRX 공식 휴장일 자동 동기화 (`KRX_HOLIDAYS` 정적 Set 자동 갱신).

## Test Coverage

- `marketDayClassifier.test.ts` — 7분기 분류 + 다음/이전 영업일 + isLongHoliday + 7일 연휴 (추석) 시나리오 ≥ 12 케이스
- `scheduleGuard.test.ts` — ScheduleClass 4분기 × ScheduleClass 진입 차단/통과/skip 사유 기록 ≥ 8 케이스
- `learningDataValidator.test.ts` — 영업일 필터링 + 거부 사유 + 빈 입력 + 누락 필드 ≥ 6 케이스
- `scheduleCatalogMetrics.test.ts` — `lastSkipReason` 확장 1건 추가
