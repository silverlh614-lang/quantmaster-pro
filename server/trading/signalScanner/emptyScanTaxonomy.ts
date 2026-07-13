/**
 * @responsibility ADR-452 empty scan taxonomy + KST buy-session 진단 분류
 *
 * ADR-452는 live 매수 기준을 완화하지 않는다. 이 모듈은 “매수 없음”을
 * TRUE_EMPTY / WAIT_TRIGGER / DATA_BLOCKED / MODE_BLOCKED / SESSION_BLOCKED로 분리하고,
 * 비-매수 세션(장외/마감준비)에서 emptyScan streak가 증가하지 않도록 호출자에게 단일 판단을 제공한다.
 * buy-session 경계는 volumeClock ALWAYS-ON SSOT(09:00~15:20 매수 허용)에 정합한다 — 시초가/점심은
 * 차단이 아니라 점수 감점 구간이므로 buySession=true (진단 라벨만 granularity 위해 유지).
 */

export type EngineModeForEmptyScan =
  | 'NORMAL'
  | 'DEGRADED'
  | 'SELL_ONLY'
  | 'SHADOW_ONLY'
  | 'OBSERVE_ONLY'
  | string;

type EmptyScanType =
  | 'TRUE_EMPTY'
  | 'WAIT_TRIGGER'
  | 'DATA_BLOCKED'
  | 'MODE_BLOCKED'
  | 'SESSION_BLOCKED';

export type KstIntradaySession =
  | 'OPENING_GUARD'
  | 'MORNING_BUY'
  | 'LUNCH_GUARD'
  | 'AFTERNOON_BUY'
  | 'CLOSING_PREP'
  | 'AFTER_MARKET'
  | 'WEEKEND_HOLIDAY';

export interface EmptyScanClassificationInput {
  now?: Date | number;
  engineMode: EngineModeForEmptyScan;
  candidateCount?: number;
  waitTriggerCount?: number;
  dataBlockedCount?: number;
}

export interface EmptyScanClassification {
  type: EmptyScanType;
  buySession: boolean;
  session: KstIntradaySession;
  incrementEmptyScan: boolean;
  reason: string;
}

function toKstMinutes(now: Date | number = Date.now()): { dow: number; minutes: number } {
  const d = typeof now === 'number' ? new Date(now) : now;
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return {
    dow: kst.getUTCDay(),
    minutes: kst.getUTCHours() * 60 + kst.getUTCMinutes(),
  };
}

function hm(hour: number, minute: number): number {
  return hour * 60 + minute;
}

/**
 * KST 장중 세션 라벨 (진단 granularity 전용 — volumeClock ALWAYS-ON 정합).
 *
 * 매수 허용 (volumeClock SSOT: 09:00~15:20 전부 allowEntry=true, 시초가/점심은 차단이 아니라 감점):
 *   - 09:00~09:30 OPENING_GUARD  — 시초가 슬리피지 감점 구간 (매수 허용)
 *   - 09:30~11:30 MORNING_BUY
 *   - 11:30~13:00 LUNCH_GUARD     — 점심 저거래 감점 구간 (매수 허용)
 *   - 13:00~15:20 AFTERNOON_BUY
 *
 * 비-매수 (buySession=false):
 *   - 15:20~15:30 CLOSING_PREP    — 마감 동시호가 준비 (volumeClock 하드 차단 15:21~15:30 정합)
 *   - 15:30+      AFTER_MARKET    — 연속매매 세션 부재 (미개장)
 *   - 주말/휴장   WEEKEND_HOLIDAY
 *
 * 세션 라벨(OPENING_GUARD/LUNCH_GUARD)은 진단 granularity 위해 유지하되, "매수 차단" 의미는 없다.
 * buy-session 경계는 isBuySessionKst(평일 09:00~15:20)가 단독 결정한다.
 */
export function getKstIntradaySession(now: Date | number = Date.now()): KstIntradaySession {
  const { dow, minutes } = toKstMinutes(now);
  if (dow === 0 || dow === 6) return 'WEEKEND_HOLIDAY';

  if (minutes >= hm(9, 0) && minutes < hm(9, 30)) return 'OPENING_GUARD';
  if (minutes >= hm(9, 30) && minutes < hm(11, 30)) return 'MORNING_BUY';
  if (minutes >= hm(11, 30) && minutes < hm(13, 0)) return 'LUNCH_GUARD';
  if (minutes >= hm(13, 0) && minutes < hm(15, 20)) return 'AFTERNOON_BUY';
  if (minutes >= hm(15, 20) && minutes < hm(15, 30)) return 'CLOSING_PREP';
  return 'AFTER_MARKET';
}

/**
 * 매수 세션 여부 — volumeClock ALWAYS-ON SSOT 정합 (평일 09:00~15:20 전부 buyable).
 *
 * 시초가(OPENING_GUARD)·점심(LUNCH_GUARD)은 volumeClock 상 차단이 아니라 감점 구간이므로 buySession=true.
 * 비-매수는 CLOSING_PREP(15:20~15:30 마감 동시호가 준비)·AFTER_MARKET·WEEKEND_HOLIDAY 뿐.
 */
export function isBuySessionKst(now: Date | number = Date.now()): boolean {
  const { dow, minutes } = toKstMinutes(now);
  if (dow === 0 || dow === 6) return false;
  return minutes >= hm(9, 0) && minutes < hm(15, 20);
}

export function shouldCountEmptyScan(
  now: Date | number = Date.now(),
  engineMode: EngineModeForEmptyScan,
): boolean {
  if (!isBuySessionKst(now)) return false;
  return engineMode === 'NORMAL' || engineMode === 'DEGRADED';
}

export function classifyEmptyScan(input: EmptyScanClassificationInput): EmptyScanClassification {
  const now = input.now ?? Date.now();
  const session = getKstIntradaySession(now);
  const buySession = isBuySessionKst(now);
  const canCountByMode = input.engineMode === 'NORMAL' || input.engineMode === 'DEGRADED';

  if (!buySession) {
    return {
      type: 'SESSION_BLOCKED',
      buySession,
      session,
      incrementEmptyScan: false,
      reason: `session=${session}`,
    };
  }

  if (!canCountByMode) {
    return {
      type: 'MODE_BLOCKED',
      buySession,
      session,
      incrementEmptyScan: false,
      reason: `engineMode=${input.engineMode}`,
    };
  }

  const candidateCount = input.candidateCount ?? 0;
  const waitTriggerCount = input.waitTriggerCount ?? 0;
  const dataBlockedCount = input.dataBlockedCount ?? 0;

  if (candidateCount > 0 && waitTriggerCount > 0) {
    return {
      type: 'WAIT_TRIGGER',
      buySession,
      session,
      incrementEmptyScan: false,
      reason: `candidates=${candidateCount}, wait=${waitTriggerCount}`,
    };
  }

  if (candidateCount > 0 && dataBlockedCount > 0) {
    return {
      type: 'DATA_BLOCKED',
      buySession,
      session,
      incrementEmptyScan: false,
      reason: `candidates=${candidateCount}, dataBlocked=${dataBlockedCount}`,
    };
  }

  return {
    type: 'TRUE_EMPTY',
    buySession,
    session,
    incrementEmptyScan: true,
    reason: 'no executable/wait/data-blocked candidates',
  };
}
