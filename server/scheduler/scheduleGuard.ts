/**
 * @responsibility cron 콜백 자동 가드 래퍼 — ScheduleClass 별 영업일/주말 차단 + 메트릭 기록 (ADR-0037)
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
  fn: () => Promise<void> | void,
  options: ScheduleGuardOptions = {},
): void {
  const cronOpts = options.timezone ? { timezone: options.timezone } : undefined;

  cron.schedule(cronExpr, async () => {
    const decision = options.force
      ? { skip: false }
      : shouldSkipForScheduleClass(scheduleClass);

    const startedAt = new Date().toISOString();

    if (decision.skip) {
      console.log(`[Scheduler:${jobName}] SKIP — ${scheduleClass} 가드 (${decision.reason})`);
      recordScheduleRun({
        jobName,
        startedAt,
        finishedAt: startedAt,
        durationMs: 0,
        status: 'skipped',
        note: decision.reason,
      });
      return;
    }

    const t0 = Date.now();
    try {
      await fn();
      recordScheduleRun({
        jobName,
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - t0,
        status: 'success',
      });
    } catch (e) {
      const note = e instanceof Error ? e.message.split('\n')[0] : String(e);
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
