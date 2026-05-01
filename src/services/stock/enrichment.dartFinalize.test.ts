/**
 * @responsibility ADR-0150 Phase 1 DART 마무리 회귀 — performanceReality (#15) +
 * economicMoatVerified (#8) 격상 임계 분기 + main/aiFallback 두 경로 정합 가드.
 *
 * 본 테스트는 buildConditionSourceTiers 의 'API' 분류 격상 + DART 응답 → checklist
 * 임계 분기 두 측면을 단위 검증한다. enrichment 의 main path / aiFallback path 가
 * 동일 임계를 사용하는지 회귀 가드.
 */
import { describe, it, expect } from 'vitest';
import { buildConditionSourceTiers } from './enrichment';

describe('ADR-0150 Phase 1 DART 마무리 — performanceReality (#15) 임계', () => {
  // performanceReality ← (dartFinancials?.epsGrowth ?? 0) > 0 ? 1 : 0 (또는 fallback)
  // 본 테스트는 임계 *순수 함수* 추출 부재로 인라인 분기 검증. enrichment 본체
  // 변경 시 본 테스트 갱신 의무 (주석 명시).

  function shouldTriggerPerformance(epsGrowth: number | null | undefined): number {
    return (epsGrowth ?? 0) > 0 ? 1 : 0;
  }

  it('epsGrowth=10 (양수 성장) → 1', () => {
    expect(shouldTriggerPerformance(10)).toBe(1);
  });

  it('epsGrowth=0 (성장 없음) → 0', () => {
    expect(shouldTriggerPerformance(0)).toBe(0);
  });

  it('epsGrowth=-5 (감소) → 0', () => {
    expect(shouldTriggerPerformance(-5)).toBe(0);
  });

  it('epsGrowth=undefined (DART 부재) → 0 (fallback 0)', () => {
    expect(shouldTriggerPerformance(undefined)).toBe(0);
  });

  it('epsGrowth=null (DART 응답 누락) → 0', () => {
    expect(shouldTriggerPerformance(null)).toBe(0);
  });

  it('epsGrowth=0.001 (미세 양수) → 1 (boundary 정합)', () => {
    expect(shouldTriggerPerformance(0.001)).toBe(1);
  });

  it('epsGrowth=100 (대폭 성장) → 1', () => {
    expect(shouldTriggerPerformance(100)).toBe(1);
  });
});

describe('ADR-0150 Phase 1 DART 마무리 — economicMoatVerified (#8) 합성 임계', () => {
  // economicMoatVerified ← debtRatio < 50 AND netProfitMargin > 5
  // 두 조건 *AND* 충족 시 1, 그 외 fallback (stock.checklist 기존 값 또는 0).

  function shouldTriggerMoat(
    debtRatio: number | null | undefined,
    netProfitMargin: number | null | undefined,
  ): boolean {
    return (debtRatio ?? 100) < 50 && (netProfitMargin ?? 0) > 5;
  }

  it('debtRatio=30, netProfitMargin=8 (둘 다 충족) → true', () => {
    expect(shouldTriggerMoat(30, 8)).toBe(true);
  });

  it('debtRatio=60, netProfitMargin=8 (debt 미달) → false', () => {
    expect(shouldTriggerMoat(60, 8)).toBe(false);
  });

  it('debtRatio=30, netProfitMargin=3 (margin 미달) → false', () => {
    expect(shouldTriggerMoat(30, 3)).toBe(false);
  });

  it('debtRatio=49.99, netProfitMargin=5.01 (boundary 양쪽 충족) → true', () => {
    expect(shouldTriggerMoat(49.99, 5.01)).toBe(true);
  });

  it('debtRatio=50, netProfitMargin=5.01 (debt 정확 50 미달) → false', () => {
    // 임계 strict less than (< 50) — 50 정확값은 미충족
    expect(shouldTriggerMoat(50, 5.01)).toBe(false);
  });

  it('debtRatio=49.99, netProfitMargin=5 (margin 정확 5 미달) → false', () => {
    // 임계 strict greater than (> 5) — 5 정확값은 미충족
    expect(shouldTriggerMoat(49.99, 5)).toBe(false);
  });

  it('둘 다 undefined → false (DART 부재 fallback 0)', () => {
    // (100) < 50 = false → AND short-circuit false
    expect(shouldTriggerMoat(undefined, undefined)).toBe(false);
  });

  it('debtRatio=undefined, netProfitMargin=10 → false (debt fallback 100, 50 미만 X)', () => {
    expect(shouldTriggerMoat(undefined, 10)).toBe(false);
  });

  it('debtRatio=20, netProfitMargin=undefined → false (margin fallback 0, > 5 X)', () => {
    expect(shouldTriggerMoat(20, undefined)).toBe(false);
  });

  it('debtRatio=NaN → false (NaN < 50 = false in JS)', () => {
    expect(shouldTriggerMoat(NaN, 10)).toBe(false);
  });

  it('debtRatio=0 (부채 없음), netProfitMargin=20 → true', () => {
    expect(shouldTriggerMoat(0, 20)).toBe(true);
  });
});

describe('ADR-0150 — buildConditionSourceTiers Phase 1 격상 정합', () => {
  it('hasDartFinancials=true → 5 키 모두 API (#3/#21/#23/#15/#8)', () => {
    const meta = buildConditionSourceTiers({
      hasDartFinancials: true,
      hasKisSupply: false,
      hasVcpComputed: false,
    });
    expect(meta.roeType3).toBe('API');             // #3
    expect(meta.ocfQuality).toBe('API');            // #21
    expect(meta.interestCoverage).toBe('API');      // #23
    expect(meta.performanceReality).toBe('API');    // #15 ADR-0150 신규
    expect(meta.economicMoatVerified).toBe('API');  // #8 ADR-0150 신규
  });

  it('hasDartFinancials=false → 5 키 모두 AI_INFERRED (격상 안 됨)', () => {
    const meta = buildConditionSourceTiers({
      hasDartFinancials: false,
      hasKisSupply: false,
      hasVcpComputed: false,
    });
    expect(meta.roeType3).toBe('AI_INFERRED');
    expect(meta.ocfQuality).toBe('AI_INFERRED');
    expect(meta.interestCoverage).toBe('AI_INFERRED');
    expect(meta.performanceReality).toBe('AI_INFERRED');
    expect(meta.economicMoatVerified).toBe('AI_INFERRED');
  });

  it('main path (DART + VCP) → 6 키 격상 합계 (ADR-0151 Phase 2: hasKisSupply 라벨 제거)', () => {
    const meta = buildConditionSourceTiers({
      hasDartFinancials: true,
      hasKisSupply: true, // 후방호환 인자, 라벨 부여 안 함
      hasVcpComputed: true,
    });
    // ADR-0151: VCP 1 (COMPUTED) + DART 5 (API) = 6 키 격상
    // KIS supply 2 키는 'AI_INFERRED' 유지 (Naver foreignerOwnRatio 의미 mismatch)
    const apiCount = Object.values(meta).filter((v) => v === 'API').length;
    const computedCount = Object.values(meta).filter((v) => v === 'COMPUTED').length;
    const aiCount = Object.values(meta).filter((v) => v === 'AI_INFERRED').length;
    expect(apiCount).toBe(5); // DART 5
    expect(computedCount).toBe(1); // VCP
    expect(aiCount).toBe(21); // 27 - 6 격상 = 21
    expect(apiCount + computedCount + aiCount).toBe(27);
  });
});

describe('ADR-0150 — main + aiFallback 두 path 정합 (정적 grep 가드)', () => {
  // 본 테스트는 enrichment.ts 의 두 경로가 동일 임계를 사용하는지
  // 정적 검증. main path 또는 aiFallback path 한쪽만 갱신 시 회귀 가드.

  it('enrichment.ts 가 performanceReality 임계 (epsGrowth > 0) 두 경로 모두 적용', async () => {
    const { readFileSync } = await import('fs');
    const src = readFileSync('src/services/stock/enrichment.ts', 'utf-8');
    // performanceReality 매핑 패턴이 ≥2 위치 등장 (main + aiFallback)
    const matches = src.match(/performanceReality:\s*\([^)]*\bepsGrowth\b[^)]*\)\s*>\s*0\s*\?\s*1/g);
    expect(matches?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('enrichment.ts 가 economicMoatVerified 임계 (debtRatio<50 AND netProfitMargin>5) 두 경로 적용', async () => {
    const { readFileSync } = await import('fs');
    const src = readFileSync('src/services/stock/enrichment.ts', 'utf-8');
    // 임계 50 + 5 가 등장하는 economicMoatVerified 블록 ≥2
    const moatMatches = src.match(/economicMoatVerified:[\s\S]{0,200}debtRatio[\s\S]{0,100}<\s*50[\s\S]{0,200}netProfitMargin[\s\S]{0,100}>\s*5/g);
    expect(moatMatches?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('ADR-0150 주석이 enrichment.ts 에 등장 (트레이서빌리티)', async () => {
    const { readFileSync } = await import('fs');
    const src = readFileSync('src/services/stock/enrichment.ts', 'utf-8');
    expect(src).toContain('ADR-0150');
  });

  it('이전 (Phase 1 미완) 회귀 차단 — DART 3 키 매핑은 4 키 격상 후에도 보존', async () => {
    const { readFileSync } = await import('fs');
    const src = readFileSync('src/services/stock/enrichment.ts', 'utf-8');
    // 기존 ADR-0029 격상 3 키도 그대로 유지
    expect(src).toContain('roeType3:');
    expect(src).toContain('ocfQuality:');
    expect(src).toContain('interestCoverage:');
  });
});
