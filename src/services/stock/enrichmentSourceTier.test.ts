/**
 * @responsibility buildConditionSourceTiers 메타 빌드 단위 테스트 — ADR-0029 PR-B
 */
import { describe, it, expect } from 'vitest';
import { buildConditionSourceTiers } from './enrichment';

describe('buildConditionSourceTiers — ADR-0029 sourceTier 메타 분류', () => {
  it('main path (DART + KIS supply + VCP) → 8 키 격상 (ADR-0150 Phase 1 마무리)', () => {
    const meta = buildConditionSourceTiers({
      hasDartFinancials: true,
      hasKisSupply: true,
      hasVcpComputed: true,
    });
    // ADR-0150: VCP 1 (COMPUTED) + DART 5 (API: roe/ocf/icr + 신규 #15/#8) + KIS supply 2 (API) = 8 키 격상
    expect(meta.vcpPattern).toBe('COMPUTED');
    expect(meta.roeType3).toBe('API');
    expect(meta.ocfQuality).toBe('API');
    expect(meta.interestCoverage).toBe('API');
    expect(meta.performanceReality).toBe('API');     // ADR-0150 신규
    expect(meta.economicMoatVerified).toBe('API');   // ADR-0150 신규
    expect(meta.institutionalBuying).toBe('API');
    expect(meta.supplyInflow).toBe('API');
    // 나머지 19 키는 AI_INFERRED 기본값
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
    // VCP/supply 는 AI_INFERRED 기본 유지
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
});
