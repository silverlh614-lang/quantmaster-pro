# ADR-0132 — Edge-Trigger Scheduler Logging + Holiday Enter Alert

**Status**: Accepted
**Date**: 2026-05-01
**Trigger**: 사용자 4/30 운영 보고 — 5/1 근로자의 날 (LONG_HOLIDAY) 새벽부터 `[Scheduler:*] SKIP — TRADING_DAY_ONLY 가드 (LONG_HOLIDAY)` 메시지가 30초 단위로 폭주, 24시간 약 25,000줄 추정. 사용자 명시: *"평일에도 이런 로그들로 실제 가치 있는 정보들이 매몰되지 않게 해야한다."*

## 1. 결함

### 1.1 SKIP 로그 폭주 (30초/잡 단위)

`server/scheduler/scheduleGuard.ts:106` 의 `console.log(...)` 가 cron tick 마다 무조건 호출:

```ts
if (decision.skip) {
  console.log(`[Scheduler:${jobName}] SKIP — ${scheduleClass} 가드 (${decision.reason})`);
  recordScheduleRun({ ..., status: 'skipped', note: decision.reason });
  return;
}
```

`orchestrator_tick` (1분) + `oco_confirm` (30초) + `dart_fast_check` (1분) + `dart_poll_30min` (30분) 등 30+ 개 평일 cron 이 LONG_HOLIDAY 기간 동안 매 tick 마다 SKIP 로그. 5/1 09:05 ~ 5/3 24:00 기준 약 25,000줄 발생 — Railway 로그 retention + 운영자 인지 부담 폭증, *진짜 신호* (실제 실패 / 회로 OPEN / 비상정지) 매몰.

### 1.2 휴장 진입 인지 부재

기존 `holiday_resume_alert` (KST 평일 09:05) 는 *복귀* 시점만 텔레그램 발송. 휴장 *진입* 시점 알림 부재로:

- 운영자가 *5/1 부터 SKIP 폭주가 정상* 임을 알 방법 없음
- 휴장 직전 의사결정 (ex. 매도 정리, 비상정지, OCO 손절선 조정) 트리거 부재
- 이미 `post_holiday_kickstart` (07:30) + `post_holiday_followup` (08:30) 이 *복귀 첫날* 알림을 담당하므로 *진입 직전* 대칭 알림 신설로 책임 분리 자연.

## 2. Decision

### 2.1 Edge-Trigger Logging (scheduleGuard)

`_lastSkipLogged: Map<jobName, reason>` 추가. SKIP 발생 시 *이전 reason 과 다를 때만* `console.log` 호출:

- 첫 SKIP: 1줄 로깅 + Map 갱신
- 동일 reason 연속 SKIP: silent + Map 유지
- 다른 reason 으로 전이 (WEEKEND → LONG_HOLIDAY): 1줄 로깅 + Map 갱신
- success / failure 분기에서 Map entry 제거 — 다음 SKIP 시 1줄 재로깅 (skipped → success → skipped 사이클을 운영자가 추적 가능)

`recordScheduleRun({ ... status: 'skipped' ... })` 메트릭은 *모든* SKIP 카운트 (영속 SSOT 보존). 본 결함은 *console.log 횟수만* 압축, 메트릭 정밀도 100% 보존.

### 2.2 Holiday Enter Alert (holidayEnterAlert)

`server/trading/holidayEnterAlert.ts` 신규 — `holidayResumeAlert.ts` 대칭 패턴.

- cron `15 6 * * 1-5` (UTC = KST 평일 15:15) — 장중 마감 15분 전 발송
- 활성 조건: 본일 영업일 (cron 자체 평일 가드) + `nextTradingDay` 까지 ≥ 3일 간격 (LONG_HOLIDAY 진입)
- 단순 평일+주말 (금요일 → 다음 월요일, 2일 간격) 은 silent — 운영자가 이미 인지하는 일상
- 메시지: `🌙 내일(YYYY-MM-DD) 부터 KRX 휴장 — 다음 거래일 YYYY-MM-DD 09:00. {N}일 휴장. {M}개 cron 자동 가드 활성.`
- dedupeKey `holiday-enter:{nextHolidayDate}` + 24h cooldown — 같은 휴장 진입 중복 차단

### 2.3 ENV 우회

- `SCHEDULE_EDGE_LOGGING_DISABLED=true` → edge-trigger 비활성, 모든 SKIP console.log 발송 (디버깅용)
- `HOLIDAY_ENTER_ALERT_DISABLED=true` → cron 자체 silent return

기본값 모두 정책 적용 — DISABLED 시 PR 이전 동작 즉시 복원.

## 3. 절대 규칙

1. **메트릭 SSOT 보존**: `recordScheduleRun` 카운트는 console.log 와 무관하게 매 SKIP 호출 — `skippedCount` / `lastSkipReason` 정밀도 100% 보존.
2. **상태 전환 가시화**: edge-trigger 가 *완전 silent* 가 아닌 *상태 변화 시 1줄* — 운영자가 LONG_HOLIDAY → TRADING_DAY 전환을 console 에서 즉시 인지.
3. **단순 주말 silent**: 매주 금요일 15:15 텔레그램 발송 차단 (LONG_HOLIDAY 만, 일반 주말 미알림).

## 4. 구현 매트릭스

| 시나리오 | console.log | Telegram | Metric (skippedCount) |
|---------|-------------|----------|----------------------|
| 평일 영업일 (skip 없음) | — | — | — |
| 평일 → 토요일 (cron 자체 차단됨, scheduleGuard 미호출) | — | — | — |
| 평일 → KRX 공휴일 (어린이날 5/5 단독) | 1줄 (전환점) | — | +1 |
| 평일 → LONG_HOLIDAY (5/1 근로자의 날 + 주말, gap=4) | 1줄 (전환점) | 🌙 진입 알림 1회 (15:15 KST 4/30) | +1 |
| LONG_HOLIDAY 동안 매 cron tick | — (silent) | — | +1 (영속 SSOT) |
| LONG_HOLIDAY → TRADING_DAY 복귀 | — (success 로 Map 클리어) | 09:05 holiday_resume_alert | success +1 |

## 5. 회귀 테스트

- `scheduleGuardEdgeLogging.test.ts` 8 케이스 (첫 SKIP 로깅 / 동일 사유 silent / 사유 전환 재로깅 / success 후 SKIP 재로깅 / failure 후 SKIP 재로깅 / ENV 우회 / 다중 jobName 독립 / __resetForTests)
- `holidayEnterAlert.test.ts` 7 케이스 (TRADING_DAY silent / 단순 PRE_HOLIDAY (gap=2) silent / LONG_HOLIDAY 진입 (gap=3+) 발송 / dedupeKey 형식 / formatMessage 라인 검증 / telegramClient throw graceful / ENV 우회)

## 6. 후속 PR (scope 외)

- `scheduleCatalog` JobMetrics `lastSkipReason` 시계열 (현재는 단일 string) — 운영자가 *최근 24h 사유 분포* 진단 가능
- `/scheduler edge_log_state` 텔레그램 명령 — `_lastSkipLogged` Map 현재 상태 조회
- 일반 주말 텔레그램 알림 (옵션) — 사용자 명시 차단으로 본 PR scope 외
