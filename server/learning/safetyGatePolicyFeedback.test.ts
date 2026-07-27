// @responsibility SafetyGatePolicyFeedback 회귀 — SafetyGateAttribution closed-loop bounded feedback

import { afterEach, describe, expect, it } from 'vitest';
import type { GateAttributionResult } from './safetyGateAttribution.js';
import { computeSafetyGatePolicyFeedback } from './safetyGatePolicyFeedback.js';

const ENV_KEY = 'SAFETY_GATE_POLICY_FEEDBACK_ENABLED';

function gate(partial: Partial<GateAttributionResult>): GateAttributionResult {
  return {
    gate: 'FOMC',
    avoidedLoss: 0,
    missedGain: 0,
    netGateImpact: 0,
    blockedWinnerCount: 0,
    blockedLoserCount: 0,
    gatePrecision: NaN,
    sampleSize: 0,
    ...partial,
  };
}

afterEach(() => {
  delete process.env[ENV_KEY];
});

describe('computeSafetyGatePolicyFeedback', () => {
  it('ENV OFF -> neutral', () => {
    const result = computeSafetyGatePolicyFeedback(new Date('2026-05-03T00:00:00Z'), [
      gate({ netGateImpact: 0.2, sampleSize: 10 }),
    ]);
    expect(result.active).toBe(false);
    expect(result.multiplier).toBe(1);
    expect(result.envEnabled).toBe(false);
  });

  it('ENV OFF + ignoreEnvGate -> preview 산출(envEnabled=false 정직 표기)', () => {
    const result = computeSafetyGatePolicyFeedback(
      new Date('2026-05-03T00:00:00Z'),
      [gate({ gate: 'VIX', netGateImpact: 0.08, sampleSize: 5 })],
      { ignoreEnvGate: true },
    );
    // 켰다면 산출될 값이 보여야 관측 표면이 의미를 갖는다.
    expect(result.multiplier).toBeCloseTo(0.95, 6);
    expect(result.active).toBe(true);
    // 실제 ENV 는 여전히 OFF — preview 임을 소비자가 구분할 수 있어야 한다.
    expect(result.envEnabled).toBe(false);
  });

  it('ENV ON -> envEnabled=true', () => {
    process.env[ENV_KEY] = 'true';
    const result = computeSafetyGatePolicyFeedback(new Date('2026-05-03T00:00:00Z'), [
      gate({ gate: 'VIX', netGateImpact: 0.08, sampleSize: 5 }),
    ]);
    expect(result.envEnabled).toBe(true);
  });

  it('sample 부족 -> neutral', () => {
    process.env[ENV_KEY] = 'true';
    const result = computeSafetyGatePolicyFeedback(new Date('2026-05-03T00:00:00Z'), [
      gate({ netGateImpact: 0.2, sampleSize: 4 }),
    ]);
    expect(result.active).toBe(false);
    expect(result.multiplier).toBe(1);
  });

  it('good defense attribution -> conservative multiplier', () => {
    process.env[ENV_KEY] = 'true';
    const result = computeSafetyGatePolicyFeedback(new Date('2026-05-03T00:00:00Z'), [
      gate({ gate: 'VIX', netGateImpact: 0.08, sampleSize: 5 }),
    ]);
    expect(result.active).toBe(true);
    expect(result.multiplier).toBeCloseTo(0.95, 6);
    expect(result.reasons[0]).toContain('VIX good defense');
  });

  it('overprotective attribution -> bounded easing multiplier', () => {
    process.env[ENV_KEY] = 'true';
    const result = computeSafetyGatePolicyFeedback(new Date('2026-05-03T00:00:00Z'), [
      gate({ gate: 'FOMC', netGateImpact: -0.08, sampleSize: 5 }),
    ]);
    expect(result.active).toBe(true);
    expect(result.multiplier).toBeCloseTo(1.03, 6);
    expect(result.reasons[0]).toContain('FOMC overprotective');
  });
});
