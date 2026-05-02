/**
 * @responsibility 연속 손절 횟수 기반 냉각 기간 — 복수심 매매·손실 회피 과잉 반응 방어
 *
 * 연속 손절이 쌓일수록 포지션을 압축하고,
 * 5연속 손절 시 5거래일 신규 매수를 차단한다.
 */

// ─── 타입 ────────────────────────────────────────────────────────────────────

export interface LossStreakState {
  consecutiveLosses: number;
  /** 마지막 손절 발생 일시 (ISO string) */
  lastLossDate: string | null;
  /** 냉각 기간 종료 일시 (ISO string) — null이면 냉각 없음 */
  coolOffUntil: string | null;
}

export interface LossStreakResult {
  multiplier: number;
  blocked: boolean;
  isPostCoolOff: boolean; // 냉각 종료 직후 첫 매수 (50% 제한)
  reason?: string;
}

// ─── 상수 ────────────────────────────────────────────────────────────────────

/** 냉각 기간 거래일 수 (5 연속 손절 시) */
const COOL_OFF_TRADING_DAYS = 5;
/** 냉각 종료 직후 첫 매수 비중 계수 */
const POST_COOL_OFF_FACTOR = 0.5;

// ─── 핵심 함수 ───────────────────────────────────────────────────────────────

/**
 * 연속 손절 횟수와 냉각 상태로 비중 배수를 계산한다.
 */
export function getLossStreakMultiplier(state: LossStreakState): LossStreakResult {
  const now = new Date();

  // 냉각 기간 중인지 확인
  if (state.coolOffUntil) {
    const until = new Date(state.coolOffUntil);
    if (now < until) {
      const remainingMs = until.getTime() - now.getTime();
      const remainingDays = Math.ceil(remainingMs / (1000 * 60 * 60 * 24));
      return {
        multiplier: 0,
        blocked: true,
        isPostCoolOff: false,
        reason: `5연속 손절 냉각 기간 — ${remainingDays}거래일 후 재개`,
      };
    }

    // 냉각 종료 직후: 첫 매수는 50%만
    return {
      multiplier: POST_COOL_OFF_FACTOR,
      blocked: false,
      isPostCoolOff: true,
      reason: '냉각 기간 종료 직후 — 첫 매수 50% 제한',
    };
  }

  // 연속 손절 횟수 기반 압축
  const losses = state.consecutiveLosses;

  if (losses >= 5) {
    return {
      multiplier: 0,
      blocked: true,
      isPostCoolOff: false,
      reason: '5연속 손절 — 5거래일 신규 매수 차단',
    };
  }
  if (losses >= 4) {
    return { multiplier: 0.4, blocked: false, isPostCoolOff: false, reason: '4연속 손절 — 60% 축소' };
  }
  if (losses >= 3) {
    return { multiplier: 0.6, blocked: false, isPostCoolOff: false, reason: '3연속 손절 — 40% 축소' };
  }
  if (losses >= 2) {
    return { multiplier: 0.8, blocked: false, isPostCoolOff: false, reason: '2연속 손절 — 20% 축소' };
  }

  return { multiplier: 1.0, blocked: false, isPostCoolOff: false };
}

/**
 * 손절 발생 시 LossStreakState를 업데이트한다.
 * 5연속 손절이면 coolOffUntil을 영업일 기준 5일 후로 설정한다.
 */
export function recordLoss(state: LossStreakState): LossStreakState {
  const newCount = state.consecutiveLosses + 1;
  let coolOffUntil: string | null = null;

  if (newCount >= 5) {
    // 5거래일 후 (달력일 기준 7일로 근사)
    const until = new Date();
    until.setDate(until.getDate() + 7);
    coolOffUntil = until.toISOString();
  }

  return {
    consecutiveLosses: newCount,
    lastLossDate: new Date().toISOString(),
    coolOffUntil,
  };
}

/**
 * 수익 발생 시 연속 손절 카운터를 초기화한다.
 */
export function recordWin(state: LossStreakState): LossStreakState {
  return {
    consecutiveLosses: 0,
    lastLossDate: state.lastLossDate,
    coolOffUntil: null,
  };
}

/**
 * 냉각 기간 종료 처리 — coolOffUntil을 null로 초기화한다.
 */
export function clearCoolOff(state: LossStreakState): LossStreakState {
  return { ...state, coolOffUntil: null };
}
