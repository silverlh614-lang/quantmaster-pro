/**
 * @responsibility correlationMatrix 단위 테스트 — PR-N
 */
import { describe, it, expect } from 'vitest';
import {
  dailyReturns,
  pearsonCorrelation,
  correlationMatrix,
  classifyCorrelation,
} from './correlationMatrix';

describe('dailyReturns — PR-N', () => {
  it('길이 1 이하 → 빈 배열', () => {
    expect(dailyReturns([])).toEqual([]);
    expect(dailyReturns([100])).toEqual([]);
  });

  it('상승만 → 양수 log return', () => {
    const r = dailyReturns([100, 110]);
    expect(r).toHaveLength(1);
    expect(r[0]).toBeGreaterThan(0);
    expect(r[0]).toBeCloseTo(Math.log(110 / 100), 5);
  });

  it('하락 → 음수 log return', () => {
    const r = dailyReturns([100, 90]);
    expect(r[0]).toBeLessThan(0);
  });

  it('0 또는 음수 가격 → 0 처리 (안전 fallback)', () => {
    expect(dailyReturns([100, 0, 110])).toEqual([0, 0]);
    expect(dailyReturns([100, -10, 110])).toEqual([0, 0]);
  });

  it('NaN 가격 → 0 처리', () => {
    expect(dailyReturns([100, NaN, 110])).toEqual([0, 0]);
  });
});

describe('pearsonCorrelation — PR-N', () => {
  it('동일 배열 → 1.0', () => {
    expect(pearsonCorrelation([1, 2, 3, 4], [1, 2, 3, 4])).toBeCloseTo(1, 5);
  });

  it('완전 반대 → -1.0', () => {
    expect(pearsonCorrelation([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1, 5);
  });

  it('약한 상관 (~0.7) → 정의된 값 반환', () => {
    const a = [1, 2, 3, 4, 5, 6];
    const b = [3, 1, 4, 1, 5, 9];
    const r = pearsonCorrelation(a, b);
    expect(r).not.toBeNull();
    expect(r!).toBeGreaterThan(-1);
    expect(r!).toBeLessThan(1);
  });

  it('표본 < 2 → null', () => {
    expect(pearsonCorrelation([], [])).toBeNull();
    expect(pearsonCorrelation([1], [2])).toBeNull();
  });

  it('한쪽 분산 0 → null', () => {
    expect(pearsonCorrelation([1, 1, 1], [1, 2, 3])).toBeNull();
    expect(pearsonCorrelation([1, 2, 3], [5, 5, 5])).toBeNull();
  });

  it('길이 불일치 → 짧은 쪽 기준 align', () => {
    expect(pearsonCorrelation([1, 2, 3, 100], [1, 2, 3])).toBeCloseTo(1, 5);
  });
});

describe('correlationMatrix — PR-N', () => {
  it('빈 입력 → 빈 매트릭스', () => {
    const r = correlationMatrix({});
    expect(r.symbols).toEqual([]);
    expect(r.matrix).toEqual([]);
  });

  it('1 종목 → 1x1 매트릭스 ([[1]])', () => {
    const r = correlationMatrix({ A: [1, 2, 3] });
    expect(r.symbols).toEqual(['A']);
    expect(r.matrix).toEqual([[1]]);
  });

  it('대각선 항상 1.0', () => {
    const r = correlationMatrix({
      A: [1, 2, 3, 4],
      B: [4, 3, 2, 1],
      C: [1, 1, 1, 1],
    });
    for (let i = 0; i < r.symbols.length; i += 1) {
      expect(r.matrix[i][i]).toBe(1);
    }
  });

  it('대칭성 — m[i][j] === m[j][i] (정의된 경우)', () => {
    const r = correlationMatrix({
      A: [1, 2, 3, 4, 5],
      B: [2, 4, 6, 8, 10],
    });
    expect(r.matrix[0][1]).toBeCloseTo(r.matrix[1][0]!, 5);
  });

  it('완벽 상관 + 완벽 반대 분류', () => {
    const r = correlationMatrix({
      A: [1, 2, 3, 4],
      B: [2, 4, 6, 8],   // A 의 2배 — 완전 양의 상관
      C: [4, 3, 2, 1],   // A 의 반전 — 완전 음의 상관
    });
    expect(r.matrix[0][1]).toBeCloseTo(1, 5);
    expect(r.matrix[0][2]).toBeCloseTo(-1, 5);
  });

  it('분산 0 종목 포함 → null 셀', () => {
    const r = correlationMatrix({
      A: [1, 2, 3],
      B: [5, 5, 5], // flat
    });
    expect(r.matrix[0][1]).toBeNull();
    expect(r.matrix[1][0]).toBeNull();
  });
});

describe('classifyCorrelation — PR-N', () => {
  it('≥0.7 → STRONG_POS', () => {
    expect(classifyCorrelation(0.7)).toBe('STRONG_POS');
    expect(classifyCorrelation(0.95)).toBe('STRONG_POS');
  });

  it('0.4~0.7 → POS', () => {
    expect(classifyCorrelation(0.4)).toBe('POS');
    expect(classifyCorrelation(0.6)).toBe('POS');
  });

  it('≤-0.7 → STRONG_NEG', () => {
    expect(classifyCorrelation(-0.7)).toBe('STRONG_NEG');
    expect(classifyCorrelation(-0.95)).toBe('STRONG_NEG');
  });

  it('-0.4~-0.7 → NEG', () => {
    expect(classifyCorrelation(-0.4)).toBe('NEG');
    expect(classifyCorrelation(-0.5)).toBe('NEG');
  });

  it('-0.4~0.4 → NEUTRAL', () => {
    expect(classifyCorrelation(0)).toBe('NEUTRAL');
    expect(classifyCorrelation(0.3)).toBe('NEUTRAL');
    expect(classifyCorrelation(-0.3)).toBe('NEUTRAL');
  });

  it('null/NaN → UNDEF', () => {
    expect(classifyCorrelation(null)).toBe('UNDEF');
    expect(classifyCorrelation(NaN)).toBe('UNDEF');
    expect(classifyCorrelation(Infinity)).toBe('UNDEF');
  });
});
