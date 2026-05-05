/**
 * @responsibility KRX trading-calendar helper for stale-base decisions.
 *
 * This is intentionally local/static for emergency stability. It covers weekends,
 * 2026 Korea exchange holidays known to affect near-term stale-base checks, and a
 * small next-trading-day buffer. Extend the holiday table yearly or replace with a
 * KRX/public-data fetcher later.
 */

const KRX_HOLIDAYS_BY_YEAR: Record<number, Set<string>> = {
  2026: new Set([
    '2026-01-01',
    '2026-02-16', '2026-02-17', '2026-02-18',
    '2026-03-02',
    '2026-05-01',
    '2026-05-05',
    '2026-05-25',
    '2026-08-17',
    '2026-09-24', '2026-09-25',
    '2026-10-05', '2026-10-09',
    '2026-12-25', '2026-12-31',
  ]),
};

export function toKstDateKey(input: Date | string): string {
  const d = typeof input === 'string' ? new Date(input) : input;
  if (!Number.isFinite(d.getTime())) return '';
  return new Date(d.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function dateKeyToUtcNoon(dateKey: string): Date {
  return new Date(`${dateKey}T03:00:00.000Z`); // 12:00 KST, DST-free
}

function addDays(dateKey: string, days: number): string {
  const d = dateKeyToUtcNoon(dateKey);
  d.setUTCDate(d.getUTCDate() + days);
  return toKstDateKey(d);
}

export function isKrxHoliday(dateKey: string): boolean {
  const year = Number(dateKey.slice(0, 4));
  return KRX_HOLIDAYS_BY_YEAR[year]?.has(dateKey) ?? false;
}

export function isKrxTradingDay(dateKey: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return false;
  const d = dateKeyToUtcNoon(dateKey);
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  return !isKrxHoliday(dateKey);
}

export function previousKrxTradingDay(now: Date = new Date()): string {
  let cursor = toKstDateKey(now);
  // Yahoo/KRX daily base is previous close. Treat today's intraday as needing the
  // previous completed trading day.
  cursor = addDays(cursor, -1);
  for (let i = 0; i < 14; i += 1) {
    if (isKrxTradingDay(cursor)) return cursor;
    cursor = addDays(cursor, -1);
  }
  return cursor;
}

export function isAcceptableKrxDailyBase(asOf: string, now: Date = new Date()): boolean {
  const baseKey = toKstDateKey(asOf);
  if (!baseKey) return false;
  const expected = previousKrxTradingDay(now);
  if (baseKey >= expected) return true;

  // One-trading-day grace: Yahoo timestamps sometimes represent exchange close in UTC
  // and can appear one local date earlier around holidays/provider lag. Do not allow
  // deeper drift.
  let prev = addDays(expected, -1);
  for (let i = 0; i < 7; i += 1) {
    if (isKrxTradingDay(prev)) return baseKey >= prev;
    prev = addDays(prev, -1);
  }
  return false;
}

export function recommendedDailyStaleWindowDays(now: Date = new Date()): number {
  const expected = previousKrxTradingDay(now);
  const nowMs = now.getTime();
  const expectedMs = dateKeyToUtcNoon(expected).getTime();
  const calendarGapDays = Math.ceil(Math.max(0, nowMs - expectedMs) / (24 * 60 * 60 * 1000));
  // +2 days covers exchange close timestamp timezone/provider lag while keeping true
  // week-old daily bases stale. Lower bound 3 keeps ordinary weekdays unchanged.
  return Math.max(3, Math.min(8, calendarGapDays + 2));
}
