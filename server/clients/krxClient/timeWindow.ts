// @responsibility krxClient 시간대 게이팅 — ADR-0256 (PRE_DAWN/LUNCH_BREAK/POST_CLOSE_PRE_PUBLISH)
/**
 * krxClient/timeWindow.ts — ADR-0502c 분해 SSOT.
 *
 * ADR-0256: 통계 무의미 / 미확정 시간대 호출 차단. 카운터 미누적 (ADR-0251 정합).
 *
 * 차단 시간대 (KST):
 *   - PRE_DAWN (00:00~05:59): 통계 확정 전, 호출 무의미
 *   - LUNCH_BREAK (11:31~12:59): 매수 차단 구간 (volumeClock 정합)
 *   - POST_CLOSE_PRE_PUBLISH (15:30~17:59): 장 마감 후 통계 미확정
 *
 * ENV `KRX_TIME_WINDOW_GATING_DISABLED=true` → 게이팅 비활성, 모든 시각 호출 허용.
 */

function isKrxTimeWindowGatingDisabled(): boolean {
  return process.env.KRX_TIME_WINDOW_GATING_DISABLED === 'true';
}

export function shouldSkipKrxCallByTimeWindow(now: Date = new Date()):
  { skip: boolean; reason?: 'PRE_DAWN' | 'LUNCH_BREAK' | 'POST_CLOSE_PRE_PUBLISH' } {
  if (isKrxTimeWindowGatingDisabled()) return { skip: false };
  const kstMs = now.getTime() + 9 * 60 * 60 * 1000;
  const kst = new Date(kstMs);
  const totalMin = kst.getUTCHours() * 60 + kst.getUTCMinutes();

  // 새벽 (00:00~05:59) — 통계 확정 전
  if (totalMin < 6 * 60) return { skip: true, reason: 'PRE_DAWN' };

  // 점심 (11:31~12:59) — 매수 차단 구간 (volumeClock 정합)
  if (totalMin >= 11 * 60 + 31 && totalMin <= 12 * 60 + 59) {
    return { skip: true, reason: 'LUNCH_BREAK' };
  }

  // 장 마감 후 ~ 18:00 (15:30~17:59) — KRX 통계 미확정
  if (totalMin >= 15 * 60 + 30 && totalMin < 18 * 60) {
    return { skip: true, reason: 'POST_CLOSE_PRE_PUBLISH' };
  }

  return { skip: false };
}
