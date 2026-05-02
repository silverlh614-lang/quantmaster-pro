/**
 * @responsibility ADR-0166 레짐별 총 계좌 노출 예산 SSOT — positionSizingEngine 상위 계층 진입점
 *
 * 핵심: 개별 종목 사이징보다 *먼저* 시장 레짐별로 계좌 전체 주식 노출 한도 결정.
 * 7 레짐 매트릭스 (R0_CRISIS ~ R6_STRONG_BULL) 정책 SSOT + 매수 후보 사이즈 cap 함수.
 *
 * 절대 규칙:
 * 1. 레짐 노출 예산은 개별 사이징보다 *상위* 계층 — 종목이 좋아도 예산 초과 불가.
 * 2. R0_CRISIS / R1_DEFENSIVE 등 위험 레짐은 신규 매수 자체 차단 또는 강력 제한.
 * 3. R6_STRONG_BULL 강세장도 100% 몰빵 금지 (10% 비상 현금 필수 보존).
 * 4. 기존 보유가 한도 초과 시 강제 매도 안 함 — 리밸런싱 후보 등록 (호출자 책임).
 */

import type { RegimeLevel } from '../../../src/types/core.js';

// ─── 타입 ────────────────────────────────────────────────────────────────────

/**
 * 사용자 명시 7 레짐 분류 (R0~R6).
 * 의미 = R0 위기 → R6 강력한 상승장 (오름차순).
 *
 * **주의**: 기존 `RegimeLevel` (R1_TURBO~R6_DEFENSE) 와 *역순 의미* —
 * 기존: R1=강세 / R6=방어 / 신규: R1=보수 / R6=강력한 상승장.
 * 호출자는 `mapInternalToExposureRegime` 매핑 함수 사용 의무.
 */
export type MarketRegimeLevel =
  | 'R0_CRISIS'
  | 'R1_DEFENSIVE'
  | 'R2_WEAK'
  | 'R3_NEUTRAL'
  | 'R4_RECOVERY'
  | 'R5_BULL'
  | 'R6_STRONG_BULL';

export interface RegimeExposurePolicy {
  regime: MarketRegimeLevel;
  label: string;
  /** 목표 주식 노출 비중 (0~1) */
  targetEquityExposurePct: number;
  /** 최대 주식 노출 비중 (0~1) — 절대 한도 */
  maxEquityExposurePct: number;
  /** 최소 현금 비중 (0~1) — 비상 대응용 */
  minCashReservePct: number;
  /** 신규 매수 허용 여부 */
  allowNewBuys: boolean;
  /** 추매 허용 여부 */
  allowAddOnBuys: boolean;
  /** 신규 매수 시 개별 종목 사이징 배수 (positionSizingEngine 결과에 곱) */
  positionMultiplier: number;
}

// ─── 7 레짐 정책 매트릭스 SSOT (사용자 명시) ────────────────────────────────

export const REGIME_EXPOSURE_POLICIES: Record<MarketRegimeLevel, RegimeExposurePolicy> = {
  R0_CRISIS: {
    regime: 'R0_CRISIS',
    label: '위기장 / 매수 중단',
    targetEquityExposurePct: 0.00,
    maxEquityExposurePct: 0.05,
    minCashReservePct: 0.95,
    allowNewBuys: false,
    allowAddOnBuys: false,
    positionMultiplier: 0.0,
  },
  R1_DEFENSIVE: {
    regime: 'R1_DEFENSIVE',
    label: '보수적 접근',
    targetEquityExposurePct: 0.20,
    maxEquityExposurePct: 0.25,
    minCashReservePct: 0.75,
    allowNewBuys: true,
    allowAddOnBuys: false,
    positionMultiplier: 0.50,
  },
  R2_WEAK: {
    regime: 'R2_WEAK',
    label: '약세/불확실',
    targetEquityExposurePct: 0.30,
    maxEquityExposurePct: 0.35,
    minCashReservePct: 0.65,
    allowNewBuys: true,
    allowAddOnBuys: false,
    positionMultiplier: 0.65,
  },
  R3_NEUTRAL: {
    regime: 'R3_NEUTRAL',
    label: '중립장',
    targetEquityExposurePct: 0.45,
    maxEquityExposurePct: 0.50,
    minCashReservePct: 0.50,
    allowNewBuys: true,
    allowAddOnBuys: true,
    positionMultiplier: 0.80,
  },
  R4_RECOVERY: {
    regime: 'R4_RECOVERY',
    label: '회복장',
    targetEquityExposurePct: 0.60,
    maxEquityExposurePct: 0.65,
    minCashReservePct: 0.35,
    allowNewBuys: true,
    allowAddOnBuys: true,
    positionMultiplier: 1.00,
  },
  R5_BULL: {
    regime: 'R5_BULL',
    label: '상승장',
    targetEquityExposurePct: 0.75,
    maxEquityExposurePct: 0.80,
    minCashReservePct: 0.20,
    allowNewBuys: true,
    allowAddOnBuys: true,
    positionMultiplier: 1.10,
  },
  R6_STRONG_BULL: {
    regime: 'R6_STRONG_BULL',
    label: '강력한 상승장',
    targetEquityExposurePct: 0.85,
    maxEquityExposurePct: 0.90,
    minCashReservePct: 0.10,
    allowNewBuys: true,
    allowAddOnBuys: true,
    positionMultiplier: 1.20,
  },
};

// ─── 기존 RegimeLevel ↔ 신규 MarketRegimeLevel 매핑 ─────────────────────────

/**
 * 기존 `RegimeLevel` (R1_TURBO~R6_DEFENSE, *역순 의미*) → 신규 `MarketRegimeLevel` (R0~R6).
 *
 * 매핑 정책 (의미 정합):
 *   R1_TURBO    (강세)   → R6_STRONG_BULL (강력한 상승장)
 *   R2_BULL     (상승)   → R5_BULL        (상승장)
 *   R3_EARLY    (회복)   → R4_RECOVERY    (회복장)
 *   R4_NEUTRAL  (중립)   → R3_NEUTRAL     (중립장)
 *   R5_CAUTION  (주의)   → R2_WEAK        (약세/불확실)
 *   R6_DEFENSE  (방어)   → R0_CRISIS      (위기장)
 *
 * R1_DEFENSIVE 는 기존 시스템에 직접 매칭 부재 — R5_CAUTION 과 R6_DEFENSE 사이 중간 단계.
 * 본 PR 에서는 매핑 미사용 (호출자가 명시 전달 시에만). 향후 매크로 신호 기반 자동 분류 후속 PR.
 */
const REGIME_MAPPING: Record<RegimeLevel, MarketRegimeLevel> = {
  R1_TURBO: 'R6_STRONG_BULL',
  R2_BULL: 'R5_BULL',
  R3_EARLY: 'R4_RECOVERY',
  R4_NEUTRAL: 'R3_NEUTRAL',
  R5_CAUTION: 'R2_WEAK',
  R6_DEFENSE: 'R0_CRISIS',
};

export function mapInternalToExposureRegime(internal: RegimeLevel): MarketRegimeLevel {
  return REGIME_MAPPING[internal] ?? 'R3_NEUTRAL';
}

// ─── 사용자 §2 — 총 노출 예산 계산 ──────────────────────────────────────────

export interface PortfolioExposureInput {
  accountEquity: number;
  /** 현재 보유 주식 평가금액 총합 */
  currentEquityExposureAmount: number;
  /** 현재 현금 (진단/UI 용, 계산엔 미사용) */
  currentCashAmount: number;
  /** 현재 시장 레짐 */
  regime: MarketRegimeLevel;
}

export interface PortfolioExposureBudget {
  regime: MarketRegimeLevel;
  targetExposureAmount: number;
  maxExposureAmount: number;
  minCashReserveAmount: number;

  currentExposureAmount: number;
  currentExposurePct: number;

  remainingBuyBudgetToTarget: number;
  remainingBuyBudgetToMax: number;

  isOverTarget: boolean;
  isOverMax: boolean;

  allowNewBuys: boolean;
  allowAddOnBuys: boolean;
  positionMultiplier: number;
}

export function computePortfolioExposureBudget(
  input: PortfolioExposureInput,
): PortfolioExposureBudget {
  const policy = REGIME_EXPOSURE_POLICIES[input.regime];

  const targetExposureAmount = input.accountEquity * policy.targetEquityExposurePct;
  const maxExposureAmount = input.accountEquity * policy.maxEquityExposurePct;
  const minCashReserveAmount = input.accountEquity * policy.minCashReservePct;

  const currentExposurePct =
    input.accountEquity > 0
      ? input.currentEquityExposureAmount / input.accountEquity
      : 0;

  const remainingBuyBudgetToTarget =
    Math.max(0, targetExposureAmount - input.currentEquityExposureAmount);
  const remainingBuyBudgetToMax =
    Math.max(0, maxExposureAmount - input.currentEquityExposureAmount);

  return {
    regime: input.regime,
    targetExposureAmount,
    maxExposureAmount,
    minCashReserveAmount,
    currentExposureAmount: input.currentEquityExposureAmount,
    currentExposurePct,
    remainingBuyBudgetToTarget,
    remainingBuyBudgetToMax,
    isOverTarget: input.currentEquityExposureAmount > targetExposureAmount,
    isOverMax: input.currentEquityExposureAmount > maxExposureAmount,
    allowNewBuys: policy.allowNewBuys,
    allowAddOnBuys: policy.allowAddOnBuys,
    positionMultiplier: policy.positionMultiplier,
  };
}

// ─── 사용자 §3 — 개별 종목 매수금액에 총 노출 예산 적용 ─────────────────────

export interface ApplyPortfolioExposureCapResult {
  finalPositionAmount: number;
  cappedByExposureBudget: boolean;
  blockReason?: string;
}

export function applyPortfolioExposureCap(params: {
  rawPositionAmount: number;
  exposureBudget: PortfolioExposureBudget;
  isAddOnBuy: boolean;
}): ApplyPortfolioExposureCapResult {
  const { rawPositionAmount, exposureBudget, isAddOnBuy } = params;

  if (!exposureBudget.allowNewBuys && !isAddOnBuy) {
    return {
      finalPositionAmount: 0,
      cappedByExposureBudget: true,
      blockReason: '현재 레짐에서 신규 매수 금지',
    };
  }

  if (isAddOnBuy && !exposureBudget.allowAddOnBuys) {
    return {
      finalPositionAmount: 0,
      cappedByExposureBudget: true,
      blockReason: '현재 레짐에서 추매 금지',
    };
  }

  if (exposureBudget.isOverMax) {
    return {
      finalPositionAmount: 0,
      cappedByExposureBudget: true,
      blockReason: '레짐별 최대 주식 노출 한도 초과',
    };
  }

  const adjustedPosition = rawPositionAmount * exposureBudget.positionMultiplier;
  const finalPositionAmount = Math.min(adjustedPosition, exposureBudget.remainingBuyBudgetToMax);

  return {
    finalPositionAmount,
    cappedByExposureBudget: finalPositionAmount < adjustedPosition,
    blockReason:
      finalPositionAmount < adjustedPosition
        ? '레짐별 총 주식 노출 예산으로 매수금액 제한'
        : undefined,
  };
}

// ─── ENV 우회 SSOT ──────────────────────────────────────────────────────────

/**
 * ADR-0166 — 레짐 노출 예산 활성화 ENV.
 * default OFF — 운영자 명시 활성화 의무.
 *
 * `applyPositionSizingEngine` 의 `_SHADOW_APPLY` / `_LIVE_ENABLED` 와는 *별도 ENV*.
 * 두 정책 (Sizing + Exposure Budget) 독립 활성화 가능 — 사용자가 단계별 검증 의도.
 *
 * 활성 시점: PR 머지 후 SHADOW 1주 검증 → ENV 활성 → LIVE 활성화 결정.
 */
export function isExposureBudgetEnabled(): boolean {
  return process.env.POSITION_SIZING_EXPOSURE_BUDGET_ENABLED === 'true';
}
