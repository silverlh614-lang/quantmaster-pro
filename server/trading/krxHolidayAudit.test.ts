/**
 * @responsibility krxHolidayAudit 회귀 테스트 — 차년도 검증 + 알림 분기 (ADR-0045 PR-D)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getRegisteredYears,
  countHolidaysInYear,
  formatAuditMessage,
} from './krxHolidayAudit.js';

describe('getRegisteredYears + countHolidaysInYear', () => {
  it('STATIC_HOLIDAYS 기준 2026, 2027 등록', async () => {
    const years = getRegisteredYears();
    expect(years).toContain(2026);
    expect(years).toContain(2027);
  });

  it('countHolidaysInYear(2026) — 8개 이상', () => {
    expect(countHolidaysInYear(2026)).toBeGreaterThanOrEqual(8);
  });

  it('countHolidaysInYear(2099) — 0', () => {
    expect(countHolidaysInYear(2099)).toBe(0);
  });

  it('Custom Set 입력 시 그 Set 만 검사', () => {
    const custom = new Set(['2030-01-01', '2030-05-05']);
    expect(getRegisteredYears(custom)).toEqual([2030]);
    expect(countHolidaysInYear(2030, custom)).toBe(2);
  });
});

describe('formatAuditMessage', () => {
  it('CRITICAL 메시지에 차년도 + 부족 카운트 포함', () => {
    const msg = formatAuditMessage({
      nextYear: 2028,
      nextYearHolidayCount: 0,
      minRequired: 8,
      registeredYears: [2026, 2027],
    });
    expect(msg).toContain('2028년 휴장일 등록 부족');
    expect(msg).toContain('0건');
    expect(msg).toContain('최소 8건');
    expect(msg).toContain('2026, 2027');
    expect(msg).toContain('krx-holiday-patch.json');
  });

  it('등록 연도가 비어있으면 "없음"', () => {
    const msg = formatAuditMessage({
      nextYear: 2028,
      nextYearHolidayCount: 0,
      minRequired: 8,
      registeredYears: [],
    });
    expect(msg).toContain('현재 등록 연도: 없음');
  });
});

describe('runKrxHolidayAudit — 분기 시나리오', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('../alerts/telegramClient.js');
    vi.doUnmock('./krxHolidays.js');
  });

  it('차년도 ≥ 8개 등록 → silent (alerted=false)', async () => {
    const sendMock = vi.fn().mockResolvedValue(undefined);
    vi.doMock('../alerts/telegramClient.js', () => ({
      sendTelegramAlert: sendMock,
    }));
    // 실제 KRX_HOLIDAYS 사용 — 2026 8개, 2027 8개 등록되어 있다.
    const { runKrxHolidayAudit } = await import('./krxHolidayAudit.js');
    // now = 2026-12-01 KST → nextYear = 2027 (≥ 8개 등록)
    const now = new Date(Date.UTC(2026, 10, 30, 15, 0, 0)); // 11/30 15:00 UTC = 12/1 00:00 KST
    const res = await runKrxHolidayAudit(now);
    expect(res.alerted).toBe(false);
    expect(res.reason).toBe('NEXT_YEAR_REGISTERED');
    expect(res.nextYear).toBe(2027);
    expect(res.nextYearHolidayCount).toBeGreaterThanOrEqual(8);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('차년도 < 8개 → alerted=true + CRITICAL 텔레그램', async () => {
    const sendMock = vi.fn().mockResolvedValue(undefined);
    vi.doMock('../alerts/telegramClient.js', () => ({
      sendTelegramAlert: sendMock,
    }));
    const { runKrxHolidayAudit } = await import('./krxHolidayAudit.js');
    // now = 2027-12-01 KST → nextYear = 2028 (0개 등록)
    const now = new Date(Date.UTC(2027, 10, 30, 15, 0, 0));
    const res = await runKrxHolidayAudit(now);
    expect(res.alerted).toBe(true);
    expect(res.reason).toBe('NEXT_YEAR_MISSING');
    expect(res.nextYear).toBe(2028);
    expect(res.nextYearHolidayCount).toBe(0);
    expect(sendMock).toHaveBeenCalledOnce();

    const [msg, opts] = sendMock.mock.calls[0];
    expect(msg).toContain('2028년 휴장일');
    expect(opts.priority).toBe('CRITICAL');
    expect(opts.tier).toBe('T1_ALARM');
    expect(opts.category).toBe('krx_holiday_audit');
    expect(opts.dedupeKey).toBe('krx-holiday-audit:2028');
  });

  it('차년도 1~7개 (insufficient) → reason=NEXT_YEAR_INSUFFICIENT', async () => {
    const sendMock = vi.fn().mockResolvedValue(undefined);
    vi.doMock('../alerts/telegramClient.js', () => ({
      sendTelegramAlert: sendMock,
    }));
    // patch 로 차년도 5개만 등록
    process.env.PERSIST_DATA_DIR = '__test_insufficient_audit__';
    // 실제 patch 적용 없이 테스트하려면 KRX_HOLIDAYS mock 필요
    vi.doMock('./krxHolidays.js', () => ({
      KRX_HOLIDAYS: new Set([
        '2028-01-01', '2028-02-01', '2028-03-01', '2028-04-01', '2028-05-01',
        // 5개 — 8개 미달
      ]),
    }));
    const { runKrxHolidayAudit } = await import('./krxHolidayAudit.js');
    const now = new Date(Date.UTC(2027, 10, 30, 15, 0, 0));
    const res = await runKrxHolidayAudit(now);
    expect(res.alerted).toBe(true);
    expect(res.reason).toBe('NEXT_YEAR_INSUFFICIENT');
    expect(res.nextYearHolidayCount).toBe(5);
  });

  it('telegramClient throw → alerted=true + result 보존 (audit 자체 실패 안 함)', async () => {
    const sendMock = vi.fn().mockRejectedValue(new Error('Telegram 401'));
    vi.doMock('../alerts/telegramClient.js', () => ({
      sendTelegramAlert: sendMock,
    }));
    vi.doMock('./krxHolidays.js', () => ({
      KRX_HOLIDAYS: new Set<string>(), // 0개 등록
    }));
    const { runKrxHolidayAudit } = await import('./krxHolidayAudit.js');
    const now = new Date(Date.UTC(2027, 10, 30, 15, 0, 0));
    const res = await runKrxHolidayAudit(now);
    expect(res.alerted).toBe(true);
    expect(res.reason).toBe('NEXT_YEAR_MISSING');
  });
});
