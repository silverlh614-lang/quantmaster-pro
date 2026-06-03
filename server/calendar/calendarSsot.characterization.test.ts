/**
 * @responsibility Golden-master characterization of the two independent KRX holiday ledgers — locks current behavior before SSOT unification.
 *
 * READ-ONLY characterization harness (NO integration / NO refactor). LIVE order gating
 * (휴장일 → liveOrderAllowed) depends on which ledger the trading path consults, so this
 * test measures the existing divergence first.
 *
 * Two ledgers, both export `isKrxHoliday`, mutually independent (no cross-import):
 *   - server/calendar/krxTradingCalendar.ts : isKrxHoliday + isKrxTradingDay (hardcoded 2026 only)
 *   - server/trading/krxHolidays.ts          : isKrxHoliday + isKrxBusinessDay (STATIC 2026+2027 ∪ patch)
 *
 * LIVE-path note: the entry/preflight gate (signalScanner/preflight.ts → r3Countability →
 * resolveMarketSessionState) and buyPipeline.ts consult krxTradingCalendar.isKrxTradingDay.
 * marketClock.classifyMarketDataMode (HOLIDAY_CACHE) and marketDayClassifier consult
 * krxHolidays.isKrxHoliday. They disagree (see EFFECTIVE_TRADING_DAY_DIVERGENCE below).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * UNIFICATION ACCEPTANCE CRITERIA (5 lines — a unification PR must satisfy all):
 *  1. Single ledger adopted; every consumer (incl. LIVE buyPipeline/preflight) routes through it.
 *  2. Divergences resolved SAFE-DIRECTION ONLY: add missing holidays (more conservative);
 *     never reclassify a true trading day into a holiday (would silently drop trades).
 *  3. 2026-12-31 (연말 폐장) is a holiday in the unified ledger.
 *  4. Dates where both ledgers already AGREE keep golden output unchanged (zero regression).
 *  5. liveOrderAllowed path stays byte-equivalent OR changes only toward the safer direction
 *     (휴장일에 주문이 열리던 구멍을 닫는 변경만 허용).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, expect, it } from 'vitest';
import {
  isKrxHoliday as calIsKrxHoliday,
  isKrxTradingDay as calIsKrxTradingDay,
} from './krxTradingCalendar.js';
import {
  isKrxHoliday as holIsKrxHoliday,
  isKrxBusinessDay as holIsKrxBusinessDay,
  getStaticKrxHolidays,
} from '../trading/krxHolidays.js';

/**
 * EFFECTIVE trading-day divergences across 2024-01-01 .. 2027-12-31.
 * "effective" = weekday-only, where calendar.isKrxTradingDay !== krxHolidays.isKrxBusinessDay.
 * (Holidays that fall on weekends never diverge because both reject weekends.)
 *
 * Each entry records SAFETY direction for the LIVE order gate:
 *   - UNSAFE  : a real holiday seen as a trading day → order window could open on a closed day.
 *   - CONSERVATIVE : a real trading day seen as a holiday → trades skipped (safe, missed only).
 */
const EFFECTIVE_TRADING_DAY_DIVERGENCE: ReadonlyArray<{
  date: string;
  calTradingDay: boolean;
  holBusinessDay: boolean;
  truth: 'HOLIDAY' | 'TRADING';
  calSafety: 'UNSAFE' | 'CONSERVATIVE';
  holSafety: 'UNSAFE' | 'CONSERVATIVE';
  note: string;
}> = [
  // 연말 폐장: krxTradingCalendar marks it, krxHolidays does NOT.
  // krxHolidays treating 12/31 as a business day is UNSAFE (would open order window on closed day).
  { date: '2026-12-31', calTradingDay: false, holBusinessDay: true, truth: 'HOLIDAY', calSafety: 'CONSERVATIVE', holSafety: 'UNSAFE', note: '연말 폐장 — krxHolidays 누락' },
  // All of 2027 is absent from krxTradingCalendar (hardcoded 2026 only).
  // calendar treats every 2027 weekday holiday as a TRADING day → UNSAFE.
  { date: '2027-01-01', calTradingDay: true, holBusinessDay: false, truth: 'HOLIDAY', calSafety: 'UNSAFE', holSafety: 'CONSERVATIVE', note: '신정 — krxTradingCalendar 2027 미수록' },
  { date: '2027-02-08', calTradingDay: true, holBusinessDay: false, truth: 'HOLIDAY', calSafety: 'UNSAFE', holSafety: 'CONSERVATIVE', note: '설날 연휴' },
  { date: '2027-03-01', calTradingDay: true, holBusinessDay: false, truth: 'HOLIDAY', calSafety: 'UNSAFE', holSafety: 'CONSERVATIVE', note: '삼일절' },
  { date: '2027-05-05', calTradingDay: true, holBusinessDay: false, truth: 'HOLIDAY', calSafety: 'UNSAFE', holSafety: 'CONSERVATIVE', note: '어린이날' },
  { date: '2027-05-12', calTradingDay: true, holBusinessDay: false, truth: 'HOLIDAY', calSafety: 'UNSAFE', holSafety: 'CONSERVATIVE', note: '부처님 오신 날' },
  { date: '2027-09-14', calTradingDay: true, holBusinessDay: false, truth: 'HOLIDAY', calSafety: 'UNSAFE', holSafety: 'CONSERVATIVE', note: '추석 연휴' },
  { date: '2027-09-15', calTradingDay: true, holBusinessDay: false, truth: 'HOLIDAY', calSafety: 'UNSAFE', holSafety: 'CONSERVATIVE', note: '추석' },
  { date: '2027-09-16', calTradingDay: true, holBusinessDay: false, truth: 'HOLIDAY', calSafety: 'UNSAFE', holSafety: 'CONSERVATIVE', note: '추석 연휴' },
];

describe('calendarSsot characterization — two independent isKrxHoliday ledgers', () => {
  describe('A. ledgers are currently independent and both export isKrxHoliday', () => {
    it('calendar ledger hardcodes 2026 only (2027 unknown)', () => {
      // 2026 holiday known
      expect(calIsKrxHoliday('2026-01-01')).toBe(true);
      // 2027 entirely unknown to calendar ledger
      expect(calIsKrxHoliday('2027-01-01')).toBe(false);
    });

    it('krxHolidays ledger covers 2026 AND 2027 via STATIC set', () => {
      expect(holIsKrxHoliday('2026-01-01')).toBe(true);
      expect(holIsKrxHoliday('2027-01-01')).toBe(true);
    });
  });

  describe('B. EFFECTIVE trading-day divergences are locked (golden)', () => {
    it('exactly the documented dates diverge in 2024..2027 weekdays', () => {
      const found: string[] = [];
      let cursor = new Date('2024-01-01T00:00:00.000Z');
      const end = new Date('2027-12-31T00:00:00.000Z');
      while (cursor <= end) {
        const k = cursor.toISOString().slice(0, 10);
        if (calIsKrxTradingDay(k) !== holIsKrxBusinessDay(k)) found.push(k);
        cursor = new Date(cursor.getTime() + 86_400_000);
      }
      expect(found).toEqual(EFFECTIVE_TRADING_DAY_DIVERGENCE.map((d) => d.date));
    });

    it.each(EFFECTIVE_TRADING_DAY_DIVERGENCE)(
      'locks $date (truth=$truth) — calTradingDay=$calTradingDay holBusinessDay=$holBusinessDay [$note]',
      ({ date, calTradingDay, holBusinessDay }) => {
        expect(calIsKrxTradingDay(date)).toBe(calTradingDay);
        expect(holIsKrxBusinessDay(date)).toBe(holBusinessDay);
      },
    );

    it('2026-12-31 (연말 폐장): calendar=holiday, krxHolidays=trading-day (krxHolidays is UNSAFE here)', () => {
      expect(calIsKrxHoliday('2026-12-31')).toBe(true);
      expect(calIsKrxTradingDay('2026-12-31')).toBe(false);
      expect(holIsKrxHoliday('2026-12-31')).toBe(false);
      expect(holIsKrxBusinessDay('2026-12-31')).toBe(true);
    });
  });

  describe('C. AGREEMENT samples (must stay 0-regression after unification)', () => {
    // Ordinary weekdays — both report trading day.
    it.each(['2026-05-04', '2026-05-06', '2026-07-01', '2027-07-01', '2026-04-30'])(
      'both agree %s is a trading day',
      (d) => {
        expect(calIsKrxTradingDay(d)).toBe(true);
        expect(holIsKrxBusinessDay(d)).toBe(true);
      },
    );

    // Weekends — both reject regardless of holiday tables.
    it.each(['2026-05-02', '2026-05-03', '2026-06-06', '2026-08-15', '2027-01-02'])(
      'both agree %s is NOT a trading day (weekend)',
      (d) => {
        expect(calIsKrxTradingDay(d)).toBe(false);
        expect(holIsKrxBusinessDay(d)).toBe(false);
      },
    );

    // 2026 weekday holidays both ledgers know.
    it.each(['2026-01-01', '2026-02-16', '2026-02-17', '2026-02-18', '2026-05-01', '2026-05-05', '2026-05-25', '2026-06-03', '2026-08-17', '2026-09-24', '2026-09-25', '2026-10-05', '2026-10-09', '2026-12-25'])(
      'both agree %s is a 2026 weekday holiday (NOT a trading day)',
      (d) => {
        expect(calIsKrxTradingDay(d)).toBe(false);
        expect(holIsKrxBusinessDay(d)).toBe(false);
      },
    );
  });

  describe('D. STATIC ledger holiday-set snapshot (provenance lock)', () => {
    it('krxHolidays STATIC set 2026 weekday holidays superset of calendar 2026 (minus 12/31)', () => {
      const stat = getStaticKrxHolidays();
      // krxHolidays additionally encodes weekend-falling holidays (03/01, 06/06, 08/15, 09/26, 10/03)
      // and the 대체공휴일 logic; calendar omits weekend ones and adds 12/31.
      expect(stat.has('2026-03-01')).toBe(true); // 삼일절 (Sun) — calendar omits
      expect(stat.has('2026-12-31')).toBe(false); // 연말 폐장 — STATIC omits (the gap)
    });
  });
});
