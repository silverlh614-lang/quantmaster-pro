// @responsibility Regime + FOMC multiplier combiner regression tests.

import { afterEach, describe, expect, it } from 'vitest';
import {
  combineRegimeAndFomcKelly,
  describeRegimeFomcCombination,
} from './regimeFomcCombiner.js';

describe('combineRegimeAndFomcKelly', () => {
  const originalEnv = process.env.FOMC_REGIME_OVERRIDE_DISABLED;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.FOMC_REGIME_OVERRIDE_DISABLED;
    else process.env.FOMC_REGIME_OVERRIDE_DISABLED = originalEnv;
  });

  it('keeps R6 as adjustment-only during normal FOMC phase', () => {
    const r = combineRegimeAndFomcKelly(0.3, 1.0, 'NORMAL', 'R6_DEFENSE');

    expect(r.value).toBe(0.3);
    expect(r.source).toBe('REGIME_ADJUSTMENT_ONLY');
    expect(r.reason).toContain('R6_DEFENSE');
    expect(r.reason).toContain('executionImpact=NONE');
  });

  it('does not let R6 override an active FOMC adjustment', () => {
    const pre = combineRegimeAndFomcKelly(0.3, 0.75, 'PRE_1', 'R6_DEFENSE');
    const post = combineRegimeAndFomcKelly(0.3, 1.30, 'POST_1', 'R6_DEFENSE');

    expect(pre).toMatchObject({ value: 0.75, source: 'FOMC' });
    expect(post).toMatchObject({ value: 1.30, source: 'FOMC' });
  });

  it('uses regime multiplier when FOMC is normal', () => {
    const r = combineRegimeAndFomcKelly(0.8, 1.0, 'NORMAL', 'R2_BULL');

    expect(r.value).toBe(0.8);
    expect(r.source).toBe('REGIME');
  });

  it('uses FOMC multiplier when FOMC is active for non-R6 regimes', () => {
    const r = combineRegimeAndFomcKelly(0.8, 0.75, 'PRE_1', 'R2_BULL');

    expect(r.value).toBe(0.75);
    expect(r.source).toBe('FOMC');
  });

  it('can restore the legacy product through the explicit rollback env', () => {
    process.env.FOMC_REGIME_OVERRIDE_DISABLED = 'true';
    const r = combineRegimeAndFomcKelly(0.8, 0.75, 'PRE_1', 'R2_BULL');

    expect(r.value).toBeCloseTo(0.6, 5);
    expect(r.source).toBe('LEGACY_PRODUCT');
  });
});

describe('describeRegimeFomcCombination', () => {
  it('renders R6 as adjustment-only, not a buy block', () => {
    const r = combineRegimeAndFomcKelly(0.3, 1.0, 'NORMAL', 'R6_DEFENSE');
    const desc = describeRegimeFomcCombination(r);

    expect(desc).toContain('R6_DEFENSE');
    expect(desc).toContain('executionImpact=NONE');
    expect(desc).not.toContain('매수 차단');
  });
});
