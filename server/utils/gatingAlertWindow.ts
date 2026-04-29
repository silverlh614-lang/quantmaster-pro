// @responsibility 게이팅 차단 알림 (FOMC/VIX) 발송 시간대 SSOT — 장시작/장마감 2회만 허용 (ADR-0104)
/**
 * gatingAlertWindow.ts — 게이팅 차단 알림은 매분 cron 에서 호출되지만 운영자
 * 인지 부담을 줄이기 위해 KST 장시작/장마감 두 윈도우 안에서만 발송한다.
 *
 * 윈도우 정의 (KST):
 *   - OPEN  09:00~10:00  (장시작 직후 — 09:00 cron 1회 발송 보장)
 *   - CLOSE 15:00~16:00  (장마감 ~ KIS 종가 직후 — 15:30 근처 1회 발송 보장)
 *   - 그 외 시간 → null (발송 차단)
 *
 * 사용처: signalScanner.ts + preflight.ts 의 VIX/FOMC 게이팅 차단 알림 4 site.
 * dedupeKey 는 호출자가 `${prefix}:${date}:${session}` 형식으로 합성 — 같은 윈도우 안
 * 첫 발송 1회만 보장 (12h cooldown 그대로 유지).
 *
 * ENV 우회: GATING_ALERT_WINDOW_DISABLED=true 시 모든 시간대 발송 허용
 * (사용자 분석 후속 PR / 운영 비상 시).
 *
 * 기존 ADR-0093 (PR-Z6) 의 dedupeKey + 12h cooldown 위에 *시간 윈도우 가드*
 * 를 추가하는 형태 — 12h cooldown 자체는 각 세션 안 1회 발송 보장 안전망.
 */

export type GatingAlertSession = 'OPEN' | 'CLOSE';

/**
 * KST 시각이 장시작/장마감 윈도우 안에 있는지 분류.
 * 토/일은 OPEN/CLOSE 가 작동 안 함 (KRX 휴장 — cron 자체 평일 가드 1차 방어).
 *
 * 경계값:
 *   09:00:00 ≤ t < 10:00:00 → 'OPEN'
 *   15:00:00 ≤ t < 16:00:00 → 'CLOSE'
 *   그 외 → null
 */
export function getGatingAlertSession(now: Date = new Date()): GatingAlertSession | null {
  if (isGatingAlertWindowDisabled()) return 'OPEN'; // 우회 시 항상 OPEN 반환 (발송 허용)

  const kstMs = now.getTime() + 9 * 3600_000;
  const kst = new Date(kstMs);
  const dow = kst.getUTCDay(); // 0=일, 6=토 (UTC 기준이지만 +9h 후라 KST 요일과 동일)
  if (dow === 0 || dow === 6) return null; // 주말 차단

  const hour = kst.getUTCHours();
  const min = kst.getUTCMinutes();
  const totalMin = hour * 60 + min;

  // OPEN: 09:00 (540) ≤ t < 10:00 (600)
  if (totalMin >= 540 && totalMin < 600) return 'OPEN';
  // CLOSE: 15:00 (900) ≤ t < 16:00 (960)
  if (totalMin >= 900 && totalMin < 960) return 'CLOSE';

  return null;
}

/**
 * ENV 우회 검사 — 운영 비상 시 게이팅 알림을 전 시간대 발송하도록 회로 차단 해제.
 * 빈 문자열 / undefined / 'false' / '0' 모두 false 로 처리.
 */
export function isGatingAlertWindowDisabled(): boolean {
  const v = process.env.GATING_ALERT_WINDOW_DISABLED;
  if (!v) return false;
  const lower = v.toLowerCase();
  return lower === 'true' || lower === '1';
}

/**
 * dedupeKey 합성 헬퍼 — 호출자가 prefix + KST 일자 + 세션 으로 1일 2회 발송 보장.
 * session=null 일 때는 호출자가 발송 자체를 차단해야 함 (본 함수는 null 입력 시 null 반환).
 */
export function buildSessionDedupeKey(
  prefix: string,
  kstDateStr: string,
  session: GatingAlertSession | null,
): string | null {
  if (!session) return null;
  return `${prefix}:${kstDateStr}:${session.toLowerCase()}`;
}

/** 상수 SSOT — 외부 import 가 임계 검증 시 사용. */
export const GATING_ALERT_WINDOW_CONSTANTS = {
  OPEN_START_MIN: 540,  // 09:00 KST
  OPEN_END_MIN: 600,    // 10:00 KST
  CLOSE_START_MIN: 900, // 15:00 KST
  CLOSE_END_MIN: 960,   // 16:00 KST
} as const;
