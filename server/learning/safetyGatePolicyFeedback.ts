// @responsibility SafetyGateAttribution closed-loop bounded policy feedback (관측 전용 — 사이징 적용 소비자 0건)
/**
 * safetyGatePolicyFeedback.ts — 안전게이트 사후효과(netGateImpact)를 사이징 배수 권고로 변환.
 *
 * 폐루프 방향: 게이트가 손실을 잘 막고 있으면(net≥+0.03) 시장이 위험 → 0.95× 축소 /
 * 과보호로 승자를 놓치고 있으면(net≤-0.03) → 1.03× 확대. 최종 [0.80, 1.05] clamp.
 *
 * **적용 소비자 0건 (관측 전용)** — 본 모듈 산출은 read-only 표면(`/safety_gate_policy`
 * 텔레그램 · `/api/learning/safety-gate-policy-feedback`)에만 노출된다. 사이징 엔진/
 * autoTradeEngine 배선은 운영자 검증 후 별도 PR (PENDING_WIRING A16).
 * 실 사이징 적용은 실제 돈에 영향 → ENV + 운영자 승인 이중 게이트 의무.
 */

import { loadShadowLearningOnlySignals } from '../persistence/shadowLearningOnlySignalRepo.js';
import {
  computeSafetyGateAttribution,
  type GateAttributionResult,
} from './safetyGateAttribution.js';

export interface SafetyGatePolicyFeedback {
  generatedAt: string;
  active: boolean;
  multiplier: number;
  sampleSize: number;
  reasons: string[];
  /**
   * ENV `SAFETY_GATE_POLICY_FEEDBACK_ENABLED` 실제 상태 — 정직 표기.
   * false + multiplier≠1 = preview(관측 전용·실제 미적용, ignoreEnvGate 호출).
   */
  envEnabled: boolean;
}

/** 순수 함수 옵션. ignoreEnvGate 는 *read-only 관측 표면 전용* — 실제 소비자는 전달 금지. */
export interface SafetyGatePolicyFeedbackOptions {
  /**
   * ENV 게이트를 우회해 "켰다면 어떤 배수가 나올지" 산출(preview).
   * `computeSafetyGateAttribution(..., { ignoreEnvGate: true })` 동일 관용구.
   * 본 플래그는 값 산출만 바꾸며 적용 경로를 만들지 않는다(소비자 0건 — 관측 전용).
   */
  ignoreEnvGate?: boolean;
}

const SAFETY_GATE_POLICY_FEEDBACK_CONSTANTS = {
  MIN_TOTAL_SAMPLE: 5,
  MIN_GATE_SAMPLE: 3,
  /**
   * 판정 임계 — **정규화 비대칭도**(`normalizedImpact`) 기준. 단위·표본수 무관 [-1,+1].
   * 구 구현은 `netGateImpact`(누적 **합**)를 이 값과 직접 비교했는데, 합은 표본이 쌓일수록
   * 무한정 커져 임계가 사실상 무력화됐다 (운영 실측 net=-2010.8 / +86.3 vs 임계 0.03 →
   * 부호 판정으로 degenerate). 정규화로 임계가 다시 의미를 갖는다.
   */
  GOOD_DEFENSE_NORMALIZED_IMPACT: 0.03,
  OVERPROTECTIVE_NORMALIZED_IMPACT: -0.03,
  GOOD_DEFENSE_MULTIPLIER: 0.95,
  OVERPROTECTIVE_MULTIPLIER: 1.03,
  FLOOR: 0.80,
  CAP: 1.05,
} as const;

/**
 * 게이트 사후효과를 **무차원 비대칭도**로 정규화 — `net / (avoidedLoss + missedGain)`.
 *
 * 왜 정규화인가:
 *   - 표본수 무관 — 합이 아니라 비율이라 표본이 쌓여도 스케일이 안 변한다.
 *   - **단위 무관** — futureReturn 이 percent(5.0) 든 fraction(0.05) 든 분자·분모가 같은
 *     배율로 움직여 값이 동일하다. 현재 두 resolver 가 같은 필드에 100× 다른 단위로 쓰는
 *     문제(futureReturnResolver ×100 vs shadowFutureReturnResolver -1)에 면역이다.
 *   - 크기 보존 — R0_R1(-0.326) vs DATA_SANITY(+0.055) 처럼 비대칭 정도가 비교 가능해진다.
 *
 * 총 관측량(avoidedLoss+missedGain)이 0·음수·비유한 → null (판정 불가, 호출자 skip).
 */
export function normalizeGateImpact(gate: GateAttributionResult): number | null {
  const magnitude = gate.avoidedLoss + gate.missedGain;
  if (!Number.isFinite(magnitude) || magnitude <= 0) return null;
  if (!Number.isFinite(gate.netGateImpact)) return null;
  return gate.netGateImpact / magnitude;
}

function isSafetyGatePolicyFeedbackEnabled(): boolean {
  return process.env.SAFETY_GATE_POLICY_FEEDBACK_ENABLED === 'true';
}

function clampMultiplier(value: number): number {
  return Math.max(
    SAFETY_GATE_POLICY_FEEDBACK_CONSTANTS.FLOOR,
    Math.min(SAFETY_GATE_POLICY_FEEDBACK_CONSTANTS.CAP, value),
  );
}

export function computeSafetyGatePolicyFeedback(
  now: Date = new Date(),
  results?: GateAttributionResult[],
  options?: SafetyGatePolicyFeedbackOptions,
): SafetyGatePolicyFeedback {
  const envEnabled = isSafetyGatePolicyFeedbackEnabled();
  if (!envEnabled && options?.ignoreEnvGate !== true) {
    return {
      generatedAt: now.toISOString(),
      active: false,
      multiplier: 1,
      sampleSize: 0,
      reasons: ['disabled by SAFETY_GATE_POLICY_FEEDBACK_ENABLED'],
      envEnabled,
    };
  }

  const attribution = results ?? computeSafetyGateAttribution(
    loadShadowLearningOnlySignals(),
    { ignoreEnvGate: true },
  );
  const totalSample = attribution.reduce((sum, r) => sum + r.sampleSize, 0);
  if (totalSample < SAFETY_GATE_POLICY_FEEDBACK_CONSTANTS.MIN_TOTAL_SAMPLE) {
    return {
      generatedAt: now.toISOString(),
      active: false,
      multiplier: 1,
      sampleSize: totalSample,
      reasons: [`insufficient safety gate samples (${totalSample})`],
      envEnabled,
    };
  }

  let multiplier = 1;
  const reasons: string[] = [];
  for (const gate of attribution) {
    if (gate.sampleSize < SAFETY_GATE_POLICY_FEEDBACK_CONSTANTS.MIN_GATE_SAMPLE) continue;
    // 누적 합이 아니라 정규화 비대칭도로 판정 (단위·표본수 무관).
    const normalized = normalizeGateImpact(gate);
    if (normalized === null) continue;
    if (normalized >= SAFETY_GATE_POLICY_FEEDBACK_CONSTANTS.GOOD_DEFENSE_NORMALIZED_IMPACT) {
      multiplier *= SAFETY_GATE_POLICY_FEEDBACK_CONSTANTS.GOOD_DEFENSE_MULTIPLIER;
      reasons.push(`${gate.gate} good defense norm=${normalized.toFixed(3)} (net=${gate.netGateImpact.toFixed(1)}, n=${gate.sampleSize})`);
    } else if (normalized <= SAFETY_GATE_POLICY_FEEDBACK_CONSTANTS.OVERPROTECTIVE_NORMALIZED_IMPACT) {
      multiplier *= SAFETY_GATE_POLICY_FEEDBACK_CONSTANTS.OVERPROTECTIVE_MULTIPLIER;
      reasons.push(`${gate.gate} overprotective norm=${normalized.toFixed(3)} (net=${gate.netGateImpact.toFixed(1)}, n=${gate.sampleSize})`);
    }
  }

  const adjusted = clampMultiplier(multiplier);
  return {
    generatedAt: now.toISOString(),
    active: reasons.length > 0,
    multiplier: adjusted,
    sampleSize: totalSample,
    reasons: reasons.length > 0 ? reasons : ['no actionable safety gate attribution'],
    envEnabled,
  };
}
