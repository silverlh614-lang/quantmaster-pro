// @responsibility ADR-0107 — formatMhsAxisLine + formatGateZeroContext 회귀 (사용자 진단 4/29).
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../commandRegistry.js', () => ({
  commandRegistry: { register: vi.fn() },
}));

vi.mock('../../../persistence/macroStateRepo.js', () => ({
  loadMacroState: vi.fn(() => null),
}));

vi.mock('../../../trading/regimeBridge.js', () => ({
  getLiveRegime: vi.fn(() => 'R4_NEUTRAL'),
}));

vi.mock('../../../../src/services/quant/regimeEngine.js', () => ({
  REGIME_CONFIGS: {
    R4_NEUTRAL: { kellyMultiplier: 1.0, maxPositions: 8, label: '중립' },
  },
}));

import { formatMhsAxisLine, formatMhsConfidenceLine } from './regime.cmd.js';

describe('formatMhsAxisLine — MHS 4-axis 분해 노출 (ADR-0107)', () => {
  it('mhsAxis 부재 시 안내 라인', () => {
    expect(formatMhsAxisLine({})).toBe('🧮 axis: N/A (다음 marketDataRefresh 사이클부터 노출)');
  });

  it('정상 axis — 합산 노출', () => {
    const result = formatMhsAxisLine({
      mhsAxis: { interestRate: 20, liquidity: 15, economy: 15, risk: 25 },
    });
    expect(result).toBe('🧮 axis: 금리 20 / 유동성 15 / 경기 15 / 리스크 25 (합 75)');
  });

  it('사용자 보고 시나리오 (MHS 70 = US10Y > 4.5 또는 VKOSPI > 20 -5감산)', () => {
    const result = formatMhsAxisLine({
      mhsAxis: { interestRate: 15, liquidity: 15, economy: 15, risk: 25 },
    });
    expect(result).toBe('🧮 axis: 금리 15 / 유동성 15 / 경기 15 / 리스크 25 (합 70)');
  });

  it('극단 시나리오 — 모든 axis 0', () => {
    expect(
      formatMhsAxisLine({ mhsAxis: { interestRate: 0, liquidity: 0, economy: 0, risk: 0 } }),
    ).toBe('🧮 axis: 금리 0 / 유동성 0 / 경기 0 / 리스크 0 (합 0)');
  });

  it('모든 axis 최대값 25 → 합 100', () => {
    expect(
      formatMhsAxisLine({ mhsAxis: { interestRate: 25, liquidity: 25, economy: 25, risk: 25 } }),
    ).toBe('🧮 axis: 금리 25 / 유동성 25 / 경기 25 / 리스크 25 (합 100)');
  });
});

describe('formatMhsAxisLine — mhsAxisUpdatedAt 신선도 suffix (ADR-0187)', () => {
  const baseAxis = { interestRate: 20, liquidity: 15, economy: 15, risk: 25 };

  it('updatedAt 부재 시 suffix 미표시 (후방호환)', () => {
    expect(formatMhsAxisLine({ mhsAxis: baseAxis })).toBe(
      '🧮 axis: 금리 20 / 유동성 15 / 경기 15 / 리스크 25 (합 75)',
    );
  });

  it('갱신 30분 전 → "30m 전"', () => {
    const now = new Date('2026-05-05T10:00:00Z');
    const updatedAt = '2026-05-05T09:30:00Z';
    const result = formatMhsAxisLine({ mhsAxis: baseAxis, mhsAxisUpdatedAt: updatedAt }, now);
    expect(result).toContain(' · 갱신 30m 전');
  });

  it('갱신 5시간 전 → "5h 전"', () => {
    const now = new Date('2026-05-05T15:00:00Z');
    const updatedAt = '2026-05-05T10:00:00Z';
    const result = formatMhsAxisLine({ mhsAxis: baseAxis, mhsAxisUpdatedAt: updatedAt }, now);
    expect(result).toContain(' · 갱신 5h 전');
  });

  it('갱신 30시간 전 → "1일 전 ⚠️ STALE" (24h+)', () => {
    const now = new Date('2026-05-05T10:00:00Z');
    const updatedAt = '2026-05-04T04:00:00Z';
    const result = formatMhsAxisLine({ mhsAxis: baseAxis, mhsAxisUpdatedAt: updatedAt }, now);
    expect(result).toContain(' · 갱신 1일 전 ⚠️ STALE');
  });

  it('잘못된 ISO 형식 → suffix 미표시 (안전 fallback)', () => {
    const now = new Date('2026-05-05T10:00:00Z');
    const result = formatMhsAxisLine(
      { mhsAxis: baseAxis, mhsAxisUpdatedAt: 'not-a-date' },
      now,
    );
    expect(result).toBe('🧮 axis: 금리 20 / 유동성 15 / 경기 15 / 리스크 25 (합 75)');
  });

  it('미래 시각 (now < updatedAt) → suffix 미표시 (음수 ageMs 안전)', () => {
    const now = new Date('2026-05-05T10:00:00Z');
    const updatedAt = '2026-05-05T11:00:00Z';
    const result = formatMhsAxisLine({ mhsAxis: baseAxis, mhsAxisUpdatedAt: updatedAt }, now);
    expect(result).toBe('🧮 axis: 금리 20 / 유동성 15 / 경기 15 / 리스크 25 (합 75)');
  });

  it('mhsAxis 부재 + updatedAt 동반 → axis 부재 안내 (suffix 무시)', () => {
    const now = new Date('2026-05-05T10:00:00Z');
    expect(formatMhsAxisLine({ mhsAxisUpdatedAt: '2026-05-05T09:00:00Z' }, now))
      .toBe('🧮 axis: N/A (다음 marketDataRefresh 사이클부터 노출)');
  });
});

describe('formatMhsConfidenceLine — MHS 소스 저하 신뢰도 라인 (ADR-0583)', () => {
  it('mhsConfidence 부재 → 안내 라인 (후방호환)', () => {
    expect(formatMhsConfidenceLine({})).toBe(
      '🛰 MHS 신뢰도: N/A (다음 marketDataRefresh 사이클부터 노출)',
    );
  });

  it('FULL → 소스 양쪽 ✅', () => {
    expect(
      formatMhsConfidenceLine({ mhsConfidence: 'FULL', mhsDegraded: false, mhsSourcesOk: { ecos: true, fred: true } }),
    ).toBe('🛰 MHS 신뢰도: FULL (ecos=✅ fred=✅)');
  });

  it('PARTIAL (fred 결손) → ⚠️ + 점수 해석 주의 (실측 시나리오)', () => {
    expect(
      formatMhsConfidenceLine({ mhsConfidence: 'PARTIAL', mhsDegraded: true, mhsSourcesOk: { ecos: true, fred: false } }),
    ).toBe('🛰 MHS 신뢰도: ⚠️ PARTIAL(일부 소스 결손) (ecos=✅ fred=❌) — 점수 해석 주의');
  });

  it('FALLBACK (전면 결손) → ❌ MHS 50 폴백 표기', () => {
    expect(
      formatMhsConfidenceLine({ mhsConfidence: 'FALLBACK', mhsDegraded: true, mhsSourcesOk: { ecos: false, fred: false } }),
    ).toBe('🛰 MHS 신뢰도: ❌ FALLBACK(소스 전면 결손→MHS 50) (ecos=❌ fred=❌) — 점수 해석 주의');
  });

  it('sourcesOk 부재 → 소스 라벨 N/A (후방호환)', () => {
    expect(formatMhsConfidenceLine({ mhsConfidence: 'FULL' })).toBe('🛰 MHS 신뢰도: FULL (N/A)');
  });
});
