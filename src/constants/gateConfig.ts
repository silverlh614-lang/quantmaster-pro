// @responsibility gateConfig 모듈
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

/**
 * 개별 조건 값을 0~10 스케일 점수로 정규화한다.
 *
 * `StockRecommendation.checklist` 는 생성 경로에 따라 boolean(Gemini) 또는 0/1
 * (DART·KRX enrichment) 로 채워지지만, 게이트/후보판정 소비자는 0~10 스케일에서
 * `CONDITION_PASS_THRESHOLD`(=5) 이상을 통과로 판정한다. 정규화 없이 직접 비교하면
 * `true`(non-number) 와 `1`(< 5) 이 모두 0점 처리되어 27개 항목 전부 미충족 →
 * 게이트가 항상 "FAILED AT GATE 1" 로 박제되는 결함이 발생한다. 이 함수가 이진/점수
 * 두 척도를 0~10 으로 일치시킨다.
 *   - boolean true              → 10 (통과)
 *   - 이진 숫자 1 (통과 플래그)  → 10
 *   - 이미 0~10 점수             → 그대로(clamp)
 *   - false / 0 / null / 비정상  → 0
 */
export function normalizeChecklistScore(value: unknown): number {
  if (value === true) return 10;
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value <= 1) return 10; // 이진 1 = 통과 → 10 으로 승격
  return Math.min(value, 10); // 0~10 점수 보존(clamp)
}

/** 조건 통과 여부 — 정규화 점수가 임계값 이상인지. checklist 이진/0~10 모두 안전. */
export function isChecklistConditionMet(value: unknown): boolean {
  return normalizeChecklistScore(value) >= CONDITION_PASS_THRESHOLD;
}

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

interface GateThresholdSet {
  /** Gate 1 — 5개 필수 조건 중 필요한 통과 수 (재검증) */
  gate1Required: number;
  /** Gate 2 — 12개 중 통과 필요 수 */
  gate2Required: number;
  /** Gate 3 — 10개 중 통과 필요 수 */
  gate3Required: number;
}

const DEFAULT_THRESHOLDS: GateThresholdSet = {
  gate1Required: GATE1_REQUIRED,
  gate2Required: GATE2_REQUIRED,
  gate3Required: GATE3_REQUIRED,
};
// ─── Gate Score Band — STRONG / NORMAL / SKIP 레짐별 차등 ───────────────────
// evaluateServerGate는 그동안 STRONG ≥ 7, NORMAL ≥ 5 고정이었다.
// 레짐이 gate2/gate3 통과 '개수'만 조절하는 건 반쪽짜리 적응이므로
// 여기서 '점수 밴드'까지 레짐에 따라 변하도록 한다.
//
//   - 강세 초기(RISK_ON_EARLY ≈ R1/R3): NORMAL을 4.0까지 완화해 기회 포착
//   - 약세 조정(RISK_OFF_CORRECTION ≈ R5): NORMAL을 6.0로 강화해 보수 운영
//   - R6_DEFENSE: 사실상 차단 (NORMAL=999, 상위 레이어에서 매수 거부)

export interface GateScoreBand {
  /** STRONG 신호 최소 점수 — 최대 포지션 */
  strong: number;
  /** NORMAL 신호 최소 점수 — 표준 포지션 */
  normal: number;
}

/**
 * 레짐별 Gate Score 밴드.
 * server/trading/gateConfig.ts의 `GATE_SCORE_THRESHOLD_BY_REGIME`(NORMAL 전용)
 * 과 값이 정렬되어 있어야 한다 — 해당 파일이 이 상수를 단일 소스로 사용한다.
 */
export const GATE_SCORE_THRESHOLD_BY_REGIME: Record<RegimeId, GateScoreBand> = {
  R1_TURBO:   { strong: 6,   normal: 4   }, // RISK_ON_EARLY — 문턱 완화
  R2_BULL:    { strong: 7,   normal: 5   },
  R3_EARLY:   { strong: 6,   normal: 4   }, // RISK_ON_EARLY — 문턱 완화
  R4_NEUTRAL: { strong: 7,   normal: 5   }, // 기본
  R5_CAUTION: { strong: 8,   normal: 6   }, // RISK_OFF_CORRECTION — 문턱 강화
  R6_DEFENSE: { strong: 8,   normal: 6   }, // adjustment-only; no execution block
};

const DEFAULT_SCORE_BAND: GateScoreBand = { strong: 7, normal: 5 };

/** 레짐에 맞는 STRONG/NORMAL 밴드. 알 수 없는 레짐은 7/5 폴백. */
export function getRegimeGateScoreBand(regime: string | null | undefined): GateScoreBand {
  if (!regime) return DEFAULT_SCORE_BAND;
  return GATE_SCORE_THRESHOLD_BY_REGIME[regime as RegimeId] ?? DEFAULT_SCORE_BAND;
}
