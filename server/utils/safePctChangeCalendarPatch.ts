/**
 * @responsibility Runtime calendar-window patch for Yahoo/KRX staleness windows.
 *
 * Yahoo/KRX bases are trading-day based, but the guard receives calendar age.
 * This patch derives the DAILY window from the KRX trading calendar instead of a
 * fixed blanket window, so weekends/holidays are accepted while week-old bases remain stale.
 */

import { recommendedDailyStaleWindowDays } from '../calendar/krxTradingCalendar.js';
import { STALENESS_LIMITS_BY_MODE } from './safePctChange.js';

export const RECOMMENDATION_RETURN_STALE_AFTER_DAYS = 45;

export function currentDailyStaleAfterDays(now: Date = new Date()): number {
  return recommendedDailyStaleWindowDays(now);
}

export function installYahooTradingCalendarWindows(now: Date = new Date()): void {
  STALENESS_LIMITS_BY_MODE.DAILY = currentDailyStaleAfterDays(now);
  STALENESS_LIMITS_BY_MODE.RECOMMENDATION_RETURN = RECOMMENDATION_RETURN_STALE_AFTER_DAYS;
}

// Backward-compatible export used by PR-551 tests/callers.
export function installRecommendationReturnCalendarWindow(): void {
  installYahooTradingCalendarWindows();
}

installYahooTradingCalendarWindows();
