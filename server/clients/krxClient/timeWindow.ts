// @responsibility krxClient 시간대 게이팅 — ADR-0256 (PRE_DAWN/LUNCH_BREAK/POST_CLOSE_PRE_PUBLISH)
/**
 * krxClient/timeWindow.ts — ADR-0502c 분해 SSOT.
 *
 * ADR-0256: 통계 무의미 / 미확정 시간대 호출 차단. 카운터 미누적 (ADR-0251 정합).
 *
 * KRX 호출 skip 시간대 (KST) — **매수 차단이 아니라 KRX 통계 미확정/off-hours 400 회피용**.
 * (점심도 volumeClock ALWAYS-ON 상 buyable 이며 매수는 KIS primary 로 계속 동작. 본 skip 은
 *  KRX OpenAPI 호출 절약·점심 400 누적 cooldown 결함 회피(http.ts off-hours 400 정합)일 뿐.)
 *   - PRE_DAWN (00:00~05:59): 통계 확정 전, 호출 무의미
 *   - LUNCH_BREAK (11:31~12:59): KRX 통계 미확정 + off-hours 400 회피 (매수 차단 아님)
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

  // 점심 (11:31~12:59) — KRX 통계 미확정 + off-hours 400 누적 cooldown 회피 (매수 차단 아님:
  // 점심도 volumeClock ALWAYS-ON 상 buyable, 매수는 KIS primary 로 동작; 본 skip 은 KRX fetch 절약).
  if (totalMin >= 11 * 60 + 31 && totalMin <= 12 * 60 + 59) {
    return { skip: true, reason: 'LUNCH_BREAK' };
  }

  // 장 마감 후 ~ 18:00 (15:30~17:59) — KRX 통계 미확정
  if (totalMin >= 15 * 60 + 30 && totalMin < 18 * 60) {
    return { skip: true, reason: 'POST_CLOSE_PRE_PUBLISH' };
  }

  return { skip: false };
}
