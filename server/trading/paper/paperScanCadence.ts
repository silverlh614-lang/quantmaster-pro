// @responsibility Select economical full-scan intervals around Korean market sessions.
import { isKrxTradingDay, toKstDateKey } from '../../calendar/krxTradingCalendar.js';

/** Null means scheduled price collection rests for the entire KRX holiday. */
export function paperScanIntervalMs(now = new Date()): number | null {
  const date = toKstDateKey(now);
  if (!isKrxTradingDay(date)) return null;
  // Include pre-open preparation and close settlement in the ten-minute collection window.
  if (now.getTime() >= Date.parse(`${date}T08:00:00+09:00`)
    && now.getTime() < Date.parse(`${date}T16:00:00+09:00`)) return 10 * 60_000;
  return 30 * 60_000;
}
