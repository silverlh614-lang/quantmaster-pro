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
