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

// ─── ADR-0170: 매크로 신호 기반 R1_DEFENSIVE 자동 격상 (audit-PR-520 §M4) ─────

/**
 * `mapInternalToExposureRegimeWithMacro` 입력 — 매크로 신호 부분 schema (호출자 책임).
 *
 * 모든 필드 옵셔널 — 부재 시 기존 매핑 그대로. ADR-0146 §"위반 5건" 회귀 위험 격리 정합.
 */
export interface ExposureRegimeMacroInput {
  /** VIX 공포지수 (>30 위험, >25 + 손실 누적 시 R1 격상 후보) */
  vix?: number;
  /** VKOSPI (한국 변동성, >30 격상 후보) */
  vkospi?: number;
  /** Bear 방어 모드 (true 시 R5_CAUTION → R1_DEFENSIVE 격상) */
  bearDefenseMode?: boolean;
  /** 일일 손실 비율 (-3% 미만 + VIX>25 시 R1 격상 — 자본 보호 강화) */
  dailyLossPct?: number;
}

/**
 * 매크로 신호 기반 *R1_DEFENSIVE 자동 격상* SSOT — audit-PR-520 §M4 직속 수리.
 *
 * **핵심 결함**: 기존 `REGIME_MAPPING` 은 6 → 7 매핑 (R5_CAUTION → R2_WEAK / R6_DEFENSE → R0_CRISIS)
 * 만 정의해 R1_DEFENSIVE 정책 (target 20% / max 25% / 매우 보수적) 이 *영원히 미사용*.
 *
 * **격상 규칙** (우선순위 SSOT):
 *  1. R6_DEFENSE → R0_CRISIS (기존 매핑, 매크로 신호 무관 — 시장 전체 붕괴)
 *  2. R5_CAUTION + bearDefenseMode=true → **R1_DEFENSIVE** (방어 모드 진입)
 *  3. R5_CAUTION + (vix>30 OR vkospi>30) → **R1_DEFENSIVE** (변동성 폭증)
 *  4. R5_CAUTION + (vix>25 AND dailyLossPct<-3) → **R1_DEFENSIVE** (자본 보호)
 *  5. 그 외 → 기존 `REGIME_MAPPING` 적용
 *
 * **회귀 위험 격리**:
 *  - ENV `EXPOSURE_REGIME_AUTO_MAPPING_DISABLED=true` → 격상 비활성, 기존 매핑 그대로
 *  - 매크로 입력 부재 → 기존 매핑 그대로 (NaN/undefined 모두 false 평가)
 *  - 격상은 R5_CAUTION 단일 분기만 (R3_EARLY 같은 상위 레짐은 매크로 신호 무관)
 *  - default ON — `applyExposureBudgetCap` 자체가 ENV 게이트 (`POSITION_SIZING_EXPOSURE_BUDGET_ENABLED`)
 *    뒤라 정책 활성화 시점에서만 영향
 */
export function mapInternalToExposureRegimeWithMacro(
  internal: RegimeLevel,
  macro?: ExposureRegimeMacroInput,
): MarketRegimeLevel {
  // ENV 비활성 → 기존 매핑
  if (process.env.EXPOSURE_REGIME_AUTO_MAPPING_DISABLED === 'true') {
    return mapInternalToExposureRegime(internal);
  }

  // R6_DEFENSE 는 매크로 무관 — 시장 전체 붕괴
  if (internal === 'R6_DEFENSE') {
    return 'R0_CRISIS';
  }

  // R5_CAUTION 만 매크로 격상 평가
  if (internal === 'R5_CAUTION' && macro) {
    // 우선순위 1: bearDefenseMode 활성
    if (macro.bearDefenseMode === true) {
      return 'R1_DEFENSIVE';
    }
    // 우선순위 2: 변동성 폭증 (VIX 또는 VKOSPI)
    const vixSpike = Number.isFinite(macro.vix) && (macro.vix as number) > 30;
    const vkospiSpike = Number.isFinite(macro.vkospi) && (macro.vkospi as number) > 30;
    if (vixSpike || vkospiSpike) {
      return 'R1_DEFENSIVE';
    }
    // 우선순위 3: VIX 경고 + 일일 손실 누적
    const vixWarn = Number.isFinite(macro.vix) && (macro.vix as number) > 25;
    const lossAccum = Number.isFinite(macro.dailyLossPct) && (macro.dailyLossPct as number) < -3;
    if (vixWarn && lossAccum) {
      return 'R1_DEFENSIVE';
    }
  }

  // 그 외 → 기존 매핑
  return mapInternalToExposureRegime(internal);
}

/** 매크로 자동 매핑 ENV 비활성 검사 (테스트/진단용 export) */
export function isExposureRegimeAutoMappingDisabled(): boolean {
  return process.env.EXPOSURE_REGIME_AUTO_MAPPING_DISABLED === 'true';
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

// ─── ADR-0171 — 진단 로그 10 필드 SSOT formatter ───────────────────────────

/**
 * ADR-0171 — Verbose 로그 ENV.
 * default OFF — `[Sizing-ExposureBudget]` 4 필드 (code/name/regime/qty/raw/blockReason) 출력.
 * `=true` 활성화 시 10 필드 출력 (사용자 §4 권장):
 *   targetEquityExposurePct / maxEquityExposurePct / currentExposurePct /
 *   remainingBuyBudgetToTarget / remainingBuyBudgetToMax / cappedByExposureBudget +
 *   기존 4 필드.
 *
 * 운영자 인지 부담 vs Railway 로그 비용 trade-off 격리 — 진단 시점에만 활성화.
 */
export function isExposureBudgetVerboseLogEnabled(): boolean {
  return process.env.SIZING_EXPOSURE_BUDGET_VERBOSE_LOG === 'true';
}

/**
 * 4 호출 site 공통 SSOT — drift 차단 의무.
 * 본 함수는 `console.log` *문자열만 합성* — 호출자가 로그 발행 책임.
 *
 * 우선순위 SSOT:
 *   1. budget 부재 (ENV OFF / INPUT_MISSING) → 경량 한 줄 ("skip" 마커).
 *   2. budget 존재 + verbose OFF → 4 필드 (기존 동작 byte-equivalent).
 *   3. budget 존재 + verbose ON → 10 필드.
 *
 * 차단 사유 (capResult.blockReason) 는 항상 마지막에 노출 (호출자 즉시 인지).
 */
export interface FormatExposureBudgetLogInput {
  /** 종목 코드 (6자리) */
  stockCode: string;
  /** 종목명 */
  stockName: string;
  /** 진입 경로 라벨 (PRE_BREAKOUT_FOLLOWTHROUGH / PRE_BREAKOUT 30% / INTRADAY_STRONG / 빈문자=메인 buyList) */
  pathLabel?: string;
  /** sizing 결과 quantity (legacy 또는 NewEngine) */
  rawQuantity: number;
  /** cap 적용 후 quantity (rawQuantity == finalQuantity 시 cap 미적용) */
  finalQuantity: number;
  /** ApplyExposureBudgetCap 결과 — applied=false 시 budget/capResult 부재 */
  budget?: PortfolioExposureBudget;
  capResult?: ApplyPortfolioExposureCapResult;
  /** 진단 로그 verbose 강제 (테스트 시 ENV 우회) — undefined 시 ENV gate 사용 */
  verboseOverride?: boolean;
}

export function formatExposureBudgetLog(input: FormatExposureBudgetLogInput): string {
  const pathSuffix = input.pathLabel && input.pathLabel.length > 0 ? ` (${input.pathLabel})` : '';
  const blockReason = input.capResult?.blockReason ?? '';
  const verbose = input.verboseOverride ?? isExposureBudgetVerboseLogEnabled();

  // 분기 1: budget 부재 (ENV OFF / INPUT_MISSING) — 경량 한 줄.
  if (!input.budget) {
    return (
      `[Sizing-ExposureBudget] ${input.stockCode} ${input.stockName}${pathSuffix} → ` +
      `qty=${input.finalQuantity} (raw=${input.rawQuantity}) ${blockReason}`
    ).trimEnd();
  }

  // 분기 2: budget 존재 + verbose OFF — 기존 4 필드 (regime 포함, byte-equivalent).
  if (!verbose) {
    return (
      `[Sizing-ExposureBudget] ${input.stockCode} ${input.stockName}${pathSuffix} → ` +
      `regime=${input.budget.regime} qty=${input.finalQuantity} (raw=${input.rawQuantity}) ${blockReason}`
    ).trimEnd();
  }

  // 분기 3: budget 존재 + verbose ON — 10 필드 (사용자 §4 권장).
  // 6 신규 필드: targetEquityExposurePct / maxEquityExposurePct / currentExposurePct /
  //              remainingBuyBudgetToTarget / remainingBuyBudgetToMax / cappedByExposureBudget.
  const cappedByBudget = input.capResult?.cappedByExposureBudget ?? false;
  const policy = REGIME_EXPOSURE_POLICIES[input.budget.regime];
  return (
    `[Sizing-ExposureBudget] ${input.stockCode} ${input.stockName}${pathSuffix} → ` +
    `regime=${input.budget.regime} ` +
    `targetPct=${(policy.targetEquityExposurePct * 100).toFixed(0)}% ` +
    `maxPct=${(policy.maxEquityExposurePct * 100).toFixed(0)}% ` +
    `currentPct=${(input.budget.currentExposurePct * 100).toFixed(2)}% ` +
    `toTarget=${input.budget.remainingBuyBudgetToTarget.toFixed(0)}원 ` +
    `toMax=${input.budget.remainingBuyBudgetToMax.toFixed(0)}원 ` +
    `cappedByBudget=${cappedByBudget} ` +
    `qty=${input.finalQuantity} (raw=${input.rawQuantity}) ${blockReason}`
  ).trimEnd();
}
