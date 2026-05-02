/**
 * @responsibility ADR-0162+0163+0164+0165 통합 wiring SSOT — ENV 우회 + 입력 매핑 + LIVE 활성화 진입점
 *
 * 호출자 (4 진입 경로): buyListLoop.ts 3 곳 (메인 + PRE_BREAKOUT_FOLLOWTHROUGH + PRE_BREAKOUT 30%) + intradayLoop.ts 1 곳.
 *
 * 절대 규칙:
 * 1. SHADOW 모드 활성: ENV `POSITION_SIZING_ENGINE_SHADOW_APPLY=true` 명시 (default OFF).
 * 2. LIVE 모드 활성 (ADR-0165): ENV `POSITION_SIZING_ENGINE_LIVE_ENABLED=true` 명시 (default OFF, 운영자 의무).
 *    - LIVE 활성 시 SHADOW APPLY 도 자동 활성 (LIVE only 모드 부재).
 *    - LIVE 모드 시 peakEquityMode='LIVE' 자동 매핑 → SHADOW peak 와 영속 격리.
 * 3. 입력 매핑 실패 (NaN/누락) → null 반환 = 기존 SSOT 사용 (안전 fallback).
 * 4. 본 모듈 결과 quantity < 1 → 기존 quantity 사용 (사이즈 0 진입 차단).
 */

import {
  computeFinalPosition,
  type PositionSizingInput,
  type PositionSizingResult,
  type SignalGrade,
} from './index.js';
import type { LossStreakState } from './coolingOffEngine.js';
import {
  getEffectivePeakEquity,
  updatePeakEquityIfHigher,
  type PeakEquityMode,
} from '../../persistence/peakEquityRepo.js';
import {
  computePortfolioExposureBudget,
  applyPortfolioExposureCap,
  isExposureBudgetEnabled,
  mapInternalToExposureRegime,
  type MarketRegimeLevel,
  type PortfolioExposureBudget,
  type ApplyPortfolioExposureCapResult,
} from './regimeExposurePolicy.js';
import type { RegimeLevel } from '../../../src/types/core.js';

// ─── ENV 우회 SSOT ──────────────────────────────────────────────────────────

/**
 * 본 모듈 적용 여부 결정 — ENV + 모드 분기 SSOT.
 *
 * 활성 조건 (모드별 OR):
 *   - SHADOW: `shadowMode === true` AND `POSITION_SIZING_ENGINE_SHADOW_APPLY === 'true'`
 *   - LIVE (ADR-0165): `shadowMode === false` AND `isLivePositionSizingEngineEnabled() === true`
 *     (LIVE ENV 활성 시 SHADOW ENV 자동 활성 — LIVE only 모드 부재)
 *
 * default 둘 다 OFF — PR 머지 후 운영자가 명시 활성화 의무.
 */
export function shouldApplyPositionSizingEngine(shadowMode: boolean): boolean {
  if (shadowMode) {
    return process.env.POSITION_SIZING_ENGINE_SHADOW_APPLY === 'true';
  }
  // LIVE 모드 — ADR-0165 활성화 정책
  return isLivePositionSizingEngineEnabled();
}

/**
 * ADR-0165 — LIVE 모드 활성화 정책 (ENV 기반 동적 결정).
 *
 * 활성 조건: `process.env.POSITION_SIZING_ENGINE_LIVE_ENABLED === 'true'`.
 * default OFF — 운영자가 SHADOW 1주 검증 후 명시 활성화 의무.
 *
 * 활성 시 효과:
 * - LIVE 모드에서도 본 모듈 결정 사용 (사이징 직접 영향)
 * - LIVE peak 자동 갱신 (`livePeakEquity` 영속 활성)
 * - 사용자 자본 (LIVE 시 재확인) 정확한 6 티어 매트릭스 적용
 */
export function isLivePositionSizingEngineEnabled(): boolean {
  return process.env.POSITION_SIZING_ENGINE_LIVE_ENABLED === 'true';
}

// ─── 입력 매핑 (안전 fallback) ──────────────────────────────────────────────

/**
 * buyListLoop ctx + stock 메타에서 PositionSizingInput 합성.
 * 누락/NaN 입력은 안전 default 로 fallback (본 모듈이 panic 차단 안 하도록).
 *
 * @returns 매핑 성공 시 PositionSizingInput, 매핑 불가 (필수 입력 누락) 시 null.
 */
export interface MapToInputContext {
  totalAssets: number;
  shadowEntryPrice: number;
  stopLoss: number;
  signalGrade: SignalGrade;
  regimeKelly: number;
  confidenceModifier: number;
  rrr: number;
  marketCap?: number;
  avgDailyVolume20d?: number;
  isAdminStock?: boolean;
  isInvestmentWarning?: boolean;
  currentSectorWeight?: number;
  isNormalRegime: boolean;
  enemyChecklistPassed: boolean;
  highDataReliability: boolean;
  gate1AllPassed: boolean;
  notInDowntrend: boolean;
  /** 외부 SSOT 에서 조회 — null 이면 default streak (0건) 사용 */
  lossStreakState?: LossStreakState | null;
  /**
   * ADR-0164 — peakEquity 영속 SSOT 모드 (SHADOW vs LIVE 분리).
   * 미전달 시 'SHADOW' default (본 PR scope 는 SHADOW only — LIVE wiring 후속 PR).
   */
  peakEquityMode?: PeakEquityMode;
  /**
   * ADR-0166 — 레짐 노출 예산 입력 (옵셔널).
   * 호출자 명시 전달 시 `applyExposureBudgetCap` 통합 진입점에서 사용.
   * 미전달 또는 ENV OFF 시 sizing 결과 그대로 (exposure cap 미적용).
   */
  currentEquityExposureAmount?: number;
  currentCashAmount?: number;
  /**
   * ADR-0166 — 신규 매수 vs 추매 분류 (호출자 결정).
   * 본 모듈은 *분류만 사용*, 실제 주문 결정은 호출자 책임.
   */
  isAddOnBuy?: boolean;
}

export function mapToPositionSizingInput(ctx: MapToInputContext): PositionSizingInput | null {
  if (!Number.isFinite(ctx.totalAssets) || ctx.totalAssets <= 0) return null;
  if (!Number.isFinite(ctx.shadowEntryPrice) || ctx.shadowEntryPrice <= 0) return null;
  if (!Number.isFinite(ctx.stopLoss) || ctx.stopLoss <= 0 || ctx.stopLoss >= ctx.shadowEntryPrice) return null;

  const stopLossPct = (ctx.shadowEntryPrice - ctx.stopLoss) / ctx.shadowEntryPrice;
  if (!Number.isFinite(stopLossPct) || stopLossPct <= 0) return null;

  const defaultLossStreak: LossStreakState = ctx.lossStreakState ?? {
    consecutiveLosses: 0,
    lastLossDate: null,
    coolOffUntil: null,
  };

  // ADR-0164 — peakEquity 영속 SSOT (drawdown 자동 차단 입력).
  // mode 미전달 시 SHADOW default (LIVE wiring 부재 — 본 PR scope 밖).
  // 영속 부재 / 0 시 안전 fallback (currentEquity = peakEquity → drawdown 0).
  const mode: PeakEquityMode = ctx.peakEquityMode ?? 'SHADOW';
  const peakEquity = getEffectivePeakEquity(mode, ctx.totalAssets);

  return {
    accountEquity: ctx.totalAssets,
    peakEquity,
    signalGrade: ctx.signalGrade,
    stopLossPct,
    regimeMultiplier: Number.isFinite(ctx.regimeKelly) && ctx.regimeKelly > 0 ? ctx.regimeKelly : 1.0,
    confidenceMultiplier: Number.isFinite(ctx.confidenceModifier) && ctx.confidenceModifier > 0 ? ctx.confidenceModifier : 1.0,
    rrrMultiplier: ctx.rrr >= 2.0 ? 1.0 : 0,
    correlationMultiplier: 1.0,
    lossStreakState: defaultLossStreak,
    // 안전 fallback — 입력 누락 시 본 모듈이 *기준 미달* 로 자동 차단 (universe 기준)
    avgDailyVolume20d: ctx.avgDailyVolume20d ?? 0,
    marketCap: ctx.marketCap ?? 0,
    isAdminStock: ctx.isAdminStock ?? false,
    isInvestmentWarning: ctx.isInvestmentWarning ?? false,
    currentSectorWeight: ctx.currentSectorWeight ?? 0,
    isNormalRegime: ctx.isNormalRegime,
    rrrAbove2_5: ctx.rrr >= 2.5,
    enemyChecklistPassed: ctx.enemyChecklistPassed,
    highDataReliability: ctx.highDataReliability,
    gate1AllPassed: ctx.gate1AllPassed,
    notInDowntrend: ctx.notInDowntrend,
  };
}

// ─── 통합 진입점 ────────────────────────────────────────────────────────────

export interface ApplyPositionSizingResult {
  /** 본 모듈 적용 여부 — false 면 호출자가 기존 quantity 사용 의무 */
  applied: boolean;
  /** 적용 시 계산된 quantity (주식 수) — applied=false 면 0 */
  quantity: number;
  /** 사이징 marker — 호출자가 trade 영속에 부착 */
  sizingSource: 'NEW_TIER_ENGINE' | 'LEGACY_SSOT';
  /** 적용 시 본 모듈 결과 — 운영자 검증/스냅샷 영속용 */
  result?: PositionSizingResult;
  /** 미적용 사유 (진단 로그용) */
  skipReason?: 'ENV_DISABLED' | 'LIVE_MODE' | 'INPUT_MAPPING_FAILED' | 'BLOCKED_BY_ENGINE' | 'QUANTITY_BELOW_ONE';
}

/**
 * 본 PR 의 단일 진입점 — buyListLoop 가 ENV/모드 분기 없이 호출 가능.
 *
 * 4 분기:
 *   1. ENV OFF or LIVE → applied=false, sizingSource='LEGACY_SSOT', skipReason 명시
 *   2. 입력 매핑 실패 → applied=false, sizingSource='LEGACY_SSOT'
 *   3. computeFinalPosition blocked → applied=false, sizingSource='LEGACY_SSOT' (학습 격리 — 본 모듈이 차단해도 LEGACY 그대로)
 *   4. 정상 산출 + quantity ≥ 1 → applied=true, sizingSource='NEW_TIER_ENGINE'
 */
export function applyPositionSizingEngine(
  shadowMode: boolean,
  ctx: MapToInputContext,
): ApplyPositionSizingResult {
  if (!shouldApplyPositionSizingEngine(shadowMode)) {
    // ADR-0165 — skip 사유 분기:
    // SHADOW + ENV OFF → ENV_DISABLED
    // LIVE + ENV OFF → LIVE_MODE (LIVE 활성화 ENV 미설정)
    return {
      applied: false,
      quantity: 0,
      sizingSource: 'LEGACY_SSOT',
      skipReason: shadowMode ? 'ENV_DISABLED' : 'LIVE_MODE',
    };
  }

  // ADR-0164+0165 — peakEquity 자동 갱신 hook (mode 자동 결정).
  // 호출자 ctx.peakEquityMode 명시 우선, 미전달 시 shadowMode 기반 자동 결정 (SHADOW vs LIVE 격리).
  // 갱신 실패 (영속 throw) 는 silent skip — 매매 흐름 무중단.
  const peakMode: PeakEquityMode = ctx.peakEquityMode ?? (shadowMode ? 'SHADOW' : 'LIVE');
  try {
    const updated = updatePeakEquityIfHigher(peakMode, ctx.totalAssets);
    if (updated) {
      console.log(`[PeakEquity] ${peakMode} peak 갱신 → ${ctx.totalAssets.toLocaleString()}원`);
    }
  } catch (err) {
    console.warn(`[PeakEquity] ${peakMode} 갱신 실패 (안전 통과): ${(err as Error).message}`);
  }

  // ADR-0165 — peakMode 자동 결정 결과를 ctx 에 주입하여 mapToPositionSizingInput 정합 보장.
  // 호출자가 명시 전달한 경우 보존, 미전달 시 자동 결정값 사용.
  const input = mapToPositionSizingInput({ ...ctx, peakEquityMode: peakMode });
  if (!input) {
    return {
      applied: false,
      quantity: 0,
      sizingSource: 'LEGACY_SSOT',
      skipReason: 'INPUT_MAPPING_FAILED',
    };
  }

  const result = computeFinalPosition(input);
  if (result.blocked) {
    return {
      applied: false,
      quantity: 0,
      sizingSource: 'LEGACY_SSOT',
      skipReason: 'BLOCKED_BY_ENGINE',
      result,
    };
  }

  const quantity = Math.floor(result.finalPosition / ctx.shadowEntryPrice);
  if (quantity < 1) {
    return {
      applied: false,
      quantity: 0,
      sizingSource: 'LEGACY_SSOT',
      skipReason: 'QUANTITY_BELOW_ONE',
      result,
    };
  }

  return {
    applied: true,
    quantity,
    sizingSource: 'NEW_TIER_ENGINE',
    result,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// ADR-0166 — 레짐 노출 예산 통합 진입점 (positionSizingEngine 상위 계층)
// ═══════════════════════════════════════════════════════════════════════════

export interface ApplyExposureBudgetCapInput {
  /** sizing 단계 결과 quantity (applyPositionSizingEngine.quantity 또는 legacy quantity) */
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
  /** 호출자 명시 매핑 — 미전달 시 mapInternalToExposureRegime 자동 적용 */
  exposureRegime?: MarketRegimeLevel;
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
 *   const sizingApply = applyPositionSizingEngine(shadowMode, ctx);
 *   const baseQty = sizingApply.applied ? sizingApply.quantity : legacyQuantity;
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

  const exposureRegime = input.exposureRegime ?? mapInternalToExposureRegime(input.regime);

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
