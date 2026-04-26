/**
 * @responsibility sourceWeighting SSOT 회귀 테스트 (ADR-0020 PR-C)
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  SOURCE_LEARNING_MULTIPLIER,
  getSourceMultiplier,
  resolveSource,
  isSourceWeightingDisabled,
} from './sourceWeighting';
import { CONDITION_SOURCE_MAP, REAL_DATA_CONDITIONS, AI_ESTIMATE_CONDITIONS } from './evolutionEngine';
import type { ConditionId } from '../../types/core';

const ORIGINAL_ENV = process.env.LEARNING_SOURCE_WEIGHTING_DISABLED;
afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env.LEARNING_SOURCE_WEIGHTING_DISABLED;
  } else {
    process.env.LEARNING_SOURCE_WEIGHTING_DISABLED = ORIGINAL_ENV;
  }
});

describe('SOURCE_LEARNING_MULTIPLIER — SSOT 정합성', () => {
  it('COMPUTED=1.0, AI=0.4 명시', () => {
    expect(SOURCE_LEARNING_MULTIPLIER.COMPUTED).toBe(1.0);
    expect(SOURCE_LEARNING_MULTIPLIER.AI).toBe(0.4);
  });

  it('REAL_DATA_CONDITIONS 9개 모두 COMPUTED + AI_ESTIMATE 18개 모두 AI', () => {
    expect(REAL_DATA_CONDITIONS).toHaveLength(9);
    expect(AI_ESTIMATE_CONDITIONS).toHaveLength(18);
    for (const id of REAL_DATA_CONDITIONS) {
      expect(CONDITION_SOURCE_MAP[id]).toBe('COMPUTED');
    }
    for (const id of AI_ESTIMATE_CONDITIONS) {
      expect(CONDITION_SOURCE_MAP[id]).toBe('AI');
    }
  });
});

describe('getSourceMultiplier', () => {
  it('REAL_DATA 조건 → 1.0', () => {
    for (const id of REAL_DATA_CONDITIONS) {
      expect(getSourceMultiplier(id)).toBe(1.0);
    }
  });

  it('AI_ESTIMATE 조건 → 0.4', () => {
    for (const id of AI_ESTIMATE_CONDITIONS) {
      expect(getSourceMultiplier(id)).toBe(0.4);
    }
  });

  it('overrideSource=COMPUTED 우선 (trade-level)', () => {
    // 1 = AI 분류 조건 (주도주 사이클) — override 로 COMPUTED 강제
    expect(getSourceMultiplier(1, 'COMPUTED')).toBe(1.0);
  });

  it('overrideSource=AI 우선 (trade-level)', () => {
    // 25 = COMPUTED 분류 (VCP) — override 로 AI 강제
    expect(getSourceMultiplier(25, 'AI')).toBe(0.4);
  });

  it('LEARNING_SOURCE_WEIGHTING_DISABLED=true 면 모두 1.0', () => {
    process.env.LEARNING_SOURCE_WEIGHTING_DISABLED = 'true';
    expect(getSourceMultiplier(1)).toBe(1.0);   // AI 조건도 1.0
    expect(getSourceMultiplier(25)).toBe(1.0);
    expect(isSourceWeightingDisabled()).toBe(true);
  });

  it('LEARNING_SOURCE_WEIGHTING_DISABLED=false (기본) 면 차등 적용', () => {
    delete process.env.LEARNING_SOURCE_WEIGHTING_DISABLED;
    expect(isSourceWeightingDisabled()).toBe(false);
    expect(getSourceMultiplier(1)).toBe(0.4);
    expect(getSourceMultiplier(25)).toBe(1.0);
  });

  it('알 수 없는 source 는 안전하게 1.0 fallback', () => {
    // resolveSource 가 SOURCE_MAP 에 없는 ID 를 받으면 undefined 반환
    expect(getSourceMultiplier(999 as ConditionId)).toBe(1.0);
  });
});

describe('resolveSource', () => {
  it('override 우선', () => {
    expect(resolveSource(1, 'COMPUTED')).toBe('COMPUTED');
    expect(resolveSource(25, 'AI')).toBe('AI');
  });

  it('override 부재 시 SSOT', () => {
    expect(resolveSource(1)).toBe('AI');     // 주도주 사이클
    expect(resolveSource(25)).toBe('COMPUTED'); // VCP
  });
});
