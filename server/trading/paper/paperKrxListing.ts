// @responsibility Judge whether the KRX listing caught the latest scheduled master refresh.
import { isKrxTradingDay, toKstDateKey } from '../../calendar/krxTradingCalendar.js';

/** stock_master_auto_enrichment (scheduler/maintenanceJobs) refreshes the master on KRX trading days at these KST times. */
const REFRESH_TIMES_KST = ['19:00', '06:00'] as const;
/** A refresh takes seconds; a slot counts only after this grace, so one still running is not called missed. */
const REFRESH_GRACE_MS = 30 * 60_000;

/** The latest scheduled refresh due by `now`; weekends and holidays fall back to the last trading day's 19:00. */
export function latestKrxMasterRefreshSlot(now: Date): Date | null {
  const limit = now.getTime() - REFRESH_GRACE_MS;
  for (let back = 0; back < 15; back++) {
    const date = toKstDateKey(new Date(limit - back * 86_400_000));
    if (!isKrxTradingDay(date)) continue;
    for (const time of REFRESH_TIMES_KST) {
      const slot = new Date(`${date}T${time}:00+09:00`);
      if (slot.getTime() <= limit) return slot;
    }
  }
  return null;
}

/**
 * A listing is out of date only when the latest scheduled refresh did not land. A fixed 24-hour age flagged every
 * weekend, when no refresh is scheduled, and switched the delisted judgement off until Monday.
 */
export function missedKrxMasterRefresh(refreshedAt: string | null, now: Date): boolean {
  if (refreshedAt === null || !Number.isFinite(Date.parse(refreshedAt))) return true;
  const slot = latestKrxMasterRefreshSlot(now);
  return slot !== null && Date.parse(refreshedAt) < slot.getTime();
}
