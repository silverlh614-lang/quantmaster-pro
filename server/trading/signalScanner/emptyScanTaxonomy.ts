/**
 * @responsibility ADR-452 empty scan taxonomy + KST buy-session SSOT
 *
 * ADR-452는 live 매수 기준을 완화하지 않는다. 이 모듈은 “매수 없음”을
 * TRUE_EMPTY / WAIT_TRIGGER / DATA_BLOCKED / MODE_BLOCKED / SESSION_BLOCKED로 분리하고,
 * SELL_ONLY 시간대에서 emptyScan streak가 증가하지 않도록 호출자에게 단일 판단을 제공한다.
 */

export type EngineModeForEmptyScan =
  | 'NORMAL'
  | 'DEGRADED'
  | 'SELL_ONLY'
  | 'SHADOW_ONLY'
  | 'OBSERVE_ONLY'
  | string;

export type EmptyScanType =
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
 * ADR-452 KST session policy.
 *
 * BUY_ALLOWED:
 *   - 09:30~11:30
 *   - 13:00~15:20
 *
 * SELL_ONLY / blocked:
 *   - 09:00~09:30 OPENING_GUARD
 *   - 11:30~13:00 LUNCH_GUARD
 *   - 15:20~15:30 CLOSING_PREP
 *   - 15:30+ AFTER_MARKET
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

export function isBuySessionKst(now: Date | number = Date.now()): boolean {
  const session = getKstIntradaySession(now);
  return session === 'MORNING_BUY' || session === 'AFTERNOON_BUY';
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
