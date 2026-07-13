// @responsibility SafetyGateAttribution closed-loop bounded policy feedback

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
}

const SAFETY_GATE_POLICY_FEEDBACK_CONSTANTS = {
  MIN_TOTAL_SAMPLE: 5,
  MIN_GATE_SAMPLE: 3,
  GOOD_DEFENSE_NET_IMPACT: 0.03,
  OVERPROTECTIVE_NET_IMPACT: -0.03,
  GOOD_DEFENSE_MULTIPLIER: 0.95,
  OVERPROTECTIVE_MULTIPLIER: 1.03,
  FLOOR: 0.80,
  CAP: 1.05,
} as const;

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
): SafetyGatePolicyFeedback {
  if (!isSafetyGatePolicyFeedbackEnabled()) {
    return {
      generatedAt: now.toISOString(),
      active: false,
      multiplier: 1,
      sampleSize: 0,
      reasons: ['disabled by SAFETY_GATE_POLICY_FEEDBACK_ENABLED'],
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
    };
  }

  let multiplier = 1;
  const reasons: string[] = [];
  for (const gate of attribution) {
    if (gate.sampleSize < SAFETY_GATE_POLICY_FEEDBACK_CONSTANTS.MIN_GATE_SAMPLE) continue;
    if (gate.netGateImpact >= SAFETY_GATE_POLICY_FEEDBACK_CONSTANTS.GOOD_DEFENSE_NET_IMPACT) {
      multiplier *= SAFETY_GATE_POLICY_FEEDBACK_CONSTANTS.GOOD_DEFENSE_MULTIPLIER;
      reasons.push(`${gate.gate} good defense net=${gate.netGateImpact.toFixed(3)}`);
    } else if (gate.netGateImpact <= SAFETY_GATE_POLICY_FEEDBACK_CONSTANTS.OVERPROTECTIVE_NET_IMPACT) {
      multiplier *= SAFETY_GATE_POLICY_FEEDBACK_CONSTANTS.OVERPROTECTIVE_MULTIPLIER;
      reasons.push(`${gate.gate} overprotective net=${gate.netGateImpact.toFixed(3)}`);
    }
  }

  const adjusted = clampMultiplier(multiplier);
  return {
    generatedAt: now.toISOString(),
    active: reasons.length > 0,
    multiplier: adjusted,
    sampleSize: totalSample,
    reasons: reasons.length > 0 ? reasons : ['no actionable safety gate attribution'],
  };
}
