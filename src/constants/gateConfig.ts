// ─── 3-Gate 시스템 공유 상수 ──────────────────────────────────────────────────
// GateWizard, GateStatusWidget, WeightConfigPanel 등에서 공통 사용

import type { ConditionId } from '../types/core';

/** Gate 1 — 생존필터: 5개 필수 조건 (ALL must pass) */
export const GATE1_IDS = [1, 3, 5, 7, 9] as const;
/** Gate 2 — 성장검증: 12개 중 9개 이상 통과 */
export const GATE2_IDS = [4, 6, 8, 10, 11, 12, 13, 14, 15, 16, 21, 24] as const;
/** Gate 3 — 타이밍: 10개 중 7개 이상 통과 */
export const GATE3_IDS = [2, 17, 18, 19, 20, 22, 23, 25, 26, 27] as const;

export const GATE1_REQUIRED = 5;
export const GATE2_REQUIRED = 9;
export const GATE3_REQUIRED = 7;

/** 개별 조건 통과 임계값 (0-10 스케일) */
export const CONDITION_PASS_THRESHOLD = 5;

// ─── RAGT — Regime-Aware Gate Threshold ──────────────────────────────────────
// "시장은 필터링 대상" 페르소나 철학을 레짐 단위로 다층화한다.
// 강세장은 문턱을 낮춰 기회를 잡고, 약세/위기장은 문턱을 올려 진입을 까다롭게 한다.

/** 6단계 레짐 식별자 (server REGIME_LEVELS 와 정렬) */
export type RegimeId =
  | 'R1_TURBO'
  | 'R2_BULL'
  | 'R3_EARLY'
  | 'R4_NEUTRAL'
  | 'R5_CAUTION'
  | 'R6_DEFENSE';

export interface GateThresholdSet {
  /** Gate 1 — 5개 필수 조건 중 필요한 통과 수 (재검증) */
  gate1Required: number;
  /** Gate 2 — 12개 중 통과 필요 수 */
  gate2Required: number;
  /** Gate 3 — 10개 중 통과 필요 수 */
  gate3Required: number;
}

/**
 * 레짐별 동적 게이트 문턱.
 *   R1 Turbo:    8/12 (강세 — 기회 우선)
 *   R2 Bull:     8/12
 *   R3 Early:    9/12 (기본)
 *   R4 Neutral:  9/12
 *   R5 Caution: 10/12 (약세 — 보수)
 *   R6 Defense: 11/12 + Gate 1 5/5 (위기 — 매수 거의 차단)
 */
export const REGIME_GATE_THRESHOLDS: Record<RegimeId, GateThresholdSet> = {
  R1_TURBO:   { gate1Required: 5, gate2Required: 8,  gate3Required: 6 },
  R2_BULL:    { gate1Required: 5, gate2Required: 8,  gate3Required: 6 },
  R3_EARLY:   { gate1Required: 5, gate2Required: 9,  gate3Required: 7 },
  R4_NEUTRAL: { gate1Required: 5, gate2Required: 9,  gate3Required: 7 },
  R5_CAUTION: { gate1Required: 5, gate2Required: 10, gate3Required: 8 },
  R6_DEFENSE: { gate1Required: 5, gate2Required: 11, gate3Required: 9 },
};

const DEFAULT_THRESHOLDS: GateThresholdSet = {
  gate1Required: GATE1_REQUIRED,
  gate2Required: GATE2_REQUIRED,
  gate3Required: GATE3_REQUIRED,
};

/**
 * 현재 레짐에 맞는 게이트 통과 문턱을 반환한다.
 * 알 수 없는 레짐은 기본값 (5/9/7) 으로 폴백.
 */
export function getDynamicGateThreshold(regime: string | null | undefined): GateThresholdSet {
  if (!regime) return DEFAULT_THRESHOLDS;
  return REGIME_GATE_THRESHOLDS[regime as RegimeId] ?? DEFAULT_THRESHOLDS;
}
