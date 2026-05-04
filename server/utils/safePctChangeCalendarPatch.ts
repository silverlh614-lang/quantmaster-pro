/**
 * @responsibility Runtime calendar-window patch for recommendation return staleness.
 *
 * Yahoo/KRX 20-trading-day return bases often appear 31~35 calendar days old because of
 * weekends and holidays. The core safePctChange SSOT keeps DAILY/INTRADAY strict, while
 * this boot-time patch widens only RECOMMENDATION_RETURN to 45 calendar days.
 */

import { STALENESS_LIMITS_BY_MODE } from './safePctChange.js';

export const RECOMMENDATION_RETURN_STALE_AFTER_DAYS = 45;

export function installRecommendationReturnCalendarWindow(): void {
  STALENESS_LIMITS_BY_MODE.RECOMMENDATION_RETURN = RECOMMENDATION_RETURN_STALE_AFTER_DAYS;
}

installRecommendationReturnCalendarWindow();
