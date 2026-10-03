// @responsibility Select economical full-scan intervals around Korean market sessions.
import { isKrxTradingDay, toKstDateKey } from '../../calendar/krxTradingCalendar.js';

export function paperScanIntervalMs(now = new Date()): number {
  const date = toKstDateKey(now);
  if (!isKrxTradingDay(date)) return 60 * 60_000;
  // Frequent preparation protects the 08:30 recommendation; close settlement retains retry capacity.
  if (now.getTime() >= Date.parse(`${date}T08:00:00+09:00`)
    && now.getTime() < Date.parse(`${date}T16:00:00+09:00`)) return 60_000;
  return 30 * 60_000;
}
