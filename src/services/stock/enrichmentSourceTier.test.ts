/**
 * @responsibility buildConditionSourceTiers 메타 빌드 단위 테스트 — ADR-0029 PR-B
 */
import { describe, it, expect } from 'vitest';
import { buildConditionSourceTiers } from './enrichment';

describe('buildConditionSourceTiers — ADR-0029 sourceTier 메타 분류', () => {
  it('main path (DART + VCP) → 6 키 격상 (ADR-0151 Phase 2: hasKisSupply 라벨 제거)', () => {
    const meta = buildConditionSourceTiers({
      hasDartFinancials: true,
      hasKisSupply: true, // ADR-0151: 후방호환 인자 — 라벨 부여 안 함 (의미 mismatch)
      hasVcpComputed: true,
    });
    // ADR-0151 (Phase 2): VCP 1 (COMPUTED) + DART 5 (API) = 6 키 격상
    // hasKisSupply 가 true 여도 institutionalBuying / supplyInflow 는 'API' 부여 안 함
    // (Naver foreignerOwnRatio 정적 값은 #4/#12 *흐름* 의미와 mismatch).
    expect(meta.vcpPattern).toBe('COMPUTED');
    expect(meta.roeType3).toBe('API');
    expect(meta.ocfQuality).toBe('API');
    expect(meta.interestCoverage).toBe('API');
    expect(meta.performanceReality).toBe('API');     // ADR-0150 신규
    expect(meta.economicMoatVerified).toBe('API');   // ADR-0150 신규
    // ADR-0151: institutionalBuying / supplyInflow 는 hasKisSupply 와 무관 AI_INFERRED 유지
    expect(meta.institutionalBuying).toBe('AI_INFERRED');
    expect(meta.supplyInflow).toBe('AI_INFERRED');
    // 나머지 19 키도 AI_INFERRED 기본값
    expect(meta.cycleVerified).toBe('AI_INFERRED');
    expect(meta.ichimokuBreakout).toBe('AI_INFERRED');
    expect(meta.catalystAnalysis).toBe('AI_INFERRED');
  });

  it('aiFallback path (DART 만) → 5 API 키만 격상 (ADR-0150 Phase 1 마무리)', () => {
    const meta = buildConditionSourceTiers({
      hasDartFinancials: true,
      hasKisSupply: false,
      hasVcpComputed: false,
    });
    // ADR-0150: DART 5 키 (roe/ocf/icr/performanceReality/economicMoatVerified)
    expect(meta.roeType3).toBe('API');
    expect(meta.ocfQuality).toBe('API');
    expect(meta.interestCoverage).toBe('API');
    expect(meta.performanceReality).toBe('API');     // ADR-0150 신규
    expect(meta.economicMoatVerified).toBe('API');   // ADR-0150 신규
    // ADR-0151: VCP/supply 는 AI_INFERRED 기본 유지 (hasKisSupply 무관)
    expect(meta.vcpPattern).toBe('AI_INFERRED');
    expect(meta.institutionalBuying).toBe('AI_INFERRED');
    expect(meta.supplyInflow).toBe('AI_INFERRED');
  });

  it('완전 fallback (DART 도 실패) → 모든 27 키 AI_INFERRED', () => {
    const meta = buildConditionSourceTiers({
      hasDartFinancials: false,
      hasKisSupply: false,
      hasVcpComputed: false,
    });
    const all = Object.values(meta);
    expect(all).toHaveLength(27);
    expect(all.every(v => v === 'AI_INFERRED')).toBe(true);
  });

  it('VCP 만 가용 (DART/supply 실패) → vcpPattern 만 COMPUTED', () => {
    const meta = buildConditionSourceTiers({
      hasDartFinancials: false,
      hasKisSupply: false,
      hasVcpComputed: true,
    });
    expect(meta.vcpPattern).toBe('COMPUTED');
    expect(meta.roeType3).toBe('AI_INFERRED');
    expect(meta.institutionalBuying).toBe('AI_INFERRED');
  });

  it('27 키 모두 메타 보유 (모든 항목 분류됨)', () => {
    const meta = buildConditionSourceTiers({
      hasDartFinancials: true,
      hasKisSupply: true,
      hasVcpComputed: true,
    });
    expect(Object.keys(meta)).toHaveLength(27);
  });

  it('ADR-0582: hasTechnicalComputed → 기술 6조건 COMPUTED 격상', () => {
    const meta = buildConditionSourceTiers({
      hasDartFinancials: false,
      hasKisSupply: false,
      hasVcpComputed: true,
      hasTechnicalComputed: true,
    });
    expect(meta.ichimokuBreakout).toBe('COMPUTED');
    expect(meta.technicalGoldenCross).toBe('COMPUTED');
    expect(meta.volumeSurgeVerified).toBe('COMPUTED');
    expect(meta.turtleBreakout).toBe('COMPUTED');
    expect(meta.fibonacciLevel).toBe('COMPUTED');
    expect(meta.divergenceCheck).toBe('COMPUTED');
  });

  it('ADR-0582: hasMarginTrend → marginAcceleration API 격상', () => {
    const meta = buildConditionSourceTiers({
      hasDartFinancials: true,
      hasKisSupply: false,
      hasVcpComputed: false,
      hasMarginTrend: true,
    });
    expect(meta.marginAcceleration).toBe('API');
  });

  it('ADR-0582: hasTechnicalComputed 부재(aiFallback) → 기술 조건 AI_INFERRED 유지', () => {
    const meta = buildConditionSourceTiers({
      hasDartFinancials: true,
      hasKisSupply: false,
      hasVcpComputed: false,
      hasTechnicalComputed: false,
      hasMarginTrend: false,
    });
    expect(meta.ichimokuBreakout).toBe('AI_INFERRED');
    expect(meta.turtleBreakout).toBe('AI_INFERRED');
    expect(meta.marginAcceleration).toBe('AI_INFERRED');
  });
});
