/**
 * @responsibility 연휴 복귀 보수 매매 모드 텔레그램 알림 — 09:00 KST 평일 cron 실행 (ADR-0044)
 *
 * 활성 정책 시 1회 텔레그램 발송. dedupeKey + 24h cooldown 으로 동일 일자 중복 차단.
 * 비활성 시 silent return (KRX 공휴일 / 비영업일 / 만료 시각 후 모두 silent).
 *
 * cron 등록 위치: server/scheduler/alertJobs.ts (PR-C)
 */

import { getMarketDayContext } from '../utils/marketDayClassifier.js';
import { resolveHolidayResumePolicyForContext } from './holidayResumePolicy.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';

export interface HolidayResumeAlertResult {
  sent: boolean;
  reason?: 'inactive' | 'sent' | 'error';
  message?: string;
}

/**
 * 활성 정책 텔레그램 알림 발송. cron 호출자.
 * 비활성 시 sent=false + reason='inactive' 반환 (silent — 채팅 노이즈 차단).
 */
export async function runHolidayResumeAlert(
  now: Date = new Date(),
): Promise<HolidayResumeAlertResult> {
  const ctx = getMarketDayContext();
  const policy = resolveHolidayResumePolicyForContext(ctx, now);

  if (!policy) {
    return { sent: false, reason: 'inactive' };
  }

  const message = formatHolidayResumeMessage(ctx.date, policy);

  try {
    await sendTelegramAlert(message, {
      priority: 'HIGH',
      tier: 'T2_REPORT',
      category: 'holiday_resume',
      dedupeKey: `holiday-resume:${ctx.date}`,
      cooldownMs: 24 * 3_600_000,
    });
    return { sent: true, reason: 'sent', message };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[HolidayResumeAlert] 텔레그램 발송 실패:', msg);
    return { sent: false, reason: 'error', message: msg };
  }
}

/**
 * 텔레그램 메시지 포맷터 — 단위 테스트 가능하도록 별도 export.
 */
export function formatHolidayResumeMessage(
  dateKst: string,
  policy: ReturnType<typeof resolveHolidayResumePolicyForContext>,
): string {
  if (!policy) return '';

  const lines: string[] = [
    '📅 <b>[연휴 복귀 보수 매매 모드]</b>',
    `오늘(${dateKst})은 ${policy.reason} 입니다.`,
    `• Kelly 사이징: <b>${(policy.kellyMultiplier * 100).toFixed(0)}%</b> 추가 축소`,
    `• Gate 임계값: <b>+${policy.gateScoreBoost}</b> 상향`,
    `• 시초 진입 차단: <b>${policy.marketOpenDelayMin}분</b> (${marketOpenCutoff(policy.marketOpenDelayMin)} KST 까지 관찰)`,
  ];

  if (policy.expirationKstTime) {
    lines.push(`• 정책 만료: <b>${policy.expirationKstTime}</b> KST`);
  }

  lines.push('');
  lines.push('<i>* PR-C 본 PR 은 정책 SSOT + 알림만. 매매 wiring 은 후속 PR-C-2.</i>');
  return lines.join('\n');
}

/** 09:00 KST + delayMin → 'HH:MM' 절단 시각 (60분 이상 안전). */
function marketOpenCutoff(delayMin: number): string {
  const h = 9 + Math.floor(delayMin / 60);
  const m = delayMin % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
