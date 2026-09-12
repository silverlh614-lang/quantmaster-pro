// @responsibility Own active entry sizing calculations.
// ADR-0665: the legacy regime allocation remains a pure adapter; Kelly is not an order input.
import type { EntryOrderSizingInput, EntryOrderSizingResult } from '../../../src/types/entrySizing.js';
import {
  computePortfolioExposureBudget,
  applyPortfolioExposureCap,
  isExposureBudgetEnabled,
  mapInternalToExposureRegime,
  mapInternalToExposureRegimeWithMacro,
  type MarketRegimeLevel,
  type ExposureRegimeMacroInput,
  type PortfolioExposureBudget,
  type ApplyPortfolioExposureCapResult,
} from './regimeExposurePolicy.js';
import type { RegimeLevel } from '../../../src/types/core.js';

export {
  calculateRegimePositionSizing as calculateEntryPositionSizing,
} from './regimePositionPolicy.js';

/** Existing persisted trade marker; a path migration must not relabel historical semantics. */
export const ENTRY_SIZING_SOURCE = 'LEGACY_SSOT' as const;

export function calculateOrderQuantity(input: EntryOrderSizingInput): EntryOrderSizingResult {
  if (input.price <= 0 || input.remainingSlots <= 0 || input.orderableCash <= 0) {
    return { quantity: 0, effectiveBudget: 0 };
  }
  const targetBudget = Math.max(0, input.totalAssets * input.positionPct);
  const slotBudget = input.orderableCash / input.remainingSlots;
  const effectiveBudget = Math.max(0, Math.min(input.orderableCash, targetBudget, slotBudget));
  return {
    quantity: Math.floor(effectiveBudget / input.price),
    effectiveBudget,
  };
}

export interface ApplyExposureBudgetCapInput {
  /** Quantity after the entry path has applied its current position policy. */
  rawQuantity: number;
  /** 매수가 (rawQuantity × shadowEntryPrice = rawPositionAmount) */
  shadowEntryPrice: number;
  /** 계좌 총액 */
  accountEquity: number;
  /** 현재 보유 주식 평가금액 총합 (호출자 ctx 에서 수집) */
  currentEquityExposureAmount: number;
  /** 현재 현금 (UI/진단용) */
  currentCashAmount: number;
  /** 시장 레짐 (기존 RegimeLevel — 매핑 자동 적용) */
  regime: RegimeLevel;
  /** 신규 매수 vs 추매 (호출자 분류) */
  isAddOnBuy: boolean;
  /** 호출자 명시 매핑 — 미전달 시 mapInternalToExposureRegimeWithMacro 자동 적용 (ADR-0170) */
  exposureRegime?: MarketRegimeLevel;
  /**
   * ADR-0170 §M4 — 매크로 신호 입력 (R1_DEFENSIVE 자동 격상용).
   * 미전달 시 기존 mapInternalToExposureRegime 매핑 그대로 (회귀 위험 격리).
   */
  macro?: ExposureRegimeMacroInput;
}

export interface ApplyExposureBudgetCapResult {
  /** 본 cap 적용 여부 — false 면 호출자가 rawQuantity 그대로 사용 */
  applied: boolean;
  /** 적용 시 cap 후 quantity (주식 수) — applied=false 면 rawQuantity 그대로 */
  finalQuantity: number;
  /** 본 cap 결과 — 진단/UI 용 */
  capResult?: ApplyPortfolioExposureCapResult;
  /** 본 cap 입력 — 진단/UI 용 */
  budget?: PortfolioExposureBudget;
  /** 미적용 사유 (진단 로그용) */
  skipReason?: 'ENV_DISABLED' | 'INPUT_MISSING';
}

/**
 * ADR-0166 통합 진입점 — sizing 결과 quantity 에 레짐 노출 예산 cap 적용.
 *
 * 4 분기:
 *   1. ENV OFF (default) → applied=false / skipReason='ENV_DISABLED' / rawQuantity 그대로
 *   2. 입력 누락 (currentEquityExposureAmount NaN) → applied=false / skipReason='INPUT_MISSING'
 *   3. 정상 → computePortfolioExposureBudget + applyPortfolioExposureCap → finalQuantity 산출
 *   4. cap 결과 finalPositionAmount=0 → applied=true / finalQuantity=0 (차단)
 *
 * 호출자 패턴:
 *   const exposureCap = applyExposureBudgetCap({ rawQuantity: baseQty, ... });
 *   const finalQty = exposureCap.applied ? exposureCap.finalQuantity : baseQty;
 */
export function applyExposureBudgetCap(input: ApplyExposureBudgetCapInput): ApplyExposureBudgetCapResult {
  if (!isExposureBudgetEnabled()) {
    return {
      applied: false,
      finalQuantity: input.rawQuantity,
      skipReason: 'ENV_DISABLED',
    };
  }

  // 입력 검증
  if (
    !Number.isFinite(input.accountEquity) || input.accountEquity <= 0 ||
    !Number.isFinite(input.currentEquityExposureAmount) || input.currentEquityExposureAmount < 0 ||
    !Number.isFinite(input.shadowEntryPrice) || input.shadowEntryPrice <= 0 ||
    !Number.isFinite(input.rawQuantity) || input.rawQuantity < 0
  ) {
    return {
      applied: false,
      finalQuantity: input.rawQuantity,
      skipReason: 'INPUT_MISSING',
    };
  }

  // ADR-0170 §M4 — 매크로 신호 입력 시 R1_DEFENSIVE 자동 격상 (R5_CAUTION + bearDefenseMode/VIX/VKOSPI)
  const exposureRegime = input.exposureRegime
    ?? (input.macro
      ? mapInternalToExposureRegimeWithMacro(input.regime, input.macro)
      : mapInternalToExposureRegime(input.regime));

  const budget = computePortfolioExposureBudget({
    accountEquity: input.accountEquity,
    currentEquityExposureAmount: input.currentEquityExposureAmount,
    currentCashAmount: input.currentCashAmount,
    regime: exposureRegime,
  });

  const rawPositionAmount = input.rawQuantity * input.shadowEntryPrice;
  const capResult = applyPortfolioExposureCap({
    rawPositionAmount,
    exposureBudget: budget,
    isAddOnBuy: input.isAddOnBuy,
  });

  const finalQuantity = Math.floor(capResult.finalPositionAmount / input.shadowEntryPrice);

  return {
    applied: true,
    finalQuantity,
    capResult,
    budget,
  };
}
