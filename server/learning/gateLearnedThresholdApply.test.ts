import { afterEach, describe, expect, it } from 'vitest';
import {
  LEGACY_GATE1_REQUIRED_SCORE,
  getRegimeAwareGate1RequiredScore,
  registerLearnedGate1ThresholdProvider,
  resolveGate1RequiredScore,
} from '../trading/gateConfig.js';
import {
  isCounterfactureGateApplyEnabled,
  resolveLearnedGate1RequiredScore,
  unregisterCounterfactureGateApply,
} from './gateLearnedThresholdApply.js';
import type { GateLearnedThresholdEntry } from '../persistence/gateLearnedThresholdRepo.js';

const FLAG = 'COUNTERFACTURE_GATE_APPLY_ENABLED';
const REGIME = 'R3_EARLY';

function entry(approvedThreshold: number): GateLearnedThresholdEntry {
  return {
    gate: 'GATE1',
    regime: REGIME,
    approvedThreshold,
    scale: 10,
    approvedBy: 'operator',
    approvedAtKst: '2026-06-02T16:00:00+09:00',
    basis: { sampleSize: 40, winSample: 30, lossSample: 10, suggestedThreshold: approvedThreshold, decision: 'loosen' },
  };
}

const floor = getRegimeAwareGate1RequiredScore(REGIME);

afterEach(() => {
  delete process.env[FLAG];
  registerLearnedGate1ThresholdProvider(null);
});

describe('counterfacture_gate Phase D — gateLearnedThresholdApply', () => {
  it('전제: R3_EARLY 완화창 존재(floor < anchor 70)', () => {
    expect(floor).toBeLessThan(LEGACY_GATE1_REQUIRED_SCORE);
  });

  it('flag OFF 기본 → resolver null, resolveGate1RequiredScore byte-identical(70)', () => {
    expect(isCounterfactureGateApplyEnabled()).toBe(false);
    expect(resolveLearnedGate1RequiredScore(REGIME, { entry: entry(66) })).toBeNull();
    expect(resolveGate1RequiredScore(REGIME)).toBe(LEGACY_GATE1_REQUIRED_SCORE);
  });

  it('flag ON + 창 내 승인분 → 그 값 적용', () => {
    process.env[FLAG] = 'true';
    const within = Math.round((floor + LEGACY_GATE1_REQUIRED_SCORE) / 2);
    expect(resolveLearnedGate1RequiredScore(REGIME, { entry: entry(within) })).toBe(within);
  });

  it('flag ON + 바닥 아래 승인분 → floor 로 clamp(바닥 아래 불가)', () => {
    process.env[FLAG] = 'true';
    expect(resolveLearnedGate1RequiredScore(REGIME, { entry: entry(floor - 20) })).toBe(floor);
  });

  it('flag ON + anchor 이상 승인분 → 70 으로 clamp(anchor 보존, 완화만 허용)', () => {
    process.env[FLAG] = 'true';
    expect(resolveLearnedGate1RequiredScore(REGIME, { entry: entry(85) })).toBe(LEGACY_GATE1_REQUIRED_SCORE);
  });

  it('flag ON + 승인분 없음 → null', () => {
    process.env[FLAG] = 'true';
    expect(resolveLearnedGate1RequiredScore(REGIME, { entry: null })).toBeNull();
  });

  it('provider 등록 시 gateConfig 가 학습 임계 경유(flag ON), 해제 시 70 복귀', () => {
    process.env[FLAG] = 'true';
    const within = Math.round((floor + LEGACY_GATE1_REQUIRED_SCORE) / 2);
    registerLearnedGate1ThresholdProvider((regime) => resolveLearnedGate1RequiredScore(regime, { entry: entry(within) }));
    expect(resolveGate1RequiredScore(REGIME)).toBe(within);
    unregisterCounterfactureGateApply();
    expect(resolveGate1RequiredScore(REGIME)).toBe(LEGACY_GATE1_REQUIRED_SCORE);
  });
});
