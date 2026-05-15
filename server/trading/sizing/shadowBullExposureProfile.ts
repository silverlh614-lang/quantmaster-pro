/**
 * @responsibility PATCH-010 — Shadow/LIVE 레짐 노출 프로파일 분리 SSOT + 종목별 소액 매수 floor 보정
 *
 * 문제: R2/R3 불싸이클 Shadow 에서 STANDARD 후보의 positionPct 가 멀티플라이어 누적
 *       (R2_BULL kellyMultiplier ×0.8 × STANDARD tier ×0.6 × MTAS ×0.3~0.5 × ...) 으로
 *       0.2~0.5% 까지 축소되어 휴젤(284,000원) 같은 고가주가 1주만 매수되는 과소 사이징.
 *
 * 해결: 레짐별 per-candidate positionPct 하한(floor) 을 둔다.
 *   - SHADOW 프로파일: aggressive — R2/R3 불싸이클(exposure R5_BULL/R4_RECOVERY) floor 1.5~2.0%
 *   - LIVE 프로파일:   conservative — floor 전면 0.0% (현행 동작 100% 보존)
 *
 * 절대 규칙:
 *   1. ENV `SHADOW_BULL_EXPOSURE_FLOOR_ENABLED=true` 활성 시만 동작 (default OFF, ADR-0157 정확 비교).
 *   2. floor 는 soft shrink 뒤에 적용되는 최종 하한 — soft shrink 가 floor 아래로 깎지 못한다.
 *      hard block (SELL_ONLY/emergencyStop/R6_DEFENSE) 은 buyListLoop 진입 전 또는 bull 레짐 외이므로
 *      본 모듈이 floor 를 적용하지 않는다 (bull 레짐 외 floor 0.0).
 *   3. PROBING 티어는 의도된 소액 탐색이므로 floor 미적용.
 *   4. ENV OFF / 미적용 시 effectivePositionPct === computedPositionPct (byte-equivalent).
 */

import { mapInternalToExposureRegime, type MarketRegimeLevel } from './regimeExposurePolicy.js';
import type { RegimeLevel } from '../../../src/types/core.js';
import type { SizingTier } from '../sizingTier.js';

export type ExposureProfileMode = 'SHADOW' | 'LIVE';

export interface RegimeExposureProfile {
  regime: MarketRegimeLevel;
  /** 계좌 총 목표 노출률 — 진단/UI 용 (floor 산출 입력 아님, §17 후속 PR scope) */
  accountTargetExposurePct: number;
  /** 후보 1종목 positionPct 하한 — bull 레짐 한정 (소액 매수 오류 보정) */
  candidateFloorPct: number;
}

/**
 * SHADOW 프로파일 — aggressive.
 * R2/R3 불싸이클(exposure R5_BULL/R4_RECOVERY) 에서 STANDARD 후보 floor 1.5~2.0% 보장.
 * accountTargetExposurePct 는 PATCH-010 spec "R2/R3 80~90%" 정합 (진단용).
 */
export const SHADOW_REGIME_EXPOSURE_PROFILE: Readonly<Record<MarketRegimeLevel, RegimeExposureProfile>> =
  Object.freeze({
    R6_STRONG_BULL: { regime: 'R6_STRONG_BULL', accountTargetExposurePct: 0.90, candidateFloorPct: 0.025 },
    R5_BULL: { regime: 'R5_BULL', accountTargetExposurePct: 0.85, candidateFloorPct: 0.02 },
    R4_RECOVERY: { regime: 'R4_RECOVERY', accountTargetExposurePct: 0.80, candidateFloorPct: 0.015 },
    R3_NEUTRAL: { regime: 'R3_NEUTRAL', accountTargetExposurePct: 0.45, candidateFloorPct: 0.0 },
    R2_WEAK: { regime: 'R2_WEAK', accountTargetExposurePct: 0.30, candidateFloorPct: 0.0 },
    R1_DEFENSIVE: { regime: 'R1_DEFENSIVE', accountTargetExposurePct: 0.20, candidateFloorPct: 0.0 },
    R0_CRISIS: { regime: 'R0_CRISIS', accountTargetExposurePct: 0.0, candidateFloorPct: 0.0 },
  });

/**
 * LIVE 프로파일 — conservative.
 * candidateFloorPct 전면 0.0 → LIVE 경로는 현행 사이징 100% 보존.
 * accountTargetExposurePct 는 ADR-0166 REGIME_EXPOSURE_POLICIES 와 정합 (진단용).
 */
export const LIVE_REGIME_EXPOSURE_PROFILE: Readonly<Record<MarketRegimeLevel, RegimeExposureProfile>> =
  Object.freeze({
    R6_STRONG_BULL: { regime: 'R6_STRONG_BULL', accountTargetExposurePct: 0.85, candidateFloorPct: 0.0 },
    R5_BULL: { regime: 'R5_BULL', accountTargetExposurePct: 0.75, candidateFloorPct: 0.0 },
    R4_RECOVERY: { regime: 'R4_RECOVERY', accountTargetExposurePct: 0.60, candidateFloorPct: 0.0 },
    R3_NEUTRAL: { regime: 'R3_NEUTRAL', accountTargetExposurePct: 0.45, candidateFloorPct: 0.0 },
    R2_WEAK: { regime: 'R2_WEAK', accountTargetExposurePct: 0.30, candidateFloorPct: 0.0 },
    R1_DEFENSIVE: { regime: 'R1_DEFENSIVE', accountTargetExposurePct: 0.20, candidateFloorPct: 0.0 },
    R0_CRISIS: { regime: 'R0_CRISIS', accountTargetExposurePct: 0.0, candidateFloorPct: 0.0 },
  });

/** ENV 우회 SSOT — default OFF, ADR-0157 정확 비교. */
export function isShadowBullExposureFloorEnabled(): boolean {
  return process.env.SHADOW_BULL_EXPOSURE_FLOOR_ENABLED === 'true';
}

/** 모드별 레짐 노출 프로파일 조회 SSOT. */
export function getRegimeExposureProfile(
  mode: ExposureProfileMode,
  regime: RegimeLevel,
): RegimeExposureProfile {
  const exposureRegime = mapInternalToExposureRegime(regime);
  return mode === 'SHADOW'
    ? SHADOW_REGIME_EXPOSURE_PROFILE[exposureRegime]
    : LIVE_REGIME_EXPOSURE_PROFILE[exposureRegime];
}

export interface CandidateFloorInput {
  /** 종목 단위 Shadow 모드 (buyListLoop stockShadowMode) */
  shadowMode: boolean;
  /** 내부 레짐 (RegimeLevel — exposure 레짐으로 자동 매핑) */
  regime: RegimeLevel;
  /** 사이징 티어 (PROBING 은 의도된 소액 탐색 → floor 미적용) */
  tier: SizingTier;
  /** 멀티플라이어 누적 후 산출된 positionPct */
  computedPositionPct: number;
}

export interface CandidateFloorResult {
  /** floor 적용 여부 — false 면 effectivePositionPct === computedPositionPct */
  applied: boolean;
  /** SHADOW vs LIVE 프로파일 */
  mode: ExposureProfileMode;
  /** 매핑된 exposure 레짐 */
  exposureRegime: MarketRegimeLevel;
  /** 해당 모드/레짐 floor (적용 안 돼도 진단용으로 노출) */
  floorPct: number;
  /** Math.max(computedPositionPct, floorPct) — 미적용 시 computedPositionPct 그대로 */
  effectivePositionPct: number;
  /** 미적용 사유 (진단 로그용) */
  skipReason?:
    | 'ENV_DISABLED'
    | 'NO_FLOOR'
    | 'PROBING_TIER_EXCLUDED'
    | 'ALREADY_ABOVE_FLOOR'
    | 'INVALID_POSITION_PCT';
}

/**
 * 후보 positionPct 하한 결정 SSOT.
 *
 * 결정 트리:
 *   1. ENV OFF → applied=false / skipReason='ENV_DISABLED'
 *   2. floorPct <= 0 (bull 레짐 외 또는 LIVE 프로파일) → applied=false / skipReason='NO_FLOOR'
 *   3. tier === 'PROBING' → applied=false / skipReason='PROBING_TIER_EXCLUDED'
 *   4. positionPct 비유한값 → applied=false / skipReason='INVALID_POSITION_PCT' (안전 fallback)
 *   5. positionPct >= floorPct → applied=false / skipReason='ALREADY_ABOVE_FLOOR'
 *   6. 그 외 → applied=true / effectivePositionPct = floorPct
 */
export function resolveCandidatePositionFloor(input: CandidateFloorInput): CandidateFloorResult {
  const mode: ExposureProfileMode = input.shadowMode ? 'SHADOW' : 'LIVE';
  const profile = getRegimeExposureProfile(mode, input.regime);
  const floorPct = profile.candidateFloorPct;
  const base: Omit<CandidateFloorResult, 'applied' | 'effectivePositionPct' | 'skipReason'> = {
    mode,
    exposureRegime: profile.regime,
    floorPct,
  };

  if (!isShadowBullExposureFloorEnabled()) {
    return { ...base, applied: false, effectivePositionPct: input.computedPositionPct, skipReason: 'ENV_DISABLED' };
  }
  if (floorPct <= 0) {
    return { ...base, applied: false, effectivePositionPct: input.computedPositionPct, skipReason: 'NO_FLOOR' };
  }
  if (input.tier === 'PROBING') {
    return {
      ...base,
      applied: false,
      effectivePositionPct: input.computedPositionPct,
      skipReason: 'PROBING_TIER_EXCLUDED',
    };
  }
  if (!Number.isFinite(input.computedPositionPct)) {
    return {
      ...base,
      applied: false,
      effectivePositionPct: input.computedPositionPct,
      skipReason: 'INVALID_POSITION_PCT',
    };
  }
  if (input.computedPositionPct >= floorPct) {
    return {
      ...base,
      applied: false,
      effectivePositionPct: input.computedPositionPct,
      skipReason: 'ALREADY_ABOVE_FLOOR',
    };
  }
  return { ...base, applied: true, effectivePositionPct: floorPct };
}
