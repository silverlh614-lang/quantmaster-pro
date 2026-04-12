/**
 * tradeSafety.ts — 상시 가동 안전장치
 *
 * 매수 전 종합 안전 체크:
 * - 일일 손실 한도 초과 여부
 * - 최대 보유 종목 수 초과 여부
 * - DEFENSE 모드 (MHS < 30) 여부
 */

/** 하루 -3% 손실 초과 시 당일 신규 매수 전면 중단 */
export const DAILY_MAX_LOSS_RATE = -0.03;

/** 동시 보유 최대 종목 수 — 초과 시 신규 매수 신호 무시 */
export const MAX_POSITIONS = 6;

/**
 * 일일 손실 한도 초과 여부 확인.
 * @param todayPnLRate 당일 손익률 (예: -0.035 = -3.5%)
 * @returns true = 한도 초과 → 당일 신규 매수 차단
 */
export function isDailyLossLimitReached(todayPnLRate: number): boolean {
  return todayPnLRate <= DAILY_MAX_LOSS_RATE;
}

/**
 * 최대 보유 종목 수 초과 여부 확인.
 * @param currentPositionCount 현재 보유 종목 수
 * @returns true = 상한 초과 → 신규 매수 차단
 */
export function isMaxPositionsReached(currentPositionCount: number): boolean {
  return currentPositionCount >= MAX_POSITIONS;
}

/**
 * 매수 전 종합 안전 체크.
 * 세 가지 조건 중 하나라도 걸리면 매수를 차단한다.
 *
 * @returns { blocked: true, reason } 또는 { blocked: false }
 */
export function checkTradeSafety(opts: {
  todayPnLRate: number;
  currentPositionCount: number;
  mhs: number;
}): { blocked: boolean; reason?: string } {
  if (opts.mhs < 30) {
    return { blocked: true, reason: `DEFENSE 모드 (MHS ${opts.mhs} < 30). 신규 매수 중단.` };
  }
  if (isDailyLossLimitReached(opts.todayPnLRate)) {
    return {
      blocked: true,
      reason: `일일 손실 한도 도달 (${(opts.todayPnLRate * 100).toFixed(2)}% ≤ ${DAILY_MAX_LOSS_RATE * 100}%). 당일 매수 중단.`,
    };
  }
  if (isMaxPositionsReached(opts.currentPositionCount)) {
    return {
      blocked: true,
      reason: `최대 보유 종목 수 도달 (${opts.currentPositionCount}/${MAX_POSITIONS}). 신규 매수 차단.`,
    };
  }
  return { blocked: false };
}
