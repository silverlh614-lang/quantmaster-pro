// @responsibility Verify delayed-tick recovery defaults, the order-path exception and the kill switch.
import { afterEach, describe, expect, it, vi } from 'vitest';
import cron from 'node-cron';
vi.mock('./scheduleCatalog.js', () => ({ recordScheduleRun: vi.fn() }));
vi.mock('../utils/marketDayClassifier.js', () => ({ getMarketDayContext: () => ({ isTradingDay: false }) }));
vi.mock('../learning/missedLearningQueue.js', () => ({ isMissedLearningQueueEnabled: () => false }));
vi.mock('../alerts/scheduledNotificationScope.js', () => ({ runScheduledNotificationScope: (_job: string, fn: () => unknown) => fn() }));
import { resolveMissedTickRecovery, scheduledJob } from './scheduleGuard.js';

afterEach(() => {
  for (const task of cron.getTasks().values()) task.stop();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('delayed minute boundary with the installed cron scheduler', () => {
  /** Registers the jobs, then lets four seconds pass while JS cannot run timers so the :00 callback resumes at :03. */
  async function delayedBoundary(jobs: Array<[string, boolean | undefined]>) {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(new Date('2026-09-20T16:36:59.500Z'));
    const elapsed = vi.spyOn(process, 'hrtime').mockReturnValue([0, 0]);
    const calls = new Map(jobs.map(([name, recover]) => {
      const fn = vi.fn();
      scheduledJob('* * * * *', 'ALWAYS_ON', name, fn, { timezone: 'UTC', ...(recover === undefined ? {} : { recoverMissedExecutions: recover }) });
      return [name, fn] as const;
    }));
    vi.setSystemTime(new Date('2026-09-20T16:37:02.500Z'));
    elapsed.mockReturnValue([4, 0]);
    await vi.advanceTimersByTimeAsync(1000);
    return { calls, elapsed };
  }
  afterEach(() => { delete process.env.SCHEDULER_MISSED_TICK_RECOVERY_DISABLED; });

  it('recovers ordinary jobs once while the order path and explicit opt-outs keep the skip', async () => {
    const { calls, elapsed } = await delayedBoundary([['recovered_observation', true], ['ordinary_job', undefined],
      ['cancel_all_active_oco', undefined], ['minute_price_check', false]]);
    expect(calls.get('recovered_observation')).toHaveBeenCalledOnce();
    expect(calls.get('ordinary_job')).toHaveBeenCalledOnce();
    expect(calls.get('cancel_all_active_oco')).not.toHaveBeenCalled();
    expect(calls.get('minute_price_check')).not.toHaveBeenCalled();
    elapsed.mockReturnValue([1, 0]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls.get('ordinary_job')).toHaveBeenCalledOnce();
    // The next ordinary boundary still executes exactly once for every job.
    await vi.advanceTimersByTimeAsync(56_000);
    expect(calls.get('recovered_observation')).toHaveBeenCalledTimes(2);
    expect(calls.get('ordinary_job')).toHaveBeenCalledTimes(2);
    expect(calls.get('cancel_all_active_oco')).toHaveBeenCalledOnce();
    expect(calls.get('minute_price_check')).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls.get('ordinary_job')).toHaveBeenCalledTimes(2);
  });

  it('restores the old opt-in-only default with the kill switch', async () => {
    process.env.SCHEDULER_MISSED_TICK_RECOVERY_DISABLED = 'true';
    const { calls } = await delayedBoundary([['recovered_observation', true], ['ordinary_job', undefined]]);
    expect(calls.get('recovered_observation')).toHaveBeenCalledOnce();
    expect(calls.get('ordinary_job')).not.toHaveBeenCalled();
    expect(resolveMissedTickRecovery('backup_ceremony')).toBe(false);
    delete process.env.SCHEDULER_MISSED_TICK_RECOVERY_DISABLED;
    expect(resolveMissedTickRecovery('backup_ceremony')).toBe(true);
    expect(resolveMissedTickRecovery('orchestrator_tick')).toBe(false);
  });
});
