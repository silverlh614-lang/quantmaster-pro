/**
 * @responsibility Runtime calendar-window patch for Yahoo/KRX staleness windows.
 *
 * Yahoo/KRX bases are trading-day based, but the guard receives calendar age.
 * Weekends and exchange holidays can make the latest valid daily base appear 4+ calendar
 * days old. Keep INTRADAY strict, but widen DAILY enough for weekend/holiday gaps and
 * RECOMMENDATION_RETURN enough for normal 20-trading-day windows.
 */

import { STALENESS_LIMITS_BY_MODE } from './safePctChange.js';

export const DAILY_STALE_AFTER_DAYS = 6;
export const RECOMMENDATION_RETURN_STALE_AFTER_DAYS = 45;

export function installYahooTradingCalendarWindows(): void {
  STALENESS_LIMITS_BY_MODE.DAILY = DAILY_STALE_AFTER_DAYS;
  STALENESS_LIMITS_BY_MODE.RECOMMENDATION_RETURN = RECOMMENDATION_RETURN_STALE_AFTER_DAYS;
}

// Backward-compatible export used by PR-551 tests/callers.
export function installRecommendationReturnCalendarWindow(): void {
  installYahooTradingCalendarWindows();
}

installYahooTradingCalendarWindows();
