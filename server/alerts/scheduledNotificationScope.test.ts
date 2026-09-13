// @responsibility Verify scheduled Telegram isolation.
import { describe, expect, it, vi } from 'vitest';
const mode = vi.hoisted(() => vi.fn(() => 'SHADOW'));
vi.mock('../state.js', () => ({ getTradingMode: mode }));
import { runScheduledNotificationScope, suppressRetiredRoutineNotification as suppress } from './scheduledNotificationScope.js';

describe('scheduled notification scope', () => {
  it('isolates concurrent manual replies from legacy scheduled routines', async () => {
    await Promise.all([
      runScheduledNotificationScope('legacy_report', async () => { await Promise.resolve(); expect(suppress({ priority: 'NORMAL' })).toBe(true); }),
      Promise.resolve().then(() => expect(suppress({ priority: 'NORMAL' })).toBe(false)),
      runScheduledNotificationScope('paper_bot', async () => { await Promise.resolve(); expect(suppress({ priority: 'NORMAL' })).toBe(false); }),
    ]);
  });
  it.each([{ priority: 'CRITICAL' }, { severity: 'CRITICAL' }, { notificationSeverity: 'ACTION_REQUIRED' }, { critical: true }, { actionRequired: true }, { tier: 'T1_ALARM' }, { tradeEvent: true }, { category: 'TRADE' }, { executionImpact: 'ORDER' }, { notificationTarget: 'BOT_QUERY_RESPONSE' }])('preserves critical or execution delivery: %j', options => {
    runScheduledNotificationScope('legacy_job', () => expect(suppress(options)).toBe(false));
  });
  it('leaves another mode unchanged', () => {
    mode.mockReturnValueOnce('LIVE'); runScheduledNotificationScope('legacy_job', () => expect(suppress({ priority: 'NORMAL' })).toBe(false));
  });
});
