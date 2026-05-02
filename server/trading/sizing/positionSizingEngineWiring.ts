/**
 * @responsibility ADR-0162 Phase 2-D wiring SSOT — ENV 우회 + 입력 매핑 + 안전 fallback 진입점
 *
 * 호출자: `server/trading/signalScanner/perSymbol/buyListLoop.ts` 메인 buyList 한 곳만.
 * PRE_BREAKOUT_FOLLOWTHROUGH / PRE_BREAKOUT / INTRADAY_STRONG 3 곳은 후속 PR.
 *
 * 절대 규칙:
 * 1. ENV `POSITION_SIZING_ENGINE_SHADOW_APPLY` 미설정 또는 'true' 외 값 → 본 모듈 미적용 (기존 SSOT 100% 보존).
 * 2. LIVE 모드 (`shadowMode=false`) → 본 모듈 미적용 (LIVE 회귀 위험 격리, 후속 PR 별도 ENV).
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

// ─── ENV 우회 SSOT ──────────────────────────────────────────────────────────

/**
 * 본 모듈 적용 여부 결정 — ENV `POSITION_SIZING_ENGINE_SHADOW_APPLY` + 모드 분기.
 *
 * 활성 조건 (모두 충족):
 *   1. `shadowMode === true` (SHADOW 모드만, LIVE 회귀 위험 격리)
 *   2. `process.env.POSITION_SIZING_ENGINE_SHADOW_APPLY === 'true'` (명시 활성화)
 *
 * default OFF — PR 머지 후 운영자가 명시 활성화 의무.
 */
export function shouldApplyPositionSizingEngine(shadowMode: boolean): boolean {
  if (!shadowMode) return false; // LIVE 회귀 위험 격리
  return process.env.POSITION_SIZING_ENGINE_SHADOW_APPLY === 'true';
}

/**
 * ADR-0162 §"잘못된 해결 방법" 영구 차단 — LIVE 활성화는 별도 ENV `_LIVE_ENABLED=true` (후속 PR).
 * 본 함수는 *현재 PR scope 외* — 후속 PR 도입 시점에 본 모듈에 추가될 자리.
 */
export function isLivePositionSizingEngineEnabled(): boolean {
  // 후속 PR (Phase 3) 에서 활성화. 본 PR 시점은 영원히 false.
  return false;
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

  return {
    accountEquity: ctx.totalAssets,
    // 현재 = 고점 가정 (drawdown 추적은 후속 PR — peakEquity 영속 SSOT 필요)
    peakEquity: ctx.totalAssets,
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
    return {
      applied: false,
      quantity: 0,
      sizingSource: 'LEGACY_SSOT',
      skipReason: shadowMode ? 'ENV_DISABLED' : 'LIVE_MODE',
    };
  }

  const input = mapToPositionSizingInput(ctx);
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
