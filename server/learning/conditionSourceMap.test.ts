/**
 * @responsibility conditionSourceMap 동기 사본 정합성 + classifyTier 회귀 (ADR-0048)
 */
import { describe, it, expect } from 'vitest';
import {
  REAL_DATA_CONDITIONS,
  AI_ESTIMATE_CONDITIONS,
  classifyConditionSource,
  classifyTier,
  averageScoreFor,
  ALL_TIERS,
  TIER_THRESHOLDS,
  type ConcordanceTier,
} from './conditionSourceMap';

describe('conditionSourceMap — 27 조건 분류 SSOT', () => {
  it('REAL_DATA 9개 + AI 18개 = 27개 disjoint union', () => {
    expect(REAL_DATA_CONDITIONS).toHaveLength(9);
    expect(AI_ESTIMATE_CONDITIONS).toHaveLength(18);
    const overlap = REAL_DATA_CONDITIONS.filter((id) => AI_ESTIMATE_CONDITIONS.includes(id));
    expect(overlap).toHaveLength(0);
    const union = new Set([...REAL_DATA_CONDITIONS, ...AI_ESTIMATE_CONDITIONS]);
    expect(union.size).toBe(27);
  });

  it('1~27 모든 ID 가 정확히 한 카테고리에 매핑', () => {
    for (let id = 1; id <= 27; id++) {
      const source = classifyConditionSource(id);
      expect(source).not.toBeNull();
    }
    expect(classifyConditionSource(0)).toBeNull();
    expect(classifyConditionSource(28)).toBeNull();
  });

  it('REAL_DATA 분류 정합 — 클라 evolutionEngine SSOT 와 동일 9 ID', () => {
    // 클라 SSOT (evolutionEngine.ts): [2, 6, 7, 10, 11, 18, 19, 24, 25]
    expect(REAL_DATA_CONDITIONS.sort((a, b) => a - b)).toEqual([2, 6, 7, 10, 11, 18, 19, 24, 25]);
  });
});

describe('classifyTier — ADR-0048 §2.1 임계값', () => {
  it('점수 ≥ 8 → EXCELLENT (경계값 포함)', () => {
    expect(classifyTier(TIER_THRESHOLDS.EXCELLENT)).toBe<ConcordanceTier>('EXCELLENT');
    expect(classifyTier(10)).toBe('EXCELLENT');
  });

  it('6 ≤ 점수 < 8 → GOOD', () => {
    expect(classifyTier(TIER_THRESHOLDS.GOOD)).toBe('GOOD');
    expect(classifyTier(7.99)).toBe('GOOD');
  });

  it('4 ≤ 점수 < 6 → NEUTRAL', () => {
    expect(classifyTier(TIER_THRESHOLDS.NEUTRAL)).toBe('NEUTRAL');
    expect(classifyTier(5.99)).toBe('NEUTRAL');
  });

  it('2 ≤ 점수 < 4 → WEAK', () => {
    expect(classifyTier(TIER_THRESHOLDS.WEAK)).toBe('WEAK');
    expect(classifyTier(3.99)).toBe('WEAK');
  });

  it('점수 < 2 → POOR', () => {
    expect(classifyTier(1.99)).toBe('POOR');
    expect(classifyTier(0)).toBe('POOR');
  });

  it('NaN/Infinity → POOR (안전 fallback)', () => {
    expect(classifyTier(NaN)).toBe('POOR');
    expect(classifyTier(Infinity)).toBe('POOR');
    expect(classifyTier(-Infinity)).toBe('POOR');
  });
});

describe('averageScoreFor — 카테고리 평균', () => {
  it('REAL_DATA 9 조건 모두 점수 8 → 평균 8', () => {
    const scores: Record<number, number> = Object.fromEntries(REAL_DATA_CONDITIONS.map((id) => [id, 8]));
    expect(averageScoreFor(scores, REAL_DATA_CONDITIONS)).toBe(8);
  });

  it('일부 조건만 점수 있어도 평균 (NaN 제외)', () => {
    const scores: Record<number, number> = { 2: 6, 6: 8, 10: NaN };
    // [2, 6, 7, 10, 11, 18, 19, 24, 25] 중 [2, 6] 만 유효 → (6+8)/2 = 7
    expect(averageScoreFor(scores, REAL_DATA_CONDITIONS)).toBe(7);
  });

  it('빈 입력 / 모두 NaN → 0', () => {
    expect(averageScoreFor({}, REAL_DATA_CONDITIONS)).toBe(0);
    expect(averageScoreFor({ 2: NaN, 6: NaN }, REAL_DATA_CONDITIONS)).toBe(0);
  });
});

describe('ALL_TIERS — UI grid 순회 SSOT', () => {
  it('5개 tier 정확한 순서 (EXCELLENT → POOR)', () => {
    expect(ALL_TIERS).toEqual(['EXCELLENT', 'GOOD', 'NEUTRAL', 'WEAK', 'POOR']);
  });
});
