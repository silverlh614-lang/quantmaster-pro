/**
 * @responsibility 손실 거래 청산 시점 자동 분류 — 4분류 우선순위 SSOT (ADR-0021)
 *
 * MACRO_SHOCK > STOP_TOO_TIGHT > OVERHEATED_ENTRY > STOP_TOO_LOOSE > UNCLASSIFIED.
 * 입력 부족 시 안전하게 다음 단계로 fallback. 수동 분류(FALSE_BREAKOUT 등)는
 * 본 자동 분류 결과를 사용자가 후속 PR UI 에서 override 가능.
 */
import type { ConditionId } from '../../types/core';
import type { LossReason, TradeRecord } from '../../types/portfolio';

// ─── 임계값 SSOT ────────────────────────────────────────────────────────────

/** MACRO_SHOCK: VKOSPI 매수→매도 변화량 (포인트) 임계 */
export const MACRO_SHOCK_VKOSPI_DELTA = 8;
/** MACRO_SHOCK: 동시 만족할 returnPct 상한 (음수, %) */
export const MACRO_SHOCK_RETURN_PCT_MAX = -3;

/** STOP_TOO_TIGHT: 빠른 손절 임계 (일) */
export const STOP_TOO_TIGHT_HOLDING_DAYS_MAX = 3;
/** STOP_TOO_TIGHT: returnPct 범위 (음수, %) */
export const STOP_TOO_TIGHT_RETURN_PCT_MIN = -10;
export const STOP_TOO_TIGHT_RETURN_PCT_MAX = -3;

/** OVERHEATED_ENTRY: holdingDays 임계 (일) */
export const OVERHEATED_ENTRY_HOLDING_DAYS_MAX = 5;
/** OVERHEATED_ENTRY: 심리적 객관성 조건 17 ≤ 임계 */
export const OVERHEATED_PSYCHOLOGY_THRESHOLD = 3;

/** STOP_TOO_LOOSE: returnPct 임계 (음수, %) */
export const STOP_TOO_LOOSE_RETURN_PCT_MAX = -15;

// ─── 입력 ────────────────────────────────────────────────────────────────────

export interface LossReasonClassifierInput {
  /** 청산 returnPct (음수만 분류 진입). 단위: % */
  returnPct: number;
  /** 보유 일수 (정수) */
  holdingDays?: number;
  /** 매수 가격 (분류기에서는 직접 사용 안 하지만 미래 확장용) */
  buyPrice?: number;
  /** 매도 가격 (동일) */
  sellPrice?: number;
  /** 매수 시점 27조건 점수 (조건 17, 25 체크용) */
  conditionScores?: Partial<Record<ConditionId, number>>;
  /** 매수 시점 VKOSPI (evaluationSnapshot.vkospiAtBuy) */
  vkospiAtBuy?: number;
  /** 매도 시점 VKOSPI (macroEnv.vkospi) */
  vkospiAtSell?: number;
  /** 매도 사유 (TradeRecord.sellReason) */
  sellReason?: TradeRecord['sellReason'];
}

// ─── 분류기 ──────────────────────────────────────────────────────────────────

/**
 * 손실 거래 자동 분류. returnPct ≥ 0 이면 무조건 UNCLASSIFIED.
 *
 * 우선순위 (먼저 매칭되는 것 채택):
 *   1. MACRO_SHOCK   — VKOSPI 8↑ + returnPct ≤ -3%
 *   2. STOP_TOO_TIGHT — holdingDays ≤ 3 + -10% < returnPct ≤ -3% + STOP_LOSS
 *   3. OVERHEATED_ENTRY — holdingDays ≤ 5 + (조건 17 ≤ 3 또는 조건 25 = 0)
 *   4. STOP_TOO_LOOSE  — returnPct ≤ -15%
 *   5. UNCLASSIFIED   — 위 모두 미해당
 *
 * @returns LossReason — 분류 불가 시 UNCLASSIFIED
 */
export function classifyLossReason(input: LossReasonClassifierInput): LossReason {
  const { returnPct } = input;

  // 수익 거래는 분류 진입 안 함
  if (!Number.isFinite(returnPct) || returnPct >= 0) {
    return 'UNCLASSIFIED';
  }

  // 1. MACRO_SHOCK
  if (
    typeof input.vkospiAtBuy === 'number' &&
    typeof input.vkospiAtSell === 'number' &&
    Number.isFinite(input.vkospiAtBuy) &&
    Number.isFinite(input.vkospiAtSell)
  ) {
    const vkospiDelta = input.vkospiAtSell - input.vkospiAtBuy;
    if (vkospiDelta >= MACRO_SHOCK_VKOSPI_DELTA && returnPct <= MACRO_SHOCK_RETURN_PCT_MAX) {
      return 'MACRO_SHOCK';
    }
  }

  // 2. STOP_TOO_TIGHT
  if (
    typeof input.holdingDays === 'number' &&
    input.holdingDays <= STOP_TOO_TIGHT_HOLDING_DAYS_MAX &&
    returnPct > STOP_TOO_TIGHT_RETURN_PCT_MIN &&
    returnPct <= STOP_TOO_TIGHT_RETURN_PCT_MAX &&
    input.sellReason === 'STOP_LOSS'
  ) {
    return 'STOP_TOO_TIGHT';
  }

  // 3. OVERHEATED_ENTRY — 매수 시점 조건 17(심리적 객관성) ≤ 3 또는 25(VCP) = 0
  //    이고 holdingDays ≤ 5 일이면 과열 진입으로 분류.
  if (
    typeof input.holdingDays === 'number' &&
    input.holdingDays <= OVERHEATED_ENTRY_HOLDING_DAYS_MAX &&
    input.conditionScores
  ) {
    const psychology = input.conditionScores[17 as ConditionId] ?? null;
    const vcp = input.conditionScores[25 as ConditionId] ?? null;
    const overheated =
      (typeof psychology === 'number' && psychology > 0 && psychology <= OVERHEATED_PSYCHOLOGY_THRESHOLD) ||
      (typeof vcp === 'number' && vcp === 0);
    if (overheated) {
      return 'OVERHEATED_ENTRY';
    }
  }

  // 4. STOP_TOO_LOOSE
  if (returnPct <= STOP_TOO_LOOSE_RETURN_PCT_MAX) {
    return 'STOP_TOO_LOOSE';
  }

  return 'UNCLASSIFIED';
}

/**
 * 분류 결과를 TradeRecord 에 부여하기 위한 메타 합성. closeTrade wiring 에서 사용.
 */
export function buildLossReasonMeta(reason: LossReason, now: Date = new Date()): {
  lossReason: LossReason;
  lossReasonAuto: true;
  lossReasonClassifiedAt: string;
} {
  return {
    lossReason: reason,
    lossReasonAuto: true,
    lossReasonClassifiedAt: now.toISOString(),
  };
}
