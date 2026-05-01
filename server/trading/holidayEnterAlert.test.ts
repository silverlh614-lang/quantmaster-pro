/**
 * @responsibility holidayEnterAlert 회귀 테스트 (ADR-0132)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  formatHolidayEnterMessage,
  HOLIDAY_ENTER_GAP_DAYS,
} from './holidayEnterAlert.js';

describe('formatHolidayEnterMessage — 텍스트 포맷', () => {
  it('정상 LONG_HOLIDAY 진입 메시지 — 본일·내일·다음 영업일·gap 모두 포함', () => {
    const msg = formatHolidayEnterMessage('2026-04-30', '2026-05-04', 3);
    expect(msg).toContain('🌙');
    expect(msg).toContain('[휴장 진입 직전 알림]');
    expect(msg).toContain('2026-04-30');
    expect(msg).toContain('<b>3일</b>');
    expect(msg).toContain('2026-05-01'); // 휴장 첫날 = 내일
    expect(msg).toContain('2026-05-04'); // 다음 거래일
    expect(msg).toContain('09:00 KST');
    expect(msg).toContain('자동 SKIP');
    expect(msg).toContain('연휴 복귀 보수 모드');
  });

  it('추석 7일 연휴 진입 메시지 — gap=7 표기', () => {
    const msg = formatHolidayEnterMessage('2026-09-23', '2026-09-29', 5);
    expect(msg).toContain('<b>5일</b>');
    expect(msg).toContain('2026-09-29');
    // 내일 = 2026-09-24
    expect(msg).toContain('2026-09-24');
  });

  it('상수 SSOT — HOLIDAY_ENTER_GAP_DAYS=3', () => {
    expect(HOLIDAY_ENTER_GAP_DAYS).toBe(3);
  });
});

describe('runHolidayEnterAlert — 활성 조건 분기', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.HOLIDAY_ENTER_ALERT_DISABLED;
  });

  afterEach(() => {
    vi.doUnmock('../alerts/telegramClient.js');
    vi.doUnmock('../utils/marketDayClassifier.js');
    delete process.env.HOLIDAY_ENTER_ALERT_DISABLED;
  });

  it('HOLIDAY_ENTER_ALERT_DISABLED=true → silent (reason=disabled)', async () => {
    process.env.HOLIDAY_ENTER_ALERT_DISABLED = 'true';
    const sendMock = vi.fn().mockResolvedValue(undefined);
    vi.doMock('../alerts/telegramClient.js', () => ({
      sendTelegramAlert: sendMock,
    }));
    const { runHolidayEnterAlert } = await import('./holidayEnterAlert.js');
    const res = await runHolidayEnterAlert();
    expect(res.sent).toBe(false);
    expect(res.reason).toBe('disabled');
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('비영업일 (휴장 본일) → silent (reason=inactive)', async () => {
    const sendMock = vi.fn().mockResolvedValue(undefined);
    vi.doMock('../alerts/telegramClient.js', () => ({
      sendTelegramAlert: sendMock,
    }));
    // marketDayClassifier mock — 휴장 본일 (isTradingDay=false)
    vi.doMock('../utils/marketDayClassifier.js', () => ({
      getMarketDayContext: vi.fn(() => ({
        date: '2026-05-01',
        type: 'KRX_HOLIDAY',
        isTradingDay: false,
        nextTradingDay: '2026-05-04',
        prevTradingDay: '2026-04-30',
        isLongHoliday: true,
      })),
    }));
    const { runHolidayEnterAlert } = await import('./holidayEnterAlert.js');
    const res = await runHolidayEnterAlert();
    expect(res.sent).toBe(false);
    expect(res.reason).toBe('inactive');
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('단순 평일+주말 (gap=2) → silent (reason=inactive, nonTradingGap=2)', async () => {
    const sendMock = vi.fn().mockResolvedValue(undefined);
    vi.doMock('../alerts/telegramClient.js', () => ({
      sendTelegramAlert: sendMock,
    }));
    // 금요일 본일 + 다음 영업일 = 월요일 (gap=2 = 토/일)
    vi.doMock('../utils/marketDayClassifier.js', () => ({
      getMarketDayContext: vi.fn((dateYmd?: string) => {
        if (dateYmd === '2026-04-25') {
          // 토요일 (금 본일 + 1)
          return {
            date: '2026-04-25',
            type: 'WEEKEND',
            isTradingDay: false,
            nextTradingDay: '2026-04-27',
            prevTradingDay: '2026-04-24',
            isLongHoliday: false,
          };
        }
        // 본일 = 4/24 금요일
        return {
          date: '2026-04-24',
          type: 'TRADING_DAY',
          isTradingDay: true,
          nextTradingDay: '2026-04-24',
          prevTradingDay: '2026-04-24',
          isLongHoliday: false,
        };
      }),
    }));
    const { runHolidayEnterAlert } = await import('./holidayEnterAlert.js');
    const res = await runHolidayEnterAlert();
    expect(res.sent).toBe(false);
    expect(res.reason).toBe('inactive');
    expect(res.nonTradingGap).toBe(2); // 토/일 = 2
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('LONG_HOLIDAY 진입 (gap=3, 4/30 목→5/4 월) → 발송 + 메시지 형식', async () => {
    const sendMock = vi.fn().mockResolvedValue(undefined);
    vi.doMock('../alerts/telegramClient.js', () => ({
      sendTelegramAlert: sendMock,
    }));
    vi.doMock('../utils/marketDayClassifier.js', () => ({
      getMarketDayContext: vi.fn((dateYmd?: string) => {
        if (dateYmd === '2026-05-01') {
          // 내일 = 5/1 근로자의 날 (KRX 공휴일)
          return {
            date: '2026-05-01',
            type: 'LONG_HOLIDAY_START',
            isTradingDay: false,
            nextTradingDay: '2026-05-04',
            prevTradingDay: '2026-04-30',
            isLongHoliday: true,
          };
        }
        // 본일 = 4/30 목요일 영업일
        return {
          date: '2026-04-30',
          type: 'PRE_HOLIDAY',
          isTradingDay: true,
          nextTradingDay: '2026-04-30',
          prevTradingDay: '2026-04-30',
          isLongHoliday: false,
        };
      }),
    }));
    const { runHolidayEnterAlert } = await import('./holidayEnterAlert.js');
    const res = await runHolidayEnterAlert();
    expect(res.sent).toBe(true);
    expect(res.reason).toBe('sent');
    expect(res.nonTradingGap).toBe(3); // 5/1 금 + 5/2 토 + 5/3 일
    expect(sendMock).toHaveBeenCalledOnce();
    const [message, opts] = sendMock.mock.calls[0];
    expect(message).toContain('🌙');
    expect(message).toContain('2026-04-30');
    expect(message).toContain('2026-05-04');
    expect(message).toContain('<b>3일</b>');
    // dedupeKey 형식 검증
    expect(opts).toMatchObject({
      priority: 'HIGH',
      tier: 'T2_REPORT',
      category: 'holiday_enter',
      dedupeKey: 'holiday-enter:2026-05-04',
      cooldownMs: 24 * 3_600_000,
    });
  });

  it('telegramClient throw → reason=error + console.error (graceful)', async () => {
    const sendMock = vi.fn().mockRejectedValue(new Error('Telegram API 401'));
    vi.doMock('../alerts/telegramClient.js', () => ({
      sendTelegramAlert: sendMock,
    }));
    vi.doMock('../utils/marketDayClassifier.js', () => ({
      getMarketDayContext: vi.fn((dateYmd?: string) => {
        if (dateYmd === '2026-09-24') {
          return {
            date: '2026-09-24',
            type: 'LONG_HOLIDAY_START',
            isTradingDay: false,
            nextTradingDay: '2026-09-29',
            prevTradingDay: '2026-09-23',
            isLongHoliday: true,
          };
        }
        return {
          date: '2026-09-23',
          type: 'PRE_HOLIDAY',
          isTradingDay: true,
          nextTradingDay: '2026-09-23',
          prevTradingDay: '2026-09-23',
          isLongHoliday: false,
        };
      }),
    }));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { runHolidayEnterAlert } = await import('./holidayEnterAlert.js');
    const res = await runHolidayEnterAlert();
    expect(res.sent).toBe(false);
    expect(res.reason).toBe('error');
    expect(res.message).toContain('Telegram API 401');
    expect(sendMock).toHaveBeenCalledOnce();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('추석 7일 연휴 진입 (gap≥3) → 발송', async () => {
    const sendMock = vi.fn().mockResolvedValue(undefined);
    vi.doMock('../alerts/telegramClient.js', () => ({
      sendTelegramAlert: sendMock,
    }));
    // 본일 9/23 수요일 + 9/24~9/28 휴장 + 다음 영업일 9/29 화
    vi.doMock('../utils/marketDayClassifier.js', () => ({
      getMarketDayContext: vi.fn((dateYmd?: string) => {
        if (dateYmd === '2026-09-24') {
          return {
            date: '2026-09-24',
            type: 'LONG_HOLIDAY_START',
            isTradingDay: false,
            nextTradingDay: '2026-09-29',
            prevTradingDay: '2026-09-23',
            isLongHoliday: true,
          };
        }
        return {
          date: '2026-09-23',
          type: 'PRE_HOLIDAY',
          isTradingDay: true,
          nextTradingDay: '2026-09-23',
          prevTradingDay: '2026-09-23',
          isLongHoliday: false,
        };
      }),
    }));
    const { runHolidayEnterAlert } = await import('./holidayEnterAlert.js');
    const res = await runHolidayEnterAlert();
    expect(res.sent).toBe(true);
    expect(res.nonTradingGap).toBe(5); // 9/24 9/25 9/26 9/27 9/28 = 5일
    expect(sendMock).toHaveBeenCalledOnce();
    const [, opts] = sendMock.mock.calls[0];
    expect(opts.dedupeKey).toBe('holiday-enter:2026-09-29');
  });
});
