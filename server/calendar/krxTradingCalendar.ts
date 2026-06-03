/**
 * @responsibility KRX trading-day walk / staleness helper layer — delegates holiday data to krxHolidays SSOT (ADR-0559).
 *
 * This module owns the trading-day walk / staleness grace logic (toKstDateKey, addDays,
 * previousKrxTradingDay, isAcceptable*Base, recommendedDailyStaleWindowDays). Holiday
 * data is NOT owned here: `isKrxHoliday` re-exports `krxHolidays.isKrxHoliday` (the single
 * data SSOT — STATIC ∪ patch ∪ ADR-0548 KIS sync), structurally dissolving the former
 * dual-ledger divergence. Public API signatures are preserved (18 consumers unchanged).
 */

import { isKrxHoliday as krxHolidaysIsKrxHoliday } from '../trading/krxHolidays.js';

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

/**
 * ADR-0559: 휴일 데이터 판정을 krxHolidays SSOT 에 위임 (re-export). 시그니처 보존
 * (dateKey: 'YYYY-MM-DD'). 자체 하드코딩 휴일셋(KRX_HOLIDAYS_BY_YEAR)을 제거하여
 * 두 원장의 divergence 를 구조적으로 소멸. isKrxTradingDay/walk 헬퍼는 이 함수를
 * 호출하므로 위임된 데이터(STATIC ∪ patch ∪ KIS sync)를 자동으로 본다.
 */
export function isKrxHoliday(dateKey: string): boolean {
  return krxHolidaysIsKrxHoliday(dateKey);
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

/**
 * ADR-0252: N 영업일 grace 일반화 — DAILY (1 영업일) / RECOMMENDATION_RETURN
 * (20 영업일) 등 mode 별 다른 임계 적용. 사용자 5/6 보고: 휴장일 클러스터
 * (5/1·5/5) 에서 정상 영업일 base 가 calendar 일 비교로 STALE 오판되던 결함 차단.
 *
 * - businessDaysGrace=1: ADR-0190 (DAILY) 동작 정합 — 직전 영업일 + 1 일 grace
 * - businessDaysGrace=20: RECOMMENDATION_RETURN 5일/20일 수익률 base 허용
 *
 * 휴장일을 영업일에서 자연 제외 — 5/6 시점 20 영업일 = 약 4/3 (calendar 33일).
 */
export function isAcceptableKrxBusinessDayBase(
  asOf: string,
  now: Date = new Date(),
  businessDaysGrace: number = 1,
): boolean {
  const baseKey = toKstDateKey(asOf);
  if (!baseKey) return false;
  const expected = previousKrxTradingDay(now);
  if (baseKey >= expected) return true;

  // expected 부터 N 영업일 거꾸로 walk — 휴장일은 자동 skip.
  // calendar 일 buffer = businessDaysGrace × 2 + 14 (추석/신정 같은 ≤ 7일 연휴 + 주말).
  let cursor = expected;
  let walked = 0;
  const maxWalk = businessDaysGrace * 2 + 14;
  for (let i = 0; i < maxWalk; i += 1) {
    cursor = addDays(cursor, -1);
    if (isKrxTradingDay(cursor)) {
      walked++;
      if (walked >= businessDaysGrace) {
        return baseKey >= cursor;
      }
    }
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
