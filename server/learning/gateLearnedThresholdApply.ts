// @responsibility counterfacture_gate Phase D — flag-gated·window-clamped 학습 임계 적용 resolver + gateConfig 등록(operator-gated, default OFF).
/**
 * gateLearnedThresholdApply.ts (counterfacture_gate Phase D)
 *
 * operator 승인분(gateLearnedThresholdRepo)을 live Gate1 임계로 적용하는 유일한 경로.
 * 3중 안전:
 *   1. ENV COUNTERFACTURE_GATE_APPLY_ENABLED=true (default OFF) — 미설정 시 항상 null.
 *   2. operator 승인분이 store 에 존재해야 함(권고 엔진은 자동 기록 안 함).
 *   3. [getRegimeAwareGate1RequiredScore(regime), LEGACY_GATE1_REQUIRED_SCORE] 창으로 clamp
 *      — anchor 70 보존(완화는 70 미만으로만), regime-aware 바닥 아래로 못 내려감.
 *
 * registerCounterfactureGateApply() 는 서버 기동에서 자동 호출하지 않는다(명시 operator 배선 전용).
 * 등록돼도 flag OFF 면 resolver 가 null → resolveGate1RequiredScore byte-identical.
 */

import {
  LEGACY_GATE1_REQUIRED_SCORE,
  getRegimeAwareGate1RequiredScore,
  registerLearnedGate1ThresholdProvider,
} from '../trading/gateConfig.js';
import {
  getGateLearnedThreshold,
  type GateLearnedThresholdEntry,
} from '../persistence/gateLearnedThresholdRepo.js';

/** ENV COUNTERFACTURE_GATE_APPLY_ENABLED=true (default OFF, ADR-0157 정확 비교). */
export function isCounterfactureGateApplyEnabled(): boolean {
  return process.env.COUNTERFACTURE_GATE_APPLY_ENABLED === 'true';
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi);
}

/**
 * Gate1 학습 임계 resolver. flag OFF / 승인분 없음 / 완화창 부재 → null(호출자 레거시 fallback).
 * 충족 시 [regimeAwareRequired, LEGACY 70] 으로 clamp 한 값 반환.
 * 테스트는 injected.entry 로 store I/O 우회.
 */
export function resolveLearnedGate1RequiredScore(
  regime?: string,
  injected?: { entry?: GateLearnedThresholdEntry | null },
): number | null {
  if (!isCounterfactureGateApplyEnabled()) return null;
  const entry = injected && 'entry' in injected
    ? injected.entry ?? null
    : getGateLearnedThreshold('GATE1', regime ?? 'UNKNOWN');
  if (!entry || !Number.isFinite(entry.approvedThreshold)) return null;
  const floor = getRegimeAwareGate1RequiredScore(regime);
  const ceil = LEGACY_GATE1_REQUIRED_SCORE;
  if (floor >= ceil) return null; // 완화 창 없음(레짐값이 anchor 이상) → 적용 안 함
  return clamp(entry.approvedThreshold, floor, ceil);
}

/**
 * gateConfig 에 Gate1 학습 임계 provider 등록. *명시 호출 전용* — 서버 기동 자동 배선 금지.
 * flag OFF 면 등록돼도 resolver 가 null → byte-identical.
 */
export function registerCounterfactureGateApply(): void {
  registerLearnedGate1ThresholdProvider((regime) => resolveLearnedGate1RequiredScore(regime));
}

export function unregisterCounterfactureGateApply(): void {
  registerLearnedGate1ThresholdProvider(null);
}
