import { describe, it, expect, vi, beforeEach } from 'vitest';
import { evaluateCorrelationGate, effectiveIndependentCount, CORRELATION_BLOCK_THRESHOLD } from './correlationSlotGate.js';

vi.mock('../screener/sectorMap.js', () => ({
  getSectorByCode: (code: string) => {
    const map: Record<string, string> = {
      A: '반도체', B: '반도체', C: '반도체',
      D: '바이오', E: '금융',
    };
    return map[code] ?? '미분류';
  },
}));

function open(code: string) {
  return { stockCode: code, status: 'ACTIVE' };
}

describe('evaluateCorrelationGate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('기존 0 포지션 → 무조건 허용', () => {
    const r = evaluateCorrelationGate({ candidateCode: 'A', trades: [] });
    expect(r.allowed).toBe(true);
    expect(r.existingCount).toBe(0);
  });

  it('기존 1 포지션 → 최소 쌍 부족, 허용', () => {
    const r = evaluateCorrelationGate({ candidateCode: 'A', trades: [open('B')] });
    expect(r.allowed).toBe(true);
    expect(r.existingCount).toBe(1);
  });

  it('후보와 기존 모두 동일 섹터 → 평균 상관 0.8, 차단', () => {
    const r = evaluateCorrelationGate({
      candidateCode: 'A', candidateSector: '반도체',
      trades: [open('B'), open('C')],
    });
    expect(r.avgCorrelation).toBeCloseTo(0.8, 1);
    expect(r.allowed).toBe(false);
  });

  it('후보가 기존과 다른 섹터뿐 → 낮은 상관, 허용', () => {
    const r = evaluateCorrelationGate({
      candidateCode: 'D', candidateSector: '바이오',
      trades: [open('E'), open('B')], // E=금융, B=반도체
    });
    expect(r.avgCorrelation).toBeLessThan(CORRELATION_BLOCK_THRESHOLD);
    expect(r.allowed).toBe(true);
  });
});

describe('effectiveIndependentCount (Kish)', () => {
  it('n=1 → 1', () => {
    expect(effectiveIndependentCount(['A'])).toBe(1);
  });
  it('다른 섹터 4개 → 실효 독립 > 동일 섹터 4개', () => {
    // 기저 ρ = 0.15 (섹터 다름) → n=4 에서 실효 ≈ 2.76
    const effDiff = effectiveIndependentCount(['A', 'D', 'E', 'X']);
    const effSame = effectiveIndependentCount(['A', 'B', 'C']); // 동일 반도체
    expect(effDiff).toBeGreaterThan(effSame);
    expect(effDiff).toBeGreaterThan(2); // 4 개 → 2+개 독립 등가
  });
  it('완전 상관 (동일 섹터 4개) → ≈ 1에 근접', () => {
    const eff = effectiveIndependentCount(['A', 'B', 'C']); // 모두 반도체 → ρ̄=0.8
    // 3 / (1 + 2*0.8) = 3 / 2.6 ≈ 1.15
    expect(eff).toBeLessThan(2);
    expect(eff).toBeGreaterThan(1);
  });
});
