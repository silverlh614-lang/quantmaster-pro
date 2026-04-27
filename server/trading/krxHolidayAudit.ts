/**
 * @responsibility KRX 차년도 휴장일 등록 감사 — 매년 12/1 cron 호출, 미등록 시 텔레그램 CRITICAL (ADR-0045)
 *
 * 운영자가 차년도 KRX 휴장일을 등록할 시간을 1개월 앞당겨 확보.
 * 차년도 휴장일 ≥ 8개 (한국 평균 공휴일 최소치) 등록되어 있으면 OK silent.
 * 미달 시 CRITICAL 경보 + dedupeKey 연도별 분리 (2026 알림 후 2027 12/1 재발송 가능).
 */

import { KRX_HOLIDAYS } from './krxHolidays.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';

/** 한국 공휴일 평균 최소치 — 신정/삼일절/어린이날/현충일/광복절/개천절/한글날/성탄절 = 8. */
const MIN_NEXT_YEAR_HOLIDAYS = 8;

const KST_OFFSET_MS = 9 * 3_600_000;

export type KrxHolidayAuditReason =
  | 'NEXT_YEAR_REGISTERED'
  | 'NEXT_YEAR_INSUFFICIENT'
  | 'NEXT_YEAR_MISSING';

export interface KrxHolidayAuditResult {
  alerted: boolean;
  reason: KrxHolidayAuditReason;
  registeredYears: number[];
  nextYear: number;
  nextYearHolidayCount: number;
  message?: string;
}

/**
 * 활성 KRX_HOLIDAYS Set 에서 등록 연도 목록 추출 (정렬·중복 제거).
 */
export function getRegisteredYears(holidays: ReadonlySet<string> = KRX_HOLIDAYS): number[] {
  const years = new Set<number>();
  for (const ymd of holidays) {
    const y = parseInt(ymd.slice(0, 4), 10);
    if (Number.isFinite(y)) years.add(y);
  }
  return Array.from(years).sort((a, b) => a - b);
}

/**
 * 특정 연도 휴장일 개수 카운트.
 */
export function countHolidaysInYear(year: number, holidays: ReadonlySet<string> = KRX_HOLIDAYS): number {
  let count = 0;
  const prefix = `${year}-`;
  for (const ymd of holidays) {
    if (ymd.startsWith(prefix)) count += 1;
  }
  return count;
}

/**
 * 매년 12/1 cron 진입점.
 *
 * 차년도 휴장일 ≥ MIN_NEXT_YEAR_HOLIDAYS 이면 silent (alerted=false).
 * 미달 시 텔레그램 CRITICAL 경보 발송.
 *
 * dedupeKey: `krx-holiday-audit:{nextYear}` — 연도별 분리.
 */
export async function runKrxHolidayAudit(now: Date = new Date()): Promise<KrxHolidayAuditResult> {
  const kstNow = new Date(now.getTime() + KST_OFFSET_MS);
  const currentYear = kstNow.getUTCFullYear();
  const nextYear = currentYear + 1;

  const registeredYears = getRegisteredYears();
  const nextYearHolidayCount = countHolidaysInYear(nextYear);

  const registered = nextYearHolidayCount >= MIN_NEXT_YEAR_HOLIDAYS;

  if (registered) {
    return {
      alerted: false,
      reason: 'NEXT_YEAR_REGISTERED',
      registeredYears,
      nextYear,
      nextYearHolidayCount,
    };
  }

  const reason: KrxHolidayAuditReason =
    nextYearHolidayCount === 0 ? 'NEXT_YEAR_MISSING' : 'NEXT_YEAR_INSUFFICIENT';

  const message = formatAuditMessage({
    nextYear,
    nextYearHolidayCount,
    minRequired: MIN_NEXT_YEAR_HOLIDAYS,
    registeredYears,
  });

  try {
    await sendTelegramAlert(message, {
      priority: 'CRITICAL',
      tier: 'T1_ALARM',
      category: 'krx_holiday_audit',
      dedupeKey: `krx-holiday-audit:${nextYear}`,
      cooldownMs: 365 * 24 * 3_600_000, // 1년 — 같은 연도 재발송 차단
    });
  } catch (e: unknown) {
    console.error('[KrxHolidayAudit] 텔레그램 발송 실패:', e instanceof Error ? e.message : e);
  }

  return {
    alerted: true,
    reason,
    registeredYears,
    nextYear,
    nextYearHolidayCount,
    message,
  };
}

/**
 * 텔레그램 메시지 포맷터 — 단위 테스트용 export.
 */
export function formatAuditMessage(params: {
  nextYear: number;
  nextYearHolidayCount: number;
  minRequired: number;
  registeredYears: number[];
}): string {
  const { nextYear, nextYearHolidayCount, minRequired, registeredYears } = params;
  const yearsStr = registeredYears.length > 0 ? registeredYears.join(', ') : '없음';
  return [
    `🚨 <b>[KRX 휴장일 감사]</b>`,
    `${nextYear}년 휴장일 등록 부족: <b>${nextYearHolidayCount}건</b> (최소 ${minRequired}건 필요)`,
    `현재 등록 연도: ${yearsStr}`,
    '',
    '<b>조치 방법</b>:',
    '1. KRX 공식 휴장일 캘린더 확인: https://www.krx.co.kr',
    '2. <code>data/krx-holiday-patch.json</code> 직접 편집 또는 코드 PR.',
    '3. 서버 재시작 후 자동 반영 (또는 reloadKrxHolidaySet() 호출).',
    '',
    `<i>* 미등록 상태로 ${nextYear}년 진입 시 자기반성/스케줄러/연휴 정책 모두 무력화 위험.</i>`,
  ].join('\n');
}
