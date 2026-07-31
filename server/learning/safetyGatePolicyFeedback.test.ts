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
      [gate({ gate: 'VIX', avoidedLoss: 0.54, missedGain: 0.46, netGateImpact: 0.08, sampleSize: 5 })],
      { ignoreEnvGate: true },
    );
    // 켰다면 산출될 값이 보여야 관측 표면이 의미를 갖는다.
    expect(result.multiplier).toBeCloseTo(0.95, 6);
    expect(result.active).toBe(true);
    // 실제 ENV 는 여전히 OFF — preview 임을 소비자가 구분할 수 있어야 한다.
    expect(result.envEnabled).toBe(false);
  });

  it('정규화 비대칭도 — 운영 실측 재현 (R0_R1 -0.326 과보호 / DATA_SANITY +0.055 방어양호)', () => {
    process.env[ENV_KEY] = 'true';
    const result = computeSafetyGatePolicyFeedback(new Date('2026-07-31T00:00:00Z'), [
      gate({ gate: 'R0_R1_REGIME', avoidedLoss: 2074.356940517528, missedGain: 4085.165082072334, netGateImpact: -2010.8081415548058, sampleSize: 325 }),
      gate({ gate: 'DATA_SANITY', avoidedLoss: 830.3053063678566, missedGain: 744.0535620577391, netGateImpact: 86.25174431011749, sampleSize: 74 }),
    ]);
    expect(result.sampleSize).toBe(399);
    expect(result.multiplier).toBeCloseTo(0.95 * 1.03, 6);
    expect(result.reasons.some((r) => r.includes('R0_R1_REGIME overprotective norm=-0.326'))).toBe(true);
    expect(result.reasons.some((r) => r.includes('DATA_SANITY good defense norm=0.055'))).toBe(true);
  });

  it('단위 무관 — futureReturn 이 percent 든 fraction 이든 동일 판정 (100× 스케일 불변)', () => {
    process.env[ENV_KEY] = 'true';
    const asPercent = computeSafetyGatePolicyFeedback(new Date('2026-07-31T00:00:00Z'), [
      gate({ gate: 'VIX', avoidedLoss: 100, missedGain: 300, netGateImpact: -200, sampleSize: 20 }),
    ]);
    const asFraction = computeSafetyGatePolicyFeedback(new Date('2026-07-31T00:00:00Z'), [
      gate({ gate: 'VIX', avoidedLoss: 1, missedGain: 3, netGateImpact: -2, sampleSize: 20 }),
    ]);
    expect(asPercent.multiplier).toBe(asFraction.multiplier);
    expect(asPercent.multiplier).toBeCloseTo(1.03, 6);
  });

  it('표본수 무관 — 같은 비대칭 비율이면 n 이 10배여도 동일 판정', () => {
    process.env[ENV_KEY] = 'true';
    const small = computeSafetyGatePolicyFeedback(new Date('2026-07-31T00:00:00Z'), [
      gate({ gate: 'VIX', avoidedLoss: 10, missedGain: 30, netGateImpact: -20, sampleSize: 10 }),
    ]);
    const large = computeSafetyGatePolicyFeedback(new Date('2026-07-31T00:00:00Z'), [
      gate({ gate: 'VIX', avoidedLoss: 100, missedGain: 300, netGateImpact: -200, sampleSize: 100 }),
    ]);
    expect(small.multiplier).toBe(large.multiplier);
  });

  it('비대칭이 임계 미만이면 중립 유지 (구 구현은 합이 커서 무조건 발동했음)', () => {
    process.env[ENV_KEY] = 'true';
    // net=10 은 절대값으론 임계 0.03 을 한참 넘지만, 총량 10000 대비 0.001 → 무시돼야 한다.
    const result = computeSafetyGatePolicyFeedback(new Date('2026-07-31T00:00:00Z'), [
      gate({ gate: 'VIX', avoidedLoss: 5005, missedGain: 4995, netGateImpact: 10, sampleSize: 200 }),
    ]);
    expect(result.multiplier).toBe(1);
    expect(result.active).toBe(false);
  });

  it('총 관측량 0 (전부 BE) → 판정 불가 skip (0 나눗셈 방지)', () => {
    process.env[ENV_KEY] = 'true';
    const result = computeSafetyGatePolicyFeedback(new Date('2026-07-31T00:00:00Z'), [
      gate({ gate: 'VIX', avoidedLoss: 0, missedGain: 0, netGateImpact: 0, sampleSize: 20 }),
    ]);
    expect(result.multiplier).toBe(1);
    expect(result.active).toBe(false);
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

  // 아래 두 케이스는 net = avoidedLoss - missedGain 항등식을 만족하도록 fixture 를 보정했다.
  // (구 fixture 는 net≠0 인데 avoidedLoss=missedGain=0 이라 실제로는 발생 불가한 조합이었다.)
  it('good defense attribution -> conservative multiplier', () => {
    process.env[ENV_KEY] = 'true';
    const result = computeSafetyGatePolicyFeedback(new Date('2026-05-03T00:00:00Z'), [
      gate({ gate: 'VIX', avoidedLoss: 0.54, missedGain: 0.46, netGateImpact: 0.08, sampleSize: 5 }),
    ]);
    expect(result.active).toBe(true);
    expect(result.multiplier).toBeCloseTo(0.95, 6);
    expect(result.reasons[0]).toContain('VIX good defense');
  });

  it('overprotective attribution -> bounded easing multiplier', () => {
    process.env[ENV_KEY] = 'true';
    const result = computeSafetyGatePolicyFeedback(new Date('2026-05-03T00:00:00Z'), [
      gate({ gate: 'FOMC', avoidedLoss: 0.46, missedGain: 0.54, netGateImpact: -0.08, sampleSize: 5 }),
    ]);
    expect(result.active).toBe(true);
    expect(result.multiplier).toBeCloseTo(1.03, 6);
    expect(result.reasons[0]).toContain('FOMC overprotective');
  });
});
