// @responsibility Select economical full-scan intervals around Korean market sessions.
import { isKrxTradingDay, toKstDateKey } from '../../calendar/krxTradingCalendar.js';

/** KST minute windows [from, to); the rest of a trading day uses 30 minutes. User schedule 2026-10-06. */
const TRADING_DAY_WINDOWS = [
  { from: 8 * 60, to: 9 * 60, minutes: 10 }, // pre-open preparation for the 08:30 recommendation
  { from: 9 * 60, to: 10 * 60, minutes: 2 }, // opening hour
  { from: 10 * 60, to: 11 * 60 + 30, minutes: 5 },
  { from: 11 * 60 + 30, to: 13 * 60 + 30, minutes: 10 }, // midday lull
  { from: 13 * 60 + 30, to: 15 * 60 + 20, minutes: 5 },
  { from: 15 * 60 + 20, to: 16 * 60, minutes: 10 }, // closing auction and close settlement
] as const;

/** Null means scheduled price collection rests for the entire KRX holiday. */
export function paperScanIntervalMs(now = new Date()): number | null {
  if (!isKrxTradingDay(toKstDateKey(now))) return null;
  const kst = new Date(now.getTime() + 9 * 3_600_000), minute = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  return (TRADING_DAY_WINDOWS.find(window => minute >= window.from && minute < window.to)?.minutes ?? 30) * 60_000;
}
