// @responsibility Isolate routine scheduled notification output.
import { AsyncLocalStorage } from 'node:async_hooks';
import { getTradingMode } from '../state.js';

const scope = new AsyncLocalStorage<string>();
export function runScheduledNotificationScope<T>(jobName: string, callback: () => T): T {
  return scope.run(jobName, callback);
}

/** Collection still runs; the current Shadow bot owns routine scheduled reports. */
export function suppressRetiredRoutineNotification(options?: {
  priority?: string; severity?: string; tier?: string; category?: string;
  notificationTarget?: string; tradeEvent?: boolean; executionImpact?: string;
  notificationSeverity?: string; critical?: boolean; actionRequired?: boolean;
}): boolean {
  const job = scope.getStore();
  if (!job || job === 'paper_bot' || getTradingMode() !== 'SHADOW') return false;
  if (options?.notificationTarget === 'BOT_QUERY_RESPONSE' || options?.tradeEvent
    || options?.critical || options?.actionRequired || options?.notificationSeverity === 'CRITICAL' || options?.notificationSeverity === 'ACTION_REQUIRED'
    || options?.category === 'TRADE' || options?.executionImpact && options.executionImpact !== 'NONE'
    || options?.priority === 'CRITICAL' || options?.severity === 'CRITICAL' || options?.tier === 'T1_ALARM') return false;
  return true;
}
