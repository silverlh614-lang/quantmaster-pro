// @responsibility ADR-0624 D4 learningWeightPromotionApply 회귀 — flag gate·clamp·register/unregister byte-identical.
import { describe, it, expect, afterEach } from 'vitest';
import {
  resolveLearnedConditionWeights,
  registerLearningWeightPromotion,
  unregisterLearningWeightPromotion,
  isLearningWeightPromotionApplied,
} from './learningWeightPromotionApply.js';
import { loadConditionWeights } from '../persistence/conditionWeightsRepo.js';
import { DEFAULT_CONDITION_WEIGHTS, type ConditionWeights } from '../quantFilter.js';

const FLAG = 'LEARNING_WEIGHT_PROMOTION_ENABLED';
const firstKey = Object.keys(DEFAULT_CONDITION_WEIGHTS)[0];
const base = (DEFAULT_CONDITION_WEIGHTS as Record<string, number>)[firstKey];
const cand = (v: number) => ({ [firstKey]: v } as unknown as Partial<ConditionWeights>);
const at = (w: Partial<ConditionWeights> | null) => (w as Record<string, number> | null)?.[firstKey];

afterEach(() => {
  delete process.env[FLAG];
  unregisterLearningWeightPromotion();
});

describe('ADR-0624 D4 learningWeightPromotionApply', () => {
  it('flag OFF → resolver null(byte-identical)', () => {
    delete process.env[FLAG];
    expect(resolveLearnedConditionWeights(undefined, { candidate: cand(base) })).toBeNull();
  });

  it('flag ON + candidate 없음 → null', () => {
    process.env[FLAG] = 'true';
    expect(resolveLearnedConditionWeights(undefined, { candidate: null })).toBeNull();
  });

  it('flag ON + in-window candidate → clamp 통과(동일)', () => {
    process.env[FLAG] = 'true';
    expect(at(resolveLearnedConditionWeights(undefined, { candidate: cand(base) }))).toBeCloseTo(base);
  });

  it('flag ON + 과대 candidate → 상한 clamp(base*2)', () => {
    process.env[FLAG] = 'true';
    const out = at(resolveLearnedConditionWeights(undefined, { candidate: cand(base * 100) }))!;
    expect(out).toBeLessThanOrEqual(base * 2.0 + 1e-9);
    expect(out).toBeGreaterThan(base);
  });

  it('flag ON + 음수/비유한 candidate → default 복원', () => {
    process.env[FLAG] = 'true';
    expect(at(resolveLearnedConditionWeights(undefined, { candidate: cand(-5) }))).toBeCloseTo(base);
    expect(at(resolveLearnedConditionWeights(undefined, { candidate: cand(Number.NaN) }))).toBeCloseTo(base);
  });

  it('register + flag OFF → loadConditionWeights byte-identical', () => {
    delete process.env[FLAG];
    const before = loadConditionWeights();
    registerLearningWeightPromotion();
    expect(isLearningWeightPromotionApplied()).toBe(true);
    expect(loadConditionWeights()).toEqual(before); // flag OFF → resolver null → 동일
    unregisterLearningWeightPromotion();
    expect(isLearningWeightPromotionApplied()).toBe(false);
  });
});
