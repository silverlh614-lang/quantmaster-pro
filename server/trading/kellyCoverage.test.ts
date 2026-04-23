import { describe, it, expect } from 'vitest';
import { computeKellyCoverageRatio, KELLY_COVERAGE_TRIM_THRESHOLD } from './accountRiskBudget.js';

describe('computeKellyCoverageRatio (Idea 11)', () => {
  it('effectiveKelly 2% · maxPerTradeRiskPct 1.5% → coverage ≈ 1.33', () => {
    const cov = computeKellyCoverageRatio(0.02, 1.5);
    expect(cov).toBeCloseTo(0.02 / 0.015, 2);
    expect(cov).toBeGreaterThan(KELLY_COVERAGE_TRIM_THRESHOLD);
  });

  it('effectiveKelly 0.5% · maxPerTradeRiskPct 1.5% → coverage 0.33 (< threshold, trim 후보)', () => {
    const cov = computeKellyCoverageRatio(0.005, 1.5);
    expect(cov).toBeLessThan(KELLY_COVERAGE_TRIM_THRESHOLD);
  });

  it('maxPerTradeRiskPct 0 → 0', () => {
    expect(computeKellyCoverageRatio(0.1, 0)).toBe(0);
  });
});
