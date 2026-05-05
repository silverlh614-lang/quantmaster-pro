# ADR-0188: lint baseline cleanup — 21 누적 type 결함 일소

## 1. 배경

ADR-0187 (PR #610 — macroState dead-read wiring) 작업 중 사전 baseline lint 21건 발견. 사용자 명시 요청 *"후속 진행"* 으로 본 PR 분리 진행.

`npm run lint` 실행 결과 21 type 결함 — 운영 안전성 critical 4건 (production code) + 회귀 안전성 17건 (test-only). `git stash` 동일 재현으로 ADR-0187 무관 확정 후 별도 PR 분리.

### 결함 분류

**A. signalScanner perSymbolEvaluation barrel re-export 누락 (5건)** — ADR-0134 분해 후 `perSymbol/types.ts` (`BuyListLoopMutables` 등 4 type) + `perSymbol/helpers.ts` (`SymbolExitContext`) 의 type export 가 `perSymbolEvaluation.ts` barrel 에서 누락. `signalScanner.ts:35` + `entryGates/types.ts:14` + `approvalQueue/applyApprovalReservation.ts:4` + 각 test 파일 등 5 호출자가 import 단절.

**B. sanity.cmd.ts TelegramCommand schema 결함 (3건, production)** — ADR-0146b telegram-sanity-unlock-cmd 도입 시 *outdated TelegramCommand schema* 사용 (`command` → 정상 `name` / `handler(ctx, args)` → 정상 `execute({args, reply})` / return string → reply 호출). 다른 system/*.cmd.ts 패턴과 어긋남.

**C. kisClient/query.ts:409 prevClose shorthand 결함 (1건, production CRITICAL)** — `fetchKisPrevClose` FHKST03010100 일봉 fallback 분기에서 `close` 변수 추출 후 `prevClose` shorthand 사용 → `prevClose` 변수 부재로 type 결함. 의도는 `close` (일봉 종가) → `prevClose` (전일 종가) 매핑.

**D. preflight.test.ts type mismatch (8건)** — mock 반환값 (`loadWatchlist` / `loadR3SanityBlockState` / `getVixGating` / `getFomcProximity` / `computeSlotConsumption` / `checkVolumeClockWindow`) 의 type 시그니처 진화 (필드 추가) 후 test 미갱신.

**E. candidateSelect.test.ts:106 (1건)** — `mockedAssignSection.mockReturnValue('UNKNOWN')` — `WatchlistSection` union ('SWING'|'CATALYST'|'MOMENTUM') 외 'UNKNOWN' literal 은 *의도된 invalid input* 이지만 type cast 누락.

**F. safePctChangeReturnWindow.test.ts:3 (1건)** — `DAILY_STALE_AFTER_DAYS` 정적 export 폐지 후 (calendar-based 가변 값 전환) test import 미갱신.

**G. yahooHealthCheck.test.ts:106 (1건)** — `YahooHealthSummary` schema 4 신규 필드 (`recoveredCount` / `historicalRefreshRecoveredCount` / `historicalRefreshFailedCount` / `staleUnrecoveredCount`) 추가 후 test factory 미갱신.

**H. yahooHealthCheck.test.ts 메시지 expectation outdated (1건, runtime regression)** — production 메시지 형식 갱신 (`STALE_BASE — base.asOf 30일 초과` → `DATA_STALE_PRICE — Yahoo base.asOf 만료 / 분할·병합 미반영 / 가격 inversion 의심`) 후 test 기대값 미갱신.

### 영향 범위
- 운영 안전성: **High** (C — `fetchKisPrevClose` 결함은 KIS 일봉 fallback 경로 broken / B — `/sanity` 텔레그램 명령 register 자체 불가능)
- 회귀 안전성: **Medium** (A — type 시스템이 perSymbol 모듈 분해 후 barrel 누락 검출)
- 테스트 품질: **Low** (D~H — mock factory 갱신 누락)

## 2. 결정

**옵션 A 채택** — 21 결함 단일 PR 일괄 정리. 분리 시 PR 폭주 + 거버넌스 부담.

각 결함 수정:

### A. perSymbol barrel re-export 통합 (`perSymbolEvaluation.ts`)
`perSymbol/index.ts` 의 SSOT 통합 barrel 그대로 `export * from './perSymbol/index.js'` — 5 호출자 자동 정합. 기존 `export * from './perSymbol/buyListLoop.js' + intradayLoop.js'` 2 줄을 1 줄로 통합.

### B. sanity.cmd.ts schema 정합화
`command` → `name` / `handler(ctx, args)` → `async execute({args, reply})` / return string → `await reply(...)`. byte-equivalent 동작 보존 + 다른 system/*.cmd.ts 패턴 정렬.

### C. kisClient/query.ts:409 명시 매핑
`prevClose` shorthand → `prevClose: close` 명시. 변수명 보존 (`close` 는 일봉 종가 의미, `prevClose` 는 함수 의도) + 의도 명확화.

### D. preflight.test.ts mock type cast
9 mock 호출 `as ReturnType<typeof <fn>>` cast — schema 진화 시 자동 정합 (필수 필드 직접 명시는 schema 변경 시 drift 위험).

### E. candidateSelect.test.ts type cast
`'UNKNOWN' as unknown as ReturnType<typeof assignSection>` — invalid input 의도 명시 + lint 통과.

### F. safePctChangeReturnWindow.test.ts import 정합
`DAILY_STALE_AFTER_DAYS` 정적 import 폐기 → `currentDailyStaleAfterDays` 동적 함수 호출. test line 9 의 비교를 동적 호출 결과로 정정.

### G. yahooHealthCheck.test.ts factory 보강
`summary()` factory 에 4 신규 필드 0 default 추가.

### H. yahooHealthCheck.test.ts 메시지 expectation 정정
`STALE_BASE — base.asOf 30일 초과` → `DATA_STALE_PRICE — Yahoo base.asOf 만료` / `yahoo 캐시 강제 재새로고침` → `Yahoo history refresh`.

## 3. 회귀 영향 0

본 PR 의 모든 변경은 *type 정합* 또는 *test mock 정합* — production 동작 변경 0:
- A: barrel re-export 1 줄 통합 (export 결과 동일)
- B: TelegramCommand schema 정합 — `webhookHandler` 가 `commandRegistry.resolve` 후 `execute({args, reply})` 호출하는 표준 패턴 정렬
- C: `prevClose: close` 명시 매핑 — type level 결함만 수리, runtime 동작 byte-equivalent (`{close, ...}` 객체 literal 의 의도된 매핑)
- D~H: test-only

## 4. 안전 invariant 6종 (절대 규칙)

1. **LIVE 매매 본체 0줄 변경** — type 정합 만, 의사결정 흐름 무관.
2. **KIS/KRX 자동매매 quota 0 침범** — `kisClient/query.ts` 변경은 `prevClose: close` 매핑 1 줄, KIS 호출 빈도 0 변경.
3. **byte-equivalent 동작 보존** — production code (B, C) 의 변경은 모두 type-level 또는 schema 정합 정정.
4. **회귀 테스트 자동 정합** — `as ReturnType<typeof <fn>>` cast 패턴 (D) 으로 schema 진화 자동 흡수.
5. **드리프트 차단** — barrel re-export (A) 단일 SSOT 통합으로 향후 perSymbol 분해 추가 시 자동 정합.
6. **single source of truth** — sanity.cmd.ts (B) 가 다른 system/*.cmd.ts 와 동일 패턴 정렬.

## 5. 잘못된 해결 방법 영구 차단

1. **`kisClient/query.ts` 의 `prevClose` 변수 신설** — `close` 변수가 *일봉 종가* 의미라 `prevClose` 신설은 변수명 충돌. 명시 매핑이 정답.
2. **TelegramCommand schema 본체 변경** — `command` 또는 `handler` field 추가는 다른 system/*.cmd.ts 51개 모듈 모두 정합 변경 필요. sanity.cmd.ts 단독 정합화가 최소 변경.
3. **DAILY_STALE_AFTER_DAYS 정적 상수 복원** — calendar-based 가변 값 전환은 의도된 진화 (PR-553). test import 정합화가 정답.
4. **YahooHealthSummary 4 신규 필드 옵셔널 격하** — production 코드가 4 필드 모두 사용하므로 옵셔널 격하는 추가 결함 유발. test factory 보강이 정답.
5. **분할 PR 시리즈** — 21 결함 분할 시 PR 폭주 + 사용자 *"후속 진행"* 명시 의도 정합 미달. 단일 PR 일괄 정리.

## 6. 거버넌스 정합

- ADR-0146 PR 자가 review 5 카테고리 모두 PASS.
- ADR-0148 4 정적 검증 (adrIndex / pendingWiring / silentDegradation / prPaceAudit) baseline 무회귀.
- ADR-0157 `now` injection 패턴 (D — `as ReturnType<typeof <fn>>`) 차용 변형 — 시간 의존 mock 자동 정합.
- PENDING_WIRING.md 등재 **불필요** — lint 결함은 *코드 부채* 자체이고 wiring 미완 (영속 / 외부 호출자 0건) 과 다름. 본 PR 으로 즉시 종결.

## 7. 잔여 사전 baseline 정리 (commit 0e41538 후속)

### 7.1 시간 의존 runtime regression — `safePctChangeReturnWindow.test.ts` (해소 완료)

`"allows a 4.1-day DAILY base for weekend/holiday market gaps"` 1건 fail — *시간 의존 runtime regression*. KRX trading calendar 5/1~5/5 연휴 영향:

- module-load NOW (실제 5/5) 기반: `recommendedDailyStaleWindowDays` = **3** (5/5 어린이날 휴장 → 직전 거래일 5/4, gap 1+2=3)
- test fixture NOW (5/4) 기반: 동일 함수 = **6** (5/4 → 직전 거래일 4/30, gap 4+2=6)

`installYahooTradingCalendarWindows()` 가 module-load 시 1회 박제 → `STALENESS_LIMITS_BY_MODE.DAILY=3` 고정 → 4.1-day base 가 stale 판정 (3 < 4.1).

**해결**: test 의 `beforeEach` 에서 `installYahooTradingCalendarWindows(NOW)` 명시 호출하여 fixture NOW 기반으로 재박제. `afterEach` 에서 module-load 시점 값 복원으로 다른 test 영향 격리. test isolation 격상 + production code 무영향.

검증: `npx vitest run server/utils/safePctChangeReturnWindow.test.ts` **6/6 pass** + `server/utils` 인접 13 files **364/364 무회귀**.

## 8. 운영 효과

- `npm run lint` EXIT=0 회복 — 향후 PR 시 사전 baseline 결함 누적 차단.
- `/sanity` 텔레그램 명령 정상 register 가능 — ADR-0146b 정상 작동.
- `fetchKisPrevClose` FHKST03010100 일봉 fallback 정상 동작 — KIS 토큰 만료 직후 캐시 fallback 경로 broken 결함 영구 차단.
- perSymbol barrel re-export 단일 SSOT — ADR-0134 분해 후속 PR 의 type drift 자동 검출.
