/**
 * @responsibility 휴장 진입 직전 텔레그램 알림 — 평일 KST 15:15 cron, LONG_HOLIDAY 진입 시 1회 발송 (ADR-0132)
 *
 * `holidayResumeAlert.ts` 대칭 패턴. 본일 영업일 + nextTradingDay 까지 ≥ 3일 간격 시 활성.
 * 단순 평일+주말 (gap=2) 은 silent — 운영자 일상 인지 영역.
 * dedupeKey + 24h cooldown 으로 동일 휴장 중복 차단.
 *
 * cron 등록 위치: server/scheduler/alertJobs.ts (ADR-0132)
 */

import { getMarketDayContext } from '../utils/marketDayClassifier.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';

const DAY_MS = 86_400_000;

/** LONG_HOLIDAY 임계 — marketDayClassifier 와 정합 (≥3일 비영업 간격). */
export const HOLIDAY_ENTER_GAP_DAYS = 3;

export interface HolidayEnterAlertResult {
  sent: boolean;
  reason?: 'inactive' | 'sent' | 'error' | 'disabled';
  message?: string;
  /** 진단 — 다음 영업일까지 비영업 간격 (영업일 본일 제외). */
  nonTradingGap?: number;
}

function isAlertDisabled(): boolean {
  return process.env.HOLIDAY_ENTER_ALERT_DISABLED === 'true';
}

function ymdToUtcMidnight(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function daysBetween(a: string, b: string): number {
  return Math.abs(Math.round((ymdToUtcMidnight(a) - ymdToUtcMidnight(b)) / DAY_MS));
}

/**
 * 활성 정책 텔레그램 알림 발송. cron 호출자 (KST 평일 15:15).
 * 비활성 시 sent=false + reason='inactive' 반환 (silent).
 *
 * 활성 조건:
 *  1. 본일 영업일 (cron 자체 평일 가드 — KRX 공휴일은 cron tick 자체 차단됨)
 *  2. 다음 영업일까지 비영업 간격 ≥ HOLIDAY_ENTER_GAP_DAYS (3일)
 *
 * 단순 금→월 (gap=2) 은 silent — 일반 주말 알림 차단.
 */
export async function runHolidayEnterAlert(
  _now: Date = new Date(),
): Promise<HolidayEnterAlertResult> {
  if (isAlertDisabled()) {
    return { sent: false, reason: 'disabled' };
  }

  const ctx = getMarketDayContext();

  // 활성 조건 1: 본일 영업일
  if (!ctx.isTradingDay) {
    return { sent: false, reason: 'inactive' };
  }

  // 활성 조건 2: 다음 영업일까지 비영업 간격 ≥ 3일
  // ctx.nextTradingDay 는 *본인* 영업일이면 본인 자기 자신 (today) 이라 나오므로,
  // 다음 영업일은 별도 산출 필요 — shift +1 후 marketDayClassifier 재호출.
  const tomorrow = new Date(ymdToUtcMidnight(ctx.date) + DAY_MS).toISOString().slice(0, 10);
  const tomorrowCtx = getMarketDayContext(tomorrow);
  const nextWorkday = tomorrowCtx.nextTradingDay;

  if (!nextWorkday) {
    return { sent: false, reason: 'inactive', nonTradingGap: 0 };
  }

  // 비영업 간격 = (다음 영업일 - 본일) - 1
  // 예: 본일 4/30 목 + 다음 영업일 5/4 월 → gap=4-1=3 (5/1 금/2 토/3 일 = 3일)
  const totalDays = daysBetween(nextWorkday, ctx.date);
  const nonTradingGap = totalDays - 1;

  if (nonTradingGap < HOLIDAY_ENTER_GAP_DAYS) {
    return { sent: false, reason: 'inactive', nonTradingGap };
  }

  const message = formatHolidayEnterMessage(ctx.date, nextWorkday, nonTradingGap);

  try {
    await sendTelegramAlert(message, {
      priority: 'HIGH',
      tier: 'T2_REPORT',
      category: 'holiday_enter',
      dedupeKey: `holiday-enter:${nextWorkday}`,
      cooldownMs: 24 * 3_600_000,
    });
    return { sent: true, reason: 'sent', message, nonTradingGap };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[HolidayEnterAlert] 텔레그램 발송 실패:', msg);
    return { sent: false, reason: 'error', message: msg, nonTradingGap };
  }
}

/**
 * 텔레그램 메시지 포맷터 — 단위 테스트 가능하도록 별도 export.
 */
export function formatHolidayEnterMessage(
  todayKst: string,
  nextTradingDay: string,
  nonTradingGap: number,
): string {
  const tomorrow = new Date(ymdToUtcMidnight(todayKst) + DAY_MS).toISOString().slice(0, 10);
  return [
    '🌙 <b>[휴장 진입 직전 알림]</b>',
    `오늘(${todayKst}) 장 마감 후 <b>${nonTradingGap}일</b> 휴장 시작.`,
    `• 휴장 첫날: <b>${tomorrow}</b>`,
    `• 다음 거래일: <b>${nextTradingDay}</b> 09:00 KST`,
    '',
    '<i>* 휴장 기간 동안 평일 cron 들이 자동 SKIP 됩니다 (정상 동작).</i>',
    '<i>* 다음 거래일 09:05 KST 에 연휴 복귀 보수 모드 알림 발송 예정.</i>',
  ].join('\n');
}
