/**
 * @responsibility Golden-master characterization of the unified KRX holiday SSOT — krxTradingCalendar now delegates to krxHolidays (ADR-0559).
 *
 * POST-UNIFICATION characterization harness. ADR-0559 dissolved the former dual-ledger
 * divergence: `krxTradingCalendar.isKrxHoliday` now re-exports `krxHolidays.isKrxHoliday`
 * (single data SSOT — STATIC ∪ patch ∪ ADR-0548 KIS sync). LIVE order gating
 * (휴장일 → liveOrderAllowed) consults krxTradingCalendar, so it now sees the complete
 * 2027 holiday set + 2026-12-31 (year-end close).
 *
 * Both `isKrxHoliday` symbols resolve to the same data; both trading-day predicates
 * (calendar.isKrxTradingDay / krxHolidays.isKrxBusinessDay) now AGREE on every weekday.
 *
 * LIVE-path note: the entry/preflight gate (signalScanner/preflight.ts → r3Countability →
 * resolveMarketSessionState) and buyPipeline.ts consult krxTradingCalendar.isKrxTradingDay.
 * After ADR-0559 this path is fed by the unified SSOT, closing the 2027/연말폐장 order-window gap.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * UNIFICATION ACCEPTANCE CRITERIA (5 lines — satisfied by ADR-0559 implementation):
 *  1. Single ledger adopted; every consumer (incl. LIVE buyPipeline/preflight) routes through it. ✓
 *  2. Divergences resolved SAFE-DIRECTION ONLY: add missing holidays (more conservative);
 *     never reclassify a true trading day into a holiday (would silently drop trades). ✓ (0 such cases)
 *  3. 2026-12-31 (연말 폐장) is a holiday in the unified ledger. ✓
 *  4. Dates where both ledgers already AGREE keep golden output unchanged (zero regression). ✓
 *  5. liveOrderAllowed path stays byte-equivalent OR changes only toward the safer direction
 *     (휴장일에 주문이 열리던 구멍을 닫는 변경만 허용). ✓
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
 * ADR-0559 RESOLVED divergences — formerly EFFECTIVE_TRADING_DAY_DIVERGENCE.
 *
 * Before unification these 9 weekday dates diverged (calendar.isKrxTradingDay !==
 * krxHolidays.isKrxBusinessDay). After delegating calendar's holiday data to the
 * krxHolidays SSOT they ALL agree as HOLIDAY (both ledgers reject them now).
 *
 * Every resolution is SAFE-DIRECTION ONLY:
 *   - 8x 2027 weekday holidays: calendar previously saw them as TRADING (UNSAFE — order
 *     window open on a closed day) → now HOLIDAY (closed). Gate gap closed.
 *   - 2026-12-31 year-end close: krxHolidays previously saw it as TRADING (UNSAFE) → now
 *     HOLIDAY (STATIC_HOLIDAYS gained '2026-12-31').
 *
 * truth=TRADING reclassified to HOLIDAY = 0 (no real trading day was silently dropped).
 */
const RESOLVED_DIVERGENCE: ReadonlyArray<{
  date: string;
  truth: 'HOLIDAY' | 'TRADING';
  note: string;
}> = [
  { date: '2026-12-31', truth: 'HOLIDAY', note: '연말 폐장 — krxHolidays STATIC 보강 (was UNSAFE on hol)' },
  { date: '2027-01-01', truth: 'HOLIDAY', note: '신정 — calendar 위임으로 2027 인식 (was UNSAFE on cal)' },
  { date: '2027-02-08', truth: 'HOLIDAY', note: '설날 연휴 (was UNSAFE on cal)' },
  { date: '2027-03-01', truth: 'HOLIDAY', note: '삼일절 (was UNSAFE on cal)' },
  { date: '2027-05-05', truth: 'HOLIDAY', note: '어린이날 (was UNSAFE on cal)' },
  { date: '2027-05-12', truth: 'HOLIDAY', note: '부처님 오신 날 (was UNSAFE on cal)' },
  { date: '2027-09-14', truth: 'HOLIDAY', note: '추석 연휴 (was UNSAFE on cal)' },
  { date: '2027-09-15', truth: 'HOLIDAY', note: '추석 (was UNSAFE on cal)' },
  { date: '2027-09-16', truth: 'HOLIDAY', note: '추석 연휴 (was UNSAFE on cal)' },
];

describe('calendarSsot characterization — unified isKrxHoliday SSOT (ADR-0559)', () => {
  describe('A. calendar now delegates holiday data to the krxHolidays SSOT', () => {
    it('calendar ledger now recognizes 2027 (delegated, no longer 2026-only)', () => {
      // 2026 holiday still known
      expect(calIsKrxHoliday('2026-01-01')).toBe(true);
      // ADR-0559: 2027 now visible to calendar via delegation (was false pre-unification)
      expect(calIsKrxHoliday('2027-01-01')).toBe(true);
    });

    it('krxHolidays ledger covers 2026 AND 2027 via STATIC set', () => {
      expect(holIsKrxHoliday('2026-01-01')).toBe(true);
      expect(holIsKrxHoliday('2027-01-01')).toBe(true);
    });

    it('both isKrxHoliday symbols resolve to the SAME data (divergence structurally dissolved)', () => {
      // Full 2024..2027 sweep: the two holiday predicates must agree on every date.
      const mismatches: string[] = [];
      let cursor = new Date('2024-01-01T00:00:00.000Z');
      const end = new Date('2027-12-31T00:00:00.000Z');
      while (cursor <= end) {
        const k = cursor.toISOString().slice(0, 10);
        if (calIsKrxHoliday(k) !== holIsKrxHoliday(k)) mismatches.push(k);
        cursor = new Date(cursor.getTime() + 86_400_000);
      }
      expect(mismatches).toEqual([]);
    });
  });

  describe('B. EFFECTIVE trading-day divergences are now RESOLVED (golden, post-unification)', () => {
    it('zero effective divergences remain in 2024..2027 weekdays (was 9)', () => {
      const found: string[] = [];
      let cursor = new Date('2024-01-01T00:00:00.000Z');
      const end = new Date('2027-12-31T00:00:00.000Z');
      while (cursor <= end) {
        const k = cursor.toISOString().slice(0, 10);
        if (calIsKrxTradingDay(k) !== holIsKrxBusinessDay(k)) found.push(k);
        cursor = new Date(cursor.getTime() + 86_400_000);
      }
      // ADR-0559: divergence array is now empty — calendar.isKrxTradingDay and
      // krxHolidays.isKrxBusinessDay agree on every date.
      expect(found).toEqual([]);
    });

    it.each(RESOLVED_DIVERGENCE)(
      'resolves $date (truth=$truth) — both ledgers now HOLIDAY [$note]',
      ({ date }) => {
        // ADR-0559 safe-direction: all 9 formerly-diverging weekdays are now HOLIDAY in
        // BOTH ledgers (calendar trading-day=false, krxHolidays business-day=false).
        expect(calIsKrxTradingDay(date)).toBe(false);
        expect(holIsKrxBusinessDay(date)).toBe(false);
        // Both holiday predicates agree (single SSOT).
        expect(calIsKrxHoliday(date)).toBe(true);
        expect(holIsKrxHoliday(date)).toBe(true);
      },
    );

    it('every RESOLVED_DIVERGENCE entry has truth=HOLIDAY (truth=TRADING→holiday reclassification = 0)', () => {
      // Safe-direction invariant: not one real trading day was reclassified into a holiday.
      expect(RESOLVED_DIVERGENCE.every((d) => d.truth === 'HOLIDAY')).toBe(true);
    });

    it('2026-12-31 (연말 폐장): now HOLIDAY in BOTH ledgers (krxHolidays gap closed)', () => {
      // Pre-unification krxHolidays treated 12/31 as a business day (UNSAFE). ADR-0559 added
      // '2026-12-31' to STATIC_HOLIDAYS, so both ledgers now reject it.
      expect(calIsKrxHoliday('2026-12-31')).toBe(true);
      expect(calIsKrxTradingDay('2026-12-31')).toBe(false);
      expect(holIsKrxHoliday('2026-12-31')).toBe(true);
      expect(holIsKrxBusinessDay('2026-12-31')).toBe(false);
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
    it('krxHolidays STATIC set encodes weekend holidays AND the year-end close (ADR-0559)', () => {
      const stat = getStaticKrxHolidays();
      // krxHolidays encodes weekend-falling holidays (03/01, 06/06, 08/15, 09/26, 10/03)
      // and the 대체공휴일 logic.
      expect(stat.has('2026-03-01')).toBe(true); // 삼일절 (Sun)
      // ADR-0559: STATIC now includes 2026-12-31 (was the gap that left krxHolidays UNSAFE).
      expect(stat.has('2026-12-31')).toBe(true); // 연말 폐장 — gap closed
      expect(stat.has('2027-12-31')).toBe(true); // 차년도 연말 폐장 정합
    });
  });
});
