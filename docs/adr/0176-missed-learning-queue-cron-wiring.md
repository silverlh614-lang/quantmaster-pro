# ADR-0176 — MissedLearningQueue Cron Wiring (Phase 2b-2 — scheduleGuard hook + 5 학습 cron + replay cron)

**상태**: Accepted (Phase 2b-2 — scheduleGuard hook + 5 wiring + replay cron, ENV default OFF)
**날짜**: 2026-05-03
**관련 PR**: PR-Shadow-Learning-Phase2b2
**의존성**:
- ADR-0173 (Shadow Learning Persistence Phase 1) — `MissedLearningQueue` SSOT (`enqueueMissedLearningJob` / `replayMissedLearningJobs` / `dropStaleJobs`) + ENV `MISSED_LEARNING_QUEUE_ENABLED`
- ADR-0043 (Market Day Classifier + Schedule Guard SSOT) — `scheduleGuard.ts` + `ScheduleClass='TRADING_DAY_ONLY'` 자동 silent skip
- ADR-0132 (Edge-Trigger Scheduler Logging) — silent skip 동일 사유 무한 로깅 차단
- ADR-0146 (PR-Pace Audit Rule) — Phase 분리 정합
- ADR-0158 (Wiring SLA Auto-Expiry) — INFRASTRUCTURE_ONLY P1 SLA 45일

## 1. 문제

ADR-0173 Phase 1 의 MissedLearningQueue SSOT (영속 + enqueue + replay + dropStaleJobs) 는 *호출자 0건 dead code* 상태. 휴일·서버 장애·배포 시 7 학습 작업 (counterfactual_resolve / ledger_resolve / ghost_portfolio / nightly_reflection / daily_mini_backtest / shadow_live_delta_report / safety_gate_attribution) 이 *영구 손실* 되는 결함이 SSOT 만 도입되고 wiring 부재.

**현재 cron 등록 상태**:
- 5 학습 cron 등록 완료 (`learningJobs.ts`: counterfactual_resolve / ledger_resolve / ghost_portfolio / nightly_reflection / daily_mini_backtest)
- 2 학습 cron 미등록 (shadow_live_delta_report / safety_gate_attribution — Phase 2a 분석 SSOT 만 도입, cron 등록은 Phase 4 Dashboard 후속 PR scope)

KRX 휴장일 진입 시 `ScheduleClass='TRADING_DAY_ONLY'` 가드가 *cron 함수 자체를 silent skip* — 학습 작업 미실행 + 다음 영업일 복구 메커니즘 부재.

## 2. 결정

### 2.1 scheduleGuard.ts hook 패턴

**옵션 A — `scheduledJob` 옵셔널 인자 추가** (채택):
```typescript
export interface ScheduleGuardOptions {
  timezone?: string;
  force?: boolean;
  /** ADR-0176 — TRADING_DAY_ONLY silent skip 시 MissedLearningQueue enqueue.
   *  ENV `MISSED_LEARNING_QUEUE_ENABLED === 'true'` 통과 시에만 활성. */
  enqueueOnSkip?: {
    replayPolicy?: ReplayPolicy;  // default 'SAFE_NEXT_TRADING_DAY'
  };
}
```

**거부된 대안**:
- ❌ `scheduleGuard.ts` 본체 무수정 + 별도 cron 으로 KRX 휴장일 감지 → 7 학습 cron 의 jobName 모두 enqueue (이중 cron, 중복 위험 ↑)
- ❌ 7 학습 cron 콜백 진입부에 enqueue 분기 추가 (휴장일에는 콜백 자체 미호출이라 도달 불가)
- ❌ ENV gate 없이 모든 TRADING_DAY_ONLY cron 자동 enqueue (회귀 위험 ↑)

**hook 위치** — `scheduleGuard.ts:149` `if (decision.skip)` 분기 안 (edge-trigger log + metric 기록 직후, return 전):

```typescript
if (decision.skip) {
  // ... 기존 edge-trigger log + recordScheduleRun 보존 ...

  // ADR-0176 — MissedLearningQueue enqueue hook (옵셔널 + ENV gate)
  if (options.enqueueOnSkip && isMissedLearningQueueEnabled()) {
    try {
      enqueueMissedLearningJob({
        jobName: jobName as MissedLearningJobName,  // 화이트리스트 검증은 enqueue 함수 내부
        reason: decision.reason === 'KRX_HOLIDAY' ? 'KRX_HOLIDAY' : 'MARKET_DATA_MISSING',
        skippedAt: startedAt,
        replayPolicy: options.enqueueOnSkip.replayPolicy ?? 'SAFE_NEXT_TRADING_DAY',
        idempotencyKey: `${jobName}:${startedAt.slice(0, 10)}`,
      });
    } catch (err) {
      console.error(`[Scheduler:${jobName}] enqueueOnSkip 실패:`, err);
    }
  }
  return;
}
```

### 2.2 5 학습 cron 호출 site wiring

`server/scheduler/learningJobs.ts` 의 5 cron 호출에 `enqueueOnSkip: {}` 옵션 추가 (default replayPolicy):
- counterfactual_resolve (UTC 평일 07:00 = KST 16:00)
- ledger_resolve (UTC 평일 07:15 = KST 16:15)
- ghost_portfolio (UTC 평일 06:40 = KST 15:40)
- nightly_reflection (UTC 평일 10:00 = KST 19:00)
- daily_mini_backtest (UTC 일~목 15:30 = KST 익일 00:30)

**5 cron 만** — `shadow_live_delta_report` / `safety_gate_attribution` cron 등록 자체 부재 (Phase 4 Dashboard 후속 PR scope). 향후 cron 등록 시 `enqueueOnSkip: {}` 추가 의무.

### 2.3 MissedLearningQueue replay cron 신규

`server/scheduler/maintenanceJobs.ts` 또는 `learningJobs.ts` 에 신규 cron 추가:

```typescript
scheduledJob('30 0 * * 1-5', 'TRADING_DAY_ONLY', 'missed_learning_replay', async () => {
  if (!isMissedLearningQueueEnabled()) return;
  const today = new Date().toISOString().slice(0, 10);
  const result = await replayMissedLearningJobs({ tradingDate: today, maxJobsPerRun: 10 });
  console.log(`[MissedLearningReplay] replayed=${result.replayed} failed=${result.failed} dropped=${result.dropped}`);
});
```

**cron 시간**: UTC 평일 00:30 = **KST 평일 09:30** (장 시작 30분 전 안전 시간) + ScheduleClass='TRADING_DAY_ONLY'.

**replayMissedLearningJobs jobName → 실제 함수 매핑**: ADR-0173 §1 의 *plumbing only* 상태 그대로 — 본 PR 도 mock dispatcher (status 'PENDING' → 'REPLAYED' 전이만). 실제 함수 매핑은 후속 PR (Phase 3 wiring 후 또는 Phase 2b-3 분리).

### 2.4 ENV 매트릭스

- `MISSED_LEARNING_QUEUE_ENABLED` (Phase 1 ADR-0173 동일 ENV) default OFF — 운영자 명시 활성화 의무
  - OFF: hook 미호출 + replay cron no-op (기존 동작 100% 보존)
  - ON: 5 학습 cron silent skip 시 enqueue + replay cron 다음 영업일 복구 시도

## 3. 안전 invariant (Phase 2b-2 절대 규칙)

| # | invariant | 검증 |
|---|-----------|------|
| 1 | LIVE 매매 본체 0줄 변경 | git diff `signalScanner.ts` + `signalScanner/**` + `entryEngine.ts` + `exitEngine/**` + `kisClient/**` + `orchestrator/**` + `autoTradeEngine*` = 0 줄 |
| 2 | KIS 주문 함수 import 0건 | 정적 grep 가드 (학습 영속 갱신 전용) |
| 3 | 기존 cron 동작 100% 보존 | scheduleGuard.ts 옵션 미전달 cron (전체 79+ 중 5 학습 외) 모두 무영향 — 옵셔널 인자 패턴 |
| 4 | ENV default OFF | `MISSED_LEARNING_QUEUE_ENABLED` 미설정 시 hook + replay cron 모두 no-op |
| 5 | 화이트리스트 5 학습 cron | 다른 cron 에 `enqueueOnSkip` 옵션 전달 0건 (정적 grep 가드) |
| 6 | enqueue throw catch | scheduleGuard hook 의 enqueue 호출 try/catch — cron 흐름 차단 안 함 |
| 7 | 호출자 1건 (replay cron 만) | grep `replayMissedLearningJobs` = 모듈 + 테스트 + replay cron 등록만 |

## 4. 잘못된 해결 방법 영구 차단

1. ❌ **`enqueueOnSkip` 옵션 미적용 cron 자동 enqueue** — 화이트리스트 위반, 회귀 위험 ↑
2. ❌ **ENV default ON** — 운영자 명시 활성화 의무 (replay 동작 검증 후 활성화)
3. ❌ **scheduleGuard hook 안에서 LIVE 주문 호출** — 학습 영속 갱신 전용
4. ❌ **`replayMissedLearningJobs` 의 실제 함수 매핑 본 PR 통합** — Phase 3 wiring 후 후속 PR (회귀 위험 격리)
5. ❌ **idempotencyKey 합성 외 인자 추가 옵션 노출** — 단순 SSOT 유지 (replayPolicy 만 옵셔널)
6. ❌ **`shadow_live_delta_report` / `safety_gate_attribution` cron 등록 본 PR 통합** — Phase 4 Dashboard 후속 PR scope

## 5. Phase 3/4 wiring 정책

### Phase 3 — LIVE 결합
- 5 early-return 직전 `runShadowLearningOnlyScan` wiring (ENV `SHADOW_LEARNING_ON_BLOCKED_DAYS_ENABLED=true`)
- ReflectionInjectionBus — `mainReflection` / `scoreBuyCandidate` / `condition weight engine` / `position sizing` 에 `applyFreshnessDecay` 호출 wiring
- `replayMissedLearningJobs` 의 jobName → 실제 함수 매핑 (5 학습 cron 함수 직접 호출 또는 dispatcher)

### Phase 4 — Dashboard
- `shadow_live_delta_report` / `safety_gate_attribution` cron 등록 (Phase 2a 분석 SSOT 활성화)
- Learning Sanity Dashboard 11 지표 UI

## 6. 운영 효과 (Phase 2b-2 머지 후)

- ADR-0173 Phase 1 의 MissedLearningQueue SSOT 가 처음으로 *cron wiring* 활성화 (현재 호출자 1건 — replay cron 만)
- ENV ON 시 KRX 휴장일에 5 학습 작업 자동 enqueue + 다음 영업일 KST 09:30 replay (실제 replay 함수 매핑은 후속 PR)
- 회귀 위험 격리 — 옵셔널 인자 + ENV default OFF + 화이트리스트 5 학습 cron + 다른 cron 무영향
