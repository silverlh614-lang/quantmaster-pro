// @responsibility BEP 글라이드 단봉 노이즈 차단 정책 함수 SSOT — Two-Bar Confirmation Gate.
/**
 * twoBarConfirmation.ts — ADR-0085 §트랙 1 BEP 글라이드 Two-Bar Confirmation
 *
 * BEP 글라이드 영역 손절선 도달 시 *2개 봉(2 영업일) 연속 미달* 후에만 청산 트리거.
 * 단봉 노이즈 (장중 일시 급락 후 회복) 에서 진짜 추세 반전이 아닌데 청산하던 손실 차단.
 *
 * 본 PR 은 정책 함수 SSOT 만 — `exitEngine/rules/hardStopLoss.ts` wiring 은 후속 PR.
 *
 * ENV 롤백: `BEP_TWO_BAR_CONFIRMATION_DISABLED=true` 시 항상 'PASS' 반환 (정책 우회).
 */

export type TwoBarAction = 'CONFIRM_EXIT' | 'WAIT' | 'RESET' | 'PASS';

export interface TwoBarDecision {
  action: TwoBarAction;
  reason: string;
  /** WAIT 분기에서만 — 1차 터치 영속용 KST 일자 (호출자가 shadow 에 저장) */
  touchAt?: string;
}

export interface TwoBarInput {
  /** 현재가 — Yahoo/KIS 실시간 */
  currentPrice: number;
  /** 현재 손절선 — BEP 글라이드 산출값 */
  stopLoss: number;
  /** 진입가 */
  entryPrice: number;
  /** 진입 시점 ATR14 (옵셔널 — fallback 시 동작 무관) */
  entryATR14?: number;
  /** ADR-0079 `classifyStopSource` 결과가 'BEP_PROTECTION' 인지 여부 */
  isBepProtection: boolean;
  /** shadow.bepGlideTouchAt 영속값 (1차 터치 KST 일자) */
  bepGlideTouchAt?: string;
  /** 현재 KST 영업일 (YYYY-MM-DD) */
  currentDateKst: string;
}

export const TWO_BAR_CONSTANTS = {
  /** 1차 터치 후 grace 영업일 수 — 이 일수 경과 후 2차 미달이면 청산 */
  GRACE_DAYS: 1,
} as const;

export function isTwoBarConfirmationDisabled(): boolean {
  return process.env.BEP_TWO_BAR_CONFIRMATION_DISABLED === 'true';
}

/**
 * KST 영업일 두 문자열의 차이 (currentDate - touchDate, 일 단위).
 * 잘못된 형식 입력 시 0 반환 (안전 fallback).
 *
 * 영업일 산술이 아닌 단순 캘린더일 차이 — 주말 포함 시 호출자가 다음 영업일 판정.
 * 본 함수는 *문자열 ISO 일자 비교* 만 담당.
 */
export function diffDaysKst(currentDateKst: string, touchDateKst: string): number {
  const ms1 = Date.parse(`${currentDateKst}T00:00:00Z`);
  const ms2 = Date.parse(`${touchDateKst}T00:00:00Z`);
  if (!Number.isFinite(ms1) || !Number.isFinite(ms2)) return 0;
  return Math.round((ms1 - ms2) / 86400000);
}

/**
 * Two-Bar Confirmation 결정 트리.
 *
 * 우선순위:
 *   1. ENV DISABLED → PASS (정책 우회)
 *   2. BEP_PROTECTION 영역 아님 → PASS (즉시 청산 위임 — 일반 LOSS_STOP 등)
 *   3. currentPrice > stopLoss (회복) → RESET (영속 reset, 청산 미트리거)
 *   4. bepGlideTouchAt 부재 (1차 터치) → WAIT (touchAt 영속 + 청산 보류)
 *   5. diffDaysKst >= GRACE_DAYS (2개 봉 경과) → CONFIRM_EXIT (청산)
 *   6. 그 외 (1차 터치 당일 재방문) → WAIT (영속 유지)
 */
export function evaluateTwoBarConfirmation(input: TwoBarInput): TwoBarDecision {
  if (isTwoBarConfirmationDisabled()) {
    return { action: 'PASS', reason: 'BEP_TWO_BAR_CONFIRMATION_DISABLED=true (정책 우회)' };
  }
  if (!input.isBepProtection) {
    return { action: 'PASS', reason: 'BEP_PROTECTION 분류 아님 — 즉시 청산 위임' };
  }
  if (!Number.isFinite(input.currentPrice) || !Number.isFinite(input.stopLoss)) {
    return { action: 'PASS', reason: '입력 비정상 (currentPrice/stopLoss NaN)' };
  }
  if (input.currentPrice > input.stopLoss) {
    return {
      action: 'RESET',
      reason: `회복 (currentPrice ${input.currentPrice} > stopLoss ${input.stopLoss})`,
    };
  }
  // 손절선 도달 (currentPrice <= stopLoss)
  if (!input.bepGlideTouchAt) {
    return {
      action: 'WAIT',
      reason: '1차 터치 — 다음 봉 확인 필요',
      touchAt: input.currentDateKst,
    };
  }
  const diff = diffDaysKst(input.currentDateKst, input.bepGlideTouchAt);
  if (diff >= TWO_BAR_CONSTANTS.GRACE_DAYS) {
    return {
      action: 'CONFIRM_EXIT',
      reason: `2개 봉 연속 미달 — 1차 터치 ${input.bepGlideTouchAt} → 현재 ${input.currentDateKst} (${diff}일 경과)`,
    };
  }
  return {
    action: 'WAIT',
    reason: `1차 터치 당일 재방문 — 다음 봉 대기 (${diff}일 경과)`,
    touchAt: input.bepGlideTouchAt,
  };
}
