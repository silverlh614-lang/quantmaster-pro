/**
 * @responsibility cron 콜백 자동 가드 래퍼 — ScheduleClass 별 영업일/주말 차단 + 메트릭 기록 (ADR-0043)
 *
 * `node-cron` 의 `cron.schedule` 위에 올라가는 얇은 래퍼.
 * 호출자는 cron 표현식 + ScheduleClass 만 명시하면, 비영업일 진입 시 자동 SKIP +
 * `recordScheduleRun({ status: 'skipped', note: reason })` 메트릭 기록.
 *
 * cron 표현식 자체에 `1-5` / `0-4` 평일 가드를 두는 것은 1차 방어선 — KRX 공휴일이
 * 평일에 떨어진 경우(어린이날·추석)는 cron 으로 차단 못 하므로 본 가드가 진짜 방어선.
 */

import cron from 'node-cron';
import { recordScheduleRun } from './scheduleCatalog.js';
import { getMarketDayContext } from '../utils/marketDayClassifier.js';
import {
  enqueueMissedLearningJob,
  isMissedLearningQueueEnabled,
  type MissedLearningJobName,
  type ReplayPolicy,
} from '../learning/missedLearningQueue.js';

export type ScheduleClass =
  | 'TRADING_DAY_ONLY'    // KRX 영업일 전용 — 주말 + 공휴일 차단
  | 'WEEKEND_MAINTENANCE' // 비영업일 전용 — 영업일 차단
  | 'MARKET_ADJACENT'     // 영업일 전용이지만 PRE/POST_HOLIDAY 통과 (현재는 TRADING_DAY_ONLY 와 동일 — 분류 의도 표시용)
  | 'ALWAYS_ON';          // 가드 미적용 (365일)

export interface ScheduleGuardDecision {
  skip: boolean;
  reason?: string;
}

export interface ScheduleGuardOptions {
  /** cron timezone — 미지정 시 system local. learningJobs 는 `UTC` 권장. */
  timezone?: string;
  /** 테스트/긴급 우회 — true 면 가드 무시. 기본 false. */
  force?: boolean;
  /**
   * ADR-0176 — TRADING_DAY_ONLY silent skip 시 MissedLearningQueue enqueue.
   *
   * **옵셔널** — 미전달 시 hook 미실행 (기존 동작 100% 보존, 회귀 위험 0).
   * **ENV gate** — `MISSED_LEARNING_QUEUE_ENABLED === 'true'` 통과 시에만 활성.
   * **화이트리스트** — 5 학습 cron 만 옵션 전달 (counterfactual_resolve / ledger_resolve /
   *   ghost_portfolio / nightly_reflection / daily_mini_backtest). 다른 cron 에 전달 시
   *   `enqueueMissedLearningJob` 내부 schema 가 `MissedLearningJobName` union 검증으로 차단.
   * **enqueue throw catch** — cron 흐름 차단 안 함.
   */
  enqueueOnSkip?: {
    /** default 'SAFE_NEXT_TRADING_DAY' — 다음 영업일 안전 시간대 replay. */
    replayPolicy?: ReplayPolicy;
  };
}

// 부팅 검증용 — scheduledJob 진입(cron.schedule 호출 전)에서 add.
// registerXxxJobs() 가 throw 하면 그 줄 이후 jobName 은 누락되어 즉시 식별 가능.
const _registeredJobs = new Set<string>();
/** scheduledJob 으로 등록 진입한 jobName 목록 — 부팅 검증 로그 전용 */
export function getRegisteredJobNames(): string[] {
  return Array.from(_registeredJobs).sort();
}

// ── Edge-Trigger Logging (ADR-0132) ─────────────────────────────────────────
// SKIP console.log 가 cron tick 마다 폭주하던 회귀 차단. jobName 별 직전 SKIP 사유를
// Map 에 보관하여 *사유가 다를 때만* 로깅. 동일 사유 연속 SKIP 은 silent.
// success / failure 분기에서 Map entry 제거 — 다음 SKIP 시 재로깅으로 상태 전환 가시화.
//
// recordScheduleRun 메트릭(skippedCount/lastSkipReason)은 본 Map 과 *무관하게* 매 호출
// 갱신 — 영속 SSOT 정밀도 100% 보존.
const _lastSkipLogged = new Map<string, string>();

function isEdgeLoggingDisabled(): boolean {
  return process.env.SCHEDULE_EDGE_LOGGING_DISABLED === 'true';
}

/** 테스트 전용 — 모듈 로컬 Map 초기화. */
export function __resetEdgeLoggingForTests(): void {
  _lastSkipLogged.clear();
}

/**
 * 본 SKIP 호출이 console.log 를 발행해야 하는지 판정 (edge-trigger).
 * 같은 jobName + 같은 reason 연속 호출은 silent.
 *
 * 부수효과: 발행 결정 시 Map 갱신 (다음 호출 비교 기준).
 */
export function shouldEmitSkipLog(jobName: string, reason: string): boolean {
  if (isEdgeLoggingDisabled()) {
    return true; // 디버깅용: 모든 SKIP 발행
  }
  const prev = _lastSkipLogged.get(jobName);
  if (prev === reason) {
    return false; // 동일 사유 연속 SKIP — silent
  }
  _lastSkipLogged.set(jobName, reason);
  return true;
}

/**
 * success / failure 시 Map entry 제거 — 다음 SKIP 시 1줄 재로깅으로 상태 전환 가시화.
 * (skipped → success → skipped 사이클을 운영자가 console 에서 인지)
 */
export function clearSkipEdgeState(jobName: string): void {
  _lastSkipLogged.delete(jobName);
}

/**
 * 주어진 ScheduleClass 가 현재(또는 주입 날짜) 시점에 스킵 대상인지 판정.
 * 순수 함수 — 단위 테스트에서 직접 호출 가능. cron 콜백이 진입부에서 호출.
 */
export function shouldSkipForScheduleClass(
  scheduleClass: ScheduleClass,
  date?: string,
): ScheduleGuardDecision {
  const ctx = getMarketDayContext(date);

  switch (scheduleClass) {
    case 'TRADING_DAY_ONLY':
    case 'MARKET_ADJACENT':
      if (!ctx.isTradingDay) {
        const reason =
          ctx.type === 'WEEKEND' ? 'WEEKEND' :
          ctx.type === 'KRX_HOLIDAY' ? 'KRX_HOLIDAY' :
          ctx.type === 'LONG_HOLIDAY_START' ? 'LONG_HOLIDAY' :
          ctx.type === 'LONG_HOLIDAY_END' ? 'LONG_HOLIDAY' :
          'NON_TRADING_DAY';
        return { skip: true, reason };
      }
      return { skip: false };

    case 'WEEKEND_MAINTENANCE':
      if (ctx.isTradingDay) {
        return { skip: true, reason: 'TRADING_DAY' };
      }
      return { skip: false };

    case 'ALWAYS_ON':
      return { skip: false };
  }
}

/**
 * cron.schedule 래퍼. ScheduleClass 가드 + 자동 메트릭 기록.
 *
 * @example
 *   scheduledJob('0 10 * * 1-5', 'TRADING_DAY_ONLY', 'nightly_reflection', async () => {
 *     await runNightlyReflection();
 *   }, { timezone: 'UTC' });
 */
export function scheduledJob(
  cronExpr: string,
  scheduleClass: ScheduleClass,
  jobName: string,
  // 반환값은 사용하지 않으므로 unknown 으로 완화 — 호출자가 wrap 코드 추가 불필요.
  fn: () => Promise<unknown> | unknown,
  options: ScheduleGuardOptions = {},
): void {
  const cronOpts = options.timezone ? { timezone: options.timezone } : undefined;

  // cron.schedule 호출 *전* 에 추적 — register 함수가 throw 해도 이전 jobName 은 보존.
  _registeredJobs.add(jobName);

  cron.schedule(cronExpr, async () => {
    const decision = options.force
      ? { skip: false }
      : shouldSkipForScheduleClass(scheduleClass);

    const startedAt = new Date().toISOString();

    if (decision.skip) {
      const reason = decision.reason ?? 'UNKNOWN';
      // ADR-0132: Edge-trigger logging — 동일 사유 연속 SKIP 은 silent.
      // 메트릭(recordScheduleRun)은 매 호출 갱신 — 영속 SSOT 정밀도 보존.
      if (shouldEmitSkipLog(jobName, reason)) {
        console.log(`[Scheduler:${jobName}] SKIP — ${scheduleClass} 가드 (${reason})`);
      }
      recordScheduleRun({
        jobName,
        startedAt,
        finishedAt: startedAt,
        durationMs: 0,
        status: 'skipped',
        note: decision.reason,
      });

      // ADR-0176 — MissedLearningQueue enqueue hook (옵셔널 + ENV gate + 화이트리스트).
      // 옵션 미전달 시 hook 미실행 — 기존 동작 100% 보존 (회귀 위험 0).
      // ENV `MISSED_LEARNING_QUEUE_ENABLED !== 'true'` 시 hook 미실행 — default OFF.
      // jobName cast 안전: enqueueMissedLearningJob 내부 schema 가 MissedLearningJobName
      // union 검증 — 잘못된 jobName 전달 시 schema 에러 발생 → 본 catch 블록이 흡수.
      if (options.enqueueOnSkip && isMissedLearningQueueEnabled()) {
        try {
          enqueueMissedLearningJob({
            jobName: jobName as MissedLearningJobName,
            // decision.reason 가능 값 (scheduleGuard 내부): WEEKEND / KRX_HOLIDAY /
            // LONG_HOLIDAY / NON_TRADING_DAY / TRADING_DAY (WEEKEND_MAINTENANCE 분기).
            // KRX_HOLIDAY 만 1:1 매핑, 나머지는 MARKET_DATA_MISSING fallback.
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

    const t0 = Date.now();
    try {
      await fn();
      // ADR-0132: success 시 edge-trigger Map entry 제거 — 다음 SKIP 시 재로깅
      // (skipped → success → skipped 사이클 가시화).
      clearSkipEdgeState(jobName);
      recordScheduleRun({
        jobName,
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - t0,
        status: 'success',
      });
    } catch (e) {
      const note = e instanceof Error ? e.message.split('\n')[0] : String(e);
      // ADR-0132: failure 시에도 edge-trigger Map 클리어 — 다음 SKIP 재로깅.
      clearSkipEdgeState(jobName);
      recordScheduleRun({
        jobName,
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - t0,
        status: 'failure',
        note,
      });
      // 실패도 throw 하지 않고 swallow — 다음 cron 주기는 계속 살아있어야 한다.
      console.error(`[Scheduler:${jobName}] 실패:`, e);
    }
  }, cronOpts);
}
