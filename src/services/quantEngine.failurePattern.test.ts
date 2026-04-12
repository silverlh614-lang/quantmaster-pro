/**
 * Tests for failurePatternDB.ts — 반실패 학습 패턴 DB
 */
import { describe, it, expect } from 'vitest';
import {
  cosineSimilarity,
  checkFailurePattern,
  type FailurePatternEntry,
} from '../../server/learning/failurePatternDB';

// ─── cosineSimilarity ────────────────────────────────────────────────────────

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    const v = [1, 2, 3, 4, 5];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 5);
  });

  it('returns 0 for orthogonal vectors', () => {
    const a = [1, 0, 0];
    const b = [0, 1, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5);
  });

  it('returns 0 for zero vector input', () => {
    const zero = [0, 0, 0];
    const v = [1, 2, 3];
    expect(cosineSimilarity(zero, v)).toBe(0);
    expect(cosineSimilarity(v, zero)).toBe(0);
  });

  it('returns 0 for mismatched lengths', () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });

  it('returns 1 for scaled identical vectors', () => {
    const a = [2, 4, 6];
    const b = [1, 2, 3];
    expect(cosineSimilarity(a, b)).toBeCloseTo(1.0, 5);
  });
});

// ─── checkFailurePattern ─────────────────────────────────────────────────────

function makeEntry(overrides: Partial<FailurePatternEntry> = {}): FailurePatternEntry {
  return {
    id: 'test-1',
    stockCode: '005930',
    stockName: '삼성전자',
    entryDate: '2024-01-01T00:00:00.000Z',
    exitDate: '2024-01-15T00:00:00.000Z',
    returnPct: -8.5,
    conditionScores: {
      1: 8, 2: 7, 3: 9, 4: 6, 5: 8, 6: 5, 7: 7, 8: 6, 9: 8, 10: 7,
      11: 6, 12: 8, 13: 7, 14: 5, 15: 6, 16: 7, 17: 5, 18: 8, 19: 6, 20: 7,
      21: 5, 22: 6, 23: 7, 24: 5, 25: 6, 26: 7, 27: 8,
    },
    gate1Score: 80,
    gate2Score: 70,
    gate3Score: 60,
    finalScore: 210,
    savedAt: '2024-01-15T00:00:00.000Z',
    ...overrides,
  };
}

describe('checkFailurePattern', () => {
  it('returns no warning when DB is empty', () => {
    const result = checkFailurePattern({ 1: 8, 2: 7 }, []);
    expect(result.hasWarning).toBe(false);
    expect(result.totalChecked).toBe(0);
    expect(result.message).toContain('없음');
  });

  it('returns warning when pattern is highly similar (similarity >= 0.85)', () => {
    const entry = makeEntry();
    // 동일한 조건 점수 → 유사도 1.0
    const result = checkFailurePattern(entry.conditionScores, [entry]);
    expect(result.hasWarning).toBe(true);
    expect(result.similarCount).toBe(1);
    expect(result.maxSimilarity).toBeCloseTo(100, 0);
    expect(result.topMatches).toHaveLength(1);
    expect(result.topMatches[0].stockName).toBe('삼성전자');
  });

  it('returns no warning for very dissimilar pattern', () => {
    const entry = makeEntry({
      conditionScores: {
        1: 10, 2: 10, 3: 10, 4: 10, 5: 10, 6: 10, 7: 10, 8: 10, 9: 10,
        10: 10, 11: 10, 12: 10, 13: 10, 14: 10, 15: 10, 16: 10, 17: 10,
        18: 10, 19: 10, 20: 10, 21: 10, 22: 10, 23: 10, 24: 10, 25: 10,
        26: 10, 27: 10,
      },
    });
    // 반대 벡터와 비교
    const candidate: Record<number, number> = {};
    for (let i = 1; i <= 27; i++) candidate[i] = 0;
    const result = checkFailurePattern(candidate, [entry]);
    expect(result.hasWarning).toBe(false);
  });

  it('warning message contains stock name and count', () => {
    const entry = makeEntry();
    const result = checkFailurePattern(entry.conditionScores, [entry]);
    expect(result.message).toContain('삼성전자');
    expect(result.message).toContain('1건');
  });

  it('topMatches contains similarity percentage', () => {
    const entry = makeEntry();
    const result = checkFailurePattern(entry.conditionScores, [entry]);
    expect(result.topMatches[0].similarity).toBeGreaterThanOrEqual(85);
  });

  it('handles multiple patterns and finds correct max similarity', () => {
    const similar = makeEntry({ stockName: '유사종목', stockCode: '000001' });
    const different = makeEntry({
      stockName: '다른종목',
      stockCode: '000002',
      conditionScores: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1, 8: 1, 9: 1,
        10: 1, 11: 1, 12: 1, 13: 1, 14: 1, 15: 1, 16: 1, 17: 1, 18: 1, 19: 1,
        20: 1, 21: 1, 22: 1, 23: 1, 24: 1, 25: 1, 26: 1, 27: 1 },
    });
    const result = checkFailurePattern(similar.conditionScores, [similar, different]);
    expect(result.hasWarning).toBe(true);
    // The similar entry should be in topMatches
    expect(result.topMatches.some(m => m.stockName === '유사종목')).toBe(true);
  });
});
