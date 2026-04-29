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

import { formatMhsAxisLine } from './regime.cmd.js';

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
