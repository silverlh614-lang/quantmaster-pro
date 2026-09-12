/**
 * @responsibility Preserve disabled legacy sizing compatibility.
 * ADR-0665: active entry paths use entrySizingPolicy.ts.
 * The legacy Kelly sizing switch always returns false regardless of ENV.
 * Exposure-cap exports below delegate to the active entry sizing boundary.
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

// ─── ENV 우회 SSOT ──────────────────────────────────────────────────────────

/** Legacy compatibility switch; always disabled regardless of mode or ENV. */
export function shouldApplyPositionSizingEngine(shadowMode: boolean): boolean {
  void shadowMode;
  // Simplification Step 2: Kelly/probability-based sizing engine is disabled.
  // Callers fall back to the regime-only position policy SSOT.
  return false;
}

/** Read the legacy diagnostic ENV flag; this does not activate entry sizing. */
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
  sizingSource: 'NEW_TIER_ENGINE' | 'LEGACY_SSOT' | 'LIVE_SIZING_MIRROR';
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
    sizingSource: shadowMode ? 'LIVE_SIZING_MIRROR' : 'NEW_TIER_ENGINE',
    result,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// ADR-0166 — 레짐 노출 예산 통합 진입점 (positionSizingEngine 상위 계층)
// ═══════════════════════════════════════════════════════════════════════════

// ADR-0665: compatibility exports; active exposure implementation lives in entrySizingPolicy.
export { applyExposureBudgetCap } from './entrySizingPolicy.js';
export type { ApplyExposureBudgetCapInput, ApplyExposureBudgetCapResult } from './entrySizingPolicy.js';
