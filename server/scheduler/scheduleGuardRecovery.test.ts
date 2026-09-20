// @responsibility Verify observation tick recovery after delayed event-loop execution.
import { afterEach, describe, expect, it, vi } from 'vitest';
import cron from 'node-cron';
vi.mock('./scheduleCatalog.js', () => ({ recordScheduleRun: vi.fn() }));
vi.mock('../utils/marketDayClassifier.js', () => ({ getMarketDayContext: () => ({ isTradingDay: false }) }));
vi.mock('../learning/missedLearningQueue.js', () => ({ isMissedLearningQueueEnabled: () => false }));
vi.mock('../alerts/scheduledNotificationScope.js', () => ({ runScheduledNotificationScope: (_job: string, fn: () => unknown) => fn() }));
import { scheduledJob } from './scheduleGuard.js';

afterEach(() => {
  for (const task of cron.getTasks().values()) task.stop();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('delayed minute boundary with the installed cron scheduler', () => {
  it('recovers the observation once while ordinary jobs keep their original skip behavior', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(new Date('2026-09-20T16:36:59.500Z'));
    const elapsed = vi.spyOn(process, 'hrtime').mockReturnValue([0, 0]);
    const recovered = vi.fn(), ordinary = vi.fn();
    scheduledJob('* * * * *', 'ALWAYS_ON', 'recovered_observation', recovered, { timezone: 'UTC', recoverMissedExecutions: true });
    scheduledJob('* * * * *', 'ALWAYS_ON', 'ordinary_job', ordinary, { timezone: 'UTC' });
    // Four seconds pass while JS cannot run timers; the scheduled :00 callback resumes at :03.
    vi.setSystemTime(new Date('2026-09-20T16:37:02.500Z'));
    elapsed.mockReturnValue([4, 0]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(recovered).toHaveBeenCalledOnce();
    expect(ordinary).not.toHaveBeenCalled();
    elapsed.mockReturnValue([1, 0]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(recovered).toHaveBeenCalledOnce();
    // The next ordinary boundary still executes exactly once for both jobs.
    await vi.advanceTimersByTimeAsync(56_000);
    expect(recovered).toHaveBeenCalledTimes(2);
    expect(ordinary).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(2000);
    expect(recovered).toHaveBeenCalledTimes(2);
  });
});
