/**
 * @responsibility 27조건 source 별 학습 가중치 multiplier SSOT — AI 환각 보정
 *
 * ADR-0020 (PR-C): COMPUTED 100% / AI 40% 차등 학습 multiplier.
 * `feedbackLoopEngine` 의 가중치 변경량(WEIGHT_STEP) 에 곱해져 AI 추정 조건이
 * 환각으로 학습을 오염시키지 않도록 보정.
 */
import type { ConditionId } from '../../types/core';
import { CONDITION_SOURCE_MAP } from './evolutionEngine';

export type ConditionSource = 'COMPUTED' | 'AI';

/**
 * Source 별 학습 가중치 변경량 multiplier.
 *
 * - COMPUTED: 1.0 (100%) — 가격/지표 결정적 데이터, 환각 없음
 * - AI: 0.4 (40%) — Gemini 해석 추정값, 환각 위험 보정
 *
 * 향후 'API'/'MANUAL' 등급이 SOURCE_MAP 에 추가되면 본 SSOT 에서 multiplier 만
 * 추가하면 된다.
 */
export const SOURCE_LEARNING_MULTIPLIER: Record<ConditionSource, number> = {
  COMPUTED: 1.0,
  AI: 0.4,
};

/**
 * 환경 변수 — 긴급 롤백 스위치. true 면 모든 조건이 multiplier=1.0 으로
 * fallback (PR-C 이전 동작 복원). 브라우저 환경에서 process 미정의 시
 * 자동으로 disable 되지 않음.
 */
export function isSourceWeightingDisabled(): boolean {
  if (typeof process === 'undefined' || !process.env) return false;
  return process.env.LEARNING_SOURCE_WEIGHTING_DISABLED === 'true';
}

/**
 * 특정 ConditionId 의 학습 multiplier 를 반환한다.
 *
 * @param conditionId 1~27
 * @param overrideSource trade.conditionSources 같은 trade-level override (옵셔널)
 * @returns 0~1 범위 multiplier
 */
export function getSourceMultiplier(
  conditionId: ConditionId,
  overrideSource?: ConditionSource,
): number {
  if (isSourceWeightingDisabled()) return 1.0;
  const source = overrideSource ?? CONDITION_SOURCE_MAP[conditionId];
  if (!source) return 1.0; // 알 수 없는 source 는 안전하게 100% (clamp 가 폭주 차단)
  const m = SOURCE_LEARNING_MULTIPLIER[source];
  return typeof m === 'number' && Number.isFinite(m) && m >= 0 ? m : 1.0;
}

/**
 * 특정 ConditionId 의 source 를 반환한다 (trade-level override 우선, 부재 시 SSOT).
 */
export function resolveSource(
  conditionId: ConditionId,
  overrideSource?: ConditionSource,
): ConditionSource {
  return overrideSource ?? CONDITION_SOURCE_MAP[conditionId];
}
