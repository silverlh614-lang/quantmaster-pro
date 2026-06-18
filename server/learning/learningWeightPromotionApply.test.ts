// @responsibility ADR-0624 D4 learningWeightPromotionApply 회귀 — shadow 즉시 적용·LIVE ENV master 게이트(#7)·clamp.
import { describe, it, expect, afterEach, vi } from 'vitest';

const h = vi.hoisted(() => ({ mode: 'SHADOW' as string }));
vi.mock('../state.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../state.js')>();
  return { ...actual, getTradingMode: () => h.mode };
});

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
  h.mode = 'SHADOW';
  unregisterLearningWeightPromotion();
});

describe('ADR-0624 D4 learningWeightPromotionApply (shadow 즉시·LIVE 게이트)', () => {
  it('SHADOW + flag OFF + candidate → 즉시 적용(apply 만으로 충분)', () => {
    h.mode = 'SHADOW';
    delete process.env[FLAG];
    expect(at(resolveLearnedConditionWeights(undefined, { candidate: cand(base) }))).toBeCloseTo(base);
  });

  it('LIVE + flag OFF + candidate → null (#7 backstop)', () => {
    h.mode = 'LIVE';
    delete process.env[FLAG];
    expect(resolveLearnedConditionWeights(undefined, { candidate: cand(base) })).toBeNull();
  });

  it('LIVE + flag ON + candidate → 적용', () => {
    h.mode = 'LIVE';
    process.env[FLAG] = 'true';
    expect(at(resolveLearnedConditionWeights(undefined, { candidate: cand(base) }))).toBeCloseTo(base);
  });

  it('candidate 없음 → null (모드 무관, 파일 직독 byte-identical)', () => {
    h.mode = 'SHADOW';
    expect(resolveLearnedConditionWeights(undefined, { candidate: null })).toBeNull();
  });

  it('SHADOW + 과대 candidate → 상한 clamp(base*2)', () => {
    h.mode = 'SHADOW';
    const out = at(resolveLearnedConditionWeights(undefined, { candidate: cand(base * 100) }))!;
    expect(out).toBeLessThanOrEqual(base * 2.0 + 1e-9);
    expect(out).toBeGreaterThan(base);
  });

  it('SHADOW + 음수/비유한 candidate → default 복원', () => {
    h.mode = 'SHADOW';
    expect(at(resolveLearnedConditionWeights(undefined, { candidate: cand(-5) }))).toBeCloseTo(base);
    expect(at(resolveLearnedConditionWeights(undefined, { candidate: cand(Number.NaN) }))).toBeCloseTo(base);
  });

  it('register + LIVE + flag OFF → loadConditionWeights byte-identical(#7)', () => {
    h.mode = 'LIVE';
    delete process.env[FLAG];
    const before = loadConditionWeights();
    registerLearningWeightPromotion();
    expect(isLearningWeightPromotionApplied()).toBe(true);
    expect(loadConditionWeights()).toEqual(before); // LIVE + flag OFF → resolver null → 동일
    unregisterLearningWeightPromotion();
    expect(isLearningWeightPromotionApplied()).toBe(false);
  });
});
